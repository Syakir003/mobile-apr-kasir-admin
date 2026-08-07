# Laporan Uji Keamanan — E-POS AC

**Tanggal:** 6 Agustus 2026
**Lingkup:** Backend Supabase (RLS, privilege fungsi, Edge Function, Storage) + gerbang peran di aplikasi Flutter.
**Metode:** Uji penetrasi langsung terhadap database lokal (`supabase_db_epos-ac`), bukan telaah kode saja. Tiap peran disimulasikan dengan klaim JWT asli:

```sql
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"<uid>","role":"authenticated","user_role":"teknisi"}', true);
```

Semua uji dijalankan dalam `begin; … rollback;` sehingga tidak mengubah data.

---

## Ringkasan

| # | Temuan | Tingkat | Status |
|---|--------|---------|--------|
| 1 | 12 fungsi `SECURITY DEFINER` bisa dipanggil `anon` | Sedang | **Diperbaiki** (migrasi 0020) |
| 2 | Satu akun teknisi bisa menarik seluruh basis pelanggan (nama, HP, alamat) | **Tinggi** | **Diperbaiki** (migrasi 0020) |
| 3 | Teknisi bisa membaca job, catatan diagnosa, dan foto lokasi milik teknisi lain | Sedang | **Diperbaiki** (migrasi 0020) |
| 4 | Teknisi bisa membaca seluruh pengajuan material beserta nilai rupiahnya | Sedang | **Diperbaiki** (migrasi 0020) |
| 5 | Harga modal (`buy_price`) terbaca teknisi & kasir → margin bisa dihitung | Sedang | **Diperbaiki** (migrasi 0021) |
| 6 | `jwt_role()` masih terbuka untuk `anon` setelah perbaikan awal | Rendah | **Diperbaiki** (migrasi 0020) |

### Yang diuji dan ternyata sudah aman

Bagian ini penting: sebagian besar pertahanan aplikasi ini memang sudah benar.

- **Seluruh jalur TULIS tertutup rapat.** Teknisi & kasir gagal di setiap percobaan: menaikkan peran sendiri jadi admin, membanting harga produk, mengubah data pelanggan, memalsukan `audit_logs`, menandai invoice lunas. Semua ditolak RLS atau penjaga peran di dalam RPC.
- **Isolasi tulis antar-teknisi utuh.** Teknisi-1 tidak bisa mengubah status job teknisi-2, mengunggah foto ke job orang lain, mengajukan material atas nama job orang lain, atau memakai material pengajuan orang lain. Semua membalas `"Job ini bukan milik Anda"`.
- **`anon` tidak bisa membaca satu tabel pun** — tidak ada `GRANT` sama sekali untuk peran itu.
- **Data finansial tertutup dari teknisi**: `invoices`, `transactions`, `manual_payments`, `stock_movements`, `invoice_adjustments`, `audit_logs` semuanya mengembalikan 0 baris.
- **Bucket Storage `job-photos` privat**, hanya bisa diakses lewat signed URL; unggah dibatasi teknisi/admin.
- **Edge Function `admin-users` benar**: peran pemanggil dicek ke tabel `public.users`, bukan sekadar klaim JWT — jadi admin yang baru dinonaktifkan langsung kehilangan akses. Akun auth yatim dibersihkan bila pembuatan profil gagal.
- **`audit_logs` hanya terbaca admin** (kasir & teknisi: 0 baris).

---

## Detail temuan

### 1. Fungsi `SECURITY DEFINER` terbuka untuk `anon`

**Sebab.** Migrasi 0007–0015 membuat fungsi baru tanpa `revoke execute … from anon, public`. PostgreSQL memberi `EXECUTE` ke `PUBLIC` secara default untuk fungsi baru, dan `anon` mewarisinya. Anon key sendiri bukan rahasia — ia ikut dalam binary aplikasi.

Yang terbuka: `assign_technician_job`, `add_job_photo`, `submit_material_request`, `decide_material_request`, `mark_material_used`, `mark_notifications_read`, `register_device_token`, `unregister_device_token`, `create_service_order`, `enqueue_push`, `handle_new_user`, ditambah beberapa helper.

Menariknya, `record_payment` & `checkout_transaction` tetap aman meski di-replace di 0014/0015 — `create or replace` pada fungsi yang **sudah ada** mempertahankan ACL lama.

**Dampak nyata: terbatas.** Semua fungsi tersebut memeriksa `assert_caller_role` atau `auth.uid()` di badan fungsinya, dan uji membuktikan semuanya menolak pemanggil anonim:

```
anon: rpc create_service_order    -> ditolak: Hanya Admin/Kasir yang boleh membuat order service
anon: rpc submit_material_request -> ditolak: Tidak terautentikasi
anon: rpc enqueue_push            -> ditolak: trigger functions can only be called as triggers
```

Jadi ini lapisan kedua yang hilang, bukan lubang aktif. Tetap ditutup: satu fungsi baru yang lupa memeriksa auth langsung menjadi lubang publik.

**Perbaikan.** Migrasi 0020 mencabut `EXECUTE` dari `anon`/`public` dan memberikannya ulang hanya ke `authenticated`. Fungsi trigger ditutup total. Hasil akhir: **0 fungsi** yang bisa dipanggil `anon`.

### 2–4. Baca lintas-teknisi terlalu longgar

**Sebab.** Policy 0003/0008/0009 memakai `using (true)` untuk `members`, `technician_jobs`, `service_orders`, `job_photos`, dan `material_requests`. Artinya: siapa pun yang login melihat semuanya.

**Dampak.** Satu akun teknisi — cukup lewat REST API dengan tokennya sendiri, tanpa menyentuh UI — bisa menarik:

- seluruh basis pelanggan lengkap dengan **nama, nomor HP, dan alamat rumah**;
- seluruh job beserta catatan diagnosa teknisi lain;
- seluruh foto lokasi pelanggan;
- seluruh pengajuan material beserta nilai rupiahnya.

Bukti (teknisi-1 mengintip milik teknisi-2, sebelum perbaikan):

```
job teknisi lain                | 1
foto job teknisi lain           | 1
pengajuan material teknisi lain | 1
SEMUA member                    | 8   <- seluruh basis pelanggan
```

**Perbaikan.** Migrasi 0020 memecah tiap policy jadi dua: admin/kasir (tak berubah) dan teknisi (dibatasi). Cakupan teknisi ditentukan dua fungsi `SECURITY DEFINER` — `my_job_scope()` dan `my_visible_job_ids()` — yang sengaja definer supaya query di dalamnya tidak ikut dievaluasi RLS `technician_jobs` (kalau invoker, policy akan memanggil dirinya sendiri → rekursi tak berujung).

Prinsipnya: **teknisi tetap dapat data operasional, tidak lagi bisa mengenumerasi data komersial & pribadi orang lain.**

| Data | Cakupan teknisi setelah perbaikan |
|---|---|
| `technician_jobs`, `job_photos` | Job miliknya + job lain **pada unit yang sama** |
| `members` | Hanya pelanggan yang punya job untuk dia |
| `material_requests` | Hanya job miliknya (isinya nilai rupiah → lebih ketat) |
| `service_orders` | Hanya order yang menaungi job miliknya |
| `member_ac_units` | **Sengaja tetap terbuka** — lihat catatan di bawah |

Job pada unit yang sama sengaja dipertahankan: riwayat service per unit (dok. §8.1) memang harus lintas-teknisi supaya teknisi tahu apa yang pernah dikerjakan pada unit sebelum mulai.

`member_ac_units` dibiarkan terbuka untuk semua user login karena layar scan barcode harus bisa melookup unit apa pun sebelum penugasan, dan isinya (merek/model/PK/ruangan) bukan data pribadi.

Hasil setelah perbaikan — kebocoran nol, kemampuan kerja utuh:

```
job teknisi lain (unit beda)     | 0        job miliknya           | 6
foto job teknisi lain            | 0        member dari job-nya    | 4  (dari 8)
pengajuan material teknisi lain  | 0        unit AC (scan)         | 5
ITEM pengajuan teknisi lain      | 0        foto bukti job-nya     | 4
```

Admin & kasir: **tidak berubah sama sekali.**

### 5. Harga modal terbaca semua peran

**Sebab.** `products.buy_price` & `spareparts.buy_price` ikut terbaca teknisi dan kasir. Master data memang dibuka untuk semua user login — POS kasir butuh `sell_price`, teknisi butuh `sell_price` untuk mengajukan material. Tapi harga modal bukan salah satunya: dari situ margin tiap barang bisa dihitung persis.

**Kenapa tidak cukup mencabut hak baca per-kolom.** Dua sebab:

1. `revoke select (buy_price)` mencabut kolom itu dari **seluruh** peran `authenticated` — admin ikut kehilangan, karena admin/kasir/teknisi sama-sama login sebagai `authenticated`. Postgres tidak bisa membedakan mereka di level privilege kolom; pembedanya cuma RLS, dan RLS bekerja per **baris**.
2. Daftar master memakai Realtime `.stream()`, yang diawali `select *`. Satu kolom yang dicabut membuat `select *` gagal total (`permission denied for column`) dan daftar produk admin ikut mati.

**Perbaikan.** Migrasi 0021 memindahkan harga modal ke tabel `item_costs (kind, ref_id, buy_price)` dengan RLS admin-only, lalu menghapus kolomnya dari `products`/`spareparts`. `select *` pada `products` tetap jalan untuk semua peran; harga modal hidup di baris yang hanya lolos RLS untuk admin.

Penyesuaian aplikasi yang menyertainya:

- `Product.toMap()` / `Sparepart.toMap()` tidak lagi mengirim `buy_price` (kolomnya sudah tak ada — mengirimnya membuat insert/update gagal);
- `ItemCostRepository` baru untuk baca/tulis `item_costs`;
- form produk & sparepart memuat harga modal terpisah, dan hanya menyimpannya bila field-nya benar-benar diisi — supaya membuka-lalu-menyimpan form tanpa menyentuh field itu tidak menimpa biaya lama dengan 0;
- laporan menghitung nilai persediaan dari `item_costs`.

Hasil: teknisi & kasir `0` baris, admin `10` baris, daftar produk tetap terbaca semua peran.

### 6. `jwt_role()` masih terbuka untuk `anon`

Perbaikan awal memakai `revoke execute … from anon` saja — dan itu tidak cukup. Hibah bawaan menempel pada `PUBLIC`, dan `anon` mewarisinya, jadi pencabutan dari `anon` tidak berefek. Harus dicabut dari `PUBLIC` lalu diberikan ulang ke `authenticated` (policy RLS & Storage memanggil `jwt_role()` sebagai pemanggil). Sudah diperbaiki di migrasi 0020.

---

## Catatan yang tidak diubah

- **`update_technician_job_status` tetap mengizinkan job dimulai walau belum dibayar.** Ini keputusan bisnis yang sudah didokumentasikan di migrasi 0018, bukan cacat: jasa AC lazim ditagih setelah pekerjaan selesai, dan memblokir di backend akan menghentikan pekerjaan yang sah. Aplikasi hanya menampilkan badge peringatan.
- **`kasir` bisa membaca seluruh baris `users`.** Ini disengaja — kasir butuh dropdown teknisi saat menugaskan job. Yang terekspos hanya nama & email, bukan kredensial.
- **Gerbang peran di `redirect.dart` hanya untuk UI.** `/laporan` & `/stok` disembunyikan dari kasir di aplikasi, tapi RLS tetap mengizinkan kasir membaca `transactions`/`invoices`/`stock_movements` lewat API. Sejauh ini konsisten dengan desain RLS 0003 (kasir memang peran finansial), jadi dibiarkan — tapi perlu diingat bahwa penyembunyian di klien bukan kontrol keamanan.
- **Kebijakan unggah Storage tidak membatasi path.** Teknisi/admin bisa mengunggah gambar ke path mana pun dalam bucket `job-photos` (dibatasi tipe gambar & 10 MB). Risikonya rendah karena bucket privat dan tidak ada hak `update`/`delete`.

---

## Berkas yang berubah

**Backend**
- `backend/supabase/migrations/20260806000020_hardening_rls_execute.sql` (baru)
- `backend/supabase/migrations/20260806000021_item_costs_admin_only.sql` (baru)

Keduanya sudah diterapkan ke DB lokal, tercatat di `supabase_migrations.schema_migrations`, dan **terbukti idempotent** (dijalankan ulang tanpa error).

**Aplikasi**
- `data/models/product.dart`, `data/models/sparepart.dart` — `buy_price` keluar dari `toMap()`
- `data/repositories/item_cost_repository.dart` (baru)
- `features/master/master_providers.dart` — provider harga modal
- `features/master/product/product_form_screen.dart`, `.../sparepart/sparepart_form_screen.dart`
- `features/reports/reports_providers.dart` — nilai persediaan dari `item_costs`
- `test/data/master_models_test.dart` — menjaga `buy_price` tidak kembali ke `toMap()`

Verifikasi akhir: `flutter analyze` bersih (sisa 1 info deprecation lama yang tidak berkaitan), `flutter test` **206 lolos**.
