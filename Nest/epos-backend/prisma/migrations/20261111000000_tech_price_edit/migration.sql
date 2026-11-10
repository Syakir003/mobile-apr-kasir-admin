-- Penyesuaian jasa oleh teknisi (spesifikasi pembayaran lapangan). Baris lama = ditetapkan admin.
ALTER TABLE "job_service_lines" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE "job_service_lines" ADD COLUMN "is_custom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "job_service_lines" ADD COLUMN "change_reason" TEXT;

ALTER TABLE "technician_jobs" ADD COLUMN "tech_price_edited_at" TIMESTAMP(3);
ALTER TABLE "technician_jobs" ADD COLUMN "tech_price_edit_reason" TEXT;
ALTER TABLE "technician_jobs" ADD COLUMN "price_before_tech_edit" DECIMAL(14,2);
