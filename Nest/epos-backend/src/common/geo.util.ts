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
// Rencana pencarian alamat (geocoding).
//
// Aturan alamat yang diharapkan (dijaga form web):
//   "<jalan/perumahan> No. X, <desa/kelurahan>, <kecamatan>, Kabupaten|Kota <nama>"
// Kabupaten/kota WAJIB: tanpa itu hasil bisa meleset ke daerah lain bernama sama (mis. "Gebang Malang" -> Kabupaten
// Malang). Alamat lama/mobile yang tidak patuh tetap dicoba semampunya.
//
// Prinsip: alamat dibaca sebagai KOMPONEN (jalan, desa, kecamatan, kata nama kompleks), bukan satu kalimat. Potongan yang
// bukan nama (kode pos, provinsi, nomor, RT/RW, blok, keterangan dalam kurung, "depan/belakang/dekat ...") DIABAIKAN,
// tidak pernah membuat pencarian gagal. Bila pencarian lengkap tidak ketemu, cakupan dikecilkan bertahap (jalan+desa+
// kecamatan -> kecamatan saja -> desa saja -> ...) dan setiap hasil harus lolos DUA verifikasi (lihat pickVerifiedPoint).
// ---------------------------------------------------------------------------------------------------------------

/** Ketelitian hasil: titik pasti (link Maps) > jalan > desa/kelurahan > kecamatan > perkiraan (nama kompleks/daerah). */
export type GeoPrecision =
  'titik' | 'jalan' | 'desa' | 'kecamatan' | 'perkiraan';
const PRECISION_RANK: GeoPrecision[] = [
  'titik',
  'jalan',
  'desa',
  'kecamatan',
  'perkiraan',
];

export interface GeocodeRegion {
  /** Nama saja, mis. "Mojokerto" (dipakai membandingkan dengan wilayah di jawaban Nominatim). */
  name: string;
  /** Teks untuk pertanyaan, mis. "Kabupaten Mojokerto" / "Kota Mojokerto" / "Mojokerto" (tanpa kata kunci). */
  label: string;
}
/** Satu komponen alamat yang ikut dicari, beserta jenisnya (menentukan ketelitian bila cocok). */
export interface GeocodeTerm {
  text: string;
  kind: Exclude<GeoPrecision, 'titik'>;
}
export interface GeocodeQuery {
  /** Pertanyaan ke Nominatim: komponen + kabupaten/kota. */
  q: string;
  /** Komponen di dalam pertanyaan (tanpa kabupaten/kota): jawaban harus cocok dengan salah satunya (verifikasi kunci 2). */
  terms: GeocodeTerm[];
}
export interface GeocodePlan {
  /** null = alamat tidak menyebut kabupaten/kota (tidak lengkap): tidak dicari sama sekali. */
  region: GeocodeRegion | null;
  /** Pertanyaan dari yang paling spesifik ke yang paling umum. Kosong bila tak lengkap / tak ada komponen nama. */
  queries: GeocodeQuery[];
}

/** Kabupaten/kota Jawa Timur: dikenali bila ditulis tanpa kata "Kab."/"Kota" di bagian terakhir alamat ber-koma. */
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
const MAX_QUERIES = 6;

// Penanda gedung/perumahan yang mengikuti nama jalan dalam satu bagian ("Jl. Airlangga Ruko Royal ...").
const BUILDING_WORD =
  /^(?:ruko|rukan|perum|perumahan|komplek|kompleks|gedung|plaza|mall|apartemen|aspol|asrama|village|residence|cluster|pergudangan)$/i;
// Penanda kompleks yang lebih luas (kawasan industri, dst): dipakai untuk bagian yang BUKAN nama jalan.
const COMPLEX_WORD =
  /^(?:ruko|rukan|perum|perumahan|komplek|kompleks|gedung|plaza|mall|apartemen|aspol|asrama|village|residence|cluster|pergudangan|kawasan|industri|industrial|park|garden|estate)$/i;
// Keterangan lokasi, bukan bagian alamat: dibuang sampai akhir bagian ("... depan BCA").
const REMARK_WORD =
  /^(?:depan|belakang|samping|sebelah|seberang|sebrang|dekat|dkt)$/i;

const capitalize = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Singkatan yang tidak dikenali Nominatim diperluas ("Kab." -> "Kabupaten", "Jl." -> "Jalan", dst). */
function expandAbbreviations(s: string): string {
  return s
    .replace(/\bkab\b\.?\s*/gi, 'Kabupaten ')
    .replace(/\bkodya\b\.?\s*/gi, 'Kota ')
    .replace(/\bjl\b\.?\s*/gi, 'Jalan ')
    .replace(/\bgg\b\.?\s*/gi, 'Gang ');
}

/** Bagian yang diabaikan sepenuhnya, di mana pun posisinya: keterangan dalam kurung, provinsi, kode pos. */
function dropIgnorable(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\b(?:jawa timur|jatim|indonesia)\b\.?/gi, ' ')
    .replace(/\b\d{5}\b/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pisahkan kabupaten/kota dari sisa alamat. Kata kunci ("Kabupaten X"/"Kota X") dicari dari belakang. */
function extractRegion(text: string): {
  region: GeocodeRegion | null;
  rest: string;
} {
  const t = text.replace(/[\s,]+$/, '').trim();
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

/** Buang RT/RW, nomor rumah, dan blok (beserta kode di belakangnya). */
function stripNoise(s: string): string {
  return s
    .replace(/\brt\s*\/\s*rw\s*[:.]?\s*\d+\s*\/\s*\d+/gi, ' ')
    .replace(/\brt\s*\.?\s*\d+(?:\s*\/\s*(?:rw\s*\.?\s*)?\d+)?/gi, ' ')
    .replace(/\brw\s*\.?\s*\d+/gi, ' ')
    .replace(
      /\b(?:no|nomor)\s*\.?\s*[a-z]?\d+[a-z]?(?:\s*[-/]\s*\d+[a-z]?)?/gi,
      ' ',
    )
    .replace(
      /\b(?:blok|blk)\s*\.?\s*[a-z]?[\d-]*[a-z]?(?:\s+-?\d+[a-z]?)?\b/gi,
      ' ',
    );
}

interface Seg {
  tag: 'K' | 'D' | 'U' | null; // penanda eksplisit: Kec. / Kel.-Ds.-Desa / Dsn.-Dusun
  kind: 'street' | 'complex' | 'place';
  /** Nama utama bagian ini ("" bila bagian ini murni nama kompleks). */
  head: string;
  /** Kata sesudah penanda gedung/kompleks ("Royal" dalam "Jalan Airlangga Ruko Royal"). */
  tail: string[];
}

function parseSegments(rest: string): Seg[] {
  const marked = rest
    .replace(/\b(?:kec|kecamatan)\b\.?\s*/gi, ', @K ')
    .replace(/\b(?:kel|kelurahan|ds|desa)\b\.?\s*/gi, ', @D ')
    .replace(/\b(?:dsn|dusun)\b\.?\s*/gi, ', @U ');
  const out: Seg[] = [];
  for (const raw of marked
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const tagMatch = /^@([KDU])\s*/.exec(raw);
    const tag = (tagMatch?.[1] as Seg['tag']) ?? null;
    const body = stripNoise(raw.replace(/^@[KDU]\s*/, ''));
    // Token yang bukan nama (mengandung angka / tanpa huruf) diabaikan; tanda baca di tepi dibuang.
    let tokens = body
      .split(/\s+/)
      .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ''))
      .filter((w) => w && /[a-z]/i.test(w) && !/\d/.test(w));
    const remarkAt = tokens.findIndex((w) => REMARK_WORD.test(w));
    if (remarkAt >= 0) tokens = tokens.slice(0, remarkAt);
    if (tokens.length === 0) continue;

    const street = /^(?:jalan|gang)$/i.test(tokens[0]);
    const wordRe = street ? BUILDING_WORD : COMPLEX_WORD;
    const at = tokens.findIndex(
      (w, i) => (street ? i > 0 : true) && wordRe.test(w),
    );
    const head = at >= 0 ? tokens.slice(0, at) : tokens;
    const tail =
      at >= 0 ? tokens.slice(at + 1).filter((w) => !COMPLEX_WORD.test(w)) : [];
    out.push({
      tag,
      kind: street ? 'street' : head.length === 0 ? 'complex' : 'place',
      head: head.join(' '),
      tail,
    });
  }
  return out;
}

/**
 * Rencana pencarian untuk satu alamat. Tiap pertanyaan memuat kabupaten/kota (kunci 1) ditambah komponen spesifik
 * (kunci 2: jalan/desa/kecamatan), dari yang paling lengkap ke yang makin umum, maksimal MAX_QUERIES.
 */
export function buildGeocodePlan(raw: string): GeocodePlan {
  const original = raw.replace(/\s+/g, ' ').trim();
  if (!original) return { region: null, queries: [] };
  const { region, rest } = extractRegion(
    dropIgnorable(expandAbbreviations(original)),
  );
  if (!region) return { region: null, queries: [] };

  const segs = parseSegments(rest);
  let street: string | undefined;
  let kec: string | undefined;
  let desa: string | undefined;
  const places: string[] = [];
  const x: string[] = []; // kata nama kompleks/perumahan: cadangan terakhir ("Kranggan" dalam "Perum Kranggan Permai")
  for (const s of segs) {
    x.push(...s.tail);
    if (s.kind === 'street') {
      street ??= s.head;
    } else if (s.kind === 'complex') {
      x.push(...s.head.split(' '));
    } else if (s.tag === 'K') {
      kec ??= s.head;
    } else if (s.tag === 'D') {
      desa ??= s.head;
    } else {
      places.push(s.head);
    }
  }
  // Alamat lama satu bagian tanpa koma ("Jl. Airlangga Ruko Royal Mojosari"): kata terakhir biasanya daerahnya. Bagian
  // yang murni nama kompleks ("Perum Kranggan Permai") tidak ditebak: kata-katanya dicoba satu per satu sebagai cadangan.
  if (segs.length === 1 && segs[0].tag === null && segs[0].kind !== 'complex') {
    const s = segs[0];
    const words =
      s.tail.length > 0 ? s.tail : s.kind === 'street' ? s.head.split(' ') : [];
    if (words.length >= (s.tail.length > 0 ? 1 : 3))
      places.push(words[words.length - 1]);
  }

  const plain = places.filter(
    (p, i) =>
      !sameName(p, region.name) &&
      places.findIndex((q) => sameName(q, p)) === i,
  );
  if (!kec) {
    kec = plain[plain.length - 1];
    if (!desa && plain.length >= 2) desa = plain[plain.length - 2];
  } else if (!desa) {
    desa = plain.filter((p) => !sameName(p, kec as string)).pop();
  }

  const out: GeocodeQuery[] = [];
  const add = (...parts: (GeocodeTerm | undefined)[]) => {
    const terms = parts.filter(
      (p): p is GeocodeTerm =>
        !!p && p.text.replace(/[^a-z0-9]/gi, '').length >= 3,
    );
    if (terms.length === 0 || terms.some((t) => sameName(t.text, region.name)))
      return;
    const q = `${terms.map((t) => t.text).join(', ')}, ${region.label}`;
    if (!out.some((o) => sameName(o.q, q))) out.push({ q, terms });
  };
  const T = (
    text: string | undefined,
    kind: GeocodeTerm['kind'],
  ): GeocodeTerm | undefined => (text ? { text, kind } : undefined);

  const S = T(street, 'jalan');
  const D = T(desa, 'desa');
  const K = T(kec, 'kecamatan');
  add(S, D, K); // lengkap
  add(S, K); // tanpa desa
  add(D, K);
  add(K);
  add(D);
  add(S);
  if (kec && kec.includes(' ')) add(T(kec.split(' ').pop(), 'kecamatan')); // "Randubango Mojosari" -> "Mojosari"
  for (const p of [...plain].reverse()) add(T(p, 'perkiraan'));
  for (const w of x) if (w.length >= 3) add(T(w, 'perkiraan'));
  return { region, queries: out.slice(0, MAX_QUERIES) };
}

// ---- verifikasi jawaban Nominatim ----

export interface NominatimRow {
  lat?: string;
  lon?: string;
  addresstype?: string;
  address?: Record<string, string | undefined>;
}
// Bagian jawaban yang berisi nama tempat (bukan wilayah kabupaten/kota/provinsi).
const PLACE_FIELDS = [
  'road',
  'hamlet',
  'village',
  'suburb',
  'neighbourhood',
  'quarter',
  'city_district',
  'town',
  'municipality',
  'residential',
  'locality',
];
const regionKey = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/^(?:kabupaten|kab\.?|kota|kodya)\s+/, '')
    .trim();
const placeKey = (s: string | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(
      /\b(?:jalan|jl|gang|gg|desa|ds|kelurahan|kel|kecamatan|kec|dusun|dsn|kabupaten|kota)\b\.?/g,
      ' ',
    )
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
// Satu arah: nama di jawaban harus memuat SELURUH komponen yang dicari (pada batas kata). Arah sebaliknya ditolak, supaya
// nama jalan panjang ("Ngoro Industri") tidak dianggap cocok dengan kecamatan "Ngoro" lalu tercatat sebagai "jalan".
const namesMatch = (term: string, field: string) =>
  !!term &&
  !!field &&
  (term === field || (term.length >= 4 && ` ${field} `.includes(` ${term} `)));

/**
 * Ambil hasil Nominatim pertama yang lolos DUA verifikasi:
 *  1. wilayah (county/city/state_district) sama dengan kabupaten/kota yang ditulis;
 *  2. salah satu komponen yang kita cari (jalan/desa/kecamatan/kata kompleks) benar-benar muncul di nama tempat jawaban
 *     (hasil setingkat kabupaten, atau tempat tak berhubungan yang kebetulan ada di wilayah itu, ditolak).
 * Mengembalikan titik + ketelitian (jenis komponen paling spesifik yang cocok), atau null.
 */
export function pickVerifiedPoint(
  rows: NominatimRow[],
  region: GeocodeRegion,
  terms: GeocodeTerm[],
): { point: LatLng; precision: GeoPrecision } | null {
  const want = regionKey(region.name);
  for (const row of rows) {
    const point = validLatLng(Number(row.lat), Number(row.lon));
    if (!point) continue;
    const got = [
      row.address?.county,
      row.address?.city,
      row.address?.state_district,
    ].map(regionKey);
    if (!got.includes(want)) continue;
    const names = PLACE_FIELDS.map((f) => placeKey(row.address?.[f])).filter(
      Boolean,
    );
    const matched = terms.filter((t) => {
      const k = placeKey(t.text);
      return names.some((n) => namesMatch(k, n));
    });
    if (matched.length === 0) continue;
    const precision = matched
      .map((t) => t.kind as GeoPrecision)
      .sort((a, b) => PRECISION_RANK.indexOf(a) - PRECISION_RANK.indexOf(b))[0];
    return { point, precision };
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
