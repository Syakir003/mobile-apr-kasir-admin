-- =============================================================================
-- E-POS AC — Skema awal PostgreSQL (Supabase)
-- Migrasi dari Firestore. Semua kolom snake_case (menormalkan model lama yang
-- sebagian camelCase seperti sellPrice/buyPrice). Uang rupiah = integer; qty &
-- stok sparepart boleh pecahan (numeric); pk numeric.
--
-- Catatan RLS: tabel di-enable RLS TANPA policy = deny-all (aman secara
-- default). Policy per-role ditambahkan di migrasi berikutnya. Penulisan
-- data kritis dilakukan Edge Function memakai service_role (bypass RLS).
-- =============================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------ ENUM types
create type user_role as enum ('admin', 'kasir', 'teknisi');

create type ac_unit_status as enum (
  'menunggu_pemasangan', 'aktif', 'dalam_maintenance', 'rusak', 'nonaktif'
);

create type invoice_status as enum (
  'belum_dibayar', 'dp', 'kurang_bayar', 'lunas', 'refund', 'batal'
);

create type payment_method as enum ('tunai', 'transfer', 'qris', 'ewallet');

-- Jenis item transaksi/invoice & mutasi stok.
create type item_kind as enum ('product', 'sparepart', 'service');

-- ------------------------------------------------------------- Counter helper
-- Nomor urut harian atomik (nomor invoice INV-YYYYMMDD-XXXX & barcode unit).
-- Menggantikan koleksi Firestore `counters/{key}`.
create table counters (
  key text primary key,
  seq integer not null default 0
);

create or replace function next_seq(p_key text) returns integer
language plpgsql
as $$
declare
  v_seq integer;
begin
  insert into counters (key, seq) values (p_key, 1)
  on conflict (key) do update set seq = counters.seq + 1
  returning seq into v_seq;
  return v_seq;
end;
$$;

-- ------------------------------------------------------------------ users
-- Profil publik pengguna; id = auth.users.id (Supabase Auth). Role juga
-- disalin ke JWT claim di langkah auth (custom access token hook).
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role user_role not null default 'kasir',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Buat baris profil otomatis saat user auth baru dibuat.
create or replace function handle_new_user() returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------------ products
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text not null,
  type text not null,
  pk numeric not null default 0,
  inverter boolean not null default false,
  btu integer,
  watt integer,
  warranty text,
  buy_price integer not null default 0,
  sell_price integer not null default 0,
  stock integer not null default 0,
  photo_url text,
  description text,
  category text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index products_active_idx on products (active);

-- ------------------------------------------------------------------ spareparts
create table spareparts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text not null default '',
  category text not null,
  unit text not null,
  buy_price integer not null default 0,
  sell_price integer not null default 0,
  stock numeric not null default 0,
  min_stock numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index spareparts_active_idx on spareparts (active);

-- ------------------------------------------------------------------ services
create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  base_price integer not null default 0,
  duration_minutes integer,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index services_active_idx on services (active);

-- --------------------------------------------------- installation_packages
create table installation_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Item paket (dulu array `items[]` di dalam dokumen).
create table installation_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references installation_packages (id) on delete cascade,
  sparepart_id uuid references spareparts (id),
  name text not null,
  qty numeric not null default 0,
  unit text not null default '',
  extra_price_per_unit integer not null default 0
);
create index installation_package_items_package_idx
  on installation_package_items (package_id);

-- ------------------------------------------------------------------ members
create table members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  address text not null default '',
  customer_type text not null default 'lainnya'
    check (customer_type in ('rumah', 'kantor', 'toko', 'perusahaan', 'lainnya')),
  member_since timestamptz,
  total_ac_units integer not null default 0,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ member_ac_units
create table member_ac_units (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members (id) on delete cascade,
  brand text not null,
  model text not null,
  pk numeric not null default 0,
  room_location text not null default '',
  barcode_value text unique,
  serial_number text,
  installation_date timestamptz,
  last_service_date timestamptz,
  next_service_date timestamptz,
  status ac_unit_status not null default 'menunggu_pemasangan',
  created_at timestamptz not null default now()
);
create index member_ac_units_member_idx on member_ac_units (member_id);

-- ------------------------------------------------------------------ transactions
create table transactions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members (id),
  customer_name text not null,
  customer_phone text not null,
  subtotal integer not null default 0,
  discount integer not null default 0,
  tax_percent numeric not null default 0,
  tax_amount integer not null default 0,
  transport_fee integer not null default 0,
  grand_total integer not null default 0,
  notes text,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index transactions_member_idx on transactions (member_id);
create index transactions_created_at_idx on transactions (created_at desc);

create table transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  kind item_kind not null,
  ref_id uuid not null,          -- id product/sparepart/service (polimorfik, tanpa FK)
  name text not null,
  unit text not null,
  qty numeric not null,
  unit_price integer not null,
  line_total integer not null
);
create index transaction_items_transaction_idx
  on transaction_items (transaction_id);

-- ------------------------------------------------------------------ invoices
create table invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,   -- INV-YYYYMMDD-XXXX
  transaction_id uuid references transactions (id),
  member_id uuid references members (id),
  customer_name text not null,
  customer_phone text not null,
  subtotal integer not null default 0,
  discount integer not null default 0,
  tax_percent numeric not null default 0,
  tax_amount integer not null default 0,
  transport_fee integer not null default 0,
  grand_total integer not null default 0,
  total_paid integer not null default 0,
  status invoice_status not null default 'belum_dibayar',
  notes text,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index invoices_created_at_idx on invoices (created_at desc);
create index invoices_member_idx on invoices (member_id);

-- Snapshot item di invoice (dulu array `items[]`). Struk self-contained.
create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  kind item_kind not null,
  ref_id uuid not null,
  name text not null,
  unit text not null,
  qty numeric not null,
  unit_price integer not null,
  line_total integer not null
);
create index invoice_items_invoice_idx on invoice_items (invoice_id);

-- ------------------------------------------------------------ manual_payments
create table manual_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  method payment_method not null,
  amount integer not null check (amount > 0),
  note text,
  proof_url text,               -- null di Fase 4; upload bukti menyusul
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index manual_payments_invoice_idx on manual_payments (invoice_id);

-- ------------------------------------------------------------ stock_movements
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_kind item_kind not null check (item_kind in ('product', 'sparepart')),
  ref_id uuid not null,
  name text not null,
  qty_change numeric not null,  -- negatif untuk penjualan
  reason text not null,         -- 'penjualan', 'koreksi', dst
  transaction_id uuid references transactions (id),
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index stock_movements_transaction_idx on stock_movements (transaction_id);

-- ------------------------------------------------------------ service_orders
-- Dibuat oleh checkout untuk item AC "dengan pemasangan". Satu order per
-- checkout; unit-nya di tabel anak. Status type = TEXT (akan diformalkan Fase 5).
create table service_orders (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references members (id),
  transaction_id uuid references transactions (id),
  invoice_id uuid references invoices (id),
  type text not null default 'pemasangan',
  status text not null default 'terjadwal',
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);

create table service_order_units (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references service_orders (id) on delete cascade,
  unit_id uuid references member_ac_units (id),
  status text not null default 'menunggu_pemasangan'
);
create index service_order_units_order_idx on service_order_units (order_id);

-- ------------------------------------------------------------ technician_jobs
-- Satu job per unit. technician_id null => 'menunggu_penugasan'.
create table technician_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references service_orders (id) on delete cascade,
  member_id uuid references members (id),
  unit_id uuid references member_ac_units (id),
  technician_id uuid references users (id),
  type text not null default 'pemasangan',
  status text not null default 'menunggu_penugasan',
  scheduled_date timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index technician_jobs_technician_idx on technician_jobs (technician_id);
create index technician_jobs_order_idx on technician_jobs (order_id);

-- ------------------------------------------------------------------ audit_logs
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_uid uuid references users (id),
  action text not null,          -- 'pos.checkout', 'pos.payment', dst
  target text,                   -- id entitas terkait (mis. invoice)
  detail jsonb,
  at timestamptz not null default now()
);
create index audit_logs_at_idx on audit_logs (at desc);

-- ------------------------------------------------------ enable RLS (deny-all)
-- Tanpa policy = semua akses lewat anon/authenticated ditolak (aman). Policy
-- per-role ditambahkan di migrasi berikutnya. service_role tetap bypass RLS.
alter table users enable row level security;
alter table products enable row level security;
alter table spareparts enable row level security;
alter table services enable row level security;
alter table installation_packages enable row level security;
alter table installation_package_items enable row level security;
alter table members enable row level security;
alter table member_ac_units enable row level security;
alter table transactions enable row level security;
alter table transaction_items enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table manual_payments enable row level security;
alter table stock_movements enable row level security;
alter table service_orders enable row level security;
alter table service_order_units enable row level security;
alter table technician_jobs enable row level security;
alter table audit_logs enable row level security;
alter table counters enable row level security;
