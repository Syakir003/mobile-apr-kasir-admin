-- =============================================================================
-- Fase 5 — Workflow Job Teknisi & Order Service.
--
-- Tabel service_orders / service_order_units / technician_jobs SUDAH dibuat di
-- 0001 dan diisi otomatis oleh checkout_transaction (0005) saat produk dijual
-- dengan jasa pasang. Migrasi ini melengkapi sisi operasional:
--   * kolom diagnosa/timestamp pada technician_jobs,
--   * RPC penugasan teknisi (admin/kasir) & transisi status job (teknisi/admin).
--
-- Client membaca tabel ini via `.select()` (GRANT SELECT sudah ada di 0006),
-- BUKAN realtime `.stream()` — jadi tak perlu menambah publication realtime
-- (menghindari RealtimeSubscribeException bila tabel belum terdaftar). Layar
-- menyegarkan lewat invalidate manual setelah aksi.
--
-- Semua tulis tetap lewat RPC SECURITY DEFINER (pola sama record_payment 0005)
-- sehingga tidak butuh GRANT insert/update tabel ke `authenticated`.
-- =============================================================================

-- --------------------------------------------------------------- kolom job
alter table technician_jobs
  add column if not exists notes text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

-- =============================================================================
-- assign_technician_job(payload) — admin/kasir menugaskan/mengganti teknisi.
-- Payload: { jobId, technicianId? }  (technicianId kosong = lepas penugasan)
-- =============================================================================
create or replace function assign_technician_job(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_job_id uuid;
  v_tid uuid;
  v_ok boolean;
begin
  v_uid := assert_caller_role(
    array['admin', 'kasir'], 'Hanya Admin/Kasir yang boleh menugaskan teknisi');

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'jobId') is distinct from 'string'
     or btrim(payload ->> 'jobId') = '' then
    raise exception 'jobId wajib diisi';
  end if;

  v_job_id := (payload ->> 'jobId')::uuid;
  v_tid := nullif(btrim(coalesce(payload ->> 'technicianId', '')), '')::uuid;

  -- Teknisi (bila diisi) harus role teknisi & aktif.
  if v_tid is not null then
    select true into v_ok
      from users where id = v_tid and role = 'teknisi' and active;
    if not found then
      raise exception 'Teknisi tidak valid atau nonaktif';
    end if;
  end if;

  update technician_jobs
     set technician_id = v_tid,
         status = case when v_tid is not null then 'assigned'
                       else 'menunggu_penugasan' end
   where id = v_job_id
     and status in ('menunggu_penugasan', 'assigned');
  if not found then
    raise exception 'Job tidak ditemukan atau sudah dikerjakan';
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'job.assign', v_job_id::text,
          jsonb_build_object('technicianId', v_tid));

  return jsonb_build_object('ok', true);
end;
$$;

-- =============================================================================
-- update_technician_job_status(payload) — transisi status job.
-- Payload: { jobId, action: 'start'|'complete'|'cancel', notes?, scannedBarcode? }
--
-- Aturan (dok. fitur 8.2 & 8.3):
--   * teknisi hanya boleh menggarap job miliknya; admin boleh semua.
--   * start  : job harus 'assigned'; wajib scan barcode cocok unit (rule 8.2).
--   * complete: job harus 'sedang_dikerjakan'; update histori unit & order.
--   * cancel : hanya admin; job belum selesai.
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
