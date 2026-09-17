-- =============================================================================
-- Kas & shift kasir — port dari Nest `20260822020000_cashier_shifts` dan
-- ShiftsService (open, close).
--
-- * cashier_shifts          : buka/tutup laci kas per kasir. Uang = integer
--                             rupiah (konvensi skema ini, bukan Decimal Prisma).
-- * manual_payments.shift_id: atribusi OPSIONAL pembayaran ke shift. SET NULL
--                             bila shift dihapus — riwayat bayar tak ikut hilang.
--
-- Satu kasir hanya boleh punya satu shift terbuka. Dijaga dua lapis: cek + FOR
-- UPDATE di RPC (pesan ramah), dan unique index parsial sebagai penjaga akhir —
-- FOR UPDATE tak mengunci apa pun saat belum ada baris terbuka, jadi dua klik
-- bersamaan hanya tertahan oleh index.
--
-- Laporan per shift tidak butuh RPC: cukup `select` dari client (RLS di bawah).
-- Catatan: record_payment BELUM mengisi shift_id (tidak diubah di migrasi ini),
-- jadi total tunai shift baru terhitung setelah record_payment diperbarui.
-- =============================================================================

create table if not exists cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  kasir_id uuid not null references users (id),
  opening_balance integer not null check (opening_balance >= 0),
  closing_balance integer check (closing_balance is null or closing_balance >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text
);
create index if not exists cashier_shifts_kasir_idx
  on cashier_shifts (kasir_id, opened_at desc);
create unique index if not exists cashier_shifts_one_open_per_kasir
  on cashier_shifts (kasir_id) where closed_at is null;

alter table manual_payments
  add column if not exists shift_id uuid
    references cashier_shifts (id) on delete set null;
create index if not exists manual_payments_shift_idx
  on manual_payments (shift_id);

-- ----------------------------------------------------------------------- akses
-- Finansial: baca admin/kasir (pola transactions 0003); tulis hanya lewat RPC.
alter table cashier_shifts enable row level security;
grant select on cashier_shifts to authenticated;

drop policy if exists "cashier shifts: baca admin/kasir" on cashier_shifts;
create policy "cashier shifts: baca admin/kasir"
  on cashier_shifts for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

-- =============================================================================
-- open_cashier_shift(payload) — kasir/admin membuka shift untuk dirinya.
-- Payload: { openingBalance }   (bilangan bulat >= 0)
-- Return: { ok, shiftId, openingBalance, openedAt }
-- =============================================================================
create or replace function open_cashier_shift(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_opening integer;
  v_id uuid;
  v_opened_at timestamptz;
begin
  v_uid := assert_caller_role(array['admin', 'kasir'],
    'Hanya Admin/Kasir yang boleh membuka shift');

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'openingBalance') is distinct from 'number'
     or (payload ->> 'openingBalance')::numeric
        <> trunc((payload ->> 'openingBalance')::numeric)
     or (payload ->> 'openingBalance')::numeric < 0 then
    raise exception 'Modal awal harus bilangan bulat 0 atau lebih';
  end if;
  v_opening := (payload ->> 'openingBalance')::integer;

  perform 1 from cashier_shifts
    where kasir_id = v_uid and closed_at is null
    for update;
  if found then
    raise exception 'Masih ada shift yang belum ditutup. Tutup shift sebelumnya dulu sebelum buka shift baru.';
  end if;

  begin
    insert into cashier_shifts (kasir_id, opening_balance)
    values (v_uid, v_opening)
    returning id, opened_at into v_id, v_opened_at;
  exception when unique_violation then
    raise exception 'Masih ada shift yang belum ditutup. Tutup shift sebelumnya dulu sebelum buka shift baru.';
  end;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'shift.open', v_id::text,
          jsonb_build_object('openingBalance', v_opening));

  return jsonb_build_object('ok', true, 'shiftId', v_id,
    'openingBalance', v_opening, 'openedAt', v_opened_at);
end;
$$;

revoke execute on function open_cashier_shift(jsonb) from anon, public;
grant execute on function open_cashier_shift(jsonb) to authenticated;

-- =============================================================================
-- close_cashier_shift(payload) — pemilik shift menutup shift-nya.
-- Payload: { shiftId, closingBalance, notes? }
--   totalTunai   = SUM(manual_payments.amount) method 'tunai' pada shift ini
--                  (tanpa filter status: sistem ini tak punya verifikasi bayar)
--   expectedCash = openingBalance + totalTunai
--   selisih      = closingBalance - expectedCash
-- Return: { ok, closingBalance, expectedCash, selisih }
-- =============================================================================
create or replace function close_cashier_shift(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_shift_id uuid;
  v_closing integer;
  v_notes text;
  v_shift record;
  v_total_tunai integer;
  v_expected integer;
  v_selisih integer;
begin
  v_uid := assert_caller_role(array['admin', 'kasir'],
    'Hanya Admin/Kasir yang boleh menutup shift');

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;
  if jsonb_typeof(payload -> 'shiftId') is distinct from 'string'
     or btrim(payload ->> 'shiftId') = '' then
    raise exception 'shiftId wajib diisi';
  end if;
  if jsonb_typeof(payload -> 'closingBalance') is distinct from 'number'
     or (payload ->> 'closingBalance')::numeric
        <> trunc((payload ->> 'closingBalance')::numeric)
     or (payload ->> 'closingBalance')::numeric < 0 then
    raise exception 'Saldo akhir harus bilangan bulat 0 atau lebih';
  end if;

  v_shift_id := (payload ->> 'shiftId')::uuid;
  v_closing := (payload ->> 'closingBalance')::integer;
  v_notes := nullif(btrim(coalesce(payload ->> 'notes', '')), '');

  select id, kasir_id, opening_balance, closed_at
    into v_shift
    from cashier_shifts where id = v_shift_id
    for update;
  if not found then
    raise exception 'Shift tidak ditemukan';
  end if;
  if v_shift.kasir_id <> v_uid then
    raise exception 'Bukan shift milik Anda';
  end if;
  if v_shift.closed_at is not null then
    raise exception 'Shift ini sudah ditutup';
  end if;

  select coalesce(sum(amount), 0)::integer into v_total_tunai
    from manual_payments
   where shift_id = v_shift_id and method = 'tunai';

  v_expected := v_shift.opening_balance + v_total_tunai;
  v_selisih := v_closing - v_expected;

  update cashier_shifts
     set closing_balance = v_closing,
         closed_at = now(),
         notes = coalesce(v_notes, notes)
   where id = v_shift_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'shift.close', v_shift_id::text,
          jsonb_build_object('closingBalance', v_closing,
                             'expectedCash', v_expected,
                             'selisih', v_selisih));

  return jsonb_build_object('ok', true, 'closingBalance', v_closing,
    'expectedCash', v_expected, 'selisih', v_selisih);
end;
$$;

revoke execute on function close_cashier_shift(jsonb) from anon, public;
grant execute on function close_cashier_shift(jsonb) to authenticated;
