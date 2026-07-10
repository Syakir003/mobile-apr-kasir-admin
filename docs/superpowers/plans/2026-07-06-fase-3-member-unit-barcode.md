# Fase 3 — Member, Unit AC, Barcode: Implementation Plan

**Goal:** CRUD member (HP unik), unit AC per member, generate barcode unik via Cloud Function, cetak label PDF (QR), dan layar scan barcode dengan fallback input manual.

**Dependensi baru pubspec (SATU-SATUNYA perubahan pubspec, versi persis ini):**
`mobile_scanner: ^6.0.2`, `pdf: ^3.11.1`, `printing: ^5.13.2`. Developer menjalankan `flutter pub get` setelah sync. Untuk iOS perlu NSCameraUsageDescription (didokumentasikan, folder ios gitignored).

## Task A: Util + model
- `app/lib/core/utils/phone.dart`: `String normalizePhone(String raw)` — buang spasi/strip/titik/kurung, `08x`→`+628x`, `628x`→`+628x`, `8x`→`+628x`, sudah `+62`→tetap; selain itu kembalikan apa adanya (setelah dibersihkan). + test tabel kasus di `app/test/core/phone_test.dart`.
- `app/lib/data/models/member.dart` (members): id, name, phone (tersimpan ternormalisasi), address, customerType ('rumah'|'kantor'|'toko'|'perusahaan'|'lainnya' → `kCustomerTypes`), memberSince (DateTime? — Timestamp di Firestore, null saat create manual sebelum transaksi), totalAcUnits (int, default 0), notes (String?), active (bool). fromMap menerima Timestamp/null utk memberSince (cek `is Timestamp`).
- `app/lib/data/models/ac_unit.dart` (member_ac_units): id, memberId, brand, model, pk (double), roomLocation, barcodeValue (String, '' sebelum digenerate), serialNumber (String?), installationDate (DateTime?), lastServiceDate (DateTime?), nextServiceDate (DateTime?), status (`AcUnitStatus` enum: menungguPemasangan/aktif/dalamMaintenance/rusak/nonaktif — simpan sebagai string snake_case: 'menunggu_pemasangan','aktif','dalam_maintenance','rusak','nonaktif'; `AcUnitStatus.fromValue` + `.value` + `.label` Indonesia).
- Test roundtrip kedua model di `app/test/data/member_ac_unit_test.dart` (tanpa import cloud_firestore di test — fromMap terima `Object?` utk field tanggal; gunakan helper `DateTime? _toDate(Object? v)` yang menangani Timestamp/DateTime/null).

## Task B: Cloud Function generateAcUnitBarcode (TDD vitest)
- `functions/src/units/barcode.ts`: pure `formatBarcode(date: Date, seq: number): string` → `ACUNIT-YYYYMMDD-XXXX` (seq pad 4). Test `barcode.test.ts`: 2026-07-06 seq 1 → 'ACUNIT-20260706-0001'; seq 1234 → '...-1234'; pad benar.
- `functions/src/units/generateBarcode.ts`: callable `generateAcUnitBarcode` — role admin/kasir saja; input `{unitId: string}`; transaction: baca `counters/acunit_YYYYMMDD`, seq = (data.seq ?? 0)+1, tulis seq, update `member_ac_units/{unitId}.barcode_value` = formatBarcode (tolak jika unit tidak ada / barcode_value sudah terisi → HttpsError failed-precondition). Return `{barcode}`.
- Export di `functions/src/index.ts`. `npm test` (6 test total: 4 lama + 2 baru) dan `npm run build` harus lulus DI SANDBOX (jalankan!).

## Task C: Repositori + providers
- `app/lib/data/repositories/ac_unit_repository.dart`: `abstract interface class AcUnitRepository { Stream<List<AcUnit>> watchByMember(String memberId); Future<AcUnit?> findByBarcode(String value); Future<String> create(AcUnit u); Future<void> update(String id, AcUnit u); }` + `FirestoreAcUnitRepository` (query where member_id / where barcode_value limit 1).
- `app/lib/features/members/member_providers.dart`: memberRepositoryProvider (FirestoreCrudRepository<Member> koleksi members), membersStreamProvider, acUnitRepositoryProvider, memberUnitsProvider = StreamProvider.family<List<AcUnit>, String>.
- Fake: `app/test/support/fake_ac_unit_repository.dart` (pola sama FakeCrudRepository, scheduleMicrotask emit).

## Task D: UI Member + Unit
- `/members` list (MasterListScaffold reuse: title name, subtitle phone, badge nonaktif) → form member (`/members/new`, `/members/:id/edit`): name & phone wajib (phone disimpan `normalizePhone`; validasi duplikat: query members where phone == hasil normalisasi via repo — tambah method di provider level pakai FirebaseFirestore langsung? TIDAK — cukup cek dari snapshot list yang sudah di-watch (membersStreamProvider.value) untuk MVP; tulis komentar bahwa keunikan keras dijamin Function checkout Fase 4), address, dropdown customerType, notes, switch aktif.
- `/members/:id` detail: kartu info member + daftar unit AC (memberUnitsProvider) + FAB tambah unit → `/members/:id/units/new`, tap unit → edit `/members/:id/units/:unitId/edit`. Form unit: brand/model wajib, pk (dropdown 0.5/0.75/1/1.5/2 → double), roomLocation, serialNumber, dropdown status (default menungguPemasangan), tanggal SKIP (fase servis yang mengisi). Simpan create → lalu panggil `generateAcUnitBarcode` cloud function (cloud_functions: FirebaseFunctions.instance.httpsCallable) dengan unitId hasil create; tampilkan barcode di SnackBar; gagal → SnackBar merah tapi unit tetap tersimpan (barcode bisa digenerate ulang dari tombol di form edit bila barcodeValue kosong).
- Tombol "Cetak Label" di form edit unit (hanya bila barcodeValue terisi): buat PDF A6 via `pdf` (qrcode: `BarcodeWidget`? di paket pdf: `pw.BarcodeWidget(barcode: pw.Barcode.qrCode(), data: barcodeValue)`) berisi QR + barcodeValue + brand/model/roomLocation + nama toko 'Ayub Podo Rukun'; tampilkan via `printing`: `Printing.layoutPdf(onLayout: ...)`.
- Update `member_detail`: tampilkan barcodeValue tiap unit di subtitle.

## Task E: Scan + routing + rules
- `/scan` screen (`app/lib/features/scan/scan_screen.dart`): `MobileScanner(onDetect: ...)` + TextField input manual + tombol Cari. Hasil (barcode string) → `acUnitRepository.findByBarcode(normalized trim)`; ketemu → bottom sheet info unit (brand, model, pk, lokasi, status label, barcode) + tombol "Buka Member" → `/members/:memberId`; tidak ketemu → SnackBar 'Barcode tidak ditemukan'. Sederhana, tanpa validasi job (itu Fase 5).
- Router: routes members (list/new/:id(detail)/:id/edit/:id/units/new/:id/units/:unitId/edit) + /scan dalam ShellRoute. Guard: tambah '/members' ke prefix admin-only. '/scan' cukup login (semua role).
- adaptive_scaffold: admin dapat destinasi Member(/members) dan Scan(/scan) (jadi 7); teknisi dapat Scan (jadi 2: Dashboard, Scan); kasir tetap 1. Update test destinationsForRole (admin 7, teknisi 2, kasir 1).
- redirect_test: tambah kasus '/members' kasir → '/', '/scan' teknisi → null.
- `firestore.rules`: members & member_ac_units (read: signedIn; write: admin); counters (read/write: false — hanya Functions).
- Widget tests: member form validasi+create (pola product form, viewport tinggi), scan screen SKIP widget test (butuh kamera — cukup unit test `findByBarcode` fake + test normalizePhone).

## Commits
"feat(app): util telepon + model member & unit ac", "feat(functions): generateAcUnitBarcode dengan counter harian", "feat(app): repositori & providers member/unit", "feat(app): ui member, unit ac, label pdf", "feat(app): layar scan + routing + rules fase 3".

## Definisi Selesai
`npm test` 6 lulus di sandbox; di mesin dev: `flutter pub get`, `analyze` bersih, `flutter test` lulus; alur: buat member → tambah unit → barcode tergenerate (emulator) → cetak label PDF → scan/input manual menemukan unit.
