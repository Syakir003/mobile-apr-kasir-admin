# Desain: Gudang Terima Barang tanpa Harga

Tanggal: 27 November 2026
Status: menunggu persetujuan

## Latar dan tujuan

Nota pembelian dipegang admin. Orang gudang hanya menempel label dan scan keluar.
Sekarang `POST /stock/in` mewajibkan harga modal, sehingga gudang tidak bisa
mencatat barang datang tanpa mengarang angka.

Tujuan:
1. Gudang mencatat barang datang tanpa harga, lewat HP, lalu mencetak label.
2. Barang itu langsung boleh dijual.
3. Admin melengkapi harga modal belakangan, dan catatan modal pada invoice yang
   sudah telanjur terjual ikut diperbarui.
4. Admin bisa mengoreksi harga modal yang salah ketik, kapan saja.

Bukan bagian pekerjaan ini:
- Persetujuan admin sebelum barang boleh dijual.
- Opname atau koreksi unit AC hilang/rusak.
- Pembatalan reservasi unit.

Dianggap gagal bila: harga kosong terhitung sebagai Rp0 di mana pun, atau
penjualan tertahan karena admin belum mengisi harga.

## Pilihan yang dipertimbangkan

**Layar input di HP**
- A. Layar baru "Terima Barang" khusus gudang. **Dipilih user**: sederhana,
  layar admin tidak ikut berubah. Biayanya satu layar tambahan.
- B. Mengubah layar "Stok Masuk" yang ada. Ditolak: layar itu sudah menampung
  masuk, keluar, dan koreksi.

**Penanda harga belum diisi**
- A. `item_costs.buy_price` boleh `NULL`. **Dipakai**: `NULL` diabaikan `AVG`,
  `MAX`, dan `SUM` di SQL.
- B. Tetap 0 ditambah kolom penanda. Ditolak: tiap hitungan harus ingat
  menyaring, dan yang terlupa membocorkan Rp0.

## Tahapan

Tiap tahap bisa dipakai dan di-deploy sendiri.

### Tahap 1: backend dan web admin

**Database.** Migrasi Prisma: `item_costs.buy_price` menjadi nullable.

**`POST /stock/in`.** `buyPrice` menjadi opsional untuk admin dan gudang.

| Kasus tanpa harga | Yang disimpan |
|---|---|
| AC tunggal | batch `buy_price = NULL` |
| Paket Indoor + Outdoor | Indoor `NULL`, Outdoor 0 (seperti sekarang) |
| Outdoor milik paket, diterima sendiri | 0, bukan "belum diisi" (modal ada di Indoor) |
| Sparepart gulungan | tiap gulungan `NULL` |
| Sparepart biasa, sudah punya harga | harga lama dipertahankan |
| Sparepart biasa, belum punya harga | `NULL` |

Tanpa harga, peringatan "modal di bawah harga jual" dilewati. Admin mendapat
notifikasi: ada barang masuk yang modalnya belum diisi.

**Perhitungan yang harus tahan `NULL`.**
- `pos.service.ts`: tiga tempat mengubah modal dengan `Number(...)`, yang
  membuat `NULL` menjadi 0 (komponen paket instalasi, sparepart biasa, modal
  paket pada jual satuan).
- `stock-locking.service.ts`: modal tertinggi dihitung hanya dari batch yang
  terisi. Bila semua kosong, hasilnya `null`.
- Peringatan jual satuan dari paket menampilkan "belum diisi", bukan Rp0.
- Laporan nilai stok dan laba menandai bahwa ada modal yang belum diisi,
  sehingga angkanya tidak terbaca sebagai final.

**Koreksi harga (keputusan user: bisa dikoreksi, tanpa batas waktu).**
- Pilihan "sekali isi saja" ditolak: salah ketik rupiah mudah terjadi dan hanya
  bisa dibetulkan lewat database.
- Akibat yang sudah disetujui: angka laba penjualan lama, termasuk bulan yang
  sudah lewat, ikut berubah.

**Endpoint baru, admin saja.**
- `GET /stock/pending-cost`: daftar batch dengan `buy_price` kosong (barang,
  jumlah, pemasok, tanggal, pencatat). Batch dari satu penerimaan dikelompokkan.
- `PUT /stock/batches/:itemCostId/cost`: mengisi **atau mengubah** harga.
  Pemasok boleh dilengkapi sekaligus. Bila modal tidak di bawah harga jual,
  balas `confirm_required` seperti barang masuk. Batch Outdoor milik paket
  ditolak (modalnya di Indoor). Audit log mencatat siapa, kapan, harga lama,
  harga baru, dan invoice yang berubah.

**Menghitung ulang invoice yang terdampak**, dalam transaksi yang sama. Satu
aturan untuk pengisian pertama maupun koreksi.

Barang yang punya mutasi per batch (AC, sparepart gulungan):
1. Cari mutasi stok dengan `itemCostId` batch itu yang punya `transactionId`
   (alasan `penjualan` atau `pemakaian_instalasi`).
2. Untuk baris barang itu pada invoice transaksi tersebut,
   `buy_price_snapshot` = harga tertinggi dari **semua batch yang diambil baris
   itu** (yang kosong dilewati; bila semua kosong, tetap kosong). Jual utuh
   dikali `packSize`.
3. Baris jual satuan dari paket (modal sengaja 0) tidak diubah.

Catatan: saat checkout, modal dihitung dari semua batch yang masih berstok.
Sesudah dihitung ulang, hanya batch yang benar-benar diambil yang dipakai, jadi
angkanya bisa berbeda dari catatan awal. Invoice yang tidak mengambil dari batch
itu tidak disentuh.

Sparepart biasa (mutasinya tanpa `itemCostId`): perbarui baris invoice sparepart
itu yang `buy_price_snapshot`-nya kosong atau sama dengan harga lama, sejak
harga lama itu dipasang (`updatedAt` baris `item_costs` sebelum diubah).

**Web admin.** Halaman "Modal Belum Diisi" di menu Stok & Gudang: daftar, isi
harga, konfirmasi bila perlu. Di detail produk dan sparepart, harga kosong
tampil sebagai "Belum diisi" dan tiap batch punya tombol "Ubah modal". Sebelum
menyimpan koreksi, tampilkan harga lama, harga baru, dan peringatan bahwa laporan
penjualan lama ikut berubah.

### Tahap 2: HP

**Layar "Terima Barang"** (`/stok/terima`) untuk gudang dan admin:
- Pilih barang: AC atau sparepart.
- AC berpasangan: isian Indoor dan Outdoor. Produk Outdoor yang berpasangan
  tidak tampil di daftar pilih. AC tunggal: satu isian jumlah.
- Sparepart: jumlah dalam satuan kecilnya. Gulungan: panjang tiap gulungan.
- Pemasok dan catatan opsional. **Tidak ada kolom harga.**
- Sesudah simpan: ringkasan unit yang dibuat dan tombol **Cetak Label**.
  Tombol simpan terkunci selama proses supaya tidak tercatat dua kali.

**Label stok.** Satu halaman per unit: QR (`qrToken`), kode unit, nama produk,
dan tulisan INDOOR atau OUTDOOR. Data dari `GET /stock/batches/:id/units`.
Memakai paket `pdf` dan `printing` yang sudah ada. Label juga bisa dicetak ulang
dari detail stok.

**Perubahan akses.** Untuk gudang, arah "Masuk" di layar Stok lama dialihkan ke
Terima Barang. Keluar dan koreksi tetap di layar lama.

### Tahap 3: web gudang

- Form barang masuk di web tidak menampilkan harga untuk gudang.
- Server mulai menolak `buyPrice` dari peran gudang (baru aman sesudah form web
  berubah).
- Label web diberi nama produk dan INDOOR/OUTDOOR.

## Pengujian

- Backend (jest): tiap baris tabel kasus tanpa harga; checkout saat modal
  sebagian atau seluruhnya kosong; pengisian harga memperbarui invoice AC,
  gulungan, jual utuh, dan melewati jual satuan paket; koreksi harga ke angka
  lebih rendah menurunkan modal invoice yang terdampak saja; koreksi tercatat di
  audit log; endpoint baru ditolak untuk selain admin.
- Mobile (`flutter test`): muatan Terima Barang tidak membawa `buyPrice`; paket
  mengirim `pairMode` dan jumlah Outdoor; label memuat nama dan peran.

## Batasan dan deploy

- Perubahan backend bersifat tambahan. APK lama yang masih mengirim harga tetap
  berjalan.
- Tahap 1 membawa migrasi database. Backup dulu, deploy dijalankan oleh user.
- Disk `C:` di laptop hampir penuh, harus dilonggarkan sebelum build APK.

## Diserahkan ke pelaksana

Susunan visual halaman, teks tombol, dan pembagian berkas, mengikuti pola yang
sudah ada.

## Belum terjawab

- Ukuran dan jenis printer label yang dipakai gudang. Menentukan ukuran halaman
  label di tahap 2. Tidak menghambat tahap 1.
