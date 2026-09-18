-- =============================================================================
-- Atribusi shift kasir ke pembayaran TUNAI.
--
-- `manual_payments.shift_id` (migrasi 0035) belum pernah diisi, sehingga
-- close_cashier_shift selalu menghitung total tunai 0. Pembayaran tunai kini
-- otomatis ditautkan ke shift TERBUKA milik pemanggil (kasir/admin yang login).
--   * Tidak ada shift terbuka  -> shift_id NULL, pembayaran tetap berhasil.
--   * Non-tunai                -> shift_id selalu NULL (perilaku tidak berubah).
--
-- Lock: baris shift dibaca `for share`. close_cashier_shift mengunci baris yang
-- sama `for update`, jadi keduanya berurutan:
--   * pembayaran lebih dulu -> penutupan menunggu commit, totalnya ikut terhitung;
--   * penutupan lebih dulu  -> pembayaran melihat closed_at terisi -> shift_id NULL.
-- Dua pembayaran bersamaan dari kasir yang sama tidak saling menunggu.
-- =============================================================================

-- =============================================================================
-- record_payment — DEFINISI ULANG dari 0031. Perubahan tunggal: untuk metode
-- tunai, isi `shift_id` dengan shift terbuka milik pemanggil (NULL bila tak ada).
-- Validasi, otorisasi, penguncian invoice, audit log, dan nilai kembali identik.
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
  v_shift_id uuid;
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

  -- Shift terbuka milik pemanggil; tak ada -> NULL (pembayaran tetap jalan).
  if v_method = 'tunai' then
    select s.id into v_shift_id
      from cashier_shifts s
     where s.kasir_id = v_uid and s.closed_at is null
     for share;
  end if;

  insert into manual_payments
    (invoice_id, method, amount, cash_received, note, proof_url, created_by, shift_id)
  values
    (v_invoice_id, v_method::payment_method, v_amount, v_cash_received,
     v_note, null, v_uid, v_shift_id);

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

-- ACL sama dengan definisi awal 0005 (create or replace mempertahankannya;
-- ditulis ulang eksplisit sebagai jaring pengaman).
revoke execute on function record_payment(jsonb) from anon, public;
grant execute on function record_payment(jsonb) to authenticated;
