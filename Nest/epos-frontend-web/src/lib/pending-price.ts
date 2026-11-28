/** "Menunggu harga": didaftarkan gudang tanpa harga jual, belum aktif.
 * Outdoor milik paket memang Rp0, jadi bukan termasuk. */
export function isPendingPrice(item: {
  active: boolean;
  sellPrice: string | number;
  acRole?: string | null;
  trackingMode?: string | null;
  sellPricePack?: string | number | null;
  /** Dikirim server untuk gudang, yang tidak menerima harga. */
  pendingPrice?: boolean;
}) {
  if (typeof item.pendingPrice === 'boolean') return item.pendingPrice;
  if (item.active || item.acRole === 'outdoor') return false;
  // Sama dengan server: kemasan tanpa harga utuh juga masih menunggu harga.
  const packSale = item.trackingMode === 'konversi' || item.trackingMode === 'gabungan';
  return !(Number(item.sellPrice) > 0) || (packSale && !(Number(item.sellPricePack) > 0));
}

/** Filter "Aktif" di Master Data ikut menampilkan yang menunggu harga, supaya
 * tidak terlihat hilang sesudah disimpan. */
export async function listWithPending<T extends Parameters<typeof isPendingPrice>[0]>(
  status: string,
  fetchByStatus: (status: string) => Promise<T[]>,
): Promise<T[]> {
  if (status !== 'active') return fetchByStatus(status);
  return (await fetchByStatus('all')).filter((i) => i.active || isPendingPrice(i));
}
