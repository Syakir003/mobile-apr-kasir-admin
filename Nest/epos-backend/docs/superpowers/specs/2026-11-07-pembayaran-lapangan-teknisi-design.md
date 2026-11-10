# Pembayaran Lapangan Teknisi, Tanda Terima, dan Setoran Harian

Tanggal: 2026-11-07. Status: **spesifikasi (belum dikerjakan, belum ada kode)**. Disimpan untuk dikerjakan nanti.

## Tujuan

Menggantikan lembar "Laporan Pekerjaan" kertas dengan alur di aplikasi: admin menetapkan jasa dan harga di depan, teknisi menagih di lokasi dan mencatatnya, pelanggan menerima bukti singkat lewat WhatsApp, lalu sore harinya admin mencocokkan uang setoran dengan catatan aplikasi. Invoice lunas hanya setelah admin memverifikasi.

Kertas tidak dihapus untuk keadaan tanpa sinyal: teknisi tetap membawa lembar laporan dan memakainya sebagai bukti ke pelanggan bila aplikasi tidak bisa mengirim WA.

## Keputusan yang sudah dibuat

| Topik | Keputusan |
|---|---|
| Penugasan | Tetap dari admin. Unit yang ditugaskan = isi laporan ("Cuci AC 1 Unit Daikin, Cuci AC 1 Unit Gree"). |
| Harga awal | Admin menetapkan jasa + harga + transport di depan (Terima Servis atau halaman job). Untuk perbaikan, ini harga **perkiraan**. |
| Edit oleh teknisi | Hanya memilih jasa dari **katalog** dan mengubah **jumlah**. Harga satuan katalog dikunci. Jasa di luar katalog masuk sebagai **"jasa lain"** (nama + harga + alasan) dan ditandai. Setiap penyesuaian wajib beralasan. |
| Metode bayar | Semua: tunai, transfer, QRIS, e-wallet, debit. |
| Bukti di lokasi | **Tanda Terima**: dokumen terpisah dari Faktur, dikirim lewat WA dari **nomor toko** (backend, Fonnte). Pesannya pendek. |
| Faktur | Tetap dikirim admin (WA berlink, sudah ada). Jadi pelanggan memegang dua bukti: Tanda Terima (teknisi) dan Faktur (admin). |
| Pelanggan ditagih belakangan | Tetap ada, ditandai per order: **Bayar di lokasi** atau **Ditagih admin**. |
| Tanpa sinyal | Teknisi memakai laporan kertas sebagai bukti ke pelanggan. Tidak ada antrean offline untuk pembayaran. Admin mencatat pembayaran dari kertas itu saat setoran (lihat "Pencatatan dari kertas"). |
| Lunas | Hanya setelah admin memverifikasi (setoran tunai cocok, atau mutasi non-tunai cocok). |

## Alur

1. Admin membuat order (Terima Servis) dan mengisi **Jasa & Harga Perkiraan** serta penanda pembayaran (Bayar di lokasi / Ditagih admin). Invoice terbentuk lewat `ServicePricingService.set`.
2. Teknisi membuka job. Ia melihat daftar jasa, jumlah, transport, sparepart yang sudah disetujui, dan total (hanya baca, tanpa harga beli atau margin).
3. Di lokasi teknisi boleh menyesuaikan jasa (aturan di bawah). Perubahan tersimpan beserta alasan dan ditandai "diubah teknisi" untuk admin.
4. Pekerjaan selesai, teknisi menagih. Ia menekan **Catat Pembayaran**: nominal, metode, foto bukti. Hasilnya satu `FieldPayment` dan satu Tanda Terima bernomor.
   - Tunai: status `dipegang_teknisi`.
   - Non-tunai: status `menunggu_cocok`.
5. Tombol **Kirim Tanda Terima** terbuka. Backend mengirim WA pendek dari nomor toko ke pelanggan.
6. Teknisi **Ajukan Selesai** (alur job existing). Untuk order Bayar di lokasi, pembayaran harus tercatat atau ada alasan "belum bisa bayar" (lalu admin menagih).
7. Sore: teknisi menyerahkan uang tunai. Admin membuka halaman **Setoran**, memilih teknisi + tanggal, mencocokkan, memverifikasi. Pembayaran yang diverifikasi menjadi `ManualPayment` pada invoice, sehingga status invoice dihitung ulang (pas = lunas).
8. Admin mengirim Faktur (WA berlink, tombol existing).

## Aturan penyesuaian jasa oleh teknisi

- Boleh: ubah jumlah baris yang ada, tambah baris dari katalog (harga = `Service.basePrice`, terkunci), hapus baris, tambah "jasa lain".
- Tidak boleh: mengubah harga satuan baris katalog, mengubah transport, memberi diskon.
- "Jasa lain": nama, harga, alasan wajib; tersimpan dengan penanda `isCustom`.
- Alasan wajib untuk setiap penyimpanan yang mengubah total dari angka admin. Alasan dan selisih (sebelum → sesudah) masuk audit `job.tech_edit_lines`.
- Tanpa persetujuan di muka (teknisi harus bisa menagih saat itu juga). Admin melihat penanda "Diubah teknisi: ±Rp … (alasan)" di halaman job dan antrean, dan bisa mengoreksi sebelum setoran.
- Terkunci untuk teknisi begitu ada `FieldPayment` aktif di order itu (Tanda Terima sudah beredar). Koreksi selanjutnya hanya oleh admin.
- Harga satu untuk seluruh order (aturan existing servis banyak AC): teknisi mengedit di tingkat order, bukan per unit.
- Job komplain tidak punya tagihan, jadi tidak ada UI harga atau pembayaran.

## Data (usulan, migrasi baru; jangan ubah migrasi lama)

**`service_orders`** tambah:
- `payment_mode`: `bayar_di_lokasi` | `ditagih_admin` (bawaan DB dan API = `ditagih_admin` supaya order lama, pemasangan POS, dan app Flutter lama yang tidak mengirim field ini tidak kena gerbang pembayaran; form web Terima Servis memilih `bayar_di_lokasi` secara eksplisit).

**`job_service_lines`** tambah:
- `source`: `admin` | `teknisi`
- `is_custom` boolean (jasa lain)
- `change_reason` text null

**`technician_jobs`** tambah (atau pada order, lihat catatan): `tech_price_edited_at`, `tech_price_edit_reason`, `price_before_tech_edit` (total admin sebelum diubah) untuk penanda di sisi admin.

**`field_payments`** (baru):
- `id`, `invoice_id`, `order_id`, `recorded_by` (teknisi atau admin), `on_behalf_of_technician_id` (bila admin mencatat dari kertas)
- `method`, `amount`, `proof_url`
- `status`: `dipegang_teknisi` | `menunggu_cocok` | `diverifikasi` | `ditolak`
- `receipt_number` unik (`TT-YYYYMMDD-NNNN`, counter sendiri)
- `receipt_channel`: `wa` | `kertas` ; `receipt_sent_at`, `receipt_wa_log_id`, `paper_report_no` (opsional)
- `client_ref` unik (idempotensi bila request terkirim dua kali)
- `settlement_id` null, `manual_payment_id` null (terisi saat diverifikasi)
- `reject_reason` null, `created_at`

**`cash_settlements`** (baru): `id`, `technician_id`, `business_date` (WIB), `expected_total`, `received_total`, `difference`, `note`, `created_by` (admin), `created_at`.

**`technician_cash_balances`** atau kolom pada settlement: selisih yang belum terselesaikan per teknisi (kurang setor / lebih setor) dengan `resolved_at`, `resolve_note`. Bentuk final dipilih saat implementasi; yang penting ada riwayat dan saldo berjalan per teknisi.

**Enum `WhatsappMessageKind`** tambah `tanda_terima`. `WhatsappService.sendInvoiceMessage` saat ini mengunci `kind: invoice`; perlu dibuat menerima `kind` (pengirim = teknisi, `sentById`).

Catatan penghubung: `ManualPayment` (sudah ada, `method`, `amount`, `proofUrl`, `createdById`, `shiftId`) dipakai apa adanya sebagai catatan pelunasan resmi. `ManualPayment.shiftId` dibiarkan null untuk pembayaran dari setoran (uang tidak lewat laci kasir, jadi laporan shift tidak berubah).

## Perilaku inti

- **Pembayaran lapangan tidak menyentuh invoice** sampai diverifikasi: `totalPaid` dan `status` tetap. Ini beda dari `PaymentsService.record` yang langsung menerapkan. Logika apply-ke-invoice dari `record` perlu dipecah menjadi fungsi dalam transaksi yang bisa dipanggil ulang oleh verifikasi setoran.
- Batas nominal: `amount ≤ sisa tagihan − total FieldPayment aktif (belum ditolak)`. Bayar sebagian (DP) boleh dengan catatan.
- **Penjaga ganda bayar**: `PaymentsService.record` (admin/kasir) menolak atau memperingatkan bila invoice punya FieldPayment aktif yang membuat sisa efektif tidak cukup, supaya uang yang sama tidak masuk dua kali.
- Tanda Terima: satu per `FieldPayment`; kirim ulang boleh oleh teknisi pencatatnya. Gagal kirim terlihat di aplikasi dengan opsi kirim ulang atau pakai kertas.
- Pelanggan tanpa nomor HP valid: tombol kirim tidak tersedia, saluran otomatis `kertas`.
- Alih tugas setelah ada pembayaran: boleh; FieldPayment tetap milik pencatatnya (uangnya ada di dia).
- **Job dibatalkan → invoice otomatis dibatalkan (void, bukan dihapus)**. Syarat: semua job di order itu `dibatalkan`, `totalPaid = 0`, tidak ada FieldPayment aktif, dan order bukan pemasangan POS. Invoice diberi status `batal` (nilai enum sudah ada, belum dipakai kode mana pun), nomor dan riwayatnya tetap ada, alasan masuk audit `invoice.void_on_cancel`. Struk publik invoice itu menampilkan "Dibatalkan". Daftar piutang, dasbor, dan laporan harus mengecualikan `batal` (perlu diperiksa satu per satu saat implementasi).
- Batalkan job dengan FieldPayment yang belum diverifikasi/ditolak, atau invoice yang sudah punya pembayaran: ditolak sampai admin menyelesaikannya (sistem belum punya refund).
- Approve complete tetap tidak mengecek status pembayaran (aturan existing). Yang bertambah hanya peringatan di UI admin bila masih ada uang dipegang.

### Isi Tanda Terima (WA, singkat)

Satu pesan, tanpa tautan:

```
Tanda Terima TT-20261107-0012
AYUB AC menerima Rp 150.000 (Tunai) dari Bu Sari
untuk Cuci AC 2 unit, 7 Nov 2026. Teknisi: Budi.
Faktur menyusul dari admin.
```

Teks bawaan di kode (konstanta) dulu; boleh dibuat bisa diedit di tab Template Pesan belakangan.

## Setoran harian (halaman admin)

- Pilih teknisi + tanggal. Tampil daftar `FieldPayment` `dipegang_teknisi` milik teknisi itu (order, pelanggan, nominal, foto, jam) dan total yang seharusnya.
- Admin mencentang yang diserahkan, mengisi **uang diterima**. Bila sama dengan total tercentang: verifikasi semua → buat `ManualPayment` → invoice dihitung ulang (pas = lunas, sebagian = dp).
- Hasil input setoran:
  - **Pas** → tombol **Selesai**.
  - **Kurang** → dua pilihan: **Catat kurang** (selisih menjadi saldo kurang-setor teknisi yang terbuka) atau **Selesai dengan alasan** (paksa selesai: alasan konkret wajib diisi, selisih ditutup dan tidak menjadi saldo).
  - **Lebih** → **Catat lebih** (saldo lebih-setor) atau **Selesai dengan alasan**.
  - Pembayaran yang dicatat teknisi tetap diverifikasi **penuh** (pelanggan sudah membayar penuh, jadi invoice lunas). Kekurangan adalah utang teknisi ke toko, bukan utang pelanggan.
  - Saldo kurang-setor dilunasi lewat aksi **Terima pelunasan selisih** (admin mencatat uang yang disetor belakangan; saldo berkurang, riwayat tetap).
  - "Selesai dengan alasan" hanya admin, alasan minimal 10 karakter, masuk audit `settlement.difference_closed`. Laporan Uang di Teknisi menampilkan jumlah dan total rupiah selisih yang ditutup dengan alasan per teknisi, supaya pola yang berulang terlihat.
- Pembayaran yang tidak tercentang tetap `dipegang_teknisi` (umurnya bertambah).
- **Cocokkan mutasi** (non-tunai): daftar `menunggu_cocok` dengan foto bukti; admin menekan Cocok (jadi `ManualPayment`) atau Tolak (alasan wajib; teknisi diberi tahu; invoice tetap belum dibayar, admin menangani pelanggan secara manual karena Tanda Terima sudah terkirim).
- **Cek sparepart kembali**: untuk setiap teknisi dan tanggal, tampil sparepart dari pengajuan yang disetujui (disetujui, terpakai, **harus kembali = disetujui − terpakai**). Admin mencentang yang diterima dan menulis catatan bila ada yang kurang. Murni daftar periksa: stok sudah kembali tersedia saat lapor terpakai (`markUsed`), jadi tidak ada pergerakan stok baru. Data dari `material_request_items` (`qty`, `qty_used`).
- **Pencatatan dari kertas**: admin dapat membuat FieldPayment atas nama teknisi (nominal, metode, foto/nomor kertas, `receipt_channel = kertas`) untuk kasus tanpa sinyal, lalu diverifikasi dalam alur yang sama.
- Laporan "Uang di Teknisi": saldo dipegang, umur (hari), selisih berjalan per teknisi. Cron 09:00 WIB memberi notifikasi admin bila ada uang dipegang lebih dari satu hari (tipe `cash_overdue`, dedupe per admin per hari, pola sama dengan `service_due`).

## Hak akses (usulan)

| Aksi | Admin | Kasir | Teknisi |
|---|---|---|---|
| Tetapkan harga awal | ya | ya (existing) | tidak |
| Lihat harga jasa job miliknya | ya | ya | **baca saja (baru)** |
| Sesuaikan jasa dengan aturan di atas | ya | ya (existing, bebas) | **ya, terbatas (baru)** |
| Catat dan kirim Tanda Terima | ya (atas nama) | tidak | ya (job miliknya) |
| Verifikasi setoran / cocokkan mutasi | ya | tidak | tidak |

Kepemilikan tetap diambil dari JWT `sub`. Tidak ada harga beli atau margin yang dikirim ke teknisi.

## API (usulan, nama final saat implementasi)

Teknisi:
- `GET /technician-jobs/:id/service-pricing` — izinkan teknisi pemilik job (baca saja, tanpa field internal).
- `PATCH /technician-jobs/:id/service-lines` — penyesuaian terbatas + alasan.
- `POST /technician-jobs/:id/field-payments` — body `{ method, amount, proofUrl, note?, clientRef }`.
- `POST /field-payments/:id/send-receipt`
- `GET /field-payments/mine?status=`

Admin:
- `POST /service-orders/intake` — tambah `serviceLines[]`, `transportLevel`, `paymentMode` (opsional bertahap).
- `PATCH /service-orders/:id` — boleh mengubah `paymentMode`.
- `GET /settlements/pending?technicianId=&date=`
- `POST /settlements` — `{ technicianId, paymentIds[], receivedTotal, note }`
- `POST /field-payments/:id/verify` | `/reject` (non-tunai)
- `POST /technician-jobs/:id/field-payments` oleh admin dengan `onBehalfOfTechnicianId` (dari kertas)
- `GET /reports/technician-cash` — saldo dan umur.

Realtime: emit ke admin saat FieldPayment dibuat (pola `invoice.updated`).

## Audit

`job.tech_edit_lines`, `field_payment.create`, `field_payment.receipt_sent`, `field_payment.verify`, `field_payment.reject`, `settlement.create`, `settlement.difference`.

## Dampak ke aturan yang sudah ada

- "Harga jasa BUKAN syarat teknisi mengajukan selesai" tetap benar secara teknis, tetapi untuk order Bayar di lokasi ada syarat baru: pembayaran tercatat atau alasan tertulis.
- "Status pembayaran tidak pernah dicek saat admin approve" tidak berubah.
- Harga jasa yang tadinya hanya terlihat admin/kasir kini terlihat teknisi (baca saja).
- Invoice kini sudah ada sebelum pekerjaan selesai (dibuat di depan oleh admin), sehingga invoice `belum_dibayar` untuk job yang belum jadi tampil di piutang/dasbor. Saat ini `cancel()` hanya menghapus baris tagihan job dari invoice (total jadi Rp 0 dan status dihitung `lunas`, sisa invoice kosong), tanpa status `batal`. Keputusan: invoice dibatalkan otomatis (lihat "Perilaku inti").
- Omzet punya tiga definisi berbeda di sistem; pembayaran baru masuk hitungan hanya setelah menjadi `ManualPayment`, jadi tidak menambah definisi baru.

## Catatan setelah penugasan banyak teknisi (Syakir, 2026-11-09)

Satu job kini bisa dipegang sampai 5 teknisi setara (`technician_job_assignees`; `technician_jobs.technician_id` = teknisi pertama). Pengaruh ke spesifikasi ini:

- "Teknisi pemilik job" berarti **salah satu assignee** (pakai `isJobAssignee` / `assignedTo` dari `technician-jobs/job-assignees.ts`), bukan `technicianId`.
- `FieldPayment.recorded_by` = teknisi yang benar-benar menagih. **Uang dipegang oleh perekam**, bukan teknisi pertama job, dan setoran dikelompokkan per perekam.
- Beberapa teknisi satu job tetap menghasilkan satu invoice dan satu pembayaran per kejadian tagih. Perlu aturan agar dua teknisi tidak mencatat pembayaran yang sama: sisa tagihan efektif sudah memperhitungkan FieldPayment aktif (lihat "Perilaku inti"), dan UI menampilkan siapa yang sudah mencatat.
- Tanda Terima menyebut nama perekam saja.
- Penyesuaian jasa oleh teknisi: siapa pun assignee boleh; terkunci setelah ada FieldPayment aktif (aturan sama).

## Tahapan

1. **Backend + web admin**: skema, harga di depan (intake), aturan edit teknisi, FieldPayment, Tanda Terima WA, halaman Setoran + Cocokkan Mutasi + dari kertas, notifikasi `cash_overdue`, spec tes jest.
2. **Web teknisi** (halaman job teknisi): lihat harga, edit terbatas, Catat Pembayaran, Kirim Tanda Terima.
3. **Flutter teknisi** (Syakir): kontrak API dari tahap 1; layar harga, edit, bayar, tanda terima.
4. Laporan "Uang di Teknisi" dan penajaman (template Tanda Terima bisa diedit, antrean offline bila nanti diperlukan).

Mobile menyusul web, mengikuti pola kerja yang sudah ada; kontrak API dibekukan setelah tahap 1.

## Asumsi yang dipakai (koreksi bila salah)

1. Foto bukti wajib untuk **semua** metode, termasuk tunai (foto nota/uang di lokasi).
2. Transfer/QRIS hanya ke rekening/QRIS **toko**. Teknisi tidak menerima ke rekening pribadi. Sistem tidak memeriksanya, admin yang mencocokkan mutasi.
3. Perubahan jasa oleh teknisi tidak butuh persetujuan di muka; cukup alasan + penanda untuk admin.
4. Order Bayar di lokasi: Ajukan Selesai butuh pembayaran tercatat **atau** alasan "belum bisa bayar".
5. Batas setoran = akhir hari kerja; uang yang masih dipegang esoknya memicu notifikasi admin.
6. Setoran dan verifikasi hanya admin (kasir tidak).
7. Satu Tanda Terima per pembayaran (bukan per unit). Servis banyak AC = satu pembayaran per order.
8. Pemasangan dari POS tidak masuk alur ini (invoice POS dibayar di kasir).
9. **Catat Pembayaran tertutup** selama order punya pengajuan sparepart `pending`, atau yang sudah disetujui tetapi belum dilaporkan terpakai (`used_at` kosong). Tujuannya agar total tagihan sudah final sebelum ditagih: lapor terpakai bisa menurunkan total, dan kalau terjadi sesudah menagih, pelanggan kelebihan bayar padahal sistem belum punya refund dan `PaymentsService` menolak pembayaran melebihi sisa. Harga satuan sparepart tetap dari master (tidak ada koreksi harga satuan oleh admin maupun teknisi); yang bisa dikoreksi hanya item dan jumlah (revisi admin, lapor terpakai).

## Keputusan atas pertanyaan terbuka

- Job dibatalkan setelah dihargai: invoice dibatalkan otomatis (void), bukan dihapus; lihat Perilaku inti.
- Pembayaran non-tunai: sistem tidak terhubung ke bank, jadi admin yang mencocokkan dengan notifikasi/mutasi rekening dan QRIS toko. "Tolak" hanya jaring pengaman bila transfer tidak ditemukan; penanganan ke pelanggan manual oleh admin.
- Setoran kurang: pilihan Catat kurang atau Selesai dengan alasan (lihat Setoran harian).
