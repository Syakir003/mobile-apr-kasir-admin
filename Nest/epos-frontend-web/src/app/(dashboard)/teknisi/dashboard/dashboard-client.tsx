'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  History,
  ScanLine,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatDate, formatDateLong, statusLabel } from '@/lib/format';
import type { Role } from '@/lib/session';
import type { TechnicianJob } from '../queue/queue-client';
import { statusBadgeVariant } from '../queue/queue-client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Fondasinya niru dashboard_screen.dart di app mobile teknisi (2 MetricCard
// + Akses Cepat, lihat komentar versi sebelumnya) — di sini dikembangin
// lebih jauh biar lebih kepake sebagai "halaman pertama dibuka tiap hari",
// bukan cuma angka statis: ada "Perlu Perhatian" (job yang kena gate foto-
// sebelum, biar teknisi tau SEBELUM klik Mulai Job & ketemu error), "Jadwal
// Hari Ini", dan sisa job aktif lainnya. Tiga bagian ini gak ada
// padanannya di mobile — user eksplisit bilang gapapa dikembangin biar
// lebih intuitif selayaknya dashboard beneran.

interface HistoryTotal {
  total: number;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function TeknisiDashboardClient({ role }: { role: Role; displayName: string }) {
  const isTeknisi = role === 'teknisi';

  const queueQuery = useQuery({
    queryKey: ['technician-jobs', 'queue'],
    queryFn: () => apiClient.get<TechnicianJob[]>('/technician-jobs/queue'),
    enabled: isTeknisi,
  });
  // pageSize=1 — yang dibutuhin cuma field `total`, bukan isi daftarnya
  // (riwayat detail udah ada halaman /teknisi/riwayat sendiri).
  const historyQuery = useQuery({
    queryKey: ['technician-jobs', 'history', 'total-only'],
    queryFn: () => apiClient.get<HistoryTotal>('/technician-jobs/history?page=1&pageSize=1'),
    enabled: isTeknisi,
  });

  if (!isTeknisi) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Halaman ini khusus akun teknisi (ringkasan job pribadi).
          </CardContent>
        </Card>
      </div>
    );
  }

  const loading = queueQuery.isLoading || historyQuery.isLoading;
  const jobs = queueQuery.data ?? [];
  const aktif = jobs.length;
  const selesai = historyQuery.data?.total ?? 0;
  const totalDitugaskan = aktif + selesai;

  // Job 'assigned' yang belum ada foto 'sebelum' -> tombol Mulai Job-nya
  // masih terkunci di halaman detail (lihat gate start() & job-detail-
  // client.tsx). Ditonjolin di sini biar ketauan DULUAN, bukan pas udah
  // buka halaman job & baru sadar ada yang kurang.
  const needsAttention = jobs.filter((j) => j.status === 'assigned' && j.hasBeforePhoto === false);

  const today = new Date();
  const sortedJobs = [...jobs].sort((a, b) => {
    if (!a.scheduledDate) return 1;
    if (!b.scheduledDate) return -1;
    return a.scheduledDate < b.scheduledDate ? -1 : 1;
  });
  const todayJobs = sortedJobs.filter(
    (j) => j.scheduledDate && isSameLocalDay(new Date(j.scheduledDate), today),
  );
  const todayIds = new Set(todayJobs.map((j) => j.id));
  const otherJobs = sortedJobs.filter((j) => !todayIds.has(j.id));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="size-3.5" />
          {formatDateLong(today)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          href="/teknisi/queue"
          label="Job Berjalan"
          value={loading ? '—' : String(aktif)}
          sub={loading ? undefined : `Dari ${totalDitugaskan} job ditugaskan`}
          icon={Wrench}
          featured
        />
        <MetricCard
          href="/teknisi/riwayat"
          label="Job Selesai"
          value={loading ? '—' : String(selesai)}
          sub="Total sepanjang waktu"
          icon={CheckCircle2}
        />
      </div>

      {!loading && needsAttention.length > 0 && (
        <Card className="border-status-warning/40 bg-status-warning/10">
          <CardContent className="grid gap-3 py-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-status-warning" />
              <p className="text-sm font-semibold">
                {needsAttention.length} job belum bisa dimulai — foto Sebelum belum diunggah
              </p>
            </div>
            <div className="grid gap-2">
              {needsAttention.map((job) => (
                <Link
                  key={job.id}
                  href={`/teknisi/jobs/${job.id}`}
                  className="text-sm text-foreground underline-offset-2 hover:underline"
                >
                  {jobTitle(job)} &rarr;
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jadwal Hari Ini</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {!loading && queueQuery.isError && (
            <p className="text-sm text-destructive">Gagal memuat job. Coba muat ulang halaman.</p>
          )}
          {!loading && !queueQuery.isError && todayJobs.length === 0 && (
            <p className="text-sm text-muted-foreground">Gak ada job berjadwal hari ini.</p>
          )}
          {todayJobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </CardContent>
      </Card>

      {!loading && otherJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Job Aktif Lainnya</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {otherJobs.slice(0, 5).map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
            {otherJobs.length > 5 && (
              <Link href="/teknisi/queue" className="text-sm text-primary hover:underline">
                Lihat semua ({otherJobs.length}) &rarr;
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-5">
          <p className="mb-3 text-sm font-semibold">Akses Cepat</p>
          <div className="flex flex-wrap gap-3">
            <ShortcutChip href="/teknisi/queue" icon={ClipboardList} label="Job" />
            <ShortcutChip href="/ac-units/scan" icon={ScanLine} label="Scan Unit" />
            <ShortcutChip href="/teknisi/riwayat" icon={History} label="Riwayat" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function jobTitle(job: TechnicianJob): string {
  return job.unit
    ? [job.unit.brand, job.unit.model].filter(Boolean).join(' ') || 'Unit AC'
    : `Order ${job.type}`;
}

// Padanan MetricCard di dashboard mobile — varian `featured` (kartu
// pertama) gradient teal + teks putih, varian biasa putih dengan ikon di
// dalam kotak Mist (bg-primary/10). Radius 20px (AppRadius.xl) disamain
// via arbitrary value biar gak dibulatin ke skala rounded-2xl/3xl Tailwind.
function MetricCard({
  href,
  label,
  value,
  sub,
  icon: Icon,
  featured = false,
}: {
  href: string;
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  featured?: boolean;
}) {
  return (
    <Link href={href}>
      <div
        className={cn(
          'flex min-h-[140px] flex-col justify-between rounded-[20px] p-6 transition-shadow hover:shadow-md',
          featured
            ? 'bg-gradient-to-br from-[#0b6b62] to-[#006b5f] text-white'
            : 'border bg-card text-card-foreground',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p className={cn('text-[15px] font-medium', featured ? 'text-white/85' : 'text-foreground')}>
            {label}
          </p>
          {featured ? (
            <Icon className="size-7 shrink-0 text-white/85" />
          ) : (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Icon className="size-5 text-primary" />
            </div>
          )}
        </div>
        <div>
          <p className="text-[32px] leading-tight font-bold">{value}</p>
          {sub && (
            <p className={cn('mt-1 text-xs', featured ? 'text-white/70' : 'text-muted-foreground')}>
              {sub}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

// Padanan _ShortcutChip — pil bg-mist/teks tealDeep di mobile, disamain ke
// token bg-primary/10 + text-primary yang emang udah dipetakan ke warna
// teal yang sama di globals.css.
function ShortcutChip({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

// Baris job ringkas — dipakai section "Jadwal Hari Ini" & "Job Aktif
// Lainnya", sama gaya row Card yang udah dipakai queue-client/riwayat-client
// biar konsisten sama halaman lain.
function JobRow({ job }: { job: TechnicianJob }) {
  return (
    <Link href={`/teknisi/jobs/${job.id}`}>
      <div className="flex items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-accent">
        <div className="min-w-0">
          <p className="truncate font-medium">{jobTitle(job)}</p>
          <p className="truncate text-sm text-muted-foreground">
            {job.type} • {job.member?.name || '-'}
          </p>
          {job.scheduledDate && (
            <p className="text-xs text-muted-foreground">Jadwal: {formatDate(job.scheduledDate)}</p>
          )}
        </div>
        <Badge variant={statusBadgeVariant(job.status)}>{statusLabel(job.status)}</Badge>
      </div>
    </Link>
  );
}
