-- =============================================================================
-- Fase 6 — Hardening keamanan (hasil uji penetrasi 06 Agu 2026).
--
-- Dua kelas temuan yang diperbaiki di sini:
--
--   1. EXECUTE bocor ke `anon`. Migrasi 0007-0015 membuat fungsi BARU tanpa
--      `revoke execute ... from anon, public`. PostgreSQL memberi EXECUTE ke
--      PUBLIC secara default untuk fungsi baru, jadi 12 fungsi SECURITY DEFINER
--      bisa dipanggil siapa pun yang punya anon key (anon key memang ikut dalam
--      binary aplikasi — bukan rahasia). Uji membuktikan semuanya masih ditolak
--      di dalam badan fungsi (`assert_caller_role` / cek `auth.uid()`), jadi ini
--      lapisan kedua, bukan lubang aktif. Tetap ditutup: satu fungsi baru yang
--      lupa cek auth langsung jadi lubang publik.
--      Catatan: `create or replace` pada fungsi yang SUDAH ada mempertahankan
--      ACL lama — itu sebabnya record_payment/checkout_transaction tetap aman
--      meski di-replace di 0014/0015.
--
--   2. Baca lintas-teknisi terlalu longgar. Policy 0003/0008/0009 memakai
--      `using (true)` untuk technician_jobs, service_orders, job_photos,
--      material_requests, dan members. Akibatnya SATU akun teknisi bisa menarik
--      SELURUH basis pelanggan (nama, HP, alamat), seluruh job & catatan
--      diagnosa teknisi lain, seluruh foto lokasi pelanggan, dan seluruh
--      pengajuan material beserta nilai rupiahnya — cukup lewat REST API dengan
--      token miliknya sendiri, tanpa menyentuh UI.
--
-- Prinsip perbaikan: teknisi tetap dapat data OPERASIONAL yang dia butuhkan,
-- tapi tidak lagi bisa mengenumerasi data KOMERSIAL & PRIBADI milik orang lain.
--   * job/foto  : job miliknya + job lain PADA UNIT YANG SAMA. Yang kedua
--                 sengaja dipertahankan — riwayat service per unit (dok. §8.1)
--                 memang harus lintas-teknisi supaya teknisi tahu apa yang
--                 pernah dikerjakan pada unit sebelum mulai.
--   * member    : hanya pelanggan yang punya job untuk dia (butuh nama/HP/
--                 alamat untuk datang ke lokasi). Bukan seluruh basis pelanggan.
--   * pengajuan : hanya pengajuan pada job miliknya — isinya nilai rupiah.
--   * order     : hanya order yang menaungi job miliknya.
--   * unit AC   : SENGAJA tetap terbuka untuk semua user login. Layar scan
--                 barcode harus bisa melookup unit apa pun sebelum penugasan,
--                 dan isinya (merek/model/PK/ruangan) bukan data pribadi.
--
-- admin & kasir tidak berubah sama sekali.
-- =============================================================================

-- =============================================================================
-- 1. Tutup EXECUTE dari anon/public
-- =============================================================================
revoke execute on function assign_technician_job(jsonb) from anon, public;
grant  execute on function assign_technician_job(jsonb) to authenticated;

revoke execute on function add_job_photo(jsonb) from anon, public;
grant  execute on function add_job_photo(jsonb) to authenticated;

revoke execute on function submit_material_request(jsonb) from anon, public;
grant  execute on function submit_material_request(jsonb) to authenticated;

revoke execute on function decide_material_request(jsonb) from anon, public;
grant  execute on function decide_material_request(jsonb) to authenticated;

revoke execute on function mark_material_used(jsonb) from anon, public;
grant  execute on function mark_material_used(jsonb) to authenticated;

revoke execute on function mark_notifications_read(jsonb) from anon, public;
grant  execute on function mark_notifications_read(jsonb) to authenticated;

revoke execute on function register_device_token(jsonb) from anon, public;
grant  execute on function register_device_token(jsonb) to authenticated;

revoke execute on function unregister_device_token(jsonb) from anon, public;
grant  execute on function unregister_device_token(jsonb) to authenticated;

revoke execute on function create_service_order(jsonb) from anon, public;
grant  execute on function create_service_order(jsonb) to authenticated;

-- Fungsi trigger: tak pernah dipanggil client. Tutup total.
revoke execute on function enqueue_push() from anon, authenticated, public;
revoke execute on function handle_new_user() from anon, authenticated, public;
revoke execute on function notify_job_assigned() from anon, authenticated, public;
revoke execute on function notify_request_submitted() from anon, authenticated, public;
revoke execute on function notify_request_decided() from anon, authenticated, public;
revoke execute on function members_sync_unit_count() from anon, authenticated, public;
revoke execute on function member_ac_units_touch_member() from anon, authenticated, public;

-- Helper murni (tanpa akses data) — cukup ditutup dari anon.
-- `revoke ... from anon` saja TIDAK cukup: hibah bawaan menempel pada PUBLIC,
-- dan anon mewarisinya. Harus dicabut dari PUBLIC lalu diberikan ulang ke
-- authenticated — policy RLS & storage memanggil jwt_role() sebagai pemanggil.
revoke execute on function jwt_role() from anon, public;
grant  execute on function jwt_role() to authenticated;
revoke execute on function normalize_phone(text) from anon, public;
revoke execute on function business_date_key() from anon, public;
-- Tanda tangan 3-argumen dari 0014 (versi 2-argumen 0005 sudah tak ada).
revoke execute on function
  compute_invoice_status(integer, integer, invoice_status) from anon, public;
revoke execute on function service_job_type(text) from anon, public;

-- =============================================================================
-- 2. Helper cakupan teknisi
--
-- SECURITY DEFINER (pemilik = postgres) supaya query di dalamnya TIDAK ikut
-- dievaluasi RLS technician_jobs — kalau invoker, policy technician_jobs akan
-- memanggil dirinya sendiri dan menghasilkan rekursi tak berujung.
-- STABLE supaya planner mengangkatnya jadi InitPlan: dieksekusi sekali per
-- query, bukan sekali per baris.
-- =============================================================================

-- Job milik teknisi yang login, beserta member/unit/order yang menempel padanya.
create or replace function my_job_scope()
returns table (job_id uuid, member_id uuid, unit_id uuid, order_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select j.id, j.member_id, j.unit_id, j.order_id
    from technician_jobs j
   where j.technician_id = auth.uid();
$$;

-- Job yang boleh DILIHAT teknisi: miliknya sendiri + job lain pada unit yang
-- sama (bahan riwayat service per unit).
create or replace function my_visible_job_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select j.id
    from technician_jobs j
   where j.technician_id = auth.uid()
      or (j.unit_id is not null and j.unit_id in (
            select k.unit_id
              from technician_jobs k
             where k.technician_id = auth.uid()
               and k.unit_id is not null));
$$;

revoke execute on function my_job_scope() from anon, public;
grant  execute on function my_job_scope() to authenticated;
revoke execute on function my_visible_job_ids() from anon, public;
grant  execute on function my_visible_job_ids() to authenticated;

-- =============================================================================
-- 3. Perketat policy baca
--
-- Beberapa policy permissive di-OR-kan Postgres, jadi tiap tabel dipecah dua:
-- satu untuk admin/kasir (tak berubah), satu untuk teknisi (dibatasi).
-- =============================================================================

-- ------------------------------------------------------------ technician_jobs
drop policy if exists "technician jobs: baca user login" on technician_jobs;
drop policy if exists "technician jobs: baca admin/kasir" on technician_jobs;
drop policy if exists "technician jobs: baca teknisi (job & unit miliknya)"
  on technician_jobs;

create policy "technician jobs: baca admin/kasir"
  on technician_jobs for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

create policy "technician jobs: baca teknisi (job & unit miliknya)"
  on technician_jobs for select to authenticated
  using (jwt_role() = 'teknisi' and id in (select my_visible_job_ids()));

-- ------------------------------------------------------------------- members
drop policy if exists "members: baca user login" on members;
drop policy if exists "members: baca admin/kasir" on members;
drop policy if exists "members: baca teknisi (pelanggan job miliknya)" on members;

create policy "members: baca admin/kasir"
  on members for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

create policy "members: baca teknisi (pelanggan job miliknya)"
  on members for select to authenticated
  using (jwt_role() = 'teknisi'
         and id in (select s.member_id from my_job_scope() s
                     where s.member_id is not null));

-- -------------------------------------------------------------- job_photos
drop policy if exists "job photos: baca user login" on job_photos;
drop policy if exists "job photos: baca admin/kasir" on job_photos;
drop policy if exists "job photos: baca teknisi (job terlihat)" on job_photos;

create policy "job photos: baca admin/kasir"
  on job_photos for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

create policy "job photos: baca teknisi (job terlihat)"
  on job_photos for select to authenticated
  using (jwt_role() = 'teknisi' and job_id in (select my_visible_job_ids()));

-- -------------------------------------------------------- material_requests
-- Lebih ketat dari job: isinya nilai rupiah, jadi hanya job MILIKNYA (bukan
-- job tetangga pada unit yang sama).
drop policy if exists "material requests: baca user login" on material_requests;
drop policy if exists "material requests: baca admin/kasir" on material_requests;
drop policy if exists "material requests: baca teknisi (job miliknya)"
  on material_requests;

create policy "material requests: baca admin/kasir"
  on material_requests for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

create policy "material requests: baca teknisi (job miliknya)"
  on material_requests for select to authenticated
  using (jwt_role() = 'teknisi'
         and job_id in (select s.job_id from my_job_scope() s));

-- --------------------------------------------------- material_request_items
-- Ikut induknya: subquery ke material_requests tetap kena RLS di atas.
drop policy if exists "material request items: baca user login"
  on material_request_items;
drop policy if exists "material request items: baca sesuai induk"
  on material_request_items;

create policy "material request items: baca sesuai induk"
  on material_request_items for select to authenticated
  using (request_id in (select r.id from material_requests r));

-- ---------------------------------------------------------- service_orders
drop policy if exists "service orders: baca user login" on service_orders;
drop policy if exists "service orders: baca admin/kasir" on service_orders;
drop policy if exists "service orders: baca teknisi (order job miliknya)"
  on service_orders;

create policy "service orders: baca admin/kasir"
  on service_orders for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

create policy "service orders: baca teknisi (order job miliknya)"
  on service_orders for select to authenticated
  using (jwt_role() = 'teknisi'
         and id in (select s.order_id from my_job_scope() s));

-- ----------------------------------------------------- service_order_units
drop policy if exists "service order units: baca user login" on service_order_units;
drop policy if exists "service order units: baca sesuai induk" on service_order_units;

create policy "service order units: baca sesuai induk"
  on service_order_units for select to authenticated
  using (order_id in (select o.id from service_orders o));

-- =============================================================================
-- 4. Index penunjang
--
-- Policy teknisi menyaring lewat technician_jobs.technician_id (sudah ada index
-- 0001) dan technician_jobs.unit_id (BELUM ada) — tanpa ini my_visible_job_ids()
-- jadi seq scan pada setiap query job.
-- =============================================================================
create index if not exists technician_jobs_unit_idx
  on technician_jobs (unit_id);
create index if not exists technician_jobs_member_idx
  on technician_jobs (member_id);
create index if not exists job_photos_job_kind_idx
  on job_photos (job_id, kind);
