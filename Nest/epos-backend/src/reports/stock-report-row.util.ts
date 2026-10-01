/** Satu item katalog (produk ATAU sparepart) sebelum digabung sama angka
 * agregatnya. `unit`: 'unit' buat product (konstan, sama kayak cart line
 * POS), `Sparepart.unit` buat sparepart. */
export interface StockReportCatalogItem {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  category: string | null;
}

/** Angka mentah hasil query — semua opsional/null (item bisa gak punya
 * baris sama sekali di salah satu sumber) & boleh berupa STRING (gotcha
 * Decimal lewat `$queryRaw`, lihat komentar Point 3 di ItemCost.stock). */
export interface StockReportAgg {
  opening?: number | string | null;
  masuk?: number | string | null;
  keluar?: number | string | null;
  sisa?: number | string | null;
  modal?: number | string | null;
  omzet?: number | string | null;
  cogs?: number | string | null;
}

export interface StockReportUnitAgg {
  masuk?: number | string | null;
  keluar?: number | string | null;
}

export interface StockReportRow {
  itemKind: 'product' | 'sparepart';
  refId: string;
  name: string;
  unit: string;
  category: string | null;
  stokAwal: number;
  stokMasuk: number;
  stokKeluar: number;
  sisaStok: number;
  modalTersisa: number;
  omzetTerjual: number;
  untungTerjual: number;
  // Cuma keisi kalau `item` ini sisi Indoor (products.paired_product_id
  // keisi) — Point 4, spec "3 baris terpisah": baris Indoor (row ini
  // sendiri), baris Outdoor (row terpisah lain di array `items`, gak
  // disentuh di sini), + ringkasan gabungan ini yang FE tampilin menjorok
  // di bawah baris Indoor.
  unitGabungan?: {
    namaPasangan: string;
    stokMasuk: number;
    stokKeluar: number;
    sisaStok: number;
  };
  // BARU (Paket AC Split, 2026-09-30) — peran unit AC produk ini. Baris
  // 'outdoor' yang pasangannya ada di laporan yang sama SELALU ditaruh
  // persis di bawah baris Indoor-nya (lihat orderPairedRows) & ditampilin
  // menjorok di FE, sebagai ganti baris "↳ Unit <pasangan>" yang dobel.
  pairRole?: 'indoor' | 'outdoor';
  // BARU (Paket AC Split, 2026-09-30) — qty yang dijual SATUAN dari paket
  // (Indoor saja / Outdoor saja) dalam range tanggal, yang modalnya gak
  // dialokasikan (HPP 0, lihat InvoiceItem.costUnallocated). Gak ada = 0.
  jualSatuanTanpaModal?: number;
}

function n(v: number | string | null | undefined): number {
  return v == null ? 0 : Number(v);
}

/** Gabungin 1 baris katalog + angka2 agregat (opening/masuk/keluar dari
 * stock_movements, sisa/modal dari item_costs atau spareparts.stock,
 * omzet/cogs dari invoice_items) jadi 1 `StockReportRow` siap-tampil. Kalau
 * `opts.pairedItem` dikasih (produk ini sisi Indoor), nambah `unitGabungan`
 * — `sisaStok` di situ SELALU `MIN(sisa produk ini, opts.pairedSisa)`,
 * itung on-the-fly (bukan disimpan), sesuai spec Point 4. */
export function buildStockReportRow(
  item: StockReportCatalogItem,
  agg: StockReportAgg,
  opts?: { pairedItem: StockReportCatalogItem; pairedSisa: number; unitAgg?: StockReportUnitAgg },
): StockReportRow {
  const omzet = n(agg.omzet);
  const row: StockReportRow = {
    itemKind: item.itemKind,
    refId: item.refId,
    name: item.name,
    unit: item.unit,
    category: item.category,
    stokAwal: n(agg.opening),
    stokMasuk: n(agg.masuk),
    stokKeluar: n(agg.keluar),
    sisaStok: n(agg.sisa),
    modalTersisa: n(agg.modal),
    omzetTerjual: omzet,
    untungTerjual: omzet - n(agg.cogs),
  };

  if (opts) {
    row.unitGabungan = {
      namaPasangan: opts.pairedItem.name,
      stokMasuk: n(opts.unitAgg?.masuk),
      stokKeluar: n(opts.unitAgg?.keluar),
      sisaStok: Math.min(n(agg.sisa), opts.pairedSisa),
    };
  }

  return row;
}

/**
 * Paket AC Split (2026-09-30) — susun ulang baris laporan biar baris
 * Outdoor langsung nempel di bawah baris Indoor pasangannya (tampil SEKALI,
 * gak nyempil lagi di posisi abjadnya sendiri). `indoorToOutdoor` = peta id
 * Indoor -> id Outdoor. Outdoor yang Indoor-nya GAK ada di `rows` (mis.
 * kesaring filter kategori) tetap di posisi aslinya. Urutan sisanya gak
 * berubah.
 */
export function orderPairedRows(rows: StockReportRow[], indoorToOutdoor: Map<string, string>): StockReportRow[] {
  const byId = new Map(rows.map((r) => [r.refId, r]));
  const movedOutdoorIds = new Set<string>();
  for (const [indoorId, outdoorId] of indoorToOutdoor) {
    if (byId.has(indoorId) && byId.has(outdoorId)) movedOutdoorIds.add(outdoorId);
  }
  const result: StockReportRow[] = [];
  for (const row of rows) {
    if (movedOutdoorIds.has(row.refId)) continue;
    result.push(row);
    const outdoorId = indoorToOutdoor.get(row.refId);
    if (outdoorId && movedOutdoorIds.has(outdoorId)) result.push(byId.get(outdoorId)!);
  }
  return result;
}
