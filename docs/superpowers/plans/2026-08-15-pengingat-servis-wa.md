# Pengingat Servis AC via WhatsApp — Implementation Plan

> **Untuk pengerjaan bertahap:** setiap Task berdiri sendiri dan diakhiri satu commit. Step pakai checkbox (`- [ ]`) untuk tracking.

**Goal:** Setiap unit AC yang selesai dicuci/di-maintenance otomatis punya jadwal servis berikutnya, pelanggan dapat pesan WhatsApp konfirmasi saat pekerjaan selesai, lalu diingatkan lagi H-3 sebelum jatuh tempo dan H+7 bila belum memesan.

**Architecture:** Semua logika penjadwalan hidup di Postgres — kolom `member_ac_units.next_service_date` (sudah ada di skema sejak `20260715000001_init_schema.sql:184`, tapi sampai sekarang **tidak pernah diisi kode mana pun**) menjadi sumber kebenaran jadwal. Pesan tidak dikirim langsung dari trigger; setiap pesan masuk **tabel antrean `wa_outbox`** dulu. Pengirimannya adalah *adapter* yang bisa diganti tanpa menyentuh tabel, scheduler, atau UI:

- **Fase sekarang — adapter `manual`:** admin/kasir buka layar Pengingat, klik satu tombol, WhatsApp terbuka dengan pesan sudah terisi lengkap (`https://wa.me/<62…>?text=…`), tinggal Send. Nol biaya, nol risiko nomor diblokir, dan redaksi pesan bisa diuji ke pelanggan asli dulu.
- **Fase berikutnya — adapter `cloud_api`:** begitu verifikasi bisnis Meta dan approval template turun, Edge Function `send-wa` diisi pemanggilan WhatsApp Cloud API dan `wa_outbox` terkirim sendiri. **Tidak ada tabel, RPC, atau layar yang berubah** — hanya isi Edge Function dan satu baris `app_config`.

Pola outbound-nya meniru persis jalur FCM yang sudah terbukti di repo ini: `app_config` menyimpan URL + secret (tidak ikut ter-commit), `pg_net` memanggil Edge Function secara async, dan **kegagalan kirim tidak boleh menggagalkan transaksi bisnis** — lihat `enqueue_push()` di `20260717000012_push_trigger.sql:26`.

**Tech Stack:** Postgres (migrasi SQL biasa), `pg_cron` untuk scheduler harian, `pg_net` untuk memanggil Edge Function, Deno Edge Function (`send-wa`), Flutter + `url_launcher` (dependensi **baru** — belum ada di `frontend/mobile/pubspec.yaml`), Next.js Server Components.

## Global Constraints

- **Jangan sentuh `last_service_date`.** Kolom itu sudah di-set `now()` otomatis saat job selesai di `20260805000019_bugfix_unit_status_realtime_counter.sql:252`. Plan ini hanya **menambah** pengisian `next_service_date` di blok yang sama.
- **Nomor migrasi lanjut dari yang terakhir**: `20260806000022_device_tokens_service_role_grants.sql` adalah yang terakhir, jadi plan ini memakai `…0023`, `…0024`, `…0025`.
- **Semua penulisan lewat RPC.** Sesuai `README.md:116`, client tidak pernah `insert`/`update` tabel langsung. `wa_outbox` dan `reminder_settings` hanya di-`grant select` ke `authenticated`; perubahan status lewat RPC `security definer`.
- **Setiap RPC baru wajib dikunci** mengikuti pola `20260806000020_hardening_rls_execute.sql:46`: `revoke execute … from anon, public;` lalu `grant execute … to authenticated;`. Postgres memberi EXECUTE ke `public` secara default — lupa revoke = fungsi bisa dipanggil `anon`.
- **Pesan error berbahasa Indonesia**, dilempar `raise exception`, konsisten dengan RPC lain (mis. `'Job ini bukan milik Anda'`). Client sudah mengupasnya lewat `errorMessage()` (mobile) / `new Error(error.message)` (web).
- **Data pelanggan tertutup dari teknisi.** Temuan keamanan #2 di `LAPORAN_KEAMANAN_2026-08-06.md` persis soal ini. `wa_outbox` berisi nama + nomor HP + alamat pelanggan, jadi RLS-nya **admin & kasir saja** — teknisi 0 baris.
- **Uang tidak terlibat** di fitur ini; tidak ada kolom rupiah baru.
- **Interval satuan hari** (`integer`), bukan bulan — "2 bulan" disimpan sebagai `60`. Menghindari ambiguitas panjang bulan.

### Kontrak jadwal (otoritatif)

| Jenis job selesai | Dijadwalkan ulang? | Default |
|---|---|---|
| `cuci` | ya | 60 hari |
| `maintenance` | ya | 180 hari |
| `service` | tidak | — |
| `pemasangan`, `bongkar`, `bongkar_pasang` | tidak | — |

Urutan penentuan interval (yang pertama ketemu menang):
1. `member_ac_units.service_interval_days` — override per unit AC (untuk pelanggan yang minta siklus khusus)
2. `reminder_settings.interval_days` — default per jenis job, **bisa diubah admin dari UI**
3. Tidak ada / `active = false` → `next_service_date` dikosongkan, unit tidak pernah diingatkan

---

## Task 1: Migrasi 0023 — skema pengingat

**Files:**
- Create: `backend/supabase/migrations/20260815000023_service_reminders.sql`

**Interfaces:**
- Produces: tabel `reminder_settings`, `wa_outbox`; kolom `member_ac_units.service_interval_days`, `members.wa_opt_out`; fungsi `wa_phone(text)`, `tgl_id(date)`, `resolve_service_interval_days(uuid, text)`, `build_wa_body(uuid, text, uuid[], date)`.
- Dikonsumsi Task 2 (pengisian jadwal), Task 3 (scheduler), Task 4 (RPC).

- [x] **Step 1: Tulis migrasi skema**

```sql
-- =============================================================================
-- Fase 8 — Pengingat servis AC via WhatsApp.
--
-- `member_ac_units.next_service_date` sudah ada sejak migrasi 0001 tapi tak
-- pernah diisi. Mulai migrasi ini kolom tersebut jadi sumber kebenaran jadwal:
-- diisi otomatis saat job cuci/maintenance selesai (migrasi 0024), lalu dipanen
-- scheduler harian jadi baris `wa_outbox`.
--
-- Pesan TIDAK dikirim langsung dari trigger. Semua masuk antrean `wa_outbox`
-- dulu, supaya cara kirimnya (manual wa.me sekarang, Cloud API nanti) bisa
-- diganti tanpa menyentuh skema.
-- =============================================================================

-- ------------------------------------------------------- override per unit AC
alter table member_ac_units
  add column if not exists service_interval_days integer
    check (service_interval_days is null or service_interval_days between 7 and 730);

comment on column member_ac_units.service_interval_days is
  'Override siklus servis unit ini dalam hari. NULL = pakai default reminder_settings.';

-- ------------------------------------------------------------ opt-out pelanggan
alter table members
  add column if not exists wa_opt_out boolean not null default false;

comment on column members.wa_opt_out is
  'true = pelanggan minta berhenti dikirimi pengingat WhatsApp.';

-- --------------------------------------------------- default interval per jenis
create table if not exists reminder_settings (
  job_type      text primary key,
  interval_days integer not null check (interval_days between 7 and 730),
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references users (id)
);

insert into reminder_settings (job_type, interval_days, active) values
  ('cuci', 60, true),
  ('maintenance', 180, true)
on conflict (job_type) do nothing;

alter table reminder_settings enable row level security;
grant select on reminder_settings to authenticated;
create policy "reminder_settings: baca admin/kasir"
  on reminder_settings for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

-- ------------------------------------------------------------------- antrean WA
create table if not exists wa_outbox (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members (id) on delete cascade,
  phone       text not null,              -- sudah ternormalisasi 62xxxxxxxxxx
  kind        text not null
    check (kind in ('selesai_servis', 'reminder_h3', 'reminder_h7')),
  unit_ids    uuid[] not null default '{}',
  due_date    date,                       -- null untuk 'selesai_servis'
  body        text not null,
  status      text not null default 'pending'
    check (status in ('pending', 'terkirim', 'gagal', 'dibatalkan')),
  -- Kunci anti-duplikat: scheduler harian boleh jalan berkali-kali sehari
  -- (retry, restart) tanpa pernah membuat pesan kembar.
  dedupe_key  text not null unique,
  sent_at     timestamptz,
  sent_by     uuid references users (id),
  provider    text,                       -- 'manual' | 'cloud_api'
  provider_message_id text,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists wa_outbox_status_idx
  on wa_outbox (status, created_at desc);
create index if not exists wa_outbox_member_idx on wa_outbox (member_id);

-- Berisi nama + nomor HP pelanggan → tertutup dari teknisi (lihat temuan #2
-- LAPORAN_KEAMANAN_2026-08-06.md). Penulisan hanya lewat RPC (migrasi 0025).
alter table wa_outbox enable row level security;
grant select on wa_outbox to authenticated;
create policy "wa_outbox: baca admin/kasir"
  on wa_outbox for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

-- Antrean baru muncul realtime di layar Pengingat tanpa perlu refresh manual.
alter publication supabase_realtime add table wa_outbox;

-- ------------------------------------------------------------------- helpers
-- Normalisasi nomor HP ke format internasional tanpa '+' (dipakai wa.me dan
-- Cloud API). '0812…' -> '62812…', '+62812…' -> '62812…'.
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

-- Interval efektif satu unit untuk satu jenis job. 0 = jangan dijadwalkan.
create or replace function resolve_service_interval_days(p_unit_id uuid, p_job_type text)
returns integer
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

-- Redaksi pesan. Sengaja dibangun di SQL supaya scheduler bisa menyusun pesan
-- utuh tanpa client. Saat naik ke Cloud API, teks ini jadi acuan template Meta.
create or replace function build_wa_body(
  p_member_id uuid, p_kind text, p_unit_ids uuid[], p_due date
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_nama  text;
  v_unit  text;
begin
  select name into v_nama from members where id = p_member_id;

  select string_agg('- ' || brand || ' ' || model || ' (' || room_location || ')',
                    e'\n' order by room_location)
    into v_unit
    from member_ac_units where id = any (p_unit_ids);

  -- Tanggal WAJIB lewat tgl_id(), bukan to_char(...,'DD Mon YYYY') — to_char
  -- menghasilkan bulan Inggris ("Aug") kecuali lc_time server disetel. BUG-11
  -- di LAPORAN_BUG_UI_QA_2026-08-05.md persis soal tanggal yang masih Inggris.
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

revoke execute on function wa_phone(text) from anon, public;
revoke execute on function resolve_service_interval_days(uuid, text) from anon, public;
revoke execute on function build_wa_body(uuid, text, uuid[], date) from anon, public;
```

- [x] **Step 2: Terapkan & verifikasi**

```bash
cd backend && npx supabase db reset
```

Verifikasi normalisasi nomor — jalankan di `psql`, semua harus `62812345678`:

```sql
select wa_phone('0812345678'), wa_phone('+62 812-345-678'), wa_phone('62812345678');
```

Verifikasi teknisi tidak bisa membaca antrean (harus 0 baris), pakai pola simulasi JWT dari `LAPORAN_KEAMANAN_2026-08-06.md`:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"<uid-teknisi>","role":"authenticated","user_role":"teknisi"}', true);
select count(*) from wa_outbox;   -- harus 0
rollback;
```

- [x] **Step 3: Commit**

```bash
git add backend/supabase/migrations/20260815000023_service_reminders.sql
git commit -m "feat(db): skema pengingat servis AC + antrean WhatsApp"
```

---

## Task 2: Migrasi 0024 — isi `next_service_date` & antrean pesan saat job selesai

**Files:**
- Create: `backend/supabase/migrations/20260815000024_schedule_on_job_complete.sql`

**Interfaces:**
- Mendefinisikan ulang `update_technician_job_status(jsonb)` dari versi terakhirnya di `20260805000019_bugfix_unit_status_realtime_counter.sql:120`.
- Consumes: `resolve_service_interval_days()`, `build_wa_body()`, `wa_phone()` dari Task 1.

**Kenapa redefinisi fungsi, bukan trigger baru:** penjadwalan harus atomik dengan penyelesaian job (satu transaksi), dan blok yang menulis `last_service_date` sudah ada persis di tempat yang benar. Menambah trigger terpisah di `technician_jobs` justru memecah logika ke dua tempat.

- [x] **Step 1: Salin fungsi versi terakhir apa adanya**

Salin **seluruh** `create or replace function update_technician_job_status(payload jsonb)` dari `20260805000019_bugfix_unit_status_realtime_counter.sql` (baris 120 sampai akhir fungsi) ke migrasi baru, tanpa perubahan apa pun dulu. Ini penting: fungsi itu memuat perbaikan BUG A & B dari QA yang tidak boleh hilang.

- [x] **Step 2: Ubah blok `complete` saja**

Di dalam cabang `complete`, blok `if v_job.unit_id is not null then` saat ini berakhir dengan `last_service_date = now()`. Ganti seluruh blok itu jadi:

```sql
    if v_job.unit_id is not null then
      -- Siklus servis berikutnya. 0 = jenis job ini memang tak dijadwalkan
      -- (pemasangan/bongkar/service) -> next_service_date dikosongkan supaya
      -- jadwal lama tidak ikut terbawa dan mengirim pengingat palsu.
      v_interval := resolve_service_interval_days(v_job.unit_id, v_job.type);

      -- BUG A: dulu hanya 'pemasangan' yang dikembalikan ke 'aktif'; kini semua
      -- jenis pekerjaan mengakhiri masa maintenance unit.
      update member_ac_units
         set status = case
               when v_job.type = 'pemasangan' then 'aktif'::ac_unit_status
               when status = 'dalam_maintenance' then 'aktif'::ac_unit_status
               else status end,
             installation_date = case when v_job.type = 'pemasangan'
                                      then coalesce(installation_date, now())
                                      else installation_date end,
             last_service_date = now(),
             next_service_date = case when v_interval > 0
                                      then now() + make_interval(days => v_interval)
                                      else null end
       where id = v_job.unit_id
      returning member_id, next_service_date into v_member_id, v_next;

      -- Pesan konfirmasi "pekerjaan selesai" — hanya bila unit ini memang
      -- punya siklus berikutnya, dan pelanggan tidak opt-out.
      if v_interval > 0 and v_member_id is not null then
        insert into wa_outbox (member_id, phone, kind, unit_ids, due_date, body, dedupe_key)
        select v_member_id, wa_phone(m.phone), 'selesai_servis',
               array[v_job.unit_id], v_next::date,
               build_wa_body(v_member_id, 'selesai_servis', array[v_job.unit_id], v_next::date),
               'job:' || v_job_id::text
          from members m
         where m.id = v_member_id and m.active and not m.wa_opt_out
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
```

Tambahkan tiga variabel ke blok `declare` fungsi:

```sql
  v_interval integer;
  v_member_id uuid;
  v_next timestamptz;
```

`dedupe_key = 'job:<jobId>'` menjamin satu job hanya pernah menghasilkan satu pesan konfirmasi, berapa kali pun RPC-nya terpanggil ulang.

- [x] **Step 3: Pertahankan grant**

Di akhir migrasi, ulangi kunci yang sama seperti `…0019:307`:

```sql
revoke execute on function update_technician_job_status(jsonb) from anon, public;
grant execute on function update_technician_job_status(jsonb) to authenticated;
```

- [x] **Step 4: Verifikasi manual**

```bash
cd backend && npx supabase db reset
```

Di `psql`: selesaikan satu job `cuci` lewat RPC, lalu pastikan

```sql
select last_service_date::date, next_service_date::date from member_ac_units where id = '<unit>';
-- next_service_date harus tepat 60 hari setelah last_service_date
select kind, status, dedupe_key from wa_outbox where member_id = '<member>';
-- harus ada 1 baris 'selesai_servis' berstatus 'pending'
```

Lalu selesaikan job `pemasangan` pada unit lain — `next_service_date` harus tetap `null` dan **tidak ada** baris `wa_outbox`.

- [x] **Step 5: Commit**

```bash
git add backend/supabase/migrations/20260815000024_schedule_on_job_complete.sql
git commit -m "feat(db): jadwalkan servis berikutnya + antre pesan saat job selesai"
```

---

## Task 3: Migrasi 0025 — scheduler harian H-3 & H+7

**Files:**
- Create: `backend/supabase/migrations/20260815000025_reminder_scheduler.sql`

**Interfaces:**
- Produces: `enqueue_service_reminders()` (dipanggil `pg_cron`, mengembalikan jumlah baris baru).

- [x] **Step 1: Tulis fungsi panen jadwal**

```sql
create extension if not exists pg_cron;

-- Memanen unit yang jatuh tempo jadi baris antrean. Dipanggil pg_cron sekali
-- sehari; aman dipanggil berkali-kali karena `dedupe_key` unik per
-- (member, jenis, tanggal jatuh tempo).
create or replace function enqueue_service_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer := 0;
begin
  with due as (
    select u.id as unit_id, u.member_id, u.next_service_date::date as due_date,
           case
             when u.next_service_date::date = current_date + 3 then 'reminder_h3'
             when u.next_service_date::date = current_date - 7 then 'reminder_h7'
           end as kind
      from member_ac_units u
      join members m on m.id = u.member_id
     where u.next_service_date is not null
       and u.status = 'aktif'
       and m.active
       and not m.wa_opt_out
       and wa_phone(m.phone) <> ''
       and u.next_service_date::date in (current_date + 3, current_date - 7)
       -- "jika belum pesan": begitu unit ini punya job berjalan, pengingat
       -- berhenti dengan sendirinya. Job selesai akan menggeser
       -- next_service_date, sehingga baris ini tak pernah cocok lagi.
       and not exists (
         select 1 from technician_jobs j
          where j.unit_id = u.id
            and j.status not in ('selesai', 'dibatalkan')
       )
  ), grouped as (
    -- Satu pelanggan dengan 3 AC jatuh tempo di hari yang sama menerima
    -- SATU pesan berisi 3 unit, bukan 3 pesan.
    select member_id, kind, due_date, array_agg(unit_id) as unit_ids
      from due
     where kind is not null
     group by member_id, kind, due_date
  )
  insert into wa_outbox (member_id, phone, kind, unit_ids, due_date, body, dedupe_key)
  select g.member_id, wa_phone(m.phone), g.kind, g.unit_ids, g.due_date,
         build_wa_body(g.member_id, g.kind, g.unit_ids, g.due_date),
         g.member_id::text || ':' || g.kind || ':' || g.due_date::text
    from grouped g
    join members m on m.id = g.member_id
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function enqueue_service_reminders() from anon, public;

-- 02:00 UTC = 09:00 WIB — pesan tiba di jam kerja, bukan tengah malam.
select cron.unschedule('pengingat-servis-harian')
 where exists (select 1 from cron.job where jobname = 'pengingat-servis-harian');

select cron.schedule('pengingat-servis-harian', '0 2 * * *',
                     $$select enqueue_service_reminders()$$);
```

- [x] **Step 2: Verifikasi tanpa menunggu sehari**

```sql
-- Paksa satu unit jatuh tempo 3 hari lagi, lalu panen manual.
update member_ac_units set next_service_date = now() + interval '3 days'
 where id = '<unit>';
select enqueue_service_reminders();          -- harus mengembalikan 1
select enqueue_service_reminders();          -- harus mengembalikan 0 (anti-duplikat)
select kind, unit_ids, body from wa_outbox where kind = 'reminder_h3';
```

Uji juga penggabungan: set 3 unit milik **satu** member ke tanggal yang sama → `enqueue_service_reminders()` harus mengembalikan **1**, dengan `array_length(unit_ids, 1) = 3`.

Uji penghentian: buat satu job berstatus berjalan untuk unit itu → panen harus mengembalikan 0.

- [x] **Step 3: Catat kebutuhan produksi**

`pg_cron` perlu diaktifkan di **Dashboard Supabase → Database → Extensions** untuk proyek hosted. Bila belum aktif, `create extension` di migrasi akan gagal saat deploy — aktifkan dulu, baru `db push`.

- [x] **Step 4: Commit**

```bash
git add backend/supabase/migrations/20260815000025_reminder_scheduler.sql
git commit -m "feat(db): scheduler harian pengingat servis H-3 & H+7"
```

---

## Task 4: Migrasi 0026 — RPC untuk UI

**Files:**
- Create: `backend/supabase/migrations/20260815000026_reminder_rpc.sql`

**Interfaces:**

| RPC | Peran | Fungsi |
|---|---|---|
| `mark_wa_sent(payload)` | admin, kasir | `{id}` → status `terkirim`, catat `sent_by`/`sent_at`/`provider='manual'` |
| `cancel_wa_message(payload)` | admin, kasir | `{id, reason?}` → status `dibatalkan` |
| `save_reminder_settings(payload)` | admin | `{jobType, intervalDays, active}` → upsert `reminder_settings` |
| `set_unit_service_interval(payload)` | admin | `{unitId, intervalDays?}` → override per unit; `null` = kembali ke default |
| `set_member_wa_opt_out(payload)` | admin, kasir | `{memberId, optOut}` |

- [x] **Step 1: Tulis RPC**

Setiap fungsi mengikuti kerangka yang sama dengan RPC lain di repo ini — cek `auth.uid()`, cek `jwt_role()`, validasi payload, tulis, lalu `insert into audit_logs`. Contoh satu yang mewakili:

```sql
create or replace function mark_wa_sent(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'Tidak terautentikasi'; end if;
  v_role := jwt_role();
  if v_role not in ('admin', 'kasir') then
    raise exception 'Hanya Admin/Kasir yang boleh menandai pesan terkirim';
  end if;
  if payload is null or jsonb_typeof(payload -> 'id') is distinct from 'string' then
    raise exception 'id wajib diisi';
  end if;
  v_id := (payload ->> 'id')::uuid;

  update wa_outbox
     set status = 'terkirim', sent_at = now(), sent_by = v_uid, provider = 'manual'
   where id = v_id and status = 'pending';
  if not found then
    raise exception 'Pesan tidak ditemukan atau sudah diproses';
  end if;

  -- Kolom audit_logs adalah (actor_uid, action, target, detail, at) —
  -- lihat 20260715000001_init_schema.sql:327 dan contoh di …0016:120.
  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'wa.sent', v_id::text,
          jsonb_build_object('kind', v_kind, 'memberId', v_member_id));

  return jsonb_build_object('ok', true);
end;
$$;
```

**Penting pada `save_reminder_settings`:** mengubah default **tidak** menulis ulang `next_service_date` unit yang sudah dijadwalkan — interval baru berlaku untuk servis berikutnya. Sebutkan ini di UI (Task 6) supaya admin tidak bingung kenapa jadwal lama tidak bergeser.

- [x] **Step 2: Kunci semua RPC baru**

```sql
revoke execute on function mark_wa_sent(jsonb) from anon, public;
grant  execute on function mark_wa_sent(jsonb) to authenticated;
-- ulangi untuk keempat RPC lainnya
```

- [x] **Step 3: Verifikasi peran**

Ulangi pola uji `LAPORAN_KEAMANAN_2026-08-06.md`: sebagai **teknisi**, panggil kelima RPC → semua harus ditolak dengan pesan Indonesia. Sebagai **kasir**, `save_reminder_settings` harus ditolak (admin-only) tapi `mark_wa_sent` harus berhasil.

- [x] **Step 4: Commit**

```bash
git add backend/supabase/migrations/20260815000026_reminder_rpc.sql
git commit -m "feat(db): RPC antrean WA + pengaturan interval pengingat"
```

---

## Task 5: Edge Function `send-wa` (kerangka adapter)

**Files:**
- Create: `backend/supabase/functions/send-wa/index.ts`

**Interfaces:**
- Meniru struktur `backend/supabase/functions/send-push/index.ts` — verifikasi header secret bersama, lalu kirim.
- Secret: `WA_WEBHOOK_SECRET`, dan (fase berikutnya) `WA_TOKEN` + `WA_PHONE_NUMBER_ID`.

- [x] **Step 1: Tulis fungsi dengan dua adapter**

Adapter dipilih dari `app_config` key `wa_adapter` (`'manual'` | `'cloud_api'`). Saat `'manual'`, fungsi **tidak mengirim apa pun** — ia hanya mengembalikan `{skipped: 'manual'}`, karena pengiriman dilakukan admin lewat wa.me di layar Pengingat. Kerangka ini sengaja dibuat sekarang supaya naik ke Cloud API nanti tidak menyentuh SQL maupun UI.

Isi cabang `cloud_api` dengan `POST https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages`, body `type: "template"`, lalu tulis balik `provider_message_id` / `error` ke `wa_outbox` via service-role client — persis pola yang sudah dipakai `send-push`.

- [x] **Step 2: Jangan sambungkan trigger dulu**

Selama adapter `manual`, **tidak ada** trigger `pg_net` ke fungsi ini. Baris `app_config` (`wa_function_url`, `wa_secret`) baru diisi saat pindah ke Cloud API — sama seperti pola no-op di `enqueue_push()` yang melewati kirim bila belum dikonfigurasi.

- [x] **Step 3: Commit**

```bash
git add backend/supabase/functions/send-wa
git commit -m "feat(edge): kerangka send-wa (adapter manual + slot Cloud API)"
```

---

## Task 6: Mobile — layar Pengingat, kirim WA, pengaturan interval

**Files:**
- Modify: `frontend/mobile/pubspec.yaml` (tambah `url_launcher`)
- Create: `frontend/mobile/lib/features/reminders/wa_outbox_screen.dart`
- Create: `frontend/mobile/lib/features/reminders/reminder_settings_screen.dart`
- Create: `frontend/mobile/lib/features/reminders/reminder_providers.dart`
- Create: `frontend/mobile/lib/data/models/wa_message.dart`
- Modify: `frontend/mobile/lib/core/router/app_router.dart`
- Modify: `frontend/mobile/lib/core/widgets/adaptive_scaffold.dart`
- Modify: `frontend/mobile/lib/features/members/unit_form_screen.dart`
- Test: `frontend/mobile/test/features/reminders/wa_outbox_screen_test.dart`, `test/data/wa_message_test.dart`

- [x] **Step 1: Tambah dependensi `url_launcher`**

Belum ada di `pubspec.yaml` — dependensi yang ada saat ini hanya `supabase_flutter`, `flutter_riverpod`, `go_router`, `mobile_scanner`, `image_picker`, `pdf`, `printing`, `firebase_core`, `firebase_messaging`.

```bash
cd frontend/mobile && flutter pub add url_launcher
```

- [x] **Step 2: Model `WaMessage`**

Ikuti pola `lib/data/models/ac_unit.dart` — `enum` dengan `value`/`label` untuk `kind` dan `status`, `_toDate()` untuk kolom `timestamptz`, `fromMap(String id, Map<String, dynamic> data)`.

Tambahkan getter yang menyusun URL WhatsApp:

```dart
/// Membuka WhatsApp dengan pesan sudah terisi. `phone` sudah dinormalisasi
/// ke 62xxx oleh `wa_phone()` di Postgres, jadi tak perlu diolah lagi di sini.
Uri get waUri => Uri.parse(
      'https://wa.me/$phone?text=${Uri.encodeComponent(body)}',
    );
```

- [x] **Step 3: Layar Pengingat (`/pengingat`)**

Daftar `wa_outbox` berstatus `pending`, terbaru di atas, pakai `.stream()` Realtime seperti `notifications_providers.dart` — antrean baru dari scheduler muncul sendiri. Tiap kartu: nama pelanggan, badge jenis (`Selesai Servis` / `Pengingat H-3` / `Terlambat 7 Hari`), daftar unit, dan cuplikan pesan.

Dua aksi per kartu:
- **Kirim via WhatsApp** → `launchUrl(msg.waUri, mode: LaunchMode.externalApplication)`, lalu panggil RPC `mark_wa_sent`. Urutannya penting: tandai terkirim **setelah** `launchUrl` mengembalikan `true`; kalau `false`, tampilkan pesan "WhatsApp tidak terpasang di perangkat ini" dan **jangan** ubah status.
- **Batalkan** → dialog konfirmasi dulu (BUG-08 di `LAPORAN_BUG_UI_QA_2026-08-05.md` persis soal aksi merusak tanpa konfirmasi), lalu RPC `cancel_wa_message`.

Pakai komponen yang sudah ada: `AppCard`, `StatusBadge`, `EmptyState`, `AppSkeleton`, `PageHeader`. Bungkus semua error RPC dengan `errorMessage()` (BUG-03).

- [x] **Step 4: Layar Pengaturan Pengingat**

Form interval per jenis job (`cuci`, `maintenance`) dalam satuan **bulan** di UI (dikali 30 jadi hari sebelum dikirim ke RPC — pelanggan bicara "2 bulan", bukan "60 hari"), plus switch aktif/nonaktif. Admin saja.

Wajib ada catatan di layar: *"Perubahan berlaku untuk servis berikutnya. Jadwal yang sudah tercatat tidak ikut bergeser."*

Pakai `AutovalidateMode.onUserInteraction` (BUG-09).

- [x] **Step 5: Override interval di form unit AC**

Tambah field opsional "Siklus servis khusus (bulan)" di `unit_form_screen.dart`, kosong = ikut default. Simpan lewat RPC `set_unit_service_interval`.

- [x] **Step 6: Rute & menu**

Tambah `/pengingat` dan `/pengingat/pengaturan` ke `app_router.dart`, lalu masukkan ke menu admin/kasir di `adaptive_scaffold.dart` — ikuti bentuk record yang sudah dipakai di sana, mis. `(icon: Icons.notifications_active_outlined, label: 'Pengingat', route: '/pengingat')`.

- [x] **Step 7: Test**

- `wa_message_test.dart` — `fromMap` untuk semua `kind`/`status`, dan `waUri` menghasilkan URL yang benar untuk pesan berisi newline, `&`, dan huruf beraksen.
- `wa_outbox_screen_test.dart` — daftar kosong menampilkan `EmptyState`; kartu menampilkan nama + badge; tombol Batalkan memunculkan dialog konfirmasi.

```bash
cd frontend/mobile && flutter analyze && flutter test
```

- [x] **Step 8: Commit**

```bash
git add frontend/mobile
git commit -m "feat(app): layar Pengingat servis + kirim WhatsApp + pengaturan interval"
```

---

## Task 7: Web — halaman Pengingat

**Files:**
- Create: `frontend/web/app/(app)/pengingat/page.tsx`
- Modify: `frontend/web/lib/rpc.ts`
- Modify: `frontend/web/app/(app)/[...slug]/page.tsx` (lepas `pengingat` dari placeholder bila terdaftar)

- [x] **Step 1: Tambah wrapper RPC**

Di `lib/rpc.ts`, tambah `markWaSent`, `cancelWaMessage` memakai `callRpc` yang sudah ada — jangan bikin helper baru.

- [x] **Step 2: Halaman `/pengingat`**

Server Component yang membaca `wa_outbox` berstatus `pending` (RLS sudah membatasi ke admin/kasir), plus Client Component kecil untuk dua tombol aksi. Tombol Kirim membuka `https://wa.me/...` di tab baru lalu memanggil RPC.

- [x] **Step 3: Commit**

```bash
git add frontend/web
git commit -m "feat(web): halaman Pengingat servis + kirim WhatsApp"
```

---

## Task 8: Dokumentasi

**Files:**
- Modify: `README.md`
- Modify: `docs/Flow-Sistem-EPOS-AC.md`

- [x] **Step 1: Perbarui README**

- Tambah `wa_outbox`, `reminder_settings` ke bagian Model Data & Status
- Tambah kelima RPC baru ke Kontrak RPC
- Tambah baris "Pengingat servis via WhatsApp" ke tabel Status Fitur (MVP)
- **Perbaiki baris yang sudah basi:** tabel itu masih menulis "FCM push menyusul" padahal FCM sudah aktif sejak commit `3b378e2`

- [x] **Step 2: Catat prosedur naik ke Cloud API**

Satu bagian pendek berisi urutannya: verifikasi bisnis Meta → daftarkan nomor khusus → ajukan 3 template (kategori **Utility**, redaksinya salin dari `build_wa_body()`) → `supabase secrets set WA_TOKEN …` → isi `app_config` (`wa_adapter='cloud_api'`, `wa_function_url`, `wa_secret`) → pasang trigger `pg_net` ke `send-wa`. Tegaskan: **tidak ada migrasi skema maupun perubahan UI** di langkah ini.

Catat juga biayanya supaya tidak kaget: tarif template Utility Indonesia ~Rp 340/pesan, tidak ada kuota gratis (jatah 1.000 percakapan/bulan sudah dihapus Meta per 1 Juli 2025), dan mulai 1 Oktober 2026 utility template di dalam service window pun mulai ditagih.

- [x] **Step 3: Commit**

```bash
git add README.md docs/Flow-Sistem-EPOS-AC.md
git commit -m "docs: pengingat servis WA + prosedur naik ke WhatsApp Cloud API"
```

---

## Di luar cakupan plan ini

- **Pengiriman otomatis penuh** — perlu approval Meta yang prosesnya administratif, bukan teknis. Kerangkanya sudah disiapkan Task 5.
- **Balasan pelanggan masuk ke sistem** (webhook inbound Cloud API → buat order otomatis). Ini fitur besar tersendiri.
- **Migrasi ke NestJS.** RPC di plan ini nanti ikut diport seperti RPC lain. Perlu diingat: `docs/superpowers/plans/2026-08-12-nestjs-backend.md` belum punya task untuk RPC mana pun di luar scaffold + auth, dan **belum ada plan migrasi untuk sisi mobile sama sekali**.
- **Pengingat lewat push FCM** sebagai pelengkap WA. Infrastrukturnya sudah ada (`notifications` + `send-push`), tapi pelanggan bukan pengguna aplikasi — mereka tidak punya akun, jadi tidak ada perangkat untuk dikirimi.
