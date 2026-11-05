-- Job komplain: pengerjaan ulang atas keluhan pelanggan setelah job selesai. Menunjuk job selesai yang dikomplain (NULL = job biasa).
ALTER TABLE "technician_jobs" ADD COLUMN "complaint_of_job_id" TEXT;

CREATE INDEX "technician_jobs_complaint_of_job_id_idx" ON "technician_jobs"("complaint_of_job_id");

ALTER TABLE "technician_jobs" ADD CONSTRAINT "technician_jobs_complaint_of_job_id_fkey" FOREIGN KEY ("complaint_of_job_id") REFERENCES "technician_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
