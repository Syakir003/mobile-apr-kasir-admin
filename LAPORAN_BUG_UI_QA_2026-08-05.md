# Laporan Bug UI — E-POS AC Realtime (Flutter Web)

**Tanggal:** 5 Agustus 2026
**Build:** http://localhost:5599 (banner DEBUG aktif), Supabase lokal 127.0.0.1:54321
**Browser:** Chrome, viewport 1280×575 (dpr 1.5)
**Cakupan:** UI penuh sebagai Admin (16 menu), Kasir (5 menu), Teknisi (4 menu)
**Catatan:** Hanya bug yang terlihat langsung di layar. Lapisan RPC/backend tidak diuji ulang.

---

## Status Perbaikan (per 6 Agustus 2026)

Semua 13 bug dan 4 poin konfirmasi sudah ditangani. `flutter analyze` bersih
(sisa 1 info bawaan: `anonKey` deprecated) dan 172 test lulus.

| # | Perbaikan | Berkas utama |
|---|---|---|
| 1 | Picker POS ikut memfilter `active` | `pos/item_picker_sheet.dart` |
| 2 | Diskon > subtotal ditolak inline, tombol terkunci | `pos/cart_state.dart`, `pos/checkout_screen.dart` |
| 3 | Helper `errorMessage()` mengupas bungkus PostgREST (11 lokasi) | `core/utils/error_message.dart` |
| 4 | "Bagikan Struk" memberi snackbar sukses/gagal | `transactions/invoice_detail_screen.dart` |
| 5 | `members.total_ac_units` jadi kolom turunan berbasis trigger | migrasi `…0019` |
| 6 | Sheet hasil Scan bisa di-scroll (`isScrollControlled`) | `scan/scan_screen.dart` |
| 7 | Kartu Audit pakai `Card` (Material) alih-alih Container berdekorasi | `audit/audit_log_screen.dart` |
| 8 | Dialog konfirmasi sebelum Batalkan Job | `jobs/job_detail_screen.dart` |
| 9 | `AutovalidateMode.onUserInteraction` di semua form | 10 layar form |
| 10 | `formatRupiah()` dipusatkan di `core/utils/currency.dart` | 4 layar master |
| 11 | `flutter_localizations` + `locale: id` | `main.dart`, `pubspec.yaml` |
| 12 | Roboto (Unicode) dibundel untuk semua PDF | `core/pdf/pdf_theme.dart` |
| 13 | Petunjuk input manual di area kamera Scan | `scan/scan_screen.dart` |
| 14 | Barcode tidak lagi ditulis utuh; hanya identitas unit + 4 digit akhir | `jobs/job_detail_screen.dart` |
| 15 | Baris kembalian pada pembayaran tunai | `transactions/payment_form_sheet.dart` |
| 16 | Status order dihitung ulang saat job dibatalkan | migrasi `…0019` |
| 17 | Grid dashboard pakai tinggi tetap (`mainAxisExtent`) | `dashboard/dashboard_screen.dart` |

Migrasi `20260805000019_bugfix_unit_status_realtime_counter.sql` sudah diterapkan
ke Supabase lokal (trigger aktif, `total_ac_units` cocok dengan jumlah baris
sebenarnya untuk 8 member).

**Belum diverifikasi ulang di browser** — perbaikan di atas lolos analyze + test,
tapi uji manual UI (terutama breakpoint < 800px yang memang belum pernah diuji)
masih perlu dijalankan.

---

## Ringkasan

| # | Judul | Peran | Tingkat |
|---|---|---|---|
| 1 | Produk **nonaktif** masih muncul & bisa dijual di POS | Admin/Kasir | **Tinggi** |
| 2 | Diskon > subtotal → total **negatif** di layar, tombol tetap aktif | Admin/Kasir | **Tinggi** |
| 3 | Pesan error mentah `PostgrestException(...)` bocor ke user | Semua | **Sedang-Tinggi** |
| 4 | "Bagikan Struk" tidak menghasilkan apa pun yang terlihat | Admin/Kasir | **Sedang** |
| 5 | Picker member di checkout selalu bilang "0 unit" | Admin/Kasir | **Sedang** |
| 6 | RenderFlex overflow 7.4px di bottom-sheet hasil Scan | Semua | **Sedang** |
| 7 | Exception `ListTile background color...` spam di console | Semua | **Sedang** |
| 8 | "Batalkan Job" jalan tanpa dialog konfirmasi | Admin | **Sedang** |
| 9 | Pesan validasi lama tidak hilang saat field sudah diisi | Semua | **Rendah** |
| 10 | Format Rupiah tidak konsisten (`Rp 5500000` vs `Rp 5.500.000`) | Admin | **Rendah** |
| 11 | Date picker masih Bahasa Inggris | Admin/Kasir | **Rendah** |
| 12 | Font PDF struk tanpa dukungan Unicode | Admin/Kasir | **Rendah** |
| 13 | Kamera Scan gagal senyap (layar hitam, tanpa pesan) | Semua | **Rendah** |

**Perlu konfirmasi (bug atau desain?):** #14–#17 di bawah.
**Tidak bisa diuji:** responsif < 800px (lihat bagian akhir).

---

## BUG-01 — Produk nonaktif masih bisa dijual di POS · **Tinggi**

**Langkah reproduksi**
1. Login admin → **Produk** → **Tambah** → isi "Uji QA AC 1 PK", merek QAbrand, tipe QA-001, PK 1, harga beli 1.000.000, harga jual 1.500.000, stok 5 → Simpan.
2. Buka produk itu lagi → matikan switch **Aktif** → Simpan.
3. Daftar produk menunjukkan badge **Nonaktif**. ✔
4. Buka **Transaksi** → **Tambah Item** → tab **Produk**.

**Diharapkan:** produk nonaktif tidak muncul di picker POS (tidak bisa dijual).

**Yang terjadi:** "Uji QA AC 1 PK (edit)" tetap muncul di daftar dan bisa ditambahkan ke keranjang. Halaman **Stok** sudah benar menyembunyikannya — jadi filternya tidak konsisten antar halaman.

**Screenshot:** ada di transkrip chat — picker "Tambah Item" tab Produk, baris terakhir `Uji QA AC 1 PK (edit) · Stok 5 · QAbrand · Rp 1.500.000`, padahal di halaman Produk badge-nya `Nonaktif`.

---

## BUG-02 — Diskon melebihi subtotal → total negatif, tombol tidak dikunci · **Tinggi**

**Langkah reproduksi**
1. Login admin → **Transaksi** → tambah Panasonic CS-YN5 (qty 2) + jasa Cuci AC 1/2–1 PK → **Checkout**.
2. Isi **Diskon (Rp)** = `99999999`, Pajak 11, Ongkos Transport 50000.

**Diharapkan:** diskon dibatasi ≤ subtotal, atau muncul error inline dan tombol **Buat Transaksi** terkunci — sama seperti perilaku Barang Keluar di Mutasi Stok yang sudah benar.

**Yang terjadi:**
- Ringkasan menampilkan **Pajak Rp -10.288.850** dan **Total Rp -103.773.849**.
- Tidak ada pesan error apa pun.
- Tombol **Buat Transaksi** tetap aktif dan bisa ditekan; baru ditolak oleh database.

**Screenshot:** ada di transkrip chat — panel ringkasan Checkout: `Subtotal Rp 6.465.000 / Diskon - Rp 99.999.999 / Pajak Rp -10.288.850 / Transport Rp 50.000 / Total Rp -103.773.849`, tombol Buat Transaksi masih hijau (aktif).

---

## BUG-03 — Error mentah PostgREST bocor ke pengguna · **Sedang-Tinggi**

**Langkah reproduksi A**
1. Lanjutan BUG-02 → tekan **Buat Transaksi**.

**Yang terjadi:** snackbar merah berbunyi
```
Gagal checkout: PostgrestException(message: Diskon melebihi subtotal, code: P0001, details: Bad Request, hint: null)
```

**Langkah reproduksi B**
1. Login teknisi → buka job "Daikin FTKC-15 1 PK Inverter" → unggah foto SEBELUM → Mulai → scan barcode benar.
2. Tekan **Selesaikan Pekerjaan** tanpa mengunggah foto SESUDAH.

**Yang terjadi:**
```
PostgrestException(message: Foto SESUDAH wajib diunggah sebelum menyelesaikan pekerjaan, code: P0001, details: Bad Request, hint: null)
```

**Diharapkan:** hanya `message` yang ditampilkan ("Diskon melebihi subtotal" / "Foto SESUDAH wajib diunggah…"), tanpa nama kelas, `code`, `details`, `hint`.

**Catatan tambahan (B):** tombol **Mulai Pekerjaan** dikunci rapi + ada hint kuning saat foto SEBELUM belum ada, tapi **Selesaikan Pekerjaan** tidak diperlakukan sama — validasinya baru terjadi di database. Perilakunya jadi tidak konsisten.

**Screenshot:** ada di transkrip chat — dua snackbar merah full-width berisi teks PostgrestException lengkap.

---

## BUG-04 — "Bagikan Struk" tidak menghasilkan apa pun yang terlihat · **Sedang**

**Langkah reproduksi**
1. Login admin → **Riwayat** → buka INV-20260805-0001 (status Lunas).
2. Scroll ke bawah → tekan **Bagikan Struk**. Tekan lagi untuk memastikan.

**Diharapkan:** pratinjau/print dialog PDF terbuka, atau file terunduh dengan indikator yang jelas.

**Yang terjadi:** tidak ada dialog, tidak ada tab baru, tidak ada snackbar, tidak ada perubahan layar sama sekali. Tidak ada error di console. PDF *memang* dibuat (console mencatat log dari `dart_pdf` tepat pada detik penekanan tombol), tapi tidak ada umpan balik apa pun ke pengguna.

**Console (bukti PDF digenerate):**
```
[22.20.15] Helvetica-Bold has no Unicode support see https://github.com/DavBfr/dart_pdf/wiki/Fonts-Management
[22.20.15] Helvetica has no Unicode support see ...
```

**Screenshot:** ada di transkrip chat — layar identik sebelum dan sesudah tombol ditekan (dua kali), tanpa dialog/tab/snackbar.

> Aku tidak bisa memverifikasi apakah file benar-benar masuk ke folder Download — perlu dicek manual.

---

## BUG-05 — Picker member selalu menampilkan "0 unit" untuk member yang punya unit · **Sedang**

**Langkah reproduksi**
1. Login admin → **Member** → **Tambah** → "QA Tester Member", HP 081298765400, alamat "Jl. QA No. 1" → Simpan.
2. Buka member itu → **+** → tambah Unit AC: merek Daikin, model FTKC-QA, lokasi Ruang Tamu → Simpan. Barcode `ACUNIT-20260805-0001` terbuat.
3. Buka detail member → unit tampil. ✔
4. **Transaksi** → tambah item apa saja → **Checkout** → **Pilih Member**.

**Diharapkan:** baris "QA Tester Member" menampilkan **1 unit**.

**Yang terjadi:** menampilkan **0 unit**. Padahal begitu member dipilih, bagian "UNIT AC YANG DIKERJAKAN" di halaman yang sama langsung menampilkan unit Daikin FTKC-QA itu — jadi datanya ada, hanya hitungannya salah.

Sudah diverifikasi ulang setelah logout–login penuh (bukan cache sesi).

**Screenshot:** ada di transkrip chat — sheet "Pilih Member": baris `QA Tester Member · +6281298765400 · Jl. QA No. 1` dengan label `0 unit` di kanan, sementara `Budi Santoso`, `Putra`, `Syakir` menampilkan `1 unit`.

---

## BUG-06 — RenderFlex overflow 7.4 px di bottom-sheet hasil Scan · **Sedang**

**Langkah reproduksi**
1. Login admin (atau teknisi) → **Scan**.
2. Isi input barcode manual `ACUNIT-20260805-0001` → **Cari**.

**Diharapkan:** kartu hasil scan tampil rapi.

**Yang terjadi:** muncul strip kuning-hitam khas Flutter dengan tulisan **"BOTTOM OVERFLOWED BY 7.4 PIXELS"**, menimpa tombol kedua di bawah "Riwayat Service Unit".

**Console DevTools:**
```
[22.35.04] [ERROR] Another exception was thrown: A RenderFlex overflowed by 7.4 pixels on the bottom.
```

**Screenshot:** ada di transkrip chat — strip kuning-hitam bertuliskan `BOTTOM OVERFLOWED BY 7.4 PIXELS` di bawah tombol `Riwayat Service Unit`.

---

## BUG-07 — Exception framework berulang: "ListTile background color or ink splashes may be invisible" · **Sedang**

**Langkah reproduksi**
1. Buka DevTools → Console.
2. Buka halaman mana pun yang berisi daftar kartu (Produk, Sparepart, Member, Job, Audit, Scan).

**Yang terjadi:** exception dilempar berkali-kali (10+ kali dalam satu render pada Scan saja).

**Console DevTools:**
```
EXCEPTION CAUGHT BY FLUTTER FRAMEWORK
The following assertion was thrown:
ListTile background color or ink splashes may be invisible.
The ListTile is wrapped in a DecoratedBox that has a background color. Because ListTile paints its
background and ink splashes on the nearest Material ancestor, this DecoratedBox will hide those effects.
To fix this, wrap the ListTile in its own Material widget, or remove the background color from the
intermediate DecoratedBox.
```

**Dampak visual:** efek ripple saat kartu ditekan tidak muncul. Selain itu spam exception ini menutupi error lain yang mungkin penting.

---

## BUG-08 — "Batalkan Job" dieksekusi tanpa konfirmasi · **Sedang**

**Langkah reproduksi**
1. Login admin → **Job** → buka salah satu job → scroll ke bawah → tekan **Batalkan Job**.

**Diharapkan:** dialog konfirmasi ("Yakin batalkan job ini?") sebelum aksi destruktif dijalankan.

**Yang terjadi:** job langsung dibatalkan, snackbar "Job dibatalkan.", status berubah jadi **Dibatalkan**. Tidak ada konfirmasi dan tidak ada undo.

**Screenshot:** ada di transkrip chat — dari klik langsung ke snackbar `Job dibatalkan.` + badge `Dibatalkan`, tanpa dialog di antaranya.

---

## BUG-09 — Pesan validasi lama tidak hilang setelah field diisi · **Rendah**

**Langkah reproduksi**
1. Buka halaman **Login** (atau **Tambah Produk** / **Akun Baru**).
2. Tekan tombol submit dengan form kosong → pesan "Email wajib diisi" / "Wajib diisi" muncul (benar ✔).
3. Sekarang isi semua field dengan data valid.

**Diharapkan:** pesan merah + border merah hilang begitu field terisi.

**Yang terjadi:** border merah dan pesan "Wajib diisi" tetap menempel sampai tombol submit ditekan lagi. Terlihat seperti form masih error padahal sudah benar.

**Screenshot:** ada di transkrip chat — form Login dengan `admin@eposac.local` dan password terisi, tapi border merah + teks `Email wajib diisi` / `Password wajib diisi` masih tampil.

---

## BUG-10 — Format mata uang tidak konsisten · **Rendah**

**Langkah reproduksi**
1. Login admin → **Produk**, lalu bandingkan dengan **Transaksi → Tambah Item**.

**Yang terjadi:**
- Daftar Produk: `Rp 5500000`, `Rp 7900000` (tanpa pemisah ribuan)
- Daftar Sparepart: `Rp 65000/set`, `Rp 150000/kg`
- Daftar Jasa: `Rp 250000`
- Picker POS / Checkout / Dashboard / Laporan: `Rp 5.500.000` ✔

**Diharapkan:** satu format Rupiah di seluruh aplikasi.

---

## BUG-11 — Date picker masih Bahasa Inggris · **Rendah**

**Langkah reproduksi**
1. Login admin → **Order** → **Order Baru** → pilih member → **Jadwal (opsional)** → **Pilih tanggal**.

**Yang terjadi:** dialog menampilkan "Select date", "Wed, Aug 5", header hari `S M T W T F S`, tombol "Cancel" / "OK" — sementara seluruh aplikasi berbahasa Indonesia. `MaterialLocalizations` untuk `id_ID` sepertinya belum dipasang.

**Screenshot:** ada di transkrip chat — dialog `Select date` / `Wed, Aug 5` / `Cancel` / `OK`.

---

## BUG-12 — Font struk PDF tanpa dukungan Unicode · **Rendah**

**Bukti console** (saat menekan Bagikan Struk):
```
Helvetica-Bold has no Unicode support see https://github.com/DavBfr/dart_pdf/wiki/Fonts-Management
Helvetica has no Unicode support see ...
```

**Risiko:** karakter non-ASCII (mis. `•`, `—`, `×`, atau nama pelanggan bertanda baca khusus) berpotensi tampil rusak/kosong di struk. Belum bisa dipastikan karena PDF-nya tidak pernah tampil (lihat BUG-04).

---

## BUG-13 — Kamera Scan gagal senyap · **Rendah**

**Langkah reproduksi**
1. Buka **Scan** (peran apa pun).

**Yang terjadi:** area kamera hanya kotak hitam polos dengan bingkai putih. Tidak ada pesan "kamera tidak tersedia" atau tombol "izinkan kamera". Pengguna tidak tahu harus berbuat apa; untungnya input manual tetap berfungsi.

**Screenshot:** ada di transkrip chat — area kamera hitam polos dengan bingkai putih, tanpa teks penjelasan.

---

# Perlu Konfirmasi (bug atau memang desain?)

**#14 — Barcode yang diharapkan ditampilkan di layar scan.**
Saat teknisi menekan Mulai Pekerjaan, dialog scan menulis "Cocokkan dengan **ACUNIT-20260715-0001**". Ini membocorkan jawaban yang seharusnya diverifikasi, sehingga teknisi bisa mengetik manual tanpa datang ke unit. Kalau tujuannya bukti kehadiran, ini melemahkan kontrolnya.

**#15 — Bayar berlebih dipotong diam-diam tanpa tampilan kembalian.**
Sisa tagihan Rp 5.004.150, aku isi "Uang Diterima" Rp 99.999.999. Pembayaran tercatat persis Rp 5.004.150 dan status jadi Lunas — benar. Tapi tidak ada baris "Kembalian Rp 94.995.849". Untuk POS tunai ini biasanya wajib.

**#16 — Order tetap "Terjadwal" padahal satu-satunya job-nya sudah dibatalkan.**
Aku batalkan job "Service" milik QA Tester Member (1/1 unit). Di halaman Order, order tersebut masih berbadge **Terjadwal** dengan "0/1 unit selesai".

**#17 — Kartu Dashboard & Akses Cepat punya ruang kosong sangat besar.**
Kartu "Job Aktif" / "Job Selesai" dan kartu Akses Cepat memberi jarak ±150 px antara ikon/label dan angka/teksnya. Terlihat seperti aspect-ratio yang tidak diatur, bukan pilihan desain.

---

# Yang Sudah Diuji dan LULUS

**Admin (16 menu)** — login & redirect ke Dashboard; metrik dashboard; CRUD Produk/Sparepart/Jasa/Paket + validasi form kosong; tambah member (nomor HP dinormalisasi ke `+628…`); tambah unit AC + barcode otomatis `ACUNIT-YYYYMMDD-NNNN`; Riwayat Service unit; POS (produk + jasa, ubah qty, picker member, diskon/pajak/ongkir); **total di layar Rp 7.004.150 = total di invoice** ✔; matematika diskon/pajak/ongkir benar (6.465.000 − 200.000 = 6.265.000; 11% = 689.150; total 7.004.150); alur status **belum_dibayar → dp → lunas** ✔; buat Order Service manual; tugaskan teknisi; batalkan job; Mutasi Stok Barang Masuk 10 dengan pratinjau "**Stok Panasonic CS-YN5 1/2 PK: 10 → 20**" ✔; Barang Keluar melebihi stok → **tombol Simpan terkunci + peringatan "Stok Gree GWC-18 2 PK Inverter tidak cukup: tersedia 3."** ✔; Laporan (tren 14 hari, produk terlaris, rekap pembayaran); Akun — ubah peran & nonaktifkan/aktifkan berhasil, dan **akun sendiri: dropdown Peran + switch Aktif terkunci** dengan penjelasan "Peran & status akun sendiri tidak bisa diubah, supaya Anda tidak terkunci keluar dari sistem" ✔; Audit (daftar tampil, baris bisa dibuka, filter grup Stok/Job/Order/Transaksi/Akun jalan); Scan (barcode salah ditolak "Barcode tidak ditemukan", barcode benar membuka kartu unit); Profil.

**Edge Function `admin-users` memang belum ter-deploy** — "Buat Akun" dan "Reset Password" gagal dengan snackbar **"Gagal memproses (kode 503)"**. Dilaporkan apa adanya, bukan bug UI. (Catatan kecil: pesannya tidak menjelaskan penyebab, mungkin layak diperjelas.)

**Kasir (5 menu)** — Dashboard, Transaksi, Riwayat, Order, Profil tampil benar. Ketik manual di address bar `#/products`, `#/members`, `#/stok`, `#/laporan`, `#/users`, `#/audit` → **keenamnya memantul ke Dashboard** ✔

**Teknisi (4 menu)** — Dashboard, Job, Scan, Profil. `#/pos`, `#/transactions`, `#/orders` → **ketiganya memantul ke Dashboard** ✔
Detail job:
- Sebelum foto SEBELUM: tombol **Mulai Pekerjaan** terkunci + hint "Unggah foto SEBELUM dulu untuk memulai pekerjaan." ✔
- Setelah foto → tombol aktif → dialog scan barcode muncul ✔
- Barcode salah (`ACUNIT-20260805-0001` pada job berbarcode `ACUNIT-20260715-0001`) → ditolak, **"Barcode tidak sesuai unit pada job ini"** ✔
- **Banner tagihan tidak memblokir**: job dengan invoice DP (sisa Rp 3.800.000 dari Rp 5.800.000) menampilkan banner peringatan, dan tombol Mulai tetap bisa ditekan ✔ (sesuai spesifikasi)
- Ajukan material (Kapasitor 25uF × 1) → status **Menunggu**; admin **Revisi** jadi 2 pcs → **Setujui Revisi** → status **Disetujui** Rp 90.000; teknisi **Gunakan Material** → "**Material sudah dipakai (stok dipotong)**" ✔
- **Stok Kapasitor 25uF turun 15 → 13** ✔
- Banner tagihan ikut naik jadi "sisa Rp 3.890.000 dari Rp 5.890.000" (material Rp 90.000 masuk invoice) ✔
- Isi diagnosa + foto SESUDAH → **Selesaikan Pekerjaan** → status **Selesai** dengan waktu Mulai & Selesai tercatat ✔

**Responsif > 800px** — sidebar tampil, bisa di-scroll, 16 item menu admin semuanya terjangkau ✔

---

# Tidak Bisa Diuji

**Responsif < 800px (bottom-nav + tab "Lainnya").**
Jendela Chrome sedang dalam keadaan maximized pada layar 1280px dan tidak mau diubah ukurannya lewat tooling — `window.innerWidth` tetap 1280 setelah beberapa kali percobaan resize, dan shortcut zoom keyboard diblokir. Jadi breakpoint < 800px **belum diuji sama sekali**. Perlu dijalankan manual: kecilkan jendela Chrome di bawah 800px lalu cek bottom-nav dan tab "Lainnya".

**Isi PDF struk.** Lihat BUG-04 — file-nya tidak pernah muncul, jadi tata letak dan karakter di dalam struk tidak bisa diperiksa.

**Unggah foto lewat file picker asli.** Dialog file bawaan OS tidak bisa dioperasikan dari sini, jadi foto SEBELUM/SESUDAH disuntikkan langsung ke elemen `<input type="file">` di halaman. Alur unggahnya sendiri berjalan normal (foto tersimpan, tombol terbuka, validasi backend jalan), tapi jalur "klik → pilih file di dialog OS" belum diuji.

---

# Data Uji yang Ditinggalkan

Perlu dibersihkan kalau database ingin dikembalikan seperti semula:

- Produk **"Uji QA AC 1 PK (edit)"** (nonaktif, stok 5)
- Member **"QA Tester Member"** (+6281298765400) + unit **Daikin FTKC-QA** (`ACUNIT-20260805-0001`)
- Invoice **INV-20260805-0001** (Rp 7.004.150, Lunas, 2 pembayaran tunai)
- Order Service "Cuci AC" (dari checkout) dan "Service" (manual, job-nya dibatalkan)
- Mutasi stok Panasonic CS-YN5 +10 (stok 10 → 20)
- File `qa_foto_sebelum.png` & `qa_foto_sesudah.png` di folder ini (gambar uji 100×100 putih, aman dihapus)
- Job Daikin FTKC-15 (Budi Santoso) kini **Selesai**, dengan material Kapasitor 25uF 2 pcs terpakai (stok 15 → 13) dan invoice INV-20260715-0002 bertambah Rp 90.000
