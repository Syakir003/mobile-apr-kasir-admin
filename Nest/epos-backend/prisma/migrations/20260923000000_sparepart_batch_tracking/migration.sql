-- Sparepart.batchTracked — default false, sparepart existing gak berubah perilaku.
ALTER TABLE "spareparts" ADD COLUMN "batch_tracked" BOOLEAN NOT NULL DEFAULT false;

-- ItemCost.stock Int -> Decimal(10,2). USING cast eksplisit biar Postgres
-- gak nolak (integer -> numeric aman, gak ada data loss, tapi Postgres tetap
-- minta USING kalau ALTER COLUMN TYPE lintas tipe non-trivial di beberapa versi).
ALTER TABLE "item_costs" ALTER COLUMN "stock" TYPE DECIMAL(10,2) USING "stock"::DECIMAL(10,2);
