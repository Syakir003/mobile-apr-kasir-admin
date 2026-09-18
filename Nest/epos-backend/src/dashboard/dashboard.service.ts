import { Injectable } from '@nestjs/common';
import { TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { wibDayRange } from '../common/wib-date.util';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    // Fix dari audit: sebelumnya setHours(0,0,0,0)/(23,59,59,999) — itung
    // "hari ini" dalam timezone lokal PROSES NODE, bukan WIB. Kalau server
    // TZ=UTC (umum), jendela "hari ini" di sini geser 7 jam dari WIB
    // beneran, dan bisa beda sama angka "hari ini" di laporan (reports.util.ts
    // yang sudah WIB eksplisit) — dashboard & laporan nunjukin angka beda buat
    // hari yang sama. wibDayRange() sama pola/helper-nya kayak reports.util.ts.
    const { start: startOfDay, end: endOfDay } = wibDayRange();

    const [jobsByStatus, todayTx, unpaidInvoices, recentInvoices, recentUnpaidInvoices] =
      await Promise.all([
        // Job aktif SEKARANG (bukan cuma yang dibuat hari ini) — beda dari
        // reports/service yang scoped ke rentang tanggal, karena tujuannya
        // "progress servis yang lagi jalan sekarang", bukan laporan historis.
        this.prisma.technicianJob.groupBy({
          by: ['status'],
          where: {
            status: { notIn: [TechnicianJobStatus.selesai, TechnicianJobStatus.dibatalkan] },
          },
          _count: { _all: true },
        }),
        this.prisma.transaction.aggregate({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
          _count: { _all: true },
          _sum: { grandTotal: true },
        }),
        this.prisma.invoice.groupBy({
          by: ['status'],
          where: { status: { in: ['belum_dibayar', 'dp', 'kurang_bayar'] } },
          _count: { _all: true },
        }),
        // Buat panel "Transaksi Terkini" di halaman Dashboard — 5 invoice
        // paling baru APA PUN statusnya (beda dari unpaidInvoices di bawah,
        // yang khusus status belum lunas). `select` seperlunya doang (bukan
        // full invoice) karena cuma dipakai list ringkas, bukan detail.
        this.prisma.invoice.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            number: true,
            customerName: true,
            member: { select: { name: true } },
            grandTotal: true,
            status: true,
            createdAt: true,
          },
        }),
        // Panel "Invoice Belum Lunas" — 5 PALING BARU dari 3 status belum
        // lunas (bukan cuma hitungan kayak `unpaidInvoices` di atas), biar
        // kasir/admin bisa langsung klik ke invoice-nya buat follow up.
        this.prisma.invoice.findMany({
          where: { status: { in: ['belum_dibayar', 'dp', 'kurang_bayar'] } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            number: true,
            customerName: true,
            member: { select: { name: true } },
            grandTotal: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);

    return {
      jobAktifPerStatus: jobsByStatus.map((j) => ({
        status: j.status,
        count: j._count._all,
      })),
      transaksiHariIni: todayTx._count._all,
      omzetHariIni: Number(todayTx._sum.grandTotal ?? 0),
      invoiceBelumLunas: unpaidInvoices.map((i) => ({
        status: i.status,
        count: i._count._all,
      })),
      recentInvoices,
      recentUnpaidInvoices,
    };
  }
}
