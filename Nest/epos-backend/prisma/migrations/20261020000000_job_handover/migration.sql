-- Riwayat alih tugas job servis: job dialihkan ke teknisi lain (berhalangan / dilanjut hari lain).
CREATE TABLE "job_handovers" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "from_technician_id" TEXT NOT NULL,
  "to_technician_id" TEXT NOT NULL,
  "handed_by_id" TEXT NOT NULL,
  "status_at_handover" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_handovers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_handovers_job_id_created_at_idx" ON "job_handovers"("job_id", "created_at");

ALTER TABLE "job_handovers"
  ADD CONSTRAINT "job_handovers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "technician_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_handovers_from_technician_id_fkey" FOREIGN KEY ("from_technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_handovers_to_technician_id_fkey" FOREIGN KEY ("to_technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_handovers_handed_by_id_fkey" FOREIGN KEY ("handed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
