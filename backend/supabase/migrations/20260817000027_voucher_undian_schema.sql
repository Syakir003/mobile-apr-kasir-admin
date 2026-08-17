-- =============================================================================
-- Fase 9 — Sistem Voucher/Diskon + Undian.
--
-- Admin bisa membuat UNDIAN (pengundian acak sungguhan, bukan sekadar promo)
-- dan VOUCHER ad-hoc (nego harga langsung). Keduanya menghasilkan kode voucher
-- yang terikat ke satu member. Pelanggan tidak punya akun/app — kode dikirim
-- via WhatsApp (reuse pola wa_outbox dari Pengingat Servis, migrasi 0023) dan
-- ditukar dengan cara diinput admin/kasir saat checkout (migrasi 0030). Tidak
-- ada langkah "klaim" terpisah: pemakaian kode DI checkout itu klaimnya.
--
-- Spec lengkap: docs/superpowers/specs/2026-08-17-voucher-diskon-undian-design.md
-- =============================================================================

-- ------------------------------------------------------------------- undian
create table if not exists undian (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  description        text,
  -- { "dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD", "mustHaveAcPurchase": true }
  -- semua key opsional; kosong = semua member aktif jadi peserta otomatis.
  criteria           jsonb not null default '{}'::jsonb,
  winner_count       integer not null check (winner_count > 0),
  -- Hadiahnya SATU macam untuk semua pemenang undian ini.
  discount_type      text not null check (discount_type in ('persen', 'nominal')),
  discount_value     integer not null check (discount_value > 0),
  max_discount_cap   integer check (max_discount_cap is null or max_discount_cap > 0),
  min_purchase       integer check (min_purchase is null or min_purchase >= 0),
  voucher_valid_days integer not null check (voucher_valid_days > 0),
  status             text not null default 'berjalan'
    check (status in ('berjalan', 'selesai', 'dibatalkan')),
  drawn_at           timestamptz,
  created_by         uuid references users (id),
  created_at         timestamptz not null default now(),
  check (discount_type <> 'persen' or discount_value <= 100)
);

alter table undian enable row level security;
grant select on undian to authenticated;
create policy "undian: baca admin"
  on undian for select to authenticated
  using (jwt_role() = 'admin');

-- ------------------------------------------------------- peserta undian
create table if not exists undian_participants (
  id         uuid primary key default gen_random_uuid(),
  undian_id  uuid not null references undian (id) on delete cascade,
  member_id  uuid not null references members (id) on delete cascade,
  source     text not null check (source in ('otomatis', 'manual')),
  added_at   timestamptz not null default now(),
  unique (undian_id, member_id)
);
create index if not exists undian_participants_undian_idx
  on undian_participants (undian_id);

alter table undian_participants enable row level security;
grant select on undian_participants to authenticated;
create policy "undian_participants: baca admin"
  on undian_participants for select to authenticated
  using (jwt_role() = 'admin');

-- ------------------------------------------------------------------ vouchers
create table if not exists vouchers (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  member_id              uuid not null references members (id),
  discount_type          text not null check (discount_type in ('persen', 'nominal')),
  discount_value         integer not null check (discount_value > 0),
  max_discount_cap       integer check (max_discount_cap is null or max_discount_cap > 0),
  min_purchase           integer check (min_purchase is null or min_purchase >= 0),
  expires_at             timestamptz not null,
  status                 text not null default 'aktif'
    check (status in ('aktif', 'terpakai', 'kadaluarsa', 'dibatalkan')),
  source                 text not null check (source in ('undian', 'manual')),
  undian_id              uuid references undian (id),
  note                   text,
  used_at                timestamptz,
  used_in_transaction_id uuid references transactions (id),
  created_by             uuid references users (id),
  created_at             timestamptz not null default now(),
  check (discount_type <> 'persen' or discount_value <= 100)
);
create index if not exists vouchers_member_idx on vouchers (member_id);
create index if not exists vouchers_status_idx on vouchers (status);

-- Berisi nama+HP pelanggan (lewat join member) → tertutup dari teknisi, sama
-- seperti wa_outbox (temuan #2 LAPORAN_KEAMANAN_2026-08-06.md).
alter table vouchers enable row level security;
grant select on vouchers to authenticated;
create policy "vouchers: baca admin/kasir"
  on vouchers for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

alter publication supabase_realtime add table vouchers;

-- ---------------------------------------------------- wa_outbox: 2 kind baru
alter table wa_outbox drop constraint if exists wa_outbox_kind_check;
alter table wa_outbox add constraint wa_outbox_kind_check
  check (kind in ('selesai_servis', 'reminder_h3', 'reminder_h7',
                   'menang_undian', 'voucher_baru'));

-- ------------------------------------------------------------------- helpers
-- Kode voucher acak, tanpa 0/O/1/I biar tidak ambigu dibaca/diketik manual
-- oleh kasir. Loop sampai dapat kode yang belum dipakai (tabrakan praktis
-- mustahil di ruang 33^6, tapi tetap dijaga).
create or replace function generate_voucher_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_exists boolean;
begin
  loop
    v_code := 'VCR-';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    end loop;
    select exists(select 1 from vouchers where code = v_code) into v_exists;
    exit when not v_exists;
  end loop;
  return v_code;
end;
$$;

-- Redaksi pesan WA untuk voucher/undian. Terpisah dari build_wa_body() (dipakai
-- Pengingat Servis) karena bentuk datanya beda total — voucher tidak punya
-- unit_ids/due_date yang jadi acuan pesan, tapi kode+nilai diskon+syarat.
create or replace function build_voucher_wa_body(p_voucher_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_nama text;
  v_source text;
  v_code text;
  v_type text;
  v_value integer;
  v_cap integer;
  v_min integer;
  v_expires date;
  v_note text;
  v_discount_desc text;
  v_syarat text := '';
begin
  select m.name, v.source, v.code, v.discount_type, v.discount_value,
         v.max_discount_cap, v.min_purchase, v.expires_at::date, v.note
    into v_nama, v_source, v_code, v_type, v_value, v_cap, v_min, v_expires, v_note
    from vouchers v join members m on m.id = v.member_id
   where v.id = p_voucher_id;

  v_discount_desc := case
    when v_type = 'persen' then
      v_value || '%' || case when v_cap is not null
        then ' (maks potongan Rp ' || v_cap || ')' else '' end
    else 'Rp ' || v_value
  end;

  if v_min is not null then
    v_syarat := v_syarat || e'\n' || '- Minimal belanja Rp ' || v_min;
  end if;
  v_syarat := v_syarat || e'\n' || '- Berlaku sampai ' || tgl_id(v_expires);
  if v_note is not null and v_note <> '' then
    v_syarat := v_syarat || e'\n' || '- ' || v_note;
  end if;

  return case v_source
    when 'undian' then
      'Selamat ' || v_nama || '! Anda MENANG undian dan berhak potongan harga '
      || v_discount_desc || '.' || e'\n\n'
      || 'Kode voucher Anda: ' || v_code || e'\n'
      || 'Tunjukkan/sebutkan kode ini saat membeli di toko kami.' || e'\n'
      || 'Syarat & ketentuan:' || v_syarat
      || e'\n\n— Ayub Podo Rukun'
    else
      'Halo ' || v_nama || ', berikut voucher potongan harga ' || v_discount_desc
      || ' khusus untuk Anda.' || e'\n\n'
      || 'Kode voucher: ' || v_code || e'\n'
      || 'Tunjukkan/sebutkan kode ini saat membeli di toko kami.' || e'\n'
      || 'Syarat & ketentuan:' || v_syarat
      || e'\n\n— Ayub Podo Rukun'
  end;
end;
$$;

revoke execute on function generate_voucher_code() from anon, public;
revoke execute on function build_voucher_wa_body(uuid) from anon, public;
