-- =============================================================================
-- GRANT privilege tabel ke role `authenticated`.
--
-- Kenapa perlu: RLS hanya MEMBATASI baris; ia TIDAK memberi hak akses tabel.
-- PostgREST mengakses DB sebagai role `authenticated`, jadi role itu tetap
-- butuh GRANT SELECT/INSERT/UPDATE per tabel — kalau tidak, setiap query
-- client gagal "permission denied for table" sebelum RLS sempat dievaluasi.
--
-- Migrasi 0001-0005 mengandalkan asumsi "Supabase default privilege memberi
-- akses ke authenticated". Asumsi itu TIDAK berlaku untuk tabel milik role
-- `postgres` (yang menjalankan migrasi): pg_default_acl `postgres` hanya
-- memberi Dxtm (truncate/references/trigger/maintain), TANPA select/insert/
-- update/delete. Grant eksplisit di bawah menutup celah itu.
--
-- Prinsip: grant SEPADAN dengan desain RLS (0003), least privilege —
--   * SELECT: semua tabel yang dibaca client (termasuk finansial read-only),
--     KECUALI counters & audit_logs (tertutup total, hanya via RPC/definer).
--   * INSERT/UPDATE: hanya master + member + unit (client CRUD; RLS batasi ke
--     admin). Tak ada DELETE client (soft-delete via kolom `active`).
--   * installation_package_items: INSERT+DELETE untuk RPC save_installation_
--     package yang SECURITY INVOKER (jalan sebagai pemanggil, bukan definer).
--   * Tabel finansial: TANPA insert/update/delete client — semua tulis lewat
--     RPC SECURITY DEFINER (checkout_transaction, record_payment) yang jalan
--     sebagai owner sehingga tak terikat grant ini.
-- `anon` sengaja tidak diberi apa pun: aplikasi wajib login.
-- =============================================================================

grant usage on schema public to authenticated;

-- ------------------------------------------------------------ SELECT (baca)
grant select on
  users,
  products, spareparts, services,
  installation_packages, installation_package_items,
  members, member_ac_units,
  transactions, transaction_items,
  invoices, invoice_items, manual_payments, stock_movements,
  service_orders, service_order_units, technician_jobs
to authenticated;

-- ------------------------------------------------ INSERT/UPDATE (CRUD client)
-- RLS (0003) mengunci penulisan ke admin lewat jwt_role().
grant insert, update on
  products, spareparts, services, installation_packages,
  members, member_ac_units
to authenticated;

-- Item paket: ditulis ulang (hapus lalu isi) oleh RPC save_installation_package
-- yang SECURITY INVOKER; RLS 0003 sudah membatasi ke admin.
grant insert, delete on installation_package_items to authenticated;

-- counters & audit_logs: TIDAK di-grant (tertutup untuk client, aman).
