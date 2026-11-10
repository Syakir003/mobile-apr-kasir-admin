# Kontrak API: Pembayaran Lapangan Teknisi (untuk app Flutter)

Untuk: Syakir (app Flutter teknisi, rencana 6). Backend dan web sudah selesai sampai rencana 5; dokumen ini merangkum
semua yang perlu app mobile panggil. Sumber kebenaran tetap kode (`src/field-payments/`, `src/technician-jobs/`,
`src/service-orders/`); spek lengkap: `docs/superpowers/specs/2026-11-07-pembayaran-lapangan-teknisi-design.md`.

Semua endpoint memakai JWT yang sama dengan app sekarang (`Authorization: Bearer ...`), tanpa prefix global. Galat
validasi/aturan bisnis = HTTP 400 dengan `message` berbahasa Indonesia yang siap ditampilkan; 403 bila job bukan milik
teknisi itu; 404 bila job tidak ada. Uang selalu bilangan bulat rupiah.

## 0. Ringkasan alur di lapangan

1. Admin membuat order di Terima Servis dengan cara tagih **bayar di lokasi** dan (opsional) harga perkiraan jasa.
2. Teknisi mengerjakan job (alur lama tidak berubah) dan boleh **menyesuaikan jasa** di lokasi (alasan wajib).
3. Setelah total tagihan final, teknisi **mencatat pembayaran** (nominal, metode, foto bukti) lalu mengirim
   **Tanda Terima** ke pelanggan (WhatsApp lewat nomor toko, atau memakai laporan kertas).
4. **Ajukan Selesai** pada order bayar-di-lokasi butuh pembayaran tercatat ATAU alasan "belum bayar".
5. Admin memverifikasi setoran (tunai) atau mencocokkan mutasi (non-tunai). **Invoice baru lunas setelah itu**;
   mencatat pembayaran TIDAK mengubah status invoice.

Sampai app Flutter mendukung ini, form web Terima Servis sengaja memakai cara tagih **ditagih admin** sebagai
bawaan (konstanta `DEFAULT_PAYMENT_MODE` di `intake-pricing-card.tsx`). Order lama dan order dari app Flutter lama
tidak berubah. Setelah Flutter siap, bawaan web diganti ke bayar di lokasi.

## 1. Field baru pada data yang sudah ada

`GET /technician-jobs/:id` (peran teknisi/admin/kasir) kini memuat di `order`:

| Field | Arti |
|---|---|
| `order.paymentMode` | `bayar_di_lokasi` atau `ditagih_admin` (bawaan) |
| `order.invoice` | `{ id, number, status, grandTotal, totalPaid }`, ada setelah harga jasa ditetapkan |

`type` job kini bisa bernilai **`pemasangan_jasa`** (jasa pasang dari Terima Servis; di web berlabel "Pemasangan").
Beda dengan `pemasangan` (dari kasir/POS). App sebaiknya menampilkannya sebagai "Pemasangan" dan memperlakukannya
seperti servis biasa dalam hal harga dan pembayaran (kartu harga dan pembayaran TAMPIL, tidak seperti `pemasangan`).
Saat disetujui admin, unitnya jadi `aktif` dan tanggal pasang terisi; admin mengisi siklus pengingat servis seperti
cuci/maintenance.

## 2. Harga jasa untuk teknisi

### GET `/technician-jobs/:id/service-pricing`
Boleh untuk teknisi assignee (dulu admin/kasir saja). Respons (ringkas):

```json
{
  "jobId": "…", "status": "sedang_dikerjakan", "editable": true, "priced": true,
  "invoice": { "id": "…", "number": "INV-…", "status": "…", "grandTotal": "…", "totalPaid": "…" },
  "lines": [{ "id": "…", "serviceId": "…|null", "name": "Cuci AC 1/2 - 1 PK", "qty": 2, "unitPrice": 85000,
              "source": "admin|teknisi", "isCustom": false, "changeReason": null }],
  "techEdit": null,
  "transport": { "level": 0, "mode": "individu", "amount": 0 },
  "billed": [ /* baris tagihan hasil hitung, termasuk sparepart */ ],
  "sparepart": { "total": 0, "requests": [ /* … */ ] }
}
```
`priced=false` = admin belum menetapkan harga (teknisi belum bisa menyesuaikan maupun menagih).
Servis banyak AC: harga SATU untuk seluruh order, disimpan di job pemegang harga; endpoint menyelesaikannya otomatis.

### PATCH `/technician-jobs/:id/service-lines`  (khusus teknisi)
Menyesuaikan jasa di lokasi; **langsung berlaku**, tanpa persetujuan admin (admin hanya dikabari).

```json
{
  "reason": "Satu unit lagi ikut dicuci",
  "lines": [
    { "id": "<baris yang ada>", "qty": 3 },
    { "serviceId": "<katalog>", "qty": 1 },
    { "name": "Ganti kapasitor", "qty": 1, "unitPrice": 120000 }
  ]
}
```
Aturan:
- `lines` = daftar LENGKAP setelah disesuaikan; baris yang tidak dikirim dihapus; minimal 1 baris.
- Baris yang ada (`id`): hanya `qty` yang boleh berubah (harga satuan milik admin; dikirim berbeda = 400).
- Dari katalog (`serviceId`): harga = harga katalog. Di luar katalog: `name` + `unitPrice` wajib (ditandai `isCustom`).
- `reason` wajib, minimal 5 karakter. Transport tidak disentuh.
- Hanya saat job `assigned` / `sedang_dikerjakan`, sudah dihargai admin, bukan komplain, bukan `pemasangan` (POS).
- **Terkunci** begitu ada pembayaran lapangan selain yang ditolak (400 dengan pesan).
Setelah sukses, ambil ulang `GET …/service-pricing`.

## 3. Pembayaran lapangan

### GET `/technician-jobs/:jobId/field-payments`  (teknisi assignee/admin/kasir)
Dasar layar pembayaran. Respons:

```json
{
  "paymentMode": "bayar_di_lokasi", "unpaidReason": null,
  "canSendWa": true,
  "invoice": { "id": "…", "number": "INV-…", "status": "…", "grandTotal": 255000, "totalPaid": 0 },
  "activeTotal": 0, "remaining": 255000,
  "canRecord": true, "blockedReason": null,
  "payments": [{ "id": "…", "receiptNumber": "TT-20261110-0001", "method": "tunai", "amount": 255000,
                 "note": null, "status": "dipegang_teknisi", "proofUrl": "/uploads/payment-proofs/…",
                 "receiptChannel": "wa|kertas|null", "receiptSentAt": null, "createdAt": "…",
                 "recordedBy": { "id": "…", "displayName": "…" } }]
}
```
- `remaining` = tagihan - sudah lunas - pembayaran aktif (`dipegang_teknisi` + `menunggu_cocok`).
- Tombol Catat Pembayaran: tampil bila `paymentMode = bayar_di_lokasi`; aktif bila `canRecord`; bila tidak,
  tampilkan `blockedReason` apa adanya (mis. "Masih ada pengajuan sparepart yang belum diputuskan admin...").
- `canSendWa=false` (nomor pelanggan kosong/tak valid) = sembunyikan opsi WhatsApp, pakai kertas.
- Nomor HP pelanggan sengaja tidak dikirim ke layar teknisi.

Gerbang `canRecord` (semua dicek juga di backend): job `sedang_dikerjakan`; bukan `pemasangan` (POS) dan bukan
komplain; order `bayar_di_lokasi` dan sudah dihargai; TIDAK ada pengajuan sparepart `pending`; semua sparepart yang
disetujui sudah dilaporkan terpakai (total harus final); masih ada sisa tagihan.

### POST `/technician-jobs/:jobId/field-payments`  (khusus teknisi, `multipart/form-data`)

| Field | Wajib | Isi |
|---|---|---|
| `method` | ya | `tunai` `transfer` `qris` `ewallet` `debit` |
| `amount` | ya | bilangan bulat >= 1; tidak boleh melebihi `remaining` |
| `proof` | **ya, semua metode** | file foto bukti (JPG/PNG/WEBP, maks 10 MB) |
| `note` | wajib bila `amount` < `remaining` (bayar sebagian/DP) | maks 500 karakter |
| `clientRef` | disarankan | kunci idempotensi dari klien (mis. UUID per percobaan) |

Respons: `{ "payment": { …baris pembayaran, amount numerik }, "duplicate": false }`. Bila `clientRef` yang sama dikirim
ulang oleh teknisi yang sama (sinyal putus, retry), backend mengembalikan catatan lama dengan `duplicate: true`, bukan
mencatat dua kali. Pakai `clientRef` yang SAMA untuk retry satu pembayaran, dan yang BARU untuk pembayaran berikutnya.

Status awal: `tunai` -> `dipegang_teknisi` (uang dibawa pulang); non-tunai -> `menunggu_cocok`.
Nomor Tanda Terima `TT-YYYYMMDD-NNNN` dibuat backend. Admin otomatis dikabari.

### POST `/field-payments/:id/send-receipt`  (teknisi/admin)
Body opsional `{ "channel": "wa" | "kertas", "paperReportNo": "…" }` (bawaan `wa`).
- `wa`: kirim teks 4 baris lewat nomor toko (tanpa tautan). Respons `{ sent, channel: "wa", receiptNumber, error }`.
  Gagal kirim BUKAN galat HTTP: `sent:false` + `error` umum; boleh kirim ulang atau pilih kertas.
- `kertas`: teknisi memakai laporan kertas (tanpa sinyal / pelanggan tanpa HP). Respons `{ sent:false, channel:"kertas", receiptNumber }`.
Hasilnya terlihat pada `receiptChannel` / `receiptSentAt` di daftar pembayaran.

### GET `/field-payments/mine?status=`  (khusus teknisi)
"Uang yang saya pegang": `{ "heldTotal": 340000, "items": [{ id, receiptNumber, method, amount, status, receiptChannel,
receiptSentAt, createdAt, invoiceNumber, customerName }] }`. `heldTotal` dihitung atas SEMUA catatan berstatus
`dipegang_teknisi`; `items` dibatasi 200 terbaru. Filter opsional `status` = salah satu status di bawah.

Status pembayaran: `dipegang_teknisi` (tunai, belum disetor), `menunggu_cocok` (non-tunai, belum dicocokkan),
`diverifikasi` (sudah melunasi invoice), `ditolak` (admin menolak; teknisi diberi notifikasi).

### PATCH `/technician-jobs/:id/submit-for-review`  (perubahan body)
Body opsional: `{ "allInOrder": true, "unpaidReason": "Pelanggan belum bisa membayar" }`.
Pada order `bayar_di_lokasi` yang masih ada tagihan, teknisi harus sudah punya pembayaran tercatat (selain yang
ditolak) ATAU mengirim `unpaidReason` (min. 5 karakter; disimpan untuk admin). Tidak berlaku untuk pemasangan POS,
komplain, order `ditagih_admin`, dan tagihan Rp 0/lunas. Kalau tidak terpenuhi: 400 dengan pesan. Cara terbaik:
tampilkan kolom alasan di atas tombol Ajukan Selesai hanya bila `payments` kosong (selain `ditolak`) dan masih ada
tagihan (`invoice.grandTotal - invoice.totalPaid > 0`).

## 4. Terima Servis dari app (opsional, bila app punya form intake)

`POST /service-orders/intake` kini menerima tambahan (semua opsional; tanpa field ini perilaku lama tetap):
`paymentMode` (`bayar_di_lokasi` | `ditagih_admin`, bawaan `ditagih_admin`), `serviceLines[]` (`{ serviceId? | name?, qty,
unitPrice }`), `transportLevel` (0-5) + `transportMode` (`individu` | `dibagi`; transport tanpa baris jasa = 400),
`jobType` kini juga `pemasangan_jasa`. `scheduledDate` (YYYY-MM-DD) sekarang WAJIB di endpoint ini (`POST /service-orders`
lama tidak berubah). Mengisi `serviceLines` langsung membentuk invoice dan harga perkiraan.

## 5. Notifikasi dan realtime

- Ke teknisi: `service_priced` (admin menetapkan harga; sudah ada), `field_payment_rejected` (pembayaran ditolak;
  `target` = id pembayaran, body memuat nomor TT, nominal, dan alasan).
- Ke admin/kasir (info, bukan untuk app teknisi): `field_payment`, `job_price_edited`, `cash_overdue`.
- Realtime (admin): `field_payment.created`, `job.price_edited`. Tidak ada event realtime khusus ke teknisi.

## 6. Yang BUKAN untuk app teknisi

Semua endpoint verifikasi di bawah **khusus admin** (`@Roles('admin')`): `GET /settlements/pending|outstanding|technician-cash`,
`POST /settlements`, `POST /settlements/repay`, `GET /field-payments/awaiting`, `POST /field-payments/:id/verify|reject`,
`POST /field-payments/from-paper`. Tidak perlu diimplementasikan di app teknisi.

## 7. Titik yang perlu keputusan/perhatian di sisi mobile

- Foto bukti WAJIB untuk semua metode, termasuk tunai. Ambil dari kamera, kirim sebagai part `proof`.
- Kirim ulang saat sinyal buruk: wajib pakai `clientRef` yang sama agar tidak tercatat ganda.
- Setelah ada pembayaran lapangan, penyesuaian jasa terkunci dan pembatalan job terakhir ditolak; tampilkan pesan dari backend.
- Jenis `pemasangan_jasa` perlu label dan ikon; jangan perlakukan seperti `pemasangan` POS.
- Uang dianggap lunas HANYA setelah verifikasi admin. Jangan menampilkan "lunas" hanya karena pembayaran tercatat;
  gunakan status per pembayaran di atas.
