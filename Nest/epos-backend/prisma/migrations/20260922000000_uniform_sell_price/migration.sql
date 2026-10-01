-- Siklus harga-seragam (2026-09-22): Product.sellPrice balik jadi kolom
-- langsung (satu harga jual per produk, bukan per-batch lagi).

-- 1) Tambah kolom baru (nullable dulu, diisi step 2, dikunci NOT NULL step 3).
ALTER TABLE "products" ADD COLUMN "sell_price" DECIMAL(14,2);

-- 2) Backfill dari batch TERBARU (created_at paling akhir) tiap produk yang
--    udah pernah di-stock-in. Produk yang BELUM PERNAH ada batch item_costs
--    (belum pernah di-stock-in sama sekali) dapet 0 — gak ada histori harga
--    buat dijadiin acuan, admin wajib isi manual lewat Master Data sebelum
--    produk itu kelihatan "lengkap".
UPDATE "products" p
SET "sell_price" = COALESCE((
  SELECT ic."sell_price" FROM "item_costs" ic
  WHERE ic."kind" = 'product' AND ic."ref_id" = p."id"
  ORDER BY ic."created_at" DESC
  LIMIT 1
), 0);

-- 3) Kunci NOT NULL.
ALTER TABLE "products" ALTER COLUMN "sell_price" SET NOT NULL;
