-- =============================================================================
-- Fase 8 — RPC untuk layar Pengingat (mobile & web).
--
-- Semua penulisan lewat RPC `security definer`; `wa_outbox` dan
-- `reminder_settings` hanya di-grant SELECT ke authenticated (migrasi 0023).
--
--   mark_wa_sent            (admin, kasir) : tandai pesan sudah dikirim
--   cancel_wa_message       (admin, kasir) : batalkan pesan di antrean
--   save_reminder_settings  (admin)        : ubah default siklus per jenis job
--   set_unit_service_interval (admin)      : override siklus satu unit AC
--   set_member_wa_opt_out   (admin, kasir) : pelanggan minta berhenti diingatkan
-- =============================================================================

-- ---------------------------------------------------------------- mark_wa_sent
-- Dipanggil SETELAH admin benar-benar menekan kirim di WhatsApp. Selama adapter
-- masih 'manual', hanya langkah inilah yang menutup satu baris antrean.
create or replace function mark_wa_sent(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_id   uuid;
  v_kind text;
  v_member_id uuid;
begin
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();
  if v_role not in ('admin', 'kasir') then
    raise exception 'Tidak diizinkan';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'id') is distinct from 'string'
     or btrim(payload ->> 'id') = '' then
    raise exception 'id wajib diisi';
  end if;
  v_id := (payload ->> 'id')::uuid;

  update wa_outbox
     set status   = 'terkirim',
         sent_at  = now(),
         sent_by  = v_uid,
         provider = 'manual'
   where id = v_id and status = 'pending'
  returning kind, member_id into v_kind, v_member_id;
  if not found then
    raise exception 'Pesan tidak ditemukan atau sudah diproses';
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'wa.sent', v_id::text,
          jsonb_build_object('kind', v_kind, 'memberId', v_member_id));

  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------- cancel_wa_message
create or replace function cancel_wa_message(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text;
  v_id     uuid;
  v_reason text;
  v_kind   text;
begin
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();
  if v_role not in ('admin', 'kasir') then
    raise exception 'Tidak diizinkan';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'id') is distinct from 'string'
     or btrim(payload ->> 'id') = '' then
    raise exception 'id wajib diisi';
  end if;
  v_id := (payload ->> 'id')::uuid;
  v_reason := nullif(btrim(coalesce(payload ->> 'reason', '')), '');

  update wa_outbox
     set status = 'dibatalkan',
         error  = v_reason
   where id = v_id and status = 'pending'
  returning kind into v_kind;
  if not found then
    raise exception 'Pesan tidak ditemukan atau sudah diproses';
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'wa.cancel', v_id::text,
          jsonb_build_object('kind', v_kind, 'reason', v_reason));

  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------ save_reminder_settings
-- PENTING: mengubah default TIDAK menulis ulang next_service_date unit yang
-- sudah dijadwalkan — interval baru berlaku mulai servis berikutnya. UI wajib
-- menyebutkan ini supaya admin tidak bingung jadwal lama tak ikut bergeser.
create or replace function save_reminder_settings(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_role     text;
  v_job_type text;
  v_days     integer;
  v_active   boolean;
begin
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();
  if v_role <> 'admin' then
    raise exception 'Hanya Admin yang boleh mengubah pengaturan pengingat';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;

  v_job_type := btrim(coalesce(payload ->> 'jobType', ''));
  -- Hanya jenis job yang benar-benar berulang. 'pemasangan', 'bongkar',
  -- 'bongkar_pasang', dan 'service' sekali kerja — tak ada siklus berikutnya.
  if v_job_type not in ('cuci', 'maintenance') then
    raise exception 'Jenis pekerjaan tidak bisa dijadwalkan ulang: %', v_job_type;
  end if;

  if jsonb_typeof(payload -> 'intervalDays') is distinct from 'number' then
    raise exception 'intervalDays wajib diisi';
  end if;
  v_days := (payload ->> 'intervalDays')::integer;
  if v_days < 7 or v_days > 730 then
    raise exception 'Siklus servis harus antara 7 dan 730 hari';
  end if;

  v_active := coalesce((payload ->> 'active')::boolean, true);

  insert into reminder_settings (job_type, interval_days, active, updated_at, updated_by)
  values (v_job_type, v_days, v_active, now(), v_uid)
  on conflict (job_type) do update
    set interval_days = excluded.interval_days,
        active        = excluded.active,
        updated_at    = now(),
        updated_by    = v_uid;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'reminder.settings', v_job_type,
          jsonb_build_object('intervalDays', v_days, 'active', v_active));

  return jsonb_build_object('ok', true);
end;
$$;

-- --------------------------------------------------- set_unit_service_interval
-- intervalDays null / tidak dikirim = hapus override, unit kembali ikut default.
create or replace function set_unit_service_interval(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text;
  v_unit_id uuid;
  v_days    integer;
begin
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();
  if v_role <> 'admin' then
    raise exception 'Hanya Admin yang boleh mengubah siklus servis unit';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'unitId') is distinct from 'string'
     or btrim(payload ->> 'unitId') = '' then
    raise exception 'unitId wajib diisi';
  end if;
  v_unit_id := (payload ->> 'unitId')::uuid;

  if jsonb_typeof(payload -> 'intervalDays') = 'number' then
    v_days := (payload ->> 'intervalDays')::integer;
    if v_days < 7 or v_days > 730 then
      raise exception 'Siklus servis harus antara 7 dan 730 hari';
    end if;
  else
    v_days := null;
  end if;

  update member_ac_units set service_interval_days = v_days where id = v_unit_id;
  if not found then
    raise exception 'Unit AC tidak ditemukan';
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'reminder.unit_interval', v_unit_id::text,
          jsonb_build_object('intervalDays', v_days));

  return jsonb_build_object('ok', true);
end;
$$;

-- -------------------------------------------------------- set_member_wa_opt_out
create or replace function set_member_wa_opt_out(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text;
  v_member_id uuid;
  v_opt_out   boolean;
begin
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();
  if v_role not in ('admin', 'kasir') then
    raise exception 'Tidak diizinkan';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'memberId') is distinct from 'string'
     or btrim(payload ->> 'memberId') = '' then
    raise exception 'memberId wajib diisi';
  end if;
  if jsonb_typeof(payload -> 'optOut') is distinct from 'boolean' then
    raise exception 'optOut wajib diisi';
  end if;
  v_member_id := (payload ->> 'memberId')::uuid;
  v_opt_out   := (payload ->> 'optOut')::boolean;

  update members set wa_opt_out = v_opt_out where id = v_member_id;
  if not found then
    raise exception 'Member tidak ditemukan';
  end if;

  -- Berhenti berarti berhenti: antrean yang belum terkirim ikut dibatalkan,
  -- supaya tidak ada pesan yang tetap terkirim setelah pelanggan minta stop.
  if v_opt_out then
    update wa_outbox
       set status = 'dibatalkan', error = 'Pelanggan opt-out'
     where member_id = v_member_id and status = 'pending';
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'reminder.opt_out', v_member_id::text,
          jsonb_build_object('optOut', v_opt_out));

  return jsonb_build_object('ok', true);
end;
$$;

-- =============================================================================
-- Kunci EXECUTE. Postgres memberi EXECUTE ke `public` secara default; tanpa
-- revoke, seluruh RPC di atas bisa dipanggil `anon` (temuan #1 migrasi 0020).
-- =============================================================================
revoke execute on function mark_wa_sent(jsonb) from anon, public;
grant  execute on function mark_wa_sent(jsonb) to authenticated;

revoke execute on function cancel_wa_message(jsonb) from anon, public;
grant  execute on function cancel_wa_message(jsonb) to authenticated;

revoke execute on function save_reminder_settings(jsonb) from anon, public;
grant  execute on function save_reminder_settings(jsonb) to authenticated;

revoke execute on function set_unit_service_interval(jsonb) from anon, public;
grant  execute on function set_unit_service_interval(jsonb) to authenticated;

revoke execute on function set_member_wa_opt_out(jsonb) from anon, public;
grant  execute on function set_member_wa_opt_out(jsonb) to authenticated;
