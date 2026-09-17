// Encoder Code 128 (Set B saja, tanpa auto-switch ke Set A/C) — dipakai
// buat cetak label barcode unit AC (padanan `unit_label_pdf.dart` di app
// Flutter lama, yang makai `pw.Barcode.code128()` — BUKAN QR, dikonfirmasi
// user 2026-08-28: "QR yang discan teknisi itu bentuknya label [Code 128],
// bukan kode QR kotak").
//
// Set B doang (gak ada optimisasi digit-pair ala Set C) — lebih sederhana
// buat diimplementasi ulang dengan benar, dan TETAP 100% valid/kebaca
// scanner standar mana pun (cuma sedikit lebih lebar dari hasil optimal,
// gak masalah buat string sependek `barcodeValue` kita, format
// `ACUNIT-YYYYMMDD-NNNN`).
//
// Tabel pola (CODES) + STOP + START_B diambil PERSIS (bukan hafalan) dari
// library `python-barcode` (barcode.charsets.code128, BSD-licensed, dipakai
// luas & teruji) via introspeksi source langsung, biar gak ada typo yang
// bikin label gak kebaca scanner di lapangan. Diverifikasi silang: encode
// 'ACUNIT-20260828-0001' pakai algoritma yang sama persis di Python
// menghasilkan urutan values [104,33,35,53,46,41,52,13,18,16,18,22,16,24,
// 18,24,13,16,16,16,17,70] — angka yang sama harus keluar dari
// `encodeCode128BValues` di bawah untuk input yang sama.

const CODES: readonly string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100',
] as const;

const STOP = '11000111010';
const START_B = 104;

/** Urutan value simbol (start + data + checksum) — dipakai buat verifikasi/testing. */
export function encodeCode128BValues(value: string): number[] {
  const values: number[] = [START_B];
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`Karakter "${ch}" di luar jangkauan Code 128 Set B`);
    }
    values.push(code - 32);
  }
  let checksum = values[0];
  for (let i = 1; i < values.length; i++) checksum += i * values[i];
  values.push(checksum % 103);
  return values;
}

/** String modul biner ('1' = bar hitam, '0' = spasi putih), siap dirender jadi batang-batang. */
export function encodeCode128B(value: string): string {
  const values = encodeCode128BValues(value);
  return values.map((v) => CODES[v]).join('') + STOP + '11';
}
