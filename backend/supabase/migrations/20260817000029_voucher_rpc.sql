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
