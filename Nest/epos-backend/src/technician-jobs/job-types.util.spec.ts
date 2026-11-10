import { isInstallJobType } from './job-types.util';
import { isSchedulingJobType } from '../reminders/service-schedule.util';
import { INTAKE_JOB_TYPES } from '../service-orders/dto/service-intake.dto';

describe('jenis job pemasangan', () => {
  it('pemasangan (POS) dan pemasangan_jasa (Terima Servis) sama-sama memasang unit', () => {
    expect(isInstallJobType('pemasangan')).toBe(true);
    expect(isInstallJobType('pemasangan_jasa')).toBe(true);
    for (const t of ['perbaikan', 'cuci', 'maintenance']) expect(isInstallJobType(t)).toBe(false);
  });

  it('pemasangan_jasa meminta siklus servis saat disetujui, seperti pemasangan', () => {
    expect(isSchedulingJobType('pemasangan_jasa')).toBe(true);
    expect(isSchedulingJobType('perbaikan')).toBe(false);
  });

  it('pemasangan_jasa bisa dipilih di Terima Servis, pemasangan POS tidak', () => {
    expect(INTAKE_JOB_TYPES).toContain('pemasangan_jasa');
    expect(INTAKE_JOB_TYPES as readonly string[]).not.toContain('pemasangan');
  });
});
