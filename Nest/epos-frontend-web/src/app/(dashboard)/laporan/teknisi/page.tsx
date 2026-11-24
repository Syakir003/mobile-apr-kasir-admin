'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { wibDateKey } from '@/lib/wib-date';
import { groupByOrder, rowStatusOf } from '../../teknisi/queue/queue-client';

// Performa teknisi dihitung di browser dari GET /technician-jobs (semua job,
// admin-only). Rute /laporan/* admin-only lewat proxy.ts.
// ponytail: hitung di klien dari semua job; pindah ke endpoint /reports
// kalau job sudah ribuan.
//
// Ukuran yang dipakai SENGAJA bukan lama pengerjaan / tepat jadwal: order 20 unit dan rumah 1 unit tidak bisa
// dibandingkan dengan waktu, dan satu order banyak unit diajukan/disetujui sekaligus. Yang dinilai:
//  - Total Job = jumlah ORDER (satu kunjungan; order 10 unit tetap 1 job), pengelompokan sama dengan Antrian Servis.
//  - Unit AC = jumlah unit yang dikerjakan, dipecah Unit Dikerjakan (belum tuntas) dan Unit Selesai (tuntas).
//  - Penyelesaian = Unit Selesai / Unit AC, dihitung REALTIME per unit (tuntas atau belum), tanpa menunggu admin.

interface JobTechnician {
  id: string;
  displayName: string;
}

interface Job {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  scheduledDate: string | null;
  // Order tempat job ini bernaung (servis banyak AC = beberapa job, satu per unit, di order yang sama).
  orderId?: string;
  technician: JobTechnician | null;
  // Semua teknisi job (setara, maks. 5); `technician` hanya yang pertama.
  technicians?: JobTechnician[];
  // Backend: unit yang sedang dikerjakan dan sudah lengkap di lapangan (temuan + foto sebelum & sesudah tiap temuan).
  fieldComplete?: boolean;
}

interface Row {
  id: string;
  nama: string;
  totalJob: number;
  selesai: number;
  review: number;
  berjalan: number;
  unitAc: number;
  unitDikerjakan: number;
  unitSelesai: number;
  persen: number | null;
}

type SortKey = Exclude<keyof Row, 'id'>;

// Urutan kolom = urutan tampil. `numeric` = rata kanan dan urutan pertama dari terbesar.
const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'nama', label: 'Teknisi', numeric: false },
  { key: 'totalJob', label: 'Total Job', numeric: true },
  { key: 'selesai', label: 'Selesai', numeric: true },
  { key: 'review', label: 'Menunggu Review', numeric: true },
  { key: 'berjalan', label: 'Sedang Berjalan', numeric: true },
  { key: 'unitAc', label: 'Unit AC', numeric: true },
  { key: 'unitDikerjakan', label: 'Unit Dikerjakan', numeric: true },
  { key: 'unitSelesai', label: 'Unit Selesai', numeric: true },
  { key: 'persen', label: 'Penyelesaian', numeric: true },
];

// Pintasan rentang tanggal; null = semua waktu (sampai hari ini). 0 = hari ini saja.
const PERIODS: { label: string; days: number | null }[] = [
  { label: 'Hari ini', days: 0 },
  { label: '7 hari', days: 7 },
  { label: '30 hari', days: 30 },
  { label: '90 hari', days: 90 },
  { label: 'Semua waktu', days: null },
];

// Muat ulang otomatis supaya progres terasa realtime saat halaman dibiarkan terbuka.
const REFRESH_MS = 30_000;

// Kunci tanggal 'YYYY-MM-DD' (WIB) untuk "n hari terakhir"; '' = tanpa batas.
const daysAgoKey = (n: number) => wibDateKey(new Date(Date.now() - n * 86_400_000));

// Rentang tanggal memakai TANGGAL JADWAL job (sama dengan filter Hari ini di Antrian Servis); job tanpa jadwal
// memakai tanggal dibuat.
const jobDay = (j: Job) => wibDateKey(j.scheduledDate ?? j.createdAt);

// Satu job dikreditkan ke SEMUA teknisinya.
const jobTechnicians = (j: Job): JobTechnician[] =>
  j.technicians?.length ? j.technicians : j.technician ? [j.technician] : [];

// Satu UNIT tuntas: sudah diajukan teknisi (Menunggu Review) / disetujui admin (Selesai), ATAU sedang dikerjakan dan
// sudah lengkap di lapangan (scan + temuan berfoto sebelum & sesudah), walau belum Ajukan Selesai.
const unitTuntas = (j: Job) =>
  j.status === 'menunggu_review' || j.status === 'selesai' || (j.status === 'sedang_dikerjakan' && !!j.fieldComplete);

export default function PerformaTeknisiPage() {
  // Rentang tanggal jadwal job (WIB, kedua ujung termasuk). Bawaan: 30 hari terakhir sampai hari ini; job yang
  // jadwalnya di depan belum jatuh tempo, jadi tidak ikut dihitung sebagai belum tuntas.
  const [from, setFrom] = React.useState(() => daysAgoKey(30));
  const [to, setTo] = React.useState(() => daysAgoKey(0));
  // Bawaan: paling banyak unit selesai dulu.
  const [sortKey, setSortKey] = React.useState<SortKey>('unitSelesai');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');
  const jobsQuery = useQuery({
    queryKey: ['technician-jobs', 'all'],
    queryFn: () => apiClient.get<Job[]>('/technician-jobs'),
    refetchInterval: REFRESH_MS,
  });
  const rangeInvalid = from !== '' && to !== '' && from > to;
  const setPreset = (days: number | null) => {
    setFrom(days === null ? '' : daysAgoKey(days));
    setTo(daysAgoKey(0));
  };
  // Klik kolom yang sama membalik arah; kolom baru mulai dari terbesar (nama: A ke Z).
  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'nama' ? 'asc' : 'desc');
    }
  };

  const { rows, belumDitugaskan } = React.useMemo(() => {
    const jobs = (jobsQuery.data ?? []).filter((j) => {
      const day = jobDay(j);
      return (!from || day >= from) && (!to || day <= to);
    });
    const by = new Map<string, { nama: string; jobs: Job[] }>();
    for (const j of jobs) {
      for (const t of jobTechnicians(j)) {
        const e = by.get(t.id) ?? { nama: t.displayName, jobs: [] };
        e.jobs.push(j);
        by.set(t.id, e);
      }
    }
    const rows: Row[] = [...by.entries()].map(([id, { nama, jobs }]) => {
      // Unit yang dibatalkan tidak dihitung. Order = kelompok unit teknisi INI di satu order, statusnya mengikuti
      // aturan Antrian Servis (satu unit sudah jalan = Sedang Berjalan).
      const units = jobs.filter((j) => j.status !== 'dibatalkan');
      const statuses = groupByOrder(units).map(rowStatusOf);
      const selesai = statuses.filter((s) => s === 'selesai').length;
      const review = statuses.filter((s) => s === 'menunggu_review').length;
      const unitSelesai = units.filter(unitTuntas).length;
      return {
        id,
        nama,
        totalJob: statuses.length,
        selesai,
        review,
        // Sisanya: ditugaskan atau sedang dikerjakan (belum diajukan), jadi Total Job = Selesai + Review + Berjalan.
        berjalan: statuses.length - selesai - review,
        unitAc: units.length,
        unitDikerjakan: units.length - unitSelesai,
        unitSelesai,
        persen: units.length ? Math.round((unitSelesai / units.length) * 100) : null,
      };
    });
    const unassigned = jobs.filter((j) => jobTechnicians(j).length === 0 && j.status !== 'dibatalkan');
    return { rows, belumDitugaskan: groupByOrder(unassigned).length };
  }, [jobsQuery.data, from, to]);

  const sortedRows = React.useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const byName = (a: Row, b: Row) => a.nama.localeCompare(b.nama, 'id');
    return [...rows].sort((a, b) => {
      if (sortKey === 'nama') return dir * byName(a, b);
      const av = a[sortKey];
      const bv = b[sortKey];
      // Tanpa persentase ("-") selalu di paling bawah, apa pun arahnya.
      if (av === null || bv === null) return av === bv ? byName(a, b) : av === null ? 1 : -1;
      return dir * (av - bv) || byName(a, b);
    });
  }, [rows, sortKey, sortDir]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performa Teknisi</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Jumlah job, unit AC, dan persentase penyelesaian per teknisi. Klik judul kolom untuk mengurutkan.
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
                {COLUMNS.map((c) => {
                  const active = c.key === sortKey;
                  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <TableHead
                      key={c.key}
                      className={c.numeric ? 'text-right' : undefined}
                      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className={cn(
                          'inline-flex items-center gap-1 whitespace-nowrap rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                          active ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {c.label}
                        <Icon className={cn('size-3.5 shrink-0', !active && 'opacity-40')} aria-hidden />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} className="text-center text-muted-foreground">
                    Memuat...
                  </TableCell>
                </TableRow>
              )}
              {!jobsQuery.isLoading && sortedRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} className="text-center text-muted-foreground">
                    Belum ada job pada periode ini.
                  </TableCell>
                </TableRow>
              )}
              {sortedRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.nama}</TableCell>
                  <TableCell className="text-right">{r.totalJob}</TableCell>
                  <TableCell className="text-right">{r.selesai}</TableCell>
                  <TableCell className="text-right">{r.review}</TableCell>
                  <TableCell className="text-right">{r.berjalan}</TableCell>
                  <TableCell className="text-right">{r.unitAc}</TableCell>
                  <TableCell className="text-right">{r.unitDikerjakan}</TableCell>
                  <TableCell className="text-right">{r.unitSelesai}</TableCell>
                  <TableCell className="text-right font-medium">
                    {r.persen === null ? '-' : `${r.persen}%`}
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
      <div className="grid gap-1 text-xs text-muted-foreground">
        <p>
          Rentang tanggal dihitung dari tanggal jadwal job (WIB; job tanpa jadwal memakai tanggal dibuat), sama
          dengan filter hari di Antrian Servis. Kosongkan kedua tanggal untuk semua waktu. Halaman ini diperbarui
          otomatis tiap 30 detik.
        </p>
        <p>
          <b>Total Job</b> = jumlah order (satu kunjungan; order 10 unit tetap dihitung 1 job, pemasangan dari POS per
          job). Yang dibatalkan tidak dihitung. Job yang dipegang beberapa teknisi dihitung untuk semuanya, jadi jumlah
          antar baris bisa melebihi jumlah sebenarnya.
        </p>
        <p>
          <b>Selesai</b> = order sudah disetujui admin. <b>Menunggu Review</b> = sudah diajukan teknisi, belum
          disetujui admin. <b>Sedang Berjalan</b> = ditugaskan atau sedang dikerjakan (satu unit saja yang sudah
          jalan sudah cukup). Total Job = ketiganya.
        </p>
        <p>
          <b>Unit AC</b> = jumlah unit yang dikerjakan = <b>Unit Dikerjakan</b> + <b>Unit Selesai</b>. Satu unit
          dihitung selesai bila sudah diajukan/disetujui, atau sedang dikerjakan (sudah discan) dengan temuan dan foto
          sebelum + sesudah lengkap di setiap temuan (sparepart tidak diperiksa), walau belum Ajukan Selesai; karena
          itu Unit Selesai bisa lebih banyak dari unit pada order yang berstatus Selesai.{' '}
          <b>Penyelesaian</b> = Unit Selesai dibagi Unit AC, dihitung realtime tanpa menunggu persetujuan admin.
        </p>
      </div>
    </div>
  );
}
