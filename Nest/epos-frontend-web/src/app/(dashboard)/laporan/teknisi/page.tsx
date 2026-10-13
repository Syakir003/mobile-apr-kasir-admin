'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Performa teknisi dihitung di browser dari GET /technician-jobs (semua job,
// admin-only; field startedAt/completedAt/scheduledDate sudah ikut di
// response). Rute /laporan/* admin-only lewat proxy.ts.
// ponytail: hitung di klien dari semua job; pindah ke endpoint /reports
// kalau job sudah ribuan.

interface Job {
  status: string;
  createdAt: string;
  scheduledDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  technician: { id: string; displayName: string } | null;
}

const PERIODS = { '7': '7 hari terakhir', '30': '30 hari terakhir', '90': '90 hari terakhir', all: 'Semua waktu' };
const RUNNING = ['assigned', 'sedang_dikerjakan', 'menunggu_review'];

function durasi(menit: number | null) {
  if (menit === null) return '-';
  const h = Math.floor(menit / 60);
  return h > 0 ? `${h} jam ${Math.round(menit % 60)} mnt` : `${Math.round(menit)} mnt`;
}

const sameOrBeforeDay = (a: Date, b: Date) =>
  new Date(a).setHours(0, 0, 0, 0) <= new Date(b).setHours(0, 0, 0, 0);

export default function PerformaTeknisiPage() {
  const [period, setPeriod] = React.useState<keyof typeof PERIODS>('30');
  const jobsQuery = useQuery({
    queryKey: ['technician-jobs', 'all'],
    queryFn: () => apiClient.get<Job[]>('/technician-jobs'),
  });

  const { rows, belumDitugaskan } = React.useMemo(() => {
    const since = period === 'all' ? 0 : Date.now() - Number(period) * 86_400_000;
    const jobs = (jobsQuery.data ?? []).filter((j) => new Date(j.createdAt).getTime() >= since);
    const by = new Map<string, { nama: string; jobs: Job[] }>();
    for (const j of jobs) {
      if (!j.technician) continue;
      const e = by.get(j.technician.id) ?? { nama: j.technician.displayName, jobs: [] };
      e.jobs.push(j);
      by.set(j.technician.id, e);
    }
    const rows = [...by.entries()].map(([id, { nama, jobs }]) => {
      const selesai = jobs.filter((j) => j.status === 'selesai');
      const lama = selesai
        .filter((j) => j.startedAt && j.completedAt)
        .map((j) => (new Date(j.completedAt!).getTime() - new Date(j.startedAt!).getTime()) / 60_000);
      const berjadwal = selesai.filter((j) => j.scheduledDate && j.completedAt);
      const tepat = berjadwal.filter((j) =>
        sameOrBeforeDay(new Date(j.completedAt!), new Date(j.scheduledDate!)),
      ).length;
      return {
        id,
        nama,
        total: jobs.filter((j) => j.status !== 'dibatalkan').length,
        selesai: selesai.length,
        berjalan: jobs.filter((j) => RUNNING.includes(j.status)).length,
        rataMenit: lama.length ? lama.reduce((a, b) => a + b, 0) / lama.length : null,
        tepatPersen: berjadwal.length ? Math.round((tepat / berjadwal.length) * 100) : null,
      };
    });
    rows.sort((a, b) => b.selesai - a.selesai);
    return { rows, belumDitugaskan: jobs.filter((j) => !j.technician && j.status !== 'dibatalkan').length };
  }, [jobsQuery.data, period]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performa Teknisi</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Jumlah job, kecepatan pengerjaan, dan ketepatan jadwal per teknisi.
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as keyof typeof PERIODS)}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PERIODS).map(([v, label]) => (
              <SelectItem key={v} value={v}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teknisi</TableHead>
                <TableHead className="text-right">Total Job</TableHead>
                <TableHead className="text-right">Selesai</TableHead>
                <TableHead className="text-right">Sedang Berjalan</TableHead>
                <TableHead className="text-right">Rata-rata Pengerjaan</TableHead>
                <TableHead className="text-right">Tepat Jadwal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Memuat...
                  </TableCell>
                </TableRow>
              )}
              {!jobsQuery.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Belum ada job pada periode ini.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.nama}</TableCell>
                  <TableCell className="text-right">{r.total}</TableCell>
                  <TableCell className="text-right">{r.selesai}</TableCell>
                  <TableCell className="text-right">{r.berjalan}</TableCell>
                  <TableCell className="text-right">{durasi(r.rataMenit)}</TableCell>
                  <TableCell className="text-right">
                    {r.tepatPersen === null ? '-' : `${r.tepatPersen}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {belumDitugaskan > 0 && (
        <p className="text-sm text-muted-foreground">
          {belumDitugaskan} job belum ditugaskan ke teknisi manapun (tidak masuk tabel).
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Periode dihitung dari tanggal job dibuat. "Tepat jadwal" = job selesai pada atau sebelum
        tanggal jadwalnya (hanya job yang punya jadwal).
      </p>
    </div>
  );
}
