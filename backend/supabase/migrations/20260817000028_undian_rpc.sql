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
