import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Kas & Shift Kasir (Siklus 4). Shift itu atribusi OPSIONAL ke pembayaran
 * (lihat PaymentsService.record) — bukan hard requirement. Sistem ini gak
 * punya konsep verifikasi pembayaran terpisah (lihat koreksi di
 * PaymentsService), jadi expectedCash/laporan di sini menghitung SEMUA
 * manual_payments yang terhubung ke shift, tanpa filter status apa pun.
 */
@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async open(kasirId: string, openingBalance: number) {
    return this.prisma.$transaction(async (tx) => {
      // row-lock semua shift terbuka milik kasir ini — cegah dobel-klik/dobel-tab
      // bikin 2 shift lolos sekaligus dari validasi count biasa.
      const openShifts = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cashier_shifts WHERE kasir_id = ${kasirId} AND closed_at IS NULL FOR UPDATE
      `;
      if (openShifts.length > 0) {
        throw new BadRequestException(
          'Masih ada shift yang belum ditutup. Tutup shift sebelumnya dulu sebelum buka shift baru.',
        );
      }

      return tx.cashierShift.create({
        data: { kasirId, openingBalance },
      });
    });
  }

  /** Dipakai internal oleh PaymentsService buat cari shift terbuka milik kasir yang login (null kalau gak ada). */
  async findOpenShiftForKasir(kasirId: string) {
    return this.prisma.cashierShift.findFirst({
      where: { kasirId, closedAt: null },
    });
  }

  /** Ditambahkan buat frontend uji-coba: kasir cek shift-nya sendiri yang lagi terbuka tanpa perlu simpan/ingat shiftId manual. */
  async findMyOpenShift(kasirId: string) {
    return this.findOpenShiftForKasir(kasirId);
  }

  async close(shiftId: string, actorId: string, closingBalance: number, notes?: string) {
    const shift = await this.prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundException('Shift tidak ditemukan');
    if (shift.kasirId !== actorId) throw new ForbiddenException('Bukan shift milik Anda');
    if (shift.closedAt) throw new BadRequestException('Shift ini sudah ditutup');

    // Sistem ini gak punya status "menunggu_verifikasi" (lihat PaymentsService) —
    // semua manual_payments yang sudah tercatat dianggap final, jadi expectedCash
    // cukup jumlah method='tunai' pada shift ini, tanpa filter status tambahan.
    const cashAgg = await this.prisma.manualPayment.aggregate({
      where: { shiftId, method: 'tunai' },
      _sum: { amount: true },
    });
    const expectedCash = Number(cashAgg._sum.amount ?? 0);
    const openingBalance = Number(shift.openingBalance);
    const selisih = closingBalance - (openingBalance + expectedCash);

    await this.prisma.cashierShift.update({
      where: { id: shiftId },
      data: { closingBalance, closedAt: new Date(), notes },
    });

    return { closingBalance, expectedCash, selisih };
  }

  async report(shiftId: string, actor: { sub: string; role: string }) {
    const shift = await this.prisma.cashierShift.findUnique({ where: { id: shiftId } });
    if (!shift) throw new NotFoundException('Shift tidak ditemukan');
    if (actor.role !== 'admin' && shift.kasirId !== actor.sub) {
      throw new ForbiddenException('Bukan shift milik Anda');
    }

    const payments = await this.prisma.manualPayment.findMany({
      where: { shiftId },
      select: { method: true, amount: true, invoiceId: true },
    });

    const perMethod: Record<string, { totalAmount: number; jumlahTransaksi: number }> = {};
    const invoiceIds = new Set<string>();
    for (const p of payments) {
      const m = perMethod[p.method] ?? { totalAmount: 0, jumlahTransaksi: 0 };
      m.totalAmount += Number(p.amount);
      m.jumlahTransaksi += 1;
      perMethod[p.method] = m;
      invoiceIds.add(p.invoiceId);
    }

    return {
      shift: {
        id: shift.id,
        kasirId: shift.kasirId,
        openingBalance: Number(shift.openingBalance),
        closingBalance: shift.closingBalance ? Number(shift.closingBalance) : null,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
      },
      perMethod,
      totalTransaksi: payments.length,
      jumlahInvoiceDilayani: invoiceIds.size,
    };
  }
}
