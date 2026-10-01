-- Input Data Lampau: tracking label QR + koreksi data unit oleh teknisi.
ALTER TABLE "member_ac_units"
  ADD COLUMN "label_printed_at" TIMESTAMP(3),
  ADD COLUMN "label_attached_at" TIMESTAMP(3);

CREATE TABLE "ac_unit_corrections" (
  "id" TEXT NOT NULL,
  "unit_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "brand" TEXT,
  "model" TEXT,
  "pk" DECIMAL(4,2),
  "room_location" TEXT,
  "serial_number" TEXT,
  "installation_date" TIMESTAMP(3),
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ac_unit_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ac_unit_corrections_unit_id_status_idx" ON "ac_unit_corrections"("unit_id", "status");
CREATE INDEX "ac_unit_corrections_status_created_at_idx" ON "ac_unit_corrections"("status", "created_at");

ALTER TABLE "ac_unit_corrections"
  ADD CONSTRAINT "ac_unit_corrections_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "member_ac_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ac_unit_corrections_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ac_unit_corrections_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
