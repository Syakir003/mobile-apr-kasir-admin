import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { isValidIndonesianPhone, normalizePhone } from './phone.util';
import { CheckoutCustomerDto } from '../pos/dto/checkout.dto';
import { IntakeCustomerDto } from '../service-orders/dto/service-intake.dto';
import { CreateMemberDto } from '../members/dto/create-member.dto';
import { UpdateMemberDto } from '../members/dto/update-member.dto';

// Batas nomor standar Indonesia: bentuk bebas (0855…, 62855…, +62855…), tapi tidak ada nomor ngawur.
describe('isValidIndonesianPhone', () => {
  it.each([
    '0855123456789', // 13 digit
    '085512345678', // 12 digit
    '0812 3456 7890',
    '0812-3456-7890',
    '(0812) 3456 7890',
    '081234567890',
    '08123456789', // 11 digit
    '0811123456', // 10 digit (nomor seluler lama)
    '62855123456789',
    '+62855123456789',
    '+62 855 1234 56789',
    '855123456789',
    '+62 0855123456789', // salah ketik umum: nol sisa setelah kode negara
    '0062855123456789',
    '021-5551234', // telepon rumah
    '0274 512345',
    '+62215551234',
  ])('nomor wajar %s diterima', (n) => {
    expect(isValidIndonesianPhone(n)).toBe(true);
  });

  it.each([
    ['terlalu pendek', '089898'],
    ['terlalu pendek (62)', '6289898'],
    ['terlalu pendek (+62)', '+6289898'],
    ['terlalu panjang', '08551234567890123'],
    ['terlalu panjang (62)', '628551234567890123'],
    ['ada huruf', '0855abc12345'],
    ['ada huruf di ujung', '085512345678a'],
    ['keterangan di belakang nomor', '0812-3456-7890 (rumah)'],
    ['dua nomor sekaligus', '081234567890/081234567891'],
    ['bukan nomor seluler/rumah (awalan 1)', '0155123456789'],
    ['tanda + di tengah', '0812+3456+7890'],
  ])('%s ditolak: %s', (_label, n) => {
    expect(isValidIndonesianPhone(n)).toBe(false);
  });

  it('tanpa angka sama sekali = tanpa nomor (walk-in), lolos; kasir memakai "-" untuk pelanggan tanpa HP', () => {
    for (const n of ['', '   ', '-', '()', '- -']) expect(isValidIndonesianPhone(n)).toBe(true);
  });

  it('bukan string ditolak', () => {
    expect(isValidIndonesianPhone(null)).toBe(false);
    expect(isValidIndonesianPhone(undefined)).toBe(false);
    expect(isValidIndonesianPhone(8123456789)).toBe(false);
  });

  it('semua bentuk nomor yang sama menjadi kunci member yang sama', () => {
    for (const n of ['0855123456789', '62855123456789', '+62855123456789', '855123456789', '0855-1234-56789']) {
      expect(normalizePhone(n)).toBe('+62855123456789');
    }
  });
});

describe('DTO: batas nomor HP', () => {
  const errs = async (cls: new () => object, plain: object) => validate(plainToInstance(cls, plain) as object, { whitelist: true });
  const phoneErrors = async (cls: new () => object, plain: object) =>
    (await errs(cls, plain)).filter((e) => e.property === 'phone');

  it('checkout: nomor ngawur ditolak dengan pesan jelas, nomor wajar lolos', async () => {
    const bad = await phoneErrors(CheckoutCustomerDto, { name: 'Budi', phone: '08551234567890123' });
    expect(bad).toHaveLength(1);
    expect(JSON.stringify(bad[0].constraints)).toContain('Nomor HP tidak valid');
    expect(await phoneErrors(CheckoutCustomerDto, { name: 'Budi', phone: '0855-1234-56789' })).toHaveLength(0);
    expect(await phoneErrors(CheckoutCustomerDto, { name: 'Budi', phone: '62855123456789' })).toHaveLength(0);
    expect(await phoneErrors(CheckoutCustomerDto, { name: 'Budi', phone: '089898' })).toHaveLength(1);
  });

  it('checkout: pelanggan walk-in tanpa HP ("-") tetap boleh, kosong tetap ditolak (wajib terisi)', async () => {
    expect(await phoneErrors(CheckoutCustomerDto, { name: 'Walk-in', phone: '-' })).toHaveLength(0);
    expect(await phoneErrors(CheckoutCustomerDto, { name: 'Walk-in', phone: '' })).toHaveLength(1);
  });

  it('checkout & terima servis: member lama terpilih (memberId) tidak divalidasi nomornya, karena yang dipakai data member di DB', async () => {
    expect(await phoneErrors(CheckoutCustomerDto, { name: 'Budi', phone: '089898', memberId: 'm1' })).toHaveLength(0);
    expect(await phoneErrors(IntakeCustomerDto, { name: 'Budi', phone: '089898', memberId: 'm1' })).toHaveLength(0);
    expect(await phoneErrors(IntakeCustomerDto, { name: 'Budi', phone: '089898' })).toHaveLength(1);
    expect(await phoneErrors(IntakeCustomerDto, { name: 'Budi', phone: '0855-1234-56789' })).toHaveLength(0);
  });

  it('tambah/ubah member: nomor opsional; ngawur ditolak, kosong boleh (untuk menghapus nomor di ubah member)', async () => {
    expect(await phoneErrors(CreateMemberDto, { name: 'Budi' })).toHaveLength(0);
    expect(await phoneErrors(CreateMemberDto, { name: 'Budi', phone: '' })).toHaveLength(0);
    expect(await phoneErrors(CreateMemberDto, { name: 'Budi', phone: '0855abc' })).toHaveLength(1);
    expect(await phoneErrors(UpdateMemberDto, { phone: '' })).toHaveLength(0);
    expect(await phoneErrors(UpdateMemberDto, { phone: '+62 855 1234 56789' })).toHaveLength(0);
    expect(await phoneErrors(UpdateMemberDto, { phone: '0812345678901234567' })).toHaveLength(1);
  });
});
