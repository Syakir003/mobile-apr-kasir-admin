-- Cek isian yang mungkin terbawa ke data lain di aplikasi HP (layar lama dipakai ulang).
-- HANYA MEMBACA: seluruhnya dijalankan dalam transaksi read only.
-- Hasilnya daftar untuk DIPERIKSA manusia, belum tentu salah: dua pekerjaan memang bisa
-- berisi tulisan yang sama. Yang patut dicurigai: tulisannya panjang/spesifik, pelanggannya
-- berbeda, teknisinya sama, dan waktunya berdekatan.
\pset footer on
BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '== 1. Diagnosa sama persis di order yang berbeda (terpanjang dulu) =='
WITH d AS (
  SELECT j.*, lower(regexp_replace(trim(j.notes), '\s+', ' ', 'g')) AS kunci
  FROM technician_jobs j
  WHERE trim(coalesce(j.notes, '')) <> ''
), kembar AS (
  SELECT kunci, count(DISTINCT member_id) AS pelanggan_berbeda
  FROM d GROUP BY kunci HAVING count(DISTINCT order_id) > 1
)
SELECT dense_rank() OVER (ORDER BY length(d.kunci) DESC, d.kunci) AS kelompok,
       k.pelanggan_berbeda,
       m.name AS pelanggan,
       u."display_name" AS teknisi,
       d.status,
       to_char(d.updated_at + interval '7 hour', 'DD-MM-YYYY HH24:MI') AS terakhir_diubah_wib,
       left(d.notes, 120) AS diagnosa
FROM d
JOIN kembar k USING (kunci)
LEFT JOIN members m ON m.id = d.member_id
LEFT JOIN users u ON u.id = d.technician_id
ORDER BY kelompok, d.updated_at;

\echo ''
\echo '== 2. Keterangan teknisi sama persis di order yang berbeda =='
WITH o AS (
  SELECT s.*, lower(regexp_replace(trim(s.technician_note), '\s+', ' ', 'g')) AS kunci
  FROM service_orders s
  WHERE trim(coalesce(s.technician_note, '')) <> ''
), kembar AS (
  SELECT kunci, count(DISTINCT member_id) AS pelanggan_berbeda
  FROM o GROUP BY kunci HAVING count(*) > 1
)
SELECT dense_rank() OVER (ORDER BY length(o.kunci) DESC, o.kunci) AS kelompok,
       k.pelanggan_berbeda,
       m.name AS pelanggan,
       to_char(o.created_at + interval '7 hour', 'DD-MM-YYYY') AS tanggal_order,
       left(o.technician_note, 120) AS keterangan
FROM o
JOIN kembar k USING (kunci)
LEFT JOIN members m ON m.id = o.member_id
ORDER BY kelompok, o.created_at;

\echo ''
\echo '== 3. Nama kembar di data master (form edit bisa menimpa data lain) =='
SELECT jenis, nama, jumlah FROM (
  SELECT 'produk' AS jenis, min(name) AS nama, count(*) AS jumlah
  -- Nama sama tapi beda merek/PK/indoor-outdoor itu wajar, jadi tidak ditampilkan.
  FROM products WHERE active GROUP BY lower(trim(name)), brand, pk, ac_role HAVING count(*) > 1
  UNION ALL
  SELECT 'sparepart', min(name), count(*)
  FROM spareparts WHERE active GROUP BY lower(trim(name)) HAVING count(*) > 1
  UNION ALL
  SELECT 'member (nama & HP sama)', min(name), count(*)
  FROM members WHERE active GROUP BY lower(trim(name)), coalesce(phone, '') HAVING count(*) > 1
) x
ORDER BY jenis, nama;

ROLLBACK;
