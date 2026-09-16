-- Siklus 9 — dedup log buat POST /technician-jobs/sync-batch (mode offline
-- teknisi). Tabel BARU, belum pernah ada di database manapun sebelumnya —
-- beda dari kasus voucher_campaigns/voucher_claims kemarin yang udah fisik
-- ada duluan. Aman langsung di-apply pakai `prisma migrate dev` biasa.
CREATE TABLE "sync_action_log" (
    "id" TEXT NOT NULL,
    "client_action_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "sync_action_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sync_action_log_client_action_id_key" ON "sync_action_log"("client_action_id");

CREATE INDEX "sync_action_log_job_id_idx" ON "sync_action_log"("job_id");
