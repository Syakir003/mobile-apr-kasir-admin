// Aturan penulisan alamat (cerminan epos-backend/src/common/geo.util.ts: buildGeocodePlan; ubah keduanya bersamaan).
//
// Format yang dianjurkan:  <jalan/perumahan> No. X, <desa/kelurahan>, <kecamatan>, Kabupaten|Kota <nama>
// Kabupaten/kota WAJIB: tanpa itu peta bisa meleset ke daerah lain bernama sama (mis. "Gebang Malang" -> Kabupaten
// Malang) sehingga jarak di Antrian Servis salah. Link Google Maps berkoordinat mengalahkan aturan ini (titiknya sudah pasti).

export const ADDRESS_EXAMPLE = 'Jl. Airlangga No. 55, Mojosari, Kabupaten Mojokerto';

/** Kabupaten/kota Jawa Timur: dikenali bila ditulis tanpa kata "Kab."/"Kota" di bagian terakhir alamat ber-koma. */
const KNOWN_REGION_NAMES = [
  'bangkalan', 'banyuwangi', 'batu', 'blitar', 'bojonegoro', 'bondowoso', 'gresik', 'jember', 'jombang', 'kediri',
  'lamongan', 'lumajang', 'madiun', 'magetan', 'malang', 'mojokerto', 'nganjuk', 'ngawi', 'pacitan', 'pamekasan',
  'pasuruan', 'ponorogo', 'probolinggo', 'sampang', 'sidoarjo', 'situbondo', 'sumenep', 'surabaya', 'trenggalek',
  'tuban', 'tulungagung',
];
const KNOWN_REGIONS = new Set(KNOWN_REGION_NAMES);

export interface AddressCheck {
  /** Pesan bila alamat TIDAK boleh disimpan (tanpa kabupaten/kota). null = boleh. */
  blocking: string | null;
  /** Saran yang tidak menghalangi. */
  warnings: string[];
}

/** Isian link Maps yang berupa link sungguhan (bukan ketikan biasa nama daerah). */
export const isMapsLink = (v: string | null | undefined) => /^https?:\/\/\S+$/i.test((v ?? '').trim());

/** Singkatan yang tidak dikenali peta diperluas ("Kab." -> "Kabupaten"). Dipakai juga saat mengirim ke server. */
export function fixAddress(text: string): string {
  return text
    .trim()
    .replace(/\bkab\b\.?\s*/gi, 'Kabupaten ') // "Kab.Mojokerto" (tanpa spasi) tidak boleh jadi "KabupatenMojokerto"
    .replace(/\bkodya\b\.?\s*/gi, 'Kota ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Bagian yang diabaikan sepenuhnya, di mana pun posisinya (cerminan dropIgnorable di backend): keterangan dalam kurung,
 * provinsi, dan kode pos. Kode pos setelah "Jawa Timur" TIDAK boleh membuat alamat dianggap tak lengkap.
 */
const stripIgnorable = (t: string) =>
  t
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\b(?:jawa timur|jatim|indonesia)\b\.?/gi, ' ')
    .replace(/\b\d{5}\b/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,]+$/, '');

/** Bagian alamat di luar kabupaten/kota, atau null bila kabupaten/kota tidak disebut. */
function splitRegion(fixed: string): { rest: string } | null {
  const t = stripIgnorable(fixed);
  const all = [...t.matchAll(/\b(?:kota|kabupaten)\s+[a-z]+/gi)];
  if (all.length > 0) {
    const m = all[all.length - 1];
    const idx = m.index ?? 0;
    return { rest: `${t.slice(0, idx)} ${t.slice(idx + m[0].length)}` };
  }
  // Tanpa kata kunci: hanya sah bila ber-koma dan bagian terakhir adalah nama kabupaten/kota yang dikenal.
  const parts = t.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && KNOWN_REGIONS.has(parts[parts.length - 1].toLowerCase())) {
    return { rest: parts.slice(0, -1).join(', ') };
  }
  return null;
}

// Huruf pada nama yang tersisa setelah RT/RW/No./Blok dan token berangka dibuang (sama dengan komponen yang dipakai backend).
const nameLetters = (s: string) =>
  s
    .split(/[\s,]+/)
    .filter((w) => w && !/\d/.test(w) && !/^(?:rt|rw|no|nomor|blok|blk)\.?$/i.test(w))
    .join('')
    .replace(/[^a-z]/gi, '');

export function checkAddress(raw: string | undefined | null, opts: { hasMapsLink?: boolean } = {}): AddressCheck {
  const text = (raw ?? '').trim();
  if (!text || opts.hasMapsLink) return { blocking: null, warnings: [] };

  const fixed = fixAddress(text);
  const warnings: string[] = [];
  if (fixed !== text) warnings.push('Singkatan "Kab." akan ditulis menjadi "Kabupaten" (peta tidak mengenali singkatannya).');
  if (/\b[A-Za-z]*[a-z][A-Z][a-z]+\b/.test(text)) {
    warnings.push('Ada kata yang menempel (mis. "GebangMalang"). Pisahkan dengan spasi bila itu dua kata.');
  }
  if (!text.includes(',') && text.length > 25) {
    warnings.push('Pisahkan bagian alamat dengan koma: jalan, desa, kecamatan, kabupaten/kota.');
  }

  const region = splitRegion(fixed);
  if (!region) {
    return {
      blocking: `Tulis kabupaten atau kotanya. Contoh: "${ADDRESS_EXAMPLE}".`,
      warnings,
    };
  }
  if (nameLetters(region.rest).length < 3) {
    return { blocking: 'Tambahkan nama jalan, desa, atau kecamatan sebelum kabupaten/kota.', warnings };
  }
  return { blocking: null, warnings };
}
