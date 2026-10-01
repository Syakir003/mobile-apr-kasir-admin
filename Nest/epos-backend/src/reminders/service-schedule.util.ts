import { BadRequestException } from '@nestjs/common';
import { wibDateOnly, wibDayRange } from '../common/wib-date.util';

/**
 * Pengingat servis per unit AC (2026-09-30) — "unit AC" = 1 set AC
 * (indoor + outdoor) = 1 baris member_ac_units. Jenis job yang mengatur
 * ulang jadwal servis berikutnya; jenis lain (perbaikan, bongkar, dst)
 * TIDAK boleh menyentuh jadwal (dulu job non-schedulable malah mengosongkan
 * nextServiceDate sehingga pengingat AC itu hilang).
 */
export const SCHEDULING_JOB_TYPES = ['cuci', 'maintenance', 'pemasangan'] as const;

export function isSchedulingJobType(jobType: string): boolean {
  return (SCHEDULING_JOB_TYPES as readonly string[]).includes(jobType);
}

export const MIN_INTERVAL_DAYS = 7;
export const MAX_INTERVAL_DAYS = 730;

export type ApproveSchedule =
  | { touch: false }
  | { touch: true; enabled: false }
  | { touch: true; enabled: true; intervalDays: number };

/**
 * Putuskan apa yang terjadi pada jadwal unit saat job di-approve.
 * - Jenis job non-scheduling  -> { touch:false } (jadwal/siklus/saklar utuh).
 * - Saklar dimatikan eksplisit -> { enabled:false }.
 * - Selain itu siklus WAJIB: dari input, kalau kosong jatuh ke siklus unit
 *   yang sudah tersimpan (klien lama); kalau tetap kosong -> 400 jelas.
 */
export function resolveApproveSchedule(input: {
  jobType: string;
  reminderEnabled?: boolean;
  serviceIntervalDays?: number | null;
  unitIntervalDays?: number | null;
}): ApproveSchedule {
  if (!isSchedulingJobType(input.jobType)) return { touch: false };
  if (input.reminderEnabled === false) return { touch: true, enabled: false };

  const days = input.serviceIntervalDays ?? input.unitIntervalDays ?? null;
  if (days === null || days === undefined) {
    throw new BadRequestException(
      'Siklus servis berikutnya wajib diisi (dalam hari), atau matikan pengingat untuk AC ini.',
    );
  }
  if (!Number.isInteger(days) || days < MIN_INTERVAL_DAYS || days > MAX_INTERVAL_DAYS) {
    throw new BadRequestException(
      `Siklus servis harus bilangan bulat ${MIN_INTERVAL_DAYS}–${MAX_INTERVAL_DAYS} hari.`,
    );
  }
  return { touch: true, enabled: true, intervalDays: days };
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86400000);
}

// ===================== Monitoring jadwal servis (2026-09-30) =====================

export const SCHEDULE_STATUSES = [
  'terlambat',
  'segera',
  'bulan_ini',
  'aman',
  'belum_terjadwal',
  'siklus_kosong',
  'mati',
  'menunggu_data',
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

/** Klasifikasi status jadwal satu set AC (hari kalender WIB). Urutan
 * prioritas: mati > (terlambat | segera | bulan_ini | aman) bila ada jadwal >
 * siklus_kosong / belum_terjadwal bila tidak ada jadwal. */
export function classifySchedule(
  unit: {
    reminderEnabled: boolean;
    nextServiceDate: Date | null;
    serviceIntervalDays: number | null;
    // Status unit (member_ac_units.status). 'menunggu_data' = QR sudah
    // dibuat tapi tipe AC belum dilengkapi teknisi (Input Data Lampau).
    status?: string;
  },
  now: Date = new Date(),
): ScheduleStatus {
  if (unit.status === 'menunggu_data') return 'menunggu_data';
  if (!unit.reminderEnabled) return 'mati';
  if (!unit.nextServiceDate) {
    return unit.serviceIntervalDays == null ? 'siklus_kosong' : 'belum_terjadwal';
  }
  const diffDays = Math.round(
    (wibDateOnly(unit.nextServiceDate).getTime() - wibDateOnly(now).getTime()) / 86400000,
  );
  if (diffDays < 0) return 'terlambat';
  if (diffDays <= 7) return 'segera';
  if (diffDays <= 30) return 'bulan_ini';
  return 'aman';
}

/** Kondisi Prisma `where` (selain filter dasar) untuk satu status — konsisten
 * dengan classifySchedule. */
export function scheduleStatusWhere(status: ScheduleStatus, now: Date = new Date()) {
  const todayStart = wibDayRange(now).start;
  const d7End = wibDayRange(new Date(now.getTime() + 7 * 86400000)).end;
  const d30End = wibDayRange(new Date(now.getTime() + 30 * 86400000)).end;
  switch (status) {
    case 'menunggu_data':
      return { status: 'menunggu_data' };
    case 'mati':
      return { reminderEnabled: false, status: { not: 'menunggu_data' } };
    case 'terlambat':
      return { reminderEnabled: true, nextServiceDate: { lt: todayStart } };
    case 'segera':
      return { reminderEnabled: true, nextServiceDate: { gte: todayStart, lte: d7End } };
    case 'bulan_ini':
      return { reminderEnabled: true, nextServiceDate: { gt: d7End, lte: d30End } };
    case 'aman':
      return { reminderEnabled: true, nextServiceDate: { gt: d30End } };
    case 'siklus_kosong':
      return { reminderEnabled: true, nextServiceDate: null, serviceIntervalDays: null };
    case 'belum_terjadwal':
      return { reminderEnabled: true, nextServiceDate: null, serviceIntervalDays: { not: null } };
  }
}

/** Template pengingat manual: jadwal sudah lewat -> h7, selain itu h3. */
export function manualReminderKind(nextServiceDate: Date, now: Date = new Date()): 'reminder_h3' | 'reminder_h7' {
  return nextServiceDate < wibDayRange(now).start ? 'reminder_h7' : 'reminder_h3';
}
