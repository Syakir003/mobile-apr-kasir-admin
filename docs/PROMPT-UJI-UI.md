# Prompt untuk Claude yang punya kendali browser/komputer

Salin seluruh blok di bawah ini ke Claude yang punya akses Chrome DevTools MCP,
Playwright MCP, atau computer-use.

---

Kamu menguji aplikasi **E-POS AC Realtime** (Flutter Web) yang **sudah berjalan**
di `http://localhost:5599` pada Chrome di komputer ini. Backend Supabase lokal
sudah menyala di `http://127.0.0.1:54321` (Docker), sudah terisi data uji.

**Jangan** menjalankan `flutter run` lagi dan **jangan** menyentuh Docker —
semuanya sudah hidup. Cukup pakai browser yang sudah terbuka. Kalau tab-nya
tertutup, buka lagi `http://localhost:5599`.

## Akun uji (password semua: `password123`)

| Peran | Email |
|-------|-------|
| Admin | `admin@eposac.local` |
| Kasir | `kasir@eposac.local` |
| Teknisi | `teknisi@eposac.local` |

Kalau password ditolak, bilang ke user — jangan mengarang atau mereset sendiri.

## Tugasmu

Telusuri SEMUA fitur lewat UI sebagai ketiga peran, lalu laporkan bug. Fokus
pada apa yang benar-benar terlihat rusak di layar, bukan tebakan dari kode.

Untuk setiap bug, laporkan: **langkah reproduksi → yang diharapkan → yang
terjadi → screenshot**. Sertakan juga error di Console DevTools jika ada.

## Daftar periksa

### Admin (menu ada 16)
1. **Login** — cek redirect ke Dashboard, angka metrik tampil.
2. **Master data** — Produk, Sparepart, Jasa, Paket: tambah 1, edit 1, nonaktifkan 1.
   Cek validasi form kosong memunculkan pesan error.
3. **Member** — tambah member, tambah unit AC, generate barcode, buka Riwayat unit.
4. **Transaksi (POS)** — masukkan produk + jasa ke keranjang, ubah qty, pakai
   picker member, isi diskon/pajak/ongkir, checkout. Cek total di layar sama
   dengan struk.
5. **Riwayat** — buka invoice, catat pembayaran DP lalu pelunasan, unduh/lihat
   struk PDF. Cek status berubah `belum_dibayar` → `dp` → `lunas`.
6. **Order** — buat Order Service manual (pilih member, unit, jenis, jadwal,
   teknisi), lihat muncul di daftar.
7. **Job** — tugaskan teknisi, batalkan job.
8. **Stok** — tab Stok & Mutasi. Klik FAB "Mutasi Stok": coba Barang Masuk 10
   (cek pratinjau "stok X → Y"), lalu Barang Keluar melebihi stok (tombol simpan
   HARUS terkunci dan muncul peringatan stok tidak cukup).
9. **Laporan** — grafik tren & produk terlaris tampil, tidak kosong/error.
10. **Akun** (`/users`) — buat akun baru, ubah peran, nonaktifkan, reset password.
    **CATATAN PENTING:** Edge Function `admin-users` KEMUNGKINAN BELUM di-deploy.
    Kalau "Buat Akun" gagal dengan error fungsi tidak ditemukan, itu **bukan bug
    UI** — laporkan apa adanya sebagai "Edge Function belum di-deploy".
    Buka akunmu sendiri (admin) — dropdown Peran dan switch Aktif HARUS terkunci.
11. **Audit** (`/audit`) — riwayat aktivitas tampil, filter per grup jalan,
    baris bisa dibuka untuk lihat detail.
12. **Scan** & **Profil**.

### Kasir (menu ada 5)
- Boleh: Dashboard, Transaksi, Riwayat, Order, Profil.
- **Ketik manual di address bar**: `/products`, `/members`, `/stok`, `/laporan`,
  `/users`, `/audit` — SEMUA harus memantulkan balik ke Dashboard.

### Teknisi (menu ada 4)
- Boleh: Dashboard, Job, Scan, Profil.
- **Ketik manual**: `/pos`, `/transactions`, `/orders` — harus memantul ke Dashboard.
- Buka detail job miliknya:
  - Unggah **foto SEBELUM** — sebelum ada foto, tombol "Mulai Pekerjaan" HARUS
    terkunci dengan pesan pengunci.
  - Setelah ada foto → "Mulai Pekerjaan" → scan barcode. Barcode SALAH harus ditolak.
  - **Badge tagihan**: job yang invoice-nya belum lunas harus menampilkan banner
    sisa tagihan. Banner ini hanya PERINGATAN — tombol Mulai TETAP boleh ditekan.
    Kalau banner memblokir tombol, itu bug.
  - Ajukan material tambahan → login admin di tab lain → setujui/revisi/tolak →
    kembali sebagai teknisi → "Gunakan Material" → cek stok berkurang.
  - Selesaikan pekerjaan (isi diagnosa) + foto SESUDAH.

### Responsif
Ubah lebar jendela < 800px: navigasi harus berubah jadi bottom-nav dengan tab
"Lainnya" berisi menu sisanya. > 800px: sidebar.

## Yang sudah diverifikasi (jangan diulang)

Lapisan backend/RPC sudah diuji tuntas lewat SQL dan LULUS: checkout, dedupe
member by nomor HP, pembayaran bertahap, penolakan diskon>subtotal / qty 0 /
keranjang kosong / bayar melebihi tagihan, guard peran tiap RPC, mutasi stok,
kelola akun, audit log, dan `job_payment_info`.

Jadi fokuskan tenagamu ke **lapisan UI**: rendering, navigasi, state, validasi
form, pesan error yang tampil, dan overflow layout.

## Aturan pelaporan

- Jangan melaporkan bug yang tidak kamu lihat sendiri di layar.
- Kalau ragu antara bug atau memang desainnya, tandai "perlu konfirmasi".
- Kalau ada yang tidak bisa diuji (mis. fitur butuh deploy), katakan terus terang
  bagian mana yang tidak tercakup — jangan diam-diam dilewati.
