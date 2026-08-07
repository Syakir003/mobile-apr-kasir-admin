-- =============================================================================
-- Fase 6 — Harga modal (buy_price) dipisah ke tabel khusus admin.
--
-- Temuan uji 06 Agu 2026: `products.buy_price` & `spareparts.buy_price` ikut
-- terbaca teknisi dan kasir. Policy 0003 memang membuka master data untuk semua
-- user login — POS kasir butuh `sell_price`, dan teknisi butuh `sell_price`
-- untuk mengajukan material. Tapi HARGA MODAL bukan salah satunya: dari situ
-- margin tiap barang bisa dihitung persis.
--
-- Kenapa tabel terpisah, bukan sekadar cabut hak baca per-kolom:
--   * `revoke select (buy_price)` mencabut kolomnya dari SELURUH role
--     `authenticated` — admin ikut kehilangan, karena admin/kasir/teknisi sama-
--     sama login sebagai `authenticated`. Postgres tidak bisa membedakan mereka
--     di level privilege kolom; pembedanya cuma RLS, dan RLS bekerja per BARIS.
--   * Daftar master memakai Realtime `.stream()`, yang diawali `select *`.
--     Satu kolom yang dicabut membuat `select *` gagal total ("permission denied
--     for column") dan daftar produk admin ikut mati.
-- Baris terpisah + RLS admin menyelesaikan keduanya: `select *` pada `products`
-- tetap jalan untuk semua peran, dan harga modal hidup di baris yang hanya
-- lolos RLS untuk admin.
-- =============================================================================

create table if not exists item_costs (
  kind item_kind not null check (kind in ('product', 'sparepart')),
  ref_id uuid not null,
  buy_price integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (kind, ref_id)
);

comment on table item_costs is
  'Harga modal per barang. Dipisah dari products/spareparts supaya hanya admin '
  'yang bisa membacanya (lihat migrasi 0021).';

-- ---------------------------------------------------------------- pindah data
-- Idempotent: `on conflict do nothing` + `if exists` pada kolom sumber, supaya
-- migrasi aman diulang setelah kolomnya terlanjur hilang.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'products'
                and column_name = 'buy_price') then
    insert into item_costs (kind, ref_id, buy_price)
    select 'product', id, buy_price from products
    on conflict (kind, ref_id) do nothing;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'spareparts'
                and column_name = 'buy_price') then
    insert into item_costs (kind, ref_id, buy_price)
    select 'sparepart', id, buy_price from spareparts
    on conflict (kind, ref_id) do nothing;
  end if;
end $$;

alter table products   drop column if exists buy_price;
alter table spareparts drop column if exists buy_price;

-- ------------------------------------------------------------------- akses
-- Tidak ada RPC: tabel ini hanya disentuh layar master (admin), dan RLS di
-- bawah sudah jadi penjaganya. DELETE tak diberikan — barang dinonaktifkan
-- lewat kolom `active`, biaya historisnya dibiarkan.
alter table item_costs enable row level security;
grant select, insert, update on item_costs to authenticated;

drop policy if exists "item costs: baca admin" on item_costs;
create policy "item costs: baca admin"
  on item_costs for select to authenticated
  using (jwt_role() = 'admin');

drop policy if exists "item costs: tulis admin" on item_costs;
create policy "item costs: tulis admin"
  on item_costs for insert to authenticated
  with check (jwt_role() = 'admin');

drop policy if exists "item costs: ubah admin" on item_costs;
create policy "item costs: ubah admin"
  on item_costs for update to authenticated
  using (jwt_role() = 'admin') with check (jwt_role() = 'admin');
