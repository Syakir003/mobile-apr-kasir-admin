-- =============================================================================
-- Fase 6 — Dua bukaan baca terakhir untuk melengkapi MVP:
--
--   1. `audit_logs` sengaja ditutup total sejak 0003/0006 (tanpa policy, tanpa
--      GRANT). Semua RPC rajin menulis ke sana, tapi isinya tidak pernah bisa
--      dilihat dari aplikasi. Dibuka BACA SAJA untuk admin — tulis tetap hanya
--      lewat RPC SECURITY DEFINER.
--
--   2. `job_payment_info` — status bayar invoice di balik sebuah job. Teknisi
--      tidak punya (dan tidak boleh punya) akses tabel `invoices`, jadi info
--      ini diambil lewat RPC SECURITY DEFINER yang hanya membocorkan ringkasan
--      angka untuk job yang memang boleh dia lihat.
--
-- CATATAN RULE 8.5: gate ini PERINGATAN, bukan blokir. `update_technician_job_
-- status` sengaja TIDAK diubah — job tetap boleh dimulai walau belum dibayar,
-- dan aplikasi hanya menampilkan badge. Keputusan ini diambil karena jasa AC
-- lazim ditagih setelah pekerjaan selesai; memblokir di backend akan
-- menghentikan pekerjaan yang sah.
-- =============================================================================

-- ------------------------------------------------------- audit_logs: baca admin
-- Ditegaskan ulang sebelum GRANT: tanpa RLS aktif, grant di bawah akan membuka
-- SELURUH jejak audit ke setiap user login. Sudah diaktifkan di 0001; baris ini
-- idempotent dan menjaga agar urutan pengamannya tidak pernah terbalik.
alter table audit_logs enable row level security;

grant select on audit_logs to authenticated;

drop policy if exists "audit logs: baca admin" on audit_logs;
create policy "audit logs: baca admin"
  on audit_logs for select to authenticated
  using (jwt_role() = 'admin');

-- Kolom `actor_uid` sudah punya FK ke users, jadi client bisa embed nama
-- pelaku: .select('*, actor:users(display_name,email)').

-- =============================================================================
-- job_payment_info(payload) — ringkasan tagihan di balik satu job.
-- Payload: { jobId }
-- Return: { ok, hasInvoice, invoiceId, number, status, grandTotal, totalPaid,
--           outstanding }
-- `hasInvoice: false` untuk job dari order manual (create_service_order) yang
-- memang belum ditagih — bukan kondisi error.
-- =============================================================================
create or replace function job_payment_info(payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_role text;
  v_job_id uuid;
  v_job_tech uuid;
  v_order_id uuid;
  v_invoice_id uuid;
  v_number text;
  v_status text;
  v_total integer;
  v_paid integer;
begin
  v_uid := assert_caller_role(array['admin', 'kasir', 'teknisi'],
    'Sesi tidak valid');
  select role::text into v_role from users where id = v_uid;

  if payload is null or jsonb_typeof(payload -> 'jobId') is distinct from 'string'
     or btrim(coalesce(payload ->> 'jobId', '')) = '' then
    raise exception 'jobId wajib diisi';
  end if;
  v_job_id := (payload ->> 'jobId')::uuid;

  select technician_id, order_id into v_job_tech, v_order_id
    from technician_jobs where id = v_job_id;
  if not found then
    raise exception 'Job tidak ditemukan';
  end if;

  -- Teknisi hanya boleh menengok tagihan job miliknya sendiri.
  if v_role = 'teknisi' and v_job_tech is distinct from v_uid then
    raise exception 'Job ini bukan milik Anda';
  end if;

  select i.id, i.number, i.status::text, i.grand_total, i.total_paid
    into v_invoice_id, v_number, v_status, v_total, v_paid
    from service_orders o
    join invoices i on i.id = o.invoice_id
   where o.id = v_order_id;

  if v_invoice_id is null then
    return jsonb_build_object('ok', true, 'hasInvoice', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'hasInvoice', true,
    'invoiceId', v_invoice_id,
    'number', v_number,
    'status', v_status,
    'grandTotal', v_total,
    'totalPaid', v_paid,
    'outstanding', greatest(v_total - v_paid, 0));
end;
$$;

revoke execute on function job_payment_info(jsonb) from anon, public;
grant execute on function job_payment_info(jsonb) to authenticated;
