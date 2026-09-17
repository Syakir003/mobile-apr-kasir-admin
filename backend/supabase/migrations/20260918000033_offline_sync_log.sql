-- =============================================================================
-- Mode offline teknisi — port dari Nest `20260823080000_offline_sync_log`.
--
-- * `sync_action_log`: log dedupe batch-sync dari app teknisi. Tiap aksi offline
--   membawa `client_action_id` (dibuat sekali di device); aksi yang id-nya sudah
--   tercatat tidak dieksekusi ulang. Tertutup total untuk client (tanpa grant &
--   tanpa policy, pola sama audit_logs) — hanya diisi RPC SECURITY DEFINER.
-- * `updated_at` pada technician_jobs & material_requests: penanda versi baris
--   untuk deteksi konflik saat sync. Skema ini TIDAK punya trigger auto-update,
--   jadi setiap RPC yang meng-UPDATE kedua tabel wajib set `updated_at = now()`.
--
-- Fungsi yang DIDEFINISIKAN ULANG di sini (isi identik, hanya menambah
-- `updated_at = now()` di tiap UPDATE):
--   * assign_technician_job   (dari 0007)
--   * decide_material_request (dari 0014)
--   * mark_material_used      (dari 0014)
-- update_technician_job_status diredefinisi di migrasi 0034 (sudah memuat
-- updated_at). submit_material_request TIDAK diredefinisi: satu-satunya UPDATE-
-- nya berjalan di transaksi yang sama dengan INSERT barisnya, dan `now()` bernilai
-- sama sepanjang transaksi — default kolom sudah memberi nilai yang identik.
--
-- Migrasi ini sengaja diurutkan SEBELUM 0034 supaya kolom updated_at sudah ada
-- saat fungsi status job yang memakainya didefinisikan.
-- =============================================================================

-- ------------------------------------------------------------- kolom versi baris
alter table technician_jobs
  add column if not exists updated_at timestamptz not null default now();

alter table material_requests
  add column if not exists updated_at timestamptz not null default now();

-- ------------------------------------------------------------ tabel sync_action_log
create table if not exists sync_action_log (
  id uuid primary key default gen_random_uuid(),
  client_action_id text not null unique,
  job_id uuid not null references technician_jobs (id) on delete cascade,
  action_type text not null,
  processed_at timestamptz not null default now(),
  result jsonb not null
);
create index if not exists sync_action_log_job_idx on sync_action_log (job_id);

alter table sync_action_log enable row level security;
-- Tanpa grant & tanpa policy = tertutup untuk anon/authenticated.

-- =============================================================================
-- assign_technician_job — DEFINISI ULANG dari 0007. Tambahan: updated_at.
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
                       else 'menunggu_penugasan' end,
         updated_at = now()
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

revoke execute on function assign_technician_job(jsonb) from anon, public;
grant execute on function assign_technician_job(jsonb) to authenticated;

-- =============================================================================
-- decide_material_request — DEFINISI ULANG dari 0014. Tambahan: updated_at.
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
           decided_at = now(), decision_note = v_note,
           updated_at = now()
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
    update material_requests
       set total = v_new_total, updated_at = now()
     where id = v_req_id;
    v_req.total := v_new_total;   -- pakai nilai revisi untuk adjustment invoice
  end if;

  -- ----------------------------------------------- approve / revise: setujui
  update material_requests
     set status = 'approved', decided_by = v_uid,
         decided_at = now(), decision_note = v_note,
         updated_at = now()
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

revoke execute on function decide_material_request(jsonb) from anon, public;
grant execute on function decide_material_request(jsonb) to authenticated;

-- =============================================================================
-- mark_material_used — DEFINISI ULANG dari 0014. Tambahan: updated_at.
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
     set used_at = now(), used_by = v_uid, updated_at = now()
   where id = v_req_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'request.used', v_req_id::text,
          jsonb_build_object('jobId', v_req.job_id));

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function mark_material_used(jsonb) from anon, public;
grant execute on function mark_material_used(jsonb) to authenticated;
