'use client';

import { UnitPartsList, hasUnitParts, type UnitPartProduct } from '@/components/ac-unit-parts';
import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Minus, Plus, ScanLine, Trash2, X } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
import { formatStock } from '@/lib/sparepart-mode';
import type { Role } from '@/lib/session';
import { cn } from '@/lib/utils';
import { statusBadgeVariant } from '../../queue/queue-client';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { BarcodeQr } from '@/components/barcode-qr';
import { ReminderScheduleFields, intervalError } from '@/components/reminder-schedule-fields';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ProblemCategoryRef {
  id: string;
  name: string;
}
interface JobFindingPhoto {
  id: string;
  kind: 'sebelum' | 'sesudah';
  path: string;
  createdAt: string;
}
interface JobFinding {
  id: string;
  title: string;
  note: string | null;
  origin: string; // 'komplain_awal' | 'ditambah_teknisi'
  category: ProblemCategoryRef;
  photos: JobFindingPhoto[];
  createdAt: string;
}
interface MaterialRequestItemRow {
  id: string;
  name: string;
  unit: string | null;
  qty: string;
  // Jumlah yang dilaporkan terpakai; null = belum dilaporkan / data lama (anggap penuh).
  qtyUsed: string | null;
  unitPrice: string;
  lineTotal: string;
}
interface MaterialRequestRow {
  id: string;
  status: string;
  total: string;
  note: string | null;
  decisionNote: string | null;
  createdAt: string;
  usedAt: string | null;
  usedNote: string | null;
  items: MaterialRequestItemRow[];
}
interface SparepartOption {
  id: string;
  name: string;
  unit: string;
  sellPrice: string;
  stock: string;
  // Qty yang sudah disetujui admin buat teknisi lain tapi belum dipakai (stok fisik
  // belum terpotong). Yang dihitung "stok" di form ini = stock - reserved.
  reserved?: number;
  // Dipakai formatStock buat tampilan "roll + meter" (ikut dikirim GET /spareparts).
  trackingMode?: string | null;
  packUnit?: string | null;
  packSize?: string | null;
}
interface JobDetail {
  id: string;
  type: string;
  status: string;
  scheduledDate: string | null;
  notes: string | null;
  reviewNote: string | null;
  startedAt: string | null;
  completedAt: string | null;
  member: { id: string; name: string; phone: string | null; address: string | null } | null;
  unit: {
    id: string;
    brand: string | null;
    model: string | null;
    roomLocation: string | null;
    barcodeValue: string;
    indoorProduct?: UnitPartProduct | null;
    outdoorProduct?: UnitPartProduct | null;
    serviceIntervalDays?: number | null;
    reminderEnabled?: boolean;
  } | null;
  technician: { id: string; displayName: string; email: string } | null;
  findings: JobFinding[];
  materialRequests: MaterialRequestRow[];
  // ServiceOrder pembungkus job ini — SELALU ada (baik lewat instalasi POS
  // maupun servis mandiri, lihat komentar TechnicianJobsService.createForOrder),
  // dipakai buat link "Cetak Label" ke halaman print-labels yang sudah ada
  // (per service order, bukan per job — 1 order bisa punya banyak unit).
  order: { id: string } | null;
}
interface UserRow {
  id: string;
  displayName: string;
  role: Role;
  active: boolean;
}

// Hook kecil buat aksi PATCH status job (start/submit-for-review/
// approve-complete/send-back/cancel) — semuanya sama polanya (PATCH ke
// :id/<path>, toast, invalidate query job ini + kedua daftar job), cuma
// beda path/body/pesan. Didefinisikan di level modul (bukan di dalam
// JobDetailClient) biar jelas ini hook biasa, dipanggil tanpa syarat di
// urutan yang sama tiap render (rules of hooks).
function useJobAction<TBody = void>(jobId: string, path: string, successMsg: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body?: TBody) => apiClient.patch(`/technician-jobs/${jobId}${path}`, body ?? {}),
    onSuccess: () => {
      toast.success(successMsg);
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', 'queue'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Aksi gagal.');
    },
  });
}

export function JobDetailClient({ jobId, role }: { jobId: string; role: Role }) {
  const queryClient = useQueryClient();
  const isAdmin = role === 'admin';
  const isTeknisi = role === 'teknisi';

  const jobQuery = useQuery({
    queryKey: ['technician-jobs', jobId],
    queryFn: () => apiClient.get<JobDetail>(`/technician-jobs/${jobId}`),
  });

  const techniciansQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<UserRow[]>('/users'),
    enabled: isAdmin,
  });
  const technicians = (techniciansQuery.data ?? []).filter(
    (u) => u.role === 'teknisi' && u.active,
  );

  const [scanInput, setScanInput] = React.useState('');
  const [sendBackNote, setSendBackNote] = React.useState('');

  const assignMutation = useMutation({
    mutationFn: (technicianId: string) =>
      apiClient.patch(`/technician-jobs/${jobId}/assign`, { technicianId }),
    onSuccess: () => {
      toast.success('Teknisi ditugaskan.');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', 'all'] });
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', 'queue'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menugaskan teknisi.');
    },
  });
  const startMutation = useJobAction<{ scannedBarcode: string }>(jobId, '/start', 'Job dimulai.');
  const submitForReviewMutation = useJobAction(jobId, '/submit-for-review', 'Diajukan untuk review.');
  const approveMutation = useJobAction<{ reminderEnabled: boolean; serviceIntervalDays?: number }>(
    jobId,
    '/approve-complete',
    'Job disetujui selesai.',
  );
  // Pengingat servis per unit AC (2026-09-30) — diisi admin saat menyetujui
  // job cuci/maintenance/pemasangan. Null = belum disentuh (pakai siklus unit).
  const [remindOn, setRemindOn] = React.useState(true);
  const [remindDays, setRemindDays] = React.useState<string | null>(null);
  const sendBackMutation = useJobAction<{ note: string }>(
    jobId,
    '/send-back',
    'Job dikembalikan ke teknisi.',
  );
  const cancelMutation = useJobAction(jobId, '/cancel', 'Job dibatalkan.');

  if (jobQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat job...</p>;
  }
  if (jobQuery.isError || !jobQuery.data) {
    return <p className="text-sm text-destructive">Gagal memuat job. Mungkin sudah dihapus.</p>;
  }
  const job = jobQuery.data;
  // Samain persis sama gate backend di addFinding/addFindingPhoto
  // (technician-jobs.service.ts): cuma admin/teknisi, cuma selama job
  // 'assigned'/'sedang_dikerjakan'. Kasir tetap bisa lihat (GET findOne
  // dia boleh), tapi kontrol tambah-temuan/upload-foto disembunyikan biar
  // gak nabrak 403 (POST findings/photos @Roles('admin','teknisi') doang).
  const canEditFindings =
    (isAdmin || isTeknisi) &&
    ['assigned', 'sedang_dikerjakan'].includes(job.status);
  // Konsep "Diagnosa / Catatan Pengerjaan" niru app mobile teknisi (lama) —
  // field catatan bebas yang bisa diisi teknisi selama job aktif, dipisah
  // dari checklist temuan terstruktur. Backend-nya (PATCH :id/notes) masih
  // ada & belum kepakai sama sekali di web sebelum ini. Digatekan ke teknisi
  // aja (bukan admin) biar cocok sama peran field ini di konsep aslinya —
  // "catatan kerja milik teknisi", admin tetap liat versi read-only-nya.
  const notesEditable = isTeknisi && ['assigned', 'sedang_dikerjakan'].includes(job.status);
  // Sama kayak gate start() di backend — minimal 1 foto 'sebelum' di
  // salah satu temuan job ini. Dihitung dari data yang udah ke-fetch, jadi
  // gak perlu request tambahan.
  // Hanya cuci/maintenance/pemasangan yang mengatur ulang jadwal servis
  // berikutnya (sinkron sama SCHEDULING_JOB_TYPES di backend).
  const needsSchedule =
    !!job.unit && ['cuci', 'maintenance', 'pemasangan'].includes(job.type);
  const remindDaysValue =
    remindDays ?? (job.unit?.serviceIntervalDays != null ? String(job.unit.serviceIntervalDays) : '');
  const hasBeforePhoto = job.findings.some((f) => f.photos.some((p) => p.kind === 'sebelum'));

  // Niru gate submitForReview() di backend biar teknisi gak nunggu round-trip
  // 400 buat tau apa yang kurang: minimal 1 temuan, dan SETIAP temuan minimal
  // 1 foto 'sebelum' + 1 foto 'sesudah'. Gate material-request (pending/
  // approved-belum-used) sengaja gak dicek di sini — belum ada UI-nya di web,
  // tetap ditangani backend lewat pesan error kalau kejadian.
  const findingsMissingPhotos = job.findings.filter(
    (f) =>
      !f.photos.some((p) => p.kind === 'sebelum') ||
      !f.photos.some((p) => p.kind === 'sesudah'),
  );
  const submitForReviewReady = job.findings.length > 0 && findingsMissingPhotos.length === 0;
  const submitForReviewBlockedReason =
    job.findings.length === 0
      ? 'Tambah minimal 1 temuan dulu sebelum bisa mengajukan selesai.'
      : `${findingsMissingPhotos.length} temuan belum lengkap foto sebelum/sesudahnya.`;

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/teknisi/queue"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Kembali
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {job.member?.name || (job.unit ? [job.unit.brand, job.unit.model].filter(Boolean).join(' ') || 'Unit AC' : 'Job servis')}
          </h1>
          <Badge variant={statusBadgeVariant(job.status)}>{statusLabel(job.status)}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {jobTypeLabel(job.type)}
          {job.unit
            ? ` · ${[job.unit.brand, job.unit.model].filter(Boolean).join(' ') || 'Unit AC'}${job.unit.roomLocation ? ` (${job.unit.roomLocation})` : ''}`
            : ''}
        </p>
        <div className="mt-3">
          <JobSteps status={job.status} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-6">
          <Card className={cn(isAdmin && job.status === 'menunggu_review' && 'order-last')}>
            <CardHeader>
              <CardTitle className="text-base">Detail</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <DetailRow
                label="Pelanggan"
                value={job.member?.name || '-'}
                // GET /members/:id di backend admin+kasir doang (teknisi
                // gak boleh buka riwayat pembelian/HPP member) — link cuma
                // ditampilin buat admin, teknisi tetap lihat teks biasa
                // biar gak nabrak 403 kalau diklik.
                valueNode={
                  isAdmin && job.member ? (
                    <Link href={`/members/${job.member.id}`} className="font-medium hover:underline">
                      {job.member.name}
                    </Link>
                  ) : undefined
                }
              />
              <DetailRow label="Nomor HP" value={job.member?.phone || '-'} />
              <DetailRow label="Alamat" value={job.member?.address || '-'} />
              <DetailRow
                label="Unit AC"
                value={
                  job.unit
                    ? `${[job.unit.brand, job.unit.model].filter(Boolean).join(' ') || '-'} - ${job.unit.roomLocation || 'lokasi belum diisi'}`
                    : '-'
                }
              />
              {job.unit && hasUnitParts(job.unit) && (
                <DetailRow
                  label="Unit dalam paket"
                  value=""
                  valueNode={<UnitPartsList unit={job.unit} showSku />}
                />
              )}
              {job.unit && (
                // Preview QR unit ini — biar bisa dicek/dilihat lagi tanpa harus
                // buka halaman detail unit terpisah. Link cetak cuma admin/kasir
                // (GET /service-orders/:id 403 untuk teknisi).
                <div className="flex items-center gap-3 rounded-md border bg-white p-2 text-neutral-900">
                  <BarcodeQr value={job.unit.barcodeValue} size={64} />
                  <div className="min-w-0 text-xs text-neutral-600">
                    <p className="font-mono text-sm text-neutral-900">{job.unit.barcodeValue}</p>
                    <p>QR label unit AC ini</p>
                    {job.order && !isTeknisi && (
                      <Link
                        href={`/service-orders/${job.order.id}/print-labels`}
                        className="mt-1 inline-block font-medium text-neutral-900 hover:underline"
                      >
                        Cetak label unit
                      </Link>
                    )}
                  </div>
                </div>
              )}
              <DetailRow label="Teknisi" value={job.technician?.displayName || 'Belum ditugaskan'} />
              {/* Kalau lagi bisa diedit (lihat NotesEditor di bawah), jangan
                  dobel ditampilin di sini juga - biar gak ada 2 sumber
                  kebenaran yang keliatan beda pas belum di-save. */}
              {job.notes && !notesEditable && <DetailRow label="Catatan" value={job.notes} />}
              {job.startedAt && (
                <DetailRow label="Dimulai" value={formatDateTime(job.startedAt)} />
              )}
              {job.completedAt && (
                <DetailRow label="Selesai" value={formatDateTime(job.completedAt)} />
              )}
              {job.reviewNote && (
                <DetailRow label="Catatan Pengembalian" value={job.reviewNote} />
              )}
            </CardContent>
          </Card>

          {notesEditable && <NotesEditor key={job.id} jobId={job.id} initialNotes={job.notes} />}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Temuan &amp; Foto Sebelum/Sesudah</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {job.findings.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada temuan dicatat.</p>
              )}
              {job.findings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  jobId={job.id}
                  finding={finding}
                  canEdit={canEditFindings}
                />
              ))}
              {canEditFindings && <AddFindingForm jobId={job.id} />}
            </CardContent>
          </Card>

          {/* Pengajuan sparepart tambahan — backend (material-requests
              module) udah lama ada & dipakai app mobile teknisi lama,
              sebelumnya belum ada UI-nya sama sekali di web (cuma teks
              placeholder). Admin approve/reject/revisi dari halaman
              terpisah "Pengajuan Masuk" (/material-requests), di sini
              teknisi cuma ajukan + lihat status + tandai terpakai. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pengajuan Sparepart Tambahan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {job.materialRequests.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada pengajuan.</p>
              )}
              {job.materialRequests.length > 0 && (
                <MaterialRequestsList
                  jobId={job.id}
                  requests={job.materialRequests}
                  // GET /technician-jobs/:id sendiri udah nge-gate: teknisi
                  // cuma bisa buka job MILIKNYA (403 kalau bukan) — jadi
                  // kalau halaman ini kebuka buat isTeknisi, job ini pasti
                  // memang job dia, gak perlu bandingin id lagi di sini.
                  canMarkUsed={isAdmin || isTeknisi}
                />
              )}
              {canEditFindings && <AddMaterialRequestForm jobId={job.id} />}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle className="text-base">Aksi</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {isAdmin && ['menunggu_penugasan', 'assigned'].includes(job.status) && (
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">
                  {job.status === 'assigned' ? 'Ganti Teknisi' : 'Tugaskan Teknisi'}
                </label>
                <Select
                  value={job.technician?.id ?? undefined}
                  onValueChange={(technicianId) => assignMutation.mutate(technicianId)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih teknisi" />
                  </SelectTrigger>
                  <SelectContent>
                    {technicians.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isTeknisi && job.status === 'assigned' && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Mulai Job (scan barcode unit)</label>
                {/* Balikin gate lama (konsep app mobile teknisi): foto
                    SEBELUM wajib ada dulu, sebelum job boleh dimulai - sudah
                    ditegakkan juga di backend (start()), ini cuma versi
                    proaktifnya biar teknisi gak nunggu klik-dulu-baru-tau. */}
                {!hasBeforePhoto && (
                  <p className="rounded-md border border-status-warning/35 bg-status-warning/10 px-3 py-2 text-xs">
                    Unggah foto <span className="font-medium">Sebelum</span> dulu (tambah/lihat di
                    kartu &ldquo;Temuan &amp; Foto Sebelum/Sesudah&rdquo; di bawah) sebelum bisa
                    memulai pekerjaan.
                  </p>
                )}
                <BarcodeScanner onDetect={(code) => setScanInput(code)} manualPlaceholder="Barcode unit" />
                {scanInput && (
                  <p className="text-xs text-muted-foreground">
                    Kode terbaca: <span className="font-medium text-foreground">{scanInput}</span>
                  </p>
                )}
                {job.unit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-self-start"
                    onClick={() => setScanInput(job.unit!.barcodeValue)}
                  >
                    <ScanLine className="size-4" />
                    Isi otomatis dari data unit ini
                  </Button>
                )}
                <Button
                  disabled={!scanInput.trim() || !hasBeforePhoto || startMutation.isPending}
                  onClick={() => startMutation.mutate({ scannedBarcode: scanInput.trim() })}
                >
                  {startMutation.isPending ? 'Memproses...' : 'Mulai Job'}
                </Button>
              </div>
            )}

            {isTeknisi && job.status === 'sedang_dikerjakan' && (
              <div className="grid gap-1.5">
                <Button
                  disabled={!submitForReviewReady || submitForReviewMutation.isPending}
                  onClick={() => submitForReviewMutation.mutate()}
                >
                  {submitForReviewMutation.isPending ? 'Memproses...' : 'Ajukan Selesai'}
                </Button>
                {/* Validasi sisi klien niru persis gate submitForReview() di
                    backend (technician-jobs.service.ts) - minimal 1 temuan,
                    dan SETIAP temuan minimal 1 foto sebelum + 1 sesudah. Gate
                    pengajuan-material yang belum dicek di sini (belum
                    diporting ke web) tetap ditangani backend & muncul lewat
                    toast error kalau ada yang lolos sampai submit. */}
                {!submitForReviewReady && (
                  <p className="text-xs text-muted-foreground">{submitForReviewBlockedReason}</p>
                )}
              </div>
            )}

            {isAdmin && job.status === 'menunggu_review' && (
              <div className="grid gap-3">
                {needsSchedule && (
                  <ReminderScheduleFields
                    enabled={remindOn}
                    onEnabledChange={setRemindOn}
                    days={remindDaysValue}
                    onDaysChange={setRemindDays}
                  />
                )}
                <Button
                  disabled={approveMutation.isPending || (needsSchedule && remindOn && !!intervalError(remindDaysValue))}
                  onClick={() =>
                    approveMutation.mutate(
                      needsSchedule
                        ? {
                            reminderEnabled: remindOn,
                            ...(remindOn ? { serviceIntervalDays: Number(remindDaysValue) } : {}),
                          }
                        : undefined,
                    )
                  }
                >
                  {approveMutation.isPending ? 'Memproses...' : 'Setujui Selesai'}
                </Button>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Kembalikan ke Teknisi</label>
                  <Textarea
                    rows={2}
                    placeholder="Catatan - apa yang kurang?"
                    value={sendBackNote}
                    onChange={(e) => setSendBackNote(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!sendBackNote.trim() || sendBackMutation.isPending}
                    onClick={() => sendBackMutation.mutate({ note: sendBackNote.trim() })}
                  >
                    {sendBackMutation.isPending ? 'Memproses...' : 'Kembalikan'}
                  </Button>
                </div>
              </div>
            )}

            {isAdmin && !['selesai', 'dibatalkan'].includes(job.status) && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  if (confirm('Batalkan job ini?')) cancelMutation.mutate();
                }}
              >
                {cancelMutation.isPending ? 'Memproses...' : 'Batalkan Job'}
              </Button>
            )}

            {['selesai', 'dibatalkan'].includes(job.status) && (
              <p className="text-sm text-muted-foreground">Job ini sudah final, tidak ada aksi lagi.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const JOB_TYPE_LABEL: Record<string, string> = {
  pemasangan: 'Pemasangan',
  cuci: 'Cuci AC',
  maintenance: 'Maintenance',
  service: 'Servis',
  perbaikan: 'Perbaikan',
  bongkar: 'Bongkar',
  bongkar_pasang: 'Bongkar pasang',
};
function jobTypeLabel(type: string): string {
  return JOB_TYPE_LABEL[type] ?? type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
}

const JOB_STEPS: [string, string][] = [
  ['assigned', 'Ditugaskan'],
  ['sedang_dikerjakan', 'Dikerjakan'],
  ['menunggu_review', 'Review admin'],
  ['selesai', 'Selesai'],
];

/** Posisi job di alurnya: ditugaskan, dikerjakan, review admin, selesai. */
function JobSteps({ status }: { status: string }) {
  if (status === 'dibatalkan') return null;
  const idx = status === 'menunggu_penugasan' ? -1 : JOB_STEPS.findIndex(([k]) => k === status);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Tahap job">
      {JOB_STEPS.map(([key, label], i) => (
        <li key={key} className="flex items-center gap-2" aria-current={i === idx ? 'step' : undefined}>
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full border text-[10px]',
              i < idx && 'border-primary bg-primary text-primary-foreground',
              i === idx && 'border-primary font-semibold text-primary ring-2 ring-primary/20',
              i > idx && 'text-muted-foreground',
            )}
          >
            {i < idx ? '✓' : i + 1}
          </span>
          <span className={cn(i === idx ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
          {i < JOB_STEPS.length - 1 && <span className="h-px w-5 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

/** Thumbnail foto temuan (klik = buka ukuran penuh). Bila file hilang tampil keterangan, bukan gambar rusak. */
function PhotoThumb({ src, label }: { src: string; label: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <div className="flex size-24 items-center justify-center rounded border border-dashed p-1 text-center text-[10px] text-muted-foreground">
        Foto tidak ditemukan
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" title={`Buka foto ${label.toLowerCase()} ukuran penuh`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Foto ${label.toLowerCase()}`}
        onError={() => setFailed(true)}
        className="size-24 rounded border object-cover transition hover:ring-2 hover:ring-primary/40"
      />
    </a>
  );
}

function DetailRow({
  label,
  value,
  valueNode,
}: {
  label: string;
  value: string;
  valueNode?: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{valueNode ?? value}</span>
    </div>
  );
}

/** Field catatan kerja bebas teknisi (beda dari checklist temuan terstruktur
 * di bawah) — konsep diambil dari app mobile teknisi lama (`_DiagnosisField`
 * di job_detail_screen.dart), yang endpoint backend-nya (`PATCH :id/notes`)
 * ternyata masih hidup tapi belum ada UI web-nya sama sekali. `initialNotes`
 * cuma dipakai buat nilai awal (state lokal, gak disinkron ulang tiap
 * refetch) — mutasi sukses tetap invalidate query supaya card "Detail" di
 * atas ikutan update begitu berpindah keluar dari mode edit. */
function NotesEditor({
  jobId,
  initialNotes,
}: {
  jobId: string;
  initialNotes: string | null;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = React.useState(initialNotes ?? '');

  const saveMutation = useMutation({
    mutationFn: () => apiClient.patch(`/technician-jobs/${jobId}/notes`, { notes: notes.trim() }),
    onSuccess: () => {
      toast.success('Catatan disimpan.');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan catatan.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Diagnosa / Catatan Pengerjaan</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Textarea
          rows={3}
          placeholder="Tuliskan hasil pengecekan atau tindakan..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          className="justify-self-start"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Menyimpan...' : 'Simpan Catatan'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Temuan (JobFinding) + foto sebelum/sesudah — Siklus 5 revisi, sebelumnya
// cuma bisa lewat app mobile teknisi (yang lama, gak pernah punya UI ini
// juga), sekarang diporting ke web. Satu job bisa punya banyak temuan;
// masing-masing temuan punya foto 'sebelum' & 'sesudah' sendiri-sendiri
// (bukan foto level-job) — lihat JobFinding/JobFindingPhoto di schema.prisma.

/** Satu kartu temuan: judul+catatan+badge asal, plus 2 grup foto
 * (Sebelum/Sesudah). Upload dimatikan (canEdit=false) kalau job udah gak
 * aktif lagi atau role gak berhak nambah temuan (kasir). */
function FindingCard({
  jobId,
  finding,
  canEdit,
}: {
  jobId: string;
  finding: JobFinding;
  canEdit: boolean;
}) {
  const before = finding.photos.filter((p) => p.kind === 'sebelum');
  const after = finding.photos.filter((p) => p.kind === 'sesudah');
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{finding.title}</p>
          {finding.note && (
            <p className="mt-0.5 text-xs text-muted-foreground">{finding.note}</p>
          )}
        </div>
        <Badge variant={finding.origin === 'komplain_awal' ? 'secondary' : 'outline'}>
          {finding.origin === 'komplain_awal' ? 'Keluhan Awal' : 'Ditambah Teknisi'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FindingPhotoGroup
          label="Sebelum"
          photos={before}
          jobId={jobId}
          findingId={finding.id}
          kind="sebelum"
          canEdit={canEdit}
        />
        <FindingPhotoGroup
          label="Sesudah"
          photos={after}
          jobId={jobId}
          findingId={finding.id}
          kind="sesudah"
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}

function FindingPhotoGroup({
  label,
  photos,
  jobId,
  findingId,
  kind,
  canEdit,
}: {
  label: string;
  photos: JobFindingPhoto[];
  jobId: string;
  findingId: string;
  kind: 'sebelum' | 'sesudah';
  canEdit: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {label} ({photos.length})
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {photos.map((p) => (
          // Foto lewat proxy same-origin (/api/proxy/uploads/...), tidak perlu BACKEND_URL publik.
          <PhotoThumb key={p.id} src={`/api/proxy${p.path}`} label={label} />
        ))}
        {canEdit && (
          <FindingPhotoUploadButton jobId={jobId} findingId={findingId} kind={kind} />
        )}
      </div>
    </div>
  );
}

/** Input file TERSEMBUNYI dipicu tombol biasa — SENGAJA tanpa atribut
 * `capture`, biar gak langsung maksa buka kamera device (permintaan
 * eksplisit: teknisi harus bisa pilih dari galeri/file yang udah ada, bukan
 * cuma jepret baru). `multiple` diizinkan; tiap file di-POST satu-satu
 * (endpoint backend cuma nerima 1 file per request). */
function FindingPhotoUploadButton({
  jobId,
  findingId,
  kind,
}: {
  jobId: string;
  findingId: string;
  kind: 'sebelum' | 'sesudah';
}) {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let failed = 0;
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append('photo', file);
        formData.append('kind', kind);
        await apiClient.post(`/technician-jobs/${jobId}/findings/${findingId}/photos`, formData);
      } catch (err) {
        failed += 1;
        toast.error(err instanceof ApiError ? err.message : `Gagal upload ${file.name}.`);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
    if (failed === 0 && files.length > 0) toast.success('Foto diunggah.');
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-14 w-14 shrink-0 flex-col gap-0.5 text-xs"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? '...' : '+ Foto'}
      </Button>
    </>
  );
}

interface CategorySearchResult {
  id: string;
  name: string;
}

/** Satu calon temuan (chip) — id terisi kalau dipilih dari saran kategori,
 * kosong kalau ketikan baru (kategori dibuat otomatis di backend). */
interface PendingFinding {
  id?: string;
  name: string;
}

/** Form nambah temuan — satu kolom ketik; koma / Enter memecahnya jadi temuan
 * terpisah (chip), tiap chip jadi satu temuan sendiri (satu temuan = satu
 * kategori, foto sebelum/sesudah menempel per temuan). Saran kategori existing
 * muncul untuk kata yang sedang diketik; catatan dipakai bersama semua chip. */
function AddFindingForm({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState('');
  const [draftDebounced, setDraftDebounced] = React.useState('');
  const [pending, setPending] = React.useState<PendingFinding[]>([]);
  const [note, setNote] = React.useState('');
  // Daftar saran bisa ditutup manual (tombol X) kalau menutupi isian di bawahnya;
  // muncul lagi begitu teks diubah.
  const [listClosed, setListClosed] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDraftDebounced(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);

  const categoryQuery = useQuery({
    queryKey: ['problem-categories', draftDebounced],
    queryFn: () =>
      apiClient.get<CategorySearchResult[]>(
        `/technician-jobs/categories/search?q=${encodeURIComponent(draftDebounced)}`,
      ),
    enabled: draftDebounced.length > 0,
  });

  function addPending(items: PendingFinding[]) {
    setPending((prev) => {
      const next = [...prev];
      for (const it of items) {
        const name = it.name.trim();
        if (!name) continue;
        if (next.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
        next.push({ id: it.id, name });
      }
      return next;
    });
  }

  function onDraftChange(value: string) {
    setListClosed(false);
    if (!value.includes(',')) {
      setDraft(value);
      return;
    }
    // Koma (termasuk hasil paste "A, B, C"): semua bagian sebelum koma terakhir jadi chip.
    const parts = value.split(',');
    const rest = parts.pop() ?? '';
    addPending(parts.map((name) => ({ name })));
    setDraft(rest.replace(/^\s+/, ''));
  }

  function commitDraft() {
    if (!draft.trim()) return;
    addPending([{ name: draft }]);
    setDraft('');
    setListClosed(false);
  }

  const addFindingMutation = useMutation({
    mutationFn: async (items: PendingFinding[]) => {
      const failed: PendingFinding[] = [];
      let firstError: unknown = null;
      // Berurutan supaya urutan temuan di job sesuai urutan ketikan.
      for (const it of items) {
        try {
          await apiClient.post(`/technician-jobs/${jobId}/findings`, {
            categoryId: it.id,
            categoryName: it.id ? undefined : it.name,
            note: note.trim() || undefined,
          });
        } catch (err) {
          failed.push(it);
          firstError ??= err;
        }
      }
      return { failed, firstError, total: items.length };
    },
    onSuccess: ({ failed, firstError, total }) => {
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      setPending(failed);
      if (failed.length === 0) {
        toast.success(total > 1 ? `${total} temuan ditambahkan.` : 'Temuan ditambahkan.');
        setNote('');
        return;
      }
      const msg = firstError instanceof ApiError ? firstError.message : 'Gagal menambah temuan.';
      toast.error(
        total === failed.length
          ? msg
          : `${total - failed.length} temuan masuk, ${failed.length} gagal (${msg}). Yang gagal masih ada di daftar - coba lagi.`,
      );
    },
  });

  function submit() {
    const items = [...pending];
    const d = draft.trim();
    if (d && !items.some((p) => p.name.toLowerCase() === d.toLowerCase())) {
      items.push({ name: d });
    }
    if (items.length === 0) {
      toast.error('Isi atau pilih kategori temuan dulu.');
      return;
    }
    setDraft('');
    addFindingMutation.mutate(items);
  }

  const count = pending.length + (draft.trim() ? 1 : 0);

  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <label className="text-sm font-medium">Tambah Temuan</label>
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pending.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1 rounded-full border bg-accent py-1 pr-1 pl-3 text-sm"
            >
              {p.name}
              <button
                type="button"
                aria-label={`Hapus ${p.name}`}
                onClick={() => setPending((prev) => prev.filter((x) => x.name !== p.name))}
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          placeholder={
            pending.length > 0
              ? 'Temuan berikutnya...'
              : 'Cari kategori, atau ketik baru - mis. AC bocor'
          }
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            } else if (e.key === 'Backspace' && !draft && pending.length > 0) {
              setPending((prev) => prev.slice(0, -1));
            }
          }}
        />
        {draft.trim() && !listClosed && (
          <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
            <button
              type="button"
              aria-label="Tutup daftar saran"
              onClick={() => setListClosed(true)}
              className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            {categoryQuery.isLoading && (
              <p className="p-2 text-sm text-muted-foreground">Mencari...</p>
            )}
            {categoryQuery.data?.length === 0 && (
              <p className="p-2 pr-9 text-sm text-muted-foreground">
                Gak ketemu - tekan Enter atau koma buat bikin kategori baru &ldquo;{draft.trim()}
                &rdquo;.
              </p>
            )}
            {categoryQuery.data?.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  addPending([{ id: c.id, name: c.name }]);
                  setDraft('');
                }}
                className="block w-full px-3 py-2 pr-9 text-left text-sm hover:bg-accent"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Lebih dari satu temuan? Pisahkan dengan koma atau Enter - tiap temuan punya foto sendiri.
      </p>
      <Textarea
        rows={2}
        placeholder="Catatan (opsional, berlaku untuk semua temuan di atas)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        type="button"
        size="sm"
        className="justify-self-start"
        disabled={addFindingMutation.isPending}
        onClick={submit}
      >
        {addFindingMutation.isPending
          ? 'Menyimpan...'
          : count > 1
            ? `Tambah ${count} Temuan`
            : 'Tambah Temuan'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pengajuan Sparepart Tambahan — backend (material-requests module) udah
// lama ada & dipakai app mobile teknisi lama, sebelumnya belum ada UI-nya
// sama sekali di web. Approve/reject/revisi dari admin dilakukan di halaman
// terpisah "Pengajuan Masuk" (/material-requests) — di sini teknisi cuma
// ajukan baru + lihat status pengajuan job ini + tandai terpakai.

function materialRequestStatusVariant(status: string): 'success' | 'warning' | 'secondary' {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'secondary';
  return 'warning';
}
function materialRequestStatusLabel(status: string): string {
  if (status === 'approved') return 'Disetujui';
  if (status === 'rejected') return 'Ditolak';
  return 'Pending';
}

/** Daftar pengajuan sparepart buat job ini — read-only (approve/reject/
 * revisi cuma dari halaman admin "Pengajuan Masuk"), kecuali tombol
 * "Tandai Terpakai" yang emang tindakan teknisi/admin di lapangan: teknisi
 * melaporkan jumlah yang BENAR-BENAR terpakai per item. */
function MaterialRequestsList({
  jobId,
  requests,
  canMarkUsed,
}: {
  jobId: string;
  requests: MaterialRequestRow[];
  canMarkUsed: boolean;
}) {
  const [reporting, setReporting] = React.useState<MaterialRequestRow | null>(null);

  return (
    <div className="grid gap-2">
      {requests.map((r) => (
        <div key={r.id} className="grid gap-1.5 rounded-md border p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{r.items.map((it) => it.name).join(', ')}</p>
            <Badge variant={materialRequestStatusVariant(r.status)}>
              {materialRequestStatusLabel(r.status)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(r.createdAt)} • {formatRupiah(r.total)}
          </p>
          {r.note && <p className="text-xs text-muted-foreground">Catatan: {r.note}</p>}
          {r.decisionNote && (
            <p className="text-xs text-muted-foreground">Catatan admin: {r.decisionNote}</p>
          )}
          {r.status === 'approved' && !r.usedAt && (
            <p className="text-xs text-muted-foreground">
              Stok sudah dipesan untuk job ini. Setelah dipakai, laporkan jumlah yang terpakai.
            </p>
          )}
          {r.status === 'approved' && !r.usedAt && canMarkUsed && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={() => setReporting(r)}
            >
              Tandai Terpakai
            </Button>
          )}
          {r.status === 'approved' && r.usedAt && (
            <div className="grid gap-0.5">
              <p className="text-xs text-status-success">
                Sudah dipakai - {formatDateTime(r.usedAt)}
              </p>
              {r.items.map((it) => (
                <p key={it.id} className="text-xs text-muted-foreground">
                  {it.name}: terpakai {it.qtyUsed ?? it.qty} dari {it.qty} {it.unit ?? ''}
                </p>
              ))}
              {r.usedNote && <p className="text-xs text-muted-foreground">Catatan: {r.usedNote}</p>}
            </div>
          )}
        </div>
      ))}
      {reporting && (
        <MarkUsedDialog jobId={jobId} request={reporting} onClose={() => setReporting(null)} />
      )}
    </div>
  );
}

/** Dialog lapor pemakaian: tiap item diisi jumlah terpakai (default = jumlah
 * disetujui, boleh 0..disetujui). Stok dipotong sesuai yang terpakai; sisanya
 * kembali jadi stok tersedia dan tagihan pelanggan turun sebesar selisihnya. */
function MarkUsedDialog({
  jobId,
  request,
  onClose,
}: {
  jobId: string;
  request: MaterialRequestRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [used, setUsed] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(request.items.map((it) => [it.id, String(Number(it.qty))])),
  );
  const [note, setNote] = React.useState('');

  const rows = request.items.map((it) => {
    const approved = Number(it.qty);
    const value = used[it.id] ?? '';
    const n = Number(value);
    const invalid = value.trim() === '' || !Number.isFinite(n) || n < 0 || n > approved;
    return { it, approved, n, invalid };
  });
  const anyInvalid = rows.some((r) => r.invalid);
  const refund = rows.reduce(
    (sum, r) =>
      r.invalid ? sum : sum + (Number(r.it.lineTotal) - Math.round(r.n * Number(r.it.unitPrice))),
    0,
  );

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/material-requests/${request.id}/mark-used`, {
        items: rows.map((r) => ({ itemId: r.it.id, qtyUsed: r.n })),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Pemakaian dilaporkan - stok terpotong sesuai yang terpakai.');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      queryClient.invalidateQueries({ queryKey: ['spareparts'] });
      onClose();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal melaporkan pemakaian.');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sparepart yang terpakai</DialogTitle>
          <DialogDescription>
            Isi jumlah yang benar-benar dipakai. Yang tidak terpakai kembali ke stok.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {rows.map(({ it, approved, invalid }) => (
            <div key={it.id} className="grid gap-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{it.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Disetujui {approved} {it.unit ?? ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={approved}
                    step="any"
                    className={cn('w-24', invalid && 'border-destructive')}
                    value={used[it.id] ?? ''}
                    onChange={(e) => setUsed((prev) => ({ ...prev, [it.id]: e.target.value }))}
                  />
                  <span className="w-10 text-xs text-muted-foreground">{it.unit ?? ''}</span>
                </div>
              </div>
              {invalid && (
                <p className="text-xs text-destructive">Isi 0 sampai {approved} {it.unit ?? ''}.</p>
              )}
            </div>
          ))}
          <Textarea
            rows={2}
            placeholder="Catatan (opsional) - mis. sisa dibawa pulang"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {!anyInvalid && refund > 0 && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Tagihan pelanggan turun {formatRupiah(refund)} karena sebagian tidak terpakai.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={anyInvalid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Menyimpan...' : 'Konfirmasi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MaterialRequestFormRow {
  sparepart: SparepartOption | null;
  search: string;
  qty: string;
}

/** Form ajuan sparepart tambahan — multi-baris (1 pengajuan bisa berisi
 * beberapa sparepart sekaligus, sesuai CreateMaterialRequestDto.items),
 * tiap baris cari sparepart lewat autocomplete client-side (pola sama
 * kayak AddFindingForm di atas) + qty. Harga TIDAK diinput sama sekali —
 * server yang motret harga jual sparepart saat ini (lihat priceItems() di
 * material-requests.service.ts), form ini cuma kirim refId+qty. */
function AddMaterialRequestForm({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const sparepartsQuery = useQuery({
    queryKey: ['spareparts'],
    queryFn: () => apiClient.get<SparepartOption[]>('/spareparts'),
    // Stok yang tampil = stok TERSEDIA (fisik dikurangi yang sudah sudah dipesan).
    select: (data) =>
      data.map((s) =>
        s.reserved ? { ...s, stock: String(Math.max(0, Math.round((Number(s.stock) - s.reserved) * 100) / 100)) } : s,
      ),
  });
  const [rows, setRows] = React.useState<MaterialRequestFormRow[]>([
    { sparepart: null, search: '', qty: '1' },
  ]);
  const [note, setNote] = React.useState('');
  const [openRow, setOpenRow] = React.useState<number | null>(null);

  const submitMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/technician-jobs/${jobId}/materials`, {
        items: rows
          .filter((r) => r.sparepart && Number(r.qty) > 0)
          .map((r) => ({ kind: 'sparepart' as const, refId: r.sparepart!.id, qty: Number(r.qty) })),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Pengajuan terkirim, menunggu persetujuan admin.');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      setRows([{ sparepart: null, search: '', qty: '1' }]);
      setNote('');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengirim pengajuan.');
    },
  });

  function updateRow(i: number, patch: Partial<MaterialRequestFormRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { sparepart: null, search: '', qty: '1' }]);
  }
  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  const canSubmit =
    rows.some((r) => r.sparepart && Number(r.qty) > 0) && !submitMutation.isPending;

  // Total yang diajukan per sparepart (satuan kecil) — sparepart yang sama di
  // beberapa baris dijumlahkan, karena semuanya memakai stok yang sama.
  const requested = new Map<string, number>();
  for (const r of rows) {
    if (!r.sparepart) continue;
    requested.set(r.sparepart.id, (requested.get(r.sparepart.id) ?? 0) + (Number(r.qty) || 0));
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <label className="text-sm font-medium">Ajukan Sparepart Tambahan</label>
      {rows.map((row, i) => {
        const q = row.search.trim().toLowerCase();
        const suggestions = row.sparepart
          ? []
          : (sparepartsQuery.data ?? []).filter((s) => s.name.toLowerCase().includes(q));
        return (
          <div key={i} className="grid gap-1">
          <div className="flex flex-wrap items-start gap-2">
            <div className="relative w-full sm:w-auto sm:flex-1">
              <Input
                placeholder="Pilih / cari sparepart..."
                value={row.sparepart ? row.sparepart.name : row.search}
                onChange={(e) => updateRow(i, { sparepart: null, search: e.target.value })}
                onFocus={() => setOpenRow(i)}
                onBlur={() => setOpenRow(null)}
              />
              {openRow === i && !row.sparepart && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                  {suggestions.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">Gak ketemu.</p>
                  )}
                  {suggestions.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        updateRow(i, { sparepart: s, search: s.name });
                        setOpenRow(null);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <p>{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Stok {formatStock(s)} • {formatRupiah(s.sellPrice)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center rounded-md border">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-r-none"
                disabled={Number(row.qty) <= 1}
                onClick={() => updateRow(i, { qty: String(Math.max(1, Number(row.qty) - 1)) })}
              >
                <Minus className="size-4" />
              </Button>
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                aria-label="Jumlah"
                className="h-9 w-14 [appearance:textfield] rounded-none border-0 px-1 text-center shadow-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={row.qty}
                onChange={(e) => updateRow(i, { qty: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-l-none"
                onClick={() => updateRow(i, { qty: String((Number(row.qty) || 0) + 1) })}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              disabled={rows.length <= 1}
              onClick={() => removeRow(i)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {row.sparepart &&
            (() => {
              const sp = row.sparepart;
              const asked = round2(requested.get(sp.id) ?? 0);
              const left = round2(Number(sp.stock) - asked);
              const over = left < 0;
              return (
                <p
                  className={cn(
                    'text-[13px] leading-snug',
                    over ? 'font-medium text-destructive' : 'text-muted-foreground',
                  )}
                >
                  Stok {formatStock(sp)}
                  {sp.reserved ? ` (${sp.reserved} ${sp.unit} sudah dipesan)` : ''} • diajukan {asked}{' '}
                  {sp.unit} •{' '}
                  {over ? `kurang ${round2(-left)} ${sp.unit}` : `sisa ${formatStock({ ...sp, stock: left })}`}
                </p>
              );
            })()}
          </div>
        );
      })}
      <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={addRow}>
        + Tambah Item
      </Button>
      <Textarea
        rows={2}
        placeholder="Catatan (opsional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        type="button"
        size="sm"
        className="justify-self-start"
        disabled={!canSubmit}
        onClick={() => submitMutation.mutate()}
      >
        {submitMutation.isPending ? 'Mengirim...' : 'Ajukan'}
      </Button>
    </div>
  );
}
