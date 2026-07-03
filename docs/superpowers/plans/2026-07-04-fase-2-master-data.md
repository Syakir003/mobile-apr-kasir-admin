# Fase 2 — Master Data: Implementation Plan

**Goal:** CRUD master data Admin: produk AC, sparepart/material, jasa, paket instalasi — dengan menu per role, guard admin, dan security rules.

**Catatan pola:** Model memakai class immutable tulis-tangan + fromMap/toMap (BUKAN freezed — codegen tidak bisa jalan di sandbox; deviasi sadar dari ADR-3, dicatat di sini). Uang dalam `int` rupiah. Verifikasi `flutter analyze && flutter test` dilakukan di mesin developer.

## Task A: Refactor router ke refreshListenable (wajib sebelum menambah route — temuan review Fase 1)
- Buat `app/lib/core/router/refresh_stream.dart`: kelas `AuthStateNotifier extends ValueNotifier<AsyncValue<AppUser?>>`? TIDAK — cukup pola: di `appRouterProvider`, buat `ValueNotifier<AsyncValue<AppUser?>>(const AsyncValue.loading())`, `ref.onDispose(notifier.dispose)`, `ref.listen(currentUserProvider, (_, next) => notifier.value = next, fireImmediately: true)`, lalu `GoRouter(refreshListenable: notifier, redirect: (c, s) => computeRedirectFromAsync(notifier.value, s.matchedLocation), ...)`. Router TIDAK lagi watch currentUserProvider → dibuat sekali, navigation stack aman. Hapus komentar CATATAN lama.
- `computeRedirect` diperluas: parameter baru `required UserRole? role`. Aturan baru: lokasi berawalan `/products`, `/spareparts`, `/services`, `/packages` hanya untuk admin; role lain di-redirect ke `/`. Perbarui semua test redirect lama (tambah role) + test baru: kasir buka /products → '/', admin buka /products → null.

## Task B: Data layer master
- `app/lib/data/repositories/crud_repository.dart`:
  `abstract interface class CrudRepository<T> { Stream<List<T>> watchAll(); Future<String> create(T item); Future<void> update(String id, T item); }`
  + `class FirestoreCrudRepository<T> implements CrudRepository<T>` dengan constructor `(FirebaseFirestore db, String collection, T Function(String id, Map<String,dynamic>) fromMap, Map<String,dynamic> Function(T) toMap)`; watchAll = snapshots orderBy('name'); create = add(toMap); update = doc(id).set(toMap).
- Models (semua: `id` String — kosong saat create; `active` bool default true; `toMap` TIDAK memuat id):
  - `product.dart` (koleksi products): name, brand, type, pk (double), inverter (bool), btu (int?), watt (int?), warranty (String?), buyPrice (int), sellPrice (int), stock (int), photoUrl (String?), description (String?), category (String), active. Konstanta `kProductCategories` = ['AC 1/2 PK','AC 3/4 PK','AC 1 PK','AC 1.5 PK','AC 2 PK','Inverter','Non-Inverter','Cassette','Standing Floor'].
  - `sparepart.dart` (spareparts): name, sku, category ('sparepart'|'material'|'aksesoris'|'consumable' → `kSparepartCategories`), unit (`kUnits` = ['pcs','meter','roll','set','kg','tabung','liter']), buyPrice, sellPrice, stock (num), minStock (num), active.
  - `service_item.dart` (services): name, category (String), basePrice (int), durationMinutes (int?), description (String?), active.
  - `installation_package.dart` (installation_packages): name, description (String?), items (List<PackageItem>), active. `PackageItem`: sparepartId, name, qty (num), unit, extraPricePerUnit (int); fromMap/toMap.
- Test roundtrip fromMap/toMap tiap model (`app/test/data/master_models_test.dart`) + `FakeCrudRepository<T>` di `app/test/support/fake_crud_repository.dart` (in-memory, StreamController broadcast + seed awal, expose daftar untuk asersi).

## Task C: Providers + UI
- `app/lib/features/master/master_providers.dart`: `firestoreProvider`, repo provider per entitas (FirestoreCrudRepository dengan fromMap/toMap model), StreamProvider list per entitas.
- `app/lib/features/master/widgets/master_list_scaffold.dart`: widget generik — AppBar(judul), TextField cari (filter by name, case-insensitive), ListView item (title, subtitle, badge Nonaktif bila !active), FAB "+" → onAdd, onTap item → onEdit. Terima `AsyncValue<List<T>>`, `String Function(T) title/subtitle`, `bool Function(T) isActive`, `bool Function(T, String query) matches`.
- Layar per modul di `app/lib/features/master/<entity>/`: `<entity>_list_screen.dart` + `<entity>_form_screen.dart` (Form + validasi: name wajib; angka pakai TextInputType.number + int/num.tryParse wajib valid; dropdown kategori/unit dari konstanta; switch Aktif; tombol Simpan → create/update via repo → pop + SnackBar sukses; error → SnackBar merah). Form paket instalasi: field name/description/switch + daftar item paket (pilih sparepart dari repo sparepart via dropdown, qty, harga ekstra per unit otomatis dari sellPrice sparepart tapi bisa diedit, tombol hapus item, tombol Tambah Item).
- Routes di app_router (dalam ShellRoute): `/products` list, `/products/new`, `/products/:id/edit` (extra: Product), pola sama untuk `/spareparts`, `/services`, `/packages`.
- `adaptive_scaffold.dart`: destinasi per role — admin: Dashboard(/), Produk(/products), Sparepart(/spareparts), Jasa(/services), Paket(/packages); kasir/teknisi: Dashboard saja (fase berikut menambah). Ambil role dari `currentUserProvider` (ConsumerWidget). selectedIndex dari lokasi via `GoRouterState.of(context).matchedLocation` prefix; onDestinationSelected → `context.go(...)`. Update test lama (wrap ProviderScope + override currentUserProvider admin; MaterialApp biasa tanpa router TIDAK bisa lagi karena context.go → test pakai MaterialApp.router dengan GoRouter minimal atau cukup verifikasi jumlah destinasi per role via widget test dengan router dummy).
- Widget tests baru (`app/test/features/master/`): (1) product list menampilkan item dari FakeCrudRepository + filter cari; (2) product form: submit kosong → error validasi, submit valid → create terpanggil dengan nilai benar; (3) adaptive scaffold: admin melihat 5 destinasi, teknisi 1.

## Task D: Rules + commit
- `firestore.rules`: tambah match untuk `products|spareparts|services|installation_packages`: `allow read: if signedIn(); allow write: if role() == 'admin';` (pakai match berulang eksplisit, jangan wildcard).
- Commit bertahap per task: "feat(app): router refreshListenable + guard admin", "feat(app): model + repository master data", "feat(app): ui crud master data + menu per role", "feat: rules master data fase 2".

## Definisi Selesai
`flutter analyze` bersih & `flutter test` lulus di mesin developer; Admin bisa CRUD 4 modul di emulator; kasir/teknisi tidak melihat menu master dan di-redirect dari URL master.
