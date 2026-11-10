import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma, TechnicianJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CountersService } from '../counters/counters.service';
import { formatInvoiceNumber } from '../pos/pos-calc.util';
import { JobBillingService, TRANSPORT_STEP } from '../common/services/job-billing.service';
import { SetServicePricingDto } from './dto/set-service-pricing.dto';
import { TechEditLinesDto } from './dto/tech-edit-lines.dto';
import { isJobAssignee } from './job-assignees';
import { ACTIVE_FIELD_PAYMENT_STATUSES } from '../field-payments/field-payment.constants';

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

  /** Ringkasan harga untuk peminta: admin/kasir bebas; teknisi hanya untuk job yang ia pegang (assignee). */
  async getFor(jobId: string, actorId: string, role: 'admin' | 'kasir' | 'teknisi' | 'gudang') {
    if (role === 'teknisi' && !(await isJobAssignee(this.prisma, jobId, actorId))) {
      throw new ForbiddenException('Job ini bukan milik Anda');
    }
    return this.get(jobId);
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
        source: l.source,
        isCustom: l.isCustom,
        changeReason: l.changeReason,
      })),
      // Penanda untuk admin/kasir: jasa disesuaikan teknisi di lokasi (hilang saat admin menyimpan harga lagi).
      techEdit: job.techPriceEditedAt
        ? {
            at: job.techPriceEditedAt,
            reason: job.techPriceEditReason,
            subtotalBefore: Number(job.priceBeforeTechEdit ?? 0),
            subtotalAfter: job.serviceLines.reduce((s, l) => s + Math.round(Number(l.qty) * Number(l.unitPrice)), 0),
          }
        : null,
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
    return this.prisma.$transaction((tx) => this.setWithin(tx, requestedJobId, dto, actorId));
  }

  /**
   * Isi `set` di dalam transaksi milik pemanggil. Dipakai Terima Servis supaya order, job, dan harga perkiraan awal
   * tersimpan dalam SATU transaksi (gagal harga = order ikut batal).
   */
  async setWithin(tx: Prisma.TransactionClient, requestedJobId: string, dto: SetServicePricingDto, actorId: string) {
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
        // Admin/kasir menyimpan harga = penyesuaian teknisi sudah ditinjau.
        techPriceEditedAt: null,
        techPriceEditReason: null,
        priceBeforeTechEdit: null,
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
    // Tanda Terima yang sudah beredar tidak boleh menjadi kelebihan bayar: harga baru tidak boleh lebih kecil dari uang yang
    // sudah diterima (total_paid + pembayaran lapangan yang masih menunggu setoran/pencocokan). Tanpa pembayaran lapangan
    // aktif, perilaku lama tidak berubah.
    if (invoice) {
      const held = await tx.fieldPayment.aggregate({
        where: { invoiceId, status: { in: [...ACTIVE_FIELD_PAYMENT_STATUSES] } },
        _sum: { amount: true },
      });
      const heldTotal = Number(held._sum.amount ?? 0);
      const collected = Number(invoice.totalPaid) + heldTotal;
      if (heldTotal > 0 && Number(invoice.grandTotal) < collected) {
        throw new BadRequestException(
          `Harga baru (Rp ${Number(invoice.grandTotal).toLocaleString('id-ID')}) lebih kecil dari uang yang sudah diterima ` +
            `(Rp ${collected.toLocaleString('id-ID')}, termasuk pembayaran lapangan yang belum diverifikasi). ` +
            'Verifikasi atau tolak pembayaran lapangan itu dulu.',
        );
      }
    }
    return { ok: true, invoice, jobTotal: result?.newTotal ?? 0, technicianId: job.technicianId };
  }

  /**
   * Teknisi (assignee) menyesuaikan jasa di lokasi. Aturan: harga satuan baris yang ada TIDAK bisa diubah (hanya jumlah),
   * baris baru dari katalog memakai harga katalog, di luar katalog hanya lewat "jasa lain" (nama + harga, ditandai isCustom).
   * Menghapus baris boleh. Alasan wajib. Transport tidak disentuh. Hasilnya ditandai untuk admin (techPriceEditedAt,
   * priceBeforeTechEdit) sampai admin menyimpan harga lagi (setWithin menghapus penanda). Harga satu untuk seluruh order:
   * ditulis ke job pemegang harga (sama seperti set).
   */
  async techEditLines(requestedJobId: string, dto: TechEditLinesDto, actorId: string) {
    const reason = dto.reason.trim();
    if (reason.length < 5) throw new BadRequestException('Alasan penyesuaian wajib diisi (min. 5 karakter)');
    if (dto.lines.length === 0) throw new BadRequestException('Minimal satu baris jasa');

    return this.prisma.$transaction(async (tx) => {
      const base = await tx.technicianJob.findUnique({
        where: { id: requestedJobId },
        select: { orderId: true, type: true, status: true, complaintOfJobId: true },
      });
      if (!base) throw new NotFoundException('Job tidak ditemukan');
      if (!(await isJobAssignee(tx, requestedJobId, actorId))) throw new ForbiddenException('Job ini bukan milik Anda');
      if (base.type === 'pemasangan') {
        throw new BadRequestException('Harga pemasangan mengikuti invoice POS, tidak bisa disesuaikan di sini');
      }
      if (base.complaintOfJobId) throw new BadRequestException('Job komplain tidak ditagih, tidak ada harga jasa');
      if (base.status !== TechnicianJobStatus.assigned && base.status !== TechnicianJobStatus.sedang_dikerjakan) {
        throw new BadRequestException('Jasa hanya bisa disesuaikan saat job Ditugaskan atau Sedang Dikerjakan');
      }

      // Urutan kunci sama dengan setWithin: order -> job pemegang harga.
      await tx.$executeRaw`SELECT id FROM service_orders WHERE id = ${base.orderId} FOR UPDATE`;
      const ownerId = await this.resolveOwnerId(tx, requestedJobId);
      await tx.$executeRaw`SELECT id FROM technician_jobs WHERE id = ${ownerId} FOR UPDATE`;
      const owner = await tx.technicianJob.findUnique({
        where: { id: ownerId },
        include: { serviceLines: { orderBy: { position: 'asc' } } },
      });
      if (!owner) throw new NotFoundException('Job tidak ditemukan');
      if (owner.status === TechnicianJobStatus.selesai || owner.status === TechnicianJobStatus.dibatalkan) {
        throw new BadRequestException('Harga jasa tidak bisa diubah setelah job selesai atau dibatalkan');
      }
      const order = await tx.serviceOrder.findUnique({ where: { id: owner.orderId }, select: { invoiceId: true } });
      if (!owner.billingDerived || !order?.invoiceId) {
        throw new BadRequestException('Harga jasa belum ditetapkan admin, jadi belum bisa disesuaikan');
      }
      // Tanda Terima sudah terbit (pembayaran lapangan tercatat, belum ditolak): jasa dikunci supaya nominal tidak berbeda dari
      // bukti yang dipegang pelanggan. Koreksi selanjutnya hanya oleh admin.
      const fieldPaid = await tx.fieldPayment.count({ where: { orderId: owner.orderId, status: { not: 'ditolak' } } });
      if (fieldPaid > 0) {
        throw new BadRequestException('Pembayaran sudah dicatat dan Tanda Terima sudah terbit, jasa tidak bisa disesuaikan lagi. Hubungi admin untuk koreksi.');
      }

      // Susun daftar baru + validasi aturan per baris.
      const existing = new Map(owner.serviceLines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      let changed = false;
      const next: {
        id?: string;
        serviceId: string | null;
        name: string;
        qty: number;
        unitPrice: number;
        isCustom: boolean;
        source: string;
        qtyChanged: boolean;
      }[] = [];
      for (const l of dto.lines) {
        if (l.id) {
          const old = existing.get(l.id);
          if (!old) throw new BadRequestException('Baris jasa tidak ditemukan di job ini');
          if (seen.has(l.id)) throw new BadRequestException('Baris jasa yang sama dikirim dua kali');
          seen.add(l.id);
          if (l.unitPrice !== undefined && l.unitPrice !== Number(old.unitPrice)) {
            throw new BadRequestException('Harga satuan jasa tidak bisa diubah teknisi; tambahkan sebagai jasa lain bila perlu');
          }
          const qtyChanged = Number(old.qty) !== l.qty;
          if (qtyChanged) changed = true;
          next.push({
            id: old.id, serviceId: old.serviceId, name: old.name, qty: l.qty, unitPrice: Number(old.unitPrice),
            isCustom: old.isCustom, source: qtyChanged ? 'teknisi' : old.source, qtyChanged,
          });
        } else if (l.serviceId) {
          const svc = await tx.service.findUnique({ where: { id: l.serviceId } });
          if (!svc) throw new BadRequestException('Jasa tidak ditemukan');
          if (!svc.active) throw new BadRequestException('Jasa sudah nonaktif');
          if (l.unitPrice !== undefined && l.unitPrice !== Number(svc.basePrice)) {
            throw new BadRequestException('Harga jasa katalog mengikuti harga katalog; di luar katalog pakai jasa lain');
          }
          changed = true;
          next.push({ serviceId: svc.id, name: svc.name, qty: l.qty, unitPrice: Number(svc.basePrice), isCustom: false, source: 'teknisi', qtyChanged: true });
        } else {
          const name = l.name?.trim();
          if (!name) throw new BadRequestException('Nama jasa lain wajib diisi');
          if (l.unitPrice === undefined) throw new BadRequestException('Harga jasa lain wajib diisi');
          changed = true;
          next.push({ serviceId: null, name, qty: l.qty, unitPrice: l.unitPrice, isCustom: true, source: 'teknisi', qtyChanged: true });
        }
      }
      const removed = owner.serviceLines.filter((l) => !seen.has(l.id));
      if (removed.length > 0) changed = true;
      if (!changed) throw new BadRequestException('Tidak ada perubahan');

      const subtotal = (rows: { qty: number | { toString(): string }; unitPrice: number | { toString(): string } }[]) =>
        rows.reduce((s, r) => s + Math.round(Number(r.qty) * Number(r.unitPrice)), 0);
      const subtotalBefore = subtotal(owner.serviceLines);
      const subtotalAfter = subtotal(next);

      for (const old of removed) await tx.jobServiceLine.delete({ where: { id: old.id } });
      for (const [i, n] of next.entries()) {
        if (n.id) {
          await tx.jobServiceLine.update({
            where: { id: n.id },
            data: { qty: n.qty, position: i, source: n.source, ...(n.qtyChanged ? { changeReason: reason } : {}) },
          });
        } else {
          await tx.jobServiceLine.create({
            data: {
              jobId: ownerId, serviceId: n.serviceId, name: n.name, qty: n.qty, unitPrice: n.unitPrice,
              position: i, source: 'teknisi', isCustom: n.isCustom, changeReason: reason,
            },
          });
        }
      }
      await tx.technicianJob.update({
        where: { id: ownerId },
        data: {
          techPriceEditedAt: new Date(),
          techPriceEditReason: reason,
          // Subtotal awal admin dicatat sekali (penyesuaian pertama sejak admin terakhir menyimpan harga).
          ...(owner.techPriceEditedAt ? {} : { priceBeforeTechEdit: subtotalBefore }),
        },
      });
      const result = await this.billing.rebuild(tx, ownerId, actorId);

      const summarize = (rows: { name: string; qty: number | { toString(): string }; unitPrice: number | { toString(): string } }[]) =>
        rows.map((r) => ({ name: r.name, qty: Number(r.qty), unitPrice: Number(r.unitPrice) }));
      await tx.auditLog.create({
        data: {
          actorUid: actorId,
          action: 'job.tech_edit_lines',
          target: ownerId,
          detail: {
            requestedJobId, reason, subtotalBefore, subtotalAfter,
            before: summarize(owner.serviceLines), after: summarize(next),
          },
        },
      });

      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { displayName: true } });
      const member = owner.memberId ? await tx.member.findUnique({ where: { id: owner.memberId }, select: { name: true } }) : null;
      return {
        ok: true,
        jobId: ownerId,
        reason,
        subtotalBefore,
        subtotalAfter,
        jobTotal: result?.newTotal ?? 0,
        actorName: actor?.displayName ?? 'Teknisi',
        customerName: member?.name ?? null,
      };
    });
  }
}
