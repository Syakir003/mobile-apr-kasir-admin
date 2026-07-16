# Setup E-POS AC

## Setup Supabase (stack aktif sejak migrasi 2026-07-15)

Backend pindah dari Firebase ke Supabase (PostgreSQL + Auth + Realtime).
Bagian Firebase di bawah dipertahankan hanya sebagai catatan sejarah.

### Prasyarat
- Docker Desktop dengan **WSL integration aktif** (Settings → Resources →
  WSL integration → aktifkan distro kamu) — dipakai `supabase start`.
- Supabase CLI (`supabase --version`, dev machine ini: `~/.local/bin/supabase`).
- Flutter 3.22+ untuk aplikasi.

Akun demo (password semua: `password123`):
`admin@eposac.local` (admin), `kasir@eposac.local` (kasir),
`teknisi@eposac.local` (teknisi).

## Runbook verifikasi migrasi (jalankan berurutan)

> Kode migrasi (5 migrasi SQL + seed + repositori/provider Dart) sudah ditulis
> tapi **belum pernah dijalankan** — lingkungan pembuatan tak punya Docker/Flutter.
> Jalankan langkah 0–9 berurutan; **berhenti dan perbaiki bila ada langkah gagal**
> sebelum lanjut. Langkah 4 & 5 adalah dua asumsi paling kritis (linchpin).

### 0. Aktifkan Docker
```bash
# Docker Desktop → Settings → Resources → WSL integration → aktifkan distro ini.
docker ps                      # harus jalan tanpa error sebelum lanjut
```

### 1. Start stack + terapkan skema
```bash
supabase start                 # pertama kali lama (pull image); catat output:
                               #   API URL, anon key, service_role key
supabase db reset              # DROP + migrations 0001..0005 + seed.sql
```
Perhatikan: `db reset` harus selesai **tanpa error SQL**. Error di sini = bug
migrasi (mis. urutan objek, tipe enum). Simpan `SERVICE_ROLE` & `ANON` dari
output langkah start ke variabel shell untuk langkah berikut:
```bash
export SB=http://127.0.0.1:54321
export ANON="<anon key dari supabase start>"
```

### 2. Verifikasi skema & seed (psql, koneksi langsung = bypass RLS)
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
select number, grand_total, status from invoices order by number;   -- 3 baris INV-...0001..0003
select key, seq from counters order by key;                          -- invoice_20260715=3, acunit_20260715=1
select id, role, active from public.users order by role;             -- admin/kasir/teknisi, active=t
select count(*) from products;                                       -- 4
SQL
```

### 3. Login → dapat access token (uji Auth + signup dimatikan)
```bash
TOKEN=$(curl -s "$SB/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"admin@eposac.local","password":"password123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
echo "$TOKEN" | head -c 20; echo
```

### 4. LINCHPIN A — klaim `user_role` masuk JWT (auth hook)
Seluruh RLS admin/kasir & guard UI bergantung pada klaim ini. Decode payload JWT:
```bash
echo "$TOKEN" | cut -d. -f2 | tr '_-' '/+' \
  | python3 -c 'import sys,base64,json; s=sys.stdin.read().strip(); s+="="*(-len(s)%4); print(json.dumps(json.loads(base64.b64decode(s)),indent=2))' \
  | grep user_role
```
**Harus** muncul `"user_role": "admin"`. Jika tidak → hook `custom_access_token_hook`
tak aktif; cek `[auth.hook.custom_access_token]` di config.toml + grant ke
`supabase_auth_admin` (migrasi 0002), lalu `supabase stop && supabase start`.

### 5. LINCHPIN B — RPC checkout menulis di bawah RLS (SECURITY DEFINER bypass)
```bash
curl -s "$SB/rest/v1/rpc/checkout_transaction" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"payload":{"customer":{"name":"Uji","phone":"08123400001"},
       "items":[{"kind":"service","refId":"30000000-0000-0000-0000-000000000001","qty":1}]}}'
# Harus balik JSON {invoiceId, invoiceNumber:"INV-<hari ini>-0001"|dst, memberId, transactionId}
```
Gagal dengan "permission denied for table invoices/transactions" = asumsi owner
bypass RLS salah → jadikan RPC finansial `security definer` milik role ber-BYPASSRLS
atau beri policy tulis khusus. Uji ulang error paritas: kirim `items:[]` → harus
`"Minimal 1 item wajib diisi"`.

### 6. record_payment + status invoice
```bash
INV="<invoiceId dari langkah 5>"
curl -s "$SB/rest/v1/rpc/record_payment" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"payload\":{\"invoiceId\":\"$INV\",\"method\":\"tunai\",\"amount\":65000}}"
# Harus {status:"lunas", totalPaid:65000}. Bayar lagi → "Melebihi sisa tagihan".
```

### 7. Uji negatif RLS (login sebagai kasir & teknisi, ulangi langkah 3 ganti email)
- **kasir** GET `"$SB/rest/v1/invoices?select=number"` → dapat baris (baca finansial OK).
- **teknisi** GET yang sama → **array kosong** (teknisi tak boleh baca finansial).
- **kasir** POST `"$SB/rest/v1/products"` (insert) → **ditolak** (tulis master admin-only).

### 8. Aplikasi Flutter
```bash
cd app
flutter pub get                 # dependensi berubah: supabase_flutter
flutter analyze && flutter test # analyze bersih; test fake repo tetap lulus
flutter run -d chrome           # emulator Android otomatis pakai 10.0.2.2
```
Login admin → menu master/POS/riwayat jalan. Produksi/perangkat fisik:
`flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...`

### 9. Paritas logika lama (acuan pesan error RPC)
```bash
cd functions && npm test        # vitest util TS = acuan paritas fungsi RPC
```

### 10. Setelah semua hijau — bersihkan sisa Firebase
Baru setelah langkah 0–9 lulus: hapus `firebase.json`, `firestore.rules`,
`.firebaserc`, `firebase_options.dart` (sudah), dan tandai `functions/` sebagai
arsip acuan (jangan deploy). Commit sebagai penutup migrasi.

---

# Arsip: Setup Firebase — Fase 1 (Fondasi)

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

## Catatan iOS (folder ios/ gitignored)
Fase 3 memakai kamera untuk scan barcode (`mobile_scanner`). Saat build iOS,
tambahkan ke `ios/Runner/Info.plist`:
```xml
<key>NSCameraUsageDescription</key>
<string>Kamera dipakai untuk memindai barcode unit AC.</string>
```
Android tidak perlu langkah manual (permission kamera dibawa plugin).

## Catatan teknis dari review
- `app_router.dart`: router dibuat ulang tiap auth berubah — aman untuk Fase 1,
  WAJIB diganti pola refreshListenable sebelum menambah route di Fase 2 (ada komentar di file).
- Fase berikutnya: lihat `docs/superpowers/specs/2026-07-03-epos-ac-design.md` bab 8.
