-- Harga jasa servis ditetapkan kasir/admin setelah temuan teknisi. Aditif, aman untuk data lama.
ALTER TABLE "technician_jobs" ADD COLUMN "findings_sent_at" TIMESTAMP(3);
ALTER TABLE "invoice_items" ADD COLUMN "job_id" TEXT;
CREATE INDEX "invoice_items_job_id_idx" ON "invoice_items"("job_id");
