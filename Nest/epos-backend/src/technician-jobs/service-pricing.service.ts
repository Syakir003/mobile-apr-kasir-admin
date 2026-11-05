import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma, TechnicianJobStatus } from '@prisma/client';
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
 * Harga jasa servis (SATU untuk seluruh job). Jasa servis tidak punya harga baku: teknisi mengirim temuan,
 * lalu kasir/admin menetapkan harga (sesuai tingkat kesulitan), dan boleh menambah
 * transport (Transport 1-5 = Rp 100.000 x N) sebagai baris sendiri ATAU dibagi rata
 * ke baris jasa + sparepart. Servis mandiri baru punya invoice saat harga pertama
 * kali ditetapkan; tagihannya lalu dihitung ulang dari sumbernya (JobBillingService).
 *
 * Servis banyak AC (satu order, satu job per unit): harga jasa & transport ditetapkan SEKALI untuk seluruh job, seperti
 * servis satu unit. Datanya disimpan di "job pemegang harga" (job pertama yang belum dibatalkan); job lain di order itu
 * hanya ditandai sudah dihargai (billingDerived) dan tidak punya baris jasa sendiri. Memanggil get/set dengan id job
 * mana pun di order itu selalu bekerja pada job pemegang harga yang sama.
 */
@Injectable()
export class ServicePricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
    private readonly billing: JobBillingService,
  ) {}

  /**
   * Job pemegang harga untuk order job ini: servis banyak AC = job pertama (paling awal dibuat) yang belum dibatalkan;
   * pemasangan (invoice dari POS) dan order satu job = job itu sendiri.
   */
  private async resolveOwnerId(db: Prisma.TransactionClient, jobId: string): Promise<string> {
    const job = await db.technicianJob.findUnique({ where: { id: jobId }, select: { orderId: true, type: true } });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    if (job.type === 'pemasangan') return jobId;
    const owner = await db.technicianJob.findFirst({
      where: { orderId: job.orderId, status: { not: TechnicianJobStatus.dibatalkan } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return owner?.id ?? jobId;
  }

  /** Ringkasan untuk panel "Harga Jasa" di halaman job (admin & kasir). */
  async get(requestedJobId: string) {
    const jobId = await this.resolveOwnerId(this.prisma, requestedJobId);
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
      },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');

    // Servis banyak AC: tagihan & sparepart yang disetujui dari SEMUA unit order ini tampil di satu panel harga.
    const orderJobIds =
      job.type === 'pemasangan'
        ? [jobId]
        : (await this.prisma.technicianJob.findMany({ where: { orderId: job.orderId }, select: { id: true } })).map((j) => j.id);
    const materialRequests = await this.prisma.materialRequest.findMany({
      where: { jobId: { in: orderJobIds }, status: 'approved' },
      include: { items: true, adjustments: { select: { id: true }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });

    // Baris yang benar-benar tampil di tagihan/struk untuk job ini (sudah termasuk bagian transport).
    const billed = job.order.invoiceId
      ? await this.prisma.invoiceItem.findMany({
          where: { invoiceId: job.order.invoiceId, jobId: { in: orderJobIds } },
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
        total: materialRequests.reduce((s, r) => s + requestAmount(r), 0),
        requests: materialRequests.map((r) => ({
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

  async set(requestedJobId: string, dto: SetServicePricingDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const base = await tx.technicianJob.findUnique({ where: { id: requestedJobId }, select: { orderId: true } });
      if (!base) throw new NotFoundException('Job tidak ditemukan');
      // Kunci order dulu: dua job dari satu order bisa menetapkan harga bersamaan,
      // jangan sampai membuat dua invoice.
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${base.orderId} FOR UPDATE`;
      // Harga satu untuk seluruh job: selalu ditulis ke job pemegang harga order ini.
      const jobId = await this.resolveOwnerId(tx, requestedJobId);
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = await tx.technicianJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException('Job tidak ditemukan');
      // Job komplain (pengerjaan ulang atas keluhan pelanggan) tidak ditagih lagi.
      if (job.complaintOfJobId) {
        throw new BadRequestException('Job komplain tidak ditagih, jadi tidak ada harga jasa yang perlu ditetapkan');
      }
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

      // Servis banyak AC: unit lain di order ini TIDAK punya harga sendiri — tandai sudah dihargai (syarat admin menyetujui
      // selesai) dan bersihkan sisa baris jasa/transport lama per unit (data sebelum harga jadi satu), lalu hitung ulang
      // tagihannya (tinggal sparepart bila ada).
      if (job.type !== 'pemasangan') {
        const siblings = await tx.technicianJob.findMany({
          where: { orderId: job.orderId, id: { not: jobId }, status: { not: TechnicianJobStatus.dibatalkan } },
          select: { id: true },
        });
        for (const sib of siblings) {
          await tx.jobServiceLine.deleteMany({ where: { jobId: sib.id } });
          await tx.technicianJob.update({
            where: { id: sib.id },
            data: { billingDerived: true, transportLevel: 0, transportMode: 'individu' },
          });
          await this.billing.rebuild(tx, sib.id, actorId);
        }
      }

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
