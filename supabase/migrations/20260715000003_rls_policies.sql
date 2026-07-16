-- =============================================================================
-- Row Level Security — port dari firestore.rules.
--
-- Ringkasan izin (role dibaca dari klaim JWT lewat jwt_role()):
--   users                    : read sendiri / admin / kasir (dropdown teknisi)
--   master data              : read semua user login; tulis admin
--   members & member_ac_units: read semua user login; tulis admin
--   finansial (transactions, invoices, manual_payments, stock_movements)
--                            : read admin+kasir; TIDAK ada tulis dari client —
--                              semua tulis lewat fungsi RPC security definer
--   service_orders/jobs      : read semua user login; tulis via RPC
--   counters & audit_logs    : tanpa policy = tertutup untuk client
-- =============================================================================

-- ------------------------------------------------------------------ users
create policy "users: baca sendiri/admin/kasir"
  on users for select to authenticated
  using (id = auth.uid() or jwt_role() in ('admin', 'kasir'));

-- ------------------------------------------------------------- master data
create policy "products: baca user login"
  on products for select to authenticated using (true);
create policy "products: tulis admin"
  on products for insert to authenticated with check (jwt_role() = 'admin');
create policy "products: ubah admin"
  on products for update to authenticated
  using (jwt_role() = 'admin') with check (jwt_role() = 'admin');

create policy "spareparts: baca user login"
  on spareparts for select to authenticated using (true);
create policy "spareparts: tulis admin"
  on spareparts for insert to authenticated with check (jwt_role() = 'admin');
create policy "spareparts: ubah admin"
  on spareparts for update to authenticated
  using (jwt_role() = 'admin') with check (jwt_role() = 'admin');

create policy "services: baca user login"
  on services for select to authenticated using (true);
create policy "services: tulis admin"
  on services for insert to authenticated with check (jwt_role() = 'admin');
create policy "services: ubah admin"
  on services for update to authenticated
  using (jwt_role() = 'admin') with check (jwt_role() = 'admin');

create policy "packages: baca user login"
  on installation_packages for select to authenticated using (true);
create policy "packages: tulis admin"
  on installation_packages for insert to authenticated
  with check (jwt_role() = 'admin');
create policy "packages: ubah admin"
  on installation_packages for update to authenticated
  using (jwt_role() = 'admin') with check (jwt_role() = 'admin');

-- Item paket ditulis lewat RPC save_installation_package (security invoker),
-- jadi butuh policy insert/delete admin (pola replace: hapus lalu isi ulang).
create policy "package items: baca user login"
  on installation_package_items for select to authenticated using (true);
create policy "package items: tulis admin"
  on installation_package_items for insert to authenticated
  with check (jwt_role() = 'admin');
create policy "package items: hapus admin"
  on installation_package_items for delete to authenticated
  using (jwt_role() = 'admin');

-- --------------------------------------------------------- member & unit AC
create policy "members: baca user login"
  on members for select to authenticated using (true);
create policy "members: tulis admin"
  on members for insert to authenticated with check (jwt_role() = 'admin');
create policy "members: ubah admin"
  on members for update to authenticated
  using (jwt_role() = 'admin') with check (jwt_role() = 'admin');

create policy "units: baca user login"
  on member_ac_units for select to authenticated using (true);
create policy "units: tulis admin"
  on member_ac_units for insert to authenticated
  with check (jwt_role() = 'admin');
create policy "units: ubah admin"
  on member_ac_units for update to authenticated
  using (jwt_role() = 'admin') with check (jwt_role() = 'admin');

-- ----------------------------------------------------- finansial: read-only
create policy "transactions: baca admin/kasir"
  on transactions for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));
create policy "transaction items: baca admin/kasir"
  on transaction_items for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));
create policy "invoices: baca admin/kasir"
  on invoices for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));
create policy "invoice items: baca admin/kasir"
  on invoice_items for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));
create policy "payments: baca admin/kasir"
  on manual_payments for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));
create policy "stock movements: baca admin/kasir"
  on stock_movements for select to authenticated
  using (jwt_role() in ('admin', 'kasir'));

-- ------------------------------------------------- order & job pemasangan
-- Fase 5 akan memperketat akses per teknisi.
create policy "service orders: baca user login"
  on service_orders for select to authenticated using (true);
create policy "service order units: baca user login"
  on service_order_units for select to authenticated using (true);
create policy "technician jobs: baca user login"
  on technician_jobs for select to authenticated using (true);
