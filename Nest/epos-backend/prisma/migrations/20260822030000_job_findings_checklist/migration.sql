-- Siklus 5 (revisi): Checklist Temuan Servis + Review Admin
-- Tabel baru: problem_categories (daftar baku, tumbuh sendiri), job_findings
-- (temuan per job, dinamis), job_finding_photos (foto sebelum/sesudah per
-- temuan, boleh banyak). Kolom baru technician_jobs.review_note (catatan
-- admin saat mengembalikan job ke teknisi). job_photos TIDAK dihapus —
-- dibiarkan untuk data historis, berhenti dipakai untuk alur baru.

CREATE TABLE "problem_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "problem_categories_name_key" ON "problem_categories"("name");

CREATE TABLE "job_findings" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "origin" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_finding_photos" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_finding_photos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "technician_jobs" ADD COLUMN "review_note" TEXT;

ALTER TABLE "job_findings" ADD CONSTRAINT "job_findings_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "technician_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_findings" ADD CONSTRAINT "job_findings_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "problem_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_findings" ADD CONSTRAINT "job_findings_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_finding_photos" ADD CONSTRAINT "job_finding_photos_finding_id_fkey"
    FOREIGN KEY ("finding_id") REFERENCES "job_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_finding_photos" ADD CONSTRAINT "job_finding_photos_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kategori baku awal SENGAJA tidak di-seed lewat SQL di sini (butuh
-- gen_random_uuid()/uuid-ossp yang belum tentu aktif di semua environment
-- Postgres) — diisi lewat `prisma/seed.ts` (npx prisma db seed), konsisten
-- dengan pola seed admin yang sudah ada.
