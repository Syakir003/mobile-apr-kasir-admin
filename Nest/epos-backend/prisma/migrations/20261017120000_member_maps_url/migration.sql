-- Link lokasi Google Maps pelanggan, terpisah dari alamat teks (2026-10-17). Aditif, aman.
ALTER TABLE "members" ADD COLUMN "maps_url" TEXT;
