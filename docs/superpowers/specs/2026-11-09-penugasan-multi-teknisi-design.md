# Penugasan Beberapa Teknisi per Job + Deteksi Teknisi Sibuk

Tanggal: 2026-11-09 · Lingkup: backend Nest, web admin, aplikasi mobile.

## Latar belakang & tujuan

Sekarang satu job hanya punya satu teknisi (`technician_jobs.technician_id`). Form Terima Servis di web
(`intake-client.tsx`) dan semua layar penugasan memakai satu dropdown. Pekerjaan yang dikerjakan
beberapa teknisi sekaligus tidak bisa diwakili.

Tujuan:
1. Admin/kasir bisa memilih **beberapa teknisi** untuk **satu job**. Semuanya **setara**: sama-sama melihat
   job di aplikasinya dan sama-sama boleh mengerjakannya (mulai, kirim temuan, foto, ajukan review).
2. Saat memilih teknisi, sistem **mendeteksi teknisi yang sedang mengerjakan job lain** dan memberi
   **peringatan** sebelum admin melanjutkan. Teknisi tetap boleh dipilih.

## Bukan tujuan

- Tidak ada teknisi utama/pendamping, tidak ada hierarki peran antar teknisi.
- Tidak ada pembagian komisi/upah per teknisi.
- Tidak melarang memilih teknisi yang sibuk (hanya peringatan).

## Anti-tujuan (dianggap gagal walau "jalan")

- Teknisi pendamping tidak melihat job atau tombolnya terkunci karena guard lama `job.technicianId === saya`.
- Aplikasi mobile versi lama (1.0.8 dan sebelumnya) rusak karena bentuk respons berubah.
- Peringatan sibuk memuat data job teknisi lain ke peran yang tidak berhak.

## Keputusan yang sudah diambil bersama

- Semua teknisi setara (sama-sama melihat dan mengerjakan).
- Teknisi sibuk = punya job berstatus `sedang_dikerjakan`. Job `assigned` (belum dimulai) dan
  `menunggu_review` tidak dihitung sibuk.
- Teknisi sibuk tetap boleh dipilih; sistem menampilkan peringatan dulu (menyebut job apa yang sedang dikerjakan).
- Dikerjakan di web **dan** mobile (backend ikut berubah).
- Pilihan banyak teknisi berlaku di SEMUA tempat teknisi dipilih: Terima Servis/Buat Order Servis, alih tugas di
  detail job, checkout POS (tiap baris pemasangan), dan dialog job komplain.
- Saat **membuat servis baru** (Terima Servis di web, Buat Order Servis di mobile) sudah bisa memilih
  beberapa teknisi sekaligus; set yang sama dipasang ke semua unit/job di order itu.

## Rancangan (pilihan saya, belum disetujui)

### Data
- Tabel baru `technician_job_assignees` (`job_id`, `technician_id`, `created_at`; unik per pasangan; indeks di
  `technician_id`). Berisi SEMUA teknisi job, termasuk yang pertama.
- Kolom `technician_jobs.technician_id` **dipertahankan** sebagai teknisi pertama. Kode lama (tagihan, laporan,
  WA, alih tugas, aplikasi lama) tetap jalan tanpa diubah. Selalu sama dengan teknisi pertama di tabel baru.
- Migrasi mengisi tabel baru dari semua job yang `technician_id`-nya tidak kosong.

### Backend
- Guard akses (`assertOwnerOrAdmin`, `material-requests`, `offline-sync`, `ac-units` baris ~487, dst.): ganti
  "technicianId sama dengan aktor" menjadi "aktor ada di assignees job itu". Admin tetap lolos.
- Query teknisi (`mine`, `myQueue`, `todayBundle`, `history`, dan filter job per unit): pakai
  `assignees: { some: { technicianId } }`, sehingga pendamping juga melihat job di antrean, daftar, dan riwayat.
- `PATCH /technician-jobs/:id/assign`, `intake`/`create service order`, `checkout` POS (`technicianId` per baris
  pemasangan, `pos.service.ts` ~777-810, `checkout.dto.ts`), dan `create-complaint.dto.ts` (`technicianId`
  nullable): terima `technicianIds: string[]`
  (maks 5, tiap id harus user `teknisi` aktif, tanpa duplikat). Field lama `technicianId` tetap diterima
  (dianggap daftar berisi satu) supaya aplikasi lama tidak rusak. Semantik = **set penuh pengganti**.
  `allInOrder` tetap berlaku: set yang sama dipasang ke semua job order itu.
- Respons job menambah `technicianIds` + `technicians[{id,displayName}]`; `technicianId` lama tetap ada.
- Notifikasi `job_assigned` dikirim ke tiap teknisi yang baru masuk; yang dikeluarkan tidak dinotifikasi
  ulang kecuali perilaku lama alih tugas mengharuskannya.
- Riwayat alih tugas (`job_handovers`): tetap dicatat bila tepat satu teknisi digantikan satu teknisi lain
  (perilaku lama). Perubahan set lain dicatat di audit log (sebelum/sesudah).
- Endpoint baru `GET /technician-jobs/technician-workload` (admin & kasir saja): per teknisi aktif, daftar job
  `sedang_dikerjakan` (id, nama pelanggan, lokasi/unit ringkas). Tidak memuat harga atau data finansial.
- Start serentak: dua teknisi menekan "mulai" hampir bersamaan harus idempoten (yang kedua tidak error
  dan tidak membuat transisi ganda).

### Web
- Form Terima Servis: dropdown satu teknisi diganti pilihan banyak teknisi (daftar centang). Tiap teknisi
  yang sibuk diberi tanda. Saat memilih teknisi sibuk muncul dialog konfirmasi: "X sedang mengerjakan
  job Y di Z. Tetap tugaskan?" (lanjut / batal).
- Halaman detail job (alih tugas, `handover.tsx`) dan dialog komplain (`complaint-dialog.tsx`): pilihan banyak
  dengan peringatan yang sama.
- Tampilan job (daftar, detail, antrean teknisi) menampilkan semua nama teknisi.

### Mobile
- Model `TechnicianJob` menambah `technicianIds`/nama teknisi. Semua pengecekan
  `job.technicianId == user.uid` (mis. `job_requests_section.dart`) diganti "uid ada di `technicianIds`".
- Layar admin/kasir di mobile (`service_order_create_screen.dart`, alih tugas di `job_detail_screen.dart`,
  checkout POS `checkout_screen.dart`/`cart_state.dart`/`pos_providers.dart`, dialog komplain): pilihan
  banyak teknisi + peringatan sibuk yang sama.
- Rilis APK baru (versi dinaikkan lewat alur "build" yang sudah ada). Sebelum semua teknisi memperbarui,
  pendamping yang memakai APK lama tetap melihat job tetapi tombolnya bisa terkunci; ini diterima sementara.

### Keamanan
- Otorisasi tetap di backend (bukan di klien): semua guard baru berbasis keanggotaan assignees.
- Validasi `technicianIds`: role `teknisi`, aktif, tanpa duplikat, maksimal 5.
- Endpoint beban kerja dibatasi peran admin/kasir; teknisi tidak boleh melihat job teknisi lain lewat sini.
- Migrasi dijalankan lewat skrip deploy oleh Anda (saya hanya menyiapkan berkas migrasi dan menguji).

### Pengujian
Tes backend untuk: guard pendamping boleh/orang luar ditolak, assign set penuh (tambah/kurangi), kompatibilitas
`technicianId` lama, workload hanya `sedang_dikerjakan`, start serentak idempoten. Tes widget mobile untuk
tampilan job bersama. Tes web minimal untuk dialog peringatan.

## Laporan dan riwayat per teknisi (diputuskan)

Job bersama dihitung untuk **semua teknisi** di job itu, baik di riwayat aplikasi maupun di laporan
"performa teknisi" (`reports.service.ts`, kini hanya `COUNT` job selesai per `technician_id`; diubah menjadi
join ke `technician_job_assignees`). Angka total job (per status, rata-rata waktu) tetap per job, tidak
dobel; hanya baris per teknisi yang bisa berjumlah lebih dari total job.

## Keputusan yang masih terbuka

Tidak ada. Menunggu persetujuan dokumen ini sebelum rencana kerja dibuat.

## Diserahkan ke pembuat

Penamaan, tata letak komponen, teks peringatan persisnya, dan urutan pengerjaan (backend → web → mobile).
