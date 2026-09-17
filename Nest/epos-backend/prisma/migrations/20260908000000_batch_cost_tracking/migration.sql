-- Siklus batch-cost (2026-09): item_costs jadi tabel batch (banyak baris
-- per produk), sellPrice/stock pindah dari products ke situ.

-- 1) Tambah kolom baru di item_costs (nullable dulu, diisi di step
--    berikutnya, baru dikunci NOT NULL di step 7-8).
ALTER TABLE "item_costs" ADD COLUMN "id" TEXT;
ALTER TABLE "item_costs" ADD COLUMN "sell_price" DECIMAL(14,2);
ALTER TABLE "item_costs" ADD COLUMN "stock" INTEGER;
ALTER TABLE "item_costs" ADD COLUMN "supplier_name" TEXT;
ALTER TABLE "item_costs" ADD COLUMN "created_at" TIMESTAMP(3);

-- 2) Backfill id unik buat semua baris lama. Sengaja PAKAI md5(random())
--    bukan gen_random_uuid()/uuid_generate_v4() — extension itu belum
--    tentu aktif di semua environment Postgres (sama pertimbangan kayak
--    migrasi 20260822030000_job_findings_checklist). Kolom "id" bertipe
--    TEXT biasa (bukan native uuid), jadi string hex 32-karakter ini valid.
UPDATE "item_costs"
SET "id" = md5(random()::text || clock_timestamp()::text || "kind" || "ref_id")
WHERE "id" IS NULL;

-- 3) Backfill sell_price/stock buat baris kind='product' DARI products
--    (sebelum kolomnya dihapus di step 9), created_at dari updated_at lama
--    (perkiraan — data asli kapan batch itu masuk gak pernah dicatat).
UPDATE "item_costs" ic
SET "sell_price" = p."sell_price",
    "stock" = p."stock",
    "created_at" = COALESCE(ic."updated_at", CURRENT_TIMESTAMP)
FROM "products" p
WHERE ic."kind" = 'product' AND ic."ref_id" = p."id";

-- 4) Backfill created_at buat baris kind='sparepart' (sell_price/stock
--    baris ini SENGAJA dibiarkan NULL dulu, diisi 0 di step 6 — gak
--    dipakai sama sekali buat sparepart, cuma buat penuhin NOT NULL).
UPDATE "item_costs" SET "created_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
WHERE "kind" = 'sparepart';

-- 5) Produk yang PUNYA sell_price/stock tapi BELUM PERNAH ada baris
--    item_costs (belum pernah di-stock-in lewat Siklus 3) — bikin 1 baris
--    "batch awal" biar stok/harga yang lagi berjalan gak hilang. buy_price
--    diisi 0 + supplier_name ditandai jelas (bukan silently 0 tanpa keterangan).
INSERT INTO "item_costs" ("id", "kind", "ref_id", "buy_price", "sell_price", "stock", "supplier_name", "created_at", "updated_at")
SELECT
  md5(random()::text || clock_timestamp()::text || p."id"),
  'product', p."id", 0, p."sell_price", p."stock",
  '(migrasi 2026-09-08 — harga beli belum tercatat)',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "products" p
WHERE NOT EXISTS (
  SELECT 1 FROM "item_costs" ic WHERE ic."kind" = 'product' AND ic."ref_id" = p."id"
);

-- 6) Baris sparepart: sell_price/stock diisi 0 (placeholder, gak kepake).
UPDATE "item_costs" SET "sell_price" = 0, "stock" = 0 WHERE "kind" = 'sparepart';

-- 7) Kunci NOT NULL + default buat kolom baru.
ALTER TABLE "item_costs" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "item_costs" ALTER COLUMN "sell_price" SET NOT NULL;
ALTER TABLE "item_costs" ALTER COLUMN "stock" SET NOT NULL;
ALTER TABLE "item_costs" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "item_costs" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- 8) Ganti PK dari (kind, ref_id) jadi id.
ALTER TABLE "item_costs" DROP CONSTRAINT "item_costs_pkey";
ALTER TABLE "item_costs" ADD CONSTRAINT "item_costs_pkey" PRIMARY KEY ("id");
CREATE INDEX "item_costs_kind_ref_id_idx" ON "item_costs"("kind", "ref_id");

-- 9) Data udah pindah semua ke item_costs — sekarang aman hapus dari products.
ALTER TABLE "products" DROP COLUMN "sell_price";
ALTER TABLE "products" DROP COLUMN "stock";

-- 10) Diskon per-baris.
ALTER TABLE "transaction_items" ADD COLUMN "discount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoice_items" ADD COLUMN "discount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- 11) Jejak batch di histori stok (nullable, baris lama tetap null).
ALTER TABLE "stock_movements" ADD COLUMN "item_cost_id" TEXT;
