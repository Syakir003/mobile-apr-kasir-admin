-- Point 2 (2026-09-23) — AC Indoor/Outdoor Berpasangan. Tambah 4 kolom FK
-- nullable (products.paired_product_id, member_ac_units.indoor_product_id,
-- member_ac_units.outdoor_product_id, stock_movements.pair_group_id sebagai
-- string biasa bukan FK) buat nyambungin Product Indoor ke Product Outdoor
-- pasangannya, dan nyimpen referensi Product asal tiap sisi unit AC member.

-- Product.pairedProductId — self-relation one-directional, diisi HANYA di
-- sisi Indoor, nunjuk ke Product Outdoor pasangannya. Nullable (mayoritas
-- produk gak dipasangkan). ON DELETE SET NULL: kalau Product Outdoor yang
-- jadi pasangan dihapus, referensi di Product Indoor-nya cuma di-null-in,
-- bukan ngeblok delete / ikut kehapus.
ALTER TABLE "products" ADD COLUMN "paired_product_id" TEXT;
ALTER TABLE "products" ADD CONSTRAINT "products_paired_product_id_fkey"
  FOREIGN KEY ("paired_product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- MemberAcUnit.indoorProductId / outdoorProductId — referensi Product asal
-- Indoor & Outdoor unit AC ini (independen, nullable dua-duanya). ON DELETE
-- SET NULL: Product yang jadi asal boleh dihapus tanpa ngeblok/ngehapus
-- unit AC member yang udah kadung nunjuk ke situ.
ALTER TABLE "member_ac_units" ADD COLUMN "indoor_product_id" TEXT;
ALTER TABLE "member_ac_units" ADD CONSTRAINT "member_ac_units_indoor_product_id_fkey"
  FOREIGN KEY ("indoor_product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "member_ac_units" ADD COLUMN "outdoor_product_id" TEXT;
ALTER TABLE "member_ac_units" ADD CONSTRAINT "member_ac_units_outdoor_product_id_fkey"
  FOREIGN KEY ("outdoor_product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- StockMovement.pairGroupId — BUKAN foreign key (sama pola kayak
-- item_cost_id/ref_id di tabel ini), cuma string biasa yang disamain
-- nilainya di 2 baris StockMovement (Indoor & Outdoor) yang lahir dari SATU
-- aksi "Unit Lengkap". Dipakai Point 4 (laporan stok) buat gabungin 2 baris
-- itu jadi 1 baris tampilan.
ALTER TABLE "stock_movements" ADD COLUMN "pair_group_id" TEXT;
