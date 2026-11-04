import { MembersService } from './members.service';
import { waPhone } from '../whatsapp/wa-format.util';

// Input nomor dibebaskan: semua bentuk yang sama harus jadi kunci member yang sama, dan tetap menghasilkan target WA yang benar.
describe('MembersService.normalizePhone', () => {
  const svc = new MembersService({} as never);

  it.each([
    '0855123456789',
    '62855123456789',
    '+62855123456789',
    '855123456789',
    '0855-1234-56789',
    '(0855) 1234 56789',
    '+62 855 1234 56789',
    '62 855-1234-56789',
  ])('%s -> +62855123456789', (input) => {
    expect(svc.normalizePhone(input)).toBe('+62855123456789');
  });

  it('salah ketik umum ikut dibereskan (nol sisa setelah 62, awalan 00)', () => {
    expect(svc.normalizePhone('+62 0855123456789')).toBe('+62855123456789');
    expect(svc.normalizePhone('620855123456789')).toBe('+62855123456789');
    expect(svc.normalizePhone('0062855123456789')).toBe('+62855123456789');
  });

  it('placeholder tanpa angka tetap jadi string kosong, telepon rumah tidak diubah', () => {
    expect(svc.normalizePhone('-')).toBe('');
    expect(svc.normalizePhone('()')).toBe('');
    expect(svc.normalizePhone('021-5551234')).toBe('0215551234');
  });

  it('hasil simpan dari semua bentuk memberi target WhatsApp yang sama', () => {
    for (const input of ['0855123456789', '62855123456789', '+62 0855123456789', '0062855123456789']) {
      expect(waPhone(svc.normalizePhone(input))).toBe('62855123456789');
    }
  });
});
