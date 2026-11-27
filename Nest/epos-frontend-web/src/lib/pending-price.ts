/** "Menunggu harga": didaftarkan gudang tanpa harga jual, belum aktif.
 * Outdoor milik paket memang Rp0, jadi bukan termasuk. */
export function isPendingPrice(item: { active: boolean; sellPrice: string | number; acRole?: string | null }) {
  return !item.active && !(Number(item.sellPrice) > 0) && item.acRole !== 'outdoor';
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
