-- Paket AC Split (2026-09-30) — 1 Produk AC = paket Indoor + Outdoor.
-- Lihat spec specs/2026-09-30-paket-ac-split-design.md.

-- 1) Peran unit AC per produk ('indoor' | 'outdoor' | NULL).
ALTER TABLE "products" ADD COLUMN "ac_role" TEXT;

-- Backfill dari pairing yang udah ada: sisi yang punya paired_product_id
-- = Indoor, target-nya = Outdoor. Produk lama yang gak berpasangan
-- dibiarin NULL (admin bisa set lewat Edit produk).
UPDATE "products" SET "ac_role" = 'indoor' WHERE "paired_product_id" IS NOT NULL;
UPDATE "products" p SET "ac_role" = 'outdoor'
WHERE EXISTS (SELECT 1 FROM "products" i WHERE i."paired_product_id" = p."id");

-- 2) Penanda kelompok batch paket (Indoor + Outdoor dari 1 barang masuk).
ALTER TABLE "item_costs" ADD COLUMN "pair_group_id" TEXT;
CREATE INDEX "item_costs_pair_group_id_idx" ON "item_costs"("pair_group_id");

-- Backfill dari stock_movements barang masuk mode "Unit Lengkap" yang udah
-- nyatet pair_group_id sejak Point 2 (2026-09-23).
UPDATE "item_costs" ic SET "pair_group_id" = sm."pair_group_id"
FROM "stock_movements" sm
WHERE sm."item_cost_id" = ic."id"
  AND sm."reason" = 'barang_masuk'
  AND sm."pair_group_id" IS NOT NULL
  AND ic."kind" = 'product';

-- 3) Penanda baris invoice unit satuan dari paket (modal tidak dialokasikan).
ALTER TABLE "invoice_items" ADD COLUMN "cost_unallocated" BOOLEAN NOT NULL DEFAULT false;
