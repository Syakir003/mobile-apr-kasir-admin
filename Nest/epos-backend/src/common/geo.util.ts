import { MAPS_SEARCH_PREFIX } from './maps-url.util';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Titik acuan jarak "terdekat dari toko" di Antrian Servis (Jl. Gn. Anyar, RT.01/RW.06, Mergelo, Gn. Gedangan,
 * Kec. Magersari, Kota Mojokerto). Koordinat dari Dennis, 2026-11-17. Ganti di sini bila toko pindah.
 */
export const SHOP_LOCATION: LatLng & { label: string } = {
  lat: -7.473885831119293,
  lng: 112.45559505518109,
  label: 'Toko (Gn. Gedangan, Mojokerto)',
};

// Kotak kasar Indonesia: koordinat di luar ini dianggap salah baca (mis. potongan angka lain di URL), bukan lokasi kerja.
const ID_LAT: [number, number] = [-11.5, 6.5];
const ID_LNG: [number, number] = [94.5, 141.5];

/** Titik valid (angka terbatas dan di dalam kotak Indonesia) atau null. */
export function validLatLng(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < ID_LAT[0] || lat > ID_LAT[1] || lng < ID_LNG[0] || lng > ID_LNG[1])
    return null;
  return { lat, lng };
}

/**
 * Baca koordinat dari link Google Maps yang memuatnya. Urutan: pin presisi `!3d..!4d..` -> `@lat,lng` ->
 * parameter `q`/`query`/`ll`/`destination`/`center`. Link pencarian teks (MAPS_SEARCH_PREFIX + alamat) TIDAK punya
 * koordinat -> null.
 */
export function parseCoordsFromMapsUrl(
  url: string | null | undefined,
): LatLng | null {
  if (!url) return null;
  let s = url;
  try {
    s = decodeURIComponent(url);
  } catch {
    // %-encoding rusak: pakai teks apa adanya.
  }
  const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const pin = s.match(new RegExp(`!3d${NUM}!4d${NUM}`));
  if (pin) return validLatLng(Number(pin[1]), Number(pin[2]));
  const at = s.match(new RegExp(`@${NUM},${NUM}`));
  if (at) return validLatLng(Number(at[1]), Number(at[2]));
  const param = s.match(
    new RegExp(
      `[?&](?:q|query|ll|destination|center)=\\s*${NUM}\\s*,\\s*${NUM}(?:[&#]|$)`,
    ),
  );
  if (param) return validLatLng(Number(param[1]), Number(param[2]));
  return null;
}

/** Teks pencarian di link buatan sistem (MAPS_SEARCH_PREFIX + teks); null bila bukan link jenis itu. */
export function searchTextFromMapsUrl(
  url: string | null | undefined,
): string | null {
  if (!url || !url.startsWith(MAPS_SEARCH_PREFIX)) return null;
  try {
    const text = decodeURIComponent(
      url.slice(MAPS_SEARCH_PREFIX.length),
    ).trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Kandidat pertanyaan geocoding untuk satu alamat, dari yang paling spesifik ke yang makin umum. Nominatim sering
 * mengembalikan KOSONG untuk alamat lengkap (nomor rumah, RT/RW, nama perumahan, salah ketik), tetapi menemukan bagian
 * daerahnya. Urutan: (1) alamat tanpa "noise" (RT/RW, No., Blok, singkatan Kel./Kec./Ds.), (2) tanpa bagian paling
 * depan, (3) dua bagian terakhir (biasanya kelurahan/kecamatan + kota). Maksimal `max`, tanpa duplikat.
 * Kata "Kota"/"Kab." sengaja dipertahankan: membedakan Kota dan Kabupaten Mojokerto.
 */
export function geocodeQueryCandidates(raw: string, max = 3): string[] {
  const original = raw.replace(/\s+/g, ' ').trim();
  if (!original) return [];
  const cleaned = original
    .replace(/\brt\s*\/\s*rw\s*[:.]?\s*\d+\s*\/\s*\d+/gi, ' ') // RT/RW 02/03
    .replace(/\brt\s*\.?\s*\d+(?:\s*\/\s*(?:rw\s*\.?\s*)?\d+)?/gi, ' ') // RT.01/RW.06, RT 02
    .replace(/\brw\s*\.?\s*\d+/gi, ' ') // RW 03
    .replace(
      /\b(?:no|nomor|blok|blk)\s*\.?\s*[a-z]?\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?/gi,
      ' ',
    ) // No. 12, Blok A5
    .replace(/\b(?:kel|kec|ds|dsn|desa|dusun|kelurahan|kecamatan)\b\.?/gi, ' ')
    .replace(/\s+,/g, ',')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '');

  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t.length >= 3 && !out.some((o) => o.toLowerCase() === t.toLowerCase()))
      out.push(t);
  };
  push(cleaned);
  const parts = cleaned
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    push(parts.slice(1).join(', '));
    push(parts.slice(-2).join(', '));
  } else if (parts.length === 2) {
    push(parts[1]);
  } else {
    const words = cleaned.split(' ');
    if (words.length >= 4) push(words.slice(1).join(' '));
    if (words.length >= 5) push(words.slice(-3).join(' '));
  }
  if (out.length === 0) push(original);
  return out.slice(0, max);
}

/** Jarak garis lurus (km) antara dua titik, rumus haversine. Bukan jarak jalan. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
