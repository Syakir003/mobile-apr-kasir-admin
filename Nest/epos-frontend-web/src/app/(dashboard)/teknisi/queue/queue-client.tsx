'use client';

import { unitPartsText, type UnitPartProduct } from '@/components/ac-unit-parts';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Printer, RefreshCw, Wrench } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime, statusLabel } from '@/lib/format';
import type { Role } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  // Order tempat job ini bernaung. Servis banyak AC = beberapa job (satu per unit) di order yang sama.
  orderId?: string;
  // Harga jasa JOB INI sudah ditetapkan (pada servis banyak AC invoice order dipakai bersama).
  billingDerived?: boolean;
}

interface QueueRow {
  key: string;
  jobs: TechnicianJob[];
}

// Servis banyak AC (satu order, satu job per unit) tampil sebagai SATU baris; halaman jobnya memuat section tiap
// unit. Pemasangan dari POS tetap per job (alurnya tidak diubah).
function groupByOrder(jobs: TechnicianJob[]): QueueRow[] {
  const rows: QueueRow[] = [];
  const byOrder = new Map<string, QueueRow>();
  for (const j of jobs) {
    if (j.orderId && j.type !== 'pemasangan') {
      const existing = byOrder.get(j.orderId);
      if (existing) {
        existing.jobs.push(j);
        continue;
      }
      const row: QueueRow = { key: j.orderId, jobs: [j] };
      byOrder.set(j.orderId, row);
      rows.push(row);
      continue;
    }
    rows.push({ key: j.id, jobs: [j] });
  }
  return rows;
}

// Unit AC tiap baris (satu baris servis banyak AC = beberapa unit); dipakai cetak QR massal. Job tanpa unit tidak ada QR-nya.
const rowUnitIds = (row: QueueRow) => [...new Set(row.jobs.flatMap((j) => (j.unit ? [j.unit.id] : [])))];
// Sama dengan batas cetak label di backend (GET /unit-labels/data).
const MAX_PRINT_UNITS = 100;

const STATUS_ORDER = ['menunggu_penugasan', 'assigned', 'sedang_dikerjakan', 'menunggu_review', 'selesai', 'dibatalkan'];
const ASSIGNABLE_STATUSES = ['menunggu_penugasan', 'assigned'];
const unitName = (j: TechnicianJob) =>
  j.unit ? [j.unit.brand, j.unit.model].filter(Boolean).join(' ') || 'Unit AC' : `Order ${j.type}`;
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
  const router = useRouter();
  const [showDone, setShowDone] = React.useState(false);
  // Cetak QR massal: tombol "Cetak QR" di samping tombol muat ulang mengaktifkan mode pilih (kotak centang muncul di
  // tiap baris). `picked` = kunci baris yang dicentang; hanya baris yang sedang tampil yang dihitung.
  const [selecting, setSelecting] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

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
    mutationFn: ({ jobId, technicianId, allInOrder }: { jobId: string; technicianId: string; allInOrder?: boolean }) =>
      apiClient.patch(`/technician-jobs/${jobId}/assign`, { technicianId, ...(allInOrder ? { allInOrder: true } : {}) }),
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
  const rows = groupByOrder(filtered);

  const printable = rows.filter((r) => rowUnitIds(r).length > 0);
  const selectedRows = printable.filter((r) => picked.has(r.key));
  const selectedUnitIds = [...new Set(selectedRows.flatMap(rowUnitIds))];
  const allPicked = printable.length > 0 && selectedRows.length === printable.length;
  const tooMany = selectedUnitIds.length > MAX_PRINT_UNITS;
  function togglePicked(key: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }
  function stopSelecting() {
    setSelecting(false);
    setPicked(new Set());
  }
  function printSelected() {
    router.push(`/teknisi/queue/print-labels?units=${encodeURIComponent(selectedUnitIds.join(','))}`);
  }

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
        <div className="flex flex-wrap items-center gap-2">
          {!isTeknisi && selecting && (
            <span className={tooMany ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {selectedRows.length === 0
                ? 'Centang job yang akan dicetak.'
                : tooMany
                  ? `${selectedUnitIds.length} unit - maksimal ${MAX_PRINT_UNITS} label sekali cetak.`
                  : `${selectedRows.length} job dipilih - ${selectedUnitIds.length} unit`}
            </span>
          )}
          {!isTeknisi && selecting && (
            <Button variant="ghost" onClick={stopSelecting}>
              Batal
            </Button>
          )}
          {!isTeknisi &&
            (selecting ? (
              <Button disabled={selectedUnitIds.length === 0 || tooMany} onClick={printSelected}>
                <Printer className="size-4" />
                Cetak QR ({selectedUnitIds.length})
              </Button>
            ) : (
              <Button variant="outline" disabled={printable.length === 0} onClick={() => setSelecting(true)}>
                <Printer className="size-4" />
                Cetak QR
              </Button>
            ))}
          <Button variant="outline" size="icon" aria-label="Muat ulang daftar job" onClick={() => jobsQuery.refetch()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Daftar job: satu panel (pita judul + filter, isi, baris job), seperti section di halaman detail. */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight">Daftar Job</h2>
            {!jobsQuery.isLoading && !jobsQuery.isError && <Badge variant="secondary">{rows.length}</Badge>}
            {!isTeknisi && selecting && printable.length > 0 && (
              <label className="ml-2 flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={allPicked}
                  onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(printable.map((r) => r.key)))}
                  aria-label="Pilih semua job"
                />
                Pilih semua
              </label>
            )}
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
          {rows.map((row) => {
            const job = row.jobs[0];
            const many = row.jobs.length > 1;
            // Satu baris = satu order servis banyak AC: status = tahap paling awal di antara unitnya.
            const rowStatus = row.jobs
              .map((j) => j.status)
              .sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b))[0];
            const assignTarget = row.jobs.find((j) => ASSIGNABLE_STATUSES.includes(j.status));
            // Perlu harga: temuan sudah dikirim ATAU sudah diajukan selesai (teknisi tidak perlu menunggu harga).
            const needsPrice = row.jobs.some(
              (j) =>
                (!!j.findingsSentAt || j.status === 'menunggu_review') &&
                (many ? !j.billingDerived : !j.order?.invoiceId),
            );
            return (
              <li key={row.key} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50">
                {!isTeknisi && selecting && (
                  <Checkbox
                    checked={picked.has(row.key)}
                    disabled={rowUnitIds(row).length === 0}
                    onCheckedChange={() => togglePicked(row.key)}
                    aria-label={`Pilih job ${many ? `${job.member?.name ?? 'order servis'} (${row.jobs.length} unit)` : unitName(job)} untuk cetak QR`}
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    href={`/teknisi/jobs/${job.id}`}
                    className="min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <p className="truncate text-[15px] font-medium">
                      {many ? `${job.member?.name || 'Order servis'} · ${row.jobs.length} unit AC` : unitName(job)}
                    </p>
                    {many ? (
                      <p className="truncate text-xs text-muted-foreground">{row.jobs.map(unitName).join(' • ')}</p>
                    ) : (
                      job.unit &&
                      unitPartsText(job.unit) && (
                        <p className="truncate text-xs text-muted-foreground">{unitPartsText(job.unit)}</p>
                      )
                    )}
                    <p className="truncate text-sm text-muted-foreground">
                      {job.type} • {job.member?.name || '-'}
                      {job.scheduledDate && ` • Jadwal ${formatDate(job.scheduledDate)}`}
                      {isAdmin && ` • ${job.technician?.displayName || 'Belum ditugaskan'}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Masuk {formatDateTime(job.createdAt)}
                    </p>
                    {!isTeknisi && needsPrice && (
                      <p className="truncate text-xs font-medium text-status-warning-foreground dark:text-status-warning">
                        {many ? 'Tentukan harga jasa tiap unit' : 'Tentukan harga jasa'}
                      </p>
                    )}
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    {isAdmin && assignTarget && (
                      <Select
                        value={assignTarget.technician?.id ?? undefined}
                        onValueChange={(technicianId) =>
                          assignMutation.mutate({ jobId: assignTarget.id, technicianId, allInOrder: many })
                        }
                      >
                        <SelectTrigger size="sm" className="w-44">
                          <SelectValue placeholder={many ? 'Tugaskan (semua unit)' : 'Tugaskan teknisi'} />
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
                    <Badge variant={statusBadgeVariant(rowStatus)}>{statusLabel(rowStatus)}</Badge>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
