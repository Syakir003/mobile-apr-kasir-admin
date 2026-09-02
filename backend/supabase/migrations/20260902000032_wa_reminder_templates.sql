-- =============================================================================
-- Fase 8 lanjutan — Redaksi pesan pengingat servis yang bisa diedit admin.
--
-- Sampai migrasi ini, teks 3 pesan pengingat (selesai_servis, reminder_h3,
-- reminder_h7) di-hardcode di build_wa_body() (migrasi 0023). Sekarang teksnya
-- pindah ke tabel `wa_reminder_templates`, dengan placeholder {nama}, {unit},
-- {tanggal} yang disubstitusi build_wa_body() saat pesan diantrekan.
--
-- Yang TIDAK berubah:
--   * signature build_wa_body(uuid, text, uuid[], date) — kedua pemanggilnya
--     (update_technician_job_status migrasi 0024, enqueue_service_reminders
--     migrasi 0025) tetap jalan tanpa disentuh.
--   * pesan voucher/undian — pakai build_voucher_wa_body(), fungsi terpisah.
--   * body pesan yang SUDAH diantrekan — dibekukan di wa_outbox.body saat baris
--     dibuat, jadi mengedit template hanya berlaku untuk pesan berikutnya.
-- =============================================================================

-- --------------------------------------------------------- teks bawaan (tunggal)
-- Satu-satunya tempat redaksi bawaan hidup: dipakai seed di bawah, fallback
-- build_wa_body(), dan tombol "Reset ke bawaan" di UI (lewat
-- list_wa_reminder_templates). JANGAN menyalin teks ini ke client.
create or replace function default_wa_template(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'selesai_servis' then
      'Halo {nama}, pekerjaan AC Anda sudah selesai:' || e'\n'
      || '{unit}' || e'\n\n'
      || 'Terima kasih sudah mempercayakan perawatan AC Anda kepada kami. '
      || 'Kami ingatkan lagi otomatis menjelang {tanggal}.'
      || e'\n\n— Ayub Podo Rukun'
    when 'reminder_h3' then
      'Halo {nama}, AC berikut dijadwalkan servis pada {tanggal}:' || e'\n'
      || '{unit}' || e'\n\n'
      || 'Mau kami jadwalkan teknisi? Balas pesan ini ya.'
      || e'\n\n— Ayub Podo Rukun'
    when 'reminder_h7' then
      'Halo {nama}, jadwal servis AC berikut sudah lewat sejak {tanggal}:' || e'\n'
      || '{unit}' || e'\n\n'
      || 'Perawatan rutin menjaga AC tetap dingin dan hemat listrik. '
      || 'Balas pesan ini kalau mau kami kirim teknisi.'
      || e'\n\n— Ayub Podo Rukun'
  end;
$$;

revoke execute on function default_wa_template(text) from anon, public;

-- ---------------------------------------------------------------- tabel template
create table if not exists wa_reminder_templates (
  kind       text primary key
    check (kind in ('selesai_servis', 'reminder_h3', 'reminder_h7')),
  body       text not null
    check (length(btrim(body)) between 1 and 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id)
);

comment on table wa_reminder_templates is
  'Redaksi pesan pengingat servis, diedit admin lewat RPC save_wa_reminder_templates. Placeholder: {nama}, {unit}, {tanggal}.';

insert into wa_reminder_templates (kind, body)
select k, default_wa_template(k)
  from unnest(array['selesai_servis', 'reminder_h3', 'reminder_h7']) k
on conflict (kind) do nothing;

-- Berisi teks yang dikirim ke pelanggan, bukan data sensitif — tapi editornya
-- admin-only. RLS sejajar reminder_settings (migrasi 0023): baca admin/kasir,
-- tulis hanya lewat RPC security definer.
alter table wa_reminder_templates enable row level security;
grant select on wa_reminder_templates to authenticated;

drop policy if exists "wa_reminder_templates: baca admin/kasir" on wa_reminder_templates;
create policy "wa_reminder_templates: baca admin/kasir"
  on wa_reminder_templates for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

-- ============================================================ build_wa_body v2 ==
-- Redefinisi dari 20260815000023_service_reminders.sql. Signature & perilaku
-- COALESCE-safety identik; hanya sumber redaksinya yang berpindah ke tabel.
create or replace function build_wa_body(
  p_member_id uuid,
  p_kind      text,
  p_unit_ids  uuid[],
  p_due       date
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_nama text;
  v_unit text;
  v_tmpl text;
  v_body text;
begin
  -- COALESCE bukan gaya-gayaan: di SQL, `'teks' || NULL` menghasilkan NULL.
  -- Bila member atau unit tak ketemu (mis. terhapus berbarengan), body jadi
  -- NULL -> melanggar `not null` -> INSERT gagal -> dan karena insert antrean
  -- satu transaksi dengan penyelesaian job (migrasi 0024), TEKNISI JADI TIDAK
  -- BISA MENYELESAIKAN PEKERJAAN. Pengingat gagal tidak boleh pernah
  -- menjatuhkan alur bisnis inti.
  select coalesce(name, 'Pelanggan') into v_nama
    from members where id = p_member_id;
  v_nama := coalesce(v_nama, 'Pelanggan');

  select string_agg('- ' || brand || ' ' || model || ' (' || room_location || ')',
                    e'\n' order by room_location)
    into v_unit
    from member_ac_units
   where id = any (p_unit_ids);
  v_unit := coalesce(v_unit, '- Unit AC Anda');

  -- Template bisa diedit admin (tabel di atas). Fallback berlapis supaya
  -- build_wa_body TIDAK PERNAH mengembalikan NULL:
  --   1. baris tabel  ->  2. default_wa_template()  ->  3. teks generik
  -- Lapis 3 hanya menyala bila p_kind di luar 3 nilai yang dikenal — tak
  -- terjadi lewat pemanggil sekarang, tapi pesan aneh > job teknisi gagal.
  select body into v_tmpl from wa_reminder_templates where kind = p_kind;
  v_tmpl := coalesce(nullif(btrim(v_tmpl), ''), default_wa_template(p_kind));
  v_tmpl := coalesce(v_tmpl,
    'Halo {nama}, ada info servis AC untuk unit berikut:' || e'\n'
    || '{unit}' || e'\n\n— Ayub Podo Rukun');

  v_body := replace(v_tmpl, '{nama}', v_nama);
  v_body := replace(v_body, '{unit}', v_unit);
  v_body := replace(v_body, '{tanggal}', tgl_id(p_due));
  return v_body;
end;
$$;

revoke execute on function build_wa_body(uuid, text, uuid[], date) from anon, public;

-- ================================================== RPC untuk layar editor ==

-- list_wa_reminder_templates() — satu panggilan mengembalikan teks sekarang +
-- teks bawaan tiap pesan, jadi tombol "Reset ke bawaan" tak perlu menyalin
-- redaksi ke client. Admin/kasir (editornya sendiri admin-only lewat RPC simpan).
create or replace function list_wa_reminder_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Tidak terautentikasi';
  end if;
  if jwt_role() not in ('admin', 'kasir') then
    raise exception 'Tidak diizinkan';
  end if;

  return (
    select coalesce(jsonb_agg(item order by ord), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'kind', k.kind,
               'body', coalesce(t.body, default_wa_template(k.kind)),
               'defaultBody', default_wa_template(k.kind),
               'updatedAt', t.updated_at
             ) as item,
             k.ord
        from (values ('selesai_servis', 1), ('reminder_h3', 2),
                     ('reminder_h7', 3)) as k(kind, ord)
        left join wa_reminder_templates t on t.kind = k.kind
    ) s
  );
end;
$$;

revoke execute on function list_wa_reminder_templates() from anon, public;
grant  execute on function list_wa_reminder_templates() to authenticated;

-- save_wa_reminder_templates(payload) — admin.
--   payload: { templates: { <kind>: "<teks>", ... } }
--   Kunci opsional; yang dikirim di-upsert dalam satu transaksi.
create or replace function save_wa_reminder_templates(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := assert_caller_role(array['admin'],
                    'Hanya Admin yang boleh mengubah teks pesan pengingat');
  v_tmpls jsonb;
  v_kind  text;
  v_body  text;
  v_saved text[] := '{}';
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  v_tmpls := payload -> 'templates';
  if v_tmpls is null or jsonb_typeof(v_tmpls) <> 'object' then
    raise exception 'templates wajib diisi';
  end if;

  for v_kind in select jsonb_object_keys(v_tmpls)
  loop
    if v_kind not in ('selesai_servis', 'reminder_h3', 'reminder_h7') then
      raise exception 'Jenis pesan tidak dikenal: %', v_kind;
    end if;
    if jsonb_typeof(v_tmpls -> v_kind) is distinct from 'string' then
      raise exception 'Teks pesan % harus berupa teks', v_kind;
    end if;
    v_body := btrim(v_tmpls ->> v_kind);
    if v_body = '' then
      raise exception 'Teks pesan tidak boleh kosong (%)', v_kind;
    end if;
    if length(v_body) > 1000 then
      raise exception 'Teks pesan maksimal 1000 karakter (%)', v_kind;
    end if;
    -- Tolak placeholder salah ketik ({name}, {tgl}, {ac}, ...) — kalau lolos,
    -- teks itu terkirim mentah ke pelanggan. Hanya {nama} {unit} {tanggal} sah.
    if regexp_replace(v_body, '\{(nama|unit|tanggal)\}', '', 'g') ~ '\{[^{}]*\}' then
      raise exception
        'Kata kunci tak dikenal di pesan %. Hanya {nama}, {unit}, {tanggal} yang bisa dipakai.',
        v_kind;
    end if;

    insert into wa_reminder_templates (kind, body, updated_at, updated_by)
    values (v_kind, v_body, now(), v_uid)
    on conflict (kind) do update
      set body = excluded.body, updated_at = now(), updated_by = v_uid;
    v_saved := v_saved || v_kind;
  end loop;

  if array_length(v_saved, 1) is null then
    raise exception 'Tidak ada teks pesan untuk disimpan';
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'reminder.templates', 'wa_reminder_templates',
          jsonb_build_object('kinds', to_jsonb(v_saved)));

  return jsonb_build_object('ok', true, 'saved', to_jsonb(v_saved));
end;
$$;

revoke execute on function save_wa_reminder_templates(jsonb) from anon, public;
grant  execute on function save_wa_reminder_templates(jsonb) to authenticated;
