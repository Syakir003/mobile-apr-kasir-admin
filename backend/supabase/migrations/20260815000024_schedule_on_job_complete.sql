-- =============================================================================
-- Fase 8 — Jadwalkan servis berikutnya + antre pesan konfirmasi saat job selesai.
--
-- update_technician_job_status DIDEFINISIKAN ULANG dari 0019. Seluruh isi
-- fungsi identik dengan versi itu (termasuk perbaikan BUG A & B dari QA);
-- yang berubah HANYA blok `if v_job.unit_id is not null then` di cabang
-- 'complete', plus tiga variabel baru di blok declare.
--
-- Kenapa redefinisi fungsi, bukan trigger terpisah di technician_jobs:
-- penjadwalan harus atomik dengan penyelesaian job (satu transaksi), dan blok
-- yang menulis last_service_date sudah persis berada di tempat yang benar.
-- Trigger terpisah justru memecah logika ke dua tempat.
--
-- Catatan: last_service_date sudah diisi otomatis sejak 0007 dan tidak diubah
-- di sini. Yang baru adalah next_service_date + baris antrean WhatsApp.
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
  -- Fase 8 — penjadwalan servis berikutnya.
  v_interval integer;
  v_member_id uuid;
  v_next timestamptz;
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
      -- FASE 8: siklus servis berikutnya. 0 = jenis job ini memang tak
      -- dijadwalkan (pemasangan/bongkar/service) -> next_service_date
      -- DIKOSONGKAN, supaya jadwal lama tidak tertinggal dan mengirim
      -- pengingat palsu setelah unit dibongkar atau diperbaiki.
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

      -- FASE 8: pesan konfirmasi "pekerjaan selesai". Hanya untuk unit yang
      -- memang punya siklus berikutnya, milik member aktif yang tidak opt-out.
      -- dedupe_key 'job:<id>' menjamin satu job hanya pernah menghasilkan satu
      -- pesan, berapa kali pun RPC ini terpanggil ulang.
      if v_interval > 0 and v_member_id is not null then
        insert into wa_outbox (member_id, member_name, phone, kind, unit_ids,
                               due_date, body, dedupe_key)
        select v_member_id, m.name, wa_phone(m.phone), 'selesai_servis',
               array[v_job.unit_id], v_next::date,
               build_wa_body(v_member_id, 'selesai_servis',
                             array[v_job.unit_id], v_next::date),
               'job:' || v_job_id::text
          from members m
         where m.id = v_member_id
           and m.active
           and not m.wa_opt_out
           and wa_phone(m.phone) <> ''
        on conflict (dedupe_key) do nothing;
      end if;
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
