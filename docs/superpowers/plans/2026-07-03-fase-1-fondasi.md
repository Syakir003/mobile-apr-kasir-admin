# Fase 1 — Fondasi: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold monorepo E-POS AC (Flutter Android/iOS/Web + Cloud Functions + rules + emulator) dengan login Firebase Auth, role Admin/Kasir/Teknisi via custom claims, tema teal, router dengan guard role, dan shell layout responsif.

**Architecture:** Satu codebase Flutter (Riverpod + go_router) yang bicara ke Firebase. Logika kritis di Cloud Functions (TypeScript). Development penuh di Firebase Emulator Suite. Lihat spec: `docs/superpowers/specs/2026-07-03-epos-ac-design.md`.

**Tech Stack:** Flutter 3.x (Dart 3), flutter_riverpod, go_router, firebase_core/auth/cloud_firestore/storage/cloud_functions, Cloud Functions TypeScript (Node 20, firebase-functions v2), vitest, Firebase Emulator Suite.

**Catatan lingkungan:** Perintah ditulis untuk shell POSIX. Di Windows PowerShell ganti `&&` dengan `;` bila perlu. Git dijalankan di mesin developer (mount Cowork tidak mendukung operasi lock git — lakukan `git init` di folder proyek di Windows sekali di awal).

---

### Task 0: Prasyarat lingkungan

**Files:** tidak ada (verifikasi tooling).

- [ ] **Step 1: Verifikasi tooling terpasang**

Run:
```bash
flutter --version   # butuh 3.22+ (Dart 3.4+)
node --version      # butuh v20+
java -version       # butuh 11+ (untuk Firestore emulator)
npm i -g firebase-tools && firebase --version   # butuh 13+
```
Expected: semua perintah mencetak versi. Jika `flutter` belum ada: https://docs.flutter.dev/get-started/install ; jika `java` belum ada: pasang Temurin 17.

- [ ] **Step 2: Git init (sekali, di mesin developer)**

Run:
```bash
cd "D:\E-POS Admin, Kasir dan Teknisi Ayub Podo Rukun"
git init -b main
git add docs/ && git commit -m "docs: spec dan plan fase 1"
```
Expected: commit pertama berhasil.

---

### Task 1: Scaffold Flutter app + dependensi

**Files:**
- Create: `app/` (via `flutter create`)
- Modify: `app/pubspec.yaml`

- [ ] **Step 1: Buat project Flutter**

Run (dari root proyek):
```bash
flutter create app --platforms=android,ios,web --org com.ayubpodorukun --project-name epos_ac
```
Expected: folder `app/` berisi project. Hapus komentar bawaan `app/lib/main.dart` nanti di Task 4.

- [ ] **Step 2: Tambah dependensi di `app/pubspec.yaml`**

Ganti blok `dependencies:` dan `dev_dependencies:` menjadi:

```yaml
dependencies:
  flutter:
    sdk: flutter
  firebase_core: ^3.6.0
  firebase_auth: ^5.3.1
  cloud_firestore: ^5.4.4
  firebase_storage: ^12.3.4
  cloud_functions: ^5.1.3
  flutter_riverpod: ^2.5.1
  go_router: ^14.3.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
```

- [ ] **Step 3: Resolve dependensi**

Run: `cd app && flutter pub get`
Expected: `Got dependencies!` tanpa error resolusi.

- [ ] **Step 4: Commit**

```bash
git add app/ && git commit -m "chore: scaffold flutter app + dependensi firebase/riverpod/go_router"
```

---

### Task 2: Konfigurasi Firebase project + emulator

**Files:**
- Create: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`

- [ ] **Step 1: Buat file `firebase.json` di root**

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "functions": [{ "source": "functions", "codebase": "default", "runtime": "nodejs20" }],
  "hosting": { "public": "app/build/web", "ignore": ["**/.*"] },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "storage": { "port": 9199 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

- [ ] **Step 2: Buat `.firebaserc`** (project ID diisi setelah project Firebase dibuat di console; emulator tetap jalan dengan demo project)

```json
{ "projects": { "default": "demo-epos-ac" } }
```

- [ ] **Step 3: Buat `firestore.rules` skeleton (default tolak semua, users read-only)**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }

    match /users/{uid} {
      allow read: if signedIn() && (request.auth.uid == uid || role() == 'admin');
      allow write: if false;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 4: Buat `firestore.indexes.json` dan `storage.rules`**

`firestore.indexes.json`:
```json
{ "indexes": [], "fieldOverrides": [] }
```

`storage.rules`:
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add firebase.json .firebaserc firestore.rules firestore.indexes.json storage.rules
git commit -m "chore: konfigurasi firebase + emulator + rules skeleton"
```

---

### Task 3: Scaffold Cloud Functions + validasi manageUser (TDD)

**Files:**
- Create: `functions/package.json`, `functions/tsconfig.json`, `functions/vitest.config.ts`
- Create: `functions/src/users/validation.ts`, `functions/src/users/manageUser.ts`, `functions/src/index.ts`
- Test: `functions/src/users/validation.test.ts`

- [ ] **Step 1: Buat `functions/package.json`**

```json
{
  "name": "epos-ac-functions",
  "engines": { "node": "20" },
  "main": "lib/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "serve": "npm run build && firebase emulators:start"
  },
  "dependencies": {
    "firebase-admin": "^12.6.0",
    "firebase-functions": "^6.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Buat `functions/tsconfig.json` dan `functions/vitest.config.ts`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs", "target": "es2022", "moduleResolution": "node",
    "outDir": "lib", "rootDir": "src", "strict": true,
    "esModuleInterop": true, "skipLibCheck": true, "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3: Install**

Run: `cd functions && npm install`
Expected: node_modules terpasang tanpa error. Tambah `functions/node_modules` + `functions/lib` ke `.gitignore` root:

```
functions/node_modules/
functions/lib/
.firebase/
```

- [ ] **Step 4: Tulis failing test `functions/src/users/validation.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { validateManageUserInput } from "./validation";

describe("validateManageUserInput", () => {
  it("menerima input valid", () => {
    const r = validateManageUserInput({
      action: "create", email: "kasir@toko.id", password: "rahasia123",
      displayName: "Kasir Satu", role: "kasir",
    });
    expect(r.ok).toBe(true);
  });
  it("menolak role tidak dikenal", () => {
    const r = validateManageUserInput({
      action: "create", email: "a@b.c", password: "12345678",
      displayName: "X", role: "superadmin",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/role/i);
  });
  it("menolak password pendek saat create", () => {
    const r = validateManageUserInput({
      action: "create", email: "a@b.c", password: "123",
      displayName: "X", role: "teknisi",
    });
    expect(r.ok).toBe(false);
  });
  it("menerima disable tanpa password", () => {
    const r = validateManageUserInput({ action: "disable", uid: "abc123" });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 5: Jalankan test, pastikan gagal**

Run: `npm test`
Expected: FAIL — `Cannot find module './validation'`.

- [ ] **Step 6: Implement `functions/src/users/validation.ts`**

```ts
export type ManageUserInput = {
  action: "create" | "disable" | "enable";
  uid?: string;
  email?: string;
  password?: string;
  displayName?: string;
  role?: string;
};

export type ValidationResult =
  | { ok: true; value: ManageUserInput }
  | { ok: false; error: string };

const ROLES = ["admin", "kasir", "teknisi"] as const;

export function validateManageUserInput(input: ManageUserInput): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Input kosong" };
  if (!["create", "disable", "enable"].includes(input.action))
    return { ok: false, error: "Action tidak dikenal" };

  if (input.action === "create") {
    if (!input.email || !/^\S+@\S+\.\S+$/.test(input.email))
      return { ok: false, error: "Email tidak valid" };
    if (!input.password || input.password.length < 8)
      return { ok: false, error: "Password minimal 8 karakter" };
    if (!input.displayName?.trim()) return { ok: false, error: "Nama wajib diisi" };
    if (!ROLES.includes(input.role as (typeof ROLES)[number]))
      return { ok: false, error: "Role harus admin/kasir/teknisi" };
  } else {
    if (!input.uid) return { ok: false, error: "uid wajib untuk disable/enable" };
  }
  return { ok: true, value: input };
}
```

- [ ] **Step 7: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: 4 passed.

- [ ] **Step 8: Implement callable `functions/src/users/manageUser.ts`**

```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { validateManageUserInput, ManageUserInput } from "./validation";

export const manageUser = onCall(async (request) => {
  if (request.auth?.token?.role !== "admin")
    throw new HttpsError("permission-denied", "Hanya Admin");

  const v = validateManageUserInput(request.data as ManageUserInput);
  if (!v.ok) throw new HttpsError("invalid-argument", v.error);
  const input = v.value;

  const auth = getAuth();
  const db = getFirestore();

  if (input.action === "create") {
    const user = await auth.createUser({
      email: input.email, password: input.password, displayName: input.displayName,
    });
    await auth.setCustomUserClaims(user.uid, { role: input.role });
    await db.doc(`users/${user.uid}`).set({
      email: input.email, display_name: input.displayName, role: input.role,
      active: true, created_at: FieldValue.serverTimestamp(),
    });
    await db.collection("audit_logs").add({
      actor_uid: request.auth!.uid, action: "user.create",
      target: user.uid, detail: { role: input.role },
      at: FieldValue.serverTimestamp(),
    });
    return { uid: user.uid };
  }

  const disabled = input.action === "disable";
  await auth.updateUser(input.uid!, { disabled });
  await db.doc(`users/${input.uid}`).update({ active: !disabled });
  await db.collection("audit_logs").add({
    actor_uid: request.auth!.uid, action: `user.${input.action}`,
    target: input.uid, at: FieldValue.serverTimestamp(),
  });
  return { uid: input.uid };
});
```

- [ ] **Step 9: Buat `functions/src/index.ts`**

```ts
import { initializeApp } from "firebase-admin/app";
initializeApp();

export { manageUser } from "./users/manageUser";
```

- [ ] **Step 10: Build + verifikasi kompilasi**

Run: `npm run build`
Expected: sukses tanpa error TypeScript, folder `functions/lib/` terbentuk.

- [ ] **Step 11: Commit**

```bash
git add functions/ .gitignore
git commit -m "feat(functions): scaffold + manageUser callable dengan validasi ter-test"
```

---

### Task 4: Tema teal + entrypoint aplikasi

**Files:**
- Create: `app/lib/core/theme/app_theme.dart`
- Create: `app/lib/core/firebase/firebase_bootstrap.dart`
- Modify: `app/lib/main.dart` (ganti isi bawaan)
- Test: `app/test/core/app_theme_test.dart`

- [ ] **Step 1: Tulis failing test `app/test/core/app_theme_test.dart`**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/theme/app_theme.dart';
import 'package:flutter/material.dart';

void main() {
  test('warna utama sesuai dokumen fitur (teal #0F766E)', () {
    final theme = AppTheme.light();
    expect(theme.colorScheme.primary, const Color(0xFF0F766E));
    expect(theme.colorScheme.error, const Color(0xFFDC2626));
    expect(theme.scaffoldBackgroundColor, const Color(0xFFF8FAFC));
  });
}
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `cd app && flutter test test/core/app_theme_test.dart`
Expected: FAIL — file `app_theme.dart` belum ada.

- [ ] **Step 3: Implement `app/lib/core/theme/app_theme.dart`** (palet bab 5.20 dokumen fitur)

```dart
import 'package:flutter/material.dart';

abstract final class AppColors {
  static const primaryTeal = Color(0xFF0F766E);
  static const darkTeal = Color(0xFF115E59);
  static const softTeal = Color(0xFFCCFBF1);
  static const accentCyan = Color(0xFF06B6D4);
  static const background = Color(0xFFF8FAFC);
  static const textPrimary = Color(0xFF0F172A);
  static const textSecondary = Color(0xFF64748B);
  static const danger = Color(0xFFDC2626);
  static const warning = Color(0xFFF59E0B);
  static const success = Color(0xFF16A34A);
}

abstract final class AppTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.primaryTeal,
    ).copyWith(
      primary: AppColors.primaryTeal,
      secondary: AppColors.accentCyan,
      error: AppColors.danger,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.primaryTeal,
        foregroundColor: Colors.white,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(backgroundColor: AppColors.primaryTeal),
      ),
    );
  }
}
```

- [ ] **Step 4: Run test, pastikan lulus**

Run: `flutter test test/core/app_theme_test.dart`
Expected: PASS.

- [ ] **Step 5: Buat `app/lib/core/firebase/firebase_bootstrap.dart`** (koneksi emulator saat debug)

```dart
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';

Future<void> bootstrapFirebase({required FirebaseOptions options}) async {
  await Firebase.initializeApp(options: options);
  if (kDebugMode) {
    const host = 'localhost';
    await FirebaseAuth.instance.useAuthEmulator(host, 9099);
    FirebaseFirestore.instance.useFirestoreEmulator(host, 8080);
    FirebaseFunctions.instance.useFunctionsEmulator(host, 5001);
    await FirebaseStorage.instance.useStorageEmulator(host, 9199);
  }
}
```

Catatan: `FirebaseOptions` dihasilkan oleh `flutterfire configure` saat project Firebase asli dibuat. Untuk emulator, jalankan `flutterfire configure --project=demo-epos-ac` ATAU buat `app/lib/firebase_options.dart` manual dengan nilai dummy:

```dart
import 'package:firebase_core/firebase_core.dart';

class DefaultFirebaseOptions {
  static const FirebaseOptions currentPlatform = FirebaseOptions(
    apiKey: 'demo', appId: '1:demo:web:demo', messagingSenderId: 'demo',
    projectId: 'demo-epos-ac',
  );
}
```

- [ ] **Step 6: Ganti `app/lib/main.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/firebase/firebase_bootstrap.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await bootstrapFirebase(options: DefaultFirebaseOptions.currentPlatform);
  runApp(const ProviderScope(child: EposApp()));
}

class EposApp extends ConsumerWidget {
  const EposApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      title: 'E-POS AC',
      theme: AppTheme.light(),
      routerConfig: router,
    );
  }
}
```

(`appRouterProvider` dibuat di Task 6 — `main.dart` baru compile setelah Task 6; itu urutan yang disengaja, jalankan `flutter analyze` penuh di Task 6.)

- [ ] **Step 7: Commit**

```bash
git add app/lib app/test
git commit -m "feat(app): tema teal sesuai dokumen + bootstrap firebase emulator"
```

---

### Task 5: Model AppUser + AuthRepository (TDD)

**Files:**
- Create: `app/lib/data/models/app_user.dart`
- Create: `app/lib/data/repositories/auth_repository.dart`
- Test: `app/test/data/app_user_test.dart`

- [ ] **Step 1: Tulis failing test `app/test/data/app_user_test.dart`**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/data/models/app_user.dart';

void main() {
  test('UserRole.fromClaim memetakan string ke enum', () {
    expect(UserRole.fromClaim('admin'), UserRole.admin);
    expect(UserRole.fromClaim('kasir'), UserRole.kasir);
    expect(UserRole.fromClaim('teknisi'), UserRole.teknisi);
    expect(UserRole.fromClaim('lainnya'), isNull);
    expect(UserRole.fromClaim(null), isNull);
  });

  test('AppUser menyimpan identitas dasar', () {
    const u = AppUser(uid: 'u1', email: 'a@b.c', displayName: 'Ana', role: UserRole.kasir);
    expect(u.role, UserRole.kasir);
    expect(u.uid, 'u1');
  });
}
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `flutter test test/data/app_user_test.dart`
Expected: FAIL — file belum ada.

- [ ] **Step 3: Implement `app/lib/data/models/app_user.dart`**

```dart
enum UserRole {
  admin,
  kasir,
  teknisi;

  static UserRole? fromClaim(Object? claim) => switch (claim) {
        'admin' => UserRole.admin,
        'kasir' => UserRole.kasir,
        'teknisi' => UserRole.teknisi,
        _ => null,
      };
}

class AppUser {
  const AppUser({
    required this.uid,
    required this.email,
    required this.displayName,
    required this.role,
  });

  final String uid;
  final String email;
  final String displayName;
  final UserRole role;
}
```

- [ ] **Step 4: Run test, pastikan lulus**

Run: `flutter test test/data/app_user_test.dart`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement `app/lib/data/repositories/auth_repository.dart`**

```dart
import 'package:firebase_auth/firebase_auth.dart' as fb;

import '../models/app_user.dart';

abstract interface class AuthRepository {
  Stream<AppUser?> watchCurrentUser();
  Future<void> signIn({required String email, required String password});
  Future<void> signOut();
}

class FirebaseAuthRepository implements AuthRepository {
  FirebaseAuthRepository(this._auth);
  final fb.FirebaseAuth _auth;

  @override
  Stream<AppUser?> watchCurrentUser() {
    return _auth.idTokenChanges().asyncMap((user) async {
      if (user == null) return null;
      final token = await user.getIdTokenResult();
      final role = UserRole.fromClaim(token.claims?['role']);
      if (role == null) return null; // akun tanpa role tidak boleh masuk
      return AppUser(
        uid: user.uid,
        email: user.email ?? '',
        displayName: user.displayName ?? '',
        role: role,
      );
    });
  }

  @override
  Future<void> signIn({required String email, required String password}) =>
      _auth.signInWithEmailAndPassword(email: email, password: password);

  @override
  Future<void> signOut() => _auth.signOut();
}
```

- [ ] **Step 6: Commit**

```bash
git add app/lib/data app/test/data
git commit -m "feat(app): model AppUser + AuthRepository dengan mapping role claim"
```

---

### Task 6: Router + guard role (TDD pada fungsi redirect murni)

**Files:**
- Create: `app/lib/core/router/redirect.dart`
- Create: `app/lib/core/router/app_router.dart`
- Test: `app/test/core/redirect_test.dart`

- [ ] **Step 1: Tulis failing test `app/test/core/redirect_test.dart`**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/router/redirect.dart';
import 'package:epos_ac/data/models/app_user.dart';

const kasir = AppUser(uid: 'u', email: 'e', displayName: 'd', role: UserRole.kasir);

void main() {
  test('belum login diarahkan ke /login', () {
    expect(computeRedirect(user: null, loading: false, location: '/'), '/login');
  });
  test('belum login boleh tetap di /login', () {
    expect(computeRedirect(user: null, loading: false, location: '/login'), isNull);
  });
  test('sudah login tidak boleh di /login', () {
    expect(computeRedirect(user: kasir, loading: false, location: '/login'), '/');
  });
  test('saat auth masih loading, jangan redirect', () {
    expect(computeRedirect(user: null, loading: true, location: '/'), isNull);
  });
  test('sudah login di halaman lain: tidak redirect', () {
    expect(computeRedirect(user: kasir, loading: false, location: '/'), isNull);
  });
}
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `flutter test test/core/redirect_test.dart`
Expected: FAIL.

- [ ] **Step 3: Implement `app/lib/core/router/redirect.dart`**

```dart
import '../../data/models/app_user.dart';

String? computeRedirect({
  required AppUser? user,
  required bool loading,
  required String location,
}) {
  if (loading) return null;
  final loggedIn = user != null;
  final atLogin = location == '/login';
  if (!loggedIn) return atLogin ? null : '/login';
  if (atLogin) return '/';
  return null;
}
```

- [ ] **Step 4: Run test, pastikan lulus**

Run: `flutter test test/core/redirect_test.dart`
Expected: 5 passed.

- [ ] **Step 5: Implement `app/lib/core/router/app_router.dart`**

```dart
import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../data/models/app_user.dart';
import '../../data/repositories/auth_repository.dart';
import '../../features/auth/login_screen.dart';
import '../../features/dashboard/dashboard_screen.dart';
import '../widgets/adaptive_scaffold.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => FirebaseAuthRepository(fb.FirebaseAuth.instance),
);

final currentUserProvider = StreamProvider<AppUser?>(
  (ref) => ref.watch(authRepositoryProvider).watchCurrentUser(),
);

final appRouterProvider = Provider<GoRouter>((ref) {
  final userAsync = ref.watch(currentUserProvider);
  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) => computeRedirectFromAsync(userAsync, state.matchedLocation),
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      ShellRoute(
        builder: (_, __, child) => AdaptiveScaffold(child: child),
        routes: [
          GoRoute(path: '/', builder: (_, __) => const DashboardScreen()),
        ],
      ),
    ],
  );
});

String? computeRedirectFromAsync(AsyncValue<AppUser?> userAsync, String location) {
  return switch (userAsync) {
    AsyncData(:final value) => _r(value, false, location),
    AsyncLoading() => _r(null, true, location),
    _ => _r(null, false, location),
  };
}

String? _r(AppUser? user, bool loading, String location) => computeRedirect(
      user: user, loading: loading, location: location);
```

Tambahkan import `redirect.dart` di atas:
```dart
import 'redirect.dart';
```

- [ ] **Step 6: Commit**

```bash
git add app/lib/core/router app/test/core
git commit -m "feat(app): router go_router dengan guard login ter-test"
```

---

### Task 7: Layar login (TDD widget test dengan fake repository)

**Files:**
- Create: `app/lib/features/auth/login_screen.dart`
- Test: `app/test/features/auth/login_screen_test.dart`

- [ ] **Step 1: Tulis failing test `app/test/features/auth/login_screen_test.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/router/app_router.dart';
import 'package:epos_ac/data/models/app_user.dart';
import 'package:epos_ac/data/repositories/auth_repository.dart';
import 'package:epos_ac/features/auth/login_screen.dart';

class FakeAuthRepository implements AuthRepository {
  String? lastEmail;
  String? lastPassword;
  bool failNext = false;

  @override
  Stream<AppUser?> watchCurrentUser() => const Stream.empty();

  @override
  Future<void> signIn({required String email, required String password}) async {
    if (failNext) throw Exception('auth gagal');
    lastEmail = email;
    lastPassword = password;
  }

  @override
  Future<void> signOut() async {}
}

Widget host(FakeAuthRepository fake) => ProviderScope(
      overrides: [authRepositoryProvider.overrideWithValue(fake)],
      child: const MaterialApp(home: LoginScreen()),
    );

void main() {
  testWidgets('submit memanggil signIn dengan email & password', (tester) async {
    final fake = FakeAuthRepository();
    await tester.pumpWidget(host(fake));
    await tester.enterText(find.byKey(const Key('email')), 'kasir@toko.id');
    await tester.enterText(find.byKey(const Key('password')), 'rahasia123');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pump();
    expect(fake.lastEmail, 'kasir@toko.id');
    expect(fake.lastPassword, 'rahasia123');
  });

  testWidgets('email kosong menampilkan error validasi', (tester) async {
    final fake = FakeAuthRepository();
    await tester.pumpWidget(host(fake));
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pump();
    expect(find.text('Email wajib diisi'), findsOneWidget);
    expect(fake.lastEmail, isNull);
  });

  testWidgets('kegagalan auth menampilkan snackbar', (tester) async {
    final fake = FakeAuthRepository()..failNext = true;
    await tester.pumpWidget(host(fake));
    await tester.enterText(find.byKey(const Key('email')), 'x@y.z');
    await tester.enterText(find.byKey(const Key('password')), '12345678');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Login gagal'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `flutter test test/features/auth/login_screen_test.dart`
Expected: FAIL — `login_screen.dart` belum ada.

- [ ] **Step 3: Implement `app/lib/features/auth/login_screen.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/app_theme.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    try {
      await ref.read(authRepositoryProvider).signIn(
            email: _email.text.trim(), password: _password.text);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Login gagal. Periksa email dan password.'),
          backgroundColor: AppColors.danger,
        ));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.ac_unit, size: 56, color: AppColors.primaryTeal),
                  const SizedBox(height: 8),
                  Text('E-POS AC', textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 24),
                  TextFormField(
                    key: const Key('email'),
                    controller: _email,
                    decoration: const InputDecoration(labelText: 'Email'),
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'Email wajib diisi' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    key: const Key('password'),
                    controller: _password,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Password'),
                    validator: (v) =>
                        (v == null || v.isEmpty) ? 'Password wajib diisi' : null,
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    key: const Key('submit'),
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            height: 20, width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Masuk'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run test, pastikan lulus**

Run: `flutter test test/features/auth/login_screen_test.dart`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/lib/features/auth app/test/features/auth
git commit -m "feat(app): layar login dengan validasi + error handling ter-test"
```

---

### Task 8: Shell responsif + dashboard placeholder (TDD)

**Files:**
- Create: `app/lib/core/widgets/adaptive_scaffold.dart`
- Create: `app/lib/features/dashboard/dashboard_screen.dart`
- Test: `app/test/core/adaptive_scaffold_test.dart`

- [ ] **Step 1: Tulis failing test `app/test/core/adaptive_scaffold_test.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:epos_ac/core/widgets/adaptive_scaffold.dart';

const _app = MaterialApp(home: AdaptiveScaffold(child: Text('isi')));

void main() {
  testWidgets('layar sempit memakai NavigationBar bawah', (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(_app);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
  });

  testWidgets('layar lebar memakai NavigationRail samping', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(_app);
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
  });
}
```

- [ ] **Step 2: Run test, pastikan gagal**

Run: `flutter test test/core/adaptive_scaffold_test.dart`
Expected: FAIL.

- [ ] **Step 3: Implement `app/lib/core/widgets/adaptive_scaffold.dart`**

```dart
import 'package:flutter/material.dart';

const _destinations = [
  (icon: Icons.dashboard_outlined, label: 'Dashboard'),
  (icon: Icons.person_outline, label: 'Profil'),
];

class AdaptiveScaffold extends StatelessWidget {
  const AdaptiveScaffold({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 600;
    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: 0,
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final d in _destinations)
                  NavigationRailDestination(icon: Icon(d.icon), label: Text(d.label)),
              ],
              onDestinationSelected: (_) {},
            ),
            const VerticalDivider(width: 1),
            Expanded(child: child),
          ],
        ),
      );
    }
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        destinations: [
          for (final d in _destinations)
            NavigationDestination(icon: Icon(d.icon), label: d.label),
        ],
        onDestinationSelected: (_) {},
      ),
    );
  }
}
```

(Destinasi masih statis — daftar menu per role bab 9 dokumen diisi pada fase-fase fitur berikutnya, saat layarnya ada.)

- [ ] **Step 4: Run test, pastikan lulus**

Run: `flutter test test/core/adaptive_scaffold_test.dart`
Expected: 2 passed.

- [ ] **Step 5: Buat `app/lib/features/dashboard/dashboard_screen.dart`** (placeholder + logout)

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/router/app_router.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider).value;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Keluar',
            onPressed: () => ref.read(authRepositoryProvider).signOut(),
          ),
        ],
      ),
      body: Center(
        child: Text(
          user == null ? 'Memuat...' : 'Halo, ${user.displayName} (${user.role.name})',
        ),
      ),
    );
  }
}
```

- [ ] **Step 6: Analyze + semua test**

Run: `flutter analyze && flutter test`
Expected: No issues found; semua test PASS.

- [ ] **Step 7: Commit**

```bash
git add app/lib app/test
git commit -m "feat(app): shell responsif (rail/bottom-nav) + dashboard placeholder"
```

---

### Task 9: Seed admin di emulator + verifikasi end-to-end

**Files:**
- Create: `functions/scripts/seed-admin.mjs`
- Modify: `functions/package.json` (script `seed`)

- [ ] **Step 1: Buat `functions/scripts/seed-admin.mjs`**

```js
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "localhost:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";

initializeApp({ projectId: "demo-epos-ac" });

const email = "admin@eposac.local";
const password = "admin12345";

const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
} catch {
  user = await auth.createUser({ email, password, displayName: "Admin Utama" });
}
await auth.setCustomUserClaims(user.uid, { role: "admin" });
await db.doc(`users/${user.uid}`).set({
  email, display_name: "Admin Utama", role: "admin", active: true,
  created_at: FieldValue.serverTimestamp(),
}, { merge: true });

console.log(`Admin siap: ${email} / ${password} (uid ${user.uid})`);
```

- [ ] **Step 2: Tambah script di `functions/package.json`**

Di bagian `"scripts"` tambahkan:
```json
"seed": "node scripts/seed-admin.mjs"
```

- [ ] **Step 3: Jalankan emulator + seed + aplikasi (verifikasi manual)**

Terminal 1: `firebase emulators:start` — Expected: Auth 9099, Firestore 8080, Functions 5001, Storage 9199, UI 4000 semua jalan.
Terminal 2: `cd functions && npm run seed` — Expected: `Admin siap: admin@eposac.local / admin12345`.
Terminal 3: `cd app && flutter run -d chrome`
Verifikasi: halaman login muncul → login `admin@eposac.local` / `admin12345` → masuk dashboard "Halo, Admin Utama (admin)" → tombol logout kembali ke login. Coba password salah → snackbar "Login gagal".

- [ ] **Step 4: Jalankan seluruh test suite terakhir kali**

Run:
```bash
cd app && flutter analyze && flutter test
cd ../functions && npm test && npm run build
```
Expected: semuanya lulus/bersih.

- [ ] **Step 5: Commit**

```bash
git add functions/
git commit -m "feat(functions): seed admin emulator + verifikasi e2e fase 1"
```

---

## Definisi Selesai Fase 1

- `flutter analyze` bersih; `flutter test` semua lulus; `npm test` functions lulus.
- Emulator suite jalan; login admin seed berhasil di Chrome; guard mengarahkan user belum-login ke `/login`.
- Layout berpindah rail/bottom-nav sesuai lebar layar; tema teal sesuai bab 5.20.
- Setelah fase ini selesai → tulis plan Fase 2 (master data) dengan pola yang sama.
