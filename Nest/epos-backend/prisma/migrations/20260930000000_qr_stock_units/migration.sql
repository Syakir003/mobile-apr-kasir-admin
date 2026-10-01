-- Siklus QR per-unit (2026-09-30): StockUnit jadi satu-satunya sumber
-- kebenaran stok Produk. item_costs.stock TETAP ada (gak di-drop) tapi
-- BERHENTI dipakai buat kind='product' mulai sekarang.

-- 1) Tabel baru.
CREATE TABLE "stock_units" (
  "id" TEXT NOT NULL,
  "item_cost_id" TEXT NOT NULL,
  "ref_id" TEXT NOT NULL,
  "unit_code" TEXT NOT NULL,
  "qr_token" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'di_gudang',
  "reserved_for_invoice_id" TEXT,
  "reserved_at" TIMESTAMP(3),
  "sold_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_units_unit_code_key" ON "stock_units"("unit_code");
CREATE UNIQUE INDEX "stock_units_qr_token_key" ON "stock_units"("qr_token");
CREATE INDEX "stock_units_item_cost_id_idx" ON "stock_units"("item_cost_id");
CREATE INDEX "stock_units_ref_id_status_idx" ON "stock_units"("ref_id", "status");
CREATE INDEX "stock_units_reserved_for_invoice_id_idx" ON "stock_units"("reserved_for_invoice_id");

ALTER TABLE "stock_units" ADD CONSTRAINT "stock_units_item_cost_id_fkey"
  FOREIGN KEY ("item_cost_id") REFERENCES "item_costs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_units" ADD CONSTRAINT "stock_units_ref_id_fkey"
  FOREIGN KEY ("ref_id") REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_units" ADD CONSTRAINT "stock_units_reserved_for_invoice_id_fkey"
  FOREIGN KEY ("reserved_for_invoice_id") REFERENCES "invoices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Backfill: semua ItemCost (kind='product', stock>0) yang UDAH ADA
--    sebelum fitur ini di-backfill jadi N baris StockUnit (N = stock saat
--    ini), status 'di_gudang'. Unit-unit ini belum pernah punya label fisik
--    tertempel (dicetak SEBELUM fitur ini ada = gak mungkin) — admin perlu
--    "cetak ulang label" belakangan lewat GET /stock/batches/:itemCostId/units
--    buat nyusulin nempelin QR ke stok lama yang udah numpuk di gudang.
--
--    id & qr_token digenerate pakai trik md5(random()+clock_timestamp())
--    di-cast ke format mirip UUID (TANPA extension tambahan kayak pgcrypto/
--    uuid-ossp — portable di Postgres manapun, beda dari gen_random_uuid()
--    yang butuh PG13+ core atau extension eksplisit yang belum tentu ke-
--    enable). unit_code dinomori PER PRODUK (ROW_NUMBER partition by ref_id,
--    urut created_at batch lalu urutan generate_series) biar konsisten sama
--    skema `${sku}-U0001` yang dipakai StockService.generateStockUnits nanti.
WITH numbered AS (
  SELECT
    ic.id AS item_cost_id,
    ic.ref_id,
    p.sku,
    gs.seq AS seq_in_batch,
    ROW_NUMBER() OVER (PARTITION BY ic.ref_id ORDER BY ic.created_at, ic.id, gs.seq) AS seq_in_product
  FROM item_costs ic
  JOIN products p ON p.id = ic.ref_id
  CROSS JOIN LATERAL generate_series(1, ic.stock::int) AS gs(seq)
  WHERE ic.kind = 'product' AND ic.stock > 0
),
hashed AS (
  SELECT
    n.*,
    md5(random()::text || clock_timestamp()::text || n.item_cost_id || n.seq_in_batch::text || 'id') AS h_id,
    md5(random()::text || clock_timestamp()::text || n.item_cost_id || n.seq_in_batch::text || 'qr') AS h_qr
  FROM numbered n
)
INSERT INTO stock_units (id, item_cost_id, ref_id, unit_code, qr_token, status, created_at)
SELECT
  substr(h_id,1,8)||'-'||substr(h_id,9,4)||'-'||substr(h_id,13,4)||'-'||substr(h_id,17,4)||'-'||substr(h_id,21,12),
  item_cost_id,
  ref_id,
  COALESCE(sku, ref_id) || '-U' || lpad(seq_in_product::text, 4, '0'),
  substr(h_qr,1,8)||'-'||substr(h_qr,9,4)||'-'||substr(h_qr,13,4)||'-'||substr(h_qr,17,4)||'-'||substr(h_qr,21,12),
  'di_gudang',
  CURRENT_TIMESTAMP
FROM hashed;

-- 3) Seed counters.seq per produk biar CountersService.nextSeq('stock_unit_'
--    || refId) yang bakal dipanggil StockService.generateStockUnits buat
--    unit BARU nanti lanjut dari nomor terakhir hasil backfill ini, gak
--    mulai dari 1 lagi (nabrak unit_code yang baru aja dibackfill).
INSERT INTO counters (key, seq)
SELECT 'stock_unit_' || ref_id, COUNT(*)
FROM stock_units
GROUP BY ref_id
ON CONFLICT (key) DO UPDATE SET seq = GREATEST(counters.seq, EXCLUDED.seq);
