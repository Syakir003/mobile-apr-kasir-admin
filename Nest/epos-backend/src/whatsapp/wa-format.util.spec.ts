import { waPhone } from './wa-format.util';

// Nomor HP di form dibebaskan; target WhatsApp (Fonnte) harus tetap 62xxxxxxxxxx tanpa '+'.
describe('waPhone', () => {
  it.each([
    ['0855123456789', '62855123456789'],
    ['62855123456789', '62855123456789'],
    ['+62855123456789', '62855123456789'],
    ['855123456789', '62855123456789'],
    ['0855-1234-56789', '62855123456789'],
    ['0855 1234 56789', '62855123456789'],
    ['(0855) 1234 56789', '62855123456789'],
    ['+62 855 1234 56789', '62855123456789'],
    ['62 855-1234-56789', '62855123456789'],
  ])('bentuk umum %s -> %s', (input, expected) => {
    expect(waPhone(input)).toBe(expected);
  });

  it('salah ketik umum dibereskan: nol sisa setelah kode negara dan awalan 00', () => {
    expect(waPhone('+62 0855123456789')).toBe('62855123456789');
    expect(waPhone('620855123456789')).toBe('62855123456789');
    expect(waPhone('0062855123456789')).toBe('62855123456789');
    expect(waPhone('00 62 855 1234 56789')).toBe('62855123456789');
  });

  it('telepon rumah (021…) tetap benar', () => {
    expect(waPhone('021-5551234')).toBe('62215551234');
    expect(waPhone('6221 5551234')).toBe('62215551234');
  });

  it('kosong / tanpa digit = string kosong (jangan sampai menembak Fonnte tanpa target)', () => {
    expect(waPhone('')).toBe('');
    expect(waPhone('-')).toBe('');
    expect(waPhone(null)).toBe('');
    expect(waPhone(undefined)).toBe('');
  });
});
