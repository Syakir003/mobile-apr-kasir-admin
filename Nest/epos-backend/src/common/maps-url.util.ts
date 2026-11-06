/** Awalan link pencarian Google Maps; teks yang diketik biasa (nama daerah/tempat) dicari lewat link ini. */
export const MAPS_SEARCH_PREFIX = 'https://www.google.com/maps/search/?api=1&query=';

// Domain peta yang umum ditempel tanpa "https://" (mis. maps.app.goo.gl/abc).
const KNOWN_MAPS_HOST =
  /^(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page|share\.google|waze\.com|maps\.apple\.com)/i;

/**
 * Isian "link lokasi (Google Maps)" boleh berupa link ATAU ketikan biasa (nama daerah/tempat), tanpa wajib "https://".
 * Yang disimpan selalu URL, jadi semua pemakai (web, mobile, WhatsApp) tetap menerima link yang bisa dibuka:
 *  - kosong/spasi -> null (tanpa link);
 *  - sudah http(s) -> dibiarkan;
 *  - domain peta tanpa skema -> diberi "https://";
 *  - selain itu (ketikan biasa) -> link pencarian Google Maps untuk teks itu, jadi klik "Buka di Maps" menunjukkan daerahnya.
 * Dipakai sebagai @Transform di DTO; nilai bukan string dikembalikan apa adanya supaya validator yang menolaknya.
 */
export function normalizeMapsInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (!t) return null;
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (!/\s/.test(t) && KNOWN_MAPS_HOST.test(t)) return `https://${t}`;
  return MAPS_SEARCH_PREFIX + encodeURIComponent(t.slice(0, 150));
}
