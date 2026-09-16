-- Siklus 4: Kas & Shift Kasir
-- Tabel baru cashier_shifts (buka/tutup kasir) + kolom shift_id nullable di
-- manual_payments (atribusi opsional, SET NULL kalau shift-nya dihapus —
-- riwayat pembayaran/invoice tidak boleh ikut hilang).

CREATE TABLE "cashier_shifts" (
    "id" TEXT NOT NULL,
    "kasir_id" TEXT NOT NULL,
    "opening_balance" DECIMAL(14,2) NOT NULL,
    "closing_balance" DECIMAL(14,2),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "cashier_shifts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_kasir_id_fkey"
    FOREIGN KEY ("kasir_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "manual_payments" ADD COLUMN "shift_id" TEXT;

ALTER TABLE "manual_payments" ADD CONSTRAINT "manual_payments_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
