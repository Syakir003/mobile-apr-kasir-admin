-- =============================================================================
-- Fase 5 — Foto bukti pengerjaan (sebelum & sesudah).
--
-- Dok. fitur: teknisi WAJIB melampirkan foto kondisi SEBELUM dan SESUDAH tiap
-- pekerjaan. File biner diunggah langsung oleh client ke bucket Storage privat
-- `job-photos`; baris metadata (`job_photos`) dicatat lewat RPC SECURITY DEFINER
-- `add_job_photo` (pola sama assign_technician_job 0007) sehingga tak butuh
-- GRANT insert tabel ke `authenticated`.
--
-- Otorisasi berlapis:
--   * Storage RLS  : hanya teknisi/admin boleh upload ke bucket; semua user
--                    login boleh baca (untuk createSignedUrl).
--   * add_job_photo: memastikan pemanggil admin ATAU teknisi pemilik job.
--   * update_technician_job_status: `complete` ditolak bila foto sebelum/sesudah
--                    belum lengkap (definisi ulang fungsi dari 0007).
--
-- Client membaca `job_photos` via `.select()` (GRANT SELECT + RLS baca), lalu
-- membuat signed URL per `path` untuk menampilkan gambar.
-- =============================================================================

-- ------------------------------------------------------------- tabel job_photos
create table if not exists job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references technician_jobs (id) on delete cascade,
  kind text not null check (kind in ('sebelum', 'sesudah')),
  path text not null,               -- object path dalam bucket `job-photos`
  uploaded_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index if not exists job_photos_job_idx on job_photos (job_id);

alter table job_photos enable row level security;

-- Baca: semua user login (sejalan dgn technician_jobs 0003). Tulis: via RPC.
grant select on job_photos to authenticated;
create policy "job photos: baca user login"
  on job_photos for select to authenticated using (true);

-- --------------------------------------------------------------- bucket Storage
-- Privat: gambar hanya bisa diakses via signed URL. Batas 10MB, hanya gambar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-photos', 'job-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Storage RLS (tabel storage.objects). Upload dibatasi teknisi/admin; baca untuk
-- semua user login agar signed URL bisa dibuat. Tak ada update/delete client.
create policy "job-photos: baca user login"
  on storage.objects for select to authenticated
  using (bucket_id = 'job-photos');

create policy "job-photos: upload teknisi/admin"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-photos' and jwt_role() in ('teknisi', 'admin')
  );

-- =============================================================================
-- add_job_photo(payload) — catat metadata foto setelah client upload ke Storage.
-- Payload: { jobId, kind: 'sebelum'|'sesudah', path }
-- Otorisasi: admin (semua job) atau teknisi pemilik job.
-- =============================================================================
create or replace function add_job_photo(payload jsonb)
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
  v_kind text;
  v_path text;
  v_owner uuid;
  v_status text;
  v_id uuid;
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
  v_kind := btrim(coalesce(payload ->> 'kind', ''));
  v_path := btrim(coalesce(payload ->> 'path', ''));

  if v_kind not in ('sebelum', 'sesudah') then
    raise exception 'Jenis foto harus sebelum/sesudah';
  end if;
  if v_path = '' then
    raise exception 'path foto wajib diisi';
  end if;

  select technician_id, status into v_owner, v_status
    from technician_jobs where id = v_job_id;
  if not found then
    raise exception 'Job tidak ditemukan';
  end if;

  -- Teknisi hanya boleh untuk job miliknya; admin bebas. Kasir tak boleh.
  if v_role = 'teknisi' then
    if v_owner is distinct from v_uid then
      raise exception 'Job ini bukan milik Anda';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'Tidak diizinkan mengunggah foto';
  end if;

  -- Hanya selama job aktif (ditugaskan/dikerjakan) — bukan setelah selesai/batal.
  if v_status not in ('assigned', 'sedang_dikerjakan') then
    raise exception 'Foto hanya bisa ditambahkan saat job aktif';
  end if;

  insert into job_photos (job_id, kind, path, uploaded_by)
  values (v_job_id, v_kind, v_path, v_uid)
  returning id into v_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'job.photo', v_job_id::text,
          jsonb_build_object('kind', v_kind, 'path', v_path));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- =============================================================================
-- update_technician_job_status(payload) — DEFINISI ULANG dari 0007.
-- Tambahan: aksi `complete` menolak bila foto sebelum/sesudah belum lengkap.
-- Sisanya identik dengan 0007.
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
    if v_job.unit_id is not null then
      if v_scanned is null then
        raise exception 'Scan barcode unit diperlukan sebelum memulai';
      end if;
      if v_scanned <> coalesce(v_job.unit_barcode, '') then
        raise exception 'Barcode tidak sesuai unit pada job ini';
      end if;
    end if;
    update technician_jobs
       set status = 'sedang_dikerjakan',
           started_at = now(),
           notes = coalesce(v_notes, notes)
     where id = v_job_id;
    update service_order_units set status = 'dalam_pengerjaan'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;
    if v_job.unit_id is not null then
      update member_ac_units set status = 'dalam_maintenance'
       where id = v_job.unit_id;
    end if;

  elsif v_action = 'complete' then
    if v_job.status <> 'sedang_dikerjakan' then
      raise exception 'Job harus Sedang Dikerjakan untuk diselesaikan';
    end if;
    -- Foto bukti wajib lengkap (dok. fitur: foto sebelum & sesudah).
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
    update technician_jobs
       set status = 'selesai',
           completed_at = now(),
           notes = coalesce(v_notes, notes)
     where id = v_job_id;
    update service_order_units set status = 'selesai'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;
    if v_job.unit_id is not null then
      update member_ac_units
         set status = case when v_job.type = 'pemasangan' then 'aktif'
                           else status end,
             installation_date = case when v_job.type = 'pemasangan'
                                      then coalesce(installation_date, now())
                                      else installation_date end,
             last_service_date = now()
       where id = v_job.unit_id;
    end if;
    -- Order dianggap selesai bila semua unitnya selesai.
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
    update technician_jobs set status = 'dibatalkan' where id = v_job_id;
    update service_order_units set status = 'dibatalkan'
     where order_id = v_job.order_id and unit_id is not distinct from v_job.unit_id;

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
