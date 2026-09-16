/**
 * Cek harga jual efektif (setelah diskon per-item) VS harga modal batch —
 * dipakai bareng PosService (checkout) & StockService (barang masuk) biar
 * aturan "jual di bawah modal" konsisten di dua tempat itu. Breakeven
 * (effectivePrice === buyPrice) DIANGGAP kena warning juga, bukan cuma
 * yang di bawahnya — dikonfirmasi user 2026-09-08.
 */
export interface BelowCostInput {
  buyPrice: number;
  sellPrice: number;
  discount?: number;
}

export interface BelowCostResult {
  isBelowCost: boolean;
  effectivePrice: number;
}

export function checkBelowCost({
  buyPrice,
  sellPrice,
  discount = 0,
}: BelowCostInput): BelowCostResult {
  const effectivePrice = sellPrice - discount;
  return { isBelowCost: effectivePrice <= buyPrice, effectivePrice };
}
