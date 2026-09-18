'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ScanLine, Search, Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
import type { Role } from '@/lib/session';
import { statusBadgeVariant } from '../../queue/queue-client';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { BarcodeQr } from '@/components/barcode-qr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  items: MaterialRequestItemRow[];
}
interface SparepartOption {
  id: string;
  name: string;
  unit: string;
  sellPrice: string;
  stock: string;
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
  const approveMutation = useJobAction(jobId, '/approve-complete', 'Job disetujui selesai.');
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
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {job.unit ? [job.unit.brand, job.unit.model].filter(Boolean).join(' ') || 'Unit AC' : `Order ${job.type}`}
          </h1>
          <Badge variant={statusBadgeVariant(job.status)}>{statusLabel(job.status)}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{job.type}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-6">
          <Card>
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
                    ? `${[job.unit.brand, job.unit.model].filter(Boolean).join(' ') || '-'} — ${job.unit.roomLocation || 'lokasi belum diisi'}`
                    : '-'
                }
              />
              {job.unit && <DetailRow label="Barcode Unit" value={job.unit.barcodeValue} />}
              {job.unit && (
                // Preview QR unit ini — biar bisa dicek/dilihat lagi tanpa
                // harus buka halaman detail unit terpisah. Berguna khususnya
                // buat job dari customer yang BELUM member sebelumnya
                // (servis mandiri, unit baru) — QR-nya baru digenerate pas
                // job ini dibuat (AcUnitsService.registerExisting), jadi di
                // sinilah tempat pertama admin/teknisi bisa lihat & cetak.
                <div className="grid gap-2 rounded-md border bg-white p-3">
                  <div className="flex justify-center">
                    <BarcodeQr value={job.unit.barcodeValue} size={96} />
                  </div>
                  {/* GET /service-orders/:id (dipakai halaman print-labels)
                      admin+kasir doang di backend — link cetak sengaja gak
                      ditampilin buat teknisi (bakal 403 kalau diklik). */}
                  {job.order && !isTeknisi && (
                    <Link
                      href={`/service-orders/${job.order.id}/print-labels`}
                      className="text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Cetak Label Unit
                    </Link>
                  )}
                </div>
              )}
              <DetailRow label="Teknisi" value={job.technician?.displayName || 'Belum ditugaskan'} />
              {/* Kalau lagi bisa diedit (lihat NotesEditor di bawah), jangan
                  dobel ditampilin di sini juga — biar gak ada 2 sumber
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

        <Card className="h-fit">
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
                    SEBELUM wajib ada dulu, sebelum job boleh dimulai — sudah
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
                    backend (technician-jobs.service.ts) — minimal 1 temuan,
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
                <Button
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate()}
                >
                  {approveMutation.isPending ? 'Memproses...' : 'Setujui Selesai'}
                </Button>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Kembalikan ke Teknisi</label>
                  <Textarea
                    rows={2}
                    placeholder="Catatan — apa yang kurang?"
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
          <a
            key={p.id}
            href={`/api/proxy${p.path}`}
            target="_blank"
            rel="noreferrer"
            title={`Buka foto ${label.toLowerCase()} ukuran penuh`}
          >
            {/* Foto disajikan lewat proxy same-origin (/api/proxy/uploads/...)
                biar gak perlu expose BACKEND_URL publik ke browser — proxy ini
                udah ada & generik (apapun path diteruskan ke backend). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/proxy${p.path}`}
              alt={`Foto ${label.toLowerCase()}`}
              className="size-14 rounded border object-cover"
            />
          </a>
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

/** Form nambah temuan baru — kombo cari kategori existing (autocomplete,
 * pola sama kayak search member di service-orders/intake) ATAU ketik bebas
 * buat kategori baru (auto-create di backend lewat findOrCreateCategory). */
function AddFindingForm({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient();
  const [categorySearch, setCategorySearch] = React.useState('');
  const [categorySearchDebounced, setCategorySearchDebounced] = React.useState('');
  const [selectedCategory, setSelectedCategory] = React.useState<CategorySearchResult | null>(
    null,
  );
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setCategorySearchDebounced(categorySearch.trim()), 300);
    return () => clearTimeout(t);
  }, [categorySearch]);

  const categoryQuery = useQuery({
    queryKey: ['problem-categories', categorySearchDebounced],
    queryFn: () =>
      apiClient.get<CategorySearchResult[]>(
        `/technician-jobs/categories/search?q=${encodeURIComponent(categorySearchDebounced)}`,
      ),
    enabled: categorySearchDebounced.length > 0 && !selectedCategory,
  });

  const addFindingMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/technician-jobs/${jobId}/findings`, {
        categoryId: selectedCategory?.id,
        categoryName: selectedCategory ? undefined : categorySearch.trim(),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Temuan ditambahkan.');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      setCategorySearch('');
      setSelectedCategory(null);
      setNote('');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menambah temuan.');
    },
  });

  function submit() {
    if (!selectedCategory && !categorySearch.trim()) {
      toast.error('Isi atau pilih kategori temuan dulu.');
      return;
    }
    addFindingMutation.mutate();
  }

  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <label className="text-sm font-medium">Tambah Temuan</label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Cari kategori, atau ketik baru — mis. AC bocor"
          value={selectedCategory ? selectedCategory.name : categorySearch}
          onChange={(e) => {
            setSelectedCategory(null);
            setCategorySearch(e.target.value);
          }}
        />
        {categorySearch.trim() && !selectedCategory && (
          <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
            {categoryQuery.isLoading && (
              <p className="p-2 text-xs text-muted-foreground">Mencari...</p>
            )}
            {categoryQuery.data?.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">
                Gak ketemu — lanjut isi buat bikin kategori baru &ldquo;{categorySearch.trim()}
                &rdquo;.
              </p>
            )}
            {categoryQuery.data?.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  setSelectedCategory(c);
                  setCategorySearch(c.name);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
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
        disabled={addFindingMutation.isPending}
        onClick={submit}
      >
        {addFindingMutation.isPending ? 'Menyimpan...' : 'Tambah Temuan'}
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
 * "Tandai Terpakai" yang emang tindakan teknisi/admin di lapangan. */
function MaterialRequestsList({
  jobId,
  requests,
  canMarkUsed,
}: {
  jobId: string;
  requests: MaterialRequestRow[];
  canMarkUsed: boolean;
}) {
  const queryClient = useQueryClient();
  const markUsedMutation = useMutation({
    mutationFn: (requestId: string) => apiClient.patch(`/material-requests/${requestId}/mark-used`),
    onSuccess: () => {
      toast.success('Ditandai sudah dipakai — stok ikut terpotong.');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menandai dipakai.');
    },
  });

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
          {r.status === 'approved' && !r.usedAt && canMarkUsed && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-self-start"
              disabled={markUsedMutation.isPending}
              onClick={() => markUsedMutation.mutate(r.id)}
            >
              {markUsedMutation.isPending ? 'Memproses...' : 'Tandai Terpakai'}
            </Button>
          )}
          {r.status === 'approved' && r.usedAt && (
            <p className="text-xs text-status-success">
              Sudah dipakai — {formatDateTime(r.usedAt)}
            </p>
          )}
        </div>
      ))}
    </div>
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
  });
  const [rows, setRows] = React.useState<MaterialRequestFormRow[]>([
    { sparepart: null, search: '', qty: '1' },
  ]);
  const [note, setNote] = React.useState('');

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

  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <label className="text-sm font-medium">Ajukan Sparepart Tambahan</label>
      {rows.map((row, i) => {
        const q = row.search.trim().toLowerCase();
        const suggestions = row.sparepart
          ? []
          : (sparepartsQuery.data ?? []).filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
        return (
          <div key={i} className="flex items-start gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="Cari sparepart..."
                value={row.sparepart ? row.sparepart.name : row.search}
                onChange={(e) => updateRow(i, { sparepart: null, search: e.target.value })}
              />
              {row.search.trim() && !row.sparepart && (
                <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                  {suggestions.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">Gak ketemu.</p>
                  )}
                  {suggestions.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      onClick={() => updateRow(i, { sparepart: s, search: s.name })}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <p>{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Stok {s.stock} {s.unit} • {formatRupiah(s.sellPrice)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="any"
              placeholder="Qty"
              className="w-20 shrink-0"
              value={row.qty}
              onChange={(e) => updateRow(i, { qty: e.target.value })}
            />
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
