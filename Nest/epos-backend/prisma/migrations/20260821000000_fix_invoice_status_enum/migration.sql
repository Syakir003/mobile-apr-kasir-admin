-- Koreksi: skema awal cuma punya 3 nilai InvoiceStatus (direkonstruksi dari
-- dump lama yang ketinggalan). Sistem asli (backend/supabase/migrations,
-- init_schema.sql) punya 6 nilai. Postgres wajib ALTER TYPE ADD VALUE
-- (gak bisa langsung ganti definisi enum).
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'kurang_bayar';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'refund';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'batal';
