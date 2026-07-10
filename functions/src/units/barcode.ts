/** Kunci tanggal YYYYMMDD (dipakai juga untuk id dokumen counter harian). */
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Barcode unit AC: ACUNIT-YYYYMMDD-XXXX, seq berjalan per hari pad 4. */
export function formatBarcode(date: Date, seq: number): string {
  return `ACUNIT-${dateKey(date)}-${String(seq).padStart(4, "0")}`;
}
