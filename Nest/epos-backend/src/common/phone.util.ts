/**
 * Nomor HP: normalisasi (kunci pencarian member) dan batas nomor standar Indonesia.
 * Dipakai MembersService.normalizePhone dan validator `@IsIndonesianPhone()` di DTO.
 */

/**
 * Port dari normalize_phone() (pos_functions.sql) / phone.ts lama. Input nomor boleh bebas bentuk: 0855…, 62855…,
 * +62855…, 855… semuanya jadi '+62855…' (kunci pencarian member sama untuk semua bentuk). Salah ketik umum ikut
 * dibereskan: '+62 0855…' / '620855…' (nol sisa setelah kode negara) dan '0062855…' (awalan internasional 00).
 */
export function normalizePhone(raw: string): string {
  let cleaned = raw.replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('0062')) cleaned = '+' + cleaned.slice(2);
  cleaned = cleaned.replace(/^(\+?62)0+(?=8)/, '$1');
  if (cleaned.startsWith('+62')) return cleaned;
  if (cleaned.startsWith('628')) return '+' + cleaned;
  if (cleaned.startsWith('08')) return '+62' + cleaned.substring(1);
  if (cleaned.startsWith('8')) return '+62' + cleaned;
  return cleaned;
}

// Seluler: +62 8xx… = 9-12 digit setelah kode negara (0812-3456-7890 = 10-13 digit dengan 0 di depan).
const MOBILE = /^\+628\d{8,11}$/;
// Telepon rumah (021-5551234, 0274-512345): kode area 2-7 + 8-11 digit sesudah 0 (atau kode negara 62).
const LANDLINE = /^(?:0|\+?62)[2-7]\d{7,10}$/;

export const PHONE_ERROR_MESSAGE =
  'Nomor HP tidak valid. Pakai nomor Indonesia (10-13 digit), mis. 0855xxxxxxxx atau 62855xxxxxxxx.';

/**
 * Batas nomor standar Indonesia, supaya tidak ada nomor ngawur (terlalu panjang/pendek, ada huruf).
 *  - Boleh spasi, strip, titik, kurung, dan '+'; huruf atau simbol lain ditolak.
 *  - Bentuk bebas: 0855…, 62855…, +62855…, 855…, dan salah ketik umum (lihat normalizePhone).
 *  - Tanpa angka sama sekali ("", "-", "()") dianggap TANPA nomor dan lolos di sini: kasir memakai tanda itu untuk
 *    pelanggan walk-in tanpa HP (MembersService.findOrCreate membuat member baru). Wajib-tidaknya diatur DTO-nya.
 */
export function isValidIndonesianPhone(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!/^[\d\s\-.()+]*$/.test(s)) return false;
  if (!/\d/.test(s)) return true;
  const n = normalizePhone(s);
  return MOBILE.test(n) || LANDLINE.test(n);
}
