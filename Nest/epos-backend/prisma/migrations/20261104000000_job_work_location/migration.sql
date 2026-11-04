-- Titik lokasi kerja per unit/job: alamat + link Google Maps bila berbeda dari alamat pelanggan (NULL = ikut alamat member).
ALTER TABLE "technician_jobs" ADD COLUMN "work_address" TEXT, ADD COLUMN "work_maps_url" TEXT;
