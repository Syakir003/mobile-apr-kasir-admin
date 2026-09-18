'use client';

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
import { Card, CardContent } from '@/components/ui/card';
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
  const filtered = isAdmin
    ? jobs.filter((j) => (showDone ? !ACTIVE_JOB_STATUSES.includes(j.status) : ACTIVE_JOB_STATUSES.includes(j.status)))
    : jobs;

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isTeknisi ? 'Job Saya' : 'Job Teknisi'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isTeknisi
              ? 'Job servis yang ditugaskan ke Anda.'
              : 'Semua job servis & pemasangan — kelola penugasan teknisi di sini.'}
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => jobsQuery.refetch()}>
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {isAdmin && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={showDone ? 'outline' : 'default'}
            onClick={() => setShowDone(false)}
          >
            Aktif
          </Button>
          <Button
            size="sm"
            variant={showDone ? 'default' : 'outline'}
            onClick={() => setShowDone(true)}
          >
            Selesai
          </Button>
        </div>
      )}

      {jobsQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat job...</p>}
      {jobsQuery.isError && <p className="text-sm text-destructive">Gagal memuat data job.</p>}
      {!jobsQuery.isLoading && !jobsQuery.isError && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Wrench className="size-8" />
            <p className="text-sm">
              {isAdmin && showDone ? 'Belum ada job selesai.' : 'Belum ada job aktif.'}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2.5">
        {filtered.map((job) => (
          // className="py-0" di Card WAJIB — default shadcn Card sendiri udah
          // bawa py-6 (lihat components/ui/card.tsx), jadi tanpa ini padding
          // vertikalnya DOBEL sama py-* punya CardContent di bawah (itu yang
          // bikin kartu kelihatan gemuk & banyak ruang kosong sebelumnya).
          // Sempat dirapetin kebablasan (px-4 py-3 + teks text-xs) — dibalikin
          // sedikit lebih lega di sini.
          <Card key={job.id} className="py-0">
            <CardContent className="flex flex-col gap-1.5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <Link href={`/teknisi/jobs/${job.id}`} className="flex-1 min-w-0">
                <p className="truncate text-[15px] font-medium">
                  {job.unit
                    ? [job.unit.brand, job.unit.model].filter(Boolean).join(' ') || 'Unit AC'
                    : `Order ${job.type}`}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {job.type} • {job.member?.name || '-'}
                  {job.scheduledDate && ` • Jadwal ${formatDate(job.scheduledDate)}`}
                  {isAdmin && ` • ${job.technician?.displayName || 'Belum ditugaskan'}`}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Masuk {formatDateTime(job.createdAt)}
                </p>
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
