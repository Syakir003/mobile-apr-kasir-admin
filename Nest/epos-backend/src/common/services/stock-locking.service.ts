import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type StockKind = 'product' | 'sparepart';

export interface LockedItem {
  name: string;
  unit: string;
  unitPrice: number;
  buyPrice: number | null;
}

/**
 * Port dari pola `FOR UPDATE` di checkout_transaction (pos_functions.sql,
 * baris ~308-336) dan mark_material_used (payment_approval_photo_rules.sql).
 * `FOR UPDATE` mengunci baris sampai transaksi commit/rollback. WAJIB
 * dipanggil di dalam Prisma interactive transaction (`$transaction`).
 *
 * Siklus batch-cost (2026-09) — `product` sekarang punya banyak "batch"
 * harga (tabel `item_costs`), `sparepart` TETAP 1 harga simpel langsung di
 * tabel `spareparts`. Dua kind ini sekarang punya jalur lock yang beda
 * total buat produk, bukan cuma parameter tabel yang beda kayak dulu.
 */
@Injectable()
export class StockLockingService {
  /**
   * Kunci & kurangi stok. `sparepart` — persis kayak sebelumnya, langsung
   * di tabel `spareparts`. `product` — otomatis FIFO lintas batch
   * `item_costs` (batch TERTUA duluan). Dipakai caller yang TIDAK minta
   * user milih batch spesifik (MaterialRequestsService — pengajuan
   * material teknisi). PosService.checkout TIDAK lewat sini buat
   * kind='product' — dia pakai `lockAndDeductProductBatch` di bawah,
   * karena kasir manual milih batch mana yang dijual.
   */
  async lockAndDeduct(
    tx: Prisma.TransactionClient,
    kind: StockKind,
    refId: string,
    qty: number,
  ): Promise<LockedItem> {
    if (kind === 'sparepart') {
      const rows = await tx.$queryRawUnsafe<
        { name: string; active: boolean; stock: unknown; sell_price: unknown }[]
      >(`SELECT name, active, stock, sell_price FROM spareparts WHERE id = $1 FOR UPDATE`, refId);

      const row = rows[0];
      if (!row) throw new BadRequestException(`Item sparepart ${refId} tidak ditemukan`);
      if (!row.active) throw new BadRequestException(`${row.name} tidak aktif`);
      if (Number(row.stock) < qty) {
        throw new BadRequestException(`Stok ${row.name} tidak cukup`);
      }

      await tx.$executeRawUnsafe(`UPDATE spareparts SET stock = stock - $1 WHERE id = $2`, qty, refId);

      return { name: row.name, unit: 'pcs', unitPrice: Number(row.sell_price), buyPrice: null };
    }

    // kind === 'product' — FIFO lintas batch item_costs.
    const productRows = await tx.$queryRawUnsafe<{ name: string; active: boolean }[]>(
      `SELECT name, active FROM products WHERE id = $1`,
      refId,
    );
    const product = productRows[0];
    if (!product) throw new BadRequestException(`Produk ${refId} tidak ditemukan`);
    if (!product.active) throw new BadRequestException(`${product.name} tidak aktif`);

    const batches = await tx.$queryRawUnsafe<
      { id: string; stock: number; sell_price: unknown; buy_price: unknown }[]
    >(
      `SELECT id, stock, sell_price, buy_price FROM item_costs
       WHERE kind = 'product' AND ref_id = $1 AND stock > 0
       ORDER BY created_at ASC FOR UPDATE`,
      refId,
    );

    let remaining = qty;
    let firstPrice: number | null = null;
    let firstBuyPrice: number | null = null;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, batch.stock);
      if (take <= 0) continue;
      await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = stock - $1 WHERE id = $2`, take, batch.id);
      if (firstPrice === null) {
        firstPrice = Number(batch.sell_price);
        firstBuyPrice = Number(batch.buy_price);
      }
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BadRequestException(`Stok ${product.name} tidak cukup`);
    }

    return { name: product.name, unit: 'unit', unitPrice: firstPrice ?? 0, buyPrice: firstBuyPrice };
  }

  /**
   * Khusus checkout (PosService) — kasir udah manual milih BATCH spesifik
   * lewat dialog pemilihan batch di POS. Kunci 1 baris `item_costs` persis
   * sesuai `itemCostId` (`FOR UPDATE OF ic` — sengaja gak ikut ngunci baris
   * `products` yang di-JOIN, biar 2 checkout produk yang sama tapi beda
   * batch tetap bisa jalan paralel), validasi produk induk masih aktif,
   * cek stok batch cukup, lalu kurangi.
   */
  async lockAndDeductProductBatch(
    tx: Prisma.TransactionClient,
    itemCostId: string,
    qty: number,
  ): Promise<LockedItem> {
    const rows = await tx.$queryRawUnsafe<
      { product_name: string; active: boolean; stock: number; sell_price: unknown; buy_price: unknown }[]
    >(
      `SELECT p.name AS product_name, p.active AS active, ic.stock AS stock,
              ic.sell_price AS sell_price, ic.buy_price AS buy_price
       FROM item_costs ic
       JOIN products p ON p.id = ic.ref_id
       WHERE ic.id = $1 AND ic.kind = 'product'
       FOR UPDATE OF ic`,
      itemCostId,
    );

    const row = rows[0];
    if (!row) throw new BadRequestException(`Batch produk ${itemCostId} tidak ditemukan`);
    if (!row.active) throw new BadRequestException(`${row.product_name} tidak aktif`);
    if (row.stock < qty) {
      throw new BadRequestException(`Stok batch ${row.product_name} tidak cukup`);
    }

    await tx.$executeRawUnsafe(`UPDATE item_costs SET stock = stock - $1 WHERE id = $2`, qty, itemCostId);

    return {
      name: row.product_name,
      unit: 'unit',
      unitPrice: Number(row.sell_price),
      buyPrice: Number(row.buy_price),
    };
  }

  /**
   * Kunci 1 baris `spareparts`, tambah stok. Dipakai barang masuk & opname
   * SPAREPART SAJA. TIDAK cek `active`. Siklus batch-cost (2026-09):
   * kind='product' TIDAK lewat sini lagi — barang masuk produk sekarang
   * selalu bikin baris `item_costs` (batch) baru lewat
   * `StockService.stockIn()` langsung (`tx.itemCost.create`), gak lewat
   * increment kayak dulu.
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
