'use client';

import { unitPartsText, type UnitPartProduct } from '@/components/ac-unit-parts';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarCheck,
  CalendarDays,
  CalendarX,
  Clock,
  Droplets,
  Hammer,
  MapPin,
  Printer,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRound,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime, statusLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/user-avatar';
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
  // Alamat utama member (findAll/queue memakai `include: { member: true }`, jadi semua kolomnya ikut terkirim).
  address?: string | null;
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
  // Titik lokasi kerja job ini bila berbeda dari alamat member (kosong = ikut alamat member).
  workAddress?: string | null;
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
// Unit tanpa tipe (merk/model kosong, mis. unit "QR dulu"): baris info AC memberi tahu, bukan dikosongkan.
const NO_TYPE_TEXT = '(Unit AC belum ada Tipe)';
const hasBrandModel = (j: TechnicianJob) => !!j.unit && [j.unit.brand, j.unit.model].some(Boolean);
// Keterangan tipe satu unit untuk daftar unit servis banyak AC: merk + model, atau Indoor/Outdoor, atau tulisan belum ada tipe.
const unitTypeText = (j: TechnicianJob) =>
  j.unit
    ? [j.unit.brand, j.unit.model].filter(Boolean).join(' ') || unitPartsText(j.unit) || NO_TYPE_TEXT
    : unitName(j);
interface UserRow {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  // "/uploads/avatars/..." (GET /users); kosong = inisial nama.
  avatarPath?: string | null;
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

// ---- Tampilan kartu job: jenis pekerjaan, lokasi, pencarian, dan filter hari ----

// Lencana jenis pekerjaan (warna dari token tema, bukan warna baru).
const TYPE_META: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  perbaikan: { label: 'Perbaikan', icon: Wrench, className: 'border-primary/25 bg-primary/10 text-primary' },
  cuci: { label: 'Cuci AC', icon: Droplets, className: 'border-primary/25 bg-primary/10 text-primary' },
  maintenance: { label: 'Maintenance', icon: SlidersHorizontal, className: 'border bg-muted text-foreground' },
  pemasangan: { label: 'Pemasangan', icon: Hammer, className: 'border bg-secondary text-secondary-foreground' },
};
const typeMeta = (type: string) =>
  TYPE_META[type] ?? { label: type, icon: Wrench, className: 'border bg-muted text-foreground' };

// Lokasi kerja job: titik lokasi kerja bila diisi, kalau tidak alamat utama member.
const jobLocation = (j: TechnicianJob) => j.workAddress?.trim() || j.member?.address?.trim() || '';
const rowLocations = (row: QueueRow) => [...new Set(row.jobs.map(jobLocation).filter(Boolean))];

// Teks yang dicari di kotak pencarian (nama pelanggan, unit, lokasi, catatan, nomor HP, jenis, dan teknisi bagi admin).
function rowSearchText(row: QueueRow, includeTechnician: boolean): string {
  return row.jobs
    .flatMap((j) => [
      j.member?.name,
      j.member?.phone,
      unitName(j),
      j.unit?.roomLocation,
      j.unit?.barcodeValue,
      jobLocation(j),
      j.notes,
      typeMeta(j.type).label,
      includeTechnician ? j.technician?.displayName : undefined,
    ])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

// Tanggal bisnis memakai WIB. Kunci tanggal berbentuk 'YYYY-MM-DD'; aritmetikanya kalender murni lewat UTC.
function wibDateKey(value: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof value === 'string' ? new Date(value) : value);
}
const keyToUtc = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
function addDaysKey(key: string, days: number): string {
  const d = keyToUtc(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Pekan berjalan Senin-Minggu yang memuat tanggal itu.
function weekRange(key: string): [string, string] {
  const start = addDaysKey(key, -((keyToUtc(key).getUTCDay() + 6) % 7));
  return [start, addDaysKey(start, 6)];
}
const shortDay = (key: string) =>
  new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(keyToUtc(key));

// 'all' | 'today' | 'tomorrow' | 'week' | tanggal tertentu (YYYY-MM-DD) dari pemilih tanggal. Yang disaring: jadwal job.
type DayFilter = string;
function matchesDay(job: TechnicianJob, filter: DayFilter, todayKey: string): boolean {
  if (filter === 'all') return true;
  if (!job.scheduledDate) return false;
  const key = wibDateKey(job.scheduledDate);
  if (filter === 'today') return key === todayKey;
  if (filter === 'tomorrow') return key === addDaysKey(todayKey, 1);
  if (filter === 'week') {
    const [start, end] = weekRange(todayKey);
    return key >= start && key <= end;
  }
  return key === filter;
}

export function TeknisiQueueClient({ role }: { role: Role }) {
  const isTeknisi = role === 'teknisi';
  const isAdmin = role === 'admin';
  const queryClient = useQueryClient();
  const router = useRouter();
  const [showDone, setShowDone] = React.useState(false);
  // Pencarian + filter hari (jadwal). Tanggal "hari ini" dikunci saat halaman dibuka (WIB).
  const [query, setQuery] = React.useState('');
  const [dayFilter, setDayFilter] = React.useState<DayFilter>('all');
  const [todayKey] = React.useState(() => wibDateKey(new Date()));
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
  const searchTerm = query.trim().toLowerCase();
  const filtersActive = searchTerm !== '' || dayFilter !== 'all';
  // Penyaringan per BARIS (servis banyak AC tetap utuh): cocok bila salah satu unitnya cocok.
  const rows = groupByOrder(filtered).filter(
    (row) =>
      (!searchTerm || rowSearchText(row, isAdmin).includes(searchTerm)) &&
      row.jobs.some((j) => matchesDay(j, dayFilter, todayKey)),
  );
  function resetFilters() {
    setQuery('');
    setDayFilter('all');
  }

  const dayPills: { key: DayFilter; label: string }[] = [
    { key: 'all', label: 'Semua Hari' },
    { key: 'today', label: `Hari Ini (${shortDay(todayKey)})` },
    { key: 'tomorrow', label: `Besok (${shortDay(addDaysKey(todayKey, 1))})` },
    { key: 'week', label: 'Minggu Ini' },
  ];
  const pickedDate = dayPills.some((p) => p.key === dayFilter) ? '' : dayFilter;

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

      {/* Daftar job: satu panel (pita kontrol berlatar muted, baris dipisah garis tipis), warna dan gaya sama dengan
          tabel sebelumnya. Satu baris = satu job (servis banyak AC = satu baris untuk seluruh unit). */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="grid gap-2.5 border-b bg-muted/60 px-5 py-3">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">Daftar Job</h2>
                {!jobsQuery.isLoading && !jobsQuery.isError && <Badge variant="secondary">{rows.length}</Badge>}
              </div>
              {!isTeknisi && selecting && printable.length > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={allPicked}
                    onCheckedChange={() => setPicked(allPicked ? new Set() : new Set(printable.map((r) => r.key)))}
                    aria-label="Pilih semua job"
                  />
                  Pilih semua
                </label>
              )}
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
            <div className="relative w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari nama pelanggan, unit, lokasi..."
                aria-label="Cari job"
                className="h-8 bg-background pl-9 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 overflow-x-auto p-0.5 text-xs">
              <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                <CalendarDays className="size-3.5 text-primary" />
                Filter Hari:
              </span>
              {dayPills.map((pill) => (
                <Button
                  key={pill.key}
                  type="button"
                  size="sm"
                  variant={dayFilter === pill.key ? 'default' : 'outline'}
                  aria-pressed={dayFilter === pill.key}
                  onClick={() => setDayFilter(pill.key)}
                  className="shrink-0 whitespace-nowrap"
                >
                  {pill.label}
                </Button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
              <span className="text-xs text-muted-foreground">Pilih Tgl:</span>
              <Input
                type="date"
                value={pickedDate}
                onChange={(e) => setDayFilter(e.target.value || 'all')}
                aria-label="Pilih tanggal jadwal"
                className="h-8 w-auto bg-background text-xs"
              />
              {filtersActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={resetFilters}
                >
                  <X className="size-3.5" />
                  Reset
                </Button>
              )}
            </div>
          </div>
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
        {!jobsQuery.isLoading && !jobsQuery.isError && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-muted-foreground">
            {filtersActive && filtered.length > 0 ? (
              <>
                <CalendarX className="size-9" />
                <p className="font-semibold text-foreground">Tidak ada job ditemukan</p>
                <p className="text-xs">Coba sesuaikan tanggal, filter hari, atau kata kunci pencarian.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={resetFilters}>
                  Tampilkan semua job
                </Button>
              </>
            ) : (
              <>
                <Wrench className="size-8" />
                <p className="text-sm">
                  {!isTeknisi && showDone ? 'Belum ada job selesai.' : 'Belum ada job aktif.'}
                </p>
              </>
            )}
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
            const meta = typeMeta(job.type);
            const TypeIcon = meta.icon;
            const customer = job.member?.name || 'Order servis';
            const locations = rowLocations(row);
            const locationText = locations.length
              ? `${locations[0]}${locations.length > 1 ? ` (+${locations.length - 1} lokasi lain)` : ''}`
              : '';
            // Informasi AC: daftar unit (servis banyak AC) atau Indoor/Outdoor (satu unit); unit tanpa tipe diberi tulisan
            // pengisi supaya baris ini tidak kosong dan hanya memuat lokasi.
            const unitsText = many
              ? row.jobs.map(unitTypeText).join(' • ')
              : job.unit
                ? unitPartsText(job.unit) || (hasBrandModel(job) ? '' : NO_TYPE_TEXT)
                : '';
            const note = row.jobs.map((j) => j.notes?.trim()).find(Boolean);
            const scheduled = row.jobs.find((j) => j.scheduledDate)?.scheduledDate;
            const showAssign = isAdmin && !!assignTarget;
            return (
              <li key={row.key} className="px-5 py-3.5 transition-colors hover:bg-muted/50">
                <div className="flex items-start gap-3">
                  {!isTeknisi && selecting && (
                    <Checkbox
                      className="mt-1"
                      checked={picked.has(row.key)}
                      disabled={rowUnitIds(row).length === 0}
                      onCheckedChange={() => togglePicked(row.key)}
                      aria-label={`Pilih job ${many ? `${customer} (${row.jobs.length} unit)` : unitName(job)} untuk cetak QR`}
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-3">
                      <Link
                        href={`/teknisi/jobs/${job.id}`}
                        className="min-w-0 flex-1 space-y-1.5 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <p className="text-[15px] font-semibold leading-snug tracking-tight">
                          {customer} <span className="font-normal text-muted-foreground">·</span>{' '}
                          {many ? `${row.jobs.length} unit AC` : unitName(job)}
                        </p>
                        {/* Informasi AC dan lokasi dalam satu baris (membungkus bila sempit). */}
                        {(unitsText || locationText) && (
                          <div className="flex flex-wrap items-start gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {unitsText && <span>{unitsText}</span>}
                            {locationText && (
                              <span className="inline-flex items-start gap-1.5">
                                <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                <span className="font-medium">{locationText}</span>
                              </span>
                            )}
                          </div>
                        )}
                        {note && <p className="text-xs italic text-muted-foreground">Catatan: {note}</p>}
                      </Link>
                      <div className="flex max-w-full flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
                        {showAssign && (
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
                                  <span className="flex items-center gap-2">
                                    <UserAvatar
                                      user={t}
                                      className="size-5 bg-primary/10 text-[10px] font-semibold text-primary"
                                    />
                                    {t.displayName}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Badge variant={statusBadgeVariant(rowStatus)} className="gap-1.5">
                          <span className="size-1.5 rounded-full bg-current" />
                          {statusLabel(rowStatus)}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold',
                          meta.className,
                        )}
                      >
                        <TypeIcon className="size-3" />
                        {meta.label}
                      </span>
                      {scheduled && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarCheck className="size-3.5 text-primary" />
                          <span>
                            Jadwal <strong className="font-semibold text-foreground">{formatDate(scheduled)}</strong>
                          </span>
                        </span>
                      )}
                      {isAdmin && !showAssign && (
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="size-3.5 text-primary" />
                          <span className="font-medium text-foreground">
                            {job.technician?.displayName || 'Belum ditugaskan'}
                          </span>
                        </span>
                      )}
                      {!isTeknisi && needsPrice && (
                        <span className="rounded-md bg-status-warning/15 px-2 py-0.5 text-[11px] font-semibold text-status-warning-foreground dark:text-status-warning">
                          {many ? 'Tentukan harga jasa tiap unit' : 'Tentukan harga jasa'}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] sm:ml-auto">
                        <Clock className="size-3.5" />
                        Masuk {formatDateTime(job.createdAt)}
                      </span>
                    </div>
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
