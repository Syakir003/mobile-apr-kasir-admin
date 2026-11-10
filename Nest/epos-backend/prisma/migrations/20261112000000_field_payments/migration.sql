-- Pembayaran lapangan teknisi + Tanda Terima (spesifikasi pembayaran lapangan, rencana 3).
ALTER TYPE "WhatsappMessageKind" ADD VALUE 'tanda_terima';

ALTER TABLE "service_orders" ADD COLUMN "unpaid_reason" TEXT;

CREATE TABLE "field_payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "proof_url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "receipt_channel" TEXT,
    "receipt_sent_at" TIMESTAMP(3),
    "receipt_wa_log_id" TEXT,
    "paper_report_no" TEXT,
    "client_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "field_payments_receipt_number_key" ON "field_payments"("receipt_number");
CREATE UNIQUE INDEX "field_payments_client_ref_key" ON "field_payments"("client_ref");
CREATE INDEX "field_payments_invoice_id_status_idx" ON "field_payments"("invoice_id", "status");
CREATE INDEX "field_payments_order_id_idx" ON "field_payments"("order_id");
CREATE INDEX "field_payments_recorded_by_status_idx" ON "field_payments"("recorded_by", "status");

ALTER TABLE "field_payments" ADD CONSTRAINT "field_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_payments" ADD CONSTRAINT "field_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "service_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_payments" ADD CONSTRAINT "field_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
