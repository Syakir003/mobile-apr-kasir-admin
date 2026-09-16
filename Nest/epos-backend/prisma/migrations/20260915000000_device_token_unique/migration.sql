-- Siklus Notifikasi Push (2026-09): device_tokens.token belum pernah punya
-- constraint unique sama sekali sejak tabel ini dibuat (kolomnya juga gak
-- kepake di kode manapun sampai sekarang). Sebelum ngunci UNIQUE, beresin
-- dulu kemungkinan baris duplikat token yang udah kejadian secara diam-diam
-- (mis. data lama/testing) — kalau enggak, ALTER TABLE ... ADD CONSTRAINT
-- di step 2 bakal gagal.

-- 1) Dedupe: buat tiap nilai token yang duplikat, pertahankan cuma baris
--    yang PALING BARU (updated_at terbesar, tie-break id) — itu yang paling
--    mendekati "pemilik token saat ini". Baris duplikat lainnya dihapus.
DELETE FROM "device_tokens" dt
USING (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "token"
           ORDER BY "updated_at" DESC, "id" DESC
         ) AS rn
  FROM "device_tokens"
) ranked
WHERE dt."id" = ranked."id" AND ranked.rn > 1;

-- 2) Kunci UNIQUE di kolom token — dipakai NotificationsService.registerDeviceToken
--    buat upsert-by-token (1 token cuma boleh nempel ke 1 user, registrasi
--    ulang dari user lain di HP yang sama otomatis mindahin kepemilikan).
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_token_key" UNIQUE ("token");
