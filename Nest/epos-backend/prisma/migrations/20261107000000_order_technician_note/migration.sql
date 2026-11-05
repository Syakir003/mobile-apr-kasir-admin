-- Keterangan teknisi: catatan satu order untuk admin (beda dari technician_jobs.notes = Diagnosa/Catatan Pengerjaan per unit).
ALTER TABLE "service_orders" ADD COLUMN "technician_note" TEXT;
