-- Cek angka yang mungkin kehilangan koma (diketik "1,5" tersimpan 15) lewat aplikasi HP.
-- HANYA MEMBACA: seluruhnya dijalankan dalam transaksi read only.
-- Hasilnya daftar untuk DIPERIKSA manusia, belum tentu salah.
-- Catatan: "0,5" yang kehilangan koma menjadi 5, tidak bisa dibedakan dari 5 PK asli.
\pset footer on
BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '== 1. Produk AC dengan PK tidak lazim (lazim: 0.5 sampai 8) =='
SELECT sku, name AS produk, pk, created_at::date AS dibuat
FROM products
WHERE pk IS NOT NULL AND pk <> 0
  AND pk NOT IN (0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8)
ORDER BY pk DESC, name;

\echo ''
\echo '== 2. AC milik pelanggan dengan PK tidak lazim =='
SELECT u.barcode_value AS barcode, m.name AS pelanggan, u.brand AS merek, u.pk, u.created_at::date AS dibuat
FROM member_ac_units u
LEFT JOIN members m ON m.id = u.member_id
WHERE u.pk IS NOT NULL AND u.pk <> 0
  AND u.pk NOT IN (0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8)
ORDER BY u.pk DESC;

\echo ''
\echo '== 3. Sparepart aktif: bandingkan dengan fisik di gudang =='
-- Kesalahan koma pada stok TIDAK bisa dikenali dari angkanya (25 bisa wajar),
-- jadi semuanya ditampilkan. Satuan pecahan (meter, kg, liter) diurutkan dulu.
SELECT name AS sparepart, unit AS satuan, stock AS stok, min_stock AS stok_minimum
FROM spareparts
WHERE active
ORDER BY (lower(unit) IN ('m', 'meter', 'kg', 'liter', 'l')) DESC, name;

\echo ''
\echo '== 4. Isi paket instalasi (qty "2,5 meter" bisa tersimpan 25) =='
SELECT CASE WHEN i.qty >= 15 THEN 'cek' ELSE '' END AS tanda,
       p.name AS paket, i.name AS barang, i.qty, i.unit AS satuan
FROM installation_package_items i
JOIN installation_packages p ON p.id = i.package_id
ORDER BY 1 DESC, p.name, i.name;

\echo ''
\echo '== 5. Invoice dengan persen pajak tidak lazim (lazim: 0, 10, 11, 12) =='
SELECT number AS invoice, tax_percent AS pajak_persen, tax_amount AS nilai_pajak,
       grand_total AS total, status, created_at::date AS tanggal
FROM invoices
WHERE tax_percent NOT IN (0, 10, 11, 12)
ORDER BY created_at DESC
LIMIT 100;

ROLLBACK;
