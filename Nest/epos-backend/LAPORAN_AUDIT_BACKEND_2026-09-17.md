# Laporan Audit Backend E-POS AC — 17 September 2026

**Cakupan:** seluruh modul backend (`epos-backend`, 161 file TypeScript + `prisma/schema.prisma`)
**Fokus:** correctness bisnis & keamanan
**Metode:** 5 pass audit paralel per domain, lalu setiap temuan diverifikasi ulang satu per satu langsung ke kode. Temuan yang tidak bisa dibuktikan jalurnya dibuang, tidak masuk laporan ini.

Total 26 temuan terverifikasi: 2 kritikal, 9 tinggi, 10 sedang, 5 rendah.

Catatan penting soal cara baca laporan ini: kode backend ini kualitasnya di atas rata-rata. Locking stok, penomoran invoice, redemption voucher, idempotensi offline-sync, dan pemisahan data margin dari kasir semuanya sudah dirancang benar dan sudah dicek — ringkasannya ada di bagian akhir. Temuan di bawah adalah celah di antara bagian-bagian yang sudah benar itu, bukan tanda sistemnya rapuh secara umum.

---

## KRITIKAL

### K-1. Diskon per-baris tidak dibatasi — kasir bisa bikin invoice Rp 0 yang otomatis berstatus "lunas"

**Lokasi:** `src/pos/dto/checkout.dto.ts:42`, `src/pos/pos-calc.util.ts:9`, `src/pos/pos.service.ts:205`, `:221`, `:353`

Field `discount` di `CheckoutItemDto` cuma divalidasi `@Min(0)` tanpa batas atas. Di `computeTotals()` nilai itu dikurangkan langsung dari tiap baris tanpa clamp. Masalahnya, satu-satunya penjaga "diskon melebihi subtotal" di `pos.service.ts:205` hanya membandingkan `totalDiscount` — yaitu `dto.discount + voucherDiscountAmount` — terhadap subtotal, dan **sama sekali tidak menyertakan `item.discount`**. Peringatan "jual di bawah modal" juga tidak menolong karena `pos.service.ts:221` langsung `continue` untuk semua baris yang bukan `kind === 'product'`.

Akibatnya begini konkretnya: kasir checkout satu baris `kind: 'service'` (misalnya Cuci AC, `basePrice` 150.000, qty 2 → 300.000) dengan `discount: 300000` di baris itu. Subtotal jadi 0. Penjaga di baris 205 membandingkan `0 > 0` → lolos. Lalu di `pos.service.ts:353` invoice dibuat dengan `status: computeInvoiceStatus(0, 0)`, dan `computeInvoiceStatus` mengembalikan `lunas` begitu `totalPaid >= grandTotal` — `0 >= 0` benar. Jadi lahir invoice Rp 0 berstatus **lunas** padahal `totalPaid` tercatat 0, tanpa satu pun baris `ManualPayment`. Uang 300.000 yang diterima kasir tidak pernah masuk `expectedCash` shift, jadi rekonsiliasi kas akhir shift tetap terlihat pas. Kalau `discount` diisi lebih besar dari nilai baris, subtotal jadi negatif dan statusnya tetap `lunas`.

Versi produk juga bisa (stok tetap terpotong sehingga inventaris tetap cocok), cuma perlu `confirmOverride: true` — dan audit log di `:452` hanya mencatat `belowCostOverride: true`, tidak pernah mencatat nominal diskonnya.

Efek sampingan di pelaporan: `Invoice.discount` diisi `totalDiscount` (baris 347), yang tidak memuat diskon per-baris, jadi laporan penjualan melaporkan total diskon lebih kecil dari kenyataan.

**Perbaikan yang disarankan:** masukkan total `item.discount` ke dalam perbandingan di baris 205, tolak `grandTotal < 0`, dan wajibkan `discountReason` untuk diskon baris seperti yang sudah berlaku untuk `dto.discount`. Pertimbangkan juga batas diskon per baris (misalnya tidak boleh melebihi `qty * unitPrice`) dan pencatatan `InvoiceAdjustment` agar ada jejak audit.

---

### K-2. Jalur offline-sync melewati semua validasi DTO — qty negatif menambah stok sekaligus memotong tagihan

**Lokasi:** `src/technician-jobs/dto/sync-action.dto.ts` (field `payload`), `src/technician-jobs/offline-sync.service.ts:136`, `src/material-requests/material-requests.service.ts:43`, `src/common/services/stock-locking.service.ts:49`

`SyncActionDto.payload` hanya divalidasi `@IsObject()`. Di `dispatch()` payload itu di-cast langsung ke bentuk yang diharapkan lalu diteruskan ke `MaterialRequestsService.create()`, sehingga semua validator yang menempel di `MaterialRequestItemDto` (`@IsIn(['sparepart'])`, `@IsNotEmpty` pada `refId`, `@IsNumber @Min(0.01)` pada `qty`) tidak pernah dijalankan — validator itu cuma aktif di jalur HTTP biasa. Satu-satunya pengecekan di jalur sync adalah `Array.isArray(items) && items.length > 0`.

`priceItems()` juga tidak menolong: fungsi itu memang menolak `kind` selain `sparepart` dan memastikan sparepart-nya ada dan aktif, tapi **tidak pernah memeriksa tanda `qty`**. Baris 73 langsung menghitung `lineTotal: Math.round(item.qty * sellPrice)`.

Jalur eksploitnya: teknisi mengirim `POST /technician-jobs/sync-batch` berisi `{ type: "material_add", jobId: <job miliknya>, payload: { items: [{ kind: "sparepart", refId: <sparepart asli>, qty: -50 }] } }`. `lineTotal` menjadi −7.500.000 (kalau harga jual 150.000). Saat admin approve, `decide()` menghitung `newGrand = grand_total + (-7.500.000)` — tagihan pelanggan dipotong 7,5 juta, dengan `InvoiceAdjustment` berlabel `pengajuan_tambahan` yang tampak sah. Lalu teknisi menandai "dipakai": di `lockAndDeduct`, pengecekan `Number(row.stock) < qty` menjadi `8 < -50` yang bernilai false sehingga lolos, dan query berikutnya menjalankan `UPDATE spareparts SET stock = stock - (-50)` → **stok bertambah 50** disertai `StockMovement` `+50` beralasan `pemakaian_servis`.

**Perbaikan yang disarankan:** validasi payload sync per tipe secara eksplisit sebelum dispatch (paling bersih: `plainToInstance` + `validateOrReject` ke DTO yang sudah ada), dan tambahkan penjaga `qty > 0` di `priceItems()` serta `qty > 0` di `StockLockingService` sebagai lapis kedua.

---

## TINGGI

### T-1. `approveComplete` bisa gagal diam-diam karena `P2002` merusak transaksi yang sedang berjalan

**Lokasi:** `src/whatsapp/whatsapp.service.ts:64`, pemanggil di `src/technician-jobs/technician-jobs.service.ts:783`

Ini bug di fitur WA yang baru kita bangun, dan ini yang paling perlu segera dibereskan.

`createPendingTx()` menangkap error `P2002` (duplikat `dedupeKey`) lalu mengembalikan `null` dengan maksud supaya transaksi bisnis pemanggilnya tidak ikut rollback. Niatnya benar, tapi mekanismenya tidak bekerja seperti itu di PostgreSQL: begitu sebuah statement gagal di dalam transaksi, seluruh transaksi masuk keadaan *aborted*, dan setiap statement berikutnya ditolak dengan `25P02`. Prisma interactive transaction tidak memasang savepoint per statement, jadi menangkap error di level aplikasi tidak memulihkan transaksinya.

Jalur ini benar-benar bisa terjadi. `dedupeKey` bernilai `job:<jobId>` dan memang `@unique` di skema (`prisma/schema.prisma:872`). Job yang sudah pernah di-approve bisa kembali ke `menunggu_review` lewat `sendBack()` di `:844`, teknisi submit ulang, lalu admin approve lagi — pemanggilan kedua `enqueueJobCompleteMessageTx` menabrak `dedupeKey` yang sama.

Ada dua akibat, tergantung apakah job punya `orderId`. Kalau punya, statement berikutnya (`$executeRaw ... FOR UPDATE` di `:799`) melempar `25P02` → admin dapat error 500, dan karena setiap percobaan mengulang hal yang sama, job tersangkut di `menunggu_review` selamanya. Kalau `orderId` null, tidak ada statement lain sebelum COMMIT — dan `COMMIT` pada transaksi aborted diperlakukan PostgreSQL sebagai `ROLLBACK` tanpa melempar error. API mengembalikan 200 dengan data job yang seolah sudah "selesai", padahal perubahan status, `lastServiceDate`, dan `nextServiceDate` semuanya hilang. Unit itu lalu tidak pernah masuk antrian pengingat.

Pola yang sama juga ada di `findOrCreateCategory` (`technician-jobs.service.ts:94`).

**Perbaikan yang disarankan:** jangan andalkan tangkap-`P2002`-di-dalam-transaksi. Cek keberadaan `dedupeKey` lebih dulu di transaksi yang sama sebelum insert, atau pindahkan pembuatan baris WA ke luar transaksi bisnis sepenuhnya (setelah commit), atau bungkus insert-nya dengan savepoint eksplisit.

### T-2. Unit tidak pernah kembali ke status `aktif` — seluruh pengingat H-3/H+7 tidak akan pernah jalan

**Lokasi:** `src/technician-jobs/technician-jobs.service.ts:520` vs `:770`, `src/reminders/reminders.service.ts:361`

`start()` mengubah `memberAcUnit.status` menjadi `dalam_maintenance` untuk setiap job yang bukan `pemasangan`. Tapi `approveComplete()` hanya mengembalikan status ke `aktif` kalau `job.type === 'pemasangan'`; untuk tipe lain nilainya `undefined`, yang oleh Prisma diartikan "jangan ubah kolom ini". `cancel()` juga tidak pernah menyentuh status unit.

Sementara itu `runDailyEnqueue()` memfilter `where: { status: 'aktif', ... }`. Artinya begitu sebuah unit pernah diservis `cuci` atau `maintenance`, unit itu permanen berstatus `dalam_maintenance` dan tidak akan pernah lagi masuk hasil query cron — padahal `cuci` dan `maintenance` justru **satu-satunya dua tipe job yang punya siklus berulang** dan menjadi alasan seluruh fitur pengingat ini dibuat.

Jadi secara efektif: fitur pengingat WA H-3/H+7 yang baru dibangun tidak akan pernah mengirim satu pesan pun setelah servis pertama, sampai admin manual mengubah status tiap unit kembali ke `aktif` lewat menu Unit AC.

**Perbaikan yang disarankan:** di `approveComplete()` ubah menjadi `status: 'aktif'` untuk semua tipe job (bukan hanya `pemasangan`), dan kembalikan status ke `aktif` juga di `cancel()` untuk job yang sempat berstatus `sedang_dikerjakan`. Ini satu baris, tapi menentukan hidup-matinya fitur pengingat.

### T-3. `itemCostId` tidak pernah dicocokkan dengan `refId` — stok terpotong dari produk yang berbeda dari yang tercatat

**Lokasi:** `src/pos/pos.service.ts:147`, `:296`, `:425`, `src/common/services/stock-locking.service.ts:105`

`lockAndDeductProductBatch()` mencari batch semata-mata lewat `ic.id = $1`, mengambil nama dan harga dari hasil JOIN ke `products`, tapi tidak pernah membandingkan `ic.ref_id` dengan `refId` yang dikirim klien. Di sisi lain, `stockMovement` (`:296`) dan `invoiceItem` (`:366`) menyimpan `item.refId` apa adanya dari klien.

Kalau klien mengirim baris `{ kind: 'product', refId: <Produk B>, itemCostId: <batch milik Produk A>, qty: 2 }`, maka dua unit keluar dari batch Produk A (`item_costs.stock` 5 → 3), sementara satu-satunya `stock_movement` yang tertulis berbunyi `ref_id = Produk B, qty_change = −2`. Stok on-hand Produk A jadi selisih 2 terhadap jumlah pergerakannya, dan Produk B selisih −2 ke arah sebaliknya. Kalau baris itu dirujuk oleh `installations`, `pos.service.ts:425` mencari `item.refId` dan membuat `MemberAcUnit` bermerek/model Produk B padahal yang keluar fisik adalah unit Produk A — barcode dan data unit pelanggan jadi salah permanen.

Ini bukan hanya soal klien jahat: bug di frontend saat memilih batch menghasilkan efek yang sama tanpa ada error apa pun.

**Perbaikan yang disarankan:** kembalikan `ref_id` dari `lockAndDeductProductBatch()` dan tolak dengan `BadRequestException` kalau tidak sama dengan `item.refId`; atau lebih sederhana, abaikan `refId` dari klien untuk `kind='product'` dan pakai `ref_id` hasil lock sebagai sumber kebenaran di semua penulisan.

### T-4. Harga beli dan nama supplier bisa dibaca kasir dan teknisi

**Lokasi:** `src/products/products.controller.ts:32`, `src/products/products.service.ts:76`, `prisma/schema.prisma:237`

Endpoint `GET /products/:id/batches` tidak punya dekorator `@Roles` sama sekali, padahal `@Post()` dan `@Patch()` di controller yang sama punya `@Roles('admin')`. `RolesGuard` memperlakukan ketiadaan metadata sebagai "boleh untuk semua role yang sudah login". `findBatches()` mengembalikan baris `ItemCost` mentah, dan model itu berisi `buyPrice` serta `supplierName`.

Jadi kasir — dan bahkan teknisi lewat aplikasi mobile, yang tidak punya urusan pembelian sama sekali — bisa memanggil endpoint ini untuk setiap produk dan membaca harga modal beserta nama supplier toko, lalu menghitung margin penuh. Ini bertabrakan langsung dengan kebijakan yang sudah ditegakkan di tempat lain: `invoices.service.ts:111` sengaja menghapus `buyPriceSnapshot` untuk non-admin, dan `/reports/profit-loss` dikunci `@Roles('admin')`.

**Perbaikan yang disarankan:** endpoint ini memang dibutuhkan POS untuk memilih batch, jadi jangan dihapus — cukup `@Roles('admin', 'kasir')` dan sunting kolom yang dikembalikan supaya hanya `id`, `sellPrice`, `stock`, `createdAt` yang keluar untuk kasir.

### T-5. Respons konfirmasi "di bawah modal" membocorkan harga beli ke kasir

**Lokasi:** `src/pos/pos.service.ts:244`, `src/common/exceptions/confirmation-required.exception.ts`, `src/pos/pos.controller.ts:19`

`BelowCostWarning` membawa `buyPrice` dan `sellPrice`, dan `PosController.checkout` — yang dibuka untuk `@Roles('admin', 'kasir')` — mengembalikannya apa adanya sebagai HTTP 200.

Kasir bisa menyalahgunakan ini tanpa meninggalkan jejak sama sekali: kirim checkout berisi satu baris produk dengan `discount` sangat besar dan tanpa `confirmOverride`. Exception dilempar di `:256`, seluruh transaksi rollback — sehingga stok, invoice, **dan audit log di `:442`** semuanya ikut dibatalkan — tapi respons tetap berisi `buyPrice` batch tersebut. Diulang per batch, seluruh buku harga modal bisa dipanen tanpa satu baris audit pun.

**Perbaikan yang disarankan:** untuk role non-admin, kembalikan hanya `name`, `sellPrice`, dan `effectivePrice` (cukup untuk dialog konfirmasi kasir), tahan `buyPrice` hanya untuk admin.

### T-6. Opt-out WhatsApp bisa dilewati lewat tombol "Kirim Ulang"

**Lokasi:** `src/whatsapp/whatsapp.service.ts:85`, `src/members/members.service.ts:153`

`setWaOptOut()` membatalkan baris `WhatsappLog` yang tertunda, tapi filternya hanya `status: 'pending'` — baris berstatus `gagal` tidak disentuh. Sementara `retry()` memanggil `dispatch()` yang mengirim ulang isi pesan yang tersimpan tanpa membaca ulang `member.waOptOut`.

Skenarionya wajar terjadi: Fonnte sedang down jam 09:00, satu pengingat `reminder_h3` mendarat di status `gagal`. Pelanggan membalas "STOP", kasir mencentang opt-out — baris `gagal` tadi tetap utuh. Besoknya admin membuka halaman Riwayat WA, memfilter status `gagal`, dan menekan "Kirim Ulang" — pelanggan yang sudah opt-out tetap menerima pengingat itu.

**Perbaikan yang disarankan:** cek `member.waOptOut` di dalam `dispatch()` untuk `kind` yang bersifat pengingat sebelum memanggil Fonnte, dan perluas filter di `setWaOptOut` agar ikut membatalkan baris `gagal`.

### T-7. Rem login bisa dilewati dengan memalsukan header `X-Forwarded-For`

**Lokasi:** `src/auth/guards/login-throttle.guard.ts:87`, `src/main.ts` (tidak ada `trust proxy`)

Kedua kunci throttle (`login:<ip>:<email>` dan `login-ip:<ip>`) dibangun dari `extractIp()`, yang mengambil entri **pertama** dari header `X-Forwarded-For` kiriman klien. Penyerang cukup mengirim `X-Forwarded-For: 1.2.3.<acak>` yang berbeda di setiap request agar setiap percobaan masuk ember hitungan baru, sehingga batas 10/menit maupun 40/menit tidak pernah tercapai — brute force password online tanpa batas terhadap akun admin, hanya dibatasi biaya bcrypt.

Komentar di `:82-86` sudah menyadari risiko ini dan menyarankan "jangan deploy tanpa reverse proxy di depan". Sayangnya saran itu tidak menutup celahnya: konfigurasi nginx standar `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` **menambahkan** IP asli di belakang apa pun yang dikirim klien, jadi entri pertama tetap dikendalikan penyerang.

**Perbaikan yang disarankan:** aktifkan `app.set('trust proxy', <jumlah hop proxy>)` dan gunakan `request.ip` hasil resolusi Express, atau ambil entri **terakhir** dari rantai `X-Forwarded-For` (bukan pertama) sesuai jumlah proxy yang memang dipasang.

### T-8. Koneksi WebSocket mempercayai JWT lama — akun nonaktif tetap menerima data bisnis

**Lokasi:** `src/realtime/realtime.gateway.ts:45`, `:88`

`handleConnection()` hanya memanggil `jwt.verifyAsync()` dan tidak pernah membaca ulang `active`, `role`, atau `passwordChangedAt` dari database, sedangkan `handleJoin()` menentukan hak masuk room `admin-dashboard` dari `payload.role` di dalam token.

Komentar di `:53-59` membenarkan keputusan ini dengan alasan token socket bersifat *short-lived* dan diambil dari `/api/auth/socket-token`. Saya sudah mengecek: **endpoint itu tidak ada di backend ini.** Pencarian `socket-token` di seluruh `src/` hanya menemukan dua baris komentar tersebut, dan `AuthController` hanya menerbitkan satu jenis token, yaitu access token 8 jam.

Akibatnya: admin memecat seorang kasir dan menonaktifkan akunnya. REST API langsung menolak (`jwt.strategy.ts` memeriksa `active`), tapi token 8 jam yang masih tersimpan di ponsel mantan karyawan itu tetap diterima gateway. Ia menyambung ulang Socket.IO, dan terus menerima event `transaction.created` — berisi payload checkout lengkap termasuk nilai uang — selama sisa masa berlaku token. Hal yang sama berlaku setelah reset password: panggilan REST penyerang mati, aliran socket-nya tidak.

**Perbaikan yang disarankan:** lakukan pemeriksaan DB yang sama seperti `JwtStrategy` di dalam `handleConnection()` (satu query per koneksi, bukan per event — biayanya kecil), dan ambil `role` dari hasil query itu, bukan dari klaim token.

### T-9. `cancel()` membaca pengajuan material tanpa lock — bisa terjadi penyelesaian ganda

**Lokasi:** `src/technician-jobs/technician-jobs.service.ts:933`, bandingkan `src/material-requests/material-requests.service.ts:276`

`decide()` dan `markUsed()` sama-sama mengambil `SELECT ... FOR UPDATE` pada baris `material_requests` sebelum membaca statusnya. `cancel()` hanya mengunci baris job dan baris invoice, lalu melakukan `findMany({ jobId, status: 'approved', usedAt: null })` tanpa lock.

Interleaving-nya: pengajuan R sudah disetujui senilai 750.000 dan sudah menaikkan tagihan invoice. Teknisi menekan "Tandai Dipakai" persis saat admin membatalkan job. `markUsed()` mengunci R, memotong stok, mengisi `usedAt`, commit. Transaksi `cancel()` yang `findMany`-nya sudah berjalan sebelum commit itu (Read Committed) masih melihat R sebagai `approved` dan `usedAt: null`, lalu menulis `InvoiceAdjustment` −750.000 dan menurunkan `grandTotal`. Hasil akhirnya: sparepart sudah keluar dari gudang **dan** pelanggan tetap dikreditkan balik nilainya.

**Perbaikan yang disarankan:** gunakan `SELECT ... FOR UPDATE` pada `material_requests` di `cancel()` sebelum membaca status, sama seperti yang sudah dilakukan dua fungsi lain.

---

## SEDANG

### S-1. Sparepart pada servis walk-in tidak pernah ditagihkan

**Lokasi:** `src/service-orders/service-orders.service.ts:66`, `src/material-requests/material-requests.service.ts:209`

`decide()` menagihkan material melalui `request.job.order?.invoiceId`. Tapi `ServiceOrdersService.intake()` membuat `ServiceOrder` tanpa pernah mengisi `invoiceId` (kolom itu hanya diisi oleh `PosService.checkout`), dan tidak ada kode lain yang mengisinya belakangan.

Jadi untuk pelanggan yang datang membawa AC (`POST /service-orders/intake`), saat admin menyetujui pengajuan sparepart teknisi, cabang `if (invoiceId)` bernilai false secara diam-diam — tidak ada `InvoiceAdjustment`, tidak ada error, tidak ada peringatan. Teknisi menandai dipakai, stok terpotong, `StockMovement` tercatat, dan sparepart itu keluar dari inventaris tanpa satu rupiah pun tercatat sebagai pendapatan. Blok pembalikan di `cancel()` yang berpegang pada `req.invoiceId` juga jadi tidak berfungsi.

Kalau memang alurnya adalah kasir menagihkan manual di kasir saat pelanggan mengambil unit, kondisi ini bisa ditoleransi — tapi saat ini tidak ada apa pun yang memaksa atau mengingatkan hal itu terjadi.

### S-2. Approve menagih tanpa mencadangkan stok — job bisa tersangkut permanen

**Lokasi:** `src/material-requests/material-requests.service.ts:198`

`decide()` menaikkan `invoice.grandTotal` tanpa memeriksa ketersediaan stok; pemotongan baru terjadi saat `markUsed()`. Kalau stok sparepart 2, lalu pengajuan Job A (qty 2) dan Job B (qty 2) sama-sama disetujui, kedua invoice sama-sama naik. Teknisi A menandai dipakai → stok 2 → 0. Teknisi B menandai dipakai → `lockAndDeduct` melempar "Stok tidak cukup" dan seluruh transaksi rollback. Invoice Job B tetap menanggung tagihan material yang tidak pernah diterima, dan `submitForReview` memblokir Job B selamanya karena `unusedApproved > 0`, sampai admin membatalkan job itu.

### S-3. Filter tanggal dibaca pakai timezone proses, bukan WIB

**Lokasi:** `src/invoices/invoices.service.ts:36`, `src/audit-logs/audit-logs.service.ts:28`

Keduanya memakai `new Date("${query.from}T00:00:00.000")` tanpa offset. Di server `TZ=UTC`, rentang untuk `from=to=2026-09-17` sebenarnya 07:00 WIB tanggal 17 sampai 06:59 WIB tanggal 18. Invoice yang dibuat 02:00 WIB tanggal 17 — dan sudah diberi nomor `INV-20260917-0001` oleh `CountersService.dateKey` yang benar-benar WIB — hilang dari Riwayat Transaksi hari itu, sementara penjualan 03:00 WIB tanggal 18 malah ikut terhitung. Pola yang benar sudah ada di `reports.util.ts` (offset `+07:00` eksplisit), tinggal dipakai di dua tempat ini.

### S-4. Grafik penjualan harian dikelompokkan per hari UTC

**Lokasi:** `src/reports/reports.service.ts:52`

Batas rentangnya WIB (dari `parseDateRange`), tapi `DATE_TRUNC('day', created_at)` berjalan di atas kolom `timestamp(3)` yang menyimpan UTC. Checkout jam 03:00 WIB tanggal 2 Oktober masuk ke batang tanggal 1 Oktober. Setiap batang sebenarnya mewakili rentang 07:00 WIB → 07:00 WIB, sehingga total harian di grafik tidak pernah cocok dengan `omzetHariIni` di `/dashboard/summary` yang sudah benar memakai `wibDayRange`.

### S-5. `dueDate` pesan "pekerjaan selesai" tidak dinormalisasi ke WIB

**Lokasi:** `src/technician-jobs/technician-jobs.service.ts:764`, `:787`

`nextService` dihitung `new Date(now.getTime() + intervalDays * 86400000)` lalu langsung dipakai sebagai `dueDate` tanpa melewati `wibDateOnly()`. Padahal `WhatsappLog.dueDate` bertipe `@db.Date` dan `formatTanggalId()` membaca `getUTCDate()`, dan semua pemanggil lain sudah menormalisasi (`runDailyEnqueue` memakai `wibDateOnly`, `InvoicesService` juga). Untuk approve sebelum jam 07:00 WIB, pesan "selesai servis" menyebut tanggal satu hari lebih awal daripada yang nanti disebut pengingat H-3 untuk janji yang sama.

### S-6. `installations[].itemIndex` tidak dicek duplikat maupun terhadap `qty`

**Lokasi:** `src/pos/pos.service.ts:419`

Tidak ada yang memvalidasi berapa banyak entri instalasi menunjuk item yang sama. Menjual satu AC (`items[0]`, `qty: 1`) sambil mengirim tiga entri instalasi yang semuanya `itemIndex: 0` menghasilkan: stok terpotong sekali, tapi `createForInstallation` jalan tiga kali → tiga baris `member_ac_units` dengan tiga barcode, tiga `technician_jobs` terjadwal, dan `member.totalAcUnits` naik 3. Dua unit hantu itu kemudian menghasilkan pengingat servis WA berulang dan kunjungan teknisi gratis selamanya.

### S-7. Laporan pendapatan dan laba ikut menghitung invoice `batal` dan `refund`

**Lokasi:** `src/reports/reports.service.ts:19`, `:43`, `:56`, `:183`

Ketiga agregasi hanya memfilter `invoices.created_at`; enum `InvoiceStatus` punya `refund` dan `batal` tapi tidak ada yang mengecualikannya. Invoice batal tetap menambah `totalPenjualan`, dan di `profitLoss` baik pendapatan maupun HPP-nya ikut dibukukan, sehingga `labaKotor` dan `marginPersen` menggelembung.

### S-8. Satu hari cron terlewat = pengingat H-3 hari itu hilang permanen

**Lokasi:** `src/reminders/reminders.service.ts:356`

Kedua jendela dihitung dari `new Date()` saat fungsi dipanggil (`now+3d` dan `now-7d`), dan `@nestjs/schedule` tidak memutar ulang jadwal yang terlewat. Kalau server mati melewati jam 09:00 WIB tanggal 28, unit yang jatuh tempo 1 Oktober tidak dapat H-3. Admin menjalankan `POST /reminders/run-now` tanggal 29 — jendelanya sudah bergeser ke 2 Oktober, jadi unit tadi tidak tersentuh dan baru dapat sapaan saat H+7 tanggal 8 Oktober. Komentar di controller `:43` dan service `:351` menjanjikan `run-now` bisa "nyusul" siklus yang terlewat; kenyataannya tidak bisa.

### S-9. Menurunkan `grandTotal` di bawah `totalPaid` diam-diam jadi `lunas` tanpa mencatat kewajiban refund

**Lokasi:** `src/technician-jobs/technician-jobs.service.ts:955`, `src/common/invoice-status.util.ts:19`

Invoice 5.000.000 sudah lunas. Admin membatalkan job yang memegang pengajuan material 800.000 yang belum dipakai; `newGrand` jadi 4.200.000 dan `computeInvoiceStatus(4.200.000, 5.000.000)` mengembalikan `lunas` karena `totalPaid >= grandTotal`. Selisih 800.000 yang jadi utang toko ke pelanggan tidak tercatat di mana pun — `totalPaid` tetap 5.000.000, status `refund` tidak pernah dipakai, dan tidak ada `ManualPayment` negatif.

### S-10. Sparepart servis tidak pernah masuk laporan laba-rugi

**Lokasi:** `src/material-requests/material-requests.service.ts:231`, `src/reports/reports.service.ts:163`

Material yang disetujui ditagihkan hanya sebagai `InvoiceAdjustment`; tidak pernah ada baris `InvoiceItem`. Sementara `profitLoss` mengagregasi eksklusif dari `invoice_items`. Jadi freon senilai 500.000 dengan modal 300.000 memang memotong stok dan menaikkan `grandTotal`, tapi `totalPendapatan` dan `totalHpp` sama-sama tidak bergerak — laba kotor kurang catat sebesar margin penuhnya, dan sparepart yang terpakai tidak terlihat sebagai HPP.

---

## RENDAH

### R-1. Urutan penguncian opname dan checkout berbeda — deadlock mungkin terjadi

`src/stock/stock.service.ts:185` mengurutkan lock berdasarkan UUID mentah, sedangkan checkout (`pos.service.ts:143`) mengurutkan berdasarkan `lineKey` yang berprefiks `product:`/`sparepart:` sehingga selalu mengunci semua batch produk sebelum sparepart. Opname dan checkout yang menyentuh satu produk dan satu sparepart yang sama bisa saling menunggu; PostgreSQL mendeteksinya dan membatalkan salah satu dengan `40P01` (error 500 ke pengguna). Tidak ada korupsi data, tapi klaim anti-deadlock di komentarnya tidak berlaku.

### R-2. `maxDiscountCap` diabaikan untuk voucher bertipe nominal

`src/vouchers/vouchers.service.ts:186` hanya menerapkan cap pada cabang `persen`, sementara `CreateVoucherDto` tetap menerima `maxDiscountCap` untuk kedua tipe tanpa validasi silang. Voucher nominal 500.000 dengan cap 100.000 tetap memotong 500.000 penuh.

### R-3. Endpoint `GET /` tanpa autentikasi membocorkan jumlah user

`src/app.controller.ts:8` tidak memakai guard apa pun dan `getHello()` menjalankan `prisma.user.count()`, sehingga siapa pun dari internet mendapat jumlah persis akun yang ada — informasi yang mempermudah serangan di T-7.

### R-4. `rateLimit.reset()` tidak pernah dipanggil

`src/common/services/rate-limit.service.ts:43` didokumentasikan "dipanggil saat percobaan BERHASIL", tapi tidak ada pemanggilnya di seluruh `src/`. Kasir yang salah ketik password 8 kali lalu berhasil login, kemudian aplikasinya perlu login ulang dua kali, akan kena 429 padahal kredensialnya benar — tepat di depan pelanggan.

### R-5. Pendaftaran device token bisa membajak kanal push orang lain

`src/notifications/notifications.service.ts:39` melakukan upsert berkunci `token` saja tanpa bukti bahwa pemanggil memiliki perangkat itu, dan `DeviceToken.token` `@unique` membuat perpindahan kepemilikan terjadi tanpa syarat. Teknisi yang memperoleh FCM token admin (tablet bersama, devtools di kios) dapat memindahkan baris itu ke dirinya; notifikasi admin berhenti diam-diam, dan notifikasi teknisi dikirim ke ponsel admin.

### R-6. Hasil sync yang di-cache dikembalikan sebelum pengecekan kepemilikan

`src/technician-jobs/offline-sync.service.ts:76` memberi kunci `SyncActionLog` hanya pada `clientActionId`, dan cabang `skipped_duplicate` mengembalikan `cached.detail` sebelum pengecekan `job.technicianId !== technicianId` di `:86` sempat berjalan. Teknisi B yang memutar ulang `clientActionId` milik teknisi A menerima `detail` milik A — untuk `submit_for_review` isinya baris `TechnicianJob` lengkap (id member, id unit, catatan) untuk job yang tidak boleh ia akses.

### R-7. Pemeriksaan `JWT_SECRET` hanya mengecek keberadaan, bukan nilainya

`src/main.ts:16` memastikan variabelnya ada, dan `.env` mengirimkan `JWT_SECRET="dev-secret-ganti-sebelum-production"`. Aplikasi yang ter-deploy dengan `.env` bawaan repo akan start bersih tanpa peringatan, padahal siapa pun yang pernah melihat file itu bisa menandatangani token admin sendiri. Komentar di `:10-15` menyatakan penjaga ini memang ada untuk mencegah skenario tersebut — memindahkan nilai default dari source ke `.env` belum menutupnya.

---

## Yang sudah dicek dan bersih

Bagian ini penting supaya jelas cakupan auditnya, dan supaya bagian yang sudah benar tidak ikut diutak-atik.

**Harga dan uang.** Harga tidak pernah diambil dari klien — `unitPrice` selalu dibaca dari `item_costs`/`spareparts`/`services` di dalam transaksi, dan `buyPriceSnapshot` direkam saat checkout. Aritmetika rupiah memang memakai `number` JavaScript, tapi setiap nilai adalah bilangan bulat jauh di bawah 2^53 dan setiap baris di-`Math.round` sebelum dijumlahkan, sehingga `Invoice.subtotal` selalu sama dengan `SUM(invoice_items.line_total)` — tidak ditemukan penyimpangan floating point.

**Voucher dan penomoran invoice.** Redemption voucher aman dari pemakaian ganda dan dari pemakaian setelah kedaluwarsa: `SELECT ... FOR UPDATE` pada kode voucher, seluruh validasi dan penulisan `terpakai` berada di transaksi checkout yang sama, dan jalur `confirm_required` me-rollback semuanya. Penomoran invoice benar — `INSERT ... ON CONFLICT DO UPDATE RETURNING` memegang lock baris counter sampai commit, `number` bersifat `@unique`, dan `dateKey` memakai `wibDateKey` yang eksplisit WIB, jadi checkout bersamaan tidak menghasilkan tabrakan maupun lompatan nomor.

**Locking stok.** `lockAndDeductProductBatch` dan jalur sparepart `lockAndDeduct` keduanya membaca ulang baris yang sudah dikunci `FOR UPDATE` sebelum membandingkan stok; di bawah Read Committed, EvalPlanQual PostgreSQL mengembalikan versi terbaru, sehingga pasangan cek-lalu-kurangi tidak bisa saling menyusup dan oversell tidak terjadi. Urutan lock di checkout memakai kunci terurut sehingga bebas deadlock di jalurnya sendiri. `pg_advisory_xact_lock` di `stockIn` benar menegakkan invarian "satu baris `item_costs` per sparepart" yang memang sengaja tidak dipasang sebagai constraint skema. `decide()` dan `markUsed()` sama-sama mengunci baris sebelum membaca status, jadi approve ganda dan potong-stok ganda sudah tertutup.

**Autentikasi.** Penyamaan waktu login lewat `DUMMY_HASH` dan pesan error yang identik untuk akun tidak dikenal/nonaktif/password salah sudah benar. Biaya bcrypt terpusat. Pemeriksaan `passwordChangedAt` terhadap `iat` — termasuk pemotongan detik yang disengaja dan perbandingan `<` yang menjaga token pengganti tetap valid — sudah tepat. `changePassword` mewajibkan password lama dan tidak pernah mencatat materi password. Penjaga "admin terakhir" dan penguncian-diri-sendiri ada di `toggleActive` maupun `update`, diserialisasi dengan `pg_advisory_xact_lock`.

**Otorisasi.** Kepemilikan job ditegakkan konsisten: `findOne()`, `myQueue()`, `history()`, `todayBundle()`, dan `assertOwnerOrAdmin` semuanya mengambil identitas teknisi dari klaim `sub` di JWT, tidak pernah dari body. `approveComplete`/`sendBack`/`cancel` admin-only di controller maupun service. `/reports`, `/dashboard`, `/audit-logs`, `/stock/*`, mutasi `/vouchers`, penulisan `/app-config`, dan keputusan material request semuanya admin-only. `ShiftsService.close`/`report` menegakkan kepemilikan shift.

**Injeksi.** Seluruh raw SQL (`stock.service.ts`, `stock-locking.service.ts`, `products.service.ts`, `material-requests.service.ts`) memakai parameter terikat `$1`/`$2` — tidak ditemukan jalur injeksi. Upload file memakai nama yang dibuat server dari whitelist MIME, tanpa path traversal.

**Fitur WhatsApp.** Kunci API Fonnte tidak pernah sampai ke baris log, respons error, `providerResponse`, maupun baris `AuditLog`. URL tujuan hardcoded dengan `target` berisi digit saja dan body `URLSearchParams` — tidak ada permukaan SSRF. `waPhone` menangani format `0…`/`62…`/`+62…` dengan benar dan mengembalikan string kosong untuk masukan tanpa digit, yang dicek setiap pemanggil. Skema dedupe pengingat sehat: `dedupeKey` benar-benar `@unique` di skema, kunci pengelompokan WIB dan kunci dedupe diturunkan konsisten lewat `wibDateKey`, `@Cron` dipatok ke `Asia/Jakarta`, dan instance bersamaan diserialisasi aman oleh unique index. Validasi placeholder template bersifat per-jenis dan menolak token `{...}` yang tidak dikenal, sehingga tidak ada placeholder mentah yang bisa sampai ke pelanggan.

**Idempotensi offline-sync.** Protokol claim/complete/release benar-benar aman terhadap pemutaran ulang untuk keempat tipe aksinya: baris `pending` yang di-INSERT lebih dulu pada kolom unik `client_action_id` membuat pengiriman kedua mengembalikan detail ter-cache tanpa menjalankan ulang `dispatch()`. Membiarkan hasil `error` tidak tercatat (supaya kegagalan sementara tetap di-retry) dan membekukan snapshot `baselineUpdatedAt` per batch keduanya beralasan tepat.

---

## Saran urutan pengerjaan

Kalau harus memilih, urutan ini memberi penurunan risiko terbesar per satuan usaha:

Pertama, **T-2** — satu baris, dan tanpa itu seluruh fitur pengingat WA yang baru selesai dibangun tidak akan pernah mengirim pesan. Lalu **T-1**, karena bug ini bisa menghilangkan penyelesaian job tanpa jejak error sama sekali, dan keduanya berada di fitur yang sama sehingga sekalian jalan.

Berikutnya **K-1** dan **K-2**, keduanya menyangkut uang dan stok secara langsung, dan keduanya bisa ditutup dengan penambahan validasi yang tidak mengubah alur bisnis.

Setelah itu **T-3** (integritas data stok), **T-4** dan **T-5** (kebocoran margin, sekaligus konsisten dengan kebijakan yang sudah dianut di modul lain), lalu **T-7** dan **T-8** yang murni keamanan akses.

Kelompok WIB (**S-3**, **S-4**, **S-5**) sebaiknya dikerjakan sekaligus dalam satu sesi karena polanya sama dan sudah ada contoh yang benar di `reports.util.ts`.
