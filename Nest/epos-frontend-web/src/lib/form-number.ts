import { z } from 'zod';

// Helper zod buat field angka yang datang dari <Input> (selalu string di
// react-hook-form, termasuk string kosong kalau dikosongin) — dipakai di
// form Produk/Sparepart/Jasa (master data) biar gak copy-paste refine yang
// sama di tiap halaman. Konversi ke Number beneran dilakukan manual pas
// nyusun payload API (bukan lewat zod transform), biar tipe TFieldValues
// react-hook-form tetap simpel (semua string) — sama kayak pola manual-parse
// di ProductFormScreen Flutter (_doubleValidator/_intValidator + parse pas
// submit), bukan lewat transform resolver yang bikin tipe input/output beda.

export function requiredNumberField(message = 'Wajib diisi, berupa angka') {
  return z
    .string()
    .min(1, message)
    .refine((v) => v.trim() !== '' && !Number.isNaN(Number(v)), 'Harus berupa angka');
}

export const optionalIntField = z
  .string()
  .optional()
  .refine(
    (v) => !v || v.trim() === '' || Number.isInteger(Number(v)),
    'Harus berupa bilangan bulat',
  );

export const optionalNumberField = z
  .string()
  .optional()
  .refine((v) => !v || v.trim() === '' || !Number.isNaN(Number(v)), 'Harus berupa angka');

/** '' | undefined -> undefined, selain itu string di-trim. Buat field teks opsional. */
export function trimmedOrUndefined(v: string | undefined | null): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** String form -> number, atau undefined kalau kosong. Buat field angka opsional. */
export function numberOrUndefined(v: string | undefined | null): number | undefined {
  const t = v?.trim();
  return t ? Number(t) : undefined;
}
