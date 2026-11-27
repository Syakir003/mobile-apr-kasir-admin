# Desain: Batalkan Invoice

Tanggal: 28 November 2026
Status: menunggu persetujuan

## Latar dan tujuan

Belum ada cara membatalkan penjualan. Pembeli yang batal membuat unit AC
tertahan di `reserved`, dan status invoice `batal` tidak pernah dipakai. Menurut
user, hampir semua kejadian ada di toko: batal sebelum bayar, sesudah DP atau
lunas, dan sesudah barang keluar.

Tujuan: admin membatalkan satu invoice utuh, memilih nasib barang, uang,
voucher, dan job, dengan jejak yang lengkap.

Bukan bagian pekerjaan ini:
- Membatalkan sebagian barang (batalkan utuh, lalu jual ulang).
- Memulihkan invoice yang sudah batal.
- Mengembalikan unit berstatus `rusak` menjadi bisa dijual.
- Layar pembatalan di aplikasi HP.

Dianggap gagal bila: invoice batal masih terhitung sebagai omzet atau piutang,
stok bertambah dua kali, uang kas tidak cocok, atau pembatalan berhenti di
tengah jalan.

## Pilihan yang dipertimbangkan

- **A. Batal utuh, tiap bagian bisa diatur. Dipilih user.** Menutup hampir semua
  kejadian dengan risiko salah hitung kecil.
- B. Batal sebagian barang. Ditolak untuk sekarang: total, diskon, pajak,
  voucher, dan pembayaran harus dihitung ulang.

## Pengaman

- Hanya admin.
- Satu transaksi database: semua berhasil atau tidak ada yang berubah.
- Baris invoice dikunci. Invoice yang sudah batal ditolak (tidak dobel).
- Kondisi saat pratinjau dikirim ulang saat konfirmasi. Bila sudah berubah
  (misalnya unit baru saja di-scan atau ada pembayaran baru), ditolak dan admin
  memuat ulang.
- Tidak ada baris yang dihapus. Pengembalian dicatat sebagai baris baru.
- Alasan wajib. Audit log `invoice.cancel` menyimpan salinan invoice, baris,
  pembayaran, dan unit sebelum batal, beserta semua pilihan admin.

## Data

Migrasi tambahan pada `invoices`: `cancelled_at`, `cancelled_by`,
`cancel_reason`, ketiganya boleh kosong. Status memakai `batal` yang sudah ada.
`StockUnit.status` mendapat nilai baru `rusak` (kolomnya teks, tanpa migrasi).

## Nasib tiap bagian

| Bagian | Yang terjadi |
|---|---|
| Unit AC `reserved` | Kembali `di_gudang`, reservasi dilepas |
| Unit AC `keluar` | Admin memilih per unit: kembali `di_gudang`, atau `rusak` (tidak dijual) |
| Sparepart terjual dan komponen paket | Per baris: kembali ke stok (ke gulungan asalnya) atau tidak kembali |
| Mutasi stok | Baris positif beralasan `pembatalan_penjualan` hanya untuk yang benar-benar kembali |
| Uang diterima | Admin mengisi jumlah dikembalikan (0 sampai total dibayar) dan caranya (tunai atau transfer). Dicatat sebagai pembayaran **negatif**, sehingga kas shift ikut berkurang. Sisanya "uang hangus" |
| Voucher dipakai | Pilihan: bisa dipakai lagi (bila belum kedaluwarsa) |
| Job belum selesai | Dibatalkan memakai logika batal job yang ada |
| Job selesai | Dibiarkan; admin diberi peringatan |
| Unit AC pelanggan dari instalasi yang batal | Dinonaktifkan atau dihapus bila belum terisi, jumlah AC member dikurangi |
| Sparepart yang sudah dipakai teknisi | Tetap terpakai |

Berlaku untuk invoice POS, servis, dan manual. Bagian yang tidak ada tidak
ditampilkan.

## Perhitungan yang harus mengabaikan invoice batal

- Laporan penjualan (total, per barang, grafik harian, per tipe pembeli).
- Laba rugi dan laporan stok (omzet, modal, nama pembeli pada mutasi keluar).
- Dashboard (omzet, piutang, daftar).
- Total belanja member.
- Modal Barang tidak perlu mengubah baris invoice batal.

Laporan menampilkan satu angka terpisah: **uang hangus dari pembatalan**,
menurut tanggal pembatalan.

Pembayaran ke invoice batal sudah ditolak. Pengajuan material baru ke invoice
batal juga harus ditolak. Struk publik dan detail invoice menampilkan
**DIBATALKAN**.

## Antarmuka

**Backend, admin saja.**
- `GET /invoices/:id/cancel-preview`: unit, baris sparepart, uang diterima,
  voucher, job, dan penanda kondisi.
- `POST /invoices/:id/cancel`: alasan, pilihan per unit dan per baris
  sparepart, jumlah dan cara pengembalian uang, pilihan voucher, penanda kondisi.

**Web.** Tombol "Batalkan Invoice" di detail invoice (admin). Dialog sesuai
pilihan di atas, dengan ringkasan akibat sebelum konfirmasi terakhir. Daftar
dan detail invoice menandai yang batal beserta alasan dan pembatalnya. Tampilan
per unit di detail produk mendapat filter `Rusak`.

## Tahapan

1. Backend: migrasi, pratinjau, pembatalan, penyaringan laporan.
2. Web: dialog, penanda, struk.

Tahap 1 tidak di-deploy sendirian ke produksi tanpa tahap 2.

## Pengujian

- Tiap baris tabel nasib, termasuk kombinasi: belum bayar, DP, lunas.
- Batal dua kali, kondisi berubah sesudah pratinjau, dan gagal di tengah (tidak
  ada yang berubah).
- Stok kembali tepat sekali; gulungan kembali ke gulungan asal.
- Tiap laporan dan dashboard tidak menghitung invoice batal.
- Kas shift sesuai sesudah pengembalian tunai.
- Peran selain admin ditolak.
- Uji ujung-ke-ujung di database sementara.

## Batasan

- Dikerjakan di atas branch `gabung-production`.
- Laporan penjualan menurut tanggal invoice, jadi membatalkan invoice lama
  **mengubah angka periode lalu**.
- Deploy VPS oleh user, dengan backup database lebih dulu.

## Diserahkan ke pelaksana

Susunan berkas, nama fungsi, dan tata letak dialog, mengikuti pola yang ada.
