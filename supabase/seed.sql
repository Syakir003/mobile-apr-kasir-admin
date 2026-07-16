-- =============================================================================
-- E-POS AC — Data dummy (seed) untuk pengembangan lokal.
-- Dijalankan otomatis oleh `supabase db reset` (butuh config.toml, lihat catatan
-- di bawah). Semua id di-hardcode agar relasi antar tabel bisa direferensikan
-- dan seed idempotent (aman dijalankan ulang).
--
-- Totals invoice mengikuti util server (functions/src/pos):
--   lineTotal = round(qty * unitPrice); subtotal = Σ lineTotal;
--   taxBase = subtotal - discount; taxAmount = round(taxBase * taxPercent/100);
--   grandTotal = taxBase + taxAmount + transportFee   (transport TIDAK kena pajak)
-- Status: paid<=0 & grand>0 → belum_dibayar; paid<grand → dp; paid>=grand → lunas
--
-- Login lokal (password sama untuk semua akun demo): password123
--   admin@eposac.local    (admin)
--   kasir@eposac.local    (kasir)
--   teknisi@eposac.local  (teknisi)
--
-- Catatan: jika folder supabase belum di-`init` (belum ada config.toml), seed
-- ini bisa dijalankan manual:  psql "$DATABASE_URL" -f supabase/seed.sql
-- =============================================================================

-- ------------------------------------------------------------------ auth users
-- Insert langsung ke auth.users agar bisa login di lokal. Trigger
-- handle_new_user akan otomatis membuat baris public.users (role default kasir);
-- role & display_name diperbaiki di bagian "public users" di bawah.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'admin@eposac.local', crypt('password123', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Admin Ayub"}'),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'kasir@eposac.local', crypt('password123', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Kasir Dewi"}'),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'teknisi@eposac.local', crypt('password123', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}',
   '{"display_name":"Teknisi Andi"}')
on conflict (id) do nothing;

-- GoTrue (service auth) memindai kolom token sebagai string Go non-nullable.
-- Insert manual di atas membiarkannya NULL → login gagal 500 "converting NULL
-- to string is unsupported". Set ke '' (string kosong) seperti yang dilakukan
-- signup normal.
update auth.users set
  confirmation_token = '', recovery_token = '', email_change_token_new = '',
  email_change = '', email_change_token_current = '', phone_change = '',
  phone_change_token = '', reauthentication_token = ''
where email like '%@eposac.local';

-- Identitas email (dibutuhkan sebagian flow auth Supabase).
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@eposac.local"}',
   'email', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000002',
   '{"sub":"00000000-0000-0000-0000-000000000002","email":"kasir@eposac.local"}',
   'email', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000003',
   '{"sub":"00000000-0000-0000-0000-000000000003","email":"teknisi@eposac.local"}',
   'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

-- ----------------------------------------------------------------- public users
-- Perbaiki role/display_name (trigger membuatnya dengan role default 'kasir').
insert into public.users (id, email, display_name, role, active)
values
  ('00000000-0000-0000-0000-000000000001', 'admin@eposac.local',   'Admin Ayub',   'admin',   true),
  ('00000000-0000-0000-0000-000000000002', 'kasir@eposac.local',   'Kasir Dewi',   'kasir',   true),
  ('00000000-0000-0000-0000-000000000003', 'teknisi@eposac.local', 'Teknisi Andi', 'teknisi', true)
on conflict (id) do update
  set role = excluded.role,
      display_name = excluded.display_name,
      active = excluded.active;

-- ------------------------------------------------------------------ products
insert into products (id, name, brand, type, pk, inverter, btu, watt, warranty,
                      buy_price, sell_price, stock, category, description) values
  ('10000000-0000-0000-0000-000000000001', 'Daikin FTKC-15 1 PK Inverter', 'Daikin', 'split', 1,   true,  9000, 720, '1 thn unit / 4 thn kompresor', 4200000, 5500000, 8, 'AC Split', 'Inverter hemat listrik, PK 1'),
  ('10000000-0000-0000-0000-000000000002', 'Panasonic CS-YN5 1/2 PK',      'Panasonic', 'split', 0.5, false, 5000, 380, '1 thn unit / 3 thn kompresor', 2400000, 3200000, 12, 'AC Split', 'Standar non-inverter, PK 0.5'),
  ('10000000-0000-0000-0000-000000000003', 'Sharp AH-A9 1 PK',             'Sharp', 'split', 1,   false, 9000, 660, '1 thn unit / 5 thn kompresor', 3100000, 4200000, 6, 'AC Split', 'Non-inverter, PK 1'),
  ('10000000-0000-0000-0000-000000000004', 'Gree GWC-18 2 PK Inverter',    'Gree', 'split', 2,   true,  18000, 1450, '1 thn unit / 5 thn kompresor', 6100000, 7900000, 4, 'AC Split', 'Inverter ruangan besar, PK 2');

-- ------------------------------------------------------------------ spareparts
insert into spareparts (id, name, sku, category, unit, buy_price, sell_price, stock, min_stock) values
  ('20000000-0000-0000-0000-000000000001', 'Freon R32',            'FRN-R32', 'Freon',    'kg',    90000,  150000, 25, 5),
  ('20000000-0000-0000-0000-000000000002', 'Pipa Tembaga 1/4-3/8', 'PIP-1438','Pipa',     'meter', 45000,  75000,  60, 10),
  ('20000000-0000-0000-0000-000000000003', 'Bracket Outdoor',      'BRK-OUT', 'Bracket',  'set',   35000,  65000,  20, 4),
  ('20000000-0000-0000-0000-000000000004', 'Kabel NYM 3x1.5',      'KBL-315', 'Kabel',    'meter', 8000,   15000,  100, 20),
  ('20000000-0000-0000-0000-000000000005', 'Kapasitor 25uF',       'KAP-25',  'Kelistrikan','pcs', 22000,  45000,  15, 3);

-- ------------------------------------------------------------------ services
insert into services (id, name, category, base_price, duration_minutes, description) values
  ('30000000-0000-0000-0000-000000000001', 'Cuci AC 1/2 - 1 PK',  'Cuci',     65000,  45, 'Cuci indoor + outdoor, PK <= 1'),
  ('30000000-0000-0000-0000-000000000002', 'Cuci AC 1.5 - 2 PK',  'Cuci',     85000,  60, 'Cuci indoor + outdoor, PK 1.5-2'),
  ('30000000-0000-0000-0000-000000000003', 'Isi Freon R32',       'Perbaikan',120000, 40, 'Termasuk pengecekan tekanan (belum termasuk freon)'),
  ('30000000-0000-0000-0000-000000000004', 'Bongkar Pasang AC',   'Pindah',   250000, 120,'Pembongkaran + pemasangan ulang di lokasi baru');

-- --------------------------------------------------- installation packages
insert into installation_packages (id, name, description) values
  ('40000000-0000-0000-0000-000000000001', 'Paket Pasang Standar', 'Pemasangan AC baru: pipa 3m, bracket, kabel, vakum');

insert into installation_package_items (package_id, sparepart_id, name, qty, unit, extra_price_per_unit) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Pipa Tembaga 1/4-3/8', 3, 'meter', 0),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Bracket Outdoor',      1, 'set',   0),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'Kabel NYM 3x1.5',      4, 'meter', 0);

-- ------------------------------------------------------------------ members
insert into members (id, name, phone, address, customer_type, member_since, total_ac_units, notes) values
  ('50000000-0000-0000-0000-000000000001', 'Budi Santoso',  '+6281234567890', 'Jl. Melati No. 12, Solo',      'rumah',      now() - interval '90 days', 1, 'Pelanggan langganan cuci AC'),
  ('50000000-0000-0000-0000-000000000002', 'CV Maju Jaya',  '+6282198765432', 'Jl. Industri No. 5, Sukoharjo','perusahaan', now() - interval '30 days', 0, 'Kantor, banyak unit'),
  ('50000000-0000-0000-0000-000000000003', 'Toko Berkah',   '+6285711122233', 'Ruko Pasar Legi Blok C3, Solo','toko',       null,                        0, null);

-- ------------------------------------------------------------ member_ac_units
-- Unit AC milik Budi, dibuat lewat transaksi pemasangan (TRX-2 di bawah).
insert into member_ac_units (id, member_id, brand, model, pk, room_location,
                             barcode_value, status, installation_date) values
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   'Daikin', 'FTKC-15 1 PK Inverter', 1, 'Kamar Utama',
   'ACUNIT-20260715-0001', 'menunggu_pemasangan', null);

-- =============================================================================
-- TRANSAKSI 1 — retail: cuci AC 2 unit + freon 0.5 kg. LUNAS tunai.
--   subtotal = 130000 + 75000 = 205000; grand = 205000; paid = 205000
-- =============================================================================
insert into transactions (id, member_id, customer_name, customer_phone,
                          subtotal, discount, tax_percent, tax_amount,
                          transport_fee, grand_total, created_by, created_at) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   'Budi Santoso', '+6281234567890', 205000, 0, 0, 0, 0, 205000,
   '00000000-0000-0000-0000-000000000002', now() - interval '2 days');

insert into transaction_items (transaction_id, kind, ref_id, name, unit, qty, unit_price, line_total) values
  ('60000000-0000-0000-0000-000000000001', 'service', '30000000-0000-0000-0000-000000000001', 'Cuci AC 1/2 - 1 PK', 'unit', 2,   65000,  130000),
  ('60000000-0000-0000-0000-000000000001', 'sparepart','20000000-0000-0000-0000-000000000001','Freon R32',          'kg',   0.5, 150000, 75000);

insert into invoices (id, number, transaction_id, member_id, customer_name, customer_phone,
                      subtotal, discount, tax_percent, tax_amount, transport_fee,
                      grand_total, total_paid, status, created_by, created_at) values
  ('70000000-0000-0000-0000-000000000001', 'INV-20260715-0001',
   '60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   'Budi Santoso', '+6281234567890', 205000, 0, 0, 0, 0, 205000, 205000, 'lunas',
   '00000000-0000-0000-0000-000000000002', now() - interval '2 days');

insert into invoice_items (invoice_id, kind, ref_id, name, unit, qty, unit_price, line_total) values
  ('70000000-0000-0000-0000-000000000001', 'service', '30000000-0000-0000-0000-000000000001', 'Cuci AC 1/2 - 1 PK', 'unit', 2,   65000,  130000),
  ('70000000-0000-0000-0000-000000000001', 'sparepart','20000000-0000-0000-0000-000000000001','Freon R32',          'kg',   0.5, 150000, 75000);

insert into manual_payments (invoice_id, method, amount, note, created_by, created_at) values
  ('70000000-0000-0000-0000-000000000001', 'tunai', 205000, 'Pelunasan di tempat',
   '00000000-0000-0000-0000-000000000002', now() - interval '2 days');

insert into stock_movements (item_kind, ref_id, name, qty_change, reason, transaction_id, created_by, created_at) values
  ('sparepart', '20000000-0000-0000-0000-000000000001', 'Freon R32', -0.5, 'penjualan',
   '60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', now() - interval '2 days');

-- =============================================================================
-- TRANSAKSI 2 — AC baru + pemasangan. DP (kurang bayar). Buat service order &
--   job teknisi. subtotal = 5500000 + 350000 = 5850000; discount 100000;
--   transport 50000; grand = (5850000-100000)+0+50000 = 5800000; paid 2000000 → dp
-- =============================================================================
insert into transactions (id, member_id, customer_name, customer_phone,
                          subtotal, discount, tax_percent, tax_amount,
                          transport_fee, grand_total, notes, created_by, created_at) values
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
   'Budi Santoso', '+6281234567890', 5850000, 100000, 0, 0, 50000, 5800000,
   'Pasang di kamar utama, jadwal menyusul', '00000000-0000-0000-0000-000000000002',
   now() - interval '1 day');

insert into transaction_items (transaction_id, kind, ref_id, name, unit, qty, unit_price, line_total) values
  ('60000000-0000-0000-0000-000000000002', 'product', '10000000-0000-0000-0000-000000000001', 'Daikin FTKC-15 1 PK Inverter', 'unit', 1, 5500000, 5500000),
  ('60000000-0000-0000-0000-000000000002', 'service', '30000000-0000-0000-0000-000000000004', 'Paket Pasang Standar',         'paket',1, 350000,  350000);

insert into invoices (id, number, transaction_id, member_id, customer_name, customer_phone,
                      subtotal, discount, tax_percent, tax_amount, transport_fee,
                      grand_total, total_paid, status, notes, created_by, created_at) values
  ('70000000-0000-0000-0000-000000000002', 'INV-20260715-0002',
   '60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001',
   'Budi Santoso', '+6281234567890', 5850000, 100000, 0, 0, 50000, 5800000, 2000000, 'dp',
   'DP 2 juta via transfer', '00000000-0000-0000-0000-000000000002', now() - interval '1 day');

insert into invoice_items (invoice_id, kind, ref_id, name, unit, qty, unit_price, line_total) values
  ('70000000-0000-0000-0000-000000000002', 'product', '10000000-0000-0000-0000-000000000001', 'Daikin FTKC-15 1 PK Inverter', 'unit', 1, 5500000, 5500000),
  ('70000000-0000-0000-0000-000000000002', 'service', '30000000-0000-0000-0000-000000000004', 'Paket Pasang Standar',         'paket',1, 350000,  350000);

insert into manual_payments (invoice_id, method, amount, note, created_by, created_at) values
  ('70000000-0000-0000-0000-000000000002', 'transfer', 2000000, 'DP via transfer BCA',
   '00000000-0000-0000-0000-000000000002', now() - interval '1 day');

insert into stock_movements (item_kind, ref_id, name, qty_change, reason, transaction_id, created_by, created_at) values
  ('product', '10000000-0000-0000-0000-000000000001', 'Daikin FTKC-15 1 PK Inverter', -1, 'penjualan',
   '60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', now() - interval '1 day');

-- Service order + unit + job teknisi untuk pemasangan.
insert into service_orders (id, member_id, transaction_id, invoice_id, type, status, created_by, created_at) values
  ('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   '60000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002',
   'pemasangan', 'terjadwal', '00000000-0000-0000-0000-000000000002', now() - interval '1 day');

insert into service_order_units (order_id, unit_id, status) values
  ('80000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'menunggu_pemasangan');

insert into technician_jobs (order_id, member_id, unit_id, technician_id, type, status, scheduled_date, created_by, created_at) values
  ('80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001',
   '51000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003',
   'pemasangan', 'terjadwal', now() + interval '1 day',
   '00000000-0000-0000-0000-000000000002', now() - interval '1 day');

-- =============================================================================
-- TRANSAKSI 3 — AC baru, BELUM DIBAYAR. subtotal = grand = 4200000; paid 0
-- =============================================================================
insert into transactions (id, member_id, customer_name, customer_phone,
                          subtotal, discount, tax_percent, tax_amount,
                          transport_fee, grand_total, created_by, created_at) values
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003',
   'Toko Berkah', '+6285711122233', 4200000, 0, 0, 0, 0, 4200000,
   '00000000-0000-0000-0000-000000000002', now() - interval '3 hours');

insert into transaction_items (transaction_id, kind, ref_id, name, unit, qty, unit_price, line_total) values
  ('60000000-0000-0000-0000-000000000003', 'product', '10000000-0000-0000-0000-000000000003', 'Sharp AH-A9 1 PK', 'unit', 1, 4200000, 4200000);

insert into invoices (id, number, transaction_id, member_id, customer_name, customer_phone,
                      subtotal, discount, tax_percent, tax_amount, transport_fee,
                      grand_total, total_paid, status, created_by, created_at) values
  ('70000000-0000-0000-0000-000000000003', 'INV-20260715-0003',
   '60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003',
   'Toko Berkah', '+6285711122233', 4200000, 0, 0, 0, 0, 4200000, 0, 'belum_dibayar',
   '00000000-0000-0000-0000-000000000002', now() - interval '3 hours');

insert into invoice_items (invoice_id, kind, ref_id, name, unit, qty, unit_price, line_total) values
  ('70000000-0000-0000-0000-000000000003', 'product', '10000000-0000-0000-0000-000000000003', 'Sharp AH-A9 1 PK', 'unit', 1, 4200000, 4200000);

insert into stock_movements (item_kind, ref_id, name, qty_change, reason, transaction_id, created_by, created_at) values
  ('product', '10000000-0000-0000-0000-000000000003', 'Sharp AH-A9 1 PK', -1, 'penjualan',
   '60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', now() - interval '3 hours');

-- ------------------------------------------------------------------ audit logs
insert into audit_logs (actor_uid, action, target, detail) values
  ('00000000-0000-0000-0000-000000000002', 'pos.checkout', '70000000-0000-0000-0000-000000000001', '{"number":"INV-20260715-0001","grand_total":205000}'),
  ('00000000-0000-0000-0000-000000000002', 'pos.checkout', '70000000-0000-0000-0000-000000000002', '{"number":"INV-20260715-0002","grand_total":5800000}'),
  ('00000000-0000-0000-0000-000000000002', 'pos.payment',  '70000000-0000-0000-0000-000000000002', '{"method":"transfer","amount":2000000}'),
  ('00000000-0000-0000-0000-000000000002', 'pos.checkout', '70000000-0000-0000-0000-000000000003', '{"number":"INV-20260715-0003","grand_total":4200000}');

-- ------------------------------------------------------------------ counters
-- Selaraskan counter harian dengan nomor invoice & barcode yang sudah dipakai
-- di atas, supaya checkout berikutnya melanjutkan urutan (bukan menabrak).
insert into counters (key, seq) values
  ('invoice_20260715', 3),
  ('acunit_20260715', 1)
on conflict (key) do update set seq = excluded.seq;
