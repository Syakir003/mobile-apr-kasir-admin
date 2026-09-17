-- Job pemasangan bisa dibuat dulu tanpa teknisi (status 'menunggu_penugasan'),
-- baru di-assign belakangan. Kolom technician_id jadi nullable.
ALTER TABLE "technician_jobs" ALTER COLUMN "technician_id" DROP NOT NULL;
