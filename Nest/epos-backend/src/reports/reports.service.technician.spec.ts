import { ReportsService } from './reports.service';

// Laporan performa teknisi: job selesai bersama dihitung untuk SEMUA teknisi job itu (tabel assignees), sementara
// jumlah per status & rata-rata waktu tetap per job (tidak dobel).

function setup(technicianRows: unknown[]) {
  const sql: string[] = [];
  const prisma: any = {
    technicianJob: { groupBy: jest.fn(async () => [{ status: 'selesai', _count: { _all: 2 } }]) },
    $queryRaw: jest
      .fn()
      .mockImplementationOnce(async (strings: TemplateStringsArray) => {
        sql.push(strings.join('?'));
        return [{ avg_minutes: '90' }];
      })
      .mockImplementationOnce(async (strings: TemplateStringsArray) => {
        sql.push(strings.join('?'));
        return technicianRows;
      }),
  };
  return { svc: new ReportsService(prisma), prisma, sql };
}

describe('ReportsService.service — performa teknisi', () => {
  const range: [Date, Date] = [new Date('2026-11-01'), new Date('2026-11-30')];

  it('performa teknisi dihitung dari tabel assignees (semua teknisi job bersama)', async () => {
    const { svc, sql } = setup([{ technician_id: 't1', display_name: 'Ani', completed_count: '3' }]);
    await svc.service(...range);
    expect(sql[1]).toContain('technician_job_assignees');
    expect(sql[1]).toMatch(/GROUP BY a\.technician_id/);
  });

  it('memetakan baris SQL ke performaTeknisi; status & rata-rata waktu tidak berubah (per job)', async () => {
    const { svc, sql } = setup([
      { technician_id: 't1', display_name: 'Ani', completed_count: '3' },
      { technician_id: 't2', display_name: 'Budi', completed_count: '2' },
    ]);
    const res = await svc.service(...range);
    expect(res.performaTeknisi).toEqual([
      { technicianId: 't1', namaTeknisi: 'Ani', jobSelesai: 3 },
      { technicianId: 't2', namaTeknisi: 'Budi', jobSelesai: 2 },
    ]);
    expect(res.jumlahPerStatus).toEqual([{ status: 'selesai', count: 2 }]);
    expect(res.rataRataWaktuPengerjaanMenit).toBe(90);
    expect(sql[0]).not.toContain('technician_job_assignees'); // rata-rata waktu tetap dihitung dari technician_jobs
  });
});
