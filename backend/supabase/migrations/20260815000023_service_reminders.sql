-- =============================================================================
-- Fase 8 — Pengingat servis AC via WhatsApp (skema).
--
-- `member_ac_units.next_service_date` sudah ada sejak migrasi 0001 tapi tak
-- pernah diisi kode mana pun. Mulai rangkaian migrasi ini kolom tersebut jadi
-- sumber kebenaran jadwal: diisi otomatis saat job cuci/maintenance selesai
-- (migrasi 0024), lalu dipanen scheduler harian jadi baris antrean (0025).
--
-- Pesan TIDAK dikirim langsung dari trigger. Semuanya masuk `wa_outbox` dulu,
-- supaya CARA kirimnya bisa berganti tanpa menyentuh skema:
--   * sekarang  : adapter 'manual'   -> admin klik, wa.me terbuka terisi penuh
--   * nanti     : adapter 'cloud_api' -> Edge Function `send-wa` kirim sendiri
-- Naik ke Cloud API hanya mengubah isi Edge Function + app_config; tabel, RPC,
-- scheduler, dan kedua UI tidak berubah sama sekali.
--
-- Urutan penentuan siklus servis (yang pertama ketemu menang):
--   1. member_ac_units.service_interval_days  (override per unit AC)
--   2. reminder_settings.interval_days        (default per jenis job, diatur admin)
--   3. tidak ada / non-aktif -> unit tidak pernah dijadwalkan
-- =============================================================================

-- ------------------------------------------------------- override per unit AC
alter table member_ac_units
  add column if not exists service_interval_days integer
    check (service_interval_days is null
           or service_interval_days between 7 and 730);

comment on column member_ac_units.service_interval_days is
  'Override siklus servis unit ini dalam HARI. NULL = ikut default reminder_settings.';

-- ---------------------------------------------------------- opt-out pelanggan
alter table members
  add column if not exists wa_opt_out boolean not null default false;

comment on column members.wa_opt_out is
  'true = pelanggan minta berhenti dikirimi pengingat WhatsApp.';

-- ------------------------------------------------- default interval per jenis
-- Hanya jenis job yang memang berulang yang punya baris di sini. 'pemasangan',
-- 'bongkar', 'bongkar_pasang', dan 'service' sengaja TIDAK didaftarkan: sekali
-- kerja, tidak ada siklus berikutnya yang bisa diprediksi.
create table if not exists reminder_settings (
  job_type      text primary key,
  interval_days integer not null check (interval_days between 7 and 730),
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users (id)
);

comment on table reminder_settings is
  'Default siklus servis per jenis job, dalam hari. Diubah admin lewat RPC save_reminder_settings.';

insert into reminder_settings (job_type, interval_days, active) values
  ('cuci', 60, true),          -- 2 bulan
  ('maintenance', 180, true)   -- 6 bulan
on conflict (job_type) do nothing;

alter table reminder_settings enable row level security;
grant select on reminder_settings to authenticated;

drop policy if exists "reminder_settings: baca admin/kasir" on reminder_settings;
create policy "reminder_settings: baca admin/kasir"
  on reminder_settings for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

-- --------------------------------------------------------------- antrean WA
create table if not exists wa_outbox (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members (id) on delete cascade,
  -- Nama & nomor sengaja DIDENORMALISASI: Realtime `.stream()` tidak bisa
  -- melakukan join, sedangkan layar Pengingat perlu menampilkan nama penerima.
  -- Wajar untuk tabel antrean pesan — barisnya memang snapshot "apa yang
  -- dikirim ke siapa" pada saat itu, bukan cermin data member terkini.
  member_name text not null default '',
  phone       text not null,            -- sudah ternormalisasi: 62xxxxxxxxxx
  kind        text not null
    check (kind in ('selesai_servis', 'reminder_h3', 'reminder_h7')),
  unit_ids    uuid[] not null default '{}',
  due_date    date,
  body        text not null,
  status      text not null default 'pending'
    check (status in ('pending', 'terkirim', 'gagal', 'dibatalkan')),
  -- Anti-duplikat struktural: scheduler harian boleh dipanggil berkali-kali
  -- sehari (retry, restart, panen manual) tanpa pernah membuat pesan kembar.
  --   reminder : '<memberId>:<kind>:<dueDate>'
  --   konfirmasi: 'job:<jobId>'  -> satu job = satu pesan, selamanya
  dedupe_key  text not null unique,
  sent_at     timestamptz,
  sent_by     uuid references users (id),
  provider    text,                     -- 'manual' | 'cloud_api'
  provider_message_id text,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists wa_outbox_status_idx
  on wa_outbox (status, created_at desc);
create index if not exists wa_outbox_member_idx
  on wa_outbox (member_id);

-- Berisi nama + nomor HP pelanggan -> WAJIB tertutup dari teknisi. Bandingkan
-- temuan #2 LAPORAN_KEAMANAN_2026-08-06.md: satu akun teknisi dulu bisa menarik
-- seluruh basis pelanggan. Penulisan hanya lewat RPC (migrasi 0026).
alter table wa_outbox enable row level security;
grant select on wa_outbox to authenticated;

drop policy if exists "wa_outbox: baca admin/kasir" on wa_outbox;
create policy "wa_outbox: baca admin/kasir"
  on wa_outbox for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

-- Antrean baru dari scheduler muncul di layar Pengingat tanpa refresh manual.
alter publication supabase_realtime add table wa_outbox;

-- ================================================================== helpers ==

-- Normalisasi nomor HP ke format internasional tanpa '+', dipakai wa.me maupun
-- Cloud API.  '0812…' -> '62812…',  '+62 812-345' -> '62812345'.
-- String kosong dikembalikan apa adanya supaya pemanggil bisa menyaring member
-- tanpa nomor yang valid.
create or replace function wa_phone(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when d = ''       then ''
    when d like '62%' then d
    when d like '0%'  then '62' || substr(d, 2)
    else '62' || d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) s;
$$;

-- Tanggal berbahasa Indonesia: 15 Agustus 2026.
-- JANGAN pakai to_char(d, 'DD Mon YYYY') — hasilnya bulan Inggris ("Aug")
-- kecuali lc_time server disetel, dan itu tidak dijamin di Supabase hosted.
-- BUG-11 di LAPORAN_BUG_UI_QA_2026-08-05.md persis soal tanggal Inggris bocor
-- ke pengguna; pesan WA ke pelanggan jangan mengulang kesalahan yang sama.
create or replace function tgl_id(p_date date)
returns text
language sql
immutable
as $$
  select case when p_date is null then '-'
    else to_char(p_date, 'FMDD') || ' '
      || (array['Januari','Februari','Maret','April','Mei','Juni','Juli',
                'Agustus','September','Oktober','November','Desember']
         )[extract(month from p_date)::int]
      || ' ' || to_char(p_date, 'YYYY')
  end;
$$;

-- Siklus efektif satu unit untuk satu jenis job, dalam hari.
-- 0 = jangan dijadwalkan (jenis job sekali-kerja, atau default dinonaktifkan).
create or replace function resolve_service_interval_days(
  p_unit_id uuid, p_job_type text
) returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select service_interval_days from member_ac_units where id = p_unit_id),
    (select interval_days from reminder_settings
      where job_type = p_job_type and active),
    0
  );
$$;

-- Redaksi pesan. Sengaja disusun di SQL supaya scheduler bisa membentuk pesan
-- utuh tanpa bantuan client. Saat naik ke Cloud API, teks inilah yang diajukan
-- ke Meta sebagai template kategori Utility.
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

  return case p_kind
    when 'selesai_servis' then
      'Halo ' || v_nama || ', pekerjaan AC Anda sudah selesai:' || e'\n'
      || v_unit || e'\n\n'
      || 'Terima kasih sudah mempercayakan perawatan AC Anda kepada kami. '
      || 'Kami ingatkan lagi otomatis menjelang ' || tgl_id(p_due) || '.'
      || e'\n\n— Ayub Podo Rukun'
    when 'reminder_h3' then
      'Halo ' || v_nama || ', AC berikut dijadwalkan servis pada '
      || tgl_id(p_due) || ':' || e'\n' || v_unit || e'\n\n'
      || 'Mau kami jadwalkan teknisi? Balas pesan ini ya.'
      || e'\n\n— Ayub Podo Rukun'
    else
      'Halo ' || v_nama || ', jadwal servis AC berikut sudah lewat sejak '
      || tgl_id(p_due) || ':' || e'\n' || v_unit || e'\n\n'
      || 'Perawatan rutin menjaga AC tetap dingin dan hemat listrik. '
      || 'Balas pesan ini kalau mau kami kirim teknisi.'
      || e'\n\n— Ayub Podo Rukun'
  end;
end;
$$;

-- Postgres memberi EXECUTE ke `public` secara default — tanpa revoke, fungsi
-- ini bisa dipanggil `anon`. Lihat catatan migrasi 0020.
revoke execute on function wa_phone(text) from anon, public;
revoke execute on function tgl_id(date) from anon, public;
revoke execute on function resolve_service_interval_days(uuid, text) from anon, public;
revoke execute on function build_wa_body(uuid, text, uuid[], date) from anon, public;
