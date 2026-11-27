/** Harga modal (`item_costs.buy_price`) boleh NULL = belum diisi admin.
 * `Number(null)` itu 0, jadi semua pembaca modal lewat sini. */
export function toCost(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Modal tertinggi dari yang SUDAH terisi; null bila tak satu pun terisi. */
export function maxKnownCost(values: unknown[]): number | null {
  const known = values.map(toCost).filter((v): v is number => v !== null);
  return known.length ? Math.max(...known) : null;
}
