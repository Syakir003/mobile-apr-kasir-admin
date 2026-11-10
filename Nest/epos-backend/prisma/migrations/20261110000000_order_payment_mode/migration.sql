-- Cara tagih order servis (spesifikasi pembayaran lapangan). Order yang sudah ada tetap 'ditagih_admin'.
ALTER TABLE "service_orders" ADD COLUMN "payment_mode" TEXT NOT NULL DEFAULT 'ditagih_admin';
