import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignJobDto } from './dto/assign-job.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { CheckoutInstallationDto } from '../pos/dto/checkout.dto';
import { CreateServiceOrderDto } from '../service-orders/dto/create-service-order.dto';
import { ServiceIntakeDto } from '../service-orders/dto/service-intake.dto';

// Semua DTO yang memilih teknisi menerima `technicianIds` (maksimal 5, tiap id string) selain `technicianId` lama.

const UUIDS = [1, 2, 3, 4, 5, 6].map((n) => `00000000-0000-4000-8000-00000000000${n}`);

const cases: [string, new () => object, Record<string, unknown>][] = [
  ['AssignJobDto', AssignJobDto, { technicianId: UUIDS[0] }],
  ['CreateComplaintDto', CreateComplaintDto, { complaint: 'bocor', scheduledDate: '2026-11-10' }],
  ['CheckoutInstallationDto', CheckoutInstallationDto, { itemIndexes: [0] }],
  ['CreateServiceOrderDto', CreateServiceOrderDto, { memberId: 'm1', type: 'service', unitIds: ['u1'] }],
  ['ServiceIntakeDto', ServiceIntakeDto, { customer: { name: 'Budi', phone: '081234567890' }, complaint: 'x', scheduledDate: '2026-11-10' }],
];

describe.each(cases)('%s.technicianIds', (_name, Cls, base) => {
  const errorsFor = async (technicianIds: unknown) =>
    (await validate(plainToInstance(Cls, { ...base, technicianIds }) as object)).filter((e) => e.property === 'technicianIds');

  it('1 sampai 5 id string lolos', async () => {
    expect(await errorsFor([UUIDS[0]])).toHaveLength(0);
    expect(await errorsFor(UUIDS.slice(0, 5))).toHaveLength(0);
  });

  it('lebih dari 5 id ditolak', async () => {
    expect(await errorsFor(UUIDS)).not.toHaveLength(0);
  });

  it('bukan array / isi bukan string ditolak', async () => {
    expect(await errorsFor('abc')).not.toHaveLength(0);
    expect(await errorsFor([1, 2])).not.toHaveLength(0);
  });
});
