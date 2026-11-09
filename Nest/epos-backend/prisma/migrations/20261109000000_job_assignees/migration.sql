-- Penugasan beberapa teknisi per job (semua setara). technician_jobs.technician_id tetap ada = teknisi pertama.
CREATE TABLE "technician_job_assignees" (
    "job_id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technician_job_assignees_pkey" PRIMARY KEY ("job_id","technician_id")
);

CREATE INDEX "technician_job_assignees_technician_id_idx" ON "technician_job_assignees"("technician_id");

ALTER TABLE "technician_job_assignees" ADD CONSTRAINT "technician_job_assignees_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "technician_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technician_job_assignees" ADD CONSTRAINT "technician_job_assignees_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: setiap job yang sudah punya teknisi jadi satu baris assignee.
INSERT INTO "technician_job_assignees" ("job_id", "technician_id")
SELECT "id", "technician_id" FROM "technician_jobs" WHERE "technician_id" IS NOT NULL;
