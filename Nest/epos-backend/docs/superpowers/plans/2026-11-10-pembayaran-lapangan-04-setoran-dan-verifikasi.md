# Setoran dan Verifikasi — Rancangan & Daftar Tugas (rencana 4)

Spesifikasi: `epos-backend/docs/superpowers/specs/2026-11-07-pembayaran-lapangan-teknisi-design.md` (bagian "Setoran harian"). Rencana 1–3 sudah selesai. Dikerjakan langsung di sesi (bukan subagen), TDD per tugas.

**Tujuan:** admin mengubah pembayaran lapangan (`field_payments`) menjadi pelunasan resmi (`ManualPayment` + status invoice) lewat setoran tunai harian dan pencocokan mutasi non-tunai, dengan selisih setoran tercatat, daftar periksa sparepart, pencatatan dari kertas, notifikasi uang tertahan, dan laporan "Uang di Teknisi".

## Keputusan rancangan (melengkapi spesifikasi)

- **Pelunasan = `applyFieldPaymentTx`** (`src/field-payments/apply-field-payment.util.ts`): mengunci invoice, membuat `ManualPayment` (metode sama, `createdById` = admin yang memverifikasi, `shiftId` null, `proofUrl` = bukti teknisi, catatan memuat nomor Tanda Terima), menghitung ulang `total_paid`/`status` lewat `computeInvoiceStatus`, menandai `field_payments` jadi `diverifikasi` (+ `manual_payment_id`, `verified_by/at`). Invoice `batal`/`refund` → 400.
- **Kelebihan karena harga turun** (temuan review rencana 3 #10): bila nominal > sisa tagihan nyata (`grand_total - total_paid`), yang diterapkan hanya sebesar sisa; kelebihan dicatat di buku besar sebagai `kelebihan_pelanggan` (BUKAN utang teknisi; tampil di laporan agar admin mengembalikannya ke pelanggan, belum ada refund otomatis).
- **Penjaga harga turun**: `ServicePricingService.setWithin` menolak (400) bila total invoice baru lebih kecil dari `total_paid` + pembayaran lapangan aktif, supaya Tanda Terima yang sudah beredar tidak menjadi kelebihan bayar.
- **Setoran** (`POST /settlements`): hanya `dipegang_teknisi` + `tunai` milik satu teknisi. `selisih = diterima - seharusnya`. Pas → selesai. Kurang → `mode: catat_kurang` (buku besar `kurang_setor`, saldo teknisi naik) atau `selesai_dengan_alasan` (alasan ≥ 10 karakter, buku besar `ditutup_alasan`, tidak jadi saldo, audit `settlement.difference_closed`). Lebih → `catat_lebih` (`lebih_setor`, saldo turun) atau `selesai_dengan_alasan`. Pembayaran yang tidak dicentang tetap dipegang. Invoice tetap dilunasi PENUH (pelanggan sudah membayar penuh).
- **Buku besar** `technician_cash_ledger` (jumlah bertanda; + = teknisi berutang ke toko): saldo teknisi = jumlah `kurang_setor + lebih_setor + pelunasan`. `ditutup_alasan` dan `kelebihan_pelanggan` tidak ikut saldo (hanya dilaporkan). `POST /settlements/repay` = `pelunasan` (tidak boleh melebihi saldo).
- **Non-tunai**: `POST /field-payments/:id/verify` (Cocok) dan `/reject` (Tolak, alasan ≥ 5 karakter; juga boleh untuk `dipegang_teknisi` yang salah catat). Teknisi dikabari saat ditolak.
- **Dari kertas** (`POST /field-payments/from-paper`, admin): mencatat atas nama teknisi (assignee job), saluran Tanda Terima `kertas`, bukti opsional (`proof_url` jadi nullable), tanpa gerbang status job/sparepart (admin yang memutuskan), tetap dibatasi sisa tagihan; lalu diverifikasi lewat alur yang sama.
- **Sparepart kembali**: `GET /settlements/pending` memuat pengajuan sparepart `approved` milik teknisi yang diputuskan pada tanggal itu (WIB): `qty`, terpakai, `toReturn = qty - terpakai`; catatan admin disimpan di `cash_settlements.sparepart_note`. Murni daftar periksa, tidak mengubah stok.
- **Cron** 09.00 WIB: teknisi yang punya `dipegang_teknisi` dibuat sebelum hari ini → satu notifikasi `cash_overdue` per admin per teknisi per hari (pola `notifyAdminsServiceDue`).
- **Laporan** `GET /settlements/technician-cash`: per teknisi — uang dipegang, umur tertua (hari), saldo, jumlah dan total selisih ditutup dengan alasan (30 hari), kelebihan pelanggan yang belum dikembalikan.

## Tugas

1. Skema + migrasi `20261113000000_settlements`: `field_payments` (+`settlement_id`, `manual_payment_id`, `reject_reason`, `verified_by`, `verified_at`, `entered_by`, `source`, `proof_url` nullable), `cash_settlements`, `technician_cash_ledger`.
2. `apply-field-payment.util.ts` (pelunasan + kelebihan) + tes.
3. `SettlementsService`: `pending`, `settle`, `repay`, `verify`, `reject` + tes.
4. `fromPaper`, `awaiting`, `technicianCash`, cron `cash_overdue` + tes.
5. Controller + modul + pendaftaran, penjaga `setWithin` + tes.
6. Verifikasi menyeluruh, CLAUDE.md.
