'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueries } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import type { Role } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { JobReportSheet, type JobReportInfo, type JobReportRow } from './job-report-sheet';

interface JobReportData {
  id: string;
  type: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  member: { name: string; phone: string | null; address: string | null } | null;
  unit: { brand: string | null; model: string | null; roomLocation: string | null } | null;
  technician: { displayName: string } | null;
  // Alih tugas: teknisi sebelumnya ikut tercatat sebagai petugas (urut dari yang pertama mengerjakan).
  handovers?: { fromTechnician: { displayName: string } }[];
  materialRequests: {
    id: string;
    status: string;
    items: { id: string; name: string; unit: string | null; qty: string }[];
  }[];
  order?: { id: string } | null;
  // Servis banyak AC: job lain di order yang sama (satu job per unit); kosong = servis satu unit.
  siblings?: { id: string; createdAt: string }[];
}

const WIB = 'Asia/Jakarta';

// Tanggal/jam bisnis memakai WIB (bukan zona browser), sama dengan aturan di seluruh aplikasi.
function wibParts(value: string): { dmy: string; hm: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: WIB,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { dmy: `${get('day')}-${get('month')}-${get('year')}`, hm: `${get('hour')}:${get('minute')}` };
}

function dmyHm(value: string | null): string {
  if (!value) return '';
  const { dmy, hm } = wibParts(value);
  return `${dmy} ${hm}`;
}

// Label jenis pekerjaan di laporan: sama dengan jobTypeLabel() di app mobile
// (frontend/mobile/lib/data/models/technician_job.dart), supaya cetakan web dan mobile identik.
function reportTypeLabel(type: string): string {
  switch (type) {
    case 'pemasangan':
    case 'pemasangan_jasa':
      return 'Pemasangan';
    case 'cuci':
      return 'Cuci AC';
    case 'service':
      return 'Service';
    case 'maintenance':
      return 'Maintenance';
    case 'bongkar':
      return 'Bongkar';
    case 'bongkar_pasang':
      return 'Bongkar Pasang';
    default:
      return type || 'Pekerjaan';
  }
}

function buildReport(job: JobReportData): { rows: JobReportRow[]; info: JobReportInfo } {
  const refValue = job.completedAt ?? job.startedAt ?? job.createdAt;

  const unitTitle = [job.unit?.brand, job.unit?.model].filter(Boolean).join(' ').trim();
  const unitDesc = [unitTitle, job.unit?.roomLocation].filter(Boolean).join(' — ');
  const utama = [reportTypeLabel(job.type), unitDesc].filter(Boolean).join(' - ');

  // Sparepart yang disetujui, dengan jumlah yang diajukan (sama dengan laporan di app mobile).
  const materials: JobReportRow[] = job.materialRequests
    .filter((r) => r.status === 'approved')
    .flatMap((r) => r.items)
    .map((it) => ({ qty: `${Number(it.qty)} ${it.unit ?? ''}`.trim(), text: it.name }));

  return {
    rows: [{ qty: '1 unit', text: utama || '-' }, ...materials],
    info: {
      number: job.id.length >= 8 ? job.id.slice(0, 8).toUpperCase() : job.id.toUpperCase(),
      date: refValue ? wibParts(refValue).dmy : '',
      name: job.member?.name ?? '',
      address: job.member?.address ?? '',
      phone: job.member?.phone ?? '',
      petugas: petugasNames([job]),
      start: dmyHm(job.startedAt),
      end: dmyHm(job.completedAt),
    },
  };
}

/** Nama petugas: teknisi sebelumnya (alih tugas) lalu teknisi sekarang, tanpa duplikat. */
function petugasNames(jobs: JobReportData[]): string {
  const names = jobs.flatMap((j) => [...(j.handovers ?? []).map((h) => h.fromTechnician.displayName), j.technician?.displayName]);
  return [...new Set(names.filter((n): n is string => !!n))].join(', ');
}

// Servis banyak AC: SATU laporan untuk seluruh job (bukan per unit) — satu baris pekerjaan per unit, sparepart yang
// disetujui dari semua unit digabung, petugas dan waktu mulai/selesai dari seluruh unit. Unit yang dibatalkan tidak ikut.
function buildOrderReport(all: JobReportData[]): { rows: JobReportRow[]; info: JobReportInfo } {
  const jobs = all.filter((j) => j.status !== 'dibatalkan');
  const first = jobs[0] ?? all[0];

  const unitRows: JobReportRow[] = jobs.map((j) => {
    const unitTitle = [j.unit?.brand, j.unit?.model].filter(Boolean).join(' ').trim();
    const unitDesc = [unitTitle, j.unit?.roomLocation].filter(Boolean).join(' — ');
    return { qty: '1 unit', text: [reportTypeLabel(j.type), unitDesc].filter(Boolean).join(' - ') || '-' };
  });
  const materials: JobReportRow[] = jobs
    .flatMap((j) => j.materialRequests)
    .filter((r) => r.status === 'approved')
    .flatMap((r) => r.items)
    .map((it) => ({ qty: `${Number(it.qty)} ${it.unit ?? ''}`.trim(), text: it.name }));

  const time = (v: string) => new Date(v).getTime();
  const starts = jobs.map((j) => j.startedAt).filter((v): v is string => !!v);
  const earliestStart = starts.length ? starts.reduce((a, b) => (time(a) <= time(b) ? a : b)) : null;
  // Selesai = saat unit TERAKHIR disetujui, dan hanya bila semua unit sudah selesai.
  const ends = jobs.map((j) => j.completedAt).filter((v): v is string => !!v);
  const allDone = jobs.length > 0 && jobs.every((j) => j.status === 'selesai') && ends.length === jobs.length;
  const latestEnd = allDone ? ends.reduce((a, b) => (time(a) >= time(b) ? a : b)) : null;
  const refValue = latestEnd ?? earliestStart ?? first.createdAt;
  const petugas = petugasNames(jobs);
  const number = first.order?.id ?? first.id;

  return {
    rows: [...unitRows, ...materials],
    info: {
      number: number.length >= 8 ? number.slice(0, 8).toUpperCase() : number.toUpperCase(),
      date: refValue ? wibParts(refValue).dmy : '',
      name: first.member?.name ?? '',
      address: first.member?.address ?? '',
      phone: first.member?.phone ?? '',
      petugas,
      start: dmyHm(earliestStart),
      end: dmyHm(latestEnd),
    },
  };
}

// Laporan Pekerjaan (berlaku sebagai kartu garansi). Teknisi: kapan saja untuk job miliknya (boleh dicetak
// kosong di lapangan). Admin: hanya setelah job selesai. Cetak lewat dialog browser (bisa "Simpan sebagai PDF").
// Servis banyak AC: satu laporan untuk seluruh job (semua unit), dari job mana pun di order itu.
export function JobReportPrintClient({ jobId, role }: { jobId: string; role: Role }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['technician-jobs', jobId],
    queryFn: () => apiClient.get<JobReportData>(`/technician-jobs/${jobId}`),
  });
  // Job lain di order yang sama (kunci query sama dengan halaman job, jadi cache dibagi).
  const siblingIds = data?.siblings?.map((s) => s.id) ?? [];
  const siblingResults = useQueries({
    queries: siblingIds.map((id) => ({
      queryKey: ['technician-jobs', id],
      queryFn: () => apiClient.get<JobReportData>(`/technician-jobs/${id}`),
    })),
  });

  const back = (
    <Button variant="ghost" asChild>
      <Link href={`/teknisi/jobs/${jobId}`}>
        <ArrowLeft className="size-4" />
        Kembali
      </Link>
    </Button>
  );

  if (isLoading || siblingResults.some((r) => r.isLoading)) {
    return <p className="p-6 text-sm text-muted-foreground">Memuat laporan pekerjaan...</p>;
  }
  if (isError || !data || siblingResults.some((r) => r.isError || !r.data)) {
    return <p className="p-6 text-sm text-destructive">Gagal memuat laporan pekerjaan.</p>;
  }

  const orderJobs = [data, ...siblingResults.map((r) => r.data as JobReportData)].sort(
    (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
  );
  const multi = orderJobs.length > 1;
  const active = orderJobs.filter((j) => j.status !== 'dibatalkan');
  const done = multi ? active.length > 0 && active.every((j) => j.status === 'selesai') : data.status === 'selesai';

  if (role === 'admin' && !done) {
    return (
      <div className="p-6">
        <div className="mb-4">{back}</div>
        <p className="text-sm text-muted-foreground">
          {multi
            ? 'Laporan pekerjaan baru bisa dicetak admin setelah semua unit selesai (disetujui). Masih ada unit yang belum selesai.'
            : 'Laporan pekerjaan baru bisa dicetak admin setelah job selesai (disetujui). Status job ini belum selesai.'}
        </p>
      </div>
    );
  }

  const { rows, info } = multi ? buildOrderReport(orderJobs) : buildReport(data);

  return (
    <div className="mx-auto max-w-[210mm]">
      <style>{'@page { size: A4 portrait; margin: 0; }'}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        {back}
        <Button onClick={() => window.print()}>
          <Printer className="size-4" />
          Cetak / Simpan PDF
        </Button>
      </div>

      {/* Lembar putih di layar diberi bingkai tipis; saat dicetak dihilangkan. */}
      <div className="overflow-x-auto border bg-white shadow-sm print:overflow-visible print:border-0 print:shadow-none">
        <JobReportSheet rows={rows} info={info} />
      </div>
    </div>
  );
}
