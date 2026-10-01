/** Port dari totals.ts lama — logicnya sudah kebukti benar, cuma pindah bahasa. */
export function computeTotals(
  lines: { qty: number; unitPrice: number; discount?: number }[],
  discount: number,
  taxPercent: number,
  transportFee: number,
) {
  const subtotal = lines.reduce(
    (sum, l) => sum + Math.round(l.qty * l.unitPrice) - (l.discount ?? 0),
    0,
  );
  const taxBase = subtotal - discount;
  const taxAmount = Math.round((taxBase * taxPercent) / 100);
  const grandTotal = taxBase + taxAmount + transportFee;
  return { subtotal, taxAmount, grandTotal };
}

export function formatInvoiceNumber(dateKey: string, seq: number): string {
  return `INV-${dateKey}-${String(seq).padStart(4, '0')}`;
}

export interface BatchDeduction {
  itemCostId: string;
  qty: number;
}

/**
 * Siklus sparepart-per-gulungan (2026-09-23) — dipakai PosService.checkout.
 * Kasusnya: 1 sparepart batchTracked bisa dipakai di DUA tempat sekaligus
 * dalam 1 checkout (baris cart biasa DAN paket instalasi) — keduanya digabung
 * jadi SATU kebutuhan qty lalu di-FIFO SEKALI lewat
 * StockLockingService.lockAndDeduct (biar lock & alokasi batch konsisten).
 * Fungsi ini misahin balik hasil FIFO gabungan itu (`deductions`, urut
 * TERTUA dulu, sama urutan batch dikunci) ke tiap consumer aslinya (`consumers`,
 * urutan sesuai urutan consumer butuh dilayani — cart item duluan, baru paket)
 * — biar StockMovement per-baris tetap presisi nunjuk batch/roll mana yang
 * kepotong, bukan cuma 1 baris gabungan yang nunjuk batch pertama doang.
 *
 * PRASYARAT: SUM(consumers[].qty) === SUM(deductions[].qty) — keduanya
 * berasal dari qty yang SAMA (qty gabungan yang dikirim ke lockAndDeduct).
 * Kalau gak match, itu bug pemanggil (bukan kondisi user-facing), makanya
 * lempar Error biasa (bukan BadRequestException) — harusnya ketauan pas
 * development/test, bukan kejadian di produksi.
 */
export function allocateBatchDeductions<T>(
  consumers: { qty: number; meta: T }[],
  deductions: BatchDeduction[],
): { meta: T; itemCostId: string; qty: number }[] {
  const result: { meta: T; itemCostId: string; qty: number }[] = [];
  let batchIdx = 0;
  let batchRemaining = deductions[0]?.qty ?? 0;

  for (const consumer of consumers) {
    let need = consumer.qty;
    while (need > 0) {
      if (batchRemaining <= 0) {
        batchIdx += 1;
        if (batchIdx >= deductions.length) {
          throw new Error(
            'allocateBatchDeductions: total qty consumer melebihi total qty deductions — qty gabungan gak sinkron (bug pemanggil)',
          );
        }
        batchRemaining = deductions[batchIdx].qty;
      }
      const take = Math.min(need, batchRemaining);
      result.push({ meta: consumer.meta, itemCostId: deductions[batchIdx].itemCostId, qty: take });
      need -= take;
      batchRemaining -= take;
    }
  }
  return result;
}

/** Info pairing 1 produk yang relevan buat nentuin baris "unit satuan". */
export interface ProductPairInfo {
  /** Id Outdoor pasangannya kalau produk ini Indoor sebuah paket. */
  pairedProductId: string | null;
  /** Id Indoor yang masangin produk ini kalau produk ini Outdoor sebuah paket. */
  pairedIndoorId: string | null;
}

/**
 * Paket AC Split (2026-09-30) — index baris cart produk yang dijual SATUAN
 * (Indoor saja / Outdoor saja) dari produk AC yang BERPASANGAN, alias BUKAN
 * bagian dari Split (pasangan `pairedWithItemIndex`) di cart yang sama.
 * Baris-baris ini: modal paket gak dipecah per unit (HPP 0 + ditandai
 * `costUnallocated`), dan checkout minta konfirmasi "jual 1 unit dari paket"
 * alih-alih warning di-bawah-modal biasa. Produk yang gak berpasangan sama
 * sekali (produk standalone, termasuk "Indoor saja"/"Outdoor saja" yang
 * dibuat tanpa pasangan) GAK termasuk — harga jualnya emang harga unit itu.
 */
export function findSingleUnitLineIndexes(
  items: { kind: string; refId: string; pairedWithItemIndex?: number }[],
  pairInfo: Map<string, ProductPairInfo>,
): number[] {
  const splitIndexes = new Set<number>();
  items.forEach((item, idx) => {
    if (item.pairedWithItemIndex === undefined) return;
    splitIndexes.add(idx);
    splitIndexes.add(item.pairedWithItemIndex);
  });
  const result: number[] = [];
  items.forEach((item, idx) => {
    if (item.kind !== 'product' || splitIndexes.has(idx)) return;
    const info = pairInfo.get(item.refId);
    if (info && (info.pairedProductId || info.pairedIndoorId)) result.push(idx);
  });
  return result;
}
