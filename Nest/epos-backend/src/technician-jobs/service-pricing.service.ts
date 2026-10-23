import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { formatInvoiceNumber } from '../pos/pos-calc.util';
import { JobBillingService, TRANSPORT_STEP } from '../common/services/job-billing.service';
import { SetServicePricingDto } from './dto/set-service-pricing.dto';

interface MaterialRequestLike {
  total: unknown;
  usedAt: Date | null;
  items: { qty: unknown; qtyUsed: unknown; unitPrice: unknown }[];
}

/** Nilai sebuah pengajuan sparepart: kalau sudah dilaporkan terpakai, hanya yang terpakai. */
function requestAmount(r: MaterialRequestLike): number {
  if (!r.usedAt) return Number(r.total);
  return r.items.reduce((sum, i) => {
    const used = i.qtyUsed === null ? Number(i.qty) : Number(i.qtyUsed);
    return sum + Math.round(used * Number(i.unitPrice));
  }, 0);
}

/**
 * Harga jasa servis. Jasa servis tidak punya harga baku: teknisi mengirim temuan,
 * lalu kasir/admin menetapkan harga (sesuai tingkat kesulitan), dan boleh menambah
 * transport (Transport 1-5 = Rp 100.000 x N) sebagai baris sendiri ATAU dibagi rata
 * ke baris jasa + sparepart. Servis mandiri baru punya invoice saat harga pertama
 * kali ditetapkan; tagihannya lalu dihitung ulang dari sumbernya (JobBillingService).
 */
@Injectable()
export class ServicePricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
    private readonly billing: JobBillingService,
  ) {}

  /** Ringkasan untuk panel "Harga Jasa" di halaman job (admin & kasir). */
  async get(jobId: string) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      include: {
        serviceLines: { orderBy: { position: 'asc' } },
        order: {
          select: {
            invoiceId: true,
            invoice: { select: { id: true, number: true, status: true, grandTotal: true, totalPaid: true } },
          },
        },
        materialRequests: {
          where: { status: 'approved' },
          include: { items: true, adjustments: { select: { id: true }, take: 1 } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');

    // Baris yang benar-benar tampil di tagihan/struk untuk job ini (sudah termasuk bagian transport).
    const billed = job.order.invoiceId
      ? await this.prisma.invoiceItem.findMany({
          where: { invoiceId: job.order.invoiceId, jobId },
          select: { id: true, kind: true, name: true, unit: true, qty: true, unitPrice: true, lineTotal: true },
          orderBy: { id: 'asc' },
        })
      : [];
    return {
      jobId: job.id,
      status: job.status,
      findingsSentAt: job.findingsSentAt,
      editable: !(['selesai', 'dibatalkan'] as string[]).includes(job.status),
      priced: !!job.order.invoiceId && job.billingDerived,
      invoice: job.order.invoice,
      lines: job.serviceLines.map((l) => ({
        id: l.id,
        serviceId: l.serviceId,
        name: l.name,
        qty: Number(l.qty),
        unitPrice: Number(l.unitPrice),
      })),
      transport: {
        level: job.transportLevel,
        mode: job.transportMode,
        amount: job.transportLevel * TRANSPORT_STEP,
      },
      billed: billed.map((b) => ({
        id: b.id,
        kind: b.kind,
        name: b.name,
        unit: b.unit,
        qty: Number(b.qty),
        unitPrice: Number(b.unitPrice),
        lineTotal: Number(b.lineTotal),
      })),
      sparepart: {
        total: job.materialRequests.reduce((s, r) => s + requestAmount(r), 0),
        requests: job.materialRequests.map((r) => ({
          id: r.id,
          amount: requestAmount(r),
          used: !!r.usedAt,
          // true = ditagih lewat penyesuaian (jalur lama), tidak ikut baris tagihan job.
          legacy: r.adjustments.length > 0,
          items: r.items.map((i) => ({
            name: i.name,
            qty: Number(i.qty),
            qtyUsed: i.qtyUsed === null ? null : Number(i.qtyUsed),
            unit: i.unit,
            unitPrice: Number(i.unitPrice),
          })),
        })),
      },
    };
  }

  async set(jobId: string, dto: SetServicePricingDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const base = await tx.technicianJob.findUnique({ where: { id: jobId }, select: { orderId: true } });
      if (!base) throw new NotFoundException('Job tidak ditemukan');
      // Kunci order dulu: dua job dari satu order bisa menetapkan harga bersamaan,
      // jangan sampai membuat dua invoice.
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${base.orderId} FOR UPDATE`;
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = await tx.technicianJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      if (job.status === TechnicianJobStatus.selesai || job.status === TechnicianJobStatus.dibatalkan) {
        throw new BadRequestException('Harga jasa tidak bisa diubah setelah job selesai atau dibatalkan');
      }
      const order = await tx.serviceOrder.findUnique({ where: { id: job.orderId } });
      if (!order) throw new NotFoundException('Order servis tidak ditemukan');

      // Susun baris jasa: katalog (harga bebas diubah) atau jasa bebas (nama wajib).
      const built: { serviceId: string | null; name: string; qty: number; unitPrice: number }[] = [];
      for (const l of dto.lines) {
        let name = l.name?.trim() || '';
        let serviceId: string | null = null;
        if (l.serviceId) {
          const svc = await tx.service.findUnique({ where: { id: l.serviceId } });
          if (!svc || !svc.active) throw new BadRequestException('Jasa tidak ditemukan atau sudah nonaktif');
          serviceId = svc.id;
          name = name || svc.name;
        }
        if (!name) throw new BadRequestException('Nama jasa wajib diisi untuk baris tanpa pilihan jasa');
        built.push({ serviceId, name, qty: l.qty, unitPrice: l.unitPrice });
      }

      // Invoice: pakai yang sudah ada di order, atau buat baru (servis mandiri).
      let invoiceId = order.invoiceId;
      if (!invoiceId) {
        const member = job.memberId ? await tx.member.findUnique({ where: { id: job.memberId } }) : null;
        const dateKey = this.counters.dateKey(new Date());
        const seq = await this.counters.nextSeq(tx, `invoice_${dateKey}`);
        const created = await tx.invoice.create({
          data: {
            number: formatInvoiceNumber(dateKey, seq),
            memberId: member?.id ?? null,
            customerName: member?.name ?? null,
            customerPhone: member?.phone ?? null,
            subtotal: 0,
            grandTotal: 0,
            totalPaid: 0,
            status: InvoiceStatus.belum_dibayar,
            priceTier: member?.priceTier ?? 'retail',
            notes: 'Servis - harga jasa ditetapkan kasir/admin',
            createdById: actorId,
          },
        });
        invoiceId = created.id;
        await tx.serviceOrder.update({ where: { id: order.id }, data: { invoiceId } });
      }

      // Sumber penagihan: baris jasa + transport disimpan di job; tagihan dihitung ulang darinya.
      await tx.jobServiceLine.deleteMany({ where: { jobId } });
      await tx.jobServiceLine.createMany({
        data: built.map((b, i) => ({ jobId, serviceId: b.serviceId, name: b.name, qty: b.qty, unitPrice: b.unitPrice, position: i })),
      });
      await tx.technicianJob.update({
        where: { id: jobId },
        data: {
          billingDerived: true,
          ...(dto.transportLevel !== undefined ? { transportLevel: dto.transportLevel } : {}),
          ...(dto.transportMode !== undefined ? { transportMode: dto.transportMode } : {}),
        },
      });
      const result = await this.billing.rebuild(tx, jobId, actorId);

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'job.set_service_price',
          target: jobId,
          detail: {
            invoiceId,
            transportLevel: dto.transportLevel ?? job.transportLevel,
            transportMode: dto.transportMode ?? job.transportMode,
            jobTotal: result?.newTotal ?? 0,
            lines: built.map((b) => ({ name: b.name, qty: b.qty, unitPrice: b.unitPrice })),
          },
        },
      });

      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, number: true, status: true, grandTotal: true, totalPaid: true },
      });
      return { ok: true, invoice, jobTotal: result?.newTotal ?? 0, technicianId: job.technicianId };
    });
  }
}
