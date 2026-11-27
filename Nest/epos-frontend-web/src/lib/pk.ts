/** Isian PK: ukuran lazim, normalisasi koma, dan tanya ulang bila janggal. */
export const PK_HINT = 'Boleh titik atau koma. 3/4 PK = 0,75';

// ponytail: daftar tetap; samakan dengan frontend/mobile/lib/core/widgets/pk_check.dart.
const USUAL_PK = new Set([0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 15, 18, 20]);

export const dotDecimal = (value: string) => value.replace(/,/g, '.');

/** Isian yang janggal; kosong atau bukan angka dibiarkan (urusan validator form). */
export function unusualPks(inputs: (string | undefined)[]): string[] {
  return inputs
    .map((v) => (v ?? '').trim())
    .filter((v) => v !== '' && !Number.isNaN(Number(dotDecimal(v))) && !USUAL_PK.has(Number(dotDecimal(v))));
}

/** true = lanjut menyimpan. Pop-up bawaan browser, hanya bila ada PK janggal. */
export function confirmPk(inputs: (string | undefined)[]): boolean {
  const odd = unusualPks(inputs);
  if (odd.length === 0) return true;
  return window.confirm(
    `PK ${odd.map((v) => `"${v}"`).join(', ')} tidak lazim.\nUntuk 3/4 PK ketik 0,75 atau 0.75.\n\nOK = tetap simpan, Batal = perbaiki.`,
  );
}
