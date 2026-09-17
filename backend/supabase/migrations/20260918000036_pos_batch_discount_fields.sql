-- =============================================================================
-- Kolom kecil dari skema Nest yang berdiri sendiri — murni ADDITIF.
-- Default 0 / nullable, sehingga checkout_transaction & client yang ada tidak
-- berubah perilaku; kolom baru terisi setelah RPC/UI yang memakainya dibuat.
--
-- * transaction_items.discount, invoice_items.discount : diskon per baris.
-- * products.sku : kode barang unik (spareparts.sku sudah ada sejak 0001).
--   Nullable — produk lama tanpa SKU tidak bentrok di constraint unik.
--
-- SENGAJA TIDAK ditambahkan:
-- * invoice_items.buy_price_snapshot — harga modal. invoice_items bisa dibaca
--   KASIR (policy 0003), dan Postgres tak bisa membatasi kolom per role di dalam
--   `authenticated` (lihat 0021). Kolom ini akan membocorkan margin ke kasir.
--   Tempatkan di tabel khusus admin (pola item_costs) saat rework batch-cost.
-- * stock_movements.item_cost_id — menunjuk PK item_costs.id yang baru ada
--   setelah rework item_costs multi-batch (di luar scope).
-- =============================================================================

alter table transaction_items
  add column if not exists discount integer not null default 0
    check (discount >= 0);

alter table invoice_items
  add column if not exists discount integer not null default 0
    check (discount >= 0);

alter table products
  add column if not exists sku text unique;
