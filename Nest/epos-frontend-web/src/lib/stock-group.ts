// Breakdown laporan stok per merk (cek fisik gudang). Produk dikelompokkan
// per `brand`, sparepart masuk satu grup "Sparepart" (gak punya merk).
// Urutan baris di dalam grup dipertahankan (paket Indoor/Outdoor tetap
// berdampingan karena backend sudah mengurutkannya).
interface GroupableRow {
  itemKind: 'product' | 'sparepart';
  brand?: string | null;
  sisaStok: number;
}

export interface StockGroup<T extends GroupableRow> {
  label: string;
  rows: T[];
  totalSisa: number;
}

export const SPAREPART_GROUP = 'Sparepart';

export function groupLabel(row: GroupableRow): string {
  if (row.itemKind === 'sparepart') return SPAREPART_GROUP;
  return row.brand?.trim() || 'Tanpa merk';
}

export function groupStockRows<T extends GroupableRow>(rows: T[]): StockGroup<T>[] {
  const map = new Map<string, StockGroup<T>>();
  for (const row of rows) {
    const label = groupLabel(row);
    const g = map.get(label) ?? { label, rows: [], totalSisa: 0 };
    g.rows.push(row);
    g.totalSisa += row.sisaStok;
    map.set(label, g);
  }
  // Merk A-Z, Sparepart paling bawah.
  return [...map.values()].sort((a, b) =>
    a.label === SPAREPART_GROUP ? 1 : b.label === SPAREPART_GROUP ? -1 : a.label.localeCompare(b.label),
  );
}
