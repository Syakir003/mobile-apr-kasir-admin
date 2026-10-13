-- Laporan pemakaian sparepart oleh teknisi (jumlah terpakai per item + catatan). Aditif, aman.
ALTER TABLE "material_request_items" ADD COLUMN "qty_used" DECIMAL(10,2);
ALTER TABLE "material_requests" ADD COLUMN "used_note" TEXT;
