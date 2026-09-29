-- =============================================================================
-- Input Transaksi Manual + metode bayar Debit (fitur web fab0538) — murni ADDITIF.
--
-- Baris invoice manual diketik bebas (barang lampau yang mungkin sudah tidak
-- ada di master data), jadi tidak punya ref_id ke products/spareparts/services.
--
-- * item_kind + 'manual' : penanda baris manual. Nilai lama tidak berubah;
--   checkout_transaction & stok tidak pernah menulis 'manual'.
-- * invoice_items.ref_id nullable : baris manual ref_id NULL. Baris lama
--   tetap terisi. Client mobile sudah membaca ref_id NULL sebagai ''.
-- * payment_method + 'debit' : dipakai dialog "Catat Pembayaran" web.
-- =============================================================================

alter type payment_method add value if not exists 'debit';

alter type item_kind add value if not exists 'manual';

alter table invoice_items alter column ref_id drop not null;
