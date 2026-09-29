import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PosService, serviceJobType } from './pos.service';
import { MembersService } from '../members/members.service';
import { CountersService } from '../counters/counters.service';

const P = '11111111-1111-4111-8111-111111111111';
const SV = '22222222-2222-4222-8222-222222222222';
const UNIT = '33333333-3333-4333-8333-333333333333';
const TECH = '44444444-4444-4444-8444-444444444444';
const actor = {
  sub: '55555555-5555-4555-8555-555555555555',
  role: 'kasir',
} as any;

function fakeTx(opts: { unitOwner?: string; voucher?: object } = {}) {
  const created: Record<string, any[]> = {};
  const rec = (model: string) => ({
    create: jest.fn(async ({ data }) => {
      (created[model] ??= []).push(data);
      return { id: `${model}-${created[model].length}`, ...data };
    }),
    update: jest.fn(async ({ data }) => data),
  });
  const tx: any = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM products')) {
        return [
          {
            name: 'AC 1PK',
            active: true,
            stock: 5,
            price: 3_000_000,
            brand: 'Daikin',
            type: 'FTV',
            pk: '1',
            unit: 'unit',
            category: '',
          },
        ];
      }
      if (sql.includes('FROM vouchers'))
        return opts.voucher ? [opts.voucher] : [];
      return [{ seq: 7 }];
    }),
    $executeRaw: jest.fn(),
    service: {
      findUnique: jest.fn(async () => ({
        name: 'Cuci AC',
        active: true,
        basePrice: 75_000,
        category: 'Cuci AC',
      })),
    },
    user: {
      findUnique: jest.fn(async () => ({ role: 'teknisi', active: true })),
    },
    member: {
      findFirst: jest.fn(async () => ({ id: 'm-1', phone: '+628123' })),
      create: jest.fn(),
      update: jest.fn(),
    },
    memberAcUnit: {
      ...rec('memberAcUnit'),
      findUnique: jest.fn(async () => ({ memberId: opts.unitOwner ?? 'm-1' })),
    },
  };
  for (const m of [
    'transaction',
    'invoice',
    'voucher',
    'transactionItem',
    'invoiceItem',
    'stockMovement',
    'product',
    'sparepart',
    'serviceOrder',
    'serviceOrderUnit',
    'technicianJob',
    'auditLog',
  ]) {
    tx[m] = rec(m);
  }
  return { tx, created };
}

function service(tx: any) {
  const prisma: any = { $transaction: (fn: any) => fn(tx) };
  return new PosService(
    {} as any,
    prisma,
    new MembersService(prisma, {} as any),
    new CountersService(),
  );
}

const dto = (extra: object = {}) =>
  ({
    customer: { name: 'Budi', phone: '08123' },
    items: [
      { kind: 'product', refId: P, qty: 2 },
      { kind: 'service', refId: SV, qty: 1 },
    ],
    discount: 10_000,
    taxPercent: 11,
    transportFee: 50_000,
    installations: [
      { itemIndex: 0, roomLocation: 'Kamar', technicianId: TECH },
    ],
    serviceUnits: [{ itemIndex: 1, unitId: UNIT }],
    ...extra,
  }) as any;

describe('PosService.checkoutNative', () => {
  it('nulis transaksi/invoice/stok/order/job sama kayak RPC checkout_transaction', async () => {
    const { tx, created } = fakeTx({
      voucher: {
        id: 'v-1',
        member_id: 'm-1',
        discount_type: 'persen',
        discount_value: 10,
        max_discount_cap: 100_000,
        min_purchase: null,
        expires_at: new Date(Date.now() + 1e9),
        status: 'aktif',
      },
    });
    const res = await service(tx).checkoutNative(
      dto({ voucherCode: ' promo ' }),
      actor,
    );

    // subtotal 6_075_000; diskon 10_000 + voucher min(607_500, cap 100_000)
    const inv = created.invoice[0];
    expect(inv).toMatchObject({
      subtotal: 6_075_000,
      discount: 110_000,
      taxAmount: 656_150,
      grandTotal: 6_671_150,
      totalPaid: 0,
      status: 'belum_dibayar',
      customerPhone: '+628123',
    });
    expect(inv.number).toMatch(/^INV-\d{8}-0007$/);
    expect(res).toEqual({
      invoiceId: 'invoice-1',
      invoiceNumber: inv.number,
      memberId: 'm-1',
      transactionId: 'transaction-1',
    });

    expect(
      created.invoiceItem.map((i) => [i.kind, i.unit, i.lineTotal]),
    ).toEqual([
      ['product', 'unit', 6_000_000],
      ['service', 'jasa', 75_000],
    ]);
    expect(created.stockMovement).toHaveLength(1);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: P },
      data: { stock: { decrement: 2 } },
    });
    expect(tx.voucher.update.mock.calls[0][0].data).toMatchObject({
      status: 'terpakai',
      usedInTransactionId: 'transaction-1',
    });

    expect(created.serviceOrder.map((o) => o.type)).toEqual([
      'pemasangan',
      'cuci',
    ]);
    expect(created.memberAcUnit[0]).toMatchObject({
      brand: 'Daikin',
      model: 'FTV',
      status: 'menunggu_pemasangan',
    });
    expect(created.technicianJob.map((j) => [j.type, j.status])).toEqual([
      ['pemasangan', 'assigned'],
      ['cuci', 'menunggu_penugasan'],
    ]);
    expect(tx.member.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: { totalAcUnits: { increment: 1 } },
    });
  });

  it.each([
    [{ items: [] }, BadRequestException, 'Minimal 1 item wajib diisi'],
    [
      {
        items: [{ kind: 'product', refId: P, qty: 1.5 }],
        installations: [],
        serviceUnits: [],
      },
      BadRequestException,
      'Qty produk harus bilangan bulat',
    ],
    [
      { installations: [{ itemIndex: 1 }] },
      BadRequestException,
      'Pemasangan hanya berlaku untuk item produk AC',
    ],
    [{ discount: 9_000_000 }, BadRequestException, 'Diskon melebihi subtotal'],
  ])('tolak payload %#', async (extra, Err, msg) => {
    await expect(
      service(fakeTx().tx).checkoutNative(dto(extra), actor),
    ).rejects.toThrow(new Err(msg));
  });

  it('unit servis punya member lain -> 403', async () => {
    await expect(
      service(fakeTx({ unitOwner: 'm-lain' }).tx).checkoutNative(dto(), actor),
    ).rejects.toThrow(ForbiddenException);
  });

  it('serviceJobType sama dengan service_job_type()', () => {
    expect(
      [
        'Cuci AC',
        ' perawatan ',
        'Bongkar Pasang',
        'bongkar',
        'isi freon',
        null,
      ].map(serviceJobType),
    ).toEqual([
      'cuci',
      'maintenance',
      'bongkar_pasang',
      'bongkar',
      'service',
      'service',
    ]);
  });
});
