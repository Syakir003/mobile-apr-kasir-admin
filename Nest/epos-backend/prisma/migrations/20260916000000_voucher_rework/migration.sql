-- ============================================================================
-- Rework total sistem voucher: dari VoucherCampaign+VoucherClaim (broadcast
-- ke banyak member lalu diklaim satu-satu) menjadi satu tabel `vouchers`
-- (port 1:1 dari konsep app mobile — satu voucher = satu kode, terikat ke
-- satu member sejak dibuat, dipakai dengan ketik kode saat checkout, tanpa
-- langkah "klaim" terpisah).
-- ============================================================================

-- DropForeignKey
ALTER TABLE "voucher_claims" DROP CONSTRAINT "voucher_claims_campaign_id_fkey";
ALTER TABLE "voucher_claims" DROP CONSTRAINT "voucher_claims_member_id_fkey";
ALTER TABLE "voucher_claims" DROP CONSTRAINT "voucher_claims_invoice_id_fkey";

-- DropTable
DROP TABLE "voucher_claims";
DROP TABLE "voucher_campaigns";

-- DropEnum
DROP TYPE "VoucherClaimStatus";
DROP TYPE "VoucherDiscountType";

-- CreateEnum
CREATE TYPE "VoucherDiscountType" AS ENUM ('persen', 'nominal');
CREATE TYPE "VoucherStatus" AS ENUM ('aktif', 'terpakai', 'kadaluarsa', 'dibatalkan');
CREATE TYPE "VoucherSource" AS ENUM ('undian', 'manual');

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "discount_type" "VoucherDiscountType" NOT NULL,
    "discount_value" DECIMAL(14,2) NOT NULL,
    "max_discount_cap" DECIMAL(14,2),
    "min_purchase" DECIMAL(14,2),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'aktif',
    "source" "VoucherSource" NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "used_at" TIMESTAMP(3),
    "used_in_invoice_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");
CREATE INDEX "vouchers_member_id_idx" ON "vouchers"("member_id");
CREATE INDEX "vouchers_status_idx" ON "vouchers"("status");

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_used_in_invoice_id_fkey" FOREIGN KEY ("used_in_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
