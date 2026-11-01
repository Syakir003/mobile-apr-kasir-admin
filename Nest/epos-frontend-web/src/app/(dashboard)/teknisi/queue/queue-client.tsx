'use client';

import { unitPartsText, type UnitPartProduct } from '@/components/ac-unit-parts';
import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw, Wrench } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime, statusLabel } from '@/lib/format';
import type { Role } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Menu "Servis & Teknisi" dipakai admin DAN teknisi lewat rute yang sama
// (nav-config.ts), tapi datanya beda: teknisi cuma lihat job miliknya
// (GET /technician-jobs/queue, sudah difilter status aktif oleh server),
// admin lihat SEMUA job (GET /technician-jobs, findAll — endpoint tambahan
// yang gak ada di RPC asli, lihat komentar TechnicianJobsService.findAll).

interface JobMember {
  id: string;
  name: string;
  phone: string | null;
}
interface JobUnit {
  id: string;
  brand: string | null;
  model: string | null;
  roomLocation: string | null;
  barcodeValue: string;
  indoorProduct?: UnitPartProduct | null;
  outdoorProduct?: UnitPartProduct | null;
}
interface JobTechnician {
  id: string;
  displayName: string;
  email: string;
}
export interface TechnicianJob {
  id: string;
  type: string;
  status: string;
  scheduledDate: string | null;
  notes: string | null;
  // Kapan job ini DIBUAT (bukan dijadwalkan) — ditambah biar admin bisa
  // ngurutin/mbedain job yang keliatan mirip (unit sama, teknisi sama) tapi
  // sebenernya beda urutan masuk. Field-nya udah lama ada di response
  // backend (findAll/queue gak pakai `select`, jadi semua kolom scalar ikut
  // kebawa) — sebelumnya cuma belum dipetakan & ditampilin di sini.
  createdAt: string;
  member: JobMember | null;
  unit: JobUnit | null;
  technician: JobTechnician | null;
  // Cuma keisi dari GET /technician-jobs/queue (myQueue) — dipakai dashboard
  // teknisi buat nandain job 'assigned' yang masih kena gate "foto sebelum"
  // sebelum bisa start(). findAll() (dipakai admin) gak ngirim field ini.
  hasBeforePhoto?: boolean;
  // Teknisi sudah menekan "Kirim Temuan" (kasir/admin perlu menetapkan harga jasa).
  findingsSentAt?: string | null;
  order?: { invoiceId: string | null } | null;
}
interface UserRow {
  id: string;
  displayName: string;
  role: Role;
  active: boolean;
}

// Vokabuler status (lihat komentar di schema.prisma model TechnicianJob) —
// selain dua ini, sisanya ('selesai', 'dibatalkan') dianggap "Selesai".
export const ACTIVE_JOB_STATUSES = [
  'menunggu_penugasan',
  'assigned',
  'sedang_dikerjakan',
  'menunggu_review',
];

export function statusBadgeVariant(status: string): 'secondary' | 'warning' | 'success' {
  if (status === 'selesai') return 'success';
  if (status === 'sedang_dikerjakan' || status === 'menunggu_review') return 'warning';
  return 'secondary';
}

export function TeknisiQueueClient({ role }: { role: Role }) {
  const isTeknisi = role === 'teknisi';
  const isAdmin = role === 'admin';
  const queryClient = useQueryClient();
  const [showDone, setShowDone] = React.useState(false);

  const jobsQuery = useQuery({
    queryKey: isTeknisi ? ['technician-jobs', 'queue'] : ['technician-jobs', 'all'],
    queryFn: () =>
      apiClient.get<TechnicianJob[]>(isTeknisi ? '/technician-jobs/queue' : '/technician-jobs'),
  });

  // Daftar teknisi buat dropdown assign — GET /users admin-only di backend,
  // jadi query ini SENGAJA cuma jalan (`enabled`) kalau role-nya admin.
  const techniciansQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<UserRow[]>('/users'),
    enabled: isAdmin,
  });
  const technicians = (techniciansQuery.data ?? []).filter(
    (u) => u.role === 'teknisi' && u.active,
  );

  const assignMutation = useMutation({
    mutationFn: ({ jobId, technicianId }: { jobId: string; technicianId: string }) =>
      apiClient.patch(`/technician-jobs/${jobId}/assign`, { technicianId }),
    onSuccess: () => {
      toast.success('Teknisi ditugaskan.');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', 'all'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menugaskan teknisi.');
    },
  });

  const jobs = jobsQuery.data ?? [];
  // Query teknisi (/queue) sudah difilter aktif dari server — toggle
  // Aktif/Selesai cuma relevan buat admin (findAll ngembaliin semua status).
  const filtered = !isTeknisi
    ? jobs.filter((j) => (showDone ? !ACTIVE_JOB_STATUSES.includes(j.status) : ACTIVE_JOB_STATUSES.includes(j.status)))
    : jobs;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isTeknisi ? 'Job Saya' : 'Job Teknisi'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isTeknisi
              ? 'Job servis yang ditugaskan ke Anda.'
              : 'Semua job servis & pemasangan - kelola penugasan teknisi di sini.'}
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label="Muat ulang daftar job" onClick={() => jobsQuery.refetch()}>
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {/* Daftar job: satu panel (pita judul + filter, isi, baris job), seperti section di halaman detail. */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">Daftar Job</h2>
            {!jobsQuery.isLoading && !jobsQuery.isError && <Badge variant="secondary">{filtered.length}</Badge>}
          </div>
          {!isTeknisi && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={showDone ? 'outline' : 'default'}
                aria-pressed={!showDone}
                onClick={() => setShowDone(false)}
              >
                Aktif
              </Button>
              <Button
                size="sm"
                variant={showDone ? 'default' : 'outline'}
                aria-pressed={showDone}
                onClick={() => setShowDone(true)}
              >
                Selesai
              </Button>
            </div>
          )}
        </div>

        {jobsQuery.isLoading && <p className="px-5 py-6 text-sm text-muted-foreground">Memuat job...</p>}
        {jobsQuery.isError && (
          <div className="flex flex-wrap items-center gap-3 px-5 py-6">
            <p className="text-sm text-destructive">Gagal memuat data job.</p>
            <Button variant="outline" size="sm" onClick={() => jobsQuery.refetch()}>
              Coba lagi
            </Button>
          </div>
        )}
        {!jobsQuery.isLoading && !jobsQuery.isError && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-muted-foreground">
            <Wrench className="size-8" />
            <p className="text-sm">
              {!isTeknisi && showDone ? 'Belum ada job selesai.' : 'Belum ada job aktif.'}
            </p>
          </div>
        )}

        <ul className="divide-y">
          {filtered.map((job) => (
            <li
              key={job.id}
              className="flex flex-col gap-1.5 px-5 py-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
            >
            <Link
              href={`/teknisi/jobs/${job.id}`}
              className="min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <p className="truncate text-[15px] font-medium">
                {job.unit
                  ? [job.unit.brand, job.unit.model].filter(Boolean).join(' ') || 'Unit AC'
                  : `Order ${job.type}`}
              </p>
              {job.unit && unitPartsText(job.unit) && (
                <p className="truncate text-xs text-muted-foreground">{unitPartsText(job.unit)}</p>
              )}
              <p className="truncate text-sm text-muted-foreground">
                {job.type} • {job.member?.name || '-'}
                {job.scheduledDate && ` • Jadwal ${formatDate(job.scheduledDate)}`}
                {isAdmin && ` • ${job.technician?.displayName || 'Belum ditugaskan'}`}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Masuk {formatDateTime(job.createdAt)}
              </p>
              {!isTeknisi && job.findingsSentAt && !job.order?.invoiceId && (
                <p className="truncate text-xs font-medium text-status-warning-foreground dark:text-status-warning">
                  Temuan terkirim - tentukan harga jasa
                </p>
              )}
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              {isAdmin && ['menunggu_penugasan', 'assigned'].includes(job.status) && (
                <Select
                  value={job.technician?.id ?? undefined}
                  onValueChange={(technicianId) =>
                    assignMutation.mutate({ jobId: job.id, technicianId })
                  }
                >
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue placeholder="Tugaskan teknisi" />
                  </SelectTrigger>
                  <SelectContent>
                    {technicians.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        Belum ada teknisi aktif
                      </p>
                    )}
                    {technicians.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Badge variant={statusBadgeVariant(job.status)}>{statusLabel(job.status)}</Badge>
            </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
