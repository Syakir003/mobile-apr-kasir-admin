-- Tipe pembeli (retail/installer/reseller) + harga per tipe (2026-10-13).
-- Hanya menambah: member & invoice lama otomatis 'retail'.
-- CreateEnum
CREATE TYPE "PriceTier" AS ENUM ('retail', 'installer', 'reseller');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "price_tier" "PriceTier" NOT NULL DEFAULT 'retail';

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "price_tier" "PriceTier" NOT NULL DEFAULT 'retail';

-- CreateTable
CREATE TABLE "tier_prices" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "tier" "PriceTier" NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "price_pack" DECIMAL(14,2),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tier_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tier_prices_kind_ref_id_tier_key" ON "tier_prices"("kind", "ref_id", "tier");

