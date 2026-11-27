-- Multi lokasi member (2026-11-24): satu member dengan AC di beberapa tempat (mis. kantor lama & kantor baru), satu nomor HP.
-- Lokasi 1 = alamat utama member (tanpa baris di member_locations); unit/order dengan location_id NULL berada di Lokasi 1.
-- Migrasi ini hanya MENAMBAH kolom/tabel (aman untuk data lama, tidak ada backfill).

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "main_location_name" TEXT,
ADD COLUMN     "multi_location" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "member_ac_units" ADD COLUMN     "location_id" TEXT;

-- AlterTable
ALTER TABLE "service_orders" ADD COLUMN     "location_id" TEXT;

-- CreateTable
CREATE TABLE "member_locations" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "maps_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_locations_member_id_idx" ON "member_locations"("member_id");

-- CreateIndex
CREATE INDEX "member_ac_units_location_id_idx" ON "member_ac_units"("location_id");

-- CreateIndex
CREATE INDEX "service_orders_location_id_idx" ON "service_orders"("location_id");

-- AddForeignKey
ALTER TABLE "member_ac_units" ADD CONSTRAINT "member_ac_units_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "member_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_locations" ADD CONSTRAINT "member_locations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "member_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
