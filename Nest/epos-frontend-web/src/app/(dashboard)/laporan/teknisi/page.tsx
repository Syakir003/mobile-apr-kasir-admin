'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { wibDateKey } from '@/lib/wib-date';

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

// Pintasan rentang tanggal; null = semua waktu.
const PERIODS: { label: string; days: number | null }[] = [
  { label: '7 hari', days: 7 },
  { label: '30 hari', days: 30 },
  { label: '90 hari', days: 90 },
  { label: 'Semua waktu', days: null },
];
const RUNNING = ['assigned', 'sedang_dikerjakan', 'menunggu_review'];

function durasi(menit: number | null) {
  if (menit === null) return '-';
  const h = Math.floor(menit / 60);
  return h > 0 ? `${h} jam ${Math.round(menit % 60)} mnt` : `${Math.round(menit)} mnt`;
}

const sameOrBeforeDay = (a: Date, b: Date) =>
  new Date(a).setHours(0, 0, 0, 0) <= new Date(b).setHours(0, 0, 0, 0);

// Kunci tanggal 'YYYY-MM-DD' (WIB) untuk "n hari terakhir"; '' = tanpa batas.
const daysAgoKey = (n: number) => wibDateKey(new Date(Date.now() - n * 86_400_000));

export default function PerformaTeknisiPage() {
  // Rentang tanggal dibuat job (WIB, kedua ujung termasuk). Bawaan: 30 hari terakhir.
  const [from, setFrom] = React.useState(() => daysAgoKey(30));
  const [to, setTo] = React.useState('');
  const jobsQuery = useQuery({
    queryKey: ['technician-jobs', 'all'],
    queryFn: () => apiClient.get<Job[]>('/technician-jobs'),
  });
  const rangeInvalid = from !== '' && to !== '' && from > to;
  const setPreset = (days: number | null) => {
    setFrom(days === null ? '' : daysAgoKey(days));
    setTo('');
  };

  const { rows, belumDitugaskan } = React.useMemo(() => {
    const jobs = (jobsQuery.data ?? []).filter((j) => {
      const day = wibDateKey(j.createdAt);
      return (!from || day >= from) && (!to || day <= to);
    });
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
  }, [jobsQuery.data, from, to]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performa Teknisi</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Jumlah job, kecepatan pengerjaan, dan ketepatan jadwal per teknisi.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {PERIODS.map((p) => (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant="outline"
              className="whitespace-nowrap"
              onClick={() => setPreset(p.days)}
            >
              {p.label}
            </Button>
          ))}
          <label className="flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring/40">
            <span className="shrink-0 text-xs text-muted-foreground">Dari:</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Dari tanggal"
              className="h-7 w-32 bg-transparent text-xs outline-none"
            />
          </label>
          <label className="flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring/40">
            <span className="shrink-0 text-xs text-muted-foreground">Sampai:</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Sampai tanggal"
              className="h-7 w-32 bg-transparent text-xs outline-none"
            />
          </label>
        </div>
      </div>
      {rangeInvalid && (
        <p className="text-sm text-destructive">Tanggal &quot;Dari&quot; tidak boleh lebih besar dari &quot;Sampai&quot;.</p>
      )}

      <Card className="gap-0 overflow-hidden py-0 shadow-none">
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
        Rentang tanggal dihitung dari tanggal job dibuat (WIB); kosongkan kedua tanggal untuk semua
        waktu. &quot;Tepat jadwal&quot; = job selesai pada atau sebelum
        tanggal jadwalnya (hanya job yang punya jadwal).
      </p>
    </div>
  );
}
