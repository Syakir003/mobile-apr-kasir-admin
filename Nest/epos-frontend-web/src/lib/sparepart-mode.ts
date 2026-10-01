// Mode pelacakan & penjualan sparepart (2026-09-30). Mirror dari
// SparepartsService di backend (sparepart-mode.util.ts).

export type SparepartMode = 'biasa' | 'gulungan' | 'konversi' | 'gabungan';

export interface SparepartModeFields {
  trackingMode: SparepartMode;
  batchTracked: boolean;
  unit: string;
  packUnit: string | null;
  packSize: string | null;
  sellPricePack: string | null;
}

export const MODE_OPTIONS: { value: SparepartMode; label: string; hint: string }[] = [
  { value: 'biasa', label: 'Biasa (pcs)', hint: 'Stok angka biasa, satu satuan.' },
  {
    value: 'gulungan',
    label: 'Per Gulungan/Tabung',
    hint: 'Sisa tiap roll/tabung dicatat; dijual eceran per satuan kecil.',
  },
  {
    value: 'konversi',
    label: 'Utuh + Eceran',
    hint: 'Stok angka di satuan kecil; bisa dijual utuh (1 dus/roll) atau eceran.',
  },
  {
    value: 'gabungan',
    label: 'Gabungan (per roll + utuh/eceran)',
    hint: 'Sisa tiap roll/tabung dicatat dan bisa dijual utuh atau eceran.',
  },
];

export function hasPackSale(mode: SparepartMode): boolean {
  return mode === 'konversi' || mode === 'gabungan';
}

export function isBatchMode(mode: SparepartMode): boolean {
  return mode === 'gulungan' || mode === 'gabungan';
}

export function modeLabel(mode: SparepartMode): string {
  return MODE_OPTIONS.find((m) => m.value === mode)?.label ?? mode;
}

export interface SparepartTemplate {
  key: string;
  /** Nama yang diisikan ke form (kalau nama masih kosong). */
  name: string;
  category: string;
  mode: SparepartMode;
  unit: string;
  packUnit?: string;
  packSize?: string;
}

export interface SparepartTemplateGroup {
  label: string;
  items: SparepartTemplate[];
}

// Template cepat sparepart AC — cuma isian awal (nama, kategori, mode, satuan,
// isi kemasan); semuanya tetap bisa diedit di form. Isi kemasan = ukuran yang
// umum di pasaran, sesuaikan dengan barang yang dibeli.
const pipa = (size: string): SparepartTemplate => ({
  key: `pipa-${size}`,
  name: `Pipa tembaga ${size}`,
  category: 'Pipa & Insulasi',
  mode: 'gabungan',
  unit: 'm',
  packUnit: 'roll',
  packSize: '15',
});
const freon = (type: string, kg: string): SparepartTemplate => ({
  key: `freon-${type}`,
  name: `Freon ${type}`,
  category: 'Freon & Gas',
  mode: 'gabungan',
  unit: 'kg',
  packUnit: 'tabung',
  packSize: kg,
});
const kabel = (key: string, name: string, m: string): SparepartTemplate => ({
  key,
  name,
  category: 'Kabel',
  mode: 'gabungan',
  unit: 'm',
  packUnit: 'rol',
  packSize: m,
});
const dus = (key: string, name: string, pcs: string, category = 'Baut & Pengikat'): SparepartTemplate => ({
  key,
  name,
  category,
  mode: 'konversi',
  unit: 'pcs',
  packUnit: 'dus',
  packSize: pcs,
});
const satuan = (key: string, name: string, category: string, unit = 'pcs'): SparepartTemplate => ({
  key,
  name,
  category,
  mode: 'biasa',
  unit,
});

export const SPAREPART_TEMPLATE_GROUPS: SparepartTemplateGroup[] = [
  {
    label: 'Freon & Gas (tabung → kg)',
    items: [freon('R32', '10'), freon('R410A', '11.3'), freon('R22', '13.6'), freon('R134a', '13.6')],
  },
  {
    label: 'Pipa & Insulasi (roll → meter)',
    items: [
      pipa('1/4"'),
      pipa('3/8"'),
      pipa('1/2"'),
      pipa('5/8"'),
      pipa('3/4"'),
      {
        key: 'insulasi',
        name: 'Insulasi pipa (armaflex)',
        category: 'Pipa & Insulasi',
        mode: 'konversi',
        unit: 'm',
        packUnit: 'batang',
        packSize: '2',
      },
      {
        key: 'selang-drain',
        name: 'Selang drain',
        category: 'Pipa & Insulasi',
        mode: 'konversi',
        unit: 'm',
        packUnit: 'roll',
        packSize: '50',
      },
      {
        key: 'pvc',
        name: 'Pipa PVC drain 3/4"',
        category: 'Pipa & Insulasi',
        mode: 'konversi',
        unit: 'm',
        packUnit: 'batang',
        packSize: '4',
      },
    ],
  },
  {
    label: 'Kabel (rol → meter)',
    items: [
      kabel('nym-15', 'Kabel NYM 3x1,5', '50'),
      kabel('nym-25', 'Kabel NYM 3x2,5', '50'),
      kabel('nyyhy', 'Kabel NYYHY 4x1,5 (kontrol indoor-outdoor)', '50'),
      kabel('nyaf', 'Kabel NYAF (fleksibel)', '100'),
    ],
  },
  {
    label: 'Bahan Habis Pakai',
    items: [
      {
        key: 'oli',
        name: 'Oli kompresor (POE)',
        category: 'Bahan Habis Pakai',
        mode: 'konversi',
        unit: 'liter',
        packUnit: 'jerigen',
        packSize: '5',
      },
      {
        key: 'chemical',
        name: 'Cairan cuci AC (coil cleaner)',
        category: 'Bahan Habis Pakai',
        mode: 'konversi',
        unit: 'liter',
        packUnit: 'jerigen',
        packSize: '5',
      },
      satuan('foam', 'Foam cleaner (kaleng)', 'Bahan Habis Pakai', 'kaleng'),
      satuan('wrapping', 'Isolasi pipa (wrapping tape)', 'Bahan Habis Pakai', 'roll'),
      satuan('lakban', 'Lakban / duct tape', 'Bahan Habis Pakai', 'roll'),
      satuan('silver', 'Kawat las perak (brazing)', 'Bahan Habis Pakai', 'batang'),
      satuan('flux', 'Flux / pasta las', 'Bahan Habis Pakai', 'kaleng'),
    ],
  },
  {
    label: 'Baut & Pengikat (dus → pcs)',
    items: [
      dus('baut', 'Baut & skrup', '100'),
      dus('dynabolt', 'Dynabolt / fischer', '100'),
      dus('klem', 'Klem pipa', '100'),
      dus('cable-ties', 'Cable ties', '100'),
      dus('nut', 'Flare nut', '50', 'Fitting & Valve'),
    ],
  },
  {
    label: 'Komponen Listrik',
    items: [
      satuan('kapasitor', 'Kapasitor AC', 'Komponen Listrik'),
      satuan('fan-motor-out', 'Fan motor outdoor', 'Komponen Listrik'),
      satuan('fan-motor-in', 'Fan motor indoor (blower)', 'Komponen Listrik'),
      satuan('pcb-in', 'PCB / modul indoor', 'Komponen Listrik'),
      satuan('pcb-out', 'PCB / modul outdoor', 'Komponen Listrik'),
      satuan('sensor', 'Sensor suhu (thermistor)', 'Komponen Listrik'),
      satuan('remote', 'Remote AC', 'Komponen Listrik'),
      satuan('kontaktor', 'Kontaktor', 'Komponen Listrik'),
      satuan('relay', 'Relay', 'Komponen Listrik'),
      satuan('overload', 'Overload protector kompresor', 'Komponen Listrik'),
      satuan('pompa-drain', 'Pompa drain mini', 'Komponen Listrik'),
      satuan('swing', 'Motor swing', 'Komponen Listrik'),
    ],
  },
  {
    label: 'Komponen Mekanik & Dudukan',
    items: [
      satuan('kompresor', 'Kompresor', 'Komponen Mekanik', 'unit'),
      satuan('filter-dryer', 'Filter dryer', 'Komponen Mekanik'),
      satuan('kapiler', 'Pipa kapiler', 'Komponen Mekanik'),
      satuan('service-valve', 'Service valve', 'Fitting & Valve'),
      satuan('blade', 'Baling-baling / fan blade', 'Komponen Mekanik'),
      satuan('filter-udara', 'Filter udara indoor', 'Komponen Mekanik'),
      satuan('bracket-out', 'Bracket outdoor', 'Dudukan', 'pasang'),
      satuan('bracket-in', 'Plat / mounting indoor', 'Dudukan', 'pcs'),
      satuan('karet', 'Karet peredam (rubber pad)', 'Dudukan', 'set'),
    ],
  },
];

interface StockShape {
  stock: string | number;
  unit: string;
  trackingMode?: SparepartMode | string | null;
  packUnit?: string | null;
  packSize?: string | number | null;
}

function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** "3 roll + 7 m" buat mode kemasan; selain itu "37 m". */
export function formatStock(sp: StockShape): string {
  const stock = Number(sp.stock);
  const size = sp.packSize === null || sp.packSize === undefined ? 0 : Number(sp.packSize);
  if (!hasPackSale((sp.trackingMode ?? 'biasa') as SparepartMode) || !sp.packUnit || !(size > 0)) {
    return `${trimNum(stock)} ${sp.unit}`;
  }
  const packs = Math.floor(Math.round((stock / size) * 1e6) / 1e6);
  const rest = Math.round((stock - packs * size) * 100) / 100;
  if (packs === 0) return `${trimNum(rest)} ${sp.unit}`;
  if (rest === 0) return `${packs} ${sp.packUnit}`;
  return `${packs} ${sp.packUnit} + ${trimNum(rest)} ${sp.unit}`;
}
