-- Sparepart utuh/eceran (2026-09-30)
ALTER TABLE "spareparts"
  ADD COLUMN "tracking_mode" TEXT NOT NULL DEFAULT 'biasa',
  ADD COLUMN "pack_unit" TEXT,
  ADD COLUMN "pack_size" DECIMAL(10,2),
  ADD COLUMN "sell_price_pack" DECIMAL(14,2);

-- Backfill dari batchTracked: sparepart per-gulungan lama => 'gulungan'.
UPDATE "spareparts" SET "tracking_mode" = 'gulungan' WHERE "batch_tracked" = true;

ALTER TABLE "invoice_items" ADD COLUMN "sale_kind" TEXT;
ALTER TABLE "transaction_items" ADD COLUMN "sale_kind" TEXT;
