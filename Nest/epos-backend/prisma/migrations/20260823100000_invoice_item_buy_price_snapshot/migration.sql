-- Rekam harga beli (item_costs.buy_price) di invoice_items SAAT checkout,
-- bukan dibaca ulang dari item_costs waktu laporan laba-rugi dibuka. Biar
-- laporan transaksi lama TETAP akurat walau harga beli barang berubah
-- belakangan. Nullable: baris lama (sebelum kolom ini ada) & baris kind
-- 'service' (gak ada HPP) tetap NULL — ReportsService.profitLoss() fallback
-- ke item_costs TERKINI cuma buat baris yang null.
ALTER TABLE "invoice_items" ADD COLUMN "buy_price_snapshot" DECIMAL(14,2);
