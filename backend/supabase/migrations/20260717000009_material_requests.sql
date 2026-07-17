-- =============================================================================
-- Fase 5 — Pengajuan sparepart/material tambahan + approval.
--
-- Dok. fitur bab 11.1: teknisi yang sedang mengerjakan job bisa MENGAJUKAN
-- tambahan sparepart/produk (harga diambil server dari master). Admin/Kasir
-- lalu APPROVE atau REJECT. Approve = potong stok (+ stock_movements) DAN
-- menambah biaya ke invoice lewat `invoice_adjustments` (hitung ulang status
-- pembayaran). Job tidak boleh diselesaikan selagi ada pengajuan `pending`.
--
-- Catatan scope MVP: langkah "markItemsUsed" (approve dulu, pakai belakangan)
-- digabung ke approval — approve langsung memotong stok. Status "revisi" belum
-- didukung (hanya approve/reject); teknisi ajukan ulang bila ditolak.
--
-- Pola sama fungsi POS (0005): baca harga master server-side, FOR UPDATE saat
-- potong stok, compute_invoice_status sebagai satu-satunya sumber status.
-- Semua tulis lewat RPC SECURITY DEFINER; client hanya baca via `.select()`.
-- =============================================================================

-- ------------------------------------------------------- tabel material_requests
create table if not exists material_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references technician_jobs (id) on delete cascade,
  invoice_id uuid references invoices (id),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  total integer not null default 0,
  note text,                       -- catatan teknisi
  decision_note text,              -- catatan admin/kasir saat memutuskan
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  decided_by uuid references users (id),
  decided_at timestamptz
);
create index if not exists material_requests_job_idx
  on material_requests (job_id);
create index if not exists material_requests_status_idx
  on material_requests (status);

create table if not exists material_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references material_requests (id) on delete cascade,
  kind item_kind not null,         -- 'product' | 'sparepart'
  ref_id uuid not null,
  name text not null,
  unit text not null default '',
  qty numeric not null,
  unit_price integer not null,
  line_total integer not null
);
create index if not exists material_request_items_req_idx
  on material_request_items (request_id);

-- Penyesuaian nilai invoice akibat approval (audit trail perubahan tagihan).
create table if not exists invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id),
  request_id uuid references material_requests (id),
  amount integer not null,         -- positif = menambah tagihan
  reason text not null default 'pengajuan_tambahan',
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index if not exists invoice_adjustments_invoice_idx
  on invoice_adjustments (invoice_id);

alter table material_requests enable row level security;
alter table material_request_items enable row level security;
alter table invoice_adjustments enable row level security;

-- Baca: pengajuan & itemnya untuk semua user login (UI menyaring per job).
-- invoice_adjustments finansial → hanya admin/kasir (sejalan invoices 0003).
grant select on material_requests, material_request_items to authenticated;
grant select on invoice_adjustments to authenticated;

create policy "material requests: baca user login"
  on material_requests for select to authenticated using (true);
create policy "material request items: baca user login"
  on material_request_items for select to authenticated using (true);
create policy "invoice adjustments: baca admin/kasir"
  on invoice_adjustments for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

-- =============================================================================
-- submit_material_request(payload) — teknisi/admin mengajukan tambahan.
-- Payload: { jobId, note?, items: [{ kind:'product'|'sparepart', refId, qty }] }
-- Harga diambil server dari master; TIDAK memotong stok (baru saat approve).
-- Return: { ok, requestId, total }
-- =============================================================================
create or replace function submit_material_request(payload jsonb)
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
  v_order_id uuid;
  v_invoice_id uuid;
  v_owner uuid;
  v_status text;
  v_items jsonb;
  v_item jsonb;
  v_note text;
  v_kind text;
  v_ref uuid;
  v_qty numeric;
  v_name text;
  v_active boolean;
  v_price integer;
  v_unit text;
  v_line integer;
  v_total integer := 0;
  v_req_id uuid;
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
  v_note := nullif(btrim(coalesce(payload ->> 'note', '')), '');

  v_items := payload -> 'items';
  if v_items is null or jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) = 0 then
    raise exception 'Minimal satu item pengajuan';
  end if;

  select j.technician_id, j.status, j.order_id
    into v_owner, v_status, v_order_id
    from technician_jobs j where j.id = v_job_id;
  if not found then
    raise exception 'Job tidak ditemukan';
  end if;

  if v_role = 'teknisi' then
    if v_owner is distinct from v_uid then
      raise exception 'Job ini bukan milik Anda';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'Tidak diizinkan mengajukan';
  end if;

  if v_status not in ('assigned', 'sedang_dikerjakan') then
    raise exception 'Pengajuan hanya bisa saat job aktif';
  end if;

  select invoice_id into v_invoice_id
    from service_orders where id = v_order_id;

  insert into material_requests (job_id, invoice_id, status, note, created_by)
  values (v_job_id, v_invoice_id, 'pending', v_note, v_uid)
  returning id into v_req_id;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Item tidak valid';
    end if;
    v_kind := v_item ->> 'kind';
    if v_kind not in ('product', 'sparepart') then
      raise exception 'Jenis item harus product/sparepart';
    end if;
    if btrim(coalesce(v_item ->> 'refId', '')) = '' then
      raise exception 'refId item wajib diisi';
    end if;
    v_ref := (v_item ->> 'refId')::uuid;
    if jsonb_typeof(v_item -> 'qty') is distinct from 'number'
       or (v_item ->> 'qty')::numeric <= 0 then
      raise exception 'Qty item harus lebih dari 0';
    end if;
    v_qty := (v_item ->> 'qty')::numeric;

    if v_kind = 'product' then
      select p.name, p.active, p.sell_price, 'unit'
        into v_name, v_active, v_price, v_unit
        from products p where p.id = v_ref;
    else
      select s.name, s.active, s.sell_price, coalesce(s.unit, '')
        into v_name, v_active, v_price, v_unit
        from spareparts s where s.id = v_ref;
    end if;
    if not found then
      raise exception 'Item % tidak ditemukan', v_ref;
    end if;
    if not v_active then
      raise exception '% tidak aktif', v_name;
    end if;

    v_line := round(v_qty * v_price)::integer;
    v_total := v_total + v_line;

    insert into material_request_items
      (request_id, kind, ref_id, name, unit, qty, unit_price, line_total)
    values
      (v_req_id, v_kind::item_kind, v_ref, v_name, v_unit, v_qty, v_price, v_line);
  end loop;

  update material_requests set total = v_total where id = v_req_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'request.submit', v_req_id::text,
          jsonb_build_object('jobId', v_job_id, 'total', v_total));

  return jsonb_build_object('ok', true, 'requestId', v_req_id, 'total', v_total);
end;
$$;

-- =============================================================================
-- decide_material_request(payload) — admin/kasir approve/reject pengajuan.
-- Payload: { requestId, decision: 'approve'|'reject', note? }
-- approve: potong stok tiap item (+ stock_movements) & tambah invoice_adjustment
--          (grand_total invoice naik, status pembayaran dihitung ulang).
-- Return: { ok, status, invoiceStatus? }
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
  v_item record;
  v_stock numeric;
  v_grand integer;
  v_paid integer;
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

  if v_decision not in ('approve', 'reject') then
    raise exception 'Keputusan harus approve/reject';
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

  -- approve: potong stok tiap item (kunci baris), catat stock_movements.
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
     set status = 'approved', decided_by = v_uid,
         decided_at = now(), decision_note = v_note
   where id = v_req_id;

  -- Sesuaikan invoice bila terhubung & ada nilainya.
  if v_req.invoice_id is not null and v_req.total > 0 then
    select grand_total, total_paid into v_grand, v_paid
      from invoices where id = v_req.invoice_id for update;
    if found then
      v_new_grand := v_grand + v_req.total;
      v_new_status := compute_invoice_status(v_new_grand, v_paid);
      update invoices set grand_total = v_new_grand, status = v_new_status
        where id = v_req.invoice_id;
      insert into invoice_adjustments
        (invoice_id, request_id, amount, reason, created_by)
      values
        (v_req.invoice_id, v_req_id, v_req.total, 'pengajuan_tambahan', v_uid);
    end if;
  end if;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'request.approve', v_req_id::text,
          jsonb_build_object('total', v_req.total,
                             'invoiceStatus', v_new_status));

  return jsonb_build_object('ok', true, 'status', 'approved',
    'invoiceStatus', v_new_status);
end;
$$;

-- =============================================================================
-- update_technician_job_status(payload) — DEFINISI ULANG dari 0008.
-- Tambahan: `complete` juga ditolak bila masih ada pengajuan `pending`
-- (dok. fitur: job tak boleh selesai selagi ada pengajuan menggantung).
-- Sisanya identik dengan 0008 (termasuk syarat foto sebelum & sesudah).
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
    -- Pengajuan tambahan yang belum diputuskan memblokir penyelesaian.
    if exists (
      select 1 from material_requests
       where job_id = v_job_id and status = 'pending'
    ) then
      raise exception 'Masih ada pengajuan tambahan yang belum diputuskan';
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
