-- ============================================================================
-- Fitur WhatsApp (Fonnte): kirim invoice manual + pengingat servis otomatis.
--
-- 1) whatsapp_logs direwrite: lepas FK unit_id tunggal (ganti unit_ids[]),
--    tambah kind/invoice_id/due_date/dedupe_key/error/sent_by.
-- 2) members.wa_opt_out + member_ac_units.service_interval_days — port dari
--    migrasi Supabase 20260815000023_service_reminders.sql.
-- 3) reminder_settings + wa_reminder_templates — port dari migrasi Supabase
--    0023 & 0032 (tabel pengaturan siklus + redaksi pesan, admin-editable).
-- ============================================================================

-- --------------------------------------------------------------- members ---
ALTER TABLE "members" ADD COLUMN "wa_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------ member_ac_units
ALTER TABLE "member_ac_units" ADD COLUMN "service_interval_days" INTEGER;

-- --------------------------------------------------------------- whatsapp_logs
-- DropForeignKey — relasi unit_id tunggal digantikan unit_ids[] (array polos,
-- Postgres gak bisa FK ke array).
ALTER TABLE "whatsapp_logs" DROP CONSTRAINT "whatsapp_logs_unit_id_fkey";
ALTER TABLE "whatsapp_logs" DROP COLUMN "unit_id";

-- CreateEnum
CREATE TYPE "WhatsappMessageKind" AS ENUM ('invoice', 'selesai_servis', 'reminder_h3', 'reminder_h7');

-- AlterEnum — tambah 'dibatalkan' (dipakai saat member opt-out membatalkan
-- pesan reminder yang masih 'pending').
ALTER TYPE "WhatsappLogStatus" ADD VALUE 'dibatalkan';

-- AlterTable
ALTER TABLE "whatsapp_logs"
  ADD COLUMN "kind" "WhatsappMessageKind" NOT NULL DEFAULT 'invoice',
  ADD COLUMN "unit_ids" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "invoice_id" TEXT,
  ADD COLUMN "due_date" DATE,
  ADD COLUMN "dedupe_key" TEXT,
  ADD COLUMN "error" TEXT,
  ADD COLUMN "sent_by" TEXT;

-- Default sementara di atas cuma buat ngisi baris lama (kalau ada) tanpa
-- error NOT NULL — kolom `kind` ke depannya SELALU diisi eksplisit oleh
-- WhatsappService/RemindersService, jadi default-nya dicabut lagi di sini.
ALTER TABLE "whatsapp_logs" ALTER COLUMN "kind" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_logs_dedupe_key_key" ON "whatsapp_logs"("dedupe_key");
CREATE INDEX "whatsapp_logs_status_created_at_idx" ON "whatsapp_logs"("status", "created_at");
CREATE INDEX "whatsapp_logs_member_id_idx" ON "whatsapp_logs"("member_id");

-- AddForeignKey
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --------------------------------------------------------- reminder_settings
CREATE TABLE "reminder_settings" (
    "job_type" TEXT NOT NULL,
    "interval_days" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "reminder_settings_pkey" PRIMARY KEY ("job_type")
);

ALTER TABLE "reminder_settings" ADD CONSTRAINT "reminder_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default sama persis kayak reminder_settings Supabase (migrasi 0023):
-- cuci 60 hari (2 bulan), maintenance 180 hari (6 bulan).
INSERT INTO "reminder_settings" ("job_type", "interval_days", "active") VALUES
  ('cuci', 60, true),
  ('maintenance', 180, true);

-- ---------------------------------------------------------- wa_reminder_templates
CREATE TABLE "wa_reminder_templates" (
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "wa_reminder_templates_pkey" PRIMARY KEY ("kind")
);

ALTER TABLE "wa_reminder_templates" ADD CONSTRAINT "wa_reminder_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Belum di-seed di sini sengaja — RemindersService.buildBody() fallback ke
-- DEFAULT_TEMPLATES bawaan kode kalau baris belum ada (3-layer fallback,
-- port dari build_wa_body() SQL), jadi tabel boleh kosong sampai admin
-- pertama kali nyimpen lewat halaman Template Pesan WA.
