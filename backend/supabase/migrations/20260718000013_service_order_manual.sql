-- =============================================================================
-- Fase 6 — Order service/maintenance/cuci MANUAL (dok. fitur bab 11.1).
--
-- Sebelumnya order & job HANYA lahir dari checkout_transaction (jenis
-- 'pemasangan'). Akibatnya jasa aftersales inti — cuci, service, maintenance —
-- tidak pernah bisa dibuat. Migrasi ini menambah RPC `create_service_order`
-- agar admin/kasir bisa menjadwalkan pekerjaan pada unit AC milik member yang
-- sudah ada, dengan satu job per unit (pola sama blok pemasangan di 0005).
--
-- Sekaligus melengkapi service_orders dengan kolom `note` (keluhan) & jadwal.
-- Semua tulis lewat RPC SECURITY DEFINER; client hanya baca via `.select()`.
-- =============================================================================

-- Kolom keluhan & jadwal pada order (dipakai order manual; checkout biarkan null).
alter table service_orders
  add column if not exists note text,
  add column if not exists scheduled_date timestamptz;

-- =============================================================================
-- create_service_order(payload) — admin/kasir menjadwalkan pekerjaan pada unit
-- AC member yang sudah ada. Satu job per unit (menunggu_penugasan / assigned).
-- Payload: {
--   memberId, type: 'service'|'maintenance'|'cuci',
--   unitIds: [uuid, ...] (>=1, harus milik member),
--   technicianId?  (pra-tugaskan; harus teknisi aktif),
--   scheduledDate? (ISO timestamptz), note? (keluhan)
-- }
-- Return: { ok, orderId, jobCount }
-- =============================================================================
create or replace function create_service_order(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_member_id uuid;
  v_type text;
  v_tid uuid;
  v_sched timestamptz;
  v_note text;
  v_units jsonb;
  v_unit_id uuid;
  v_unit_member uuid;
  v_order_id uuid;
  v_job_status text;
  v_count integer := 0;
begin
  v_uid := assert_caller_role(array['admin', 'kasir'],
    'Hanya Admin/Kasir yang boleh membuat order service');

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;

  if jsonb_typeof(payload -> 'memberId') is distinct from 'string'
     or btrim(payload ->> 'memberId') = '' then
    raise exception 'memberId wajib diisi';
  end if;
  v_member_id := (payload ->> 'memberId')::uuid;

  v_type := btrim(coalesce(payload ->> 'type', ''));
  if v_type not in ('service', 'maintenance', 'cuci') then
    raise exception 'Jenis order harus service/maintenance/cuci';
  end if;

  v_tid := nullif(btrim(coalesce(payload ->> 'technicianId', '')), '')::uuid;
  v_note := nullif(btrim(coalesce(payload ->> 'note', '')), '');
  v_sched := nullif(btrim(coalesce(payload ->> 'scheduledDate', '')), '')::timestamptz;

  v_units := payload -> 'unitIds';
  if v_units is null or jsonb_typeof(v_units) <> 'array'
     or jsonb_array_length(v_units) = 0 then
    raise exception 'Pilih minimal satu unit AC';
  end if;

  -- Member harus ada & aktif.
  perform 1 from members where id = v_member_id and active;
  if not found then
    raise exception 'Member tidak ditemukan atau nonaktif';
  end if;

  -- Teknisi (bila dipra-tugaskan) harus role teknisi & aktif.
  if v_tid is not null then
    perform 1 from users where id = v_tid and role = 'teknisi' and active;
    if not found then
      raise exception 'Teknisi tidak valid atau nonaktif';
    end if;
  end if;

  v_job_status := case when v_tid is not null then 'assigned'
                       else 'menunggu_penugasan' end;

  insert into service_orders
    (member_id, transaction_id, invoice_id, type, status, note,
     scheduled_date, created_by)
  values
    (v_member_id, null, null, v_type, 'terjadwal', v_note, v_sched, v_uid)
  returning id into v_order_id;

  for v_unit_id in
    select (value #>> '{}')::uuid from jsonb_array_elements(v_units)
  loop
    -- Unit harus milik member ini.
    select member_id into v_unit_member
      from member_ac_units where id = v_unit_id;
    if not found then
      raise exception 'Unit AC tidak ditemukan';
    end if;
    if v_unit_member is distinct from v_member_id then
      raise exception 'Unit AC bukan milik member tersebut';
    end if;

    insert into service_order_units (order_id, unit_id, status)
    values (v_order_id, v_unit_id, 'terjadwal');

    insert into technician_jobs
      (order_id, member_id, unit_id, technician_id, type, status,
       scheduled_date, created_by)
    values
      (v_order_id, v_member_id, v_unit_id, v_tid, v_type, v_job_status,
       v_sched, v_uid);

    v_count := v_count + 1;
  end loop;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'order.create', v_order_id::text,
          jsonb_build_object('type', v_type, 'jobs', v_count,
                             'technicianId', v_tid));

  return jsonb_build_object('ok', true, 'orderId', v_order_id, 'jobCount', v_count);
end;
$$;
