-- =============================================================================
-- Bugfix — Edge Function `send-push` tak bisa membaca `device_tokens`.
--
-- Migrasi 0011 hanya memberi `grant select ... to authenticated`. Fungsi
-- `send-push` memakai SERVICE_ROLE_KEY, jadi ia berjalan sebagai role
-- `service_role`. Role itu memang melewati RLS, tapi TIDAK melewati privilege
-- tabel — sehingga setiap push gagal dengan:
--
--   42501: permission denied for table device_tokens
--
-- SELECT untuk mengambil token penerima; DELETE untuk membuang token yang
-- ditolak FCM sebagai UNREGISTERED (lihat send-push/index.ts:173).
-- =============================================================================

grant select, delete on public.device_tokens to service_role;
