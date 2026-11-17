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

// ---------------------------------------------------------------------------------------------------------------
// Rencana pencarian alamat (geocoding). Aturan alamat yang diharapkan (dijaga form web):
//   "<jalan/perumahan> No. X, <desa/kelurahan>, <kecamatan>, Kabupaten|Kota <nama>"
// Bagian paling belakang = kabupaten/kota (WAJIB; tanpa itu hasil bisa meleset ke daerah lain bernama sama, mis.
// "Gebang Malang" -> Kabupaten Malang). Alamat lama/mobile yang tidak patuh tetap dicoba semampunya.
// ---------------------------------------------------------------------------------------------------------------

export interface GeocodeRegion {
  /** Nama saja, mis. "Mojokerto" (dipakai membandingkan dengan wilayah di jawaban Nominatim). */
  name: string;
  /** Teks untuk pertanyaan, mis. "Kabupaten Mojokerto" / "Kota Mojokerto" / "Mojokerto" (tanpa kata kunci). */
  label: string;
}
export interface GeocodePlan {
  /** null = alamat tidak menyebut kabupaten/kota (tidak lengkap): tidak dicari sama sekali. */
  region: GeocodeRegion | null;
  /** Pertanyaan dari yang paling spesifik ke yang paling umum; semuanya memuat kabupaten/kota. Kosong bila tak lengkap. */
  queries: string[];
}

/** Kabupaten/kota Jawa Timur: dikenali sebagai wilayah bila ditulis tanpa kata "Kab."/"Kota" di bagian terakhir. */
export const KNOWN_REGION_NAMES = [
  'bangkalan',
  'banyuwangi',
  'batu',
  'blitar',
  'bojonegoro',
  'bondowoso',
  'gresik',
  'jember',
  'jombang',
  'kediri',
  'lamongan',
  'lumajang',
  'madiun',
  'magetan',
  'malang',
  'mojokerto',
  'nganjuk',
  'ngawi',
  'pacitan',
  'pamekasan',
  'pasuruan',
  'ponorogo',
  'probolinggo',
  'sampang',
  'sidoarjo',
  'situbondo',
  'sumenep',
  'surabaya',
  'trenggalek',
  'tuban',
  'tulungagung',
];
const KNOWN_REGIONS = new Set(KNOWN_REGION_NAMES);
const MAX_QUERIES = 5;

// Nama gedung/kompleks yang tidak ada di peta dan membuat pertanyaan kosong; bagian ini dilewati.
const COMPLEX_WORD =
  /\b(?:ruko|rukan|perum|perumahan|komplek|kompleks|kawasan|gedung|plaza|mall|apartemen|aspol|asrama|village|garden|residence|cluster|pergudangan|industri|industrial|park)\b/i;

const capitalize = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Singkatan yang tidak dikenali Nominatim diperluas ("Kab." -> "Kabupaten", "Jl." -> "Jalan", dst). */
function expandAbbreviations(s: string): string {
  return s
    .replace(/\bkab\b\.?/gi, 'Kabupaten')
    .replace(/\bkodya\b\.?/gi, 'Kota')
    .replace(/\bjl\b\.?/gi, 'Jalan')
    .replace(/\bgg\b\.?/gi, 'Gang');
}

/** Buang noise yang tidak membantu peta: RT/RW, nomor rumah, blok, dan kata penanda wilayah (Kec./Kel./Ds./...). */
function stripNoise(s: string): string {
  return s
    .replace(/\brt\s*\/\s*rw\s*[:.]?\s*\d+\s*\/\s*\d+/gi, ' ')
    .replace(/\brt\s*\.?\s*\d+(?:\s*\/\s*(?:rw\s*\.?\s*)?\d+)?/gi, ' ')
    .replace(/\brw\s*\.?\s*\d+/gi, ' ')
    .replace(
      /\b(?:no|nomor)\s*\.?\s*[a-z]?\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?/gi,
      ' ',
    )
    .replace(/\b(?:blok|blk)\s*\.?\s*[a-z]?[\d-]*[a-z]?\b/gi, ' ')
    .replace(/\b(?:kel|kec|ds|dsn|desa|dusun|kelurahan|kecamatan)\b\.?/gi, ' ')
    .replace(/\s+,/g, ',')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '');
}

/** Pisahkan kabupaten/kota dari sisa alamat. Kata kunci ("Kabupaten X"/"Kota X") dicari dari belakang. */
function extractRegion(text: string): {
  region: GeocodeRegion | null;
  rest: string;
} {
  const t = text
    .replace(/(?:[,\s]*\b(?:jawa timur|jatim|indonesia)\b\.?)+\s*$/i, '')
    .trim();
  const matches = [...t.matchAll(/\b(kota|kabupaten)\s+([a-z]+)/gi)];
  if (matches.length > 0) {
    const m = matches[matches.length - 1];
    const name = capitalize(m[2]);
    const idx = m.index ?? 0;
    return {
      region: { name, label: `${capitalize(m[1])} ${name}` },
      rest: `${t.slice(0, idx)} ${t.slice(idx + m[0].length)}`
        .replace(/\s+/g, ' ')
        .trim(),
    };
  }
  // Tanpa kata kunci: hanya diterima bila alamat ber-koma dan bagian terakhir adalah nama kabupaten/kota yang dikenal.
  const parts = t
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].toLowerCase();
    if (KNOWN_REGIONS.has(last)) {
      return {
        region: { name: capitalize(last), label: capitalize(last) },
        rest: parts.slice(0, -1).join(', '),
      };
    }
  }
  return { region: null, rest: t };
}

/**
 * Rencana pencarian untuk satu alamat. Tiap pertanyaan memuat kabupaten/kota (kunci 1) ditambah bagian spesifik lain
 * (kunci 2: jalan/desa/kecamatan), dari yang paling lengkap ke yang makin umum. Bagian yang tidak dikenal peta
 * (nama ruko/kompleks, nomor, RT/RW) dilewati, jadi bagian depan yang gagal tidak menggagalkan bagian tengah/belakang.
 */
export function buildGeocodePlan(raw: string): GeocodePlan {
  const original = raw.replace(/\s+/g, ' ').trim();
  if (!original) return { region: null, queries: [] };
  const { region, rest } = extractRegion(expandAbbreviations(original));
  if (!region) return { region: null, queries: [] };

  const cleaned = stripNoise(rest);
  const segments = cleaned
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.replace(/[^a-z0-9]/gi, '').length >= 3);

  const out: string[] = [];
  const push = (specific: string) => {
    const s = specific.replace(/\s+/g, ' ').trim();
    if (s.replace(/[^a-z0-9]/gi, '').length < 3) return;
    const q = `${s}, ${region.label}`;
    if (!out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q);
  };

  if (segments.length >= 2) {
    // Alamat ber-koma: bagian = jalan, desa, kecamatan, ... Nama kompleks dipotong dari tiap bagian.
    const S = segments
      .map((s) => {
        const m = COMPLEX_WORD.exec(s);
        return m ? s.slice(0, m.index).trim() : s;
      })
      .filter((s) => s.replace(/[^a-z0-9]/gi, '').length >= 3);
    if (S.length > 0) {
      push(S.join(', '));
      if (S.length >= 3) push(`${S[0]}, ${S[S.length - 1]}`); // jalan + kecamatan, desa dilewati
      for (let k = 1; k < S.length; k++) push(S.slice(k).join(', '));
      // Desa dan kecamatan sering tertulis menyatu tanpa koma ("Randubango Kec. Mojosari"): kata terakhir bagian
      // terakhir dicoba sendiri sebagai cadangan terakhir (kecamatan + kabupaten).
      const lastWords = S[S.length - 1].split(' ').filter(Boolean);
      if (lastWords.length >= 2) push(lastWords[lastWords.length - 1]);
    }
  } else if (segments.length === 1) {
    // Tanpa koma (alamat lama): jendela kata dari yang lengkap ke bagian belakang (biasanya desa/kecamatan).
    const W = segments[0].split(' ').filter(Boolean);
    push(W.join(' '));
    const ci = W.findIndex((w) => COMPLEX_WORD.test(w));
    if (ci >= 1 && ci < W.length - 1)
      push(`${W.slice(0, ci).join(' ')} ${W[W.length - 1]}`); // jalan + kata terakhir
    if (W.length >= 3) push(W.slice(1).join(' '));
    if (W.length >= 2) push(W.slice(-2).join(' '));
    push(W[W.length - 1]);
  }
  return { region, queries: out.slice(0, MAX_QUERIES) };
}

// ---- verifikasi jawaban Nominatim ----

export interface NominatimRow {
  lat?: string;
  lon?: string;
  addresstype?: string;
  address?: Record<string, string | undefined>;
}
// Hasil setingkat wilayah (bukan tempat spesifik): titik pusat kabupaten/kota sama untuk semua pelanggan -> ditolak.
const REGION_LEVEL_TYPES = new Set([
  'county',
  'city',
  'state',
  'state_district',
  'region',
  'province',
  'country',
]);
const regionKey = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/^(?:kabupaten|kab\.?|kota|kodya)\s+/, '')
    .trim();

/**
 * Ambil hasil Nominatim pertama yang lolos DUA kunci: (1) wilayah (county/city/state_district) sama dengan kabupaten/kota
 * yang ditulis, dan (2) bukan hasil setingkat wilayah saja. null bila tak ada yang lolos.
 */
export function pickVerifiedPoint(
  rows: NominatimRow[],
  region: GeocodeRegion,
): LatLng | null {
  const want = regionKey(region.name);
  for (const row of rows) {
    const point = validLatLng(Number(row.lat), Number(row.lon));
    if (!point) continue;
    if (REGION_LEVEL_TYPES.has(row.addresstype ?? '')) continue;
    const got = [
      row.address?.county,
      row.address?.city,
      row.address?.state_district,
    ].map(regionKey);
    if (!got.includes(want)) continue;
    return point;
  }
  return null;
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
