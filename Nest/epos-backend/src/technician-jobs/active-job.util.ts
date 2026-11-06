import { BadRequestException } from '@nestjs/common';
import { Prisma, TechnicianJobStatus } from '@prisma/client';
import { unitInvoiceLabel } from '../common/services/job-billing.service';

/**
 * Unit AC yang masih punya job belum final (bukan selesai/dibatalkan) tidak boleh dibuatkan job servis baru —
 * mencegah job ganda pada unit yang sama (mis. unit dipilih lagi di Terima Servis, pemasangan belum rampung, atau
 * teknisi menambah unit yang sama saat servis berjalan).
 * Baris unit dikunci dulu (urut id) supaya dua pembuatan job bersamaan tidak sama-sama lolos.
 */
export async function assertNoActiveJob(
  tx: Prisma.TransactionClient,
  unitIds: string[],
) {
  if (unitIds.length === 0) return;
  await tx.$executeRaw`SELECT id FROM member_ac_units WHERE id IN (${Prisma.join(unitIds)}) ORDER BY id FOR UPDATE`;
  const busy = await tx.technicianJob.findMany({
    where: {
      unitId: { in: unitIds },
      status: {
        notIn: [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan],
      },
    },
    select: {
      unit: {
        select: {
          brand: true,
          model: true,
          roomLocation: true,
          barcodeValue: true,
        },
      },
    },
  });
  if (busy.length === 0) return;
  const names = [
    ...new Set(busy.map((b) => (b.unit ? unitInvoiceLabel(b.unit) : 'unit'))),
  ];
  throw new BadRequestException(
    `Unit berikut masih punya job servis yang belum selesai: ${names.join(', ')}. Selesaikan atau batalkan job itu dulu.`,
  );
}
