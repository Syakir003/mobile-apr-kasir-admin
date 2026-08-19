# Sistem Voucher/Diskon + Undian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin bisa membuat undian (pengundian acak sungguhan) dan voucher ad-hoc (nego harga), keduanya menghasilkan kode voucher terikat ke satu pelanggan yang bisa ditukar dengan cara diinput admin/kasir saat checkout untuk potongan harga.

**Architecture:** Dua tabel baru (`undian`, `undian_participants`) + satu tabel inti (`vouchers`). Pengiriman kode ke pelanggan reuse infrastruktur `wa_outbox` yang sudah ada dari Pengingat Servis (migrasi 0023) — dua `kind` baru (`menang_undian`, `voucher_baru`) otomatis muncul di layar Pengingat yang sudah ada, tanpa layar kirim WA baru. `checkout_transaction` diperluas menerima `voucherCode` opsional, validasi & perhitungan potongan sepenuhnya di server.

**Tech Stack:** Postgres (migrasi SQL, RPC `security definer`), Flutter + Riverpod + go_router (mobile), Next.js App Router (web).

**Spec:** `docs/superpowers/specs/2026-08-17-voucher-diskon-undian-design.md`

## Global Constraints

- **Hanya admin** boleh membuat undian atau voucher (termasuk voucher nego harga). Kasir & admin sama-sama boleh menukarkan kode saat checkout.
- **Voucher selalu terikat ke satu `member_id`** — tidak bisa dipakai pelanggan lain, dicocokkan lewat member hasil resolve `checkout_transaction`.
- **Voucher berlaku untuk semua jenis transaksi** — tidak dibatasi kategori item (keputusan eksplisit user, bukan "hanya AC baru").
- **Tidak ada langkah "klaim" terpisah** — pemakaian kode DI checkout itu klaimnya.
- **Pengiriman WA reuse `wa_outbox`** — sistem auto-susun & antre pesan, admin/kasir tap kirim di layar Pengingat yang sudah ada (`mark_wa_sent`/`cancel_wa_message` generik, tidak peduli `kind`). Tidak mengaktifkan WhatsApp Cloud API.
- **Field `discount` (rupiah bebas) di `checkout_transaction` TIDAK disentuh** — potongan voucher berjalan berdampingan, keduanya mengurangi subtotal (`v_discount := v_discount + v_voucher_discount` sebelum hitung pajak).
- **Semua penulisan lewat RPC `security definer`**, revoke dari `anon, public` lalu grant ke `authenticated`, pesan error Bahasa Indonesia, tulis `audit_logs`.
- **Nomor migrasi lanjut dari `20260815000026_reminder_rpc.sql`** — plan ini memakai `…0027` s/d `…0030`.
- **Uang dalam rupiah bulat (integer)**, persen 1–100.
- **Web sengaja lebih tipis dari mobile** — repo web baru punya `jobs`, `pengingat`, `transaksi` (route lain jatuh ke stub `[...slug]/page.tsx`); belum ada halaman POS/checkout di web, jadi tidak ada task "tambah field voucher di checkout web" di plan ini.

---

## Task 1: Migrasi 0027 — skema voucher & undian

**Files:**
- Create: `backend/supabase/migrations/20260817000027_voucher_undian_schema.sql`

**Interfaces:**
- Produces: tabel `undian`, `undian_participants`, `vouchers`; fungsi `generate_voucher_code()`, `build_voucher_wa_body(uuid)`; `wa_outbox.kind` menerima 2 nilai baru.
- Consumes: `jwt_role()`, `wa_phone()`, `tgl_id()` (migrasi 0023).
- Dikonsumsi Task 2 (RPC undian), Task 3 (RPC voucher), Task 4 (checkout).

- [x] **Step 1: Tulis migrasi skema**

```sql
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
```

- [x] **Step 2: Terapkan & verifikasi**

```bash
cd backend && npx supabase db reset
```

Di `psql`, verifikasi format kode:

```sql
select generate_voucher_code();  -- harus 'VCR-XXXXXX', 6 karakter tanpa 0/O/1/I
```

Verifikasi `wa_outbox` menerima kind baru (harus sukses, bukan error constraint):

```sql
insert into wa_outbox (member_id, phone, kind, body, dedupe_key)
select id, '628123456789', 'voucher_baru', 'tes', 'tes-kind-baru'
  from members limit 1;
delete from wa_outbox where dedupe_key = 'tes-kind-baru';
```

Verifikasi teknisi tidak bisa membaca `vouchers`/`undian` (harus 0 baris), pola simulasi JWT dari `LAPORAN_KEAMANAN_2026-08-06.md`:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"<uid-teknisi>","role":"authenticated","user_role":"teknisi"}', true);
select count(*) from vouchers;   -- harus 0
select count(*) from undian;     -- harus 0
rollback;
```

- [x] **Step 3: Commit**

```bash
git add backend/supabase/migrations/20260817000027_voucher_undian_schema.sql
git commit -m "feat(db): skema voucher/diskon + undian"
```

---

## Task 2: Migrasi 0028 — RPC undian

**Files:**
- Create: `backend/supabase/migrations/20260817000028_undian_rpc.sql`

**Interfaces:**
- Produces: `create_undian(payload)`, `update_undian_participants(payload)`, `draw_undian(payload)`, `cancel_undian(payload)`.
- Consumes: `assert_caller_role()` (migrasi 0005), `generate_voucher_code()`/`build_voucher_wa_body()` (Task 1), `wa_phone()`/`business_date_key()`.

- [x] **Step 1: Tulis RPC**

```sql
-- ============================================================================
-- create_undian(payload) — buat undian + auto-populate peserta dari kriteria.
--   payload: { title, description?, criteria: {dateFrom?, dateTo?,
--              mustHaveAcPurchase?}, winnerCount, discountType, discountValue,
--              maxDiscountCap?, minPurchase?, voucherValidDays }
--   return: { ok, undianId, participantCount }
-- ============================================================================
create or replace function create_undian(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := assert_caller_role(array['admin'], 'Hanya Admin yang boleh membuat undian');
  v_title text;
  v_description text;
  v_criteria jsonb;
  v_winner_count integer;
  v_discount_type text;
  v_discount_value integer;
  v_max_cap integer;
  v_min_purchase integer;
  v_valid_days integer;
  v_date_from date;
  v_date_to date;
  v_must_ac boolean;
  v_undian_id uuid;
  v_participant_count integer;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;

  if jsonb_typeof(payload -> 'title') is distinct from 'string'
     or btrim(payload ->> 'title') = '' then
    raise exception 'Judul undian wajib diisi';
  end if;
  v_title := btrim(payload ->> 'title');
  v_description := nullif(btrim(coalesce(payload ->> 'description', '')), '');

  if jsonb_typeof(payload -> 'winnerCount') <> 'number'
     or (payload ->> 'winnerCount')::numeric <> trunc((payload ->> 'winnerCount')::numeric)
     or (payload ->> 'winnerCount')::numeric <= 0 then
    raise exception 'Jumlah pemenang harus bilangan bulat > 0';
  end if;
  v_winner_count := (payload ->> 'winnerCount')::integer;

  v_discount_type := payload ->> 'discountType';
  if v_discount_type not in ('persen', 'nominal') then
    raise exception 'Tipe diskon harus persen atau nominal';
  end if;
  if jsonb_typeof(payload -> 'discountValue') <> 'number'
     or (payload ->> 'discountValue')::numeric <= 0 then
    raise exception 'Nilai diskon harus lebih dari 0';
  end if;
  v_discount_value := round((payload ->> 'discountValue')::numeric)::integer;
  if v_discount_type = 'persen' and v_discount_value > 100 then
    raise exception 'Diskon persen maksimal 100';
  end if;

  if payload ? 'maxDiscountCap' and payload -> 'maxDiscountCap' is not null then
    if jsonb_typeof(payload -> 'maxDiscountCap') <> 'number'
       or (payload ->> 'maxDiscountCap')::numeric <= 0 then
      raise exception 'Batas maksimal potongan tidak valid';
    end if;
    v_max_cap := round((payload ->> 'maxDiscountCap')::numeric)::integer;
  end if;

  if payload ? 'minPurchase' and payload -> 'minPurchase' is not null then
    if jsonb_typeof(payload -> 'minPurchase') <> 'number'
       or (payload ->> 'minPurchase')::numeric < 0 then
      raise exception 'Minimal pembelian tidak valid';
    end if;
    v_min_purchase := round((payload ->> 'minPurchase')::numeric)::integer;
  end if;

  if jsonb_typeof(payload -> 'voucherValidDays') <> 'number'
     or (payload ->> 'voucherValidDays')::numeric <= 0 then
    raise exception 'Masa berlaku voucher harus lebih dari 0 hari';
  end if;
  v_valid_days := round((payload ->> 'voucherValidDays')::numeric)::integer;

  v_criteria := coalesce(payload -> 'criteria', '{}'::jsonb);
  if jsonb_typeof(v_criteria) <> 'object' then
    raise exception 'Kriteria tidak valid';
  end if;
  if v_criteria ? 'dateFrom' and v_criteria -> 'dateFrom' is not null then
    begin
      v_date_from := (v_criteria ->> 'dateFrom')::date;
    exception when others then
      raise exception 'Tanggal mulai kriteria tidak valid';
    end;
  end if;
  if v_criteria ? 'dateTo' and v_criteria -> 'dateTo' is not null then
    begin
      v_date_to := (v_criteria ->> 'dateTo')::date;
    exception when others then
      raise exception 'Tanggal akhir kriteria tidak valid';
    end;
  end if;
  v_must_ac := coalesce((v_criteria ->> 'mustHaveAcPurchase')::boolean, false);

  insert into undian
    (title, description, criteria, winner_count, discount_type, discount_value,
     max_discount_cap, min_purchase, voucher_valid_days, status, created_by)
  values
    (v_title, v_description, v_criteria, v_winner_count, v_discount_type,
     v_discount_value, v_max_cap, v_min_purchase, v_valid_days, 'berjalan', v_uid)
  returning id into v_undian_id;

  insert into undian_participants (undian_id, member_id, source)
  select v_undian_id, m.id, 'otomatis'
    from members m
   where m.active
     and wa_phone(m.phone) <> ''
     and (v_date_from is null or exists (
           select 1 from transactions t where t.member_id = m.id
             and t.created_at::date >= v_date_from
             and (v_date_to is null or t.created_at::date <= v_date_to)
         ))
     and (not v_must_ac or exists (
           select 1 from transactions t
           join transaction_items ti on ti.transaction_id = t.id
          where t.member_id = m.id and ti.kind = 'product'
            and (v_date_from is null or t.created_at::date >= v_date_from)
            and (v_date_to is null or t.created_at::date <= v_date_to)
         ))
  on conflict (undian_id, member_id) do nothing;

  select count(*) into v_participant_count
    from undian_participants where undian_id = v_undian_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'undian.create', v_undian_id::text,
          jsonb_build_object('title', v_title, 'participantCount', v_participant_count));

  return jsonb_build_object('ok', true, 'undianId', v_undian_id,
                             'participantCount', v_participant_count);
end;
$$;

-- ============================================================================
-- update_undian_participants(payload) — tambah/hapus peserta manual.
--   payload: { undianId, add?: uuid[], remove?: uuid[] }
--   return: { ok, participantCount }
-- ============================================================================
create or replace function update_undian_participants(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := assert_caller_role(array['admin'], 'Hanya Admin yang boleh mengubah peserta undian');
  v_undian_id uuid;
  v_status text;
  v_add uuid[] := '{}';
  v_remove uuid[] := '{}';
  v_raw text;
  v_participant_count integer;
begin
  if payload is null or jsonb_typeof(payload -> 'undianId') is distinct from 'string' then
    raise exception 'undianId wajib diisi';
  end if;
  v_undian_id := (payload ->> 'undianId')::uuid;

  select status into v_status from undian where id = v_undian_id for update;
  if not found then
    raise exception 'Undian tidak ditemukan';
  end if;
  if v_status <> 'berjalan' then
    raise exception 'Undian ini sudah % — peserta tidak bisa diubah lagi', v_status;
  end if;

  if payload ? 'add' and jsonb_typeof(payload -> 'add') = 'array' then
    for v_raw in select * from jsonb_array_elements_text(payload -> 'add')
    loop
      v_add := v_add || v_raw::uuid;
    end loop;
  end if;
  if payload ? 'remove' and jsonb_typeof(payload -> 'remove') = 'array' then
    for v_raw in select * from jsonb_array_elements_text(payload -> 'remove')
    loop
      v_remove := v_remove || v_raw::uuid;
    end loop;
  end if;

  if array_length(v_add, 1) > 0 then
    insert into undian_participants (undian_id, member_id, source)
    select v_undian_id, m.id, 'manual'
      from members m where m.id = any (v_add) and m.active
    on conflict (undian_id, member_id) do nothing;
  end if;

  if array_length(v_remove, 1) > 0 then
    delete from undian_participants
     where undian_id = v_undian_id and member_id = any (v_remove);
  end if;

  select count(*) into v_participant_count
    from undian_participants where undian_id = v_undian_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'undian.update_participants', v_undian_id::text,
          jsonb_build_object('added', coalesce(array_length(v_add, 1), 0),
                             'removed', coalesce(array_length(v_remove, 1), 0)));

  return jsonb_build_object('ok', true, 'participantCount', v_participant_count);
end;
$$;

-- ============================================================================
-- draw_undian(payload) — pilih pemenang acak, buat voucher + antre WA per
-- pemenang, tutup undian.
--   payload: { undianId }
--   return: { ok, undianId, winnerCount }
-- ============================================================================
create or replace function draw_undian(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := assert_caller_role(array['admin'], 'Hanya Admin yang boleh menarik undian');
  v_undian_id uuid;
  v_title text;
  v_status text;
  v_winner_count integer;
  v_discount_type text;
  v_discount_value integer;
  v_max_cap integer;
  v_min_purchase integer;
  v_valid_days integer;
  v_participant_count integer;
  v_expires_date date;
  v_expires_at timestamptz;
  v_member_id uuid;
  v_voucher_id uuid;
  v_code text;
  v_wa_body text;
begin
  if payload is null or jsonb_typeof(payload -> 'undianId') is distinct from 'string' then
    raise exception 'undianId wajib diisi';
  end if;
  v_undian_id := (payload ->> 'undianId')::uuid;

  select title, status, winner_count, discount_type, discount_value,
         max_discount_cap, min_purchase, voucher_valid_days
    into v_title, v_status, v_winner_count, v_discount_type, v_discount_value,
         v_max_cap, v_min_purchase, v_valid_days
    from undian where id = v_undian_id
    for update;
  if not found then
    raise exception 'Undian tidak ditemukan';
  end if;
  if v_status <> 'berjalan' then
    raise exception 'Undian ini sudah % — tidak bisa ditarik lagi', v_status;
  end if;

  select count(*) into v_participant_count
    from undian_participants where undian_id = v_undian_id;
  if v_participant_count < v_winner_count then
    raise exception 'Peserta (%) kurang dari jumlah pemenang (%)',
      v_participant_count, v_winner_count;
  end if;

  -- Batas berlaku voucher dihitung dari hari bisnis WIB (business_date_key()),
  -- konsisten dengan pola tanggal Pengingat Servis. + 23:59:59 supaya
  -- `expires_at::date` langsung balik ke tanggal yang ditampilkan ke
  -- pelanggan, tanpa perlu koreksi off-by-one di pemanggil.
  v_expires_date := to_date(business_date_key(), 'YYYYMMDD') + v_valid_days;
  v_expires_at := v_expires_date + interval '23:59:59';

  for v_member_id in
    select member_id from undian_participants
     where undian_id = v_undian_id
     order by random()
     limit v_winner_count
  loop
    v_code := generate_voucher_code();
    insert into vouchers
      (code, member_id, discount_type, discount_value, max_discount_cap,
       min_purchase, expires_at, status, source, undian_id, note, created_by)
    values
      (v_code, v_member_id, v_discount_type, v_discount_value, v_max_cap,
       v_min_purchase, v_expires_at, 'aktif', 'undian', v_undian_id,
       'Menang undian: ' || v_title, v_uid)
    returning id into v_voucher_id;

    v_wa_body := build_voucher_wa_body(v_voucher_id);

    insert into wa_outbox (member_id, phone, kind, unit_ids, due_date, body, dedupe_key)
    select v_member_id, wa_phone(m.phone), 'menang_undian', '{}', v_expires_date,
           v_wa_body, 'voucher:' || v_voucher_id::text
      from members m where m.id = v_member_id
    on conflict (dedupe_key) do nothing;
  end loop;

  update undian set status = 'selesai', drawn_at = now() where id = v_undian_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'undian.draw', v_undian_id::text,
          jsonb_build_object('winnerCount', v_winner_count));

  return jsonb_build_object('ok', true, 'undianId', v_undian_id, 'winnerCount', v_winner_count);
end;
$$;

-- ============================================================================
-- cancel_undian(payload) — batalkan undian yang belum ditarik.
--   payload: { undianId }
-- ============================================================================
create or replace function cancel_undian(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := assert_caller_role(array['admin'], 'Hanya Admin yang boleh membatalkan undian');
  v_id uuid;
begin
  if payload is null or jsonb_typeof(payload -> 'undianId') is distinct from 'string' then
    raise exception 'undianId wajib diisi';
  end if;
  v_id := (payload ->> 'undianId')::uuid;

  update undian set status = 'dibatalkan'
   where id = v_id and status = 'berjalan';
  if not found then
    raise exception 'Undian tidak ditemukan atau sudah tidak bisa dibatalkan';
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'undian.cancel', v_id::text, '{}'::jsonb);

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function create_undian(jsonb) from anon, public;
grant  execute on function create_undian(jsonb) to authenticated;
revoke execute on function update_undian_participants(jsonb) from anon, public;
grant  execute on function update_undian_participants(jsonb) to authenticated;
revoke execute on function draw_undian(jsonb) from anon, public;
grant  execute on function draw_undian(jsonb) to authenticated;
revoke execute on function cancel_undian(jsonb) from anon, public;
grant  execute on function cancel_undian(jsonb) to authenticated;
```

- [x] **Step 2: Terapkan & verifikasi**

```bash
cd backend && npx supabase db reset
```

Di `psql` — buat undian dengan 2 member sebagai peserta manual, tarik dengan `winnerCount=1`, ulangi cek anti-duplikat pemenang & voucher-nya:

```sql
select create_undian('{"title":"Tes","criteria":{},"winnerCount":1,"discountType":"nominal","discountValue":50000,"voucherValidDays":30}'::jsonb);
-- catat undianId dari hasil, lalu:
select update_undian_participants(jsonb_build_object('undianId','<undianId>','add', array[(select id from members limit 2)]));
select draw_undian(jsonb_build_object('undianId','<undianId>'));  -- winnerCount: 1
select draw_undian(jsonb_build_object('undianId','<undianId>'));  -- HARUS error 'sudah selesai'
select code, status, expires_at::date from vouchers where undian_id = '<undianId>';
select kind, due_date from wa_outbox where dedupe_key like 'voucher:%';
```

Verifikasi peran: sebagai kasir, panggil `create_undian`/`draw_undian` → harus ditolak.

- [x] **Step 3: Commit**

```bash
git add backend/supabase/migrations/20260817000028_undian_rpc.sql
git commit -m "feat(db): RPC undian (buat, peserta, tarik, batal)"
```

---

## Task 3: Migrasi 0029 — RPC voucher ad-hoc

**Files:**
- Create: `backend/supabase/migrations/20260817000029_voucher_rpc.sql`

**Interfaces:**
- Produces: `create_voucher(payload)`, `cancel_voucher(payload)`.
- Consumes: `generate_voucher_code()`/`build_voucher_wa_body()` (Task 1).

- [x] **Step 1: Tulis RPC**

```sql
-- ============================================================================
-- create_voucher(payload) — voucher ad-hoc (nego harga), langsung ke satu
-- member.
--   payload: { memberId, discountType, discountValue, maxDiscountCap?,
--              minPurchase?, expiresAt: 'YYYY-MM-DD', note? }
--   return: { ok, voucherId, code }
-- ============================================================================
create or replace function create_voucher(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := assert_caller_role(array['admin'], 'Hanya Admin yang boleh membuat voucher');
  v_member_id uuid;
  v_discount_type text;
  v_discount_value integer;
  v_max_cap integer;
  v_min_purchase integer;
  v_expires_date date;
  v_expires_at timestamptz;
  v_note text;
  v_code text;
  v_voucher_id uuid;
  v_wa_body text;
begin
  if payload is null or jsonb_typeof(payload -> 'memberId') is distinct from 'string' then
    raise exception 'Pelanggan wajib dipilih';
  end if;
  v_member_id := (payload ->> 'memberId')::uuid;
  if not exists (select 1 from members where id = v_member_id and active) then
    raise exception 'Pelanggan tidak ditemukan atau tidak aktif';
  end if;

  v_discount_type := payload ->> 'discountType';
  if v_discount_type not in ('persen', 'nominal') then
    raise exception 'Tipe diskon harus persen atau nominal';
  end if;
  if jsonb_typeof(payload -> 'discountValue') <> 'number'
     or (payload ->> 'discountValue')::numeric <= 0 then
    raise exception 'Nilai diskon harus lebih dari 0';
  end if;
  v_discount_value := round((payload ->> 'discountValue')::numeric)::integer;
  if v_discount_type = 'persen' and v_discount_value > 100 then
    raise exception 'Diskon persen maksimal 100';
  end if;

  if payload ? 'maxDiscountCap' and payload -> 'maxDiscountCap' is not null then
    if jsonb_typeof(payload -> 'maxDiscountCap') <> 'number'
       or (payload ->> 'maxDiscountCap')::numeric <= 0 then
      raise exception 'Batas maksimal potongan tidak valid';
    end if;
    v_max_cap := round((payload ->> 'maxDiscountCap')::numeric)::integer;
  end if;

  if payload ? 'minPurchase' and payload -> 'minPurchase' is not null then
    if jsonb_typeof(payload -> 'minPurchase') <> 'number'
       or (payload ->> 'minPurchase')::numeric < 0 then
      raise exception 'Minimal pembelian tidak valid';
    end if;
    v_min_purchase := round((payload ->> 'minPurchase')::numeric)::integer;
  end if;

  if jsonb_typeof(payload -> 'expiresAt') is distinct from 'string' then
    raise exception 'Tanggal kedaluwarsa wajib diisi';
  end if;
  begin
    v_expires_date := (payload ->> 'expiresAt')::date;
  exception when others then
    raise exception 'Tanggal kedaluwarsa tidak valid';
  end;
  v_expires_at := v_expires_date + interval '23:59:59';
  if v_expires_at < now() then
    raise exception 'Tanggal kedaluwarsa harus di masa depan';
  end if;

  v_note := nullif(btrim(coalesce(payload ->> 'note', '')), '');

  v_code := generate_voucher_code();
  insert into vouchers
    (code, member_id, discount_type, discount_value, max_discount_cap,
     min_purchase, expires_at, status, source, note, created_by)
  values
    (v_code, v_member_id, v_discount_type, v_discount_value, v_max_cap,
     v_min_purchase, v_expires_at, 'aktif', 'manual', v_note, v_uid)
  returning id into v_voucher_id;

  v_wa_body := build_voucher_wa_body(v_voucher_id);

  insert into wa_outbox (member_id, phone, kind, unit_ids, due_date, body, dedupe_key)
  select v_member_id, wa_phone(m.phone), 'voucher_baru', '{}', v_expires_date,
         v_wa_body, 'voucher:' || v_voucher_id::text
    from members m where m.id = v_member_id
  on conflict (dedupe_key) do nothing;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'voucher.create', v_voucher_id::text,
          jsonb_build_object('code', v_code, 'memberId', v_member_id));

  return jsonb_build_object('ok', true, 'voucherId', v_voucher_id, 'code', v_code);
end;
$$;

-- ============================================================================
-- cancel_voucher(payload) — batalkan voucher yang masih aktif.
--   payload: { voucherId, reason? }
-- ============================================================================
create or replace function cancel_voucher(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := assert_caller_role(array['admin'], 'Hanya Admin yang boleh membatalkan voucher');
  v_id uuid;
  v_reason text;
begin
  if payload is null or jsonb_typeof(payload -> 'voucherId') is distinct from 'string' then
    raise exception 'voucherId wajib diisi';
  end if;
  v_id := (payload ->> 'voucherId')::uuid;
  v_reason := nullif(btrim(coalesce(payload ->> 'reason', '')), '');

  update vouchers set status = 'dibatalkan'
   where id = v_id and status = 'aktif';
  if not found then
    raise exception 'Voucher tidak ditemukan atau sudah tidak aktif';
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'voucher.cancel', v_id::text, jsonb_build_object('reason', v_reason));

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function create_voucher(jsonb) from anon, public;
grant  execute on function create_voucher(jsonb) to authenticated;
revoke execute on function cancel_voucher(jsonb) from anon, public;
grant  execute on function cancel_voucher(jsonb) to authenticated;
```

- [x] **Step 2: Terapkan & verifikasi**

```bash
cd backend && npx supabase db reset
```

```sql
select create_voucher(jsonb_build_object(
  'memberId', (select id from members limit 1),
  'discountType', 'persen', 'discountValue', 10, 'maxDiscountCap', 100000,
  'expiresAt', (current_date + 30)::text));
-- ambil voucherId dari hasil:
select cancel_voucher(jsonb_build_object('voucherId', '<voucherId>'));
select cancel_voucher(jsonb_build_object('voucherId', '<voucherId>'));  -- HARUS error, sudah dibatalkan
```

Sebagai kasir: `create_voucher` harus ditolak; sebagai teknisi: keduanya ditolak.

- [x] **Step 3: Commit**

```bash
git add backend/supabase/migrations/20260817000029_voucher_rpc.sql
git commit -m "feat(db): RPC voucher ad-hoc (buat, batal)"
```

---

## Task 4: Migrasi 0030 — `checkout_transaction` menerima kode voucher

**Files:**
- Create: `backend/supabase/migrations/20260817000030_checkout_voucher.sql`

**Interfaces:**
- Mendefinisikan ulang `checkout_transaction(payload jsonb)` dari versi terakhirnya di `20260718000015_checkout_service_units.sql:44`.
- Consumes: tabel `vouchers` (Task 1).
- Payload tambah field opsional `voucherCode: string`.

**Kenapa redefinisi fungsi:** validasi & pemakaian voucher harus atomik dengan transaksi (satu commit) — kode ditandai `terpakai` HANYA jika seluruh checkout berhasil.

- [x] **Step 1: Tulis migrasi — definisi ulang penuh**

```sql
-- =============================================================================
-- Fase 9 lanjutan — checkout_transaction menerima voucherCode opsional.
--
-- Validasi & perhitungan potongan sepenuhnya di server (kode invalid/expired/
-- sudah dipakai/tidak cocok pelanggan → transaksi gagal total, tidak checkout
-- diam-diam tanpa voucher). Potongan voucher DITAMBAHKAN ke `discount` manual
-- yang sudah ada (v_discount := v_discount + v_voucher_discount) — kolom
-- `discount` di transactions/invoices tetap satu, tidak ada kolom baru.
--
-- Perubahan dari versi 20260718000015:
--   1. Validasi voucherCode ditambah di blok field opsional.
--   2. Blok "member (cari/buat)" DIPINDAH ke sebelum "hitung total" (semula
--      sesudah) karena validasi voucher butuh v_member_id lebih dulu.
--   3. Blok voucher baru disisipkan setelah member, sebelum hitung total.
--   4. Setelah invoice lahir, voucher yang dipakai ditandai 'terpakai'.
--   5. audit_logs menyertakan voucherId.
-- Sisanya (validasi item/installations/serviceUnits, baca master, validasi
-- teknisi, insert item/stock/order/job) IDENTIK dengan versi sebelumnya.
-- =============================================================================

create or replace function checkout_transaction(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_customer jsonb;
  v_items jsonb;
  v_installations jsonb;
  v_service_units jsonb;
  v_item jsonb;
  v_inst jsonb;
  v_svc jsonb;
  v_idx integer;
  v_n_items integer;

  v_kinds text[] := '{}';
  v_ref_ids uuid[] := '{}';
  v_qtys numeric[] := '{}';
  v_names text[] := '{}';
  v_units text[] := '{}';
  v_prices integer[] := '{}';
  v_line_totals integer[] := '{}';
  v_brands text[] := '{}';
  v_types text[] := '{}';
  v_pks numeric[] := '{}';
  v_seen text[] := '{}';
  v_inst_count integer[];
  v_svc_count integer[];
  v_categories text[] := '{}';

  v_seen_svc text[] := '{}';
  v_job_types text[] := '{}';
  v_job_order_ids uuid[] := '{}';
  v_job_type text;
  v_job_pos integer;
  v_svc_unit_id uuid;
  v_svc_unit_member uuid;
  v_n_svc integer := 0;

  v_kind text;
  v_ref_raw text;
  v_ref uuid;
  v_qty numeric;
  v_name text;
  v_active boolean;
  v_stock numeric;
  v_price integer;
  v_brand text;
  v_type text;
  v_pk numeric;
  v_unit text;
  v_category text;

  v_tid_raw text;
  v_tid uuid;
  v_tech_role text;
  v_tech_active boolean;
  v_seen_tech text[] := '{}';

  v_discount integer := 0;
  v_tax_percent numeric := 0;
  v_transport_fee integer := 0;
  v_notes text;
  v_subtotal integer := 0;
  v_tax_base integer;
  v_tax_amount integer;
  v_grand_total integer;

  v_phone text;
  v_member_id uuid;
  v_n_inst integer := 0;

  v_date_key text;
  v_inv_seq integer;
  v_invoice_number text;
  v_transaction_id uuid;
  v_invoice_id uuid;
  v_order_id uuid;
  v_unit_id uuid;
  v_unit_seq integer;
  v_barcode text;
  v_room text;

  -- ----------------------------------------------------------- voucher (baru)
  v_voucher_code_raw text;
  v_voucher_id uuid;
  v_voucher_member uuid;
  v_voucher_type text;
  v_voucher_value integer;
  v_voucher_cap integer;
  v_voucher_min integer;
  v_voucher_expires timestamptz;
  v_voucher_status text;
  v_voucher_discount integer := 0;
begin
  v_uid := assert_caller_role(array['admin', 'kasir'], 'Hanya Admin/Kasir');

  -- ------------------------------------------------ validasi payload
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;

  v_customer := payload -> 'customer';
  if v_customer is null or jsonb_typeof(v_customer) <> 'object' then
    raise exception 'Data pelanggan wajib diisi';
  end if;
  if jsonb_typeof(v_customer -> 'name') is distinct from 'string'
     or btrim(v_customer ->> 'name') = '' then
    raise exception 'Nama pelanggan wajib diisi';
  end if;
  if jsonb_typeof(v_customer -> 'phone') is distinct from 'string'
     or btrim(v_customer ->> 'phone') = '' then
    raise exception 'Nomor telepon wajib diisi';
  end if;
  if v_customer ? 'address'
     and jsonb_typeof(v_customer -> 'address') <> 'string' then
    raise exception 'Alamat tidak valid';
  end if;

  v_items := payload -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) < 1 then
    raise exception 'Minimal 1 item wajib diisi';
  end if;
  v_n_items := jsonb_array_length(v_items);

  for v_item, v_idx in
    select value, ordinality from jsonb_array_elements(v_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Item tidak valid';
    end if;
    v_kind := v_item ->> 'kind';
    if jsonb_typeof(v_item -> 'kind') is distinct from 'string'
       or v_kind not in ('product', 'sparepart', 'service') then
      raise exception 'Jenis item tidak dikenal';
    end if;
    v_ref_raw := v_item ->> 'refId';
    if jsonb_typeof(v_item -> 'refId') is distinct from 'string'
       or v_ref_raw = '' then
      raise exception 'refId item wajib diisi';
    end if;
    if jsonb_typeof(v_item -> 'qty') is distinct from 'number' then
      raise exception 'Qty item harus lebih dari 0';
    end if;
    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Qty item harus lebih dari 0';
    end if;
    if v_kind = 'product' and v_qty <> trunc(v_qty) then
      raise exception 'Qty produk harus bilangan bulat';
    end if;
    if (v_kind || ':' || v_ref_raw) = any (v_seen) then
      raise exception 'Item duplikat';
    end if;
    v_seen := v_seen || (v_kind || ':' || v_ref_raw);

    begin
      v_ref := v_ref_raw::uuid;
    exception when invalid_text_representation then
      raise exception 'Item % tidak ditemukan', v_ref_raw;
    end;
    v_kinds := v_kinds || v_kind;
    v_ref_ids := v_ref_ids || v_ref;
    v_qtys := v_qtys || v_qty;
  end loop;

  if payload ? 'discount' then
    if jsonb_typeof(payload -> 'discount') <> 'number'
       or (payload ->> 'discount')::numeric < 0 then
      raise exception 'Diskon tidak valid';
    end if;
    v_discount := round((payload ->> 'discount')::numeric)::integer;
  end if;
  if payload ? 'taxPercent' then
    if jsonb_typeof(payload -> 'taxPercent') <> 'number'
       or (payload ->> 'taxPercent')::numeric < 0
       or (payload ->> 'taxPercent')::numeric > 100 then
      raise exception 'Pajak harus di rentang 0-100%%';
    end if;
    v_tax_percent := (payload ->> 'taxPercent')::numeric;
  end if;
  if payload ? 'transportFee' then
    if jsonb_typeof(payload -> 'transportFee') <> 'number'
       or (payload ->> 'transportFee')::numeric < 0 then
      raise exception 'Ongkos transport tidak valid';
    end if;
    v_transport_fee := round((payload ->> 'transportFee')::numeric)::integer;
  end if;
  if payload ? 'notes' then
    if jsonb_typeof(payload -> 'notes') <> 'string' then
      raise exception 'Catatan tidak valid';
    end if;
    v_notes := payload ->> 'notes';
  end if;

  -- ----------------------------------------------------------- voucher (baru)
  if payload ? 'voucherCode' and payload -> 'voucherCode' is not null then
    if jsonb_typeof(payload -> 'voucherCode') <> 'string' then
      raise exception 'Kode voucher tidak valid';
    end if;
    v_voucher_code_raw := nullif(btrim(payload ->> 'voucherCode'), '');
  end if;

  v_installations := coalesce(payload -> 'installations', '[]'::jsonb);
  if jsonb_typeof(v_installations) <> 'array' then
    raise exception 'Data pemasangan tidak valid';
  end if;
  v_n_inst := jsonb_array_length(v_installations);
  v_inst_count := array_fill(0, array[v_n_items]);

  for v_inst in select value from jsonb_array_elements(v_installations)
  loop
    if jsonb_typeof(v_inst) <> 'object' then
      raise exception 'Data pemasangan tidak valid';
    end if;
    if jsonb_typeof(v_inst -> 'itemIndex') is distinct from 'number'
       or (v_inst ->> 'itemIndex')::numeric <> trunc((v_inst ->> 'itemIndex')::numeric)
       or (v_inst ->> 'itemIndex')::numeric < 0
       or (v_inst ->> 'itemIndex')::numeric >= v_n_items then
      raise exception 'itemIndex pemasangan tidak valid';
    end if;
    v_idx := (v_inst ->> 'itemIndex')::integer + 1;
    if v_kinds[v_idx] <> 'product' then
      raise exception 'Pemasangan hanya berlaku untuk item produk AC';
    end if;
    if v_inst ? 'roomLocation'
       and jsonb_typeof(v_inst -> 'roomLocation') <> 'string' then
      raise exception 'Lokasi ruangan tidak valid';
    end if;
    if v_inst ? 'technicianId'
       and jsonb_typeof(v_inst -> 'technicianId') <> 'string' then
      raise exception 'technicianId tidak valid';
    end if;
    v_inst_count[v_idx] := v_inst_count[v_idx] + 1;
  end loop;
  for v_idx in 1..v_n_items loop
    if v_inst_count[v_idx] > v_qtys[v_idx] then
      raise exception 'Jumlah pemasangan melebihi qty item';
    end if;
  end loop;

  v_service_units := coalesce(payload -> 'serviceUnits', '[]'::jsonb);
  if jsonb_typeof(v_service_units) <> 'array' then
    raise exception 'Data unit servis tidak valid';
  end if;
  v_n_svc := jsonb_array_length(v_service_units);
  v_svc_count := array_fill(0, array[v_n_items]);

  for v_svc in select value from jsonb_array_elements(v_service_units)
  loop
    if jsonb_typeof(v_svc) <> 'object' then
      raise exception 'Data unit servis tidak valid';
    end if;
    if jsonb_typeof(v_svc -> 'itemIndex') is distinct from 'number'
       or (v_svc ->> 'itemIndex')::numeric <> trunc((v_svc ->> 'itemIndex')::numeric)
       or (v_svc ->> 'itemIndex')::numeric < 0
       or (v_svc ->> 'itemIndex')::numeric >= v_n_items then
      raise exception 'itemIndex unit servis tidak valid';
    end if;
    v_idx := (v_svc ->> 'itemIndex')::integer + 1;
    if v_kinds[v_idx] <> 'service' then
      raise exception 'Unit servis hanya berlaku untuk item jasa';
    end if;
    if jsonb_typeof(v_svc -> 'unitId') is distinct from 'string'
       or btrim(coalesce(v_svc ->> 'unitId', '')) = '' then
      raise exception 'unitId wajib diisi';
    end if;
    begin
      v_svc_unit_id := (v_svc ->> 'unitId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Unit AC tidak ditemukan';
    end;
    if (v_idx::text || ':' || v_svc_unit_id::text) = any (v_seen_svc) then
      raise exception 'Unit AC terpilih ganda pada satu jasa';
    end if;
    v_seen_svc := v_seen_svc || (v_idx::text || ':' || v_svc_unit_id::text);
    if v_svc ? 'technicianId'
       and jsonb_typeof(v_svc -> 'technicianId') <> 'string' then
      raise exception 'technicianId tidak valid';
    end if;
    v_svc_count[v_idx] := v_svc_count[v_idx] + 1;
  end loop;
  for v_idx in 1..v_n_items loop
    if v_svc_count[v_idx] > v_qtys[v_idx] then
      raise exception 'Jumlah unit servis melebihi qty jasa';
    end if;
  end loop;

  for v_idx in 1..v_n_items loop
    v_kind := v_kinds[v_idx];
    v_category := '';
    if v_kind = 'product' then
      select p.name, p.active, p.stock::numeric, p.sell_price, p.brand, p.type, p.pk
        into v_name, v_active, v_stock, v_price, v_brand, v_type, v_pk
        from products p where p.id = v_ref_ids[v_idx]
        for update;
    elsif v_kind = 'sparepart' then
      select s.name, s.active, s.stock, s.sell_price, '', s.unit, 0
        into v_name, v_active, v_stock, v_price, v_brand, v_unit, v_pk
        from spareparts s where s.id = v_ref_ids[v_idx]
        for update;
    else
      select sv.name, sv.active, null::numeric, sv.base_price, '', '', 0, sv.category
        into v_name, v_active, v_stock, v_price, v_brand, v_unit, v_pk, v_category
        from services sv where sv.id = v_ref_ids[v_idx];
    end if;

    if not found then
      raise exception 'Item % tidak ditemukan', v_ref_ids[v_idx];
    end if;
    if v_active = false then
      raise exception '% tidak aktif', v_name;
    end if;
    if v_kind in ('product', 'sparepart') and coalesce(v_stock, 0) < v_qtys[v_idx] then
      raise exception 'Stok % tidak cukup', v_name;
    end if;

    v_names := v_names || v_name;
    v_prices := v_prices || v_price;
    v_categories := v_categories || coalesce(v_category, '');
    v_units := v_units || case v_kind
      when 'product' then 'unit'
      when 'service' then 'jasa'
      else coalesce(v_unit, '')
    end;
    if v_kind = 'product' then
      v_brands := v_brands || coalesce(v_brand, '');
      v_types := v_types || coalesce(v_type, '');
      v_pks := v_pks || coalesce(v_pk, 0);
    else
      v_brands := v_brands || ''::text;
      v_types := v_types || ''::text;
      v_pks := v_pks || 0::numeric;
    end if;
  end loop;

  for v_tid_raw in
    select distinct value ->> 'technicianId'
    from jsonb_array_elements(v_installations || v_service_units)
    where value ? 'technicianId' and value ->> 'technicianId' <> ''
  loop
    begin
      v_tid := v_tid_raw::uuid;
    exception when invalid_text_representation then
      raise exception 'Teknisi tidak valid atau tidak aktif';
    end;
    select u.role::text, u.active into v_tech_role, v_tech_active
      from users u where u.id = v_tid;
    if not found or v_tech_role <> 'teknisi' or v_tech_active is not true then
      raise exception 'Teknisi tidak valid atau tidak aktif';
    end if;
  end loop;

  -- ------------------------------------------------ subtotal
  for v_idx in 1..v_n_items loop
    v_line_totals := v_line_totals || round(v_qtys[v_idx] * v_prices[v_idx])::integer;
    v_subtotal := v_subtotal + v_line_totals[v_idx];
  end loop;

  -- ------------------------------------------------ member (cari/buat)
  -- Dipindah ke sini (semula setelah hitung total) — validasi voucher di
  -- bawah butuh v_member_id lebih dulu.
  v_phone := normalize_phone(v_customer ->> 'phone');
  select m.id into v_member_id from members m where m.phone = v_phone for update;
  if not found then
    insert into members
      (name, phone, address, customer_type, member_since, total_ac_units, notes, active)
    values
      (v_customer ->> 'name', v_phone, coalesce(v_customer ->> 'address', ''),
       'lainnya', now(), v_n_inst, null, true)
    returning id into v_member_id;
  elsif v_n_inst > 0 then
    update members set total_ac_units = total_ac_units + v_n_inst
      where id = v_member_id;
  end if;

  -- ------------------------------------------------------------- voucher
  if v_voucher_code_raw is not null then
    select id, member_id, discount_type, discount_value, max_discount_cap,
           min_purchase, expires_at, status
      into v_voucher_id, v_voucher_member, v_voucher_type, v_voucher_value,
           v_voucher_cap, v_voucher_min, v_voucher_expires, v_voucher_status
      from vouchers
     where code = upper(v_voucher_code_raw)
     for update;
    if not found then
      raise exception 'Kode voucher tidak ditemukan';
    end if;
    if v_voucher_status <> 'aktif' then
      raise exception 'Voucher ini sudah %', v_voucher_status;
    end if;
    if v_voucher_expires < now() then
      raise exception 'Voucher ini sudah kedaluwarsa';
    end if;
    if v_voucher_member <> v_member_id then
      raise exception 'Kode voucher ini bukan milik pelanggan ini';
    end if;
    if v_voucher_min is not null and v_subtotal < v_voucher_min then
      raise exception 'Belanja belum mencapai minimal Rp % untuk voucher ini',
        v_voucher_min;
    end if;
    v_voucher_discount := case v_voucher_type
      when 'nominal' then v_voucher_value
      else least(round(v_subtotal * v_voucher_value / 100.0)::integer,
                 coalesce(v_voucher_cap, v_subtotal))
    end;
  end if;

  -- ------------------------------------------------ hitung total
  v_discount := v_discount + v_voucher_discount;
  if v_discount > v_subtotal then
    raise exception 'Diskon melebihi subtotal';
  end if;
  v_tax_base := v_subtotal - v_discount;
  v_tax_amount := round(v_tax_base * v_tax_percent / 100)::integer;
  v_grand_total := v_tax_base + v_tax_amount + v_transport_fee;

  -- ------------------------------------------------ nomor invoice
  v_date_key := business_date_key();
  v_inv_seq := next_seq('invoice_' || v_date_key);
  v_invoice_number := 'INV-' || v_date_key || '-' || lpad(v_inv_seq::text, 4, '0');

  -- ------------------------------------------------ tulis transaksi
  insert into transactions
    (member_id, customer_name, customer_phone, subtotal, discount, tax_percent,
     tax_amount, transport_fee, grand_total, notes, created_by)
  values
    (v_member_id, v_customer ->> 'name', v_phone, v_subtotal, v_discount,
     v_tax_percent, v_tax_amount, v_transport_fee, v_grand_total, v_notes, v_uid)
  returning id into v_transaction_id;

  insert into invoices
    (number, transaction_id, member_id, customer_name, customer_phone, subtotal,
     discount, tax_percent, tax_amount, transport_fee, grand_total, total_paid,
     status, notes, created_by)
  values
    (v_invoice_number, v_transaction_id, v_member_id, v_customer ->> 'name',
     v_phone, v_subtotal, v_discount, v_tax_percent, v_tax_amount,
     v_transport_fee, v_grand_total, 0, 'belum_dibayar', v_notes, v_uid)
  returning id into v_invoice_id;

  -- Voucher terpakai HANYA setelah invoice lahir, dalam transaksi yang sama —
  -- kalau langkah setelahnya gagal, seluruh transaksi (termasuk ini) rollback.
  if v_voucher_id is not null then
    update vouchers
       set status = 'terpakai', used_at = now(), used_in_transaction_id = v_transaction_id
     where id = v_voucher_id;
  end if;

  for v_idx in 1..v_n_items loop
    insert into transaction_items
      (transaction_id, kind, ref_id, name, unit, qty, unit_price, line_total)
    values
      (v_transaction_id, v_kinds[v_idx]::item_kind, v_ref_ids[v_idx],
       v_names[v_idx], v_units[v_idx], v_qtys[v_idx], v_prices[v_idx],
       v_line_totals[v_idx]);

    insert into invoice_items
      (invoice_id, kind, ref_id, name, unit, qty, unit_price, line_total)
    values
      (v_invoice_id, v_kinds[v_idx]::item_kind, v_ref_ids[v_idx],
       v_names[v_idx], v_units[v_idx], v_qtys[v_idx], v_prices[v_idx],
       v_line_totals[v_idx]);

    if v_kinds[v_idx] in ('product', 'sparepart') then
      insert into stock_movements
        (item_kind, ref_id, name, qty_change, reason, transaction_id, created_by)
      values
        (v_kinds[v_idx]::item_kind, v_ref_ids[v_idx], v_names[v_idx],
         -v_qtys[v_idx], 'penjualan', v_transaction_id, v_uid);

      if v_kinds[v_idx] = 'product' then
        update products set stock = stock - v_qtys[v_idx]::integer
          where id = v_ref_ids[v_idx];
      else
        update spareparts set stock = stock - v_qtys[v_idx]
          where id = v_ref_ids[v_idx];
      end if;
    end if;
  end loop;

  if v_n_inst > 0 then
    insert into service_orders
      (member_id, transaction_id, invoice_id, type, status, created_by)
    values
      (v_member_id, v_transaction_id, v_invoice_id, 'pemasangan', 'terjadwal', v_uid)
    returning id into v_order_id;

    for v_inst in select value from jsonb_array_elements(v_installations)
    loop
      v_idx := (v_inst ->> 'itemIndex')::integer + 1;
      v_room := coalesce(v_inst ->> 'roomLocation', '');
      v_tid := nullif(v_inst ->> 'technicianId', '')::uuid;

      v_unit_seq := next_seq('acunit_' || v_date_key);
      v_barcode := 'ACUNIT-' || v_date_key || '-' || lpad(v_unit_seq::text, 4, '0');

      insert into member_ac_units
        (member_id, brand, model, pk, room_location, barcode_value,
         serial_number, status)
      values
        (v_member_id, v_brands[v_idx], v_types[v_idx], v_pks[v_idx], v_room,
         v_barcode, null, 'menunggu_pemasangan')
      returning id into v_unit_id;

      insert into service_order_units (order_id, unit_id, status)
      values (v_order_id, v_unit_id, 'menunggu_pemasangan');

      insert into technician_jobs
        (order_id, member_id, unit_id, technician_id, type, status,
         scheduled_date, created_by)
      values
        (v_order_id, v_member_id, v_unit_id, v_tid, 'pemasangan',
         case when v_tid is not null then 'assigned' else 'menunggu_penugasan' end,
         null, v_uid);
    end loop;
  end if;

  for v_svc in select value from jsonb_array_elements(v_service_units)
  loop
    v_idx := (v_svc ->> 'itemIndex')::integer + 1;
    v_svc_unit_id := (v_svc ->> 'unitId')::uuid;
    v_tid := nullif(v_svc ->> 'technicianId', '')::uuid;

    select u.member_id into v_svc_unit_member
      from member_ac_units u where u.id = v_svc_unit_id;
    if not found then
      raise exception 'Unit AC tidak ditemukan';
    end if;
    if v_svc_unit_member is distinct from v_member_id then
      raise exception 'Unit AC bukan milik pelanggan transaksi ini';
    end if;

    v_job_type := service_job_type(v_categories[v_idx]);

    v_job_pos := array_position(v_job_types, v_job_type);
    if v_job_pos is null then
      insert into service_orders
        (member_id, transaction_id, invoice_id, type, status, created_by)
      values
        (v_member_id, v_transaction_id, v_invoice_id, v_job_type, 'terjadwal',
         v_uid)
      returning id into v_order_id;
      v_job_types := v_job_types || v_job_type;
      v_job_order_ids := v_job_order_ids || v_order_id;
    else
      v_order_id := v_job_order_ids[v_job_pos];
    end if;

    insert into service_order_units (order_id, unit_id, status)
    values (v_order_id, v_svc_unit_id, 'terjadwal');

    insert into technician_jobs
      (order_id, member_id, unit_id, technician_id, type, status,
       scheduled_date, created_by)
    values
      (v_order_id, v_member_id, v_svc_unit_id, v_tid, v_job_type,
       case when v_tid is not null then 'assigned' else 'menunggu_penugasan' end,
       null, v_uid);
  end loop;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'pos.checkout', v_invoice_id::text,
          jsonb_build_object('number', v_invoice_number,
                             'grand_total', v_grand_total,
                             'installJobs', v_n_inst,
                             'serviceJobs', v_n_svc,
                             'voucherId', v_voucher_id));

  return jsonb_build_object(
    'invoiceId', v_invoice_id,
    'invoiceNumber', v_invoice_number,
    'memberId', v_member_id,
    'transactionId', v_transaction_id
  );
end;
$$;

revoke execute on function checkout_transaction(jsonb) from anon, public;
grant  execute on function checkout_transaction(jsonb) to authenticated;
```

- [x] **Step 2: Terapkan & verifikasi**

```bash
cd backend && npx supabase db reset
```

Buat member + voucher untuknya, pastikan checkout tanpa `voucherCode` masih berfungsi seperti sebelumnya, lalu uji jalur voucher (sukses, expired, sudah terpakai, member tidak cocok, di bawah `min_purchase`):

```sql
-- checkout biasa tanpa voucherCode dulu — harus tetap sukses seperti sebelum migrasi ini
select checkout_transaction('{"customer":{"name":"Tes","phone":"081200000001"},"items":[{"kind":"sparepart","refId":"<id-sparepart>","qty":1}]}'::jsonb);

-- lalu buat voucher untuk member itu dan pakai kodenya
select create_voucher(jsonb_build_object('memberId', (select id from members where phone = '+62812000001'... )));
```

(sesuaikan id sesuai data seed lokal). Verifikasi voucher berubah `terpakai` dan `used_in_transaction_id` terisi setelah checkout sukses; verifikasi kode yang sama dipakai dua kali pada baris kedua melempar `'Voucher ini sudah terpakai'`.

Jalankan juga `flutter test`/regression checkout yang sudah ada di mobile (Task 9) setelah migrasi ini untuk memastikan payload lama (tanpa `voucherCode`) tidak berubah perilaku.

- [x] **Step 3: Commit**

```bash
git add backend/supabase/migrations/20260817000030_checkout_voucher.sql
git commit -m "feat(db): checkout_transaction menerima kode voucher"
```

---

## Task 5: Mobile — model `Voucher`/`Undian` + perluas `WaKind`

**Files:**
- Create: `frontend/mobile/lib/data/models/voucher.dart`
- Create: `frontend/mobile/lib/data/models/undian.dart`
- Modify: `frontend/mobile/lib/data/models/wa_message.dart`
- Modify: `frontend/mobile/lib/features/reminders/wa_outbox_screen.dart`
- Test: `frontend/mobile/test/data/voucher_test.dart`, `test/data/undian_test.dart`
- Modify: `frontend/mobile/test/data/wa_message_test.dart`

**Interfaces:**
- Produces: `Voucher`, `VoucherDiscountType`, `VoucherStatus`, `VoucherSource`, `Undian`, `UndianStatus`, `UndianParticipant`. `WaKind` menambah `menangUndian`/`voucherBaru`.
- Dikonsumsi Task 6 (providers), Task 7 (layar voucher), Task 8 (layar undian).

- [x] **Step 1: Model `Voucher`**

```dart
// frontend/mobile/lib/data/models/voucher.dart
DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

enum VoucherDiscountType {
  persen('persen'),
  nominal('nominal');

  const VoucherDiscountType(this.value);
  final String value;

  static VoucherDiscountType fromValue(Object? value) => values.firstWhere(
        (t) => t.value == value,
        orElse: () => VoucherDiscountType.nominal,
      );
}

enum VoucherStatus {
  aktif('aktif', 'Aktif'),
  terpakai('terpakai', 'Terpakai'),
  kadaluarsa('kadaluarsa', 'Kadaluarsa'),
  dibatalkan('dibatalkan', 'Dibatalkan');

  const VoucherStatus(this.value, this.label);
  final String value;
  final String label;

  static VoucherStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => VoucherStatus.aktif,
      );
}

enum VoucherSource {
  undian('undian'),
  manual('manual');

  const VoucherSource(this.value);
  final String value;

  static VoucherSource fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => VoucherSource.manual,
      );
}

/// Satu voucher (tabel `vouchers`) — terikat ke satu [memberId], ditukar
/// dengan cara diinput admin/kasir sebagai kode saat checkout. Tidak ada
/// langkah "klaim" terpisah dari pemakaiannya.
class Voucher {
  const Voucher({
    required this.id,
    required this.code,
    required this.memberId,
    required this.discountType,
    required this.discountValue,
    this.maxDiscountCap,
    this.minPurchase,
    required this.expiresAt,
    required this.status,
    required this.source,
    this.note,
    this.createdAt,
  });

  final String id;
  final String code;
  final String memberId;
  final VoucherDiscountType discountType;
  final int discountValue;
  final int? maxDiscountCap;
  final int? minPurchase;
  final DateTime expiresAt;
  final VoucherStatus status;
  final VoucherSource source;
  final String? note;
  final DateTime? createdAt;

  /// Deskripsi nilai potongan untuk UI, mis. "10%" / "Rp 200000".
  String get discountLabel => discountType == VoucherDiscountType.persen
      ? '$discountValue%'
      : 'Rp $discountValue';

  factory Voucher.fromMap(String id, Map<String, dynamic> data) => Voucher(
        id: id,
        code: (data['code'] as String?) ?? '',
        memberId: (data['member_id'] as String?) ?? '',
        discountType: VoucherDiscountType.fromValue(data['discount_type']),
        discountValue: (data['discount_value'] as num?)?.toInt() ?? 0,
        maxDiscountCap: (data['max_discount_cap'] as num?)?.toInt(),
        minPurchase: (data['min_purchase'] as num?)?.toInt(),
        expiresAt: _toDate(data['expires_at']) ?? DateTime(2000),
        status: VoucherStatus.fromValue(data['status']),
        source: VoucherSource.fromValue(data['source']),
        note: data['note'] as String?,
        createdAt: _toDate(data['created_at']),
      );
}
```

- [x] **Step 2: Model `Undian`**

```dart
// frontend/mobile/lib/data/models/undian.dart
import 'voucher.dart' show VoucherDiscountType;

DateTime? _toDate(Object? v) => switch (v) {
      String s => DateTime.tryParse(s)?.toLocal(),
      DateTime d => d,
      _ => null,
    };

enum UndianStatus {
  berjalan('berjalan', 'Berjalan'),
  selesai('selesai', 'Selesai'),
  dibatalkan('dibatalkan', 'Dibatalkan');

  const UndianStatus(this.value, this.label);
  final String value;
  final String label;

  static UndianStatus fromValue(Object? value) => values.firstWhere(
        (s) => s.value == value,
        orElse: () => UndianStatus.berjalan,
      );
}

/// Satu undian (tabel `undian`) — hadiahnya SATU macam diskon untuk semua
/// pemenang, ditentukan saat undian dibuat (bukan per-pemenang).
class Undian {
  const Undian({
    required this.id,
    required this.title,
    this.description,
    required this.winnerCount,
    required this.discountType,
    required this.discountValue,
    this.maxDiscountCap,
    this.minPurchase,
    required this.voucherValidDays,
    required this.status,
    this.drawnAt,
    this.createdAt,
  });

  final String id;
  final String title;
  final String? description;
  final int winnerCount;
  final VoucherDiscountType discountType;
  final int discountValue;
  final int? maxDiscountCap;
  final int? minPurchase;
  final int voucherValidDays;
  final UndianStatus status;
  final DateTime? drawnAt;
  final DateTime? createdAt;

  String get discountLabel => discountType == VoucherDiscountType.persen
      ? '$discountValue%'
      : 'Rp $discountValue';

  factory Undian.fromMap(String id, Map<String, dynamic> data) => Undian(
        id: id,
        title: (data['title'] as String?) ?? '',
        description: data['description'] as String?,
        winnerCount: (data['winner_count'] as num?)?.toInt() ?? 0,
        discountType: VoucherDiscountType.fromValue(data['discount_type']),
        discountValue: (data['discount_value'] as num?)?.toInt() ?? 0,
        maxDiscountCap: (data['max_discount_cap'] as num?)?.toInt(),
        minPurchase: (data['min_purchase'] as num?)?.toInt(),
        voucherValidDays: (data['voucher_valid_days'] as num?)?.toInt() ?? 0,
        status: UndianStatus.fromValue(data['status']),
        drawnAt: _toDate(data['drawn_at']),
        createdAt: _toDate(data['created_at']),
      );
}

/// Satu peserta undian (tabel `undian_participants`).
class UndianParticipant {
  const UndianParticipant({
    required this.id,
    required this.undianId,
    required this.memberId,
    required this.source,
  });

  final String id;
  final String undianId;
  final String memberId;
  final String source; // 'otomatis' | 'manual'

  factory UndianParticipant.fromMap(String id, Map<String, dynamic> data) =>
      UndianParticipant(
        id: id,
        undianId: (data['undian_id'] as String?) ?? '',
        memberId: (data['member_id'] as String?) ?? '',
        source: (data['source'] as String?) ?? 'manual',
      );
}
```

- [x] **Step 3: Perluas `WaKind`**

Di `wa_message.dart`, tambah 2 nilai ke enum `WaKind` (setelah `reminderH7`):

```dart
  menangUndian('menang_undian', 'Menang Undian'),
  voucherBaru('voucher_baru', 'Voucher Baru');
```

(ganti `;` di akhir `reminderH7(...)` jadi `,` karena bukan anggota terakhir lagi).

- [x] **Step 4: Perbaiki switch yang jadi tidak exhaustive**

Di `wa_outbox_screen.dart`, `waKindTone` harus menangani 2 kind baru (Dart menolak compile kalau switch atas enum tidak lengkap):

```dart
AppBadgeTone waKindTone(WaKind kind) => switch (kind) {
      WaKind.selesaiServis => AppBadgeTone.success,
      WaKind.reminderH3 => AppBadgeTone.pending,
      WaKind.reminderH7 => AppBadgeTone.danger,
      WaKind.menangUndian => AppBadgeTone.success,
      WaKind.voucherBaru => AppBadgeTone.success,
    };
```

- [x] **Step 5: Update test yang sudah ada**

Di `wa_message_test.dart`, grup `'semua jenis pesan dikenali'`, tambah 2 assertion:

```dart
      expect(WaMessage.fromMap('w', _row(kind: 'menang_undian')).kind,
          WaKind.menangUndian);
      expect(WaMessage.fromMap('w', _row(kind: 'voucher_baru')).kind,
          WaKind.voucherBaru);
```

- [x] **Step 6: Test model baru**

```dart
// frontend/mobile/test/data/voucher_test.dart
import 'package:epos_ac/data/models/voucher.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _row({
  String discountType = 'nominal',
  Object? discountValue = 50000,
  Object? maxCap,
  Object? minPurchase,
  String status = 'aktif',
  String source = 'manual',
}) =>
    {
      'code': 'VCR-ABC123',
      'member_id': 'm1',
      'discount_type': discountType,
      'discount_value': discountValue,
      'max_discount_cap': maxCap,
      'min_purchase': minPurchase,
      'expires_at': '2026-09-30',
      'status': status,
      'source': source,
      'note': null,
      'created_at': '2026-08-17T02:00:00Z',
    };

void main() {
  group('Voucher.fromMap', () {
    test('memetakan kolom apa adanya', () {
      final v = Voucher.fromMap('v1', _row());
      expect(v.id, 'v1');
      expect(v.code, 'VCR-ABC123');
      expect(v.discountType, VoucherDiscountType.nominal);
      expect(v.discountValue, 50000);
      expect(v.status, VoucherStatus.aktif);
      expect(v.source, VoucherSource.manual);
    });

    test('semua status dikenali', () {
      for (final s in VoucherStatus.values) {
        expect(Voucher.fromMap('v', _row(status: s.value)).status, s);
      }
    });

    test('discountLabel persen vs nominal', () {
      final nominal = Voucher.fromMap('v', _row());
      expect(nominal.discountLabel, 'Rp 50000');
      final persen =
          Voucher.fromMap('v', _row(discountType: 'persen', discountValue: 10));
      expect(persen.discountLabel, '10%');
    });
  });
}
```

```dart
// frontend/mobile/test/data/undian_test.dart
import 'package:epos_ac/data/models/undian.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _row({String status = 'berjalan'}) => {
      'title': 'Undian Agustus',
      'description': null,
      'winner_count': 3,
      'discount_type': 'persen',
      'discount_value': 15,
      'max_discount_cap': 200000,
      'min_purchase': null,
      'voucher_valid_days': 30,
      'status': status,
      'drawn_at': null,
      'created_at': '2026-08-17T02:00:00Z',
    };

void main() {
  group('Undian.fromMap', () {
    test('memetakan kolom apa adanya', () {
      final u = Undian.fromMap('u1', _row());
      expect(u.title, 'Undian Agustus');
      expect(u.winnerCount, 3);
      expect(u.discountLabel, '15%');
    });

    test('semua status dikenali', () {
      for (final s in UndianStatus.values) {
        expect(Undian.fromMap('u', _row(status: s.value)).status, s);
      }
    });
  });

  group('UndianParticipant.fromMap', () {
    test('memetakan kolom apa adanya', () {
      final p = UndianParticipant.fromMap('p1', {
        'undian_id': 'u1',
        'member_id': 'm1',
        'source': 'manual',
      });
      expect(p.undianId, 'u1');
      expect(p.memberId, 'm1');
      expect(p.source, 'manual');
    });
  });
}
```

- [x] **Step 7: Jalankan test**

```bash
cd frontend/mobile && flutter analyze && flutter test test/data/voucher_test.dart test/data/undian_test.dart test/data/wa_message_test.dart
```

Expected: semua PASS, `flutter analyze` tanpa error (terutama exhaustiveness `waKindTone`).

- [x] **Step 8: Commit**

```bash
git add frontend/mobile/lib/data/models/voucher.dart frontend/mobile/lib/data/models/undian.dart frontend/mobile/lib/data/models/wa_message.dart frontend/mobile/lib/features/reminders/wa_outbox_screen.dart frontend/mobile/test/data/voucher_test.dart frontend/mobile/test/data/undian_test.dart frontend/mobile/test/data/wa_message_test.dart
git commit -m "feat(app): model Voucher/Undian + perluas WaKind"
```

---

## Task 6: Mobile — providers voucher & undian

**Files:**
- Create: `frontend/mobile/lib/features/vouchers/voucher_providers.dart`
- Create: `frontend/mobile/lib/features/undian/undian_providers.dart`

**Interfaces:**
- Consumes: `supabaseProvider` (`core/supabase/supabase_providers.dart`), `Voucher`/`Undian`/`UndianParticipant` (Task 5).
- Produces: `vouchersStreamProvider`, `createVoucherCallerProvider`, `cancelVoucherCallerProvider`, `undianListProvider`, `undianParticipantsProvider`, `createUndianCallerProvider`, `updateUndianParticipantsCallerProvider`, `drawUndianCallerProvider`, `cancelUndianCallerProvider`.
- Dikonsumsi Task 7 (layar voucher), Task 8 (layar undian).

- [x] **Step 1: `voucher_providers.dart`**

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../data/models/voucher.dart';

/// Semua voucher, terbaru dulu. RLS admin/kasir; teknisi dapat daftar kosong.
final vouchersStreamProvider = StreamProvider.autoDispose<List<Voucher>>((ref) {
  final client = ref.watch(supabaseProvider);
  return client
      .from('vouchers')
      .stream(primaryKey: ['id'])
      .order('created_at')
      .map((rows) {
        final list = [
          for (final r in rows) Voucher.fromMap(r['id'] as String, Map.from(r)),
        ];
        list.sort((a, b) =>
            (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
        return list;
      });
});

/// RPC `create_voucher` (admin). Mengembalikan kode voucher yang dibuat.
final createVoucherCallerProvider =
    Provider<Future<String> Function(Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final result = await ref
        .read(supabaseProvider)
        .rpc('create_voucher', params: {'payload': payload});
    return (result as Map)['code'] as String? ?? '';
  };
});

/// RPC `cancel_voucher` (admin).
final cancelVoucherCallerProvider =
    Provider<Future<void> Function(String voucherId, {String? reason})>((ref) {
  return (voucherId, {reason}) async {
    await ref.read(supabaseProvider).rpc('cancel_voucher', params: {
      'payload': {'voucherId': voucherId, if (reason != null) 'reason': reason},
    });
  };
});
```

- [x] **Step 2: `undian_providers.dart`**

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/supabase/supabase_providers.dart';
import '../../data/models/undian.dart';

/// Semua undian, terbaru dulu. RLS admin saja.
final undianListProvider = StreamProvider.autoDispose<List<Undian>>((ref) {
  final client = ref.watch(supabaseProvider);
  return client
      .from('undian')
      .stream(primaryKey: ['id'])
      .order('created_at')
      .map((rows) {
        final list = [
          for (final r in rows) Undian.fromMap(r['id'] as String, Map.from(r)),
        ];
        list.sort((a, b) =>
            (b.createdAt ?? DateTime(0)).compareTo(a.createdAt ?? DateTime(0)));
        return list;
      });
});

/// Peserta satu undian tertentu.
final undianParticipantsProvider = StreamProvider.autoDispose
    .family<List<UndianParticipant>, String>((ref, undianId) {
  final client = ref.watch(supabaseProvider);
  return client
      .from('undian_participants')
      .stream(primaryKey: ['id'])
      .eq('undian_id', undianId)
      .map((rows) => [
            for (final r in rows)
              UndianParticipant.fromMap(r['id'] as String, Map.from(r)),
          ]);
});

/// RPC `create_undian` (admin).
final createUndianCallerProvider = Provider<
    Future<({String undianId, int participantCount})> Function(
        Map<String, dynamic> payload)>((ref) {
  return (payload) async {
    final result = await ref
        .read(supabaseProvider)
        .rpc('create_undian', params: {'payload': payload});
    final data = result as Map;
    return (
      undianId: (data['undianId'] as String?) ?? '',
      participantCount: (data['participantCount'] as num?)?.toInt() ?? 0,
    );
  };
});

/// RPC `update_undian_participants` (admin).
final updateUndianParticipantsCallerProvider = Provider<
    Future<void> Function(String undianId,
        {List<String> add, List<String> remove})>((ref) {
  return (undianId, {add = const [], remove = const []}) async {
    await ref.read(supabaseProvider).rpc('update_undian_participants', params: {
      'payload': {
        'undianId': undianId,
        if (add.isNotEmpty) 'add': add,
        if (remove.isNotEmpty) 'remove': remove,
      },
    });
  };
});

/// RPC `draw_undian` (admin). Mengembalikan jumlah pemenang.
final drawUndianCallerProvider =
    Provider<Future<int> Function(String undianId)>((ref) {
  return (undianId) async {
    final result = await ref.read(supabaseProvider).rpc('draw_undian', params: {
      'payload': {'undianId': undianId},
    });
    return ((result as Map)['winnerCount'] as num?)?.toInt() ?? 0;
  };
});

/// RPC `cancel_undian` (admin).
final cancelUndianCallerProvider =
    Provider<Future<void> Function(String undianId)>((ref) {
  return (undianId) async {
    await ref.read(supabaseProvider).rpc('cancel_undian', params: {
      'payload': {'undianId': undianId},
    });
  };
});
```

- [x] **Step 3: Verifikasi**

```bash
cd frontend/mobile && flutter analyze
```

Expected: tanpa error (providers ini tidak punya widget test tersendiri — dilatih tidak langsung lewat widget test layar di Task 7/8).

- [x] **Step 4: Commit**

```bash
git add frontend/mobile/lib/features/vouchers/voucher_providers.dart frontend/mobile/lib/features/undian/undian_providers.dart
git commit -m "feat(app): providers voucher & undian"
```

---

## Task 7: Mobile — layar Voucher (`/voucher`) + rute/menu

**Files:**
- Create: `frontend/mobile/lib/features/vouchers/voucher_list_screen.dart`
- Create: `frontend/mobile/lib/features/vouchers/voucher_form_screen.dart`
- Modify: `frontend/mobile/lib/core/router/app_router.dart`
- Modify: `frontend/mobile/lib/core/router/redirect.dart`
- Modify: `frontend/mobile/lib/core/widgets/adaptive_scaffold.dart`
- Test: `frontend/mobile/test/features/vouchers/voucher_list_screen_test.dart`

**Interfaces:**
- Consumes: `vouchersStreamProvider`/`createVoucherCallerProvider`/`cancelVoucherCallerProvider` (Task 6), `waMemberNamesProvider` (reuse dari `reminder_providers.dart`), `MemberPickerSheet` (reuse dari `features/pos/member_picker_sheet.dart`), `AppFormScaffold`/`AppFormCard`/`AppSelectField`/`AppTextField` (widget yang sudah ada).

- [x] **Step 1: `voucher_list_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/app_user.dart';
import '../../data/models/voucher.dart';
import '../reminders/reminder_providers.dart' show waMemberNamesProvider;
import 'voucher_providers.dart';

AppBadgeTone voucherStatusTone(VoucherStatus s) => switch (s) {
      VoucherStatus.aktif => AppBadgeTone.success,
      VoucherStatus.terpakai => AppBadgeTone.draft,
      VoucherStatus.kadaluarsa => AppBadgeTone.danger,
      VoucherStatus.dibatalkan => AppBadgeTone.danger,
    };

/// Daftar semua voucher (undian + ad-hoc). Admin membuat baru & membatalkan
/// yang masih aktif; kasir hanya melihat — pemakaian sesungguhnya lewat field
/// kode voucher di layar Checkout, bukan aksi di sini.
class VoucherListScreen extends ConsumerWidget {
  const VoucherListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(vouchersStreamProvider);
    final names = ref.watch(waMemberNamesProvider);
    final isAdmin = ref.watch(currentUserProvider).value?.role == UserRole.admin;

    return Scaffold(
      appBar: AppBar(title: const Text('Voucher')),
      floatingActionButton: isAdmin
          ? FloatingActionButton.extended(
              key: const Key('buat-voucher'),
              onPressed: () => context.go('/voucher/baru'),
              icon: const Icon(Icons.add),
              label: const Text('Buat Voucher'),
            )
          : null,
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat voucher'),
        data: (items) {
          if (items.isEmpty) {
            return const AppEmptyState(
              icon: Icons.confirmation_number_outlined,
              title: 'Belum ada voucher',
              message: 'Voucher muncul di sini setelah dibuat manual atau '
                  'setelah undian ditarik.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (_, i) => _VoucherCard(
              voucher: items[i],
              memberName: names[items[i].memberId] ?? 'Pelanggan',
              isAdmin: isAdmin,
            ),
          );
        },
      ),
    );
  }
}

class _VoucherCard extends ConsumerStatefulWidget {
  const _VoucherCard({
    required this.voucher,
    required this.memberName,
    required this.isAdmin,
  });

  final Voucher voucher;
  final String memberName;
  final bool isAdmin;

  @override
  ConsumerState<_VoucherCard> createState() => _VoucherCardState();
}

class _VoucherCardState extends ConsumerState<_VoucherCard> {
  bool _busy = false;

  Future<void> _batalkan() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Batalkan voucher?'),
        content: Text('Kode ${widget.voucher.code} tidak akan bisa dipakai lagi.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Tidak'),
          ),
          FilledButton(
            key: const Key('konfirmasi-batal'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Batalkan'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(cancelVoucherCallerProvider)(widget.voucher.id);
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(content: Text('Voucher dibatalkan.')));
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content: Text('Gagal membatalkan: ${errorMessage(e)}'),
        backgroundColor: AppColors.danger,
      ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.voucher;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(v.code,
                        style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                            color: AppColors.slate900)),
                    Text(widget.memberName,
                        style: const TextStyle(
                            color: AppColors.textMuted, fontSize: 13)),
                  ],
                ),
              ),
              StatusBadge.tone(voucherStatusTone(v.status), label: v.status.label),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${v.discountLabel} • berlaku sampai ${formatTanggalPanjang(v.expiresAt)}',
            style: const TextStyle(color: AppColors.textBody, fontSize: 13),
          ),
          if (widget.isAdmin && v.status == VoucherStatus.aktif) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                key: Key('batal-${v.id}'),
                onPressed: _busy ? null : _batalkan,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.danger,
                  side: const BorderSide(color: AppColors.dangerBorder),
                ),
                child: const Text('Batalkan'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
```

- [x] **Step 2: `voucher_form_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';
import '../../data/models/member.dart';
import '../../data/models/voucher.dart';
import '../pos/member_picker_sheet.dart';
import 'voucher_providers.dart';

/// Form buat voucher ad-hoc (admin): pilih pelanggan, tipe+nilai diskon,
/// syarat opsional (cap, min pembelian), tanggal kedaluwarsa, catatan. WA
/// berisi kode langsung antre di `wa_outbox` — pengirimannya lewat layar
/// Pengingat yang sudah ada, bukan di sini.
class VoucherFormScreen extends ConsumerStatefulWidget {
  const VoucherFormScreen({super.key});

  @override
  ConsumerState<VoucherFormScreen> createState() => _VoucherFormScreenState();
}

class _VoucherFormScreenState extends ConsumerState<VoucherFormScreen> {
  final _formKey = GlobalKey<FormState>();
  Member? _member;
  VoucherDiscountType _type = VoucherDiscountType.nominal;
  final _value = TextEditingController();
  final _cap = TextEditingController();
  final _minPurchase = TextEditingController();
  final _note = TextEditingController();
  DateTime? _expiresAt;
  bool _busy = false;

  @override
  void dispose() {
    _value.dispose();
    _cap.dispose();
    _minPurchase.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickMember() async {
    final picked = await showModalBottomSheet<Member>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const MemberPickerSheet(),
    );
    if (picked != null && mounted) setState(() => _member = picked);
  }

  Future<void> _pickExpiry() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiresAt ?? now.add(const Duration(days: 30)),
      firstDate: now,
      lastDate: DateTime(now.year + 2),
    );
    if (picked != null) setState(() => _expiresAt = picked);
  }

  String? _requiredNumber(String? v) {
    final n = int.tryParse((v ?? '').trim());
    if (n == null || n <= 0) return 'Wajib diisi, harus lebih dari 0';
    if (_type == VoucherDiscountType.persen && n > 100) return 'Maksimal 100';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_member == null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Pilih pelanggan dulu')));
      return;
    }
    if (_expiresAt == null) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Pilih tanggal kedaluwarsa')));
      return;
    }
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final code = await ref.read(createVoucherCallerProvider)({
        'memberId': _member!.id,
        'discountType': _type.value,
        'discountValue': int.parse(_value.text.trim()),
        if (_type == VoucherDiscountType.persen && _cap.text.trim().isNotEmpty)
          'maxDiscountCap': int.parse(_cap.text.trim()),
        if (_minPurchase.text.trim().isNotEmpty)
          'minPurchase': int.parse(_minPurchase.text.trim()),
        'expiresAt': _expiresAt!.toIso8601String().split('T').first,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text('Voucher dibuat: $code')));
      context.go('/voucher');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(
        content: Text('Gagal membuat voucher: ${errorMessage(e)}'),
        backgroundColor: AppColors.danger,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppFormScaffold(
      title: 'Buat Voucher',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Buat Voucher',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Pelanggan',
          children: [
            OutlinedButton.icon(
              key: const Key('pilih-member'),
              onPressed: _busy ? null : _pickMember,
              icon: const Icon(Icons.person_outline),
              label: Text(_member == null ? 'Pilih pelanggan' : _member!.name),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Diskon',
          children: [
            AppSelectField<VoucherDiscountType>(
              key: const Key('discountType'),
              label: 'Tipe',
              required: true,
              value: _type,
              enabled: !_busy,
              items: const [
                DropdownMenuItem(
                    value: VoucherDiscountType.nominal,
                    child: Text('Nominal (Rp)')),
                DropdownMenuItem(
                    value: VoucherDiscountType.persen, child: Text('Persen (%)')),
              ],
              onChanged: (v) => setState(() => _type = v ?? _type),
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('discountValue'),
              label: _type == VoucherDiscountType.persen ? 'Nilai (%)' : 'Nilai (Rp)',
              required: true,
              controller: _value,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              validator: _requiredNumber,
            ),
            if (_type == VoucherDiscountType.persen) ...[
              const SizedBox(height: kFieldGap),
              AppTextField(
                key: const Key('maxDiscountCap'),
                label: 'Maks potongan (Rp, opsional)',
                controller: _cap,
                enabled: !_busy,
                keyboardType: TextInputType.number,
              ),
            ],
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('minPurchase'),
              label: 'Minimal pembelian (Rp, opsional)',
              controller: _minPurchase,
              enabled: !_busy,
              keyboardType: TextInputType.number,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Syarat & Ketentuan',
          children: [
            OutlinedButton.icon(
              key: const Key('pilih-expiry'),
              onPressed: _busy ? null : _pickExpiry,
              icon: const Icon(Icons.event_outlined),
              label: Text(_expiresAt == null
                  ? 'Pilih tanggal kedaluwarsa'
                  : 'Berlaku sampai ${formatTanggalPanjang(_expiresAt!)}'),
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('note'),
              label: 'Catatan (opsional)',
              hint: 'Alasan pemberian / syarat tambahan',
              maxLines: 3,
              controller: _note,
              enabled: !_busy,
            ),
          ],
        ),
      ],
    );
  }
}
```

- [x] **Step 3: Rute**

Di `app_router.dart`, tambah import untuk `VoucherListScreen`/`VoucherFormScreen`, lalu di dalam route tree (sejajar dengan blok `/pengingat`):

```dart
          GoRoute(
            path: '/voucher',
            builder: (_, __) => const VoucherListScreen(),
            routes: [
              GoRoute(
                path: 'baru',
                builder: (_, __) => const VoucherFormScreen(),
              ),
            ],
          ),
```

- [x] **Step 4: Menu & guard**

Di `adaptive_scaffold.dart`, tambah destinasi (admin only — sejajar deklarasi `pengingat`):

```dart
  const voucher = (
    icon: Icons.confirmation_number_outlined,
    label: 'Voucher',
    route: '/voucher',
  );
```

masukkan `voucher,` ke daftar `role == UserRole.admin` (sejajar `pengingat`).

Di `redirect.dart`, tambah `'/voucher'` ke `_adminOnlyPrefixes` (kasir hanya menukar kode lewat Checkout, bukan lewat layar ini).

- [x] **Step 5: Widget test**

```dart
// frontend/mobile/test/features/vouchers/voucher_list_screen_test.dart
import 'package:epos_ac/data/models/voucher.dart';
import 'package:epos_ac/features/vouchers/voucher_list_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('voucherStatusTone', () {
    test('setiap status punya nada', () {
      for (final s in VoucherStatus.values) {
        expect(() => voucherStatusTone(s), returnsNormally);
      }
    });
  });
}
```

(Widget test penuh dengan `ProviderScope` override butuh fake Supabase stream — di luar cakupan plan ini; test ini cukup memastikan fungsi murni `voucherStatusTone` exhaustive dan tidak melempar.)

- [x] **Step 6: Jalankan**

```bash
cd frontend/mobile && flutter analyze && flutter test test/features/vouchers/voucher_list_screen_test.dart
```

- [x] **Step 7: Commit**

```bash
git add frontend/mobile/lib/features/vouchers frontend/mobile/lib/core/router/app_router.dart frontend/mobile/lib/core/router/redirect.dart frontend/mobile/lib/core/widgets/adaptive_scaffold.dart frontend/mobile/test/features/vouchers
git commit -m "feat(app): layar Voucher + rute/menu"
```

---

## Task 8: Mobile — layar Undian (`/undian`) + rute/menu

**Files:**
- Create: `frontend/mobile/lib/features/undian/undian_list_screen.dart`
- Create: `frontend/mobile/lib/features/undian/undian_form_screen.dart`
- Create: `frontend/mobile/lib/features/undian/undian_detail_screen.dart`
- Modify: `frontend/mobile/lib/core/router/app_router.dart`
- Modify: `frontend/mobile/lib/core/router/redirect.dart`
- Modify: `frontend/mobile/lib/core/widgets/adaptive_scaffold.dart`
- Test: `frontend/mobile/test/features/undian/undian_list_screen_test.dart`

**Interfaces:**
- Consumes: `undianListProvider`/`undianParticipantsProvider`/`createUndianCallerProvider`/`updateUndianParticipantsCallerProvider`/`drawUndianCallerProvider`/`cancelUndianCallerProvider` (Task 6), `MemberPickerSheet`, `waMemberNamesProvider`.

- [x] **Step 1: `undian_list_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/undian.dart';
import 'undian_providers.dart';

AppBadgeTone undianStatusTone(UndianStatus s) => switch (s) {
      UndianStatus.berjalan => AppBadgeTone.pending,
      UndianStatus.selesai => AppBadgeTone.success,
      UndianStatus.dibatalkan => AppBadgeTone.danger,
    };

/// Daftar undian (admin only — dijaga `redirect.dart`).
class UndianListScreen extends ConsumerWidget {
  const UndianListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(undianListProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Undian')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('buat-undian'),
        onPressed: () => context.go('/undian/baru'),
        icon: const Icon(Icons.add),
        label: const Text('Buat Undian'),
      ),
      body: async.when(
        loading: () => const AppSkeletonList(),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat undian'),
        data: (items) {
          if (items.isEmpty) {
            return const AppEmptyState(
              icon: Icons.card_giftcard_outlined,
              title: 'Belum ada undian',
              message: 'Buat undian untuk mulai mengumpulkan peserta.',
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (_, i) {
              final u = items[i];
              return AppCard(
                child: InkWell(
                  key: Key('undian-${u.id}'),
                  onTap: () => context.go('/undian/${u.id}'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(u.title,
                                style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 15,
                                    color: AppColors.slate900)),
                          ),
                          StatusBadge.tone(undianStatusTone(u.status),
                              label: u.status.label),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Hadiah ${u.discountLabel} • ${u.winnerCount} pemenang',
                        style: const TextStyle(
                            color: AppColors.textBody, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
```

- [x] **Step 2: `undian_form_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/utils/tanggal.dart';
import '../../core/widgets/form_field.dart';
import '../../core/widgets/form_scaffold.dart';
import '../../data/models/voucher.dart' show VoucherDiscountType;
import 'undian_providers.dart';

/// Form buat undian (admin): kriteria peserta otomatis + hadiah (satu macam
/// diskon untuk semua pemenang). Peserta manual & penarikan dilakukan di
/// layar detail setelah undian ini dibuat.
class UndianFormScreen extends ConsumerStatefulWidget {
  const UndianFormScreen({super.key});

  @override
  ConsumerState<UndianFormScreen> createState() => _UndianFormScreenState();
}

class _UndianFormScreenState extends ConsumerState<UndianFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _winnerCount = TextEditingController(text: '1');
  VoucherDiscountType _type = VoucherDiscountType.nominal;
  final _value = TextEditingController();
  final _cap = TextEditingController();
  final _minPurchase = TextEditingController();
  final _validDays = TextEditingController(text: '30');
  DateTime? _dateFrom;
  DateTime? _dateTo;
  bool _mustHaveAc = false;
  bool _busy = false;

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _winnerCount.dispose();
    _value.dispose();
    _cap.dispose();
    _minPurchase.dispose();
    _validDays.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: (isFrom ? _dateFrom : _dateTo) ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (picked == null) return;
    setState(() => isFrom ? _dateFrom = picked : _dateTo = picked);
  }

  String? _requiredPositiveInt(String? v) {
    final n = int.tryParse((v ?? '').trim());
    return (n == null || n <= 0) ? 'Wajib diisi, lebih dari 0' : null;
  }

  String? _discountValueValidator(String? v) {
    final err = _requiredPositiveInt(v);
    if (err != null) return err;
    final n = int.parse(v!.trim());
    if (_type == VoucherDiscountType.persen && n > 100) return 'Maksimal 100';
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final criteria = <String, dynamic>{
        if (_dateFrom != null)
          'dateFrom': _dateFrom!.toIso8601String().split('T').first,
        if (_dateTo != null) 'dateTo': _dateTo!.toIso8601String().split('T').first,
        'mustHaveAcPurchase': _mustHaveAc,
      };
      final result = await ref.read(createUndianCallerProvider)({
        'title': _title.text.trim(),
        if (_description.text.trim().isNotEmpty)
          'description': _description.text.trim(),
        'criteria': criteria,
        'winnerCount': int.parse(_winnerCount.text.trim()),
        'discountType': _type.value,
        'discountValue': int.parse(_value.text.trim()),
        if (_type == VoucherDiscountType.persen && _cap.text.trim().isNotEmpty)
          'maxDiscountCap': int.parse(_cap.text.trim()),
        if (_minPurchase.text.trim().isNotEmpty)
          'minPurchase': int.parse(_minPurchase.text.trim()),
        'voucherValidDays': int.parse(_validDays.text.trim()),
      });
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(
        content:
            Text('Undian dibuat, ${result.participantCount} peserta terkumpul.'),
      ));
      context.go('/undian/${result.undianId}');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(
        content: Text('Gagal membuat undian: ${errorMessage(e)}'),
        backgroundColor: AppColors.danger,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppFormScaffold(
      title: 'Buat Undian',
      formKey: _formKey,
      busy: _busy,
      submitLabel: 'Buat Undian',
      submitKey: const Key('submit'),
      onSubmit: _submit,
      children: [
        AppFormCard(
          title: 'Info Undian',
          children: [
            AppTextField(
              key: const Key('title'),
              label: 'Judul',
              required: true,
              controller: _title,
              enabled: !_busy,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Wajib diisi' : null,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('description'),
              label: 'Deskripsi (opsional)',
              maxLines: 2,
              controller: _description,
              enabled: !_busy,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('winnerCount'),
              label: 'Jumlah pemenang',
              required: true,
              controller: _winnerCount,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              validator: _requiredPositiveInt,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Kriteria Peserta Otomatis',
          subtitle: 'Kosongkan tanggal untuk mengikutkan semua member aktif. '
              'Peserta tambahan/manual bisa diatur setelah undian dibuat.',
          children: [
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _pickDate(isFrom: true),
                    icon: const Icon(Icons.event_outlined),
                    label: Text(_dateFrom == null
                        ? 'Dari tanggal'
                        : formatTanggalPanjang(_dateFrom!)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : () => _pickDate(isFrom: false),
                    icon: const Icon(Icons.event_outlined),
                    label: Text(_dateTo == null
                        ? 'Sampai tanggal'
                        : formatTanggalPanjang(_dateTo!)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: kFieldGap),
            SwitchListTile(
              key: const Key('mustHaveAc'),
              contentPadding: EdgeInsets.zero,
              title: const Text('Harus pernah beli AC baru'),
              value: _mustHaveAc,
              onChanged: _busy ? null : (v) => setState(() => _mustHaveAc = v),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.grid),
        AppFormCard(
          title: 'Hadiah',
          subtitle: 'Satu macam diskon untuk semua pemenang.',
          children: [
            AppSelectField<VoucherDiscountType>(
              key: const Key('discountType'),
              label: 'Tipe',
              required: true,
              value: _type,
              enabled: !_busy,
              items: const [
                DropdownMenuItem(
                    value: VoucherDiscountType.nominal,
                    child: Text('Nominal (Rp)')),
                DropdownMenuItem(
                    value: VoucherDiscountType.persen, child: Text('Persen (%)')),
              ],
              onChanged: (v) => setState(() => _type = v ?? _type),
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('discountValue'),
              label: _type == VoucherDiscountType.persen ? 'Nilai (%)' : 'Nilai (Rp)',
              required: true,
              controller: _value,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              validator: _discountValueValidator,
            ),
            if (_type == VoucherDiscountType.persen) ...[
              const SizedBox(height: kFieldGap),
              AppTextField(
                key: const Key('maxDiscountCap'),
                label: 'Maks potongan (Rp, opsional)',
                controller: _cap,
                enabled: !_busy,
                keyboardType: TextInputType.number,
              ),
            ],
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('minPurchase'),
              label: 'Minimal pembelian (Rp, opsional)',
              controller: _minPurchase,
              enabled: !_busy,
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: kFieldGap),
            AppTextField(
              key: const Key('validDays'),
              label: 'Masa berlaku voucher pemenang (hari)',
              required: true,
              controller: _validDays,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              validator: _requiredPositiveInt,
            ),
          ],
        ),
      ],
    );
  }
}
```

- [x] **Step 3: `undian_detail_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/error_message.dart';
import '../../core/widgets/app_card.dart';
import '../../core/widgets/app_skeleton.dart';
import '../../core/widgets/empty_state.dart';
import '../../core/widgets/status_badge.dart';
import '../../data/models/member.dart';
import '../../data/models/undian.dart';
import '../pos/member_picker_sheet.dart';
import '../reminders/reminder_providers.dart' show waMemberNamesProvider;
import 'undian_list_screen.dart' show undianStatusTone;
import 'undian_providers.dart';

/// Detail satu undian: peserta (tambah/hapus manual selama `berjalan`),
/// tombol Tarik Undian, tombol Batalkan.
class UndianDetailScreen extends ConsumerStatefulWidget {
  const UndianDetailScreen({super.key, required this.undianId});

  final String undianId;

  @override
  ConsumerState<UndianDetailScreen> createState() => _UndianDetailScreenState();
}

class _UndianDetailScreenState extends ConsumerState<UndianDetailScreen> {
  bool _busy = false;

  void _snack(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(text),
      backgroundColor: error ? AppColors.danger : null,
    ));
  }

  Future<void> _addParticipant() async {
    final picked = await showModalBottomSheet<Member>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const MemberPickerSheet(),
    );
    if (picked == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(updateUndianParticipantsCallerProvider)(
          widget.undianId,
          add: [picked.id]);
      if (!mounted) return;
      _snack('${picked.name} ditambahkan.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal menambah peserta: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeParticipant(String memberId, String name) async {
    setState(() => _busy = true);
    try {
      await ref.read(updateUndianParticipantsCallerProvider)(
          widget.undianId,
          remove: [memberId]);
      if (!mounted) return;
      _snack('$name dihapus dari peserta.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal menghapus peserta: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _draw() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Tarik undian?'),
        content: const Text(
          'Pemenang dipilih acak dan tidak bisa diulang. Kode voucher langsung '
          'dibuat dan antre dikirim lewat WhatsApp di layar Pengingat.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            key: const Key('konfirmasi-tarik'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Tarik Sekarang'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final winnerCount = await ref.read(drawUndianCallerProvider)(widget.undianId);
      if (!mounted) return;
      _snack('$winnerCount pemenang terpilih.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal menarik undian: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Batalkan undian?'),
        content: const Text('Undian ini tidak akan bisa ditarik.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Tidak'),
          ),
          FilledButton(
            key: const Key('konfirmasi-batal'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Batalkan'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(cancelUndianCallerProvider)(widget.undianId);
      if (!mounted) return;
      _snack('Undian dibatalkan.');
    } catch (e) {
      if (!mounted) return;
      _snack('Gagal membatalkan: ${errorMessage(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final undianAsync = ref.watch(undianListProvider);
    final participantsAsync =
        ref.watch(undianParticipantsProvider(widget.undianId));
    final names = ref.watch(waMemberNamesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Detail Undian')),
      body: undianAsync.when(
        loading: () => const AppSkeletonDetail(blocks: 2),
        error: (e, _) => AppErrorState(error: e, title: 'Gagal memuat undian'),
        data: (list) {
          Undian? undian;
          for (final u in list) {
            if (u.id == widget.undianId) {
              undian = u;
              break;
            }
          }
          if (undian == null) {
            return const AppEmptyState(
              icon: Icons.card_giftcard_outlined,
              title: 'Undian tidak ditemukan',
            );
          }
          final berjalan = undian.status == UndianStatus.berjalan;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(undian.title,
                              style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 17,
                                  color: AppColors.slate900)),
                        ),
                        StatusBadge.tone(undianStatusTone(undian.status),
                            label: undian.status.label),
                      ],
                    ),
                    if (undian.description != null &&
                        undian.description!.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(undian.description!,
                          style: const TextStyle(color: AppColors.textBody)),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      'Hadiah ${undian.discountLabel} • ${undian.winnerCount} pemenang '
                      '• voucher berlaku ${undian.voucherValidDays} hari',
                      style: const TextStyle(
                          color: AppColors.textMuted, fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.grid),
              Row(
                children: [
                  const Text('Peserta',
                      style: TextStyle(
                          fontWeight: FontWeight.w600, color: AppColors.slate900)),
                  const Spacer(),
                  if (berjalan)
                    TextButton.icon(
                      onPressed: _busy ? null : _addParticipant,
                      icon: const Icon(Icons.person_add_alt_outlined, size: 18),
                      label: const Text('Tambah'),
                    ),
                ],
              ),
              participantsAsync.when(
                loading: () => const AppSkeletonList(hasLeading: false),
                error: (e, _) =>
                    AppErrorState(error: e, title: 'Gagal memuat peserta'),
                data: (participants) {
                  if (participants.isEmpty) {
                    return const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text('Belum ada peserta.',
                          style: TextStyle(color: AppColors.textMuted)),
                    );
                  }
                  return Column(
                    children: [
                      for (final p in participants)
                        ListTile(
                          key: Key('peserta-${p.memberId}'),
                          contentPadding: EdgeInsets.zero,
                          title: Text(names[p.memberId] ?? 'Pelanggan'),
                          subtitle: Text(p.source == 'manual'
                              ? 'Ditambahkan manual'
                              : 'Otomatis dari kriteria'),
                          trailing: berjalan
                              ? IconButton(
                                  icon: const Icon(Icons.close,
                                      color: AppColors.danger),
                                  onPressed: _busy
                                      ? null
                                      : () => _removeParticipant(
                                          p.memberId, names[p.memberId] ?? ''),
                                )
                              : null,
                        ),
                    ],
                  );
                },
              ),
              const SizedBox(height: AppSpacing.grid),
              if (berjalan) ...[
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: const Key('tarik-undian'),
                    onPressed: _busy ? null : _draw,
                    icon: const Icon(Icons.casino_outlined),
                    label: const Text('Tarik Undian'),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: _busy ? null : _cancel,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                      side: const BorderSide(color: AppColors.dangerBorder),
                    ),
                    child: const Text('Batalkan Undian'),
                  ),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}
```

- [x] **Step 4: Rute**

Di `app_router.dart`, tambah import untuk ketiga layar undian, lalu:

```dart
          GoRoute(
            path: '/undian',
            builder: (_, __) => const UndianListScreen(),
            routes: [
              GoRoute(
                path: 'baru',
                builder: (_, __) => const UndianFormScreen(),
              ),
              GoRoute(
                path: ':id',
                builder: (context, state) => UndianDetailScreen(
                  undianId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
```

- [x] **Step 5: Menu & guard**

Di `adaptive_scaffold.dart`, tambah destinasi admin only (sejajar `voucher`):

```dart
  const undian = (
    icon: Icons.card_giftcard_outlined,
    label: 'Undian',
    route: '/undian',
  );
```

masukkan `undian,` ke daftar `role == UserRole.admin`. Di `redirect.dart`, tambah `'/undian'` ke `_adminOnlyPrefixes`.

- [x] **Step 6: Widget test**

```dart
// frontend/mobile/test/features/undian/undian_list_screen_test.dart
import 'package:epos_ac/data/models/undian.dart';
import 'package:epos_ac/features/undian/undian_list_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('undianStatusTone', () {
    test('setiap status punya nada', () {
      for (final s in UndianStatus.values) {
        expect(() => undianStatusTone(s), returnsNormally);
      }
    });
  });
}
```

- [x] **Step 7: Jalankan**

```bash
cd frontend/mobile && flutter analyze && flutter test test/features/undian/undian_list_screen_test.dart
```

- [x] **Step 8: Commit**

```bash
git add frontend/mobile/lib/features/undian frontend/mobile/lib/core/router/app_router.dart frontend/mobile/lib/core/router/redirect.dart frontend/mobile/lib/core/widgets/adaptive_scaffold.dart frontend/mobile/test/features/undian
git commit -m "feat(app): layar Undian (peserta, tarik, batal) + rute/menu"
```

---

## Task 9: Mobile — field kode voucher di Checkout

**Files:**
- Modify: `frontend/mobile/lib/features/pos/cart_state.dart`
- Modify: `frontend/mobile/lib/features/pos/pos_providers.dart`
- Modify: `frontend/mobile/lib/features/pos/checkout_screen.dart`
- Modify: `frontend/mobile/test/features/pos/cart_state_test.dart` (kalau ada — kalau belum ada file ini, tambah kasus sejenis ke test cart yang sudah ada)

**Interfaces:**
- Modifies: `Cart` (tambah field `voucherCode`), `CartNotifier` (tambah `setVoucherCode`), `buildCheckoutPayload` (kirim `voucherCode` bila diisi).
- Consumes: RPC `checkout_transaction` yang sudah menerima `voucherCode` (Task 4) — validasi & penerapan diskon sepenuhnya di server, klien tidak menghitung ulang potongan voucher.

- [x] **Step 1: Tambah field `voucherCode` ke `Cart`**

Di `cart_state.dart`, tambah field ke class `Cart`:

```dart
  final String voucherCode;
```

Tambah ke constructor (`this.voucherCode = ''`), ke `copyWith` (parameter `String? voucherCode` + `voucherCode: voucherCode ?? this.voucherCode`).

- [x] **Step 2: Kirim di payload**

Di `buildCheckoutPayload`, setelah blok `discount/taxPercent/transportFee`:

```dart
  final voucherCode = cart.voucherCode.trim();
  if (voucherCode.isNotEmpty) payload['voucherCode'] = voucherCode.toUpperCase();
```

(diletakkan sebelum `return payload;`, sejajar penambahan `notes`/`installations`/`serviceUnits` yang sudah ada).

- [x] **Step 3: `CartNotifier.setVoucherCode`**

Di `pos_providers.dart`, tambah method di `CartNotifier` (sejajar `setNotes`):

```dart
  void setVoucherCode(String value) =>
      state = state.copyWith(voucherCode: value);
```

- [x] **Step 4: Field di layar Checkout**

Di `checkout_screen.dart`:
- Tambah `late final TextEditingController _voucherCode;` ke state, inisialisasi di `initState` (`TextEditingController(text: cart.voucherCode)`), dispose di `dispose`.
- Di `_submit()`, sebelum `notifier.setNotes(...)`, tambah `notifier.setVoucherCode(_voucherCode.text.trim());`.
- Di `build()`, tambah field di `AppFormCard(title: 'Rincian Biaya', ...)` SEBELUM field `Diskon` yang sudah ada:

```dart
                AppTextField(
                  key: const Key('voucherCode'),
                  label: 'Kode Voucher (opsional)',
                  hint: 'VCR-XXXXXX',
                  controller: _voucherCode,
                  enabled: !_busy,
                  textCapitalization: TextCapitalization.characters,
                ),
                const SizedBox(height: kFieldGap),
```

Kode divalidasi & potongannya dihitung sepenuhnya oleh `checkout_transaction` di server — tidak ada pratinjau potongan voucher di ringkasan biaya klien (baris "Diskon" yang sudah ada tetap menampilkan `cart.discount` manual saja); error dari RPC (kode invalid/kedaluwarsa/salah pelanggan/di bawah minimal) muncul lewat jalur `catch` yang sudah ada di `_submit()`.

- [x] **Step 5: Verifikasi**

```bash
cd frontend/mobile && flutter analyze && flutter test
```

Expected: seluruh suite test yang ada tetap PASS (payload lama tanpa `voucherCode` tidak berubah bentuk — field baru hanya ditambahkan saat diisi).

- [x] **Step 6: Commit**

```bash
git add frontend/mobile/lib/features/pos/cart_state.dart frontend/mobile/lib/features/pos/pos_providers.dart frontend/mobile/lib/features/pos/checkout_screen.dart
git commit -m "feat(app): field kode voucher di Checkout"
```

---

## Task 10: Web — tipe, RPC wrapper, label kind WA baru

**Files:**
- Modify: `frontend/web/lib/types.ts`
- Modify: `frontend/web/lib/rpc.ts`
- Modify: `frontend/web/app/(app)/pengingat/page.tsx`

**Interfaces:**
- Produces (types.ts): `VoucherDiscountType`, `VoucherStatus`, `VoucherSource`, `UndianStatus`, `voucherStatusLabel`, `undianStatusLabel`, `Voucher`, `Undian`, `UndianParticipant`; `WaKind` diperluas.
- Produces (rpc.ts): `createVoucher`, `cancelVoucher`, `createUndian`, `updateUndianParticipants`, `drawUndian`, `cancelUndian`.
- Dikonsumsi Task 11 (`/voucher`), Task 12 (`/undian`).

- [x] **Step 1: Perluas `WaKind` + label**

Di `types.ts`, ganti:

```ts
export type WaKind = "selesai_servis" | "reminder_h3" | "reminder_h7";
```

menjadi:

```ts
export type WaKind =
  | "selesai_servis"
  | "reminder_h3"
  | "reminder_h7"
  | "menang_undian"
  | "voucher_baru";
```

dan tambah 2 baris ke `waKindLabel`:

```ts
  menang_undian: "Menang Undian",
  voucher_baru: "Voucher Baru",
```

- [x] **Step 2: Tipe voucher/undian**

Tambah ke `types.ts` (setelah `waKindLabel`/`WaMessage`):

```ts
export type VoucherDiscountType = "persen" | "nominal";
export type VoucherStatus = "aktif" | "terpakai" | "kadaluarsa" | "dibatalkan";
export type VoucherSource = "undian" | "manual";
export type UndianStatus = "berjalan" | "selesai" | "dibatalkan";

export const voucherStatusLabel: Record<VoucherStatus, string> = {
  aktif: "Aktif",
  terpakai: "Terpakai",
  kadaluarsa: "Kadaluarsa",
  dibatalkan: "Dibatalkan",
};

export const undianStatusLabel: Record<UndianStatus, string> = {
  berjalan: "Berjalan",
  selesai: "Selesai",
  dibatalkan: "Dibatalkan",
};

export type Voucher = {
  id: string;
  code: string;
  member_id: string;
  discount_type: VoucherDiscountType;
  discount_value: number;
  max_discount_cap: number | null;
  min_purchase: number | null;
  expires_at: string;
  status: VoucherStatus;
  source: VoucherSource;
  note: string | null;
  created_at: string;
};

export type Undian = {
  id: string;
  title: string;
  description: string | null;
  winner_count: number;
  discount_type: VoucherDiscountType;
  discount_value: number;
  max_discount_cap: number | null;
  min_purchase: number | null;
  voucher_valid_days: number;
  status: UndianStatus;
  drawn_at: string | null;
  created_at: string;
};

export type UndianParticipant = {
  id: string;
  undian_id: string;
  member_id: string;
  source: "otomatis" | "manual";
};
```

- [x] **Step 3: RPC wrapper**

Tambah ke `rpc.ts` (setelah bagian "antrean pengingat WhatsApp"), termasuk import tipe:

```ts
import type { ItemKind, PaymentMethod, VoucherDiscountType } from "./types";
```

(gabungkan ke baris import yang sudah ada di baris pertama file, jangan tambah baris import kedua.)

```ts
// ---- voucher & undian --------------------------------------------------

export type CreateVoucherPayload = {
  memberId: string;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscountCap?: number;
  minPurchase?: number;
  expiresAt: string; // 'YYYY-MM-DD'
  note?: string;
};

export function createVoucher(
  supabase: SupabaseClient,
  payload: CreateVoucherPayload,
) {
  return callRpc<{ ok: boolean; voucherId: string; code: string }>(
    supabase,
    "create_voucher",
    payload,
  );
}

export function cancelVoucher(
  supabase: SupabaseClient,
  payload: { voucherId: string; reason?: string },
) {
  return callRpc<{ ok: boolean }>(supabase, "cancel_voucher", payload);
}

export type CreateUndianPayload = {
  title: string;
  description?: string;
  criteria: { dateFrom?: string; dateTo?: string; mustHaveAcPurchase?: boolean };
  winnerCount: number;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscountCap?: number;
  minPurchase?: number;
  voucherValidDays: number;
};

export function createUndian(
  supabase: SupabaseClient,
  payload: CreateUndianPayload,
) {
  return callRpc<{ ok: boolean; undianId: string; participantCount: number }>(
    supabase,
    "create_undian",
    payload,
  );
}

export function updateUndianParticipants(
  supabase: SupabaseClient,
  payload: { undianId: string; add?: string[]; remove?: string[] },
) {
  return callRpc<{ ok: boolean; participantCount: number }>(
    supabase,
    "update_undian_participants",
    payload,
  );
}

export function drawUndian(
  supabase: SupabaseClient,
  payload: { undianId: string },
) {
  return callRpc<{ ok: boolean; undianId: string; winnerCount: number }>(
    supabase,
    "draw_undian",
    payload,
  );
}

export function cancelUndian(
  supabase: SupabaseClient,
  payload: { undianId: string },
) {
  return callRpc<{ ok: boolean }>(supabase, "cancel_undian", payload);
}
```

- [x] **Step 4: Label kind baru di layar Pengingat**

Di `pengingat/page.tsx`, tambah 2 baris ke `kindClass`:

```ts
  menang_undian: "bg-emerald-50 text-emerald-700",
  voucher_baru: "bg-emerald-50 text-emerald-700",
```

(baris lain di halaman itu tidak berubah — `waKindLabel[row.kind]` sudah otomatis memetakan label baru dari Step 1.)

- [x] **Step 5: Verifikasi**

```bash
cd frontend/web && npm run typecheck
```

Expected: 0 error.

- [x] **Step 6: Commit**

```bash
git add frontend/web/lib/types.ts frontend/web/lib/rpc.ts "frontend/web/app/(app)/pengingat/page.tsx"
git commit -m "feat(web): tipe & RPC voucher/undian + label kind WA baru"
```

---

## Task 11: Web — halaman `/voucher`

**Files:**
- Create: `frontend/web/app/(app)/voucher/page.tsx`
- Create: `frontend/web/app/(app)/voucher/_components/voucher-actions.tsx`
- Create: `frontend/web/app/(app)/voucher/baru/page.tsx`

**Interfaces:**
- Consumes: `Voucher`/`voucherStatusLabel` (Task 10), `createVoucher`/`cancelVoucher` (Task 10).

- [x] **Step 1: List (`page.tsx`)**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTanggalPanjang } from "@/lib/format";
import { voucherStatusLabel, type Voucher } from "@/lib/types";
import { VoucherActions } from "./_components/voucher-actions";

export const dynamic = "force-dynamic";

type Row = Voucher & { members: { name: string } | null };

const statusClass: Record<string, string> = {
  aktif: "bg-emerald-50 text-emerald-700",
  terpakai: "bg-slate-100 text-slate-600",
  kadaluarsa: "bg-red-50 text-red-600",
  dibatalkan: "bg-red-50 text-red-600",
};

function discountLabel(row: Voucher) {
  return row.discount_type === "persen"
    ? `${row.discount_value}%`
    : `Rp ${row.discount_value.toLocaleString("id-ID")}`;
}

export default async function VoucherPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vouchers")
    .select(
      "id,code,member_id,discount_type,discount_value,max_discount_cap,min_purchase,expires_at,status,source,note,created_at,members(name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-slate-900">Voucher</h1>
          <p className="text-sm text-slate-500">
            Kode dipakai dengan cara diinput admin/kasir saat checkout.
          </p>
        </div>
        <Link
          href="/voucher/baru"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Buat Voucher
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">Belum ada voucher.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-start md:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-mono font-semibold text-slate-900">
                    {row.code}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      statusClass[row.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {voucherStatusLabel[row.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.members?.name ?? "Pelanggan"}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {discountLabel(row)} · berlaku sampai{" "}
                  {formatTanggalPanjang(row.expires_at)}
                </p>
              </div>
              {row.status === "aktif" ? (
                <VoucherActions id={row.id} code={row.code} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [x] **Step 2: Aksi batalkan (`_components/voucher-actions.tsx`)**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cancelVoucher } from "@/lib/rpc";

export function VoucherActions({ id, code }: { id: string; code: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function batalkan() {
    if (!window.confirm(`Batalkan voucher ${code}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await cancelVoucher(supabase, { voucherId: id });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membatalkan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={batalkan}
        disabled={busy}
        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
      >
        Batalkan
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
```

- [x] **Step 3: Form buat (`baru/page.tsx`)**

Web belum punya picker member bergambar seperti mobile (`MemberPickerSheet`) — nomor HP sudah jadi identitas unik member (README §Aturan Penting 4), jadi form ini mencari member langsung lewat nomor HP yang diketik.

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createVoucher } from "@/lib/rpc";
import type { VoucherDiscountType } from "@/lib/types";

export default function VoucherBaruPage() {
  const router = useRouter();
  const [memberPhone, setMemberPhone] = useState("");
  const [discountType, setDiscountType] = useState<VoucherDiscountType>("nominal");
  const [discountValue, setDiscountValue] = useState("");
  const [maxCap, setMaxCap] = useState("");
  const [minPurchase, setMinPurchase] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: member, error: memberError } = await supabase
        .from("members")
        .select("id")
        .eq("phone", memberPhone.trim())
        .maybeSingle();
      if (memberError) throw new Error(memberError.message);
      if (!member) {
        throw new Error(
          "Pelanggan dengan nomor HP itu tidak ditemukan (format tersimpan: +62...).",
        );
      }
      await createVoucher(supabase, {
        memberId: member.id,
        discountType,
        discountValue: Number(discountValue),
        maxDiscountCap: maxCap ? Number(maxCap) : undefined,
        minPurchase: minPurchase ? Number(minPurchase) : undefined,
        expiresAt,
        note: note.trim() || undefined,
      });
      router.push("/voucher");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat voucher.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Buat Voucher</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nomor HP Pelanggan
          <input
            required
            value={memberPhone}
            onChange={(e) => setMemberPhone(e.target.value)}
            placeholder="+62812xxxxxxx"
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Tipe Diskon
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as VoucherDiscountType)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          >
            <option value="nominal">Nominal (Rp)</option>
            <option value="persen">Persen (%)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nilai {discountType === "persen" ? "(%)" : "(Rp)"}
          <input
            required
            type="number"
            min={1}
            max={discountType === "persen" ? 100 : undefined}
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        {discountType === "persen" ? (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Maks Potongan (Rp, opsional)
            <input
              type="number"
              min={1}
              value={maxCap}
              onChange={(e) => setMaxCap(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Minimal Pembelian (Rp, opsional)
          <input
            type="number"
            min={0}
            value={minPurchase}
            onChange={(e) => setMinPurchase(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Berlaku Sampai
          <input
            required
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Catatan (opsional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Menyimpan..." : "Buat Voucher"}
        </button>
      </form>
    </div>
  );
}
```

- [x] **Step 4: Lepas `voucher` dari placeholder**

Di `app/(app)/[...slug]/page.tsx`, komentar baris 1 masih menyebut daftar rute belum diimplementasi — tidak perlu diubah (komentar generik, tidak mendaftar nama per rute). Next.js App Router otomatis mengutamakan `app/(app)/voucher/page.tsx` yang literal di atas catch-all `[...slug]`, jadi tidak ada langkah tambahan di sini.

- [x] **Step 5: Verifikasi**

```bash
cd frontend/web && npm run typecheck
```

- [x] **Step 6: Commit**

```bash
git add "frontend/web/app/(app)/voucher"
git commit -m "feat(web): halaman Voucher (list, buat, batalkan)"
```

---

## Task 12: Web — halaman `/undian`

**Files:**
- Create: `frontend/web/app/(app)/undian/page.tsx`
- Create: `frontend/web/app/(app)/undian/baru/page.tsx`
- Create: `frontend/web/app/(app)/undian/[id]/page.tsx`
- Create: `frontend/web/app/(app)/undian/[id]/_components/undian-actions.tsx`

**Interfaces:**
- Consumes: `Undian`/`UndianParticipant`/`undianStatusLabel` (Task 10), `createUndian`/`drawUndian`/`cancelUndian` (Task 10).

- [x] **Step 1: List (`page.tsx`)**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { undianStatusLabel, type Undian } from "@/lib/types";

export const dynamic = "force-dynamic";

const statusClass: Record<string, string> = {
  berjalan: "bg-amber-50 text-amber-700",
  selesai: "bg-emerald-50 text-emerald-700",
  dibatalkan: "bg-red-50 text-red-600",
};

function discountLabel(row: Undian) {
  return row.discount_type === "persen"
    ? `${row.discount_value}%`
    : `Rp ${row.discount_value.toLocaleString("id-ID")}`;
}

export default async function UndianPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("undian")
    .select(
      "id,title,description,winner_count,discount_type,discount_value,voucher_valid_days,status,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Undian[];

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Undian</h1>
        <Link
          href="/undian/baru"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Buat Undian
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Gagal memuat: {error.message}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">Belum ada undian.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/undian/${row.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{row.title}</p>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        statusClass[row.status] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {undianStatusLabel[row.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    Hadiah {discountLabel(row)} · {row.winner_count} pemenang
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [x] **Step 2: Form buat (`baru/page.tsx`)**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createUndian } from "@/lib/rpc";
import type { VoucherDiscountType } from "@/lib/types";

export default function UndianBaruPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [winnerCount, setWinnerCount] = useState("1");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [mustHaveAc, setMustHaveAc] = useState(false);
  const [discountType, setDiscountType] = useState<VoucherDiscountType>("nominal");
  const [discountValue, setDiscountValue] = useState("");
  const [maxCap, setMaxCap] = useState("");
  const [minPurchase, setMinPurchase] = useState("");
  const [validDays, setValidDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await createUndian(supabase, {
        title,
        description: description.trim() || undefined,
        criteria: {
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          mustHaveAcPurchase: mustHaveAc,
        },
        winnerCount: Number(winnerCount),
        discountType,
        discountValue: Number(discountValue),
        maxDiscountCap: maxCap ? Number(maxCap) : undefined,
        minPurchase: minPurchase ? Number(minPurchase) : undefined,
        voucherValidDays: Number(validDays),
      });
      router.push(`/undian/${result.undianId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat undian.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Buat Undian</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Judul
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Deskripsi (opsional)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Jumlah Pemenang
          <input
            required
            type="number"
            min={1}
            value={winnerCount}
            onChange={(e) => setWinnerCount(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Dari Tanggal (opsional)
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Sampai Tanggal (opsional)
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={mustHaveAc}
            onChange={(e) => setMustHaveAc(e.target.checked)}
          />
          Harus pernah beli AC baru
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Tipe Diskon
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as VoucherDiscountType)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          >
            <option value="nominal">Nominal (Rp)</option>
            <option value="persen">Persen (%)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Nilai {discountType === "persen" ? "(%)" : "(Rp)"}
          <input
            required
            type="number"
            min={1}
            max={discountType === "persen" ? 100 : undefined}
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        {discountType === "persen" ? (
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Maks Potongan (Rp, opsional)
            <input
              type="number"
              min={1}
              value={maxCap}
              onChange={(e) => setMaxCap(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Minimal Pembelian (Rp, opsional)
          <input
            type="number"
            min={0}
            value={minPurchase}
            onChange={(e) => setMinPurchase(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Masa Berlaku Voucher Pemenang (hari)
          <input
            required
            type="number"
            min={1}
            value={validDays}
            onChange={(e) => setValidDays(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Menyimpan..." : "Buat Undian"}
        </button>
      </form>
    </div>
  );
}
```

- [x] **Step 3: Detail + aksi (`[id]/page.tsx`, `[id]/_components/undian-actions.tsx`)**

```tsx
// frontend/web/app/(app)/undian/[id]/page.tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { undianStatusLabel, type Undian, type UndianParticipant } from "@/lib/types";
import { UndianActions } from "./_components/undian-actions";

export const dynamic = "force-dynamic";

export default async function UndianDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: undian } = await supabase
    .from("undian")
    .select(
      "id,title,description,winner_count,discount_type,discount_value,voucher_valid_days,status",
    )
    .eq("id", id)
    .maybeSingle();
  if (!undian) notFound();

  const { data: participantRows } = await supabase
    .from("undian_participants")
    .select("id,undian_id,member_id,source,members(name)")
    .eq("undian_id", id);
  const participants = (participantRows ?? []) as unknown as (UndianParticipant & {
    members: { name: string } | null;
  })[];

  const berjalan = (undian as Undian).status === "berjalan";
  const discountLabel =
    undian.discount_type === "persen"
      ? `${undian.discount_value}%`
      : `Rp ${undian.discount_value.toLocaleString("id-ID")}`;

  return (
    <div className="mx-auto max-w-2xl p-6 md:p-8">
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-slate-900">{undian.title}</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
            {undianStatusLabel[undian.status as Undian["status"]]}
          </span>
        </div>
        {undian.description ? (
          <p className="mt-2 text-sm text-slate-600">{undian.description}</p>
        ) : null}
        <p className="mt-2 text-sm text-slate-500">
          Hadiah {discountLabel} · {undian.winner_count} pemenang · voucher
          berlaku {undian.voucher_valid_days} hari
        </p>
      </div>

      <h2 className="mb-2 font-semibold text-slate-900">
        Peserta ({participants.length})
      </h2>
      <ul className="mb-6 flex flex-col gap-2">
        {participants.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada peserta.</p>
        ) : (
          participants.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span>{p.members?.name ?? "Pelanggan"}</span>
              <span className="text-xs text-slate-400">
                {p.source === "manual" ? "Manual" : "Otomatis"}
              </span>
            </li>
          ))
        )}
      </ul>

      {berjalan ? <UndianActions undianId={id} /> : null}
    </div>
  );
}
```

```tsx
// frontend/web/app/(app)/undian/[id]/_components/undian-actions.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { drawUndian, cancelUndian } from "@/lib/rpc";

export function UndianActions({ undianId }: { undianId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tarik() {
    if (!window.confirm("Tarik undian? Pemenang dipilih acak dan tidak bisa diulang.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await drawUndian(supabase, { undianId });
      window.alert(`${result.winnerCount} pemenang terpilih.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menarik undian.");
    } finally {
      setBusy(false);
    }
  }

  async function batalkan() {
    if (!window.confirm("Batalkan undian ini?")) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await cancelUndian(supabase, { undianId });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membatalkan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={tarik}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          Tarik Undian
        </button>
        <button
          type="button"
          onClick={batalkan}
          disabled={busy}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
        >
          Batalkan
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
```

- [x] **Step 4: Verifikasi**

```bash
cd frontend/web && npm run typecheck
```

- [x] **Step 5: Commit**

```bash
git add "frontend/web/app/(app)/undian"
git commit -m "feat(web): halaman Undian (list, buat, detail, tarik, batal)"
```

---

## Task 13: Dokumentasi

**Files:**
- Modify: `README.md`

- [x] **Step 1: Migrasi & Model Data & Status**

Tambah 4 baris ke tabel migrasi (setelah `..._reminder_rpc.sql`):

```markdown
| `..._voucher_undian_schema.sql` | Skema `undian`, `undian_participants`, `vouchers` + 2 kind `wa_outbox` baru |
| `..._undian_rpc.sql` | RPC undian: buat, peserta, tarik, batal |
| `..._voucher_rpc.sql` | RPC voucher ad-hoc: buat, batal |
| `..._checkout_voucher.sql` | `checkout_transaction` menerima `voucherCode` |
```

Di bagian **Model Data & Status**, tambah `undian`, `undian_participants`, `vouchers` ke daftar "Tabel inti", dan tambah baris status:

```markdown
| Voucher (`vouchers.status`) | `aktif`, `terpakai`, `kadaluarsa`, `dibatalkan` |
| Undian (`undian.status`) | `berjalan`, `selesai`, `dibatalkan` |
```

Tambah 2 nilai ke baris **Jenis pesan WA**: `menang_undian`, `voucher_baru`.

- [x] **Step 2: Kontrak RPC**

Tambah subbagian baru setelah "Pengingat servis (antrean WhatsApp)":

```markdown
### Voucher & Undian

| RPC | Peran | Payload → Efek |
|-----|-------|----------------|
| `create_undian` | admin | `{title, description?, criteria, winnerCount, discountType, discountValue, maxDiscountCap?, minPurchase?, voucherValidDays}` → buat undian + auto-populate peserta dari kriteria |
| `update_undian_participants` | admin | `{undianId, add?, remove?}` → tambah/hapus peserta manual (hanya selama `berjalan`) |
| `draw_undian` | admin | `{undianId}` → pilih pemenang acak, buat voucher + antre WA per pemenang, tutup undian |
| `cancel_undian` | admin | `{undianId}` → batalkan undian yang belum ditarik |
| `create_voucher` | admin | `{memberId, discountType, discountValue, maxDiscountCap?, minPurchase?, expiresAt, note?}` → voucher ad-hoc + antre WA |
| `cancel_voucher` | admin | `{voucherId, reason?}` → batalkan voucher aktif |

Voucher selalu terikat ke satu `memberId` dan ditukar dengan cara diinput
admin/kasir sebagai `voucherCode` di `checkout_transaction` — validasi (aktif,
belum kedaluwarsa, milik pelanggan transaksi ini, memenuhi `min_purchase`) dan
perhitungan potongan sepenuhnya di server. Tidak ada langkah "klaim" terpisah.
```

Update deskripsi `checkout_transaction(payload)` (tambah baris `voucherCode?` ke contoh payload):

```jsonc
  "voucherCode": "VCR-XXXXXX",  // opsional
```

- [x] **Step 3: Status Fitur (MVP)**

Tambah baris:

```markdown
| Voucher/Diskon + Undian | ✅ (jadwal + antrean + scheduler reuse WA) | ✅ (`/voucher`, `/undian`) |
```

- [x] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: sistem voucher/diskon + undian"
```

---

## Di luar cakupan plan ini

- **Halaman POS/checkout di web** — belum ada sama sekali (README/`[...slug]` stub); field kode voucher di checkout web menyusul begitu halaman POS webnya dibangun.
- **Pratinjau potongan voucher real-time** sebelum submit checkout (mobile & web) — perhitungan sepenuhnya server-side untuk sekarang.
- **Ronde undian ulang otomatis / undian berulang terjadwal.**
- **Klaim mandiri oleh pelanggan** — perlu portal/app pelanggan yang tidak ada saat ini; kode ditukar oleh admin/kasir di kasir.

