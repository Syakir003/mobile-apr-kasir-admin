-- Kapan password user terakhir diganti (self-service ATAU di-reset admin).
-- Dipakai JwtStrategy buat NOLAK token yang diterbitkan SEBELUM waktu ini —
-- tanpa ini, ganti password gak nendang sesi lama sama sekali (JWT kita
-- self-contained, gak ada tabel sesi buat dicabut), jadi kalau akun kebobol
-- lalu passwordnya diganti, token si penyusup TETAP jalan sampai expired
-- (default 8 jam). Nullable: baris user lama belum punya nilai ini, dan NULL
-- artinya "belum pernah ganti password" = semua token lama tetap sah.
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);
