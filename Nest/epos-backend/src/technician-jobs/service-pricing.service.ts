import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { computeInvoiceStatus } from '../common/invoice-status.util';
import { formatInvoiceNumber } from '../pos/pos-calc.util';
import { SetServicePricingDto } from './dto/set-service-pricing.dto';

interface MaterialRequestLike {
  total: unknown;
  usedAt: Date | null;
  items: { qty: unknown; qtyUsed: unknown; unitPrice: unknown }[];
}

/** Nilai tagihan sebuah pengajuan sparepart: kalau sudah dilaporkan terpakai, hanya yang terpakai. */
function requestAmount(r: MaterialRequestLike): number {
  if (!r.usedAt) return Number(r.total);
  return r.items.reduce((sum, i) => {
    const used = i.qtyUsed === null ? Number(i.qty) : Number(i.qtyUsed);
    return sum + Math.round(used * Number(i.unitPrice));
  }, 0);
}

/**
 * Harga jasa servis. Jasa servis tidak punya harga baku: teknisi mengirim temuan,
 * lalu kasir/admin menetapkan harga (sesuai tingkat kesulitan). Servis mandiri
 * baru punya invoice saat harga jasa pertama kali ditetapkan; sparepart yang
 * sudah disetujui sebelumnya ikut masuk ke tagihan yang sama.
 */
@Injectable()
export class ServicePricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CountersService,
  ) {}

  /** Ringkasan untuk panel "Harga Jasa" di halaman job (admin & kasir). */
  async get(jobId: string) {
    const job = await this.prisma.technicianJob.findUnique({
      where: { id: jobId },
      include: {
        order: {
          select: {
            invoiceId: true,
            invoice: { select: { id: true, number: true, status: true, grandTotal: true, totalPaid: true } },
          },
        },
        materialRequests: { where: { status: 'approved' }, include: { items: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!job) throw new NotFoundException('Job tidak ditemukan');

    const lines = job.order.invoiceId
      ? await this.prisma.invoiceItem.findMany({
          where: { invoiceId: job.order.invoiceId, jobId, kind: 'service' },
          select: { id: true, refId: true, name: true, unit: true, qty: true, unitPrice: true, lineTotal: true },
          orderBy: { id: 'asc' },
        })
      : [];
    const sparepartTotal = job.materialRequests.reduce((s, r) => s + requestAmount(r), 0);
    return {
      jobId: job.id,
      status: job.status,
      findingsSentAt: job.findingsSentAt,
      editable: !(['selesai', 'dibatalkan'] as string[]).includes(job.status),
      priced: !!job.order.invoiceId,
      invoice: job.order.invoice,
      lines,
      jasaTotal: lines.reduce((s, l) => s + Number(l.lineTotal), 0),
      sparepart: {
        total: sparepartTotal,
        requests: job.materialRequests.map((r) => ({
          id: r.id,
          amount: requestAmount(r),
          used: !!r.usedAt,
          items: r.items.map((i) => ({
            name: i.name,
            qty: Number(i.qty),
            qtyUsed: i.qtyUsed === null ? null : Number(i.qtyUsed),
            unit: i.unit,
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
      const built: { refId: string | null; name: string; unit: string; qty: number; unitPrice: number; lineTotal: number }[] = [];
      for (const l of dto.lines) {
        let name = l.name?.trim() || '';
        let refId: string | null = null;
        if (l.serviceId) {
          const svc = await tx.service.findUnique({ where: { id: l.serviceId } });
          if (!svc || !svc.active) throw new BadRequestException('Jasa tidak ditemukan atau sudah nonaktif');
          refId = svc.id;
          name = name || svc.name;
        }
        if (!name) throw new BadRequestException('Nama jasa wajib diisi untuk baris tanpa pilihan jasa');
        built.push({ refId, name, unit: 'jasa', qty: l.qty, unitPrice: l.unitPrice, lineTotal: Math.round(l.qty * l.unitPrice) });
      }
      const newJasa = built.reduce((s, b) => s + b.lineTotal, 0);

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

      const rows = await tx.$queryRaw<
        { grand_total: string; subtotal: string; total_paid: string; status: InvoiceStatus }[]
      >`SELECT grand_total, subtotal, total_paid, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
      const inv = rows[0];

      // Ganti baris jasa milik job ini saja (baris lain di invoice tidak disentuh).
      const old = await tx.invoiceItem.findMany({ where: { invoiceId, jobId, kind: 'service' }, select: { lineTotal: true } });
      const oldJasa = old.reduce((s, o) => s + Number(o.lineTotal), 0);
      await tx.invoiceItem.deleteMany({ where: { invoiceId, jobId, kind: 'service' } });
      for (const b of built) {
        await tx.invoiceItem.create({
          data: {
            invoiceId,
            jobId,
            kind: 'service',
            refId: b.refId,
            name: b.name,
            unit: b.unit,
            qty: b.qty,
            unitPrice: b.unitPrice,
            lineTotal: b.lineTotal,
          },
        });
      }

      // Sparepart yang sudah disetujui SEBELUM invoice ada ikut ditagihkan sekarang
      // (decide() hanya menambah tagihan kalau invoice sudah ada saat disetujui).
      const pending = await tx.materialRequest.findMany({
        where: { status: 'approved', invoiceId: null, job: { orderId: order.id } },
        include: { items: true },
      });
      let sparepartAdd = 0;
      for (const r of pending) {
        const amount = requestAmount(r);
        if (amount !== 0) {
          await tx.invoiceAdjustment.create({
            data: { invoiceId, requestId: r.id, amount, reason: 'pengajuan_tambahan', createdById: actorId },
          });
        }
        await tx.materialRequest.update({ where: { id: r.id }, data: { invoiceId } });
        sparepartAdd += amount;
      }

      const delta = newJasa - oldJasa;
      const newSubtotal = Number(inv.subtotal) + delta;
      const newGrand = Number(inv.grand_total) + delta + sparepartAdd;
      // Sudah lunas lalu tagihan naik -> kurang_bayar (sticky), sama aturan decide().
      const baseline = inv.status === 'lunas' ? 'kurang_bayar' : inv.status;
      const status = computeInvoiceStatus(newGrand, Number(inv.total_paid), baseline);
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { subtotal: newSubtotal, grandTotal: newGrand, status },
      });

      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'job.set_service_price',
          target: jobId,
          detail: {
            invoiceId,
            before: oldJasa,
            after: newJasa,
            sparepartAdded: sparepartAdd,
            lines: built.map((b) => ({ name: b.name, qty: b.qty, unitPrice: b.unitPrice })),
          },
        },
      });

      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, number: true, status: true, grandTotal: true, totalPaid: true },
      });
      return { ok: true, invoice, jasaTotal: newJasa, technicianId: job.technicianId };
    });
  }
}
