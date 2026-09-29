-- AlterEnum
ALTER TYPE "WhatsappMessageKind" ADD VALUE 'menang_undian';

-- AlterTable
ALTER TABLE "vouchers" ADD COLUMN     "undian_id" TEXT;

-- CreateTable
CREATE TABLE "undian" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "winner_count" INTEGER NOT NULL,
    "discount_type" "VoucherDiscountType" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "max_discount_cap" INTEGER,
    "min_purchase" INTEGER,
    "voucher_valid_days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'berjalan',
    "drawn_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "undian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "undian_participants" (
    "id" TEXT NOT NULL,
    "undian_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "undian_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "undian_participants_undian_id_idx" ON "undian_participants"("undian_id");

-- CreateIndex
CREATE UNIQUE INDEX "undian_participants_undian_id_member_id_key" ON "undian_participants"("undian_id", "member_id");

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_undian_id_fkey" FOREIGN KEY ("undian_id") REFERENCES "undian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "undian" ADD CONSTRAINT "undian_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "undian_participants" ADD CONSTRAINT "undian_participants_undian_id_fkey" FOREIGN KEY ("undian_id") REFERENCES "undian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "undian_participants" ADD CONSTRAINT "undian_participants_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pengaman level DB — sama dengan CHECK di migrasi Supabase 0027 (Prisma
-- schema gak bisa nyatakan CHECK, jadi ditulis manual di sini).
ALTER TABLE "undian"
  ADD CONSTRAINT "undian_winner_count_check" CHECK ("winner_count" > 0),
  ADD CONSTRAINT "undian_discount_value_check" CHECK ("discount_value" > 0),
  ADD CONSTRAINT "undian_persen_max_check" CHECK ("discount_type" <> 'persen' OR "discount_value" <= 100),
  ADD CONSTRAINT "undian_max_discount_cap_check" CHECK ("max_discount_cap" IS NULL OR "max_discount_cap" > 0),
  ADD CONSTRAINT "undian_min_purchase_check" CHECK ("min_purchase" IS NULL OR "min_purchase" >= 0),
  ADD CONSTRAINT "undian_voucher_valid_days_check" CHECK ("voucher_valid_days" > 0),
  ADD CONSTRAINT "undian_status_check" CHECK ("status" IN ('berjalan', 'selesai', 'dibatalkan'));

ALTER TABLE "undian_participants"
  ADD CONSTRAINT "undian_participants_source_check" CHECK ("source" IN ('otomatis', 'manual'));
