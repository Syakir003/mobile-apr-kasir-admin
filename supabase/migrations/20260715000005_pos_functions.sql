-- =============================================================================
-- Fungsi POS — port dari Cloud Functions (functions/src/pos & units) ke
-- Postgres RPC. Satu pemanggilan = satu transaksi DB (atomik penuh, tanpa
-- batasan Firestore "semua read sebelum write").
--
-- Paritas logika mengacu pada util TS + test vitest-nya:
--   normalizePhone   -> normalize_phone          (phone.ts / phone.test.ts)
--   computeTotals    -> inline di checkout       (totals.ts / totals.test.ts)
--   formatInvoiceNumber/computeInvoiceStatus     (invoice.ts / invoice.test.ts)
--   validateCheckoutInput/validateRecordPayment  (validation.ts / *.test.ts)
--   dateKey/formatBarcode                        (units/barcode.ts)
-- Pesan error disamakan persis agar UI menampilkan teks yang sama.
--
-- Catatan paritas yang disengaja BERBEDA:
--   * Kunci tanggal (nomor invoice/barcode) memakai zona 'Asia/Jakarta'
--     (hari bisnis WIB) — TS memakai jam lokal runtime.
--   * Guard role membaca public.users (selalu terkini), bukan klaim JWT yang
--     bisa basi; policy RLS tetap memakai klaim (murah per baris).
--   * Qty item product wajib bilangan bulat (kolom stok products = integer;
--     mencegah pembulatan diam-diam). Sparepart tetap boleh pecahan.
-- =============================================================================

-- ------------------------------------------------------------ util murni
create or replace function normalize_phone(raw text)
returns text
language sql
immutable
as $$
  select case
    when cleaned like '+62%' then cleaned
    when cleaned like '628%' then '+' || cleaned
    when cleaned like '08%'  then '+62' || substring(cleaned from 2)
    when cleaned like '8%'   then '+62' || cleaned
    else cleaned
  end
  from (select regexp_replace(raw, '[\s\-.()]', '', 'g') as cleaned) t;
$$;

create or replace function compute_invoice_status(p_grand_total integer, p_total_paid integer)
returns invoice_status
language sql
immutable
as $$
  select case
    when p_total_paid <= 0 and p_grand_total > 0 then 'belum_dibayar'::invoice_status
    when p_total_paid < p_grand_total then 'dp'::invoice_status
    else 'lunas'::invoice_status
  end;
$$;

-- Kunci tanggal hari bisnis (WIB) untuk nomor invoice & barcode.
create or replace function business_date_key()
returns text
language sql
stable
as $$
  select to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD');
$$;

-- ------------------------------------------------------------ guard role
-- Baca role dari public.users (bukan klaim JWT) supaya perubahan role/aktif
-- langsung berlaku tanpa menunggu token refresh. Return: uid pemanggil.
create or replace function assert_caller_role(p_allowed text[], p_message text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception '%', p_message;
  end if;
  select role::text into v_role from users where id = v_uid and active;
  if v_role is null or not (v_role = any (p_allowed)) then
    raise exception '%', p_message;
  end if;
  return v_uid;
end;
$$;

-- =============================================================================
-- checkout_transaction(payload) — port functions/src/pos/checkout.ts.
-- Payload sama persis dengan yang dikirim client ke callable Firebase:
--   { customer: {name, phone, address?}, items: [{kind, refId, qty}],
--     discount?, taxPercent?, transportFee?, notes?,
--     installations?: [{itemIndex, roomLocation?, technicianId?}] }
-- Return: { invoiceId, invoiceNumber, memberId, transactionId }
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
  v_item jsonb;
  v_inst jsonb;
  v_idx integer;
  v_n_items integer;

  -- hasil validasi & baca master (index paralel 1..n_items)
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

    -- id yang bukan uuid berarti tidak akan pernah ditemukan di master
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
    v_idx := (v_inst ->> 'itemIndex')::integer + 1; -- array SQL 1-based
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

  -- ------------------------------------ baca & validasi master (terkunci)
  -- FOR UPDATE mengunci baris product/sparepart sampai commit sehingga cek
  -- stok dan pengurangan stok bebas race antar checkout paralel.
  for v_idx in 1..v_n_items loop
    v_kind := v_kinds[v_idx];
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
      select sv.name, sv.active, null::numeric, sv.base_price, '', '', 0
        into v_name, v_active, v_stock, v_price, v_brand, v_unit, v_pk
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

  -- ------------------------------------------------ validasi teknisi
  for v_tid_raw in
    select distinct value ->> 'technicianId'
    from jsonb_array_elements(v_installations)
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

  -- ------------------------------------------------ hitung total
  -- computeTotals (totals.ts): lineTotal = round(qty*unitPrice) per baris;
  -- taxBase = subtotal - discount; tax = round(taxBase*persen/100);
  -- grand = taxBase + tax + transport (transport TIDAK kena pajak).
  for v_idx in 1..v_n_items loop
    v_line_totals := v_line_totals || round(v_qtys[v_idx] * v_prices[v_idx])::integer;
    v_subtotal := v_subtotal + v_line_totals[v_idx];
  end loop;
  if v_discount > v_subtotal then
    raise exception 'Diskon melebihi subtotal';
  end if;
  v_tax_base := v_subtotal - v_discount;
  v_tax_amount := round(v_tax_base * v_tax_percent / 100)::integer;
  v_grand_total := v_tax_base + v_tax_amount + v_transport_fee;

  -- ------------------------------------------------ member (cari/buat)
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

  -- ------------------------------------------------ order & job pemasangan
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

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'pos.checkout', v_invoice_id::text,
          jsonb_build_object('number', v_invoice_number,
                             'grand_total', v_grand_total));

  return jsonb_build_object(
    'invoiceId', v_invoice_id,
    'invoiceNumber', v_invoice_number,
    'memberId', v_member_id,
    'transactionId', v_transaction_id
  );
end;
$$;

-- =============================================================================
-- record_payment(payload) — port functions/src/pos/recordPayment.ts.
-- Payload: { invoiceId, method, amount, note? }
-- Return : { status, totalPaid }
-- =============================================================================
create or replace function record_payment(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_invoice_raw text;
  v_invoice_id uuid;
  v_method text;
  v_amount integer;
  v_note text;
  v_grand integer;
  v_paid integer;
  v_status text;
  v_new_paid integer;
  v_new_status invoice_status;
begin
  v_uid := assert_caller_role(array['admin', 'kasir'], 'Hanya Admin/Kasir');

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;

  v_invoice_raw := payload ->> 'invoiceId';
  if jsonb_typeof(payload -> 'invoiceId') is distinct from 'string'
     or btrim(v_invoice_raw) = '' then
    raise exception 'invoiceId wajib diisi';
  end if;

  v_method := payload ->> 'method';
  if jsonb_typeof(payload -> 'method') is distinct from 'string'
     or v_method not in ('tunai', 'transfer', 'qris', 'ewallet') then
    raise exception 'Metode pembayaran tidak dikenal';
  end if;

  if jsonb_typeof(payload -> 'amount') is distinct from 'number'
     or (payload ->> 'amount')::numeric <> trunc((payload ->> 'amount')::numeric)
     or (payload ->> 'amount')::numeric <= 0 then
    raise exception 'Jumlah pembayaran harus bilangan bulat lebih dari 0';
  end if;
  v_amount := (payload ->> 'amount')::integer;

  if payload ? 'note' then
    if jsonb_typeof(payload -> 'note') <> 'string' then
      raise exception 'Catatan tidak valid';
    end if;
    v_note := payload ->> 'note';
  end if;

  begin
    v_invoice_id := v_invoice_raw::uuid;
  exception when invalid_text_representation then
    raise exception 'Invoice tidak ditemukan';
  end;

  select i.grand_total, i.total_paid, i.status::text
    into v_grand, v_paid, v_status
    from invoices i where i.id = v_invoice_id
    for update;
  if not found then
    raise exception 'Invoice tidak ditemukan';
  end if;
  if v_status in ('batal', 'refund') then
    raise exception 'Invoice sudah batal/refund';
  end if;
  if v_amount > v_grand - v_paid then
    raise exception 'Melebihi sisa tagihan';
  end if;

  v_new_paid := v_paid + v_amount;
  v_new_status := compute_invoice_status(v_grand, v_new_paid);

  insert into manual_payments (invoice_id, method, amount, note, proof_url, created_by)
  values (v_invoice_id, v_method::payment_method, v_amount, v_note, null, v_uid);

  update invoices set total_paid = v_new_paid, status = v_new_status
    where id = v_invoice_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'pos.payment', v_invoice_id::text,
          jsonb_build_object('method', v_method, 'amount', v_amount,
                             'status', v_new_status));

  return jsonb_build_object('status', v_new_status, 'totalPaid', v_new_paid);
end;
$$;

-- =============================================================================
-- generate_ac_unit_barcode(unit) — port functions/src/units/generateBarcode.ts.
-- Return: { barcode }
-- =============================================================================
create or replace function generate_ac_unit_barcode(p_unit_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_unit_id uuid;
  v_existing text;
  v_seq integer;
  v_value text;
  v_date_key text;
begin
  v_uid := assert_caller_role(array['admin', 'kasir'], 'Hanya Admin/Kasir');

  if p_unit_id is null or p_unit_id = '' then
    raise exception 'unitId wajib diisi';
  end if;
  begin
    v_unit_id := p_unit_id::uuid;
  exception when invalid_text_representation then
    raise exception 'Unit tidak ditemukan';
  end;

  select u.barcode_value into v_existing
    from member_ac_units u where u.id = v_unit_id
    for update;
  if not found then
    raise exception 'Unit tidak ditemukan';
  end if;
  if v_existing is not null and v_existing <> '' then
    raise exception 'Barcode sudah digenerate';
  end if;

  v_date_key := business_date_key();
  v_seq := next_seq('acunit_' || v_date_key);
  v_value := 'ACUNIT-' || v_date_key || '-' || lpad(v_seq::text, 4, '0');

  update member_ac_units set barcode_value = v_value where id = v_unit_id;

  return jsonb_build_object('barcode', v_value);
end;
$$;

-- =============================================================================
-- save_installation_package — parent + item paket dalam SATU transaksi
-- (pengganti array items[] dalam satu dokumen Firestore).
-- SECURITY INVOKER: RLS (admin-only) tetap berlaku.
-- p_items: [{sparepart_id, name, qty, unit, extra_price_per_unit}]
-- Return: id paket.
-- =============================================================================
create or replace function save_installation_package(
  p_id text,
  p_name text,
  p_description text,
  p_active boolean,
  p_items jsonb
)
returns uuid
language plpgsql
volatile
as $$
declare
  v_id uuid;
  v_item jsonb;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Nama paket wajib diisi';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Item paket tidak valid';
  end if;

  if p_id is null or p_id = '' then
    insert into installation_packages (name, description, active)
    values (p_name, p_description, coalesce(p_active, true))
    returning id into v_id;
  else
    v_id := p_id::uuid;
    update installation_packages
      set name = p_name, description = p_description,
          active = coalesce(p_active, true)
      where id = v_id;
    if not found then
      raise exception 'Paket tidak ditemukan';
    end if;
    delete from installation_package_items where package_id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into installation_package_items
      (package_id, sparepart_id, name, qty, unit, extra_price_per_unit)
    values
      (v_id,
       nullif(v_item ->> 'sparepart_id', '')::uuid,
       coalesce(v_item ->> 'name', ''),
       coalesce((v_item ->> 'qty')::numeric, 0),
       coalesce(v_item ->> 'unit', ''),
       coalesce((v_item ->> 'extra_price_per_unit')::integer, 0));
  end loop;

  return v_id;
end;
$$;

-- ------------------------------------------------------------------ grants
-- Default privilege Supabase memberi EXECUTE ke anon/authenticated; kunci
-- helper internal & counter, buka hanya RPC yang memang dipanggil client.
revoke execute on function next_seq(text) from anon, authenticated, public;
revoke execute on function assert_caller_role(text[], text) from anon, authenticated, public;

revoke execute on function checkout_transaction(jsonb) from anon, public;
revoke execute on function record_payment(jsonb) from anon, public;
revoke execute on function generate_ac_unit_barcode(text) from anon, public;
revoke execute on function save_installation_package(text, text, text, boolean, jsonb) from anon, public;

grant execute on function checkout_transaction(jsonb) to authenticated;
grant execute on function record_payment(jsonb) to authenticated;
grant execute on function generate_ac_unit_barcode(text) to authenticated;
grant execute on function save_installation_package(text, text, text, boolean, jsonb) to authenticated;
