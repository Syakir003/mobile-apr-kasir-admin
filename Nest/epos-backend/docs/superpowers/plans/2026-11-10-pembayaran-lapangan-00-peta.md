# Pembayaran Lapangan Teknisi — Peta Rencana Implementasi

Spesifikasi: `epos-backend/docs/superpowers/specs/2026-11-07-pembayaran-lapangan-teknisi-design.md` (semua asumsi 1–9 disetujui 2026-11-10).

Spesifikasi ini mencakup beberapa subsistem independen, jadi dipecah menjadi beberapa rencana. Tiap rencana menghasilkan perangkat lunak yang bisa dites sendiri dan dirilis tanpa rencana sesudahnya. Rencana 2 dan seterusnya sengaja belum dirinci kodenya: kodenya bergantung pada hasil rencana sebelumnya (nama fungsi, bentuk respons), jadi dirinci satu per satu setelah rencana sebelumnya mendarat.

| # | Rencana | Isi | Bergantung pada | Status |
|---|---|---|---|---|
| 1 | `…-01-harga-di-depan-dan-void.md` | Kolom `payment_mode`, harga perkiraan di Terima Servis, invoice otomatis `batal` saat job terakhir dibatalkan, laporan mengecualikan `batal` | — | **Rinci, siap dikerjakan** |
| 2 | Harga jasa untuk teknisi | Endpoint baca harga untuk teknisi, penyesuaian terbatas (katalog + jumlah + "jasa lain"), alasan, penanda untuk admin, kunci setelah ada pembayaran | 1 | Kerangka di bawah |
| 3 | Pembayaran lapangan + Tanda Terima | Tabel `field_payments`, catat pembayaran, penjaga ganda bayar, gerbang sparepart final, gerbang Ajukan Selesai, kirim Tanda Terima WA (`tanda_terima`) | 1, 2 | Kerangka di bawah |
| 4 | Setoran dan verifikasi | `cash_settlements`, verifikasi tunai, Cocokkan Mutasi, saldo kurang/lebih setor, Selesai dengan alasan, cek sparepart kembali, dari kertas, cron `cash_overdue`, laporan Uang di Teknisi | 3 | Kerangka di bawah |
| 5 | UI web | Bagian harga + cara tagih di Terima Servis, kartu harga/pembayaran di halaman job teknisi, halaman Setoran, laporan | 1–4 | Kerangka di bawah |
| 6 | Flutter teknisi | Layar harga, edit terbatas, catat pembayaran, Tanda Terima (dikerjakan Syakir dari kontrak API) | 1–4 | Menyusul |

Urutan pengerjaan: 1 → 2 → 3 → 4 → 5 → 6. Rencana 1 aman dirilis sendiri: perilaku order lama tidak berubah (nilai bawaan `ditagih_admin`).

## Keputusan bersama (dipakai konsisten di semua rencana)

- **Nama**: `PaymentMode = 'bayar_di_lokasi' | 'ditagih_admin'` (`src/service-orders/payment-mode.ts`). Status FieldPayment: `dipegang_teknisi | menunggu_cocok | diverifikasi | ditolak`. Saluran bukti: `wa | kertas`.
- **Modul baru** `src/field-payments/` (controller, service, dto, spec) untuk rencana 3–4. Rencana 1–2 hanya menyentuh modul yang ada.
- **Audit** (`audit_logs.action`): `invoice.void_on_cancel`, `job.tech_edit_lines`, `field_payment.create`, `field_payment.receipt_sent`, `field_payment.verify`, `field_payment.reject`, `settlement.create`, `settlement.difference_closed`.
- **Nomor Tanda Terima**: `TT-YYYYMMDD-NNNN` dari `CountersService.nextSeq(tx, 'tanda_terima_<dateKey>')` (pola sama dengan nomor invoice).
- **Pesan galat** berbahasa Indonesia kasual, mengikuti gaya kode sekarang. Otorisasi di backend (JwtAuthGuard + RolesGuard); kepemilikan job lewat assignees (`isJobAssignee`), bukan `technicianId`.
- **Aturan kerja repo**: file CRLF (pakai Edit; untuk penggantian multi-baris yang gagal, pakai skrip Node); komentar kode Bahasa Indonesia; migrasi baru saja, jangan edit migrasi lama; commit **tanpa** baris `Co-Authored-By` (preferensi pemilik repo); jangan push tanpa diminta; jangan sentuh `.env`.
- **Verifikasi akhir tiap rencana**: `npx tsc --noEmit`, `npx jest`, lalu `npm run build` di backend; `npm run lint` dan `npm run build` di frontend bila ada perubahan web; cek `git diff` sebelum menyatakan selesai.

## Kerangka rencana 2–6 (belum dirinci)

**Rencana 2 — Harga jasa untuk teknisi.** File utama: `technician-jobs/service-pricing.service.ts` (+ method `getForTechnician`, `techEdit`), `technician-jobs.controller.ts` (rute `GET :id/service-pricing` dibuka untuk teknisi assignee dengan proyeksi sempit; `PATCH :id/service-lines`), DTO baru `tech-edit-lines.dto.ts`, migrasi `job_service_lines` (`source`, `is_custom`, `change_reason`) + kolom penanda pada order/job. Aturan: harga satuan baris katalog = `Service.basePrice` terkunci; "jasa lain" butuh nama, harga, alasan; hapus/ubah jumlah butuh alasan; transport dan diskon tidak bisa diubah; terkunci setelah ada FieldPayment aktif (hook disediakan rencana 3). Tes: aturan kunci harga katalog, penanda `isCustom`, alasan wajib, assignee lain boleh, orang luar ditolak.

**Rencana 3 — Pembayaran lapangan + Tanda Terima.** Migrasi `field_payments`, enum `WhatsappMessageKind.tanda_terima`. `field-payments.service.ts`: `record` (batas `amount ≤ sisa − FieldPayment aktif`, gerbang sparepart final: tidak ada `material_requests` `pending` dan semua `approved` punya `used_at`; foto bukti wajib; `clientRef` idempoten; status awal sesuai metode), `sendReceipt` (lewat `WhatsappService`, pelanggan tanpa HP valid → saluran `kertas`). `WhatsappService.sendInvoiceMessage` dilonggarkan agar menerima `kind`. Penjaga di `PaymentsService.record` terhadap FieldPayment aktif. Gerbang Ajukan Selesai di `submitForReview` / `submitOrderForReview` untuk order `bayar_di_lokasi` (pembayaran tercatat **atau** alasan tertulis). Pembatalan job: perluas `assertLastJobCancelAllowed` (rencana 1) agar menolak bila ada FieldPayment aktif; kunci edit jasa teknisi (rencana 2).

**Rencana 4 — Setoran dan verifikasi.** Migrasi `cash_settlements`, `technician_cash_ledger` (selisih kurang/lebih, status terbuka/ditutup, alasan). `settlements.service.ts`: `pending`, `create` (verifikasi penuh → `ManualPayment` lewat fungsi apply yang dipecah dari `PaymentsService.record`; pas → Selesai; kurang → Catat kurang atau Selesai dengan alasan (admin, ≥10 karakter, audit); lebih sama), `repay` (pelunasan selisih), `verify`/`reject` non-tunai, `onBehalf` (dari kertas), `sparepartReturns`. Cron `cash_overdue` 09:00 WIB (pola `notifyAdminsServiceDue`). Laporan `GET /reports/technician-cash`.

**Rencana 5 — UI web.** `service-orders/intake/intake-client.tsx` (bagian Jasa & Harga Perkiraan + cara tagih), `edit-order-dialog.tsx` (cara tagih), `teknisi/jobs/[id]/job-detail-client.tsx` (kartu harga teknisi, Catat Pembayaran, Kirim Tanda Terima), halaman `/setoran` (+ `nav-config`), laporan Uang di Teknisi, label "Batal" di struk publik. Cek `next` docs di `node_modules/next/dist/docs/` sebelum menulis (AGENTS.md).

**Rencana 6 — Flutter.** Kontrak API dibekukan setelah rencana 4; Syakir mengerjakan layar teknisi.
