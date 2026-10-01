import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type StockKind = 'product' | 'sparepart';

export interface LockedItem {
  name: string;
  unit: string;
  unitPrice: number;
  // product & sparepart batchTracked=true: MAX(buyPrice) dari SEMUA batch
  // yang MASIH BERSTOK (skenario termahal, dipakai warning "jual di bawah
  // modal") — BUKAN cuma batch yang kena FIFO-deduct. sparepart flat: selalu
  // null (gak ada batch).
  buyPrice: number | null;
  // Diisi kalau kind='product' ATAU kind='sparepart' dengan batchTracked=
  // true — daftar batch (ItemCost) yang BENERAN kepotong stoknya lewat FIFO
  // (bisa lebih dari 1 kalau qty nembus beberapa batch/roll sekaligus).
  // Dipakai caller (PosService, MaterialRequestsService) buat bikin
  // StockMovement PER-BATCH, biar histori mutasi tetap presisi walau 1
  // baris cart/pengajuan bisa narik dari beberapa batch/roll.
  batchDeductions?: { itemCostId: string; qty: number }[];
  // BARU (Siklus QR per-unit, 2026-09-30) — id baris StockUnit yang
  // BENERAN dipilih & di-reserve FIFO (cuma keisi buat kind='product').
  // Dipakai PosService.checkout buat nandain `reservedForInvoiceId` abis
  // invoice-nya lahir (lockAndDeduct dipanggil SEBELUM invoice ada, jadi
  // id invoice belum bisa langsung ditulis di sini).
  reservedUnitIds?: string[];
  // BARU (Sparepart utuh/eceran, 2026-09-30) — pengali dari qty baris ke
  // satuan kecil (`spareparts.unit`): 1 buat eceran/produk/jasa, `packSize`
  // buat jual utuh. Caller WAJIB pakai ini buat StockMovement/alokasi batch
  // (qty di baris = jumlah packUnit, stok & movement selalu satuan kecil).
  // Untuk jual utuh: `unit` = packUnit, `unitPrice` = harga utuh, dan
  // `buyPrice` TETAP per satuan kecil (caller kali qtyMultiplier buat modal
  // per packUnit).
  qtyMultiplier?: number;
  saleKind?: SaleKind | null;
}

export type SaleKind = 'utuh' | 'eceran';

/**
 * Port dari pola `FOR UPDATE` di checkout_transaction (pos_functions.sql,
 * baris ~308-336) dan mark_material_used (payment_approval_photo_rules.sql).
 * `FOR UPDATE` mengunci baris sampai transaksi commit/rollback. WAJIB
 * dipanggil di dalam Prisma interactive transaction (`$transaction`).
 */
@Injectable()
export class StockLockingService {
  /**
   * Kunci & kurangi stok.
   * - `product` — SELALU FIFO lintas batch `item_costs` (batch TERTUA
   *   duluan). Harga jual dari `Product.sellPrice` (seragam, Siklus
   *   harga-seragam 2026-09-22).
   * - `sparepart` DENGAN `batchTracked=false` — langsung potong kolom
   *   `spareparts.stock` (flat, perilaku lama, gak berubah).
   * - `sparepart` DENGAN `batchTracked=true` (Siklus sparepart-per-gulungan
   *   2026-09-23) — FIFO lintas batch `item_costs` SAMA POLA kayak produk,
   *   TAPI harga jual tetap dari `Sparepart.sellPrice` (satu harga per
   *   meter, BUKAN per-batch kayak produk — beda sengaja, lihat spec Point
   *   3). Kolom `spareparts.stock` (mirror) ikut dipotong di baris yang
   *   sama (row-nya udah kekunci FOR UPDATE di awal method ini).
   */
  async lockAndDeduct(
    tx: Prisma.TransactionClient,
    kind: StockKind,
    refId: string,
    qty: number,
    saleKind?: SaleKind | null,
  ): Promise<LockedItem> {
    if (kind === 'sparepart') {
      const rows = await tx.$queryRawUnsafe<
        {
          name: string;
          active: boolean;
          unit: string;
          batch_tracked: boolean;
          stock: unknown;
          sell_price: unknown;
          tracking_mode: string;
          pack_unit: string | null;
          pack_size: unknown;
          sell_price_pack: unknown;
        }[]
      >(
        `SELECT name, active, unit, batch_tracked, stock, sell_price,
                tracking_mode, pack_unit, pack_size, sell_price_pack
         FROM spareparts WHERE id = $1 FOR UPDATE`,
        refId,
      );

      const row = rows[0];
      if (!row) throw new BadRequestException(`Item sparepart ${refId} tidak ditemukan`);
      if (!row.active) throw new BadRequestException(`${row.name} tidak aktif`);

      // Jual UTUH (2026-09-30) — cuma mode konversi/gabungan. qty = jumlah
      // packUnit (bulat); stok dipotong qty x packSize satuan kecil.
      const isUtuh = saleKind === 'utuh';
      const packSize = row.pack_size === null ? null : Number(row.pack_size);
      if (isUtuh) {
        if (!['konversi', 'gabungan'].includes(row.tracking_mode) || !packSize || !row.pack_unit) {
          throw new BadRequestException(`${row.name} tidak bisa dijual utuh`);
        }
        if (qty !== Math.trunc(qty)) {
          throw new BadRequestException(`Jumlah ${row.pack_unit} ${row.name} harus bilangan bulat`);
        }
      }
      const multiplier = isUtuh ? packSize! : 1;
      const baseQty = Math.round(qty * multiplier * 100) / 100;
      const saleUnit = isUtuh ? row.pack_unit! : row.unit;
      const salePrice = isUtuh ? Number(row.sell_price_pack) : Number(row.sell_price);

      if (!row.batch_tracked) {
        // Flat — perilaku lama, gak berubah (selain fix bug unit hardcode
        // 'pcs' di bawah, yang sekarang baca `row.unit` asli). Mode
        // 'konversi' juga lewat sini: stok angka di satuan kecil.
        if (Number(row.stock) < baseQty) {
          throw new BadRequestException(`Stok ${row.name} tidak cukup`);
        }
        await tx.$executeRawUnsafe(
          `UPDATE spareparts SET stock = stock - $1 WHERE id = $2`,
          baseQty,
          refId,
        );
        return {
          name: row.name,
          unit: saleUnit,
          unitPrice: salePrice,
          buyPrice: null,
          qtyMultiplier: multiplier,
          saleKind: saleKind ?? null,
        };
      }

      // batchTracked=true — FIFO lintas item_costs, sama pola kayak produk.
      // Mode 'gabungan' (2026-09-30):
      //   - UTUH: cuma roll yang masih PENUH (stok = packSize), tiap roll
      //     habis sekaligus; kurang dari `qty` roll penuh => ditolak.
      //   - ECERAN: roll yang udah kebuka (stok < packSize) dipakai dulu,
      //     baru roll penuh (FIFO umur di masing-masing kelompok).
      const useFullOnly = isUtuh && row.tracking_mode === 'gabungan';
      const openedFirst = !isUtuh && row.tracking_mode === 'gabungan' && packSize !== null;
      const batches = await tx.$queryRawUnsafe<
        { id: string; stock: unknown; buy_price: unknown }[]
      >(
        `SELECT id, stock, buy_price FROM item_costs
         WHERE kind = 'sparepart' AND ref_id = $1 AND stock > 0
           ${useFullOnly ? 'AND stock = $2::numeric' : ''}
         ORDER BY ${openedFirst ? 'CASE WHEN stock = $2::numeric THEN 1 ELSE 0 END ASC,' : ''} created_at ASC
         FOR UPDATE`,
        ...(useFullOnly || openedFirst ? [refId, packSize] : [refId]),
      );

      let remaining = baseQty;
      let maxBuyPrice: number | null = null;
      const batchDeductions: { itemCostId: string; qty: number }[] = [];
      for (const batch of batches) {
        // GOTCHA node-pg: item_costs.stock sekarang NUMERIC (Task 1), balik
        // sebagai string dari $queryRawUnsafe — wajib Number() eksplisit,
        // beda dari sebelum migrasi (INTEGER auto-parse ke number).
        const batchStock = Number(batch.stock);
        const buyPrice = Number(batch.buy_price);
        maxBuyPrice = maxBuyPrice === null ? buyPrice : Math.max(maxBuyPrice, buyPrice);

        if (remaining <= 0) continue;
        const take = Math.min(remaining, batchStock);
        if (take <= 0) continue;
        await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = stock - $1 WHERE id = $2`, take, batch.id);
        batchDeductions.push({ itemCostId: batch.id, qty: take });
        remaining = Math.round((remaining - take) * 100) / 100;
      }
      if (remaining > 0) {
        throw new BadRequestException(
          useFullOnly
            ? `${row.name}: ${row.pack_unit} utuh tidak cukup (tersedia ${batches.length}, diminta ${qty}) — sisanya sudah dibuka, jual eceran`
            : `Stok ${row.name} tidak cukup`,
        );
      }

      // Mirror spareparts.stock ikut kepotong — row udah kekunci FOR UPDATE
      // di query pertama method ini, aman dari race.
      await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = stock - $1 WHERE id = $2`, baseQty, refId);

      return {
        name: row.name,
        unit: saleUnit,
        unitPrice: salePrice,
        buyPrice: maxBuyPrice,
        batchDeductions,
        qtyMultiplier: multiplier,
        saleKind: saleKind ?? null,
      };
    }

    // kind === 'product' — Siklus QR per-unit (2026-09-30): FIFO sekarang
    // pilih UNIT INDIVIDUAL (StockUnit), bukan decrement angka item_costs.
    // stock lagi (kolom itu dipensiunkan buat kind='product', lihat komentar
    // di schema.prisma model ItemCost). Status unit yang dipilih langsung
    // di-flip ke 'reserved' DI SINI (row udah kekunci FOR UPDATE) — belum
    // ditandain invoice mana, itu ditulis belakangan sama PosService.checkout
    // begitu invoice.id ada (lihat komentar reservedUnitIds di LockedItem).
    const productRows = await tx.$queryRawUnsafe<
      { name: string; active: boolean; sell_price: unknown }[]
    >(`SELECT name, active, sell_price FROM products WHERE id = $1`, refId);
    const product = productRows[0];
    if (!product) throw new BadRequestException(`Produk ${refId} tidak ditemukan`);
    if (!product.active) throw new BadRequestException(`${product.name} tidak aktif`);

    // MAX(buyPrice) dari SEMUA batch yang MASIH ADA unit 'di_gudang' —
    // skenario "harga modal TERMAHAL" buat warning below-cost (keputusan
    // user 2026-09-22), gak peduli batch itu kena FIFO consume di bawah atau
    // enggak — SAMA prinsip kayak sebelumnya, cuma sumber datanya sekarang
    // dicek lewat EXISTS ke stock_units, bukan kolom stock langsung.
    const batches = await tx.$queryRawUnsafe<{ id: string; buy_price: unknown }[]>(
      `SELECT ic.id, ic.buy_price FROM item_costs ic
       WHERE ic.kind = 'product' AND ic.ref_id = $1
         AND EXISTS (SELECT 1 FROM stock_units su WHERE su.item_cost_id = ic.id AND su.status = 'di_gudang')
       ORDER BY ic.id FOR UPDATE`,
      refId,
    );
    if (batches.length === 0) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup`);
    }
    const maxBuyPrice = Math.max(...batches.map((b) => Number(b.buy_price)));

    // FIFO beneran — `qty` unit TERTUA (urut created_at batch dulu, baru
    // created_at unit dalam batch itu), row-locked biar checkout paralel gak
    // bisa rebutan unit yang sama.
    const availableUnits = await tx.$queryRawUnsafe<{ id: string; item_cost_id: string }[]>(
      `SELECT su.id, su.item_cost_id
       FROM stock_units su
       JOIN item_costs ic ON ic.id = su.item_cost_id
       WHERE su.ref_id = $1 AND su.status = 'di_gudang'
       ORDER BY ic.created_at ASC, su.created_at ASC
       LIMIT $2
       FOR UPDATE OF su`,
      refId,
      qty,
    );
    if (availableUnits.length < qty) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup`);
    }

    const batchQtyMap = new Map<string, number>();
    for (const u of availableUnits) {
      batchQtyMap.set(u.item_cost_id, (batchQtyMap.get(u.item_cost_id) ?? 0) + 1);
    }
    const batchDeductions = [...batchQtyMap].map(([itemCostId, unitCount]) => ({ itemCostId, qty: unitCount }));
    const reservedUnitIds = availableUnits.map((u) => u.id);

    await tx.$executeRawUnsafe(
      `UPDATE stock_units SET status = 'reserved', reserved_at = now() WHERE id = ANY($1)`,
      reservedUnitIds,
    );

    return {
      name: product.name,
      unit: 'unit',
      unitPrice: Number(product.sell_price),
      buyPrice: maxBuyPrice,
      batchDeductions,
      reservedUnitIds,
    };
  }

  /**
   * Kunci 1 baris `spareparts`, tambah stok. Dipakai barang masuk & opname
   * SPAREPART FLAT (batchTracked=false) SAJA. Sparepart batchTracked=true
   * pakai jalur baru di StockService.stockIn (bikin N baris item_costs,
   * bukan lewat sini) — lihat Task 6. TIDAK cek `active`. Barang masuk
   * produk selalu bikin baris `item_costs` (batch) baru lewat
   * `StockService.stockIn()` langsung (`tx.itemCost.create`), gak lewat sini.
   */
  async lockAndAdd(
    tx: Prisma.TransactionClient,
    refId: string,
    qty: number,
  ): Promise<{ name: string; previousStock: number }> {
    const rows = await tx.$queryRawUnsafe<{ name: string; stock: unknown }[]>(
      `SELECT name, stock FROM spareparts WHERE id = $1 FOR UPDATE`,
      refId,
    );

    const row = rows[0];
    if (!row) throw new BadRequestException(`Item sparepart ${refId} tidak ditemukan`);

    await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = stock + $1 WHERE id = $2`, qty, refId);

    return { name: row.name, previousStock: Number(row.stock) };
  }
}
