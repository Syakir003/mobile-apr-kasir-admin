-- Modal 1 paket utuh saat unit satuan dijual (cuma buat batas bawah laba di
-- laporan laba-rugi; HPP resmi baris tetap 0). Lihat spec paket-ac-split.
ALTER TABLE "invoice_items" ADD COLUMN "package_cost_ref" DECIMAL(14,2);
