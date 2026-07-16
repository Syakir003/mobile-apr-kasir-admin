-- =============================================================================
-- Realtime: daftarkan tabel yang di-stream client (pengganti Firestore
-- snapshots()). Supabase Realtime menghormati RLS per subscriber.
-- Catatan: hanya tabel yang benar-benar dipakai `.stream()` di client;
-- tabel lain (transactions, audit_logs, dst) tidak perlu realtime.
-- =============================================================================

alter publication supabase_realtime add table
  users,
  products,
  spareparts,
  services,
  installation_packages,
  members,
  member_ac_units,
  invoices,
  manual_payments;
