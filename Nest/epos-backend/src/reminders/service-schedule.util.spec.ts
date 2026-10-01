import { BadRequestException } from '@nestjs/common';
import {
  addDays,
  classifySchedule,
  manualReminderKind,
  resolveApproveSchedule,
} from './service-schedule.util';

describe('resolveApproveSchedule', () => {
  it('job perbaikan tidak menyentuh jadwal', () => {
    expect(resolveApproveSchedule({ jobType: 'perbaikan', serviceIntervalDays: 90 })).toEqual({ touch: false });
    expect(resolveApproveSchedule({ jobType: 'bongkar' })).toEqual({ touch: false });
  });

  it('cuci/maintenance/pemasangan memakai siklus input', () => {
    for (const jobType of ['cuci', 'maintenance', 'pemasangan']) {
      expect(resolveApproveSchedule({ jobType, serviceIntervalDays: 90 })).toEqual({
        touch: true,
        enabled: true,
        intervalDays: 90,
      });
    }
  });

  it('saklar dimatikan -> enabled false tanpa butuh siklus', () => {
    expect(resolveApproveSchedule({ jobType: 'cuci', reminderEnabled: false })).toEqual({
      touch: true,
      enabled: false,
    });
  });

  it('input kosong jatuh ke siklus tersimpan di unit', () => {
    expect(resolveApproveSchedule({ jobType: 'cuci', unitIntervalDays: 120 })).toEqual({
      touch: true,
      enabled: true,
      intervalDays: 120,
    });
  });

  it('siklus kosong di mana-mana -> 400', () => {
    expect(() => resolveApproveSchedule({ jobType: 'cuci' })).toThrow(BadRequestException);
  });

  it('siklus di luar 7–730 atau pecahan -> 400', () => {
    expect(() => resolveApproveSchedule({ jobType: 'cuci', serviceIntervalDays: 3 })).toThrow(BadRequestException);
    expect(() => resolveApproveSchedule({ jobType: 'cuci', serviceIntervalDays: 800 })).toThrow(BadRequestException);
    expect(() => resolveApproveSchedule({ jobType: 'cuci', serviceIntervalDays: 30.5 })).toThrow(BadRequestException);
  });
});

describe('addDays', () => {
  it('menambah hari', () => {
    expect(addDays(new Date('2026-01-01T00:00:00Z'), 90).toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});

describe('classifySchedule (hari WIB)', () => {
  // 2026-10-01 10:00 WIB
  const now = new Date('2026-10-01T03:00:00Z');
  const base = { reminderEnabled: true, serviceIntervalDays: 90 as number | null };
  const at = (iso: string) => new Date(iso);

  it('mati menang atas segalanya', () => {
    expect(classifySchedule({ ...base, reminderEnabled: false, nextServiceDate: at('2026-01-01T00:00:00Z') }, now)).toBe('mati');
  });

  it('unit menunggu_data -> status menunggu_data (menang atas mati)', () => {
    expect(
      classifySchedule({ ...base, reminderEnabled: false, nextServiceDate: null, status: 'menunggu_data' }, now),
    ).toBe('menunggu_data');
  });

  it('unit aktif tanpa jadwal tidak ikut menunggu_data', () => {
    expect(classifySchedule({ ...base, reminderEnabled: false, nextServiceDate: null, status: 'aktif' }, now)).toBe('mati');
  });

  it('terlambat bila tanggal sebelum hari ini', () => {
    expect(classifySchedule({ ...base, nextServiceDate: at('2026-09-30T05:00:00Z') }, now)).toBe('terlambat');
  });

  it('hari ini dan sampai +7 hari = segera', () => {
    expect(classifySchedule({ ...base, nextServiceDate: at('2026-10-01T20:00:00Z') }, now)).toBe('segera'); // 2 Okt WIB
    expect(classifySchedule({ ...base, nextServiceDate: at('2026-10-08T05:00:00Z') }, now)).toBe('segera'); // +7
  });

  it('+8 sampai +30 = bulan_ini, >30 = aman', () => {
    expect(classifySchedule({ ...base, nextServiceDate: at('2026-10-09T05:00:00Z') }, now)).toBe('bulan_ini');
    expect(classifySchedule({ ...base, nextServiceDate: at('2026-10-31T05:00:00Z') }, now)).toBe('bulan_ini');
    expect(classifySchedule({ ...base, nextServiceDate: at('2026-11-02T05:00:00Z') }, now)).toBe('aman');
  });

  it('tanpa jadwal: siklus kosong vs belum terjadwal', () => {
    expect(classifySchedule({ ...base, serviceIntervalDays: null, nextServiceDate: null }, now)).toBe('siklus_kosong');
    expect(classifySchedule({ ...base, nextServiceDate: null }, now)).toBe('belum_terjadwal');
  });
});

describe('manualReminderKind', () => {
  const now = new Date('2026-10-01T03:00:00Z');
  it('lewat -> h7, hari ini/depan -> h3', () => {
    expect(manualReminderKind(new Date('2026-09-25T05:00:00Z'), now)).toBe('reminder_h7');
    expect(manualReminderKind(new Date('2026-10-01T05:00:00Z'), now)).toBe('reminder_h3');
    expect(manualReminderKind(new Date('2026-10-20T05:00:00Z'), now)).toBe('reminder_h3');
  });
});
