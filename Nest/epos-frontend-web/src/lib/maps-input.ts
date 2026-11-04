// Isian "link lokasi (Google Maps)" boleh link ATAU ketikan biasa (nama daerah/tempat). Backend menormalkannya jadi URL
// (lihat normalizeMapsInput di epos-backend): ketikan biasa disimpan sebagai link pencarian Google Maps.
const SEARCH_PREFIX = 'https://www.google.com/maps/search/?api=1&query=';

export const MAPS_INPUT_PLACEHOLDER = 'Opsional - tempel link Google Maps, atau ketik nama daerah/tempat';

/** Untuk kolom isian: link pencarian buatan sistem dikembalikan ke teks aslinya (mis. nama daerah); link lain apa adanya. */
export function mapsInputDisplay(url: string | null | undefined): string {
  if (!url) return '';
  if (!url.startsWith(SEARCH_PREFIX)) return url;
  try {
    return decodeURIComponent(url.slice(SEARCH_PREFIX.length));
  } catch {
    return url;
  }
}
