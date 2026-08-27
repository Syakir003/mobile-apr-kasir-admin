-- =============================================================================
-- Kembalian pembayaran tunai.
--
-- Sebelumnya `record_payment` hanya menerima `amount` (uang yang masuk ke
-- tagihan, di-clamp ke sisa oleh client). Uang tunai fisik yang diserahkan
-- pelanggan tidak tersimpan, jadi kembalian cuma tampil sekilas di form dan
-- hilang dari struk/detail.
--
-- `manual_payments.amount`        : tetap = uang yang MASUK ke tagihan (<= sisa)
-- `manual_payments.cash_received` : uang tunai yang diserahkan pelanggan
--                                   (>= amount); selisihnya kembalian.
--                                   NULL untuk non-tunai atau uang pas.
-- =============================================================================

alter table manual_payments
  add column cash_received integer
  check (cash_received is null or cash_received >= amount);

-- =============================================================================
-- record_payment — DEFINISI ULANG dari 0014. Perubahan tunggal: menerima
-- `payload.cashReceived` opsional (hanya tunai, bilangan bulat >= amount) dan
-- menyimpannya. Perhitungan tagihan/status tidak berubah.
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
  v_cash_received integer;
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

  -- Uang tunai diserahkan (opsional). Hanya tunai; harus >= amount.
  if payload ? 'cashReceived'
     and jsonb_typeof(payload -> 'cashReceived') is distinct from 'null' then
    if v_method <> 'tunai' then
      raise exception 'Uang diterima hanya untuk pembayaran tunai';
    end if;
    if jsonb_typeof(payload -> 'cashReceived') is distinct from 'number'
       or (payload ->> 'cashReceived')::numeric
          <> trunc((payload ->> 'cashReceived')::numeric)
       or (payload ->> 'cashReceived')::integer < v_amount then
      raise exception 'Uang diterima tidak valid';
    end if;
    v_cash_received := (payload ->> 'cashReceived')::integer;
  end if;

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

  insert into manual_payments
    (invoice_id, method, amount, cash_received, note, proof_url, created_by)
  values
    (v_invoice_id, v_method::payment_method, v_amount, v_cash_received,
     v_note, null, v_uid);

  update invoices set total_paid = v_new_paid, status = v_new_status
    where id = v_invoice_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'pos.payment', v_invoice_id::text,
          jsonb_build_object('method', v_method, 'amount', v_amount,
                             'cashReceived', v_cash_received,
                             'status', v_new_status));

  return jsonb_build_object('status', v_new_status, 'totalPaid', v_new_paid);
end;
$$;
