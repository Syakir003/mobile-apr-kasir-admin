import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FieldPaymentsService } from './field-payments.service';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));

function setup(over: { fp?: Record<string, unknown>; waStatus?: string; waError?: string | null; customerPhone?: string | null; memberPhone?: string | null } = {}) {
  const fp = {
    id: 'fp1', invoiceId: 'inv1', orderId: 'o1', recordedById: 't1', method: 'tunai', amount: 150000,
    status: 'dipegang_teknisi', receiptNumber: 'TT-20261107-0012', createdAt: new Date('2026-11-07T03:00:00Z'),
    invoice: {
      id: 'inv1', memberId: 'm1', customerName: 'Bu Sari',
      customerPhone: over.customerPhone === undefined ? '0812-3456-7890' : over.customerPhone,
      member: { name: 'Bu Sari', phone: over.memberPhone ?? null },
    },
    recordedBy: { displayName: 'Budi' },
    ...over.fp,
  };
  const prisma: any = {
    fieldPayment: {
      findUnique: jest.fn(async () => fp),
      update: jest.fn(async ({ data }: any) => ({ ...fp, ...data })),
    },
    invoiceItem: { findMany: jest.fn(async () => [{ name: 'Cuci AC', qty: 2 }]) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const whatsapp: any = {
    sendInvoiceMessage: jest.fn(async () => ({ id: 'log1', status: over.waStatus ?? 'terkirim', error: over.waError ?? null })),
  };
  const svc = new FieldPaymentsService(prisma, {} as any, whatsapp);
  return { svc, prisma, whatsapp };
}

describe('FieldPaymentsService.sendReceipt', () => {
  it('WA terkirim: pesan pendek lewat nomor toko (kind tanda_terima), saluran wa + waktu kirim tersimpan', async () => {
    const { svc, prisma, whatsapp } = setup();
    const r = await svc.sendReceipt('fp1', {}, 't1', 'teknisi');
    const args = whatsapp.sendInvoiceMessage.mock.calls[0][0];
    expect(args).toMatchObject({ invoiceId: 'inv1', memberId: 'm1', phone: '0812-3456-7890', actorId: 't1', kind: 'tanda_terima' });
    expect(args.message).toContain('TT-20261107-0012');
    expect(args.message).toContain('Rp 150.000 (Tunai)');
    expect(args.message).toContain('Cuci AC (2)');
    expect(args.message).toContain('Teknisi: Budi');
    const upd = prisma.fieldPayment.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'fp1' });
    expect(upd.data).toMatchObject({ receiptChannel: 'wa', receiptWaLogId: 'log1' });
    expect(upd.data.receiptSentAt).toBeInstanceOf(Date);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'field_payment.receipt_sent', target: 'fp1' });
    expect(r).toMatchObject({ sent: true, channel: 'wa' });
  });

  it('nomor HP diambil dari member bila invoice tidak punya', async () => {
    const { svc, whatsapp } = setup({ customerPhone: null, memberPhone: '081200000000' });
    await svc.sendReceipt('fp1', {}, 't1', 'teknisi');
    expect(whatsapp.sendInvoiceMessage.mock.calls[0][0].phone).toBe('081200000000');
  });

  it('Fonnte gagal: tidak ditandai terkirim, hasil sent:false + alasan (teknisi bisa kirim ulang atau pakai kertas)', async () => {
    const { svc, prisma } = setup({ waStatus: 'gagal', waError: 'device disconnect' });
    const r = await svc.sendReceipt('fp1', {}, 't1', 'teknisi');
    // Alasan asli penyedia (mis. "device disconnect") hanya tersimpan di log WA; teknisi menerima pesan umum.
    expect(r).toMatchObject({ sent: false, error: 'Gagal mengirim WhatsApp. Coba lagi, atau pakai laporan kertas.' });
    expect(JSON.stringify(r)).not.toContain('device disconnect');
    expect(prisma.fieldPayment.update.mock.calls[0][0].data).not.toHaveProperty('receiptSentAt');
    expect(prisma.fieldPayment.update.mock.calls[0][0].data).toMatchObject({ receiptWaLogId: 'log1' });
  });

  it('pelanggan tanpa nomor HP valid: 400 dan tidak mengirim', async () => {
    const { svc, whatsapp } = setup({ customerPhone: '-', memberPhone: null });
    await expect(svc.sendReceipt('fp1', {}, 't1', 'teknisi')).rejects.toThrow('kertas');
    expect(whatsapp.sendInvoiceMessage).not.toHaveBeenCalled();
  });

  it('ringkasan Tanda Terima tidak memuat baris "Biaya transport"', async () => {
    const { svc, prisma } = setup();
    await svc.sendReceipt('fp1', {}, 't1', 'teknisi');
    expect(prisma.invoiceItem.findMany).toHaveBeenCalledWith({
      where: { invoiceId: 'inv1', kind: 'service', name: { not: 'Biaya transport' } },
      select: { name: true, qty: true },
    });
  });

  it('nomor terlalu pendek untuk WhatsApp ("1" -> 621) ditolak seperti tanpa nomor', async () => {
    const { svc, whatsapp } = setup({ customerPhone: '1', memberPhone: null });
    await expect(svc.sendReceipt('fp1', {}, 't1', 'teknisi')).rejects.toThrow('kertas');
    expect(whatsapp.sendInvoiceMessage).not.toHaveBeenCalled();
  });

  it('channel kertas: ditandai kertas + nomor lembar, tanpa WA', async () => {
    const { svc, prisma, whatsapp } = setup();
    const r = await svc.sendReceipt('fp1', { channel: 'kertas', paperReportNo: ' LP-0099 ' }, 't1', 'teknisi');
    expect(whatsapp.sendInvoiceMessage).not.toHaveBeenCalled();
    expect(prisma.fieldPayment.update.mock.calls[0][0].data).toEqual({ receiptChannel: 'kertas', paperReportNo: 'LP-0099' });
    expect(r).toMatchObject({ sent: false, channel: 'kertas' });
  });

  it('bukan perekam: 403 (admin boleh)', async () => {
    await expect(setup().svc.sendReceipt('fp1', {}, 't9', 'teknisi')).rejects.toThrow(ForbiddenException);
    await expect(setup().svc.sendReceipt('fp1', {}, 'a1', 'admin')).resolves.toMatchObject({ sent: true });
  });

  it('pembayaran yang sudah ditolak admin: 400', async () => {
    await expect(setup({ fp: { status: 'ditolak' } }).svc.sendReceipt('fp1', {}, 't1', 'teknisi')).rejects.toThrow(BadRequestException);
  });
});

describe('FieldPaymentsService.listForJob / mine', () => {
  function make(over: { status?: string; payments?: any[]; paymentMode?: string; grand?: number; assignee?: boolean; phone?: string | null; held?: number | null } = {}) {
    const job = { id: 'j1', orderId: 'o1', type: 'cuci', status: over.status ?? 'sedang_dikerjakan', complaintOfJobId: null };
    const prisma: any = {
      technicianJob: { findUnique: jest.fn(async () => job), findMany: jest.fn(async () => [{ id: 'j1' }]) },
      technicianJobAssignee: { count: jest.fn(async () => (over.assignee === false ? 0 : 1)) },
      fieldPayment: {
        findMany: jest.fn(async () =>
          over.payments ?? [
            { id: 'p1', receiptNumber: 'TT-1', method: 'tunai', amount: 100000, note: null, status: 'dipegang_teknisi', proofUrl: '/u/x.jpg',
              receiptChannel: 'wa', receiptSentAt: new Date(), createdAt: new Date(), recordedBy: { id: 't1', displayName: 'Budi' },
              invoice: { number: 'INV-1', customerName: 'Bu Sari' } },
          ],
        ),
        aggregate: jest.fn(async () => ({ _sum: { amount: over.held === undefined ? 100000 : over.held } })),
      },
      serviceOrder: {
        findUnique: jest.fn(async () => ({
          paymentMode: over.paymentMode ?? 'bayar_di_lokasi', unpaidReason: null, invoiceId: 'inv1',
          invoice: {
            id: 'inv1', number: 'INV-1', status: 'belum_dibayar', grandTotal: over.grand ?? 150000, totalPaid: 0,
            customerPhone: over.phone === undefined ? '0812-3456-7890' : over.phone, member: { phone: null },
          },
        })),
      },
      materialRequest: { count: jest.fn(async () => 0) },
    };
    return { svc: new FieldPaymentsService(prisma, {} as any, {} as any), prisma };
  }

  it('listForJob: sisa efektif dikurangi pembayaran aktif; masih boleh mencatat selama ada sisa', async () => {
    const { svc } = make();
    const r = await svc.listForJob('j1', 't1', 'teknisi');
    expect(r).toMatchObject({ activeTotal: 100000, remaining: 50000, canRecord: true, blockedReason: null });
    expect(r.payments[0]).toMatchObject({ id: 'p1', amount: 100000, recordedBy: { displayName: 'Budi' } });
  });

  it('listForJob: sisa habis = tombol tertutup dengan alasan', async () => {
    const { svc } = make({ grand: 100000 });
    const r = await svc.listForJob('j1', 't1', 'teknisi');
    expect(r).toMatchObject({ remaining: 0, canRecord: false, blockedReason: 'Tagihan sudah terbayar penuh' });
  });

  it('listForJob: order ditagih admin = tertutup dengan alasan gerbang', async () => {
    const { svc } = make({ paymentMode: 'ditagih_admin' });
    const r = await svc.listForJob('j1', 't1', 'teknisi');
    expect(r.canRecord).toBe(false);
    expect(r.blockedReason).toContain('ditagih admin');
  });

  it('listForJob: teknisi bukan assignee ditolak; admin tidak dicek', async () => {
    await expect(make({ assignee: false }).svc.listForJob('j1', 't9', 'teknisi')).rejects.toThrow(ForbiddenException);
    await expect(make({ assignee: false }).svc.listForJob('j1', 'a1', 'admin')).resolves.toBeDefined();
  });

  it('mine: total uang dipegang dihitung terpisah dari daftar (daftar dibatasi 200, total tidak)', async () => {
    const { svc, prisma } = make({ held: 750000 });
    const r = await svc.mine('t1');
    expect(prisma.fieldPayment.findMany.mock.calls[0][0].where).toEqual({ recordedById: 't1' });
    expect(prisma.fieldPayment.aggregate).toHaveBeenCalledWith({
      where: { recordedById: 't1', status: 'dipegang_teknisi' },
      _sum: { amount: true },
    });
    // satu baris di daftar, tetapi totalnya berasal dari aggregate seluruh catatan teknisi
    expect(r.items).toHaveLength(1);
    expect(r.heldTotal).toBe(750000);
    expect(r.items[0]).toMatchObject({ invoiceNumber: 'INV-1', customerName: 'Bu Sari' });
  });

  it('mine: tidak ada uang dipegang = 0', async () => {
    const { svc } = make({ held: null });
    expect((await svc.mine('t1')).heldTotal).toBe(0);
  });

  it('listForJob: canSendWa true untuk nomor lengkap, false untuk nomor tak layak', async () => {
    expect((await make().svc.listForJob('j1', 't1', 'teknisi')).canSendWa).toBe(true);
    expect((await make({ phone: '1' }).svc.listForJob('j1', 't1', 'teknisi')).canSendWa).toBe(false);
    expect((await make({ phone: '-' }).svc.listForJob('j1', 't1', 'teknisi')).canSendWa).toBe(false);
  });

  it('listForJob: nomor HP pelanggan tidak ikut dikembalikan ke layar teknisi', async () => {
    const r = await make().svc.listForJob('j1', 't1', 'teknisi');
    expect(JSON.stringify(r)).not.toContain('0812-3456-7890');
  });

  it('mine: filter status', async () => {
    const { svc, prisma } = make();
    await svc.mine('t1', 'dipegang_teknisi');
    expect(prisma.fieldPayment.findMany.mock.calls[0][0].where).toEqual({ recordedById: 't1', status: 'dipegang_teknisi' });
  });
});
