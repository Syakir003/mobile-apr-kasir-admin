-- =============================================================================
-- Perbaikan bug hasil QA 5 Agu 2026. Empat masalah terpisah, satu migrasi
-- karena ketiganya menyentuh alur job/unit yang sama.
--
-- BUG A — Unit AC tersangkut `dalam_maintenance` selamanya.
--   `start` menandai unit `dalam_maintenance` untuk SEMUA jenis job, tapi
--   `complete` hanya mengembalikannya ke `aktif` bila jenisnya `pemasangan`.
--   Akibatnya setiap unit yang pernah dicuci/diservis selamanya tampil
--   "Dalam Maintenance" — tanpa jalan kembali lewat aplikasi.
--
-- BUG B — Unit juga tersangkut saat job DIBATALKAN, dan status order tidak
--   pernah dihitung ulang. Order dengan satu-satunya job dibatalkan tetap
--   berbadge "Terjadwal" selamanya.
--
-- BUG C — Filter Realtime pada kolom non-PK selalu gagal
--   ("invalid column for filter"). Supabase Realtime hanya mengizinkan filter
--   pada kolom yang ikut masuk WAL; dengan REPLICA IDENTITY DEFAULT itu cuma
--   primary key. Empat fitur mati total karenanya: daftar unit AC per member,
--   notifikasi in-app, riwayat pembayaran invoice, dan dropdown teknisi.
--
-- BUG D — `members.total_ac_units` melenceng. Kolom itu hanya ditambah oleh
--   `checkout_transaction` saat ada instalasi; unit yang ditambahkan manual
--   lewat menu Member tidak pernah menyentuhnya. Diubah jadi kolom TURUNAN
--   yang dijaga trigger, sehingga tak mungkin melenceng lagi dari sumber mana
--   pun — termasuk penambahan manual di `checkout_transaction` yang lama.
-- =============================================================================

-- =============================================================================
-- BUG C — REPLICA IDENTITY FULL untuk tabel yang di-filter pada kolom non-PK.
-- Biaya: baris lama ikut ditulis ke WAL saat UPDATE/DELETE. Tabel-tabel ini
-- kecil dan jarang diubah massal, jadi dampaknya dapat diabaikan.
-- `invoices` sengaja TIDAK diubah: client hanya memfilternya pada `id` (PK),
-- yang sudah tercakup replica identity default.
-- =============================================================================
alter table member_ac_units replica identity full;  -- filter: member_id
alter table notifications   replica identity full;  -- filter: user_id
alter table manual_payments replica identity full;  -- filter: invoice_id
alter table users           replica identity full;  -- filter: role

-- =============================================================================
-- BUG D — `members.total_ac_units` jadi kolom turunan.
--
-- Dua trigger bekerja berpasangan:
--   1. BEFORE INSERT/UPDATE pada `members` memaksa nilainya = jumlah baris
--      sebenarnya. Ini yang menetralkan penambahan manual `total_ac_units + n`
--      di dalam `checkout_transaction` (0005/0015) tanpa perlu menulis ulang
--      fungsi raksasa itu.
--   2. AFTER INSERT/UPDATE/DELETE pada `member_ac_units` menyentuh baris member
--      terkait supaya trigger (1) menghitung ulang.
-- =============================================================================
create index if not exists member_ac_units_member_id_idx
  on member_ac_units (member_id);

create or replace function members_sync_unit_count() returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  new.total_ac_units := (
    select count(*) from member_ac_units where member_id = new.id
  );
  return new;
end;
$$;

drop trigger if exists members_sync_unit_count_trg on members;
create trigger members_sync_unit_count_trg
  before insert or update on members
  for each row execute function members_sync_unit_count();

create or replace function member_ac_units_touch_member() returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_new uuid := null;
  v_old uuid := null;
begin
  -- `new`/`old` hanya sah pada operasi tertentu; salin dulu agar sisa logika
  -- tidak perlu bercabang.
  if tg_op in ('INSERT', 'UPDATE') then v_new := new.member_id; end if;
  if tg_op in ('UPDATE', 'DELETE') then v_old := old.member_id; end if;

  -- `updated_at` tidak ada di tabel ini; sentuh kolom yang pasti ada agar
  -- trigger BEFORE UPDATE di `members` ikut jalan dan menghitung ulang.
  if v_new is not null then
    update members set name = name where id = v_new;
  end if;
  -- Saat unit dipindah ke member lain, member lamanya ikut dihitung ulang.
  if v_old is not null and v_old is distinct from v_new then
    update members set name = name where id = v_old;
  end if;
  return null;
end;
$$;

drop trigger if exists member_ac_units_touch_member_trg on member_ac_units;
create trigger member_ac_units_touch_member_trg
  after insert or update or delete on member_ac_units
  for each row execute function member_ac_units_touch_member();

-- Perbaiki nilai yang sudah terlanjur melenceng.
update members m
   set total_ac_units = (
     select count(*) from member_ac_units u where u.member_id = m.id)
 where m.total_ac_units is distinct from (
     select count(*) from member_ac_units u where u.member_id = m.id);

-- =============================================================================
-- BUG A & B — update_technician_job_status DIDEFINISIKAN ULANG dari 0014.
--
-- Perubahan (sisanya identik):
--   * start    : hanya menandai `dalam_maintenance` bila unit sedang `aktif`,
--                supaya unit `rusak`/`nonaktif` tidak ikut tertimpa.
--   * complete : unit kembali `aktif` untuk SEMUA jenis job — `pemasangan`
--                tetap mengisi installation_date seperti sebelumnya.
--   * cancel   : unit dipulihkan ke `aktif`, status order dihitung ulang, dan
--                job yang sudah dibatalkan tidak bisa dibatalkan lagi.
-- =============================================================================
create or replace function update_technician_job_status(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_job_id uuid;
  v_action text;
  v_notes text;
  v_scanned text;
  v_job record;
  v_all_done boolean;
  v_any_done boolean;
  v_all_final boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'jobId') is distinct from 'string'
     or btrim(payload ->> 'jobId') = '' then
    raise exception 'jobId wajib diisi';
  end if;
  v_job_id := (payload ->> 'jobId')::uuid;
  v_action := payload ->> 'action';
  v_notes := nullif(btrim(coalesce(payload ->> 'notes', '')), '');
  v_scanned := nullif(btrim(coalesce(payload ->> 'scannedBarcode', '')), '');

  select j.id, j.order_id, j.unit_id, j.technician_id, j.type, j.status,
         u.barcode_value as unit_barcode
    into v_job
    from technician_jobs j
    left join member_ac_units u on u.id = j.unit_id
   where j.id = v_job_id;
  if not found then
    raise exception 'Job tidak ditemukan';
  end if;

  if v_role = 'teknisi' then
    if v_job.technician_id is distinct from v_uid then
      raise exception 'Job ini bukan milik Anda';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'Tidak diizinkan';
  end if;

  if v_action = 'start' then
    if v_job.status <> 'assigned' then
      raise exception 'Job harus berstatus Ditugaskan untuk dimulai';
    end if;
    -- Scan wajib hanya bila unit punya barcode (rule 8.2).
    if v_job.unit_id is not null and coalesce(v_job.unit_barcode, '') <> '' then
      if v_scanned is null then
        raise exception 'Scan barcode unit diperlukan sebelum memulai';
      end if;
      if v_scanned <> v_job.unit_barcode then
        raise exception 'Barcode tidak sesuai unit pada job ini';
      end if;
    end if;
    -- Foto SEBELUM wajib sebelum memulai (rule 8.3).
    if not exists (
      select 1 from job_photos where job_id = v_job_id and kind = 'sebelum'
    ) then
      raise exception 'Foto SEBELUM wajib diunggah sebelum memulai pekerjaan';
    end if;
    update technician_jobs
       set status = 'sedang_dikerjakan',
           started_at = now(),
           notes = coalesce(v_notes, notes)
     where id = v_job_id;
    update service_order_units set status = 'dalam_pengerjaan'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;
    if v_job.unit_id is not null then
      -- Hanya unit yang sedang `aktif` yang ditandai maintenance; unit `rusak`
      -- atau `menunggu_pemasangan` tidak boleh kehilangan statusnya.
      update member_ac_units set status = 'dalam_maintenance'
       where id = v_job.unit_id and status = 'aktif';
    end if;

  elsif v_action = 'complete' then
    if v_job.status <> 'sedang_dikerjakan' then
      raise exception 'Job harus Sedang Dikerjakan untuk diselesaikan';
    end if;
    if not exists (
      select 1 from job_photos where job_id = v_job_id and kind = 'sebelum'
    ) then
      raise exception 'Foto SEBELUM wajib diunggah sebelum menyelesaikan pekerjaan';
    end if;
    if not exists (
      select 1 from job_photos where job_id = v_job_id and kind = 'sesudah'
    ) then
      raise exception 'Foto SESUDAH wajib diunggah sebelum menyelesaikan pekerjaan';
    end if;
    if exists (
      select 1 from material_requests
       where job_id = v_job_id and status = 'pending'
    ) then
      raise exception 'Masih ada pengajuan tambahan yang belum diputuskan';
    end if;
    if exists (
      select 1 from material_requests
       where job_id = v_job_id and status = 'approved' and used_at is null
    ) then
      raise exception 'Tandai material yang disetujui sebagai dipakai sebelum menyelesaikan';
    end if;
    update technician_jobs
       set status = 'selesai',
           completed_at = now(),
           notes = coalesce(v_notes, notes)
     where id = v_job_id;
    update service_order_units set status = 'selesai'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;
    if v_job.unit_id is not null then
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
             last_service_date = now()
       where id = v_job.unit_id;
    end if;
    select bool_and(status = 'selesai') into v_all_done
      from service_order_units where order_id = v_job.order_id;
    if coalesce(v_all_done, true) then
      update service_orders set status = 'selesai' where id = v_job.order_id;
    end if;

  elsif v_action = 'cancel' then
    if v_role <> 'admin' then
      raise exception 'Hanya Admin yang boleh membatalkan job';
    end if;
    if v_job.status = 'selesai' then
      raise exception 'Job yang sudah selesai tidak bisa dibatalkan';
    end if;
    -- BUG: dulu job yang sudah dibatalkan masih bisa dibatalkan lagi dan
    -- menghasilkan baris audit ganda.
    if v_job.status = 'dibatalkan' then
      raise exception 'Job ini sudah dibatalkan';
    end if;
    update technician_jobs set status = 'dibatalkan' where id = v_job_id;
    update service_order_units set status = 'dibatalkan'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;
    -- BUG B: unit tidak boleh ikut tersangkut gara-gara pekerjaan yang batal.
    if v_job.unit_id is not null then
      update member_ac_units set status = 'aktif'
       where id = v_job.unit_id and status = 'dalam_maintenance';
    end if;
    -- BUG B: status order ikut ditutup bila tak ada lagi unit yang menggantung.
    select bool_and(status in ('selesai', 'dibatalkan')),
           bool_or(status = 'selesai')
      into v_all_final, v_any_done
      from service_order_units where order_id = v_job.order_id;
    if coalesce(v_all_final, true) then
      update service_orders
         set status = case when coalesce(v_any_done, false) then 'selesai'
                           else 'dibatalkan' end
       where id = v_job.order_id;
    end if;

  else
    raise exception 'Aksi tidak dikenal: %', v_action;
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'job.' || v_action, v_job_id::text,
          jsonb_build_object('notes', v_notes));

  return jsonb_build_object(
    'ok', true,
    'status', (select status from technician_jobs where id = v_job_id));
end;
$$;

revoke execute on function update_technician_job_status(jsonb) from anon, public;
grant execute on function update_technician_job_status(jsonb) to authenticated;

-- =============================================================================
-- BUG A — bersihkan unit yang sudah terlanjur tersangkut: berstatus
-- `dalam_maintenance` padahal tidak ada job aktif yang mengerjakannya.
-- =============================================================================
update member_ac_units u
   set status = 'aktif'
 where u.status = 'dalam_maintenance'
   and not exists (
     select 1 from technician_jobs j
      where j.unit_id = u.id
        and j.status in ('assigned', 'sedang_dikerjakan'));
