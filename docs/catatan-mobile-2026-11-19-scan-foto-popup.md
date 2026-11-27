# Catatan untuk Mobile (Syakir): perubahan scan, foto sesudah, popup, dan slot "teknisi yang scan"

Tanggal: 2026-11-19. Dibuat dari pekerjaan di folder Skenario 1 (branch `production`) oleh Dennis + Claude.
Status: backend dan web sudah di-commit dan di-push ke `origin/production` pada 2026-11-19: `72eb777` (slot "teknisi yang
scan" + batalkan semua unit) dan `c4c5202` (gate foto sesudah, popup, notifikasi scan). Perubahan ini baru berlaku di VPS
setelah deploy berikutnya (VPS menarik branch `production`), dan **belum diuji di APK**. Isi catatan ini dari kode backend
dan web; Flutter hanya dibaca, tidak diubah.

Singkatnya: web sudah punya alur baru "scan dulu, foto sebelum, Mulai Job, baru foto sesudah" plus beberapa popup dan
notifikasi. **Backend-nya ikut berubah dan berlaku untuk semua klien termasuk APK**, jadi ada bagian yang harus segera
disesuaikan di mobile (bagian 1), dan ada bagian tampilan yang sebaiknya disamakan dengan web (bagian 2).

---

## 1. Perubahan backend yang langsung memengaruhi APK (cek dulu)

### 1.1 Foto SESUDAH ditolak sebelum Mulai Job
`POST /technician-jobs/:id/findings/:findingId/photos` dengan `kind=sesudah` sekarang **400** kalau job belum
`sedang_dikerjakan` (masih `assigned`, termasuk job yang dialihkan ke teknisi lain lalu kembali ke `assigned`).
Pesan: `Foto sesudah baru bisa diunggah setelah Mulai Job. Scan barcode unit dulu, lalu mulai pekerjaannya.`
- Foto **sebelum** tetap boleh sejak `assigned` (Mulai Job justru mewajibkan minimal satu foto sebelum).
- Berlaku untuk semua peran, termasuk admin. Hapus foto tidak terpengaruh.
- Flutter mengunggah foto lewat `uploadFindingPhoto` (`job_repository.dart`) dan dipanggil dari `_addPhoto`
  (`job_detail_screen.dart`). Saat ini tombol foto sesudah kemungkinan masih aktif sebelum Mulai Job, jadi pengguna APK
  akan kena error 400 ini. **Perlu dikunci di UI** (lihat 2.2). Kalau ada jalur unggah foto offline yang mengantre foto
  sesudah sebelum aksi `start` tersinkron, itu juga akan ditolak: mohon dicek.

### 1.2 Job "slot" tanpa unit (fitur baru: Terima Servis dengan "Jumlah unit, teknisi yang scan")
Admin bisa membuat order N unit tanpa memilih unitnya. Tiap slot adalah `technician_jobs` dengan `unit_id = null`.
- `GET /technician-jobs/:id` dan daftar job mengembalikan `unit: null` untuk slot. `TechnicianJob.fromNest` sudah
  null-safe (`unit?[...]`), jadi tidak crash, tetapi `unitTitle` dan `unitBarcode` jadi kosong. **Tombol Mulai Job harus
  disembunyikan untuk slot** (sekarang `_start` memanggil scan dengan `job.unitBarcode` kosong).
- Untuk slot, backend menolak dengan 400 `Unit belum discan. Scan barcode unit dulu untuk memasukkannya ke pekerjaan ini.`:
  tambah temuan, ubah deskripsi temuan, unggah foto, Kirim Temuan, dan Mulai Job.
- Endpoint baru: `POST /technician-jobs/:id/claim-unit`, body `{ "barcode": "..." }`, role admin/teknisi.
  Respons: `{ ok, jobId, orderId, unitId, barcodeValue, needsData, remainingSlots }`.
  - `jobId` = slot yang terisi. Ini bisa BERBEDA dari `:id` di URL, karena backend mengisi slot kosong pertama milik
    teknisi itu. Setelah sukses, muat ulang seluruh order (job + saudara).
  - `needsData: true` = unit "QR dulu" yang merk/PK-nya belum lengkap (tidak bisa dimulai sebelum dilengkapi lewat Scan Unit).
  - `remainingSlots` = sisa slot kosong milik teknisi itu.
  - Error: 404 `Unit tidak ditemukan / QR tidak valid`; 400 unit milik pelanggan lain
    (`Unit ini terdaftar atas nama pelanggan lain, bukan pelanggan order ini...`); 400 `Unit ini sudah ada di job ini`;
    400 `Tidak ada slot unit yang kosong di order ini. Semua unit sudah terisi.`; 400 bila unit masih punya job aktif lain.
- **Scan pengisi slot sudah dihitung sebagai scan Mulai Job.** Urutannya: scan (claim), foto sebelum, Mulai Job, tanpa
  scan ulang. `GET /technician-jobs/:id` kini mengembalikan field `startScanWaived` (boolean). Kalau `true`, kirim
  `PATCH /technician-jobs/:id/start` **tanpa** `scannedBarcode` (Flutter sudah mengirim `''` di `job_providers.dart`,
  dan itu aman). Field ini hanya ada di detail job, tidak ada di daftar.
- `PATCH /technician-jobs/:id/submit-for-review` dengan `allInOrder: true` (tombol Ajukan Selesai semua unit)
  ditolak 400 selama masih ada slot kosong: `Masih ada N slot unit yang belum discan. Scan unitnya, atau batalkan slot yang tidak dipakai, sebelum diajukan selesai.`
  Tampilkan jumlah slot dan nonaktifkan tombolnya.
- `POST /technician-jobs/:id/add-unit` (Tambah Unit, berlabel maupun "QR dulu") tetap bisa dipakai dari job slot, tetapi
  unit yang ditambah lewat sini menjadi job BARU dan tidak mengisi slot kosong.

### 1.3 Yang TIDAK berubah di backend (sengaja)
- `POST /technician-jobs/:id/send-findings` **tidak** menolak job yang belum dimulai. Pengecekan "sudah discan belum"
  untuk Kirim Temuan hanya dilakukan di web (popup). Alasannya APK juga memanggil endpoint ini dan kami tidak mau
  mengganggunya mendadak. Kalau mau konsisten, mobile cukup meniru pengecekan di sisi klien (2.3). Kalau nanti
  disepakati backend ikut menolak, kabari Dennis.
- Bentuk `start`, `submit-for-review`, dan unggah foto sebelum tidak berubah.

---

## 2. Perilaku yang sebaiknya disamakan di mobile (mengikuti web)

Definisi "unit sudah discan" di web (`scanDone`): job sudah dimulai (status BUKAN `assigned` / `menunggu_penugasan`),
ATAU status `assigned` dengan unit terisi dan `startScanWaived == true`. Job yang dialihkan ke teknisi lain kembali ke
`assigned` dengan `startedAt` masih terisi: tetap dihitung **belum discan** (wajib scan ulang), jadi jangan pakai
`startedAt` sebagai patokan.

### 2.1 Popup saat teknisi membuka halaman job
Muncul **setiap kali** halaman job dibuka selama masih ada unit yang belum discan (status `assigned` dan belum
`scanDone`). Tidak ada "jangan tampilkan lagi". Sekali ditutup, tidak muncul lagi di kunjungan itu; hilang sendiri begitu
semua unit sudah discan. Hanya untuk teknisi. Tombol: "Mengerti". Dua versi:

- **Versi foto dulu** (ada unit berlabel yang belum discan dan belum punya foto sebelum sama sekali; slot tidak
  dihitung karena slot tidak bisa diberi foto sebelum discan):
  Judul `Kirim foto sebelum pengerjaan dulu`. Isi: `Silakan kirim foto sebelum pengerjaan terlebih dahulu, lalu scan unit sebelum Mulai Job. Scroll ke bawah untuk menemukan tombol Mulai Job.`
  Halaman banyak AC menambah awalan `N unit AC belum punya foto sebelum.` dan, bila ada slot,
  ` Unit yang belum diketahui discan dulu lewat panel Aksi Job.`
- **Versi scan** (selain itu): Judul `Silakan scan unitnya terlebih dahulu`. Isi: `Unit AC pada pekerjaan ini belum discan.`
  (banyak unit: `N unit AC pada pekerjaan ini belum discan.`) lalu `Scan barcode unit lewat panel Aksi Job untuk memulai pekerjaan.`
  (slot: `Scan barcode AC di lokasi lewat panel Aksi Job, dan unitnya otomatis masuk ke pekerjaan ini.`) lalu
  `Foto sebelum boleh diunggah lebih dulu, tetapi foto sesudah baru bisa diunggah setelah Mulai Job.`
Di aplikasi, "panel Aksi Job" bisa diganti sebutan layar Flutter yang setara.

### 2.2 Foto sesudah dikunci sampai Mulai Job
Di tiap temuan, tombol unggah foto **sesudah** disembunyikan/dinonaktifkan selama job belum `sedang_dikerjakan`, diganti
petunjuk `Bisa diunggah setelah Mulai Job (scan unit dulu).` Foto sebelum tidak dikunci. Foto yang sudah ada tetap tampil.

### 2.3 Kirim Temuan tetap aktif, tetapi mengecek scan
- Syarat aktif tombol tidak berubah (minimal satu temuan, setiap temuan punya foto sebelum, tidak sedang mengirim).
  **Belum discan tidak menonaktifkan tombol.**
- Saat ditekan dan unit belum discan (`assigned` dan belum `scanDone`): jangan kirim. Buka popup/bottom sheet
  `Scan unit & Mulai Job dulu` berisi: `Temuan baru bisa dikirim setelah unit discan dan job dimulai. Scan barcode unit di bawah lalu tekan Mulai Job, setelah itu tekan Kirim Temuan lagi.`
  (banyak unit: `Temuan untuk <nama unit> baru bisa dikirim ...`), kontrol scan, kode yang terbaca, dan tombol **Mulai Job**
  yang sama dengan tombol Mulai Job di layar. Tombol "Nanti saja" menutupnya.
- Popup menutup sendiri begitu job berhasil dimulai. Kirim Temuan **tidak** terkirim otomatis: teknisi menekannya lagi.
- Halaman banyak AC: popup terikat ke unit yang Kirim Temuan-nya ditekan; ia menutup saat unit itu dimulai.
- Kalau unit sudah discan, Kirim Temuan langsung mengirim seperti biasa.

### 2.4 Notifikasi hasil scan (berhasil dan gagal)
Pencocokan dilakukan di klien dengan pembandingan persis (setelah trim) terhadap barcode unit job; backend memakai aturan
yang sama di `start()`. Kode yang tidak cocok **ditolak saat dibaca** (tidak dimasukkan ke kolom/state).

| Situasi | Notifikasi |
|---|---|
| Kode cocok, di luar popup | `Scan berhasil. Tekan Mulai Job untuk melanjutkan.` |
| Kode cocok, di popup Kirim Temuan | `Scan berhasil. Tekan Mulai Job, lalu silakan kirim temuan.` |
| Banyak unit, kode cocok | sama, ditambah nama unit: `Scan berhasil: <unit>. ...` |
| Mulai Job sukses, dari popup Kirim Temuan | `Scan berhasil, job dimulai. Silakan kirim temuan.` (banyak unit: `... unit dimulai ...`, hanya untuk unit yang memicu popup) |
| Mulai Job sukses, biasa | `Job dimulai.` (banyak unit: `Unit dimulai.`) |
| Kode tidak cocok | `Scan gagal. Barcode tidak sesuai unit pada job ini.` |
| Banyak unit, unit sudah dimulai | `Scan gagal. Unit ini sudah discan/dimulai.` |
| Banyak unit, bukan unit order ini | `Scan gagal. Barcode ini bukan unit pada pekerjaan ini.` |
| Claim slot sukses | `Scan berhasil. Unit masuk ke pekerjaan. Sisa N slot yang belum discan.` atau `... Semua slot sudah terisi.` |
| Claim slot, `needsData` | peringatan: `Data unit ini belum lengkap. Scan QR-nya di Scan Unit dan isi merk + PK sebelum unit bisa dimulai.` |
| Claim slot gagal | `Scan gagal. <pesan dari server>` |
| Tambah Unit berlabel, kode terbaca | `Scan berhasil. Tekan Tambahkan Unit untuk memasukkannya ke job.` (bila keluhan belum diisi: `... Isi pekerjaan/keluhan dulu, lalu tekan Tambahkan Unit.`) |
| Tambah Unit ditolak server | pesan error server (tanpa awalan `Scan gagal.`, karena penolakannya bisa karena sebab lain) |
| Mulai Job ditolak server (foto sebelum belum ada, data unit belum lengkap, dst.) | pesan error server, seperti sebelumnya |

Catatan: `_scanBarcode` di Flutter sudah punya parameter `accepted`; sesuaikan teks gagalnya dengan tabel ini bila berbeda.

### 2.5 Tampilan slot "teknisi yang scan"
Selama `unit == null`: kartu pengganti `Tipe menunggu discan, silakan scan dulu untuk memasukkan ke pekerjaan.` dengan
keterangan kecil `Detail unit, temuan, dan foto sebelum/sesudah muncul setelah unitnya discan.` Sembunyikan Detail Unit,
temuan, foto, dan Kirim Temuan. Panel aksi berisi scanner yang memanggil `claim-unit` (bukan `start`), ditambah tombol
Tambah Unit AC. Slot yang dibatalkan admin: `Slot unit ini dibatalkan sebelum discan.` Setelah slot terisi, tampilannya
sama dengan unit biasa dan Mulai Job tanpa scan ulang (`startScanWaived`, lihat 1.2). Di antrian/daftar, slot tampil
`Unit menunggu discan`.

---

## 3. Tidak perlu di mobile (kecuali mobile juga punya fiturnya)
- **Laporan > Performa Teknisi**: rentang tanggal pilihan sendiri. Halaman laporan admin, web saja.
- **Form Terima Servis**: kartu "Jumlah unit, teknisi yang scan" (`scanUnitCount` di `POST /service-orders/intake`).
  `POST /service-orders` yang dipakai Flutter tidak menerimanya; yang dibuat Flutter tetap order biasa.
- **Batalkan semua unit** dalam satu order banyak AC (`PATCH /technician-jobs/:id/cancel` dengan `allInOrder: true`,
  admin). Tidak perlu kecuali mobile punya layar admin untuk membatalkan job.

---

## 4. Titik kode untuk dikerjakan

Flutter (`frontend/mobile/lib`; nomor baris perkiraan, bisa bergeser):
- `features/jobs/job_detail_screen.dart`: `_start` (~81), `_startUnit` (~95), `_addPhoto` (~1766), bar Kirim Temuan (~1920).
- `features/jobs/job_providers.dart`: `sendFindings` (~166), pemanggilan `start` (~427).
- `data/repositories/job_repository.dart`: `uploadFindingPhoto` (~358), `fetchFindings` (~348).
- `data/models/technician_job.dart`: `fromNest` (~231). Tambahkan `startScanWaived` dari detail job.
- `features/jobs/add_unit_sheet.dart`: notifikasi scan untuk Tambah Unit.
- Perlu endpoint baru `claim-unit` di repository, dan daftar job perlu menangani `unit == null`.

Acuan perilaku di web (`Nest/epos-frontend-web/src/app/(dashboard)/teknisi/jobs/[id]/`):
- `job-detail-client.tsx`: `ScanUnitReminderDialog` (2.1), `StartJobDialog` + `startControls` (2.3), `handleScan`/`handleDetect` (2.4),
  `FindingCard` dengan `afterLocked` (2.2), `useClaimUnit` dan kartu slot (2.5).
- `service-pricing-card.tsx`: `SendFindingsBar` (`needsScan`/`onNeedScan`).
- `add-unit.tsx`: notifikasi scan Tambah Unit.

Acuan backend (`Nest/epos-backend/src/technician-jobs/`): `technician-jobs.service.ts` (`addFindingPhoto`, `claimUnit`,
`claimScanCounts`, `findOne` untuk `startScanWaived`), `technician-jobs.controller.ts` (`claim-unit`).
Tes yang menjelaskan perilakunya: `technician-jobs.photo-gate.spec.ts`, `technician-jobs.claim-unit.spec.ts`.

## 5. Cara menguji di APK
1. Job biasa `assigned`: foto sebelum bisa, foto sesudah terkunci; popup muncul tiap job dibuka.
2. Belum ada foto sebelum: popup versi foto. Sudah ada foto sebelum, belum scan: popup versi scan.
3. Tekan Kirim Temuan sebelum scan: popup scan + Mulai Job muncul; scan kode salah (notif gagal), lalu kode benar, Mulai Job,
   notif `Scan berhasil, job dimulai. Silakan kirim temuan.`, lalu Kirim Temuan lagi.
4. Setelah Mulai Job: foto sesudah terbuka.
5. Order slot (buat dari web, isi "Jumlah unit, teknisi yang scan"): scan unit milik pelanggan itu terisi ke slot; scan unit
   pelanggan lain ditolak; scan sekali cukup, tidak perlu scan ulang untuk Mulai Job; Ajukan Selesai semua ditahan bila
   masih ada slot kosong.
6. Setelah mobile selesai, naikkan versi dan rilis APK lewat `GET /app-version` (`Nest/setup-apk-hosting.sh`) seperti rilis
   sebelumnya.

---

## 7. Tambahan 2026-11-24: multi lokasi member (satu member, banyak kantor, satu nomor HP)

Status: sudah dikerjakan di backend dan web (folder Skenario 1), **belum di-commit/di-push** saat catatan ini ditulis, dan
migrasinya (`20261124000000_member_locations`) belum diterapkan ke database mana pun. Belum diuji di APK.

**Konsepnya.** Member punya saklar `multiLocation` (bawaan mati; mati = perilaku lama, mobile tidak terpengaruh).
Menyala = satu member bisa punya AC di beberapa tempat. **Lokasi 1 = alamat utama member** (`address` + `mapsUrl`, namanya
`mainLocationName`, bawaan "Lokasi 1"); lokasi lain ada di `locations[]` (nama, alamat, link Maps). Unit AC punya
`locationId` (null = Lokasi 1). Order servis punya `locationId` (lokasi pekerjaan, dipilih admin saat Terima Servis).

**Perubahan kontrak API yang perlu diketahui mobile:**
- `GET /members/:id`: tambahan field `multiLocation`, `mainLocationName`, `locations[]` (`id`, `name`, `address`, `mapsUrl`);
  tiap unit di `acUnits[]` punya `locationId` dan `location` (`{id, name}` atau null = Lokasi 1).
- `POST /service-orders/intake` (Terima Servis): untuk member multi lokasi **wajib** body `locationId` = `'utama'` (Lokasi 1)
  atau id lokasi tambahan. Tanpa itu: 400 `Pilih lokasi dulu: member ini memakai multi lokasi`. Unit existing yang dipilih harus di
  lokasi itu (400 `Unit ini terdaftar di lokasi "A", bukan lokasi pekerjaan ini ("B")...`); unit baru dan slot yang discan
  teknisi otomatis ikut lokasi itu; `locations[]` (titik lokasi kerja manual) ditolak untuk member multi lokasi. Member baru
  boleh menyalakan saklar lewat `customer.multiLocation` (+ `customer.mainLocationName`); otomatis Lokasi 1. Mengirim
  `locationId` untuk member biasa ditolak.
  (Flutter TIDAK memakai endpoint intake ini: APK membuat order lewat `POST /service-orders`, lihat butir terakhir.)
- Teknisi tidak memilih lokasi: **Tambah Unit** (`POST /technician-jobs/:id/add-unit`, berlabel atau "QR dulu") dan scan pengisi
  slot (`claim-unit`) mengikuti lokasi pekerjaan order. Unit berlabel dari lokasi lain ditolak dengan pesan yang sama seperti
  di atas (tampilkan pesan server apa adanya). Unit "QR dulu" yang dibuat teknisi otomatis di lokasi order.
- `GET /technician-jobs/:id` mengembalikan `locationName` (nama lokasi pekerjaan; null bila member tidak multi lokasi),
  untuk ditampilkan di detail job ("Lokasi Pekerjaan"). Alamat/Maps kerja tetap lewat `workAddress`/`workMapsUrl` job.
- Pengingat WA: baris unit kini menyebut lokasi untuk member multi lokasi (`- Daikin 1PK (Kantor Lama - Ruang Rapat)`),
  tanpa perubahan di mobile.
- Label QR: `GET /unit-labels/data` dan `GET /technician-jobs/:id/unit-labels` menambah `locationName` (nama lokasi unit/order;
  null bila member tidak multi lokasi); alamat label memakai alamat lokasi itu. Web mencetak baris "Lokasi: <nama>" di semua
  stiker. Nama lokasi hanya tulisan di stiker, bukan isi QR (isi QR tetap kode unit); kalau unit dipindah lokasi, stikernya
  perlu dicetak ulang. Jika APK mencetak label sendiri (`unit_label_pdf.dart`), baris lokasi itu bisa ditambahkan dari `locationName`.
- Endpoint baru (web admin/kasir, mobile tidak wajib): `POST/PATCH/DELETE /members/:id/locations`,
  `POST /members/:id/units/move-location`.
- `POST /service-orders` (form "Buat Order" Flutter: pilih member + banyak unit): **sudah disesuaikan di backend, Flutter tidak
  perlu diubah.** Untuk member multi lokasi, lokasi order DITURUNKAN dari unit yang dipilih: semua unit satu lokasi = order
  dan alamat/Maps kerja job otomatis ikut lokasi itu; unit campur lokasi ditolak 400
  `Unit yang dipilih berada di lokasi berbeda (A, B). Buat order terpisah untuk tiap lokasi.` (tampilkan pesan server apa
  adanya). Member biasa tidak berubah.
  Opsional di sisi mobile (peningkatan tampilan, bukan keharusan): di form "Buat Order" kelompokkan/saring daftar unit per
  lokasi (`GET /members/:id` sudah memberi `locationId`/`location` tiap unit dan `locations[]`), supaya admin tidak
  menemui penolakan "lokasi berbeda" setelah menekan tombol.
- `POST /ac-units` (form unit Flutter) belum menerima lokasi: unit baru untuk member multi lokasi masuk Lokasi 1; admin
  memindahkannya lewat web (Pindahkan ke lokasi).

---

## 8. Tambahan 2026-11-24: hapus unit AC (data "sampah" yang belum terdata)

Status: dikerjakan di backend dan web (Skenario 1), **belum di-commit/di-push**. Tidak ada perubahan skema.

- **Hapus otomatis saat job dibatalkan** (`PATCH /technician-jobs/:id/cancel`, termasuk `allInOrder`): unit ikut terhapus
  HANYA bila status `menunggu_data` (tipe belum terisi, "QR dulu"), QR belum pernah discan (`labelAttachedAt` kosong), dibuat
  bersamaan dengan job itu (Terima Servis / Tambah Unit, bukan unit lama dari Input Data Lampau), dan job itu satu-satunya job
  unitnya. Respons pembatalan menambah `deletedUnitCount` (0 atau 1; untuk `allInOrder` jumlahnya). Job yang dibatalkan tetap
  ada dengan `unit: null` (Flutter sudah null-safe untuk `unit`). Tidak ada yang wajib diubah di mobile; bila APK punya
  konfirmasi pembatalan, boleh ditambah kalimat "unit QR dulu yang belum terisi ikut dihapus" dan menampilkan `deletedUnitCount`.
- **Hapus manual (admin)**: `POST /ac-units/delete` body `{ unitIds: [...] }` (maks 200). Unit tanpa job aktif dan tanpa
  riwayat servis selesai dihapus; yang lain dilewati. Respons `{ ok, deleted, deletedIds, skipped: [{ id, barcodeValue, label,
  reason }] }`. Baris unit di order dan usulan koreksi ikut dibersihkan, `members.total_ac_units` dikurangi, audit `ac_unit.delete`.
  Di web: halaman member (centang unit, Hapus unit) dan tab Label QR di Input Data Lampau. Mobile tidak wajib punya fitur ini.
