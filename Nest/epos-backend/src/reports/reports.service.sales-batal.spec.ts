import { ReportsService } from './reports.service';

// Invoice servis yang dibatalkan (status batal) tidak boleh ikut omzet/jumlah invoice/grafik harian/tipe pembeli.

function setup() {
  const sql: string[] = [];
  const prisma: any = {
    invoice: {
      aggregate: jest.fn(async () => ({
        _sum: { grandTotal: 0, subtotal: 0, discount: 0, taxAmount: 0 },
        _count: { _all: 0 },
      })),
      groupBy: jest.fn(async () => []),
    },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      sql.push(strings.join('?'));
      return [];
    }),
  };
  return { svc: new ReportsService(prisma), prisma, sql };
}

describe('ReportsService.sales — invoice batal', () => {
  it('total, grafik harian, kategori, dan tipe pembeli mengecualikan status batal', async () => {
    const { svc, prisma, sql } = setup();
    await svc.sales(new Date('2026-11-01'), new Date('2026-11-30'));
    expect(prisma.invoice.aggregate.mock.calls[0][0].where).toMatchObject({ status: { not: 'batal' } });
    expect(prisma.invoice.groupBy.mock.calls[0][0].where).toMatchObject({ status: { not: 'batal' } });
    expect(sql).toHaveLength(2);
    for (const q of sql) expect(q).toContain("<> 'batal'");
  });
});
