-- Setoran harian + verifikasi pembayaran lapangan (rencana 4).
CREATE TABLE "cash_settlements" (
    "id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "expected_total" DECIMAL(14,2) NOT NULL,
    "received_total" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "mode" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "sparepart_note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_settlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "technician_cash_ledger" (
    "id" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "settlement_id" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technician_cash_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_settlements_technician_id_created_at_idx" ON "cash_settlements"("technician_id", "created_at");
CREATE INDEX "technician_cash_ledger_technician_id_kind_idx" ON "technician_cash_ledger"("technician_id", "kind");

ALTER TABLE "cash_settlements" ADD CONSTRAINT "cash_settlements_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technician_cash_ledger" ADD CONSTRAINT "technician_cash_ledger_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "technician_cash_ledger" ADD CONSTRAINT "technician_cash_ledger_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "cash_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "field_payments" ALTER COLUMN "proof_url" DROP NOT NULL;
ALTER TABLE "field_payments" ADD COLUMN "settlement_id" TEXT;
ALTER TABLE "field_payments" ADD COLUMN "manual_payment_id" TEXT;
ALTER TABLE "field_payments" ADD COLUMN "verified_by" TEXT;
ALTER TABLE "field_payments" ADD COLUMN "verified_at" TIMESTAMP(3);
ALTER TABLE "field_payments" ADD COLUMN "reject_reason" TEXT;
ALTER TABLE "field_payments" ADD COLUMN "entered_by" TEXT;
ALTER TABLE "field_payments" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'app';

CREATE UNIQUE INDEX "field_payments_manual_payment_id_key" ON "field_payments"("manual_payment_id");
ALTER TABLE "field_payments" ADD CONSTRAINT "field_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "cash_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
