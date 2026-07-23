-- =============================================================================
-- Fase 6 — Penegakan aturan bayar, approval, & foto (dok. fitur 8.3/8.4/8.5).
--
-- Menutup gap MVP:
--   * 8.5  status `kurang_bayar` tak pernah terbit: invoice LUNAS yang bertambah
--          tagihan (approval biaya tambahan) malah jadi `dp`. compute_invoice_status
--          kini sadar-status (sticky) sehingga `kurang_bayar` bertahan sampai lunas.
--   * 8.4c keputusan `revise` (Revisi) selain approve/reject — admin/kasir ubah
--          qty item lalu setujui dengan nilai revisi.
--   * 8.4e stok baru berkurang saat item DITANDAI DIGUNAKAN (mark_material_used),
--          bukan saat approve. Approve hanya membebankan tagihan ke invoice.
--   * 8.3  foto SEBELUM wajib sebelum job DIMULAI (start), bukan hanya saat selesai.
--          Tombol/RPC start ditolak bila foto sebelum belum ada.
--   * fix deadlock scan: job ber-unit tanpa barcode kini bisa dimulai (scan
--          hanya diwajibkan bila unit punya barcode) — sejalan perilaku UI.
--   * 8.4f complete diblokir bila ada pengajuan pending ATAU approved-belum-dipakai.
-- =============================================================================

-- Kolom penanda pemakaian material (approve → dipakai adalah dua langkah).
alter table material_requests
  add column if not exists used_at timestamptz,
  add column if not exists used_by uuid references users (id);

-- =============================================================================
-- compute_invoice_status(grand, paid, current?) — sadar status berjalan.
-- Bila pembayaran sebagian: pertahankan `kurang_bayar` (invoice pernah lunas
-- lalu kena biaya tambahan) sampai benar-benar lunas; selain itu `dp`.
-- =============================================================================
drop function if exists compute_invoice_status(integer, integer);
create or replace function compute_invoice_status(
  p_grand_total integer,
  p_total_paid integer,
  p_current invoice_status default null)
returns invoice_status
language sql
immutable
as $$
  select case
    when p_total_paid >= p_grand_total then 'lunas'::invoice_status
    when p_total_paid <= 0 then 'belum_dibayar'::invoice_status
    when p_current = 'kurang_bayar' then 'kurang_bayar'::invoice_status
    else 'dp'::invoice_status
  end;
$$;

-- =============================================================================
-- record_payment — DEFINISI ULANG dari 0005. Perubahan tunggal: status baru
-- dihitung sadar-status agar `kurang_bayar` bertahan sampai lunas.
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
  v_new_status := compute_invoice_status(v_grand, v_new_paid, v_status::invoice_status);

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
-- decide_material_request — DEFINISI ULANG dari 0009.
-- Keputusan: 'approve' | 'revise' | 'reject'.
--   * approve : setujui apa adanya.
--   * revise  : ubah qty item dulu (payload.items:[{itemId,qty}]; qty<=0 hapus),
--               hitung ulang total dari unit_price tersimpan, lalu setujui.
--   * reject  : tolak.
-- approve/revise HANYA membebankan invoice (invoice_adjustments) — TIDAK memotong
-- stok (stok dipotong di mark_material_used). Invoice lunas yang bertambah
-- tagihan → `kurang_bayar`.
-- =============================================================================
create or replace function decide_material_request(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_req_id uuid;
  v_decision text;
  v_note text;
  v_req record;
  v_rev jsonb;
  v_rev_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_new_total integer;
  v_grand integer;
  v_paid integer;
  v_cur invoice_status;
  v_new_grand integer;
  v_new_status invoice_status;
begin
  v_uid := assert_caller_role(array['admin', 'kasir'],
    'Hanya Admin/Kasir yang boleh memutuskan pengajuan');

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'requestId') is distinct from 'string'
     or btrim(payload ->> 'requestId') = '' then
    raise exception 'requestId wajib diisi';
  end if;
  v_req_id := (payload ->> 'requestId')::uuid;
  v_decision := payload ->> 'decision';
  v_note := nullif(btrim(coalesce(payload ->> 'note', '')), '');

  if v_decision not in ('approve', 'revise', 'reject') then
    raise exception 'Keputusan harus approve/revise/reject';
  end if;

  select id, invoice_id, status, total
    into v_req
    from material_requests where id = v_req_id
    for update;
  if not found then
    raise exception 'Pengajuan tidak ditemukan';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Pengajuan sudah diputuskan';
  end if;

  -- ---------------------------------------------------------------- reject
  if v_decision = 'reject' then
    update material_requests
       set status = 'rejected', decided_by = v_uid,
           decided_at = now(), decision_note = v_note
     where id = v_req_id;
    insert into audit_logs (actor_uid, action, target, detail)
    values (v_uid, 'request.reject', v_req_id::text,
            jsonb_build_object('note', v_note));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- ---------------------------------------------------------------- revise
  -- Ubah qty item (harga tetap dari unit_price tersimpan), hitung ulang total.
  if v_decision = 'revise' then
    v_rev := payload -> 'items';
    if v_rev is null or jsonb_typeof(v_rev) <> 'array'
       or jsonb_array_length(v_rev) = 0 then
      raise exception 'Revisi butuh daftar item {itemId, qty}';
    end if;
    for v_rev_item in select value from jsonb_array_elements(v_rev)
    loop
      if jsonb_typeof(v_rev_item) <> 'object'
         or btrim(coalesce(v_rev_item ->> 'itemId', '')) = '' then
        raise exception 'Item revisi tidak valid';
      end if;
      v_item_id := (v_rev_item ->> 'itemId')::uuid;
      if jsonb_typeof(v_rev_item -> 'qty') is distinct from 'number' then
        raise exception 'Qty revisi harus angka';
      end if;
      v_qty := (v_rev_item ->> 'qty')::numeric;
      if v_qty <= 0 then
        delete from material_request_items
         where id = v_item_id and request_id = v_req_id;
      else
        update material_request_items
           set qty = v_qty,
               line_total = round(v_qty * unit_price)::integer
         where id = v_item_id and request_id = v_req_id;
      end if;
    end loop;

    select coalesce(sum(line_total), 0)::integer into v_new_total
      from material_request_items where request_id = v_req_id;
    if v_new_total <= 0 then
      raise exception 'Revisi menyisakan pengajuan kosong';
    end if;
    update material_requests set total = v_new_total where id = v_req_id;
    v_req.total := v_new_total;   -- pakai nilai revisi untuk adjustment invoice
  end if;

  -- ----------------------------------------------- approve / revise: setujui
  update material_requests
     set status = 'approved', decided_by = v_uid,
         decided_at = now(), decision_note = v_note
   where id = v_req_id;

  -- Bebankan ke invoice (stok BELUM dipotong — lihat mark_material_used).
  if v_req.invoice_id is not null and v_req.total > 0 then
    select grand_total, total_paid, status
      into v_grand, v_paid, v_cur
      from invoices where id = v_req.invoice_id for update;
    if found then
      v_new_grand := v_grand + v_req.total;
      -- Sudah lunas lalu tagihan naik → kurang_bayar (rule 8.5).
      if v_paid >= v_grand then
        v_new_status := compute_invoice_status(v_new_grand, v_paid, 'kurang_bayar');
      else
        v_new_status := compute_invoice_status(v_new_grand, v_paid, v_cur);
      end if;
      update invoices set grand_total = v_new_grand, status = v_new_status
        where id = v_req.invoice_id;
      insert into invoice_adjustments
        (invoice_id, request_id, amount, reason, created_by)
      values
        (v_req.invoice_id, v_req_id, v_req.total, 'pengajuan_tambahan', v_uid);
    end if;
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'request.' || v_decision, v_req_id::text,
          jsonb_build_object('total', v_req.total,
                             'invoiceStatus', v_new_status));

  return jsonb_build_object('ok', true, 'status', 'approved',
    'invoiceStatus', v_new_status);
end;
$$;

-- =============================================================================
-- mark_material_used(payload) — teknisi pemilik job / admin menandai material
-- pengajuan yang SUDAH disetujui sebagai benar-benar dipakai. Baru di sini stok
-- dipotong (+ stock_movements). Idempoten: menolak bila sudah ditandai.
-- Payload: { requestId }
-- =============================================================================
create or replace function mark_material_used(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_req_id uuid;
  v_req record;
  v_owner uuid;
  v_item record;
  v_stock numeric;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;
  v_role := jwt_role();

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'requestId') is distinct from 'string'
     or btrim(payload ->> 'requestId') = '' then
    raise exception 'requestId wajib diisi';
  end if;
  v_req_id := (payload ->> 'requestId')::uuid;

  select mr.id, mr.job_id, mr.status, mr.used_at, tj.technician_id
    into v_req
    from material_requests mr
    join technician_jobs tj on tj.id = mr.job_id
   where mr.id = v_req_id
   for update of mr;
  if not found then
    raise exception 'Pengajuan tidak ditemukan';
  end if;

  -- Teknisi hanya untuk job miliknya; admin bebas; kasir tidak.
  if v_role = 'teknisi' then
    if v_req.technician_id is distinct from v_uid then
      raise exception 'Job ini bukan milik Anda';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'Tidak diizinkan';
  end if;

  if v_req.status <> 'approved' then
    raise exception 'Hanya pengajuan yang disetujui bisa ditandai dipakai';
  end if;
  if v_req.used_at is not null then
    raise exception 'Material sudah ditandai dipakai';
  end if;

  -- Potong stok tiap item (kunci baris), catat stock_movements.
  for v_item in
    select kind, ref_id, name, qty from material_request_items
     where request_id = v_req_id
  loop
    if v_item.kind = 'product' then
      select stock::numeric into v_stock
        from products where id = v_item.ref_id for update;
    else
      select stock into v_stock
        from spareparts where id = v_item.ref_id for update;
    end if;
    if not found then
      raise exception 'Item % tidak ditemukan', v_item.name;
    end if;
    if coalesce(v_stock, 0) < v_item.qty then
      raise exception 'Stok % tidak cukup', v_item.name;
    end if;

    if v_item.kind = 'product' then
      update products set stock = stock - v_item.qty::integer
        where id = v_item.ref_id;
    else
      update spareparts set stock = stock - v_item.qty
        where id = v_item.ref_id;
    end if;

    insert into stock_movements
      (item_kind, ref_id, name, qty_change, reason, transaction_id, created_by)
    values
      (v_item.kind, v_item.ref_id, v_item.name, -v_item.qty, 'pengajuan',
       null, v_uid);
  end loop;

  update material_requests
     set used_at = now(), used_by = v_uid
   where id = v_req_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'request.used', v_req_id::text,
          jsonb_build_object('jobId', v_req.job_id));

  return jsonb_build_object('ok', true);
end;
$$;

-- =============================================================================
-- update_technician_job_status — DEFINISI ULANG dari 0009.
-- Tambahan aturan:
--   * start   : wajib ada foto SEBELUM (rule 8.3); scan hanya diwajibkan bila
--               unit punya barcode (menghapus deadlock unit tanpa barcode).
--   * complete: selain foto & pengajuan pending, juga menolak bila ada pengajuan
--               approved yang belum ditandai dipakai (rule 8.4e).
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
    -- Scan wajib hanya bila unit punya barcode (rule 8.2); tanpa barcode tidak
    -- ada yang bisa dicocokkan sehingga tak perlu memblokir (hindari deadlock).
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
    -- Pengajuan tambahan yang belum diputuskan memblokir penyelesaian.
    if exists (
      select 1 from material_requests
       where job_id = v_job_id and status = 'pending'
    ) then
      raise exception 'Masih ada pengajuan tambahan yang belum diputuskan';
    end if;
    -- Pengajuan disetujui tapi belum ditandai dipakai juga memblokir (rule 8.4e).
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
