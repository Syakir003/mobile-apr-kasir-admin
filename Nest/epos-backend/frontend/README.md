# Frontend Uji Coba Siklus

Ini BUKAN frontend produksi — cuma alat internal buat uji end-to-end siklus
Cycle 1: **jual retail → instalasi AC → QR/barcode unit → servis teknisi →
pembayaran**, langsung ke API NestJS yang asli. Tampilan sengaja apa adanya,
silakan dirombak sendiri (atau diganti Next.js beneran nanti).

Referensi alur & istilah diambil dari app Flutter tim (`epos-frontend/mobile-apr-kasir-admin/frontend/mobile`),
tapi endpoint yang dipanggil di sini murni REST API NestJS (`epos-backend`), BUKAN Supabase.

## Cara jalanin

Gak perlu build tool. Tinggal serve folder ini sebagai static file, misalnya:

```bash
cd epos-backend/frontend
npx serve .
# atau: python -m http.server 5500
```

Lalu buka di browser (`http://localhost:5500` atau sesuai port serve-nya).
Pastikan backend NestJS juga jalan (`npm run start:dev`, default port 3000) —
CORS di `main.ts` sudah `origin: '*'` jadi aman diakses dari port berbeda.

## Alur uji yang disarankan

1. **Login** — pakai seed admin (`admin@toko.local` / `ganti-password-ini`).
   Isi API Base URL kalau backend tidak di `http://localhost:3000`.
2. **Master Data** — klik "Muat/Refresh Semua" dulu. Kalau masih kosong,
   tambah minimal: 1 produk (AC unit), 1 sparepart, 1 jasa, dan 1 user
   ber-role `teknisi`.
3. **POS/Checkout** — tambah produk AC ke keranjang, centang "Pasang Unit",
   isi lokasi ruangan (teknisi boleh dikosongkan dulu untuk uji status
   `menunggu_penugasan`), isi data pelanggan, lalu Checkout. Ini otomatis
   bikin invoice + service order + technician job.
4. **Job Board** — refresh, klik "Detail" pada job yang baru dibuat. Kalau
   belum ada teknisi, assign dulu. Job detail menampilkan `barcodeValue` unit
   — dipakai sebagai simulasi scan QR (isi field "Mulai Pekerjaan" dengan
   barcode yang sama persis).
   Urutan gate servernya: upload foto **sebelum** → baru bisa "Start" (scan
   barcode) → (opsional) ajukan material tambahan → admin approve/reject →
   kalau approved, tandai "dipakai" → upload foto **sesudah** → baru bisa
   "Selesaikan Job".
5. **Invoice & Pembayaran** — invoice ID otomatis terisi begitu checkout
   sukses. Catat pembayaran sebagian dulu untuk uji status `dp`, lalu lunasi
   untuk uji status `lunas`.
6. **Realtime Log** (opsional) — klik "Hubungkan" untuk lihat event socket.io
   (`transaction.created`, `job.status_changed`, dll) muncul live.

Panel "Debug — Panggilan API Terakhir" di bagian paling bawah menampilkan
request/response mentah dari panggilan API terakhir — berguna kalau ada yang
gagal dan butuh lihat pesan error aslinya.

## Login sebagai teknisi

Kalau mau uji dari sisi teknisi beneran (bukan admin yang bypass ownership
check), logout lalu login pakai akun teknisi yang dibuat di step Master Data,
lalu buka Job Board dan centang "hanya antrian saya" untuk lihat job yang
di-assign ke dia (`GET /technician-jobs/queue`).
