-- Transport servis (opsional) + tagihan servis dihitung ulang dari sumbernya (baris jasa per job). Aditif, aman untuk data lama.
ALTER TABLE "technician_jobs" ADD COLUMN "transport_level" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "technician_jobs" ADD COLUMN "transport_mode" TEXT NOT NULL DEFAULT 'individu';
ALTER TABLE "technician_jobs" ADD COLUMN "billing_derived" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "job_service_lines" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "service_id" TEXT,
    "name" TEXT NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_service_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_service_lines_job_id_idx" ON "job_service_lines"("job_id");

ALTER TABLE "job_service_lines" ADD CONSTRAINT "job_service_lines_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "technician_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
