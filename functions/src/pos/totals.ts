export interface LineItem {
  qty: number;
  unitPrice: number;
}

export interface TotalsResult {
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
}

/**
 * Hitung total transaksi dengan rounding per baris.
 *
 * Rumus: lineTotal = round(qty * unitPrice); subtotal = sum(lineTotal);
 * taxBase = subtotal - discount; taxAmount = round(taxBase * taxPercent / 100);
 * grandTotal = taxBase + taxAmount + transportFee.
 *
 * Transport TIDAK kena pajak.
 */
export function computeTotals(
  lines: LineItem[],
  discount: number,
  taxPercent: number,
  transportFee: number
): TotalsResult {
  // Hitung subtotal dengan rounding per baris
  const subtotal = lines.reduce((sum, line) => {
    const lineTotal = Math.round(line.qty * line.unitPrice);
    return sum + lineTotal;
  }, 0);

  // Hitung tax base dan tax amount
  const taxBase = subtotal - discount;
  const taxAmount = Math.round((taxBase * taxPercent) / 100);

  // Hitung grand total
  const grandTotal = taxBase + taxAmount + transportFee;

  return {
    subtotal,
    taxAmount,
    grandTotal,
  };
}
