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
