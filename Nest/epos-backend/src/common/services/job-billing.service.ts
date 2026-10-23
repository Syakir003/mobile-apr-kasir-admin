import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { computeInvoiceStatus } from '../invoice-status.util';

/** Tarif transport: Transport N = N x Rp 100.000, maksimal Transport 5. */
export const TRANSPORT_STEP = 100000;
export const TRANSPORT_MAX_LEVEL = 5;
export type TransportMode = 'individu' | 'dibagi';

export interface BillSourceLine {
  refId: string | null;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
}
export interface BillLine {
  kind: 'service' | 'sparepart';
  refId: string | null;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * Susun baris tagihan sebuah job: jasa + sparepart (+ transport).
 * - transport 'individu' -> baris "Biaya transport" sendiri.
 * - transport 'dibagi'   -> tidak ada baris transport; dibagi sama rata PER BARIS
 *   (jasa + sparepart), sisa pembulatan ke baris pertama. Harga satuan tiap
 *   baris naik sebesar bagiannya, jadi struk tidak menampilkan transport.
 */
export function buildJobInvoiceLines(input: {
  services: BillSourceLine[];
  spareparts: BillSourceLine[];
  transport: number;
  mode: TransportMode;
}): BillLine[] {
  const base: BillLine[] = [
    ...input.services.map((l) => ({ ...l, kind: 'service' as const, lineTotal: Math.round(l.qty * l.unitPrice) })),
    ...input.spareparts.map((l) => ({ ...l, kind: 'sparepart' as const, lineTotal: Math.round(l.qty * l.unitPrice) })),
  ];
  const transport = Math.max(0, Math.round(input.transport));
  if (transport === 0) return base;

  if (input.mode === 'dibagi' && base.length > 0) {
    const share = Math.floor(transport / base.length);
    const remainder = transport - share * base.length;
    return base.map((l, i) => {
      const lineTotal = l.lineTotal + share + (i === 0 ? remainder : 0);
      // Harga satuan = total baris / jumlah (2 desimal) supaya "jumlah x harga" tetap terbaca di struk.
      return { ...l, lineTotal, unitPrice: Math.round((lineTotal / l.qty) * 100) / 100 };
    });
  }
  return [
    ...base,
    { kind: 'service' as const, refId: null, name: 'Biaya transport', unit: 'paket', qty: 1, unitPrice: transport, lineTotal: transport },
  ];
}

/**
 * Tagihan servis yang DIHITUNG ULANG dari sumbernya setiap ada perubahan:
 * baris jasa (job_service_lines), pengajuan sparepart yang disetujui (jumlah
 * terpakai kalau sudah dilaporkan), dan transport job. Hasilnya ditulis sebagai
 * baris invoice bertanda job_id; baris lain di invoice yang sama tidak disentuh.
 *
 * Hanya berlaku untuk job `billingDerived` (harga jasa ditetapkan lewat halaman
 * job). Pengajuan sparepart lama yang sudah ditagih lewat invoice_adjustments
 * (punya baris penyesuaian) dibiarkan di jalurnya sendiri agar tidak dihitung dobel.
 */
@Injectable()
export class JobBillingService {
  async rebuild(tx: Prisma.TransactionClient, jobId: string, _actorId?: string) {
    void _actorId;
    const job = await tx.technicianJob.findUnique({
      where: { id: jobId },
      include: {
        serviceLines: { orderBy: { position: 'asc' } },
        order: { select: { invoiceId: true } },
      },
    });
    if (!job || !job.billingDerived || !job.order.invoiceId) return null;
    const invoiceId = job.order.invoiceId;
    const cancelled = job.status === 'dibatalkan';

    const requests = cancelled
      ? []
      : await tx.materialRequest.findMany({
          where: { jobId, status: 'approved', adjustments: { none: {} } },
          include: { items: true },
          orderBy: { createdAt: 'asc' },
        });
    const spareparts: BillSourceLine[] = [];
    for (const r of requests) {
      for (const it of r.items) {
        const qty = r.usedAt ? Number(it.qtyUsed ?? it.qty) : Number(it.qty);
        if (!(qty > 0)) continue;
        spareparts.push({ refId: it.refId, name: it.name, unit: it.unit ?? 'pcs', qty, unitPrice: Number(it.unitPrice) });
      }
    }
    const services: BillSourceLine[] = cancelled
      ? []
      : job.serviceLines.map((l) => ({
          refId: l.serviceId,
          name: l.name,
          unit: 'jasa',
          qty: Number(l.qty),
          unitPrice: Number(l.unitPrice),
        }));
    const lines = buildJobInvoiceLines({
      services,
      spareparts,
      transport: cancelled ? 0 : job.transportLevel * TRANSPORT_STEP,
      mode: job.transportMode === 'dibagi' ? 'dibagi' : 'individu',
    });

    const rows = await tx.$queryRaw<
      { grand_total: string; subtotal: string; total_paid: string; status: InvoiceStatus }[]
    >`SELECT grand_total, subtotal, total_paid, status FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = rows[0];

    const old = await tx.invoiceItem.findMany({ where: { invoiceId, jobId }, select: { lineTotal: true } });
    const oldTotal = old.reduce((s, o) => s + Number(o.lineTotal), 0);
    await tx.invoiceItem.deleteMany({ where: { invoiceId, jobId } });
    for (const l of lines) {
      await tx.invoiceItem.create({
        data: {
          invoiceId,
          jobId,
          kind: l.kind,
          refId: l.refId,
          name: l.name,
          unit: l.unit,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        },
      });
    }
    if (requests.length > 0) {
      await tx.materialRequest.updateMany({ where: { id: { in: requests.map((r) => r.id) } }, data: { invoiceId } });
    }

    const newTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const delta = newTotal - oldTotal;
    const grand = Number(inv.grand_total) + delta;
    // Sudah lunas lalu tagihan naik -> kurang_bayar (sticky), sama aturan decide().
    const baseline = inv.status === 'lunas' ? 'kurang_bayar' : inv.status;
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal: Number(inv.subtotal) + delta,
        grandTotal: grand,
        status: computeInvoiceStatus(grand, Number(inv.total_paid), baseline),
      },
    });
    return { invoiceId, lines, newTotal, delta };
  }
}
