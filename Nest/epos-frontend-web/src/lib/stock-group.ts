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

interface MovementRow {
  name: string;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  pairRole?: 'indoor' | 'outdoor';
  unitGabungan?: { namaPasangan: string };
}

// Barang tanpa stok & tanpa pergerakan (semua angka 0) disembunyikan — katalog
// besar membuat laporan penuh baris nol. Paket Indoor+Outdoor disembunyikan
// hanya bila KEDUANYA nol, supaya pasangan tidak terpisah. Dipakai bersama oleh
// halaman Laporan Stok dan halaman cetaknya.
export function hideEmptyRows<T extends MovementRow>(items: T[]): { shown: T[]; hiddenCount: number } {
  const isEmpty = (r: T) => !r.stokAwal && !r.stokMasuk && !r.stokKeluar && !r.sisaStok;
  const shown: T[] = [];
  let hiddenCount = 0;
  for (let i = 0; i < items.length; i++) {
    const r = items[i];
    const next = items[i + 1];
    const pairNext =
      r.unitGabungan && next?.pairRole === 'outdoor' && next.name === r.unitGabungan.namaPasangan ? next : undefined;
    const unit = pairNext ? [r, pairNext] : [r];
    if (unit.every(isEmpty)) hiddenCount += unit.length;
    else shown.push(...unit);
    if (pairNext) i++;
  }
  return { shown, hiddenCount };
}
