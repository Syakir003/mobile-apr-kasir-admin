-- =============================================================================
-- Fase 6 — Stok masuk & penyesuaian MANUAL (dok. fitur bab 9).
--
-- Sebelumnya `stock_movements` HANYA lahir otomatis: negatif dari
-- checkout_transaction ('penjualan') dan mark_material_used ('pemakaian').
-- Tidak ada jalan memasukkan barang beli baru atau mengoreksi selisih stok
-- opname, sehingga stok pasti melenceng dari fisik seiring waktu.
--
-- Migrasi ini menambah RPC `adjust_stock` — satu pintu untuk semua mutasi
-- manual. Admin saja (sejalan dengan '/stok' yang admin-only di router mobile
-- dan master data yang tulisnya admin).
--
-- Alasan yang dipakai otomatis oleh sistem ('penjualan', 'pemakaian') SENGAJA
-- ditolak di sini supaya jejak audit tetap jujur: mutasi manual tak boleh
-- menyamar sebagai penjualan.
-- =============================================================================

-- =============================================================================
-- adjust_stock(payload) — barang masuk / penyesuaian stok (admin).
-- Payload: {
--   itemKind: 'product' | 'sparepart',
--   refId:    uuid item,
--   qtyChange: numeric <> 0   (positif = masuk, negatif = keluar),
--   reason:   'pembelian' | 'koreksi' | 'retur' | 'rusak',
--   note?:    text (opsional, ikut ke audit_logs)
-- }
-- Return: { ok, stock, movementId }
-- =============================================================================
create or replace function adjust_stock(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_kind text;
  v_ref_id uuid;
  v_qty numeric;
  v_reason text;
  v_note text;
  v_name text;
  v_before numeric;
  v_after numeric;
  v_movement_id uuid;
begin
  v_uid := assert_caller_role(array['admin'],
    'Hanya Admin yang boleh mengubah stok');

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Input kosong';
  end if;

  v_kind := btrim(coalesce(payload ->> 'itemKind', ''));
  if v_kind not in ('product', 'sparepart') then
    raise exception 'Jenis item harus produk atau sparepart';
  end if;

  if jsonb_typeof(payload -> 'refId') is distinct from 'string'
     or btrim(payload ->> 'refId') = '' then
    raise exception 'Item wajib dipilih';
  end if;
  v_ref_id := (payload ->> 'refId')::uuid;

  begin
    v_qty := (payload ->> 'qtyChange')::numeric;
  exception when others then
    raise exception 'Jumlah tidak valid';
  end;
  if v_qty is null or v_qty = 0 then
    raise exception 'Jumlah tidak boleh nol';
  end if;

  -- Alasan otomatis milik sistem tidak boleh dipakai manual.
  v_reason := btrim(coalesce(payload ->> 'reason', ''));
  if v_reason not in ('pembelian', 'koreksi', 'retur', 'rusak') then
    raise exception 'Alasan harus pembelian/koreksi/retur/rusak';
  end if;

  v_note := nullif(btrim(coalesce(payload ->> 'note', '')), '');

  -- Kunci baris item supaya dua penyesuaian bersamaan tidak saling menimpa.
  if v_kind = 'product' then
    -- products.stock bertipe integer — tolak pecahan sebelum dibulatkan diam-diam.
    if v_qty <> trunc(v_qty) then
      raise exception 'Jumlah produk harus bilangan bulat';
    end if;
    select name, stock into v_name, v_before
      from products where id = v_ref_id and active for update;
    if not found then
      raise exception 'Produk tidak ditemukan atau nonaktif';
    end if;
  else
    select name, stock into v_name, v_before
      from spareparts where id = v_ref_id and active for update;
    if not found then
      raise exception 'Sparepart tidak ditemukan atau nonaktif';
    end if;
  end if;

  v_after := v_before + v_qty;
  if v_after < 0 then
    raise exception 'Stok % tidak cukup (tersedia %, diminta %)',
      v_name, v_before, abs(v_qty);
  end if;

  if v_kind = 'product' then
    update products set stock = v_after::integer where id = v_ref_id;
  else
    update spareparts set stock = v_after where id = v_ref_id;
  end if;

  insert into stock_movements
    (item_kind, ref_id, name, qty_change, reason, transaction_id, created_by)
  values
    (v_kind::item_kind, v_ref_id, v_name, v_qty, v_reason, null, v_uid)
  returning id into v_movement_id;

  insert into audit_logs (actor_uid, action, target, detail)
  values (v_uid, 'stock.adjust', v_ref_id::text,
          jsonb_build_object('itemKind', v_kind, 'name', v_name,
                             'qtyChange', v_qty, 'reason', v_reason,
                             'stockBefore', v_before, 'stockAfter', v_after,
                             'note', v_note));

  return jsonb_build_object('ok', true, 'stock', v_after,
                            'movementId', v_movement_id);
end;
$$;

revoke execute on function adjust_stock(jsonb) from anon, public;
grant execute on function adjust_stock(jsonb) to authenticated;
