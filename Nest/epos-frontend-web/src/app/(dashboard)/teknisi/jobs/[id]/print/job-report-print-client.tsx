'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
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
  materialRequests: {
    id: string;
    status: string;
    items: { id: string; name: string; unit: string | null; qty: string }[];
  }[];
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
      petugas: job.technician?.displayName ?? '',
      start: dmyHm(job.startedAt),
      end: dmyHm(job.completedAt),
    },
  };
}

// Laporan Pekerjaan (berlaku sebagai kartu garansi). Teknisi: kapan saja untuk job miliknya (boleh dicetak
// kosong di lapangan). Admin: hanya setelah job selesai. Cetak lewat dialog browser (bisa "Simpan sebagai PDF").
export function JobReportPrintClient({ jobId, role }: { jobId: string; role: Role }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['technician-jobs', jobId],
    queryFn: () => apiClient.get<JobReportData>(`/technician-jobs/${jobId}`),
  });

  const back = (
    <Button variant="ghost" asChild>
      <Link href={`/teknisi/jobs/${jobId}`}>
        <ArrowLeft className="size-4" />
        Kembali
      </Link>
    </Button>
  );

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Memuat laporan pekerjaan...</p>;
  if (isError || !data) return <p className="p-6 text-sm text-destructive">Gagal memuat laporan pekerjaan.</p>;

  if (role === 'admin' && data.status !== 'selesai') {
    return (
      <div className="p-6">
        <div className="mb-4">{back}</div>
        <p className="text-sm text-muted-foreground">
          Laporan pekerjaan baru bisa dicetak admin setelah job selesai (disetujui). Status job ini
          belum selesai.
        </p>
      </div>
    );
  }

  const { rows, info } = buildReport(data);

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
