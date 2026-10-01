-- Pengingat servis per unit AC (2026-09-30): saklar on/off per unit.
ALTER TABLE "member_ac_units"
  ADD COLUMN "reminder_enabled" BOOLEAN NOT NULL DEFAULT true;

-- Backfill siklus per unit dari default global lama supaya AC yang sudah
-- terjadwal tidak diam-diam kehilangan siklus (default global tidak lagi
-- dipakai). Hanya untuk unit yang sudah punya jadwal berikutnya.
UPDATE "member_ac_units" u
SET "service_interval_days" = COALESCE(
  (SELECT rs."interval_days" FROM "reminder_settings" rs WHERE rs."job_type" = 'cuci' AND rs."active" LIMIT 1),
  (SELECT rs."interval_days" FROM "reminder_settings" rs WHERE rs."job_type" = 'maintenance' AND rs."active" LIMIT 1)
)
WHERE u."service_interval_days" IS NULL AND u."next_service_date" IS NOT NULL;
