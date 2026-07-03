# Setup E-POS AC — Fase 1 (Fondasi)

Kode ini dibuat di lingkungan sandbox tanpa Flutter SDK (jaringan pub.dev diblokir),
jadi verifikasi Flutter dijalankan di mesin kamu. Cloud Functions SUDAH dites di sandbox
(vitest 4/4 lulus, tsc bersih).

## 1. Prasyarat
- Flutter 3.22+ (`flutter --version`) — https://docs.flutter.dev/get-started/install
- Node.js 20+ (`node --version`)
- Java 11+ (`java -version`) — untuk Firestore emulator
- Firebase CLI: `npm i -g firebase-tools`

## 2. Git history (opsional tapi disarankan)
Folder ini adalah salinan file. Seluruh riwayat commit ada di `epos-fase1.bundle`.
Jika ada folder `.git` rusak di sini (sisa percobaan awal), hapus dulu, lalu:
```
git clone epos-fase1.bundle epos-ac-repo
```
`epos-ac-repo` berisi repo lengkap dengan 12 commit Fase 1. Atau mulai fresh di folder ini: `git init -b main && git add . && git commit -m "fase 1"`.

## 3. Setup aplikasi Flutter
```
cd app
flutter create . --platforms=android,ios,web --org com.ayubpodorukun --project-name epos_ac
flutter pub get
```
Catatan: `flutter create .` menambah folder android/ios/web tanpa menimpa lib/ yang sudah ada.
Jika ia membuat `test/widget_test.dart`, hapus file itu (test kita sudah lengkap di test/).

## 4. Verifikasi (Definisi Selesai Fase 1)
```
cd app
flutter analyze        # harus: No issues found
flutter test           # harus: semua lulus (13 test)
cd ../functions
npm install && npm test && npm run build   # 4 test lulus, build bersih
```

## 5. Jalankan dengan emulator
Terminal 1 (dari root proyek): `firebase emulators:start`
Terminal 2: `cd functions && npm run seed`   → Admin siap: admin@eposac.local / admin12345
Terminal 3: `cd app && flutter run -d chrome`

Login dengan akun admin seed → dashboard → logout. Password salah → snackbar error.
Emulator UI: http://localhost:4000

## 6. Nanti, saat project Firebase asli dibuat
1. Buat project di https://console.firebase.google.com, upgrade ke paket Blaze.
2. `dart pub global activate flutterfire_cli` lalu `flutterfire configure` di folder app/
   (menimpa `lib/firebase_options.dart` placeholder).
3. Ganti `demo-epos-ac` di `.firebaserc` dengan project ID asli.
4. Deploy (di Fase 8): `firebase deploy --only firestore:rules,storage,functions,hosting`.

## Catatan teknis dari review
- `app_router.dart`: router dibuat ulang tiap auth berubah — aman untuk Fase 1,
  WAJIB diganti pola refreshListenable sebelum menambah route di Fase 2 (ada komentar di file).
- Fase berikutnya: lihat `docs/superpowers/specs/2026-07-03-epos-ac-design.md` bab 8.
