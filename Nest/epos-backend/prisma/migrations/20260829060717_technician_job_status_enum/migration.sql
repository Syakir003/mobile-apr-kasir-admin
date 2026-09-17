-- CreateEnum
CREATE TYPE "TechnicianJobStatus" AS ENUM ('menunggu_penugasan', 'assigned', 'sedang_dikerjakan', 'menunggu_review', 'selesai', 'dibatalkan');

-- AlterTable (cast aman — data status yang udah ada TETEP KEPAKE, bukan direset)
ALTER TABLE "technician_jobs" ALTER COLUMN "status" TYPE "TechnicianJobStatus" USING ("status"::text::"TechnicianJobStatus");
ALTER TABLE "technician_jobs" ALTER COLUMN "status" SET DEFAULT 'menunggu_penugasan';