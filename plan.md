Saya ingin kamu mengerjakan unifikasi schema/database untuk repository ini.

# KONTEKS ARSITEKTUR SAAT INI

Repository ini punya dua sisi backend yang sebelumnya berkembang independen:

1. WEB
   - Frontend: Next.js
   - Backend: NestJS
   - NestJS backend SUDAH SELESAI/DIGUNAKAN.
   - Prisma digunakan sebagai ORM.
   - Backend NestJS memiliki PostgreSQL/schema sendiri.

2. MOBILE
   - Frontend mobile masih menggunakan Supabase SDK secara langsung.
   - Database yang digunakan mobile adalah Supabase PostgreSQL.
   - Migration Supabase berada di:
     backend/supabase/migrations

Target jangka panjang:

- Backend Web dan Mobile akan disatukan menggunakan NestJS.
- Mobile nantinya tidak lagi menggunakan Supabase SDK secara langsung.
- NestJS akan menjadi backend utama untuk Web + Mobile.
- Database tetap PostgreSQL dan nantinya akan di-host di VPS.
- FCM tetap digunakan untuk push notification mobile.
- Tetapi migrasi ke full NestJS + VPS BELUM dilakukan sekarang.

# TUJUAN PEKERJAAN SEKARANG

Untuk tahap sekarang, JANGAN memindahkan backend mobile ke NestJS.

Yang ingin dilakukan sekarang adalah:

    NestJS schema/features
            ↓
    port fitur yang belum ada
            ↓
    Supabase migrations
            ↓
    Supabase menjadi schema/database source of truth sementara

Alasannya:

- Supabase saat ini masih dipakai oleh frontend/mobile dan frontend/web.
- Supabase adalah database production yang sedang digunakan.
- NestJS sudah memiliki beberapa fitur baru yang belum ada di schema Supabase.
- Kita ingin memastikan tidak ada fitur mobile yang hilang.
- Nantinya ketika Mobile dipindahkan ke NestJS, NestJS tinggal mengikuti schema PostgreSQL yang sudah lengkap.

# ATURAN KONFLIK

Jika sebuah fitur sudah ada di kedua sisi tetapi desainnya berbeda:

- DESAIN SUPABASE/WEB MENANG.
- Jangan menggabungkan dua desain secara paksa.
- Jangan mengganti desain Supabase yang sudah digunakan production hanya agar sama dengan Prisma/NestJS.

Namun:

- Fitur NestJS yang benar-benar baru dan belum ada di Supabase harus dipertimbangkan untuk dipindahkan.
- Migration baru harus ADDITIVE sebisa mungkin.
- Jangan membuat breaking change yang membutuhkan koordinasi release frontend/mobile sekarang.

# BREAKING FEATURE YANG JANGAN DIKERJAKAN SEKARANG

Jangan mengerjakan rework item_costs menjadi multi-batch.

Perubahan tersebut mencakup:

- menghapus products.sell_price
- menghapus products.stock
- mengubah item_costs menjadi multi-batch
- perubahan stock_movements
- perubahan RPC checkout_transaction/record_payment
- perubahan frontend POS/product di Web dan Mobile

Ini adalah pekerjaan TERPISAH karena breaking dan membutuhkan perubahan frontend secara bersamaan.

# DESAIN WA JUGA JANGAN DIPINDAHKAN DARI NEST

Supabase/Web sudah memiliki:

- wa_outbox
- pengiriman manual menggunakan wa.me

NestJS memiliki desain:

- whatsapp_logs
- auto-send menggunakan Fonnte

Karena Supabase/Web adalah implementasi yang sedang digunakan, desain NestJS WA tersebut JANGAN diporting ke Supabase.

# FITUR YANG HARUS DIPORTING

Saya sudah melakukan diff antara seluruh:

- backend/supabase/migrations
- Nest/epos-backend/prisma/schema.prisma
- Nest/epos-backend/prisma/migrations

Temuan yang ingin diimplementasikan menjadi 4 migration baru:

1. checklist_servis_review.sql
2. cashier_shifts.sql
3. offline_sync_log.sql
4. pos_batch_discount_fields.sql

JANGAN langsung percaya nama/kolom/function dari prompt ini jika berbeda dengan repository.
Baca schema dan migration aktual terlebih dahulu dan sesuaikan implementasi dengan kondisi repository sebenarnya.

==================================================

1. # checklist_servis_review.sql

Sumber fitur:

- Nest migration 20260822030000_job_findings_checklist
- logic technician-jobs.service.ts:
  - submitForReview
  - approveComplete
  - sendBack

Tambahkan:

TABLE problem_categories

- id UUID PK default gen_random_uuid()
- name unique
- source
- created_at

TABLE job_findings

- id UUID PK
- job_id → technician_jobs
- category_id → problem_categories
- title
- note
- origin
- created_by → users

TABLE job_finding_photos

- id UUID PK
- finding_id → job_findings
- kind
- path
- uploaded_by

kind harus CHECK:

- sebelum
- sesudah

Tambahkan:
technician_jobs.review_note TEXT NULLABLE

Storage:

- gunakan bucket existing "job-photos"
- JANGAN membuat bucket baru.
- RLS upload yang sudah ada harus tetap berlaku.

RPC baru:

- add_job_finding(payload)
- add_job_finding_photo(payload)

Ikuti pola add_job_photo dari migration 0008:

- admin boleh
- teknisi hanya boleh untuk job miliknya
- teknisi hanya boleh saat job sedang_dikerjakan

REDEFINE:
update_technician_job_status

Definisi terakhir existing berasal dari:
20260815000024_schedule_on_job_complete.sql

Action yang harus tersedia:

1. start
   - behavior harus tetap sama

2. cancel
   - behavior harus tetap sama

3. submit_review
   - teknisi
   - sedang_dikerjakan → menunggu_review
   - minimal 1 job_findings
   - setiap finding wajib punya foto sebelum DAN sesudah
   - tidak boleh ada material_requests pending
   - tidak boleh ada material request yang approved tetapi belum dipakai
     (used_at IS NULL)

4. approve
   - admin only
   - menunggu_review → selesai
   - efek samping HARUS sama dengan blok complete lama:
     - update member_ac_units
     - hitung next_service_date menggunakan resolve_service_interval_days
     - insert wa_outbox kind selesai_servis
     - tutup service_orders jika semua unit selesai
   - hanya gate/workflow yang berubah, bukan efek samping existing

5. send_back
   - admin only
   - menunggu_review → sedang_dikerjakan
   - notes wajib diisi
   - simpan notes ke technician_jobs.review_note

PENTING:
Jangan membuat redefinisi ketiga update_technician_job_status di migration berikutnya.
Migration ini adalah tempat definisi final function tersebut.

================================================== 2. cashier_shifts.sql
==================================================

Sumber:

- Nest migration 20260822020000_cashier_shifts
- shifts.service.ts

TABLE cashier_shifts:

- id UUID PK default gen_random_uuid()
- kasir_id → users
- opening_balance INTEGER
- closing_balance INTEGER NULLABLE
- opened_at
- closed_at NULLABLE
- notes

Tambahkan:
manual_payments.shift_id UUID NULLABLE
FK dengan ON DELETE SET NULL

RLS:

- select hanya admin/kasir
- ikuti pola tabel finansial existing, terutama transactions.

RPC:
open_cashier_shift(payload)

Rules:

- kasir/admin
- lock pengecekan shift terbuka milik kasir yang sama
- gunakan FOR UPDATE
- tidak boleh membuka shift baru jika masih ada shift dengan closed_at IS NULL
- port behavior ShiftsService.open secara akurat

RPC:
close_cashier_shift(payload)

Rules:

- hanya pemilik shift
- expectedCash:
  SUM manual_payments.amount
  WHERE method = 'tunai'
  AND shift_id = shift tersebut

Jangan menambahkan filter status pembayaran lain karena sistem ini tidak punya status verifikasi pembayaran.

Rumus:

expectedCash = openingBalance + totalTunai

selisih = closingBalance - expectedCash

Return:

- ok
- closingBalance
- expectedCash
- selisih

Laporan per-shift:

- TIDAK perlu RPC.
- cukup SELECT biasa dari client.
- RLS admin/kasir sudah cukup.

================================================== 3. offline_sync_log.sql
==================================================

Sumber:

- Nest migration 20260823080000_offline_sync_log
- offline-sync.service.ts

TABLE sync_action_log:

- id UUID PK
- client_action_id UNIQUE
- job_id → technician_jobs ON DELETE CASCADE
- action_type
- processed_at
- result JSONB

Tujuan:

- deduplication batch-sync teknisi offline.

Tambahkan:
technician_jobs.updated_at

- timestamptz
- NOT NULL
- default now()

material_requests.updated_at

- timestamptz
- NOT NULL
- default now()

JANGAN membuat trigger auto-update.
Repository tidak memiliki pola trigger moddatetime/auto-update semacam itu.

Setiap RPC yang melakukan UPDATE pada kedua tabel tersebut harus eksplisit:
updated_at = now()

RPC yang harus diperhatikan:

technician_jobs:

- assign_technician_job
- update_technician_job_status

CATATAN:
update_technician_job_status sudah diredefine di migration #1.
Jangan redefine lagi di migration ini.
Cukup pastikan definisi final dari migration #1 sudah memasukkan updated_at = now() pada setiap UPDATE technician_jobs.

material_requests:

- submit_material_request
- decide_material_request
- mark_material_used

Cari definisi FINAL function yang benar-benar aktif di migration repository, lalu redefine hanya jika memang diperlukan untuk menambahkan:
updated_at = now()

================================================== 4. pos_batch_discount_fields.sql
==================================================

Ini hanya penambahan kolom kecil dan harus additive.

transaction_items:

- discount INTEGER NOT NULL DEFAULT 0

invoice_items:

- discount INTEGER NOT NULL DEFAULT 0
- buy_price_snapshot INTEGER NULLABLE

products:

- sku TEXT UNIQUE NULLABLE

JANGAN menambahkan:
stock_movements.item_cost_id

Alasannya:
item_costs.id yang menjadi target FK tersebut baru relevan setelah rework item_costs multi-batch, yang berada di luar scope sekarang.

==================================================
KONVENSI SQL YANG WAJIB DIIKUTI
==================================================

Ikuti konvensi migration Supabase yang sudah ada di repository.

- UUID primary key:
  gen_random_uuid()

- RLS:
  enable row level security

- grant:
  gunakan explicit grants seperti migration existing

- RPC write:
  SECURITY DEFINER

- RPC:
  SET search_path = public, pg_temp

- revoke:
  REVOKE EXECUTE FROM anon, public

- grant execute:
  GRANT EXECUTE TO authenticated

- RPC yang melakukan write:
  INSERT ke audit_logs di akhir RPC
  sesuai pola migration existing.

- naming policy:
  "<tabel manusiawi>: <aksi> <role>"

- nilai uang:
  INTEGER
  JANGAN menggunakan Decimal/Numeric hanya karena Prisma menggunakan Decimal(14,2).

- technician_jobs.status:
  tetap TEXT.
  Jangan ubah menjadi native Postgres enum.

- Jangan mengubah behavior existing kecuali yang secara eksplisit diminta di atas.

# VERIFIKASI

Setelah implementasi:

1. Pastikan hanya ada 4 migration baru:
   backend/supabase/migrations/

2. Jangan mengubah migration lama.

3. Jalankan/validasi:
   supabase db push
   atau equivalent local migration validation jika environment cloud tidak tersedia.

4. Pastikan migration tidak gagal karena:
   - function signature conflict
   - policy conflict
   - existing constraint
   - duplicate column
   - duplicate function
   - dependency order

5. Smoke test RPC:
   - minimal satu successful call
   - minimal satu rejected call

Contoh:

- teknisi mencoba approve
  → harus ditolak "Hanya Admin"

6. Regression:
   - update_technician_job_status start tetap bekerja
   - cancel tetap bekerja
   - checkout existing tidak berubah behavior

7. Cek:
   git status

Expected:

- hanya 4 migration baru
- tidak ada migration lama yang berubah

# ATURAN KERJA

Sebelum menulis SQL:

1. Baca schema Prisma secara lengkap.
2. Baca migration Prisma yang relevan.
3. Baca seluruh migration Supabase atau minimal seluruh migration yang mendefinisikan tabel/function/policy terkait.
4. Cari definisi function terakhir yang aktif sebelum melakukan CREATE OR REPLACE.
5. Jangan mengasumsikan nama kolom, enum, policy, constraint, atau function signature.
6. Ikuti pola repository yang sudah ada.
7. Jika ada konflik antara prompt dan repository aktual, repository aktual menjadi sumber teknis untuk nama/signature, tetapi aturan konflik desain Supabase/Web tetap berlaku.
8. Jangan mengerjakan item_costs multi-batch.
9. Jangan memindahkan WA/Fonnte dari Nest.
10. Jangan melakukan deploy VPS atau migrasi Mobile → NestJS sekarang.

# OUTPUT YANG SAYA INGINKAN

Setelah selesai:

- tampilkan 4 file migration yang dibuat/diubah
- jelaskan perubahan tiap file secara singkat
- jelaskan function/RPC yang diredefine
- jelaskan potensi risiko migration
- laporkan hasil validasi/migration test
- laporkan hasil regression/smoke test
- pastikan tidak ada perubahan di luar scope

INGAT:
NestJS SUDAH JADI.
Next.js SUDAH JADI.
Yang dilakukan sekarang BUKAN membuat backend NestJS.
Yang dilakukan sekarang adalah membuat schema Supabase mengikuti fitur NestJS yang belum ada, dengan Supabase tetap sebagai source of truth sementara.

Target akhirnya nanti:
Mobile + Web → NestJS → PostgreSQL

Tetapi tahap tersebut BELUM dikerjakan sekarang.
