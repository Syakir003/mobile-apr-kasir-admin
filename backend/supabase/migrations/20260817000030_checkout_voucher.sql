-- =============================================================================
-- Fase 9 lanjutan — checkout_transaction menerima voucherCode opsional.
--
-- Validasi & perhitungan potongan sepenuhnya di server (kode invalid/expired/
-- sudah dipakai/tidak cocok pelanggan → transaksi gagal total, tidak checkout
-- diam-diam tanpa voucher). Potongan voucher DITAMBAHKAN ke `discount` manual
-- yang sudah ada (v_discount := v_discount + v_voucher_discount) — kolom
-- `discount` di transactions/invoices tetap satu, tidak ada kolom baru.
--
-- Perubahan dari versi 20260718000015:
--   1. Validasi voucherCode ditambah di blok field opsional.
--   2. Blok "member (cari/buat)" DIPINDAH ke sebelum "hitung total" (semula
--      sesudah) karena validasi voucher butuh v_member_id lebih dulu.
--   3. Blok voucher baru disisipkan setelah member, sebelum hitung total.
--   4. Setelah invoice lahir, voucher yang dipakai ditandai 'terpakai'.
--   5. audit_logs menyertakan voucherId.
-- Sisanya (validasi item/installations/serviceUnits, baca master, validasi
-- teknisi, insert item/stock/order/job) IDENTIK dengan versi sebelumnya.
-- =============================================================================

create or replace function checkout_transaction(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_customer jsonb;
  v_items jsonb;
  v_installations jsonb;
  v_service_units jsonb;
  v_item jsonb;
  v_inst jsonb;
  v_svc jsonb;
  v_idx integer;
  v_n_items integer;

  v_kinds text[] := '{}';
  v_ref_ids uuid[] := '{}';
  v_qtys numeric[] := '{}';
  v_names text[] := '{}';
  v_units text[] := '{}';
  v_prices integer[] := '{}';
  v_line_totals integer[] := '{}';
  v_brands text[] := '{}';
  v_types text[] := '{}';
  v_pks numeric[] := '{}';
  v_seen text[] := '{}';
  v_inst_count integer[];
  v_svc_count integer[];
  v_categories text[] := '{}';

  v_seen_svc text[] := '{}';
  v_job_types text[] := '{}';
  v_job_order_ids uuid[] := '{}';
  v_job_type text;
  v_job_pos integer;
  v_svc_unit_id uuid;
  v_svc_unit_member uuid;
  v_n_svc integer := 0;

  v_kind text;
  v_ref_raw text;
  v_ref uuid;
  v_qty numeric;
  v_name text;
  v_active boolean;
  v_stock numeric;
  v_price integer;
  v_brand text;
  v_type text;
  v_pk numeric;
  v_unit text;
  v_category text;

  v_tid_raw text;
  v_tid uuid;
  v_tech_role text;
  v_tech_active boolean;
  v_seen_tech text[] := '{}';

  v_discount integer := 0;
  v_tax_percent numeric := 0;
  v_transport_fee integer := 0;
  v_notes text;
  v_subtotal integer := 0;
  v_tax_base integer;
  v_tax_amount integer;
  v_grand_total integer;

  v_phone text;
  v_member_id uuid;
  v_n_inst integer := 0;

  v_date_key text;
  v_inv_seq integer;
  v_invoice_number text;
  v_transaction_id uuid;
  v_invoice_id uuid;
  v_order_id uuid;
  v_unit_id uuid;
  v_unit_seq integer;
  v_barcode text;
  v_room text;

  -- ----------------------------------------------------------- voucher (baru)
  v_voucher_code_raw text;
  v_voucher_id uuid;
  v_voucher_member uuid;
  v_voucher_type text;
  v_voucher_value integer;
  v_voucher_cap integer;
  v_voucher_min integer;
  v_voucher_expires timestamptz;
  v_voucher_status text;
  v_voucher_discount integer := 0;
begin
  v_uid := assert_caller_role(array['admin', 'kasir'], 'Hanya Admin/Kasir');

  -- ------------------------------------------------ validasi payload
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;

  v_customer := payload -> 'customer';
  if v_customer is null or jsonb_typeof(v_customer) <> 'object' then
    raise exception 'Data pelanggan wajib diisi';
  end if;
  if jsonb_typeof(v_customer -> 'name') is distinct from 'string'
     or btrim(v_customer ->> 'name') = '' then
    raise exception 'Nama pelanggan wajib diisi';
  end if;
  if jsonb_typeof(v_customer -> 'phone') is distinct from 'string'
     or btrim(v_customer ->> 'phone') = '' then
    raise exception 'Nomor telepon wajib diisi';
  end if;
  if v_customer ? 'address'
     and jsonb_typeof(v_customer -> 'address') <> 'string' then
    raise exception 'Alamat tidak valid';
  end if;

  v_items := payload -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) < 1 then
    raise exception 'Minimal 1 item wajib diisi';
  end if;
  v_n_items := jsonb_array_length(v_items);

  for v_item, v_idx in
    select value, ordinality from jsonb_array_elements(v_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Item tidak valid';
    end if;
    v_kind := v_item ->> 'kind';
    if jsonb_typeof(v_item -> 'kind') is distinct from 'string'
       or v_kind not in ('product', 'sparepart', 'service') then
      raise exception 'Jenis item tidak dikenal';
    end if;
    v_ref_raw := v_item ->> 'refId';
    if jsonb_typeof(v_item -> 'refId') is distinct from 'string'
       or v_ref_raw = '' then
      raise exception 'refId item wajib diisi';
    end if;
    if jsonb_typeof(v_item -> 'qty') is distinct from 'number' then
      raise exception 'Qty item harus lebih dari 0';
    end if;
    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty <= 0 then
      raise exception 'Qty item harus lebih dari 0';
    end if;
    if v_kind = 'product' and v_qty <> trunc(v_qty) then
      raise exception 'Qty produk harus bilangan bulat';
    end if;
    if (v_kind || ':' || v_ref_raw) = any (v_seen) then
      raise exception 'Item duplikat';
    end if;
    v_seen := v_seen || (v_kind || ':' || v_ref_raw);

    begin
      v_ref := v_ref_raw::uuid;
    exception when invalid_text_representation then
      raise exception 'Item % tidak ditemukan', v_ref_raw;
    end;
    v_kinds := v_kinds || v_kind;
    v_ref_ids := v_ref_ids || v_ref;
    v_qtys := v_qtys || v_qty;
  end loop;

  if payload ? 'discount' then
    if jsonb_typeof(payload -> 'discount') <> 'number'
       or (payload ->> 'discount')::numeric < 0 then
      raise exception 'Diskon tidak valid';
    end if;
    v_discount := round((payload ->> 'discount')::numeric)::integer;
  end if;
  if payload ? 'taxPercent' then
    if jsonb_typeof(payload -> 'taxPercent') <> 'number'
       or (payload ->> 'taxPercent')::numeric < 0
       or (payload ->> 'taxPercent')::numeric > 100 then
      raise exception 'Pajak harus di rentang 0-100%%';
    end if;
    v_tax_percent := (payload ->> 'taxPercent')::numeric;
  end if;
  if payload ? 'transportFee' then
    if jsonb_typeof(payload -> 'transportFee') <> 'number'
       or (payload ->> 'transportFee')::numeric < 0 then
      raise exception 'Ongkos transport tidak valid';
    end if;
    v_transport_fee := round((payload ->> 'transportFee')::numeric)::integer;
  end if;
  if payload ? 'notes' then
    if jsonb_typeof(payload -> 'notes') <> 'string' then
      raise exception 'Catatan tidak valid';
    end if;
    v_notes := payload ->> 'notes';
  end if;

  -- ----------------------------------------------------------- voucher (baru)
  if payload ? 'voucherCode' and payload -> 'voucherCode' is not null then
    if jsonb_typeof(payload -> 'voucherCode') <> 'string' then
      raise exception 'Kode voucher tidak valid';
    end if;
    v_voucher_code_raw := nullif(btrim(payload ->> 'voucherCode'), '');
  end if;

  v_installations := coalesce(payload -> 'installations', '[]'::jsonb);
  if jsonb_typeof(v_installations) <> 'array' then
    raise exception 'Data pemasangan tidak valid';
  end if;
  v_n_inst := jsonb_array_length(v_installations);
  v_inst_count := array_fill(0, array[v_n_items]);

  for v_inst in select value from jsonb_array_elements(v_installations)
  loop
    if jsonb_typeof(v_inst) <> 'object' then
      raise exception 'Data pemasangan tidak valid';
    end if;
    if jsonb_typeof(v_inst -> 'itemIndex') is distinct from 'number'
       or (v_inst ->> 'itemIndex')::numeric <> trunc((v_inst ->> 'itemIndex')::numeric)
       or (v_inst ->> 'itemIndex')::numeric < 0
       or (v_inst ->> 'itemIndex')::numeric >= v_n_items then
      raise exception 'itemIndex pemasangan tidak valid';
    end if;
    v_idx := (v_inst ->> 'itemIndex')::integer + 1;
    if v_kinds[v_idx] <> 'product' then
      raise exception 'Pemasangan hanya berlaku untuk item produk AC';
    end if;
    if v_inst ? 'roomLocation'
       and jsonb_typeof(v_inst -> 'roomLocation') <> 'string' then
      raise exception 'Lokasi ruangan tidak valid';
    end if;
    if v_inst ? 'technicianId'
       and jsonb_typeof(v_inst -> 'technicianId') <> 'string' then
      raise exception 'technicianId tidak valid';
    end if;
    v_inst_count[v_idx] := v_inst_count[v_idx] + 1;
  end loop;
  for v_idx in 1..v_n_items loop
    if v_inst_count[v_idx] > v_qtys[v_idx] then
      raise exception 'Jumlah pemasangan melebihi qty item';
    end if;
  end loop;

  v_service_units := coalesce(payload -> 'serviceUnits', '[]'::jsonb);
  if jsonb_typeof(v_service_units) <> 'array' then
    raise exception 'Data unit servis tidak valid';
  end if;
  v_n_svc := jsonb_array_length(v_service_units);
  v_svc_count := array_fill(0, array[v_n_items]);

  for v_svc in select value from jsonb_array_elements(v_service_units)
  loop
    if jsonb_typeof(v_svc) <> 'object' then
      raise exception 'Data unit servis tidak valid';
    end if;
    if jsonb_typeof(v_svc -> 'itemIndex') is distinct from 'number'
       or (v_svc ->> 'itemIndex')::numeric <> trunc((v_svc ->> 'itemIndex')::numeric)
       or (v_svc ->> 'itemIndex')::numeric < 0
       or (v_svc ->> 'itemIndex')::numeric >= v_n_items then
      raise exception 'itemIndex unit servis tidak valid';
    end if;
    v_idx := (v_svc ->> 'itemIndex')::integer + 1;
    if v_kinds[v_idx] <> 'service' then
      raise exception 'Unit servis hanya berlaku untuk item jasa';
    end if;
    if jsonb_typeof(v_svc -> 'unitId') is distinct from 'string'
       or btrim(coalesce(v_svc ->> 'unitId', '')) = '' then
      raise exception 'unitId wajib diisi';
    end if;
    begin
      v_svc_unit_id := (v_svc ->> 'unitId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Unit AC tidak ditemukan';
    end;
    if (v_idx::text || ':' || v_svc_unit_id::text) = any (v_seen_svc) then
      raise exception 'Unit AC terpilih ganda pada satu jasa';
    end if;
    v_seen_svc := v_seen_svc || (v_idx::text || ':' || v_svc_unit_id::text);
    if v_svc ? 'technicianId'
       and jsonb_typeof(v_svc -> 'technicianId') <> 'string' then
      raise exception 'technicianId tidak valid';
    end if;
    v_svc_count[v_idx] := v_svc_count[v_idx] + 1;
  end loop;
  for v_idx in 1..v_n_items loop
    if v_svc_count[v_idx] > v_qtys[v_idx] then
      raise exception 'Jumlah unit servis melebihi qty jasa';
    end if;
  end loop;

  for v_idx in 1..v_n_items loop
    v_kind := v_kinds[v_idx];
    v_category := '';
    if v_kind = 'product' then
      select p.name, p.active, p.stock::numeric, p.sell_price, p.brand, p.type, p.pk
        into v_name, v_active, v_stock, v_price, v_brand, v_type, v_pk
        from products p where p.id = v_ref_ids[v_idx]
        for update;
    elsif v_kind = 'sparepart' then
      select s.name, s.active, s.stock, s.sell_price, '', s.unit, 0
        into v_name, v_active, v_stock, v_price, v_brand, v_unit, v_pk
        from spareparts s where s.id = v_ref_ids[v_idx]
        for update;
    else
      select sv.name, sv.active, null::numeric, sv.base_price, '', '', 0, sv.category
        into v_name, v_active, v_stock, v_price, v_brand, v_unit, v_pk, v_category
        from services sv where sv.id = v_ref_ids[v_idx];
    end if;

    if not found then
      raise exception 'Item % tidak ditemukan', v_ref_ids[v_idx];
    end if;
    if v_active = false then
      raise exception '% tidak aktif', v_name;
    end if;
    if v_kind in ('product', 'sparepart') and coalesce(v_stock, 0) < v_qtys[v_idx] then
      raise exception 'Stok % tidak cukup', v_name;
    end if;

    v_names := v_names || v_name;
    v_prices := v_prices || v_price;
    v_categories := v_categories || coalesce(v_category, '');
    v_units := v_units || case v_kind
      when 'product' then 'unit'
      when 'service' then 'jasa'
      else coalesce(v_unit, '')
    end;
    if v_kind = 'product' then
      v_brands := v_brands || coalesce(v_brand, '');
      v_types := v_types || coalesce(v_type, '');
      v_pks := v_pks || coalesce(v_pk, 0);
    else
      v_brands := v_brands || ''::text;
      v_types := v_types || ''::text;
      v_pks := v_pks || 0::numeric;
    end if;
  end loop;

  for v_tid_raw in
    select distinct value ->> 'technicianId'
    from jsonb_array_elements(v_installations || v_service_units)
    where value ? 'technicianId' and value ->> 'technicianId' <> ''
  loop
    begin
      v_tid := v_tid_raw::uuid;
    exception when invalid_text_representation then
      raise exception 'Teknisi tidak valid atau tidak aktif';
    end;
    select u.role::text, u.active into v_tech_role, v_tech_active
      from users u where u.id = v_tid;
    if not found or v_tech_role <> 'teknisi' or v_tech_active is not true then
      raise exception 'Teknisi tidak valid atau tidak aktif';
    end if;
  end loop;

  -- ------------------------------------------------ subtotal
  for v_idx in 1..v_n_items loop
    v_line_totals := v_line_totals || round(v_qtys[v_idx] * v_prices[v_idx])::integer;
    v_subtotal := v_subtotal + v_line_totals[v_idx];
  end loop;

  -- ------------------------------------------------ member (cari/buat)
  -- Dipindah ke sini (semula setelah hitung total) — validasi voucher di
  -- bawah butuh v_member_id lebih dulu.
  v_phone := normalize_phone(v_customer ->> 'phone');
  select m.id into v_member_id from members m where m.phone = v_phone for update;
  if not found then
    insert into members
      (name, phone, address, customer_type, member_since, total_ac_units, notes, active)
    values
      (v_customer ->> 'name', v_phone, coalesce(v_customer ->> 'address', ''),
       'lainnya', now(), v_n_inst, null, true)
    returning id into v_member_id;
  elsif v_n_inst > 0 then
    update members set total_ac_units = total_ac_units + v_n_inst
      where id = v_member_id;
  end if;

  -- ------------------------------------------------------------- voucher
  if v_voucher_code_raw is not null then
    select id, member_id, discount_type, discount_value, max_discount_cap,
           min_purchase, expires_at, status
      into v_voucher_id, v_voucher_member, v_voucher_type, v_voucher_value,
           v_voucher_cap, v_voucher_min, v_voucher_expires, v_voucher_status
      from vouchers
     where code = upper(v_voucher_code_raw)
     for update;
    if not found then
      raise exception 'Kode voucher tidak ditemukan';
    end if;
    if v_voucher_status <> 'aktif' then
      raise exception 'Voucher ini sudah %', v_voucher_status;
    end if;
    if v_voucher_expires < now() then
      raise exception 'Voucher ini sudah kedaluwarsa';
    end if;
    if v_voucher_member <> v_member_id then
      raise exception 'Kode voucher ini bukan milik pelanggan ini';
    end if;
    if v_voucher_min is not null and v_subtotal < v_voucher_min then
      raise exception 'Belanja belum mencapai minimal Rp % untuk voucher ini',
        v_voucher_min;
    end if;
    v_voucher_discount := case v_voucher_type
      when 'nominal' then v_voucher_value
      else least(round(v_subtotal * v_voucher_value / 100.0)::integer,
                 coalesce(v_voucher_cap, v_subtotal))
    end;
  end if;

  -- ------------------------------------------------ hitung total
  v_discount := v_discount + v_voucher_discount;
  if v_discount > v_subtotal then
    raise exception 'Diskon melebihi subtotal';
  end if;
  v_tax_base := v_subtotal - v_discount;
  v_tax_amount := round(v_tax_base * v_tax_percent / 100)::integer;
  v_grand_total := v_tax_base + v_tax_amount + v_transport_fee;

  -- ------------------------------------------------ nomor invoice
  v_date_key := business_date_key();
  v_inv_seq := next_seq('invoice_' || v_date_key);
  v_invoice_number := 'INV-' || v_date_key || '-' || lpad(v_inv_seq::text, 4, '0');

  -- ------------------------------------------------ tulis transaksi
  insert into transactions
    (member_id, customer_name, customer_phone, subtotal, discount, tax_percent,
     tax_amount, transport_fee, grand_total, notes, created_by)
  values
    (v_member_id, v_customer ->> 'name', v_phone, v_subtotal, v_discount,
     v_tax_percent, v_tax_amount, v_transport_fee, v_grand_total, v_notes, v_uid)
  returning id into v_transaction_id;

  insert into invoices
    (number, transaction_id, member_id, customer_name, customer_phone, subtotal,
     discount, tax_percent, tax_amount, transport_fee, grand_total, total_paid,
     status, notes, created_by)
  values
    (v_invoice_number, v_transaction_id, v_member_id, v_customer ->> 'name',
     v_phone, v_subtotal, v_discount, v_tax_percent, v_tax_amount,
     v_transport_fee, v_grand_total, 0, 'belum_dibayar', v_notes, v_uid)
  returning id into v_invoice_id;

  -- Voucher terpakai HANYA setelah invoice lahir, dalam transaksi yang sama —
  -- kalau langkah setelahnya gagal, seluruh transaksi (termasuk ini) rollback.
  if v_voucher_id is not null then
    update vouchers
       set status = 'terpakai', used_at = now(), used_in_transaction_id = v_transaction_id
     where id = v_voucher_id;
  end if;

  for v_idx in 1..v_n_items loop
    insert into transaction_items
      (transaction_id, kind, ref_id, name, unit, qty, unit_price, line_total)
    values
      (v_transaction_id, v_kinds[v_idx]::item_kind, v_ref_ids[v_idx],
       v_names[v_idx], v_units[v_idx], v_qtys[v_idx], v_prices[v_idx],
       v_line_totals[v_idx]);

    insert into invoice_items
      (invoice_id, kind, ref_id, name, unit, qty, unit_price, line_total)
    values
      (v_invoice_id, v_kinds[v_idx]::item_kind, v_ref_ids[v_idx],
       v_names[v_idx], v_units[v_idx], v_qtys[v_idx], v_prices[v_idx],
       v_line_totals[v_idx]);

    if v_kinds[v_idx] in ('product', 'sparepart') then
      insert into stock_movements
        (item_kind, ref_id, name, qty_change, reason, transaction_id, created_by)
      values
        (v_kinds[v_idx]::item_kind, v_ref_ids[v_idx], v_names[v_idx],
         -v_qtys[v_idx], 'penjualan', v_transaction_id, v_uid);

      if v_kinds[v_idx] = 'product' then
        update products set stock = stock - v_qtys[v_idx]::integer
          where id = v_ref_ids[v_idx];
      else
        update spareparts set stock = stock - v_qtys[v_idx]
          where id = v_ref_ids[v_idx];
      end if;
    end if;
  end loop;

  if v_n_inst > 0 then
    insert into service_orders
      (member_id, transaction_id, invoice_id, type, status, created_by)
    values
      (v_member_id, v_transaction_id, v_invoice_id, 'pemasangan', 'terjadwal', v_uid)
    returning id into v_order_id;

    for v_inst in select value from jsonb_array_elements(v_installations)
    loop
      v_idx := (v_inst ->> 'itemIndex')::integer + 1;
      v_room := coalesce(v_inst ->> 'roomLocation', '');
      v_tid := nullif(v_inst ->> 'technicianId', '')::uuid;

      v_unit_seq := next_seq('acunit_' || v_date_key);
      v_barcode := 'ACUNIT-' || v_date_key || '-' || lpad(v_unit_seq::text, 4, '0');

      insert into member_ac_units
        (member_id, brand, model, pk, room_location, barcode_value,
         serial_number, status)
      values
        (v_member_id, v_brands[v_idx], v_types[v_idx], v_pks[v_idx], v_room,
         v_barcode, null, 'menunggu_pemasangan')
      returning id into v_unit_id;

      insert into service_order_units (order_id, unit_id, status)
      values (v_order_id, v_unit_id, 'menunggu_pemasangan');

      insert into technician_jobs
        (order_id, member_id, unit_id, technician_id, type, status,
         scheduled_date, created_by)
      values
        (v_order_id, v_member_id, v_unit_id, v_tid, 'pemasangan',
         case when v_tid is not null then 'assigned' else 'menunggu_penugasan' end,
         null, v_uid);
    end loop;
  end if;

  for v_svc in select value from jsonb_array_elements(v_service_units)
  loop
    v_idx := (v_svc ->> 'itemIndex')::integer + 1;
    v_svc_unit_id := (v_svc ->> 'unitId')::uuid;
    v_tid := nullif(v_svc ->> 'technicianId', '')::uuid;

    select u.member_id into v_svc_unit_member
      from member_ac_units u where u.id = v_svc_unit_id;
    if not found then
      raise exception 'Unit AC tidak ditemukan';
    end if;
    if v_svc_unit_member is distinct from v_member_id then
      raise exception 'Unit AC bukan milik pelanggan transaksi ini';
    end if;

    v_job_type := service_job_type(v_categories[v_idx]);

    v_job_pos := array_position(v_job_types, v_job_type);
    if v_job_pos is null then
      insert into service_orders
        (member_id, transaction_id, invoice_id, type, status, created_by)
      values
        (v_member_id, v_transaction_id, v_invoice_id, v_job_type, 'terjadwal',
         v_uid)
      returning id into v_order_id;
      v_job_types := v_job_types || v_job_type;
      v_job_order_ids := v_job_order_ids || v_order_id;
    else
      v_order_id := v_job_order_ids[v_job_pos];
    end if;

    insert into service_order_units (order_id, unit_id, status)
    values (v_order_id, v_svc_unit_id, 'terjadwal');

    insert into technician_jobs
      (order_id, member_id, unit_id, technician_id, type, status,
       scheduled_date, created_by)
    values
      (v_order_id, v_member_id, v_svc_unit_id, v_tid, v_job_type,
       case when v_tid is not null then 'assigned' else 'menunggu_penugasan' end,
       null, v_uid);
  end loop;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'pos.checkout', v_invoice_id::text,
          jsonb_build_object('number', v_invoice_number,
                             'grand_total', v_grand_total,
                             'installJobs', v_n_inst,
                             'serviceJobs', v_n_svc,
                             'voucherId', v_voucher_id));

  return jsonb_build_object(
    'invoiceId', v_invoice_id,
    'invoiceNumber', v_invoice_number,
    'memberId', v_member_id,
    'transactionId', v_transaction_id
  );
end;
$$;

revoke execute on function checkout_transaction(jsonb) from anon, public;
grant  execute on function checkout_transaction(jsonb) to authenticated;
