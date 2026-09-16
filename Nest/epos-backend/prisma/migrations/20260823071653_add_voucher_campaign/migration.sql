-- DropForeignKey
ALTER TABLE "technician_jobs" DROP CONSTRAINT "technician_jobs_technician_id_fkey";

-- AddForeignKey
ALTER TABLE "technician_jobs" ADD CONSTRAINT "technician_jobs_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
