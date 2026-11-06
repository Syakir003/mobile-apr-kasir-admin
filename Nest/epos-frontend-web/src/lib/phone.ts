// Batas nomor HP standar Indonesia untuk form (cermin epos-backend/src/common/phone.util.ts: backend tetap pemeriksa
// akhir, ini supaya galat muncul langsung di form). Bentuk bebas: 0855…, 62855…, +62855…, 855…; spasi/strip/kurung boleh.

function normalize(raw: string): string {
  let cleaned = raw.replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('0062')) cleaned = '+' + cleaned.slice(2);
  cleaned = cleaned.replace(/^(\+?62)0+(?=8)/, '$1');
  if (cleaned.startsWith('+62')) return cleaned;
  if (cleaned.startsWith('628')) return '+' + cleaned;
  if (cleaned.startsWith('08')) return '+62' + cleaned.substring(1);
  if (cleaned.startsWith('8')) return '+62' + cleaned;
  return cleaned;
}

// Seluler: 10-13 digit dengan 0 di depan. Telepon rumah: kode area 2-7 + 8-11 digit sesudah 0.
const MOBILE = /^\+628\d{8,11}$/;
const LANDLINE = /^(?:0|\+?62)[2-7]\d{7,10}$/;

export const PHONE_ERROR_MESSAGE =
  'Nomor HP tidak valid. Pakai nomor Indonesia (10-13 digit), mis. 0855xxxxxxxx atau 62855xxxxxxxx.';

/** Tanpa angka sama sekali ("", "-") = tanpa nomor (pelanggan walk-in), dianggap lolos; wajib-tidaknya urusan form. */
export function isValidIndonesianPhone(raw: string | null | undefined): boolean {
  const s = (raw ?? '').trim();
  if (!/^[\d\s\-.()+]*$/.test(s)) return false;
  if (!/\d/.test(s)) return true;
  const n = normalize(s);
  return MOBILE.test(n) || LANDLINE.test(n);
}

/** Pesan galat untuk form, atau null bila nomornya boleh. */
export function phoneError(raw: string | null | undefined): string | null {
  return isValidIndonesianPhone(raw) ? null : PHONE_ERROR_MESSAGE;
}
