'use client';

import { UnitPartsList, hasUnitParts, type UnitPartProduct } from '@/components/ac-unit-parts';
import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, ChevronDown, MapPin, Minus, Plus, Printer, ScanLine, Trash2, X } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime, formatRupiah, statusLabel } from '@/lib/format';
import { formatStock } from '@/lib/sparepart-mode';
import type { Role } from '@/lib/session';
import { cn } from '@/lib/utils';
import { statusBadgeVariant } from '../../queue/queue-client';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { BarcodeQr } from '@/components/barcode-qr';
import { SendFindingsBar, ServicePricingCard } from './service-pricing-card';
import { FieldPaymentCard, SubmitPaymentGate } from './payment-card';
import { TechnicianPriceCard } from './technician-price-card';
import { AddUnitButton } from './add-unit';
import { EditOrderButton } from './edit-order-dialog';
import { ComplaintButton } from './complaint-dialog';
import { HandoverHistoryCard, ReassignPanel, mergeHandovers, type HandoverRow } from './handover';
import { technicianNames } from '@/components/technician-multi-picker';
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

interface ProblemCategoryRef {
  id: string;
  name: string;
}
interface JobFindingPhoto {
  id: string;
  kind: 'sebelum' | 'sesudah';
  path: string;
  createdAt: string;
  uploadedBy?: { id: string; displayName: string } | null;
}
interface JobFinding {
  id: string;
  title: string;
  note: string | null;
  origin: string; // 'komplain_awal' | 'ditambah_teknisi'
  category: ProblemCategoryRef;
  photos: JobFindingPhoto[];
  createdAt: string;
  // Pencatat temuan (setelah alih tugas, teknisi baru melihat pekerjaan teknisi sebelumnya beserta namanya).
  createdBy?: { id: string; displayName: string } | null;
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
  // Job tempat pengajuan ini melekat (pada servis banyak AC pengajuannya satu untuk seluruh job).
  jobId?: string;
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
  createdAt: string;
  scheduledDate: string | null;
  notes: string | null;
  reviewNote: string | null;
  startedAt: string | null;
  completedAt: string | null;
  member: { id: string; name: string; phone: string | null; address: string | null; mapsUrl?: string | null } | null;
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
    // QR unit ini sudah pernah dilabeli sebelum job ini (dihitung backend: tercatat dicetak/ditempel atau
    // sudah punya job lain) — kartu QR menampilkan "Unit AC sudah terlabel".
    labeled?: boolean;
    // 'menunggu_data' = unit "QR dulu": merk/PK belum diisi, wajib dilengkapi lewat Scan Unit sebelum job bisa dimulai.
    status?: string;
  } | null;
  technician: { id: string; displayName: string; email: string } | null;
  // Semua teknisi job (setara); technician di atas = teknisi pertama.
  technicianIds?: string[];
  technicians?: { id: string; displayName: string }[];
  findings: JobFinding[];
  materialRequests: MaterialRequestRow[];
  // ServiceOrder pembungkus job ini — SELALU ada (baik lewat instalasi POS
  // maupun servis mandiri, lihat komentar TechnicianJobsService.createForOrder),
  // dipakai buat link "Cetak Label" ke halaman print-labels yang sudah ada
  // (per service order, bukan per job — 1 order bisa punya banyak unit).
  order: {
    id: string;
    // Note pekerjaan dari kasir/admin saat menerima servis (deskripsi pekerjaan); null = tidak ada.
    note?: string | null;
    // Keterangan teknisi (catatan satu order untuk admin); beda dari notes job = Diagnosa per unit.
    technicianNote?: string | null;
    // 'bayar_di_lokasi' | 'ditagih_admin' (cara tagih order).
    paymentMode?: string;
    // Ada setelah harga jasa ditetapkan (servis mandiri) atau dari invoice POS (pemasangan).
    invoice?: { id: string; number: string; status: string; grandTotal: string; totalPaid: string } | null;
  } | null;
  // Kapan teknisi menekan "Kirim Temuan" (kasir & admin dinotifikasi).
  findingsSentAt: string | null;
  // true = harga jasa JOB INI sudah ditetapkan (tagihan dihitung dari sumbernya). Pada servis banyak AC invoice-nya
  // dipakai bersama, jadi `order.invoice` ada belum berarti unit ini sudah dihargai.
  billingDerived?: boolean;
  // Titik lokasi kerja unit ini bila berbeda dari alamat pelanggan (null = ikut alamat/link member).
  workAddress?: string | null;
  workMapsUrl?: string | null;
  // Job lain di order yang sama (servis banyak AC, satu job per unit); kosong = servis satu unit biasa.
  siblings?: { id: string; createdAt: string }[];
  // Riwayat alih tugas job ini (kosong = tidak pernah dialihkan).
  handovers?: HandoverRow[];
  // Job komplain (pengerjaan ulang atas keluhan pelanggan): menunjuk pekerjaan awal yang selesai. null = job biasa.
  complaintOfJobId?: string | null;
  complaintOf?: { id: string; completedAt: string | null; orderId: string; technician: { displayName: string } | null } | null;
  // Pekerjaan selesai: komplain yang pernah diajukan atasnya (kosong = tidak ada).
  complaints?: { id: string; status: string; createdAt: string; orderId: string }[];
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
      // Seluruh awalan 'technician-jobs' (job ini, daftar, antrian, dan job saudara di halaman banyak AC — pembatalan
      // satu unit bisa memindahkan pengajuan sparepart ke unit lain).
      queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Aksi gagal.');
    },
  });
}

// `embedded` = dirender sebagai SATU SECTION UNIT di halaman servis banyak AC (MultiUnitJobView): tanpa judul halaman
// & data pelanggan (ditampilkan sekali di atas), dibungkus kartu ber-header (unit, sudah/belum discan, status).
interface EmbeddedProps {
  index: number;
  total: number;
  defaultOpen: boolean;
}

// Seperti useJobAction, tapi untuk aksi SELURUH order servis banyak AC (body allInOrder); onDone menyegarkan semua section.
function useOrderAction<TBody extends object>(jobId: string, path: string, successMsg: string, onDone: () => void) {
  return useMutation({
    mutationFn: (body: TBody) => apiClient.patch(`/technician-jobs/${jobId}/${path}`, body),
    onSuccess: () => {
      toast.success(successMsg);
      onDone();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Aksi gagal.');
    },
  });
}

export function JobDetailClient({
  jobId,
  role,
  embedded,
}: {
  jobId: string;
  role: Role;
  embedded?: EmbeddedProps;
}) {
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
  // Keterangan teknisi (kartu di bagian bawah halaman); dipanggil sebelum early return supaya urutan hook tetap.
  const keterangan = useKeterangan(jobId, jobQuery.data?.order?.technicianNote ?? null);

  const startMutation = useJobAction<{ scannedBarcode: string }>(jobId, '/start', 'Job dimulai.');
  const submitForReviewMutation = useJobAction<{ unpaidReason?: string }>(jobId, '/submit-for-review', 'Diajukan untuk review.');
  // Alasan bila order dibayar di lokasi tetapi pelanggan belum membayar (kotak muncul hanya bila memang diperlukan).
  const [unpaidReason, setUnpaidReason] = React.useState('');
  const approveMutation = useJobAction<{ reminderEnabled: boolean; serviceIntervalDays?: number }>(
    jobId,
    '/approve-complete',
    'Job disetujui selesai.',
  );
  // Pengingat servis per unit AC (2026-09-30) — diisi admin saat menyetujui
  // job cuci/maintenance/pemasangan. Null = belum disentuh (ikut kondisi pengingat unit, lihat remindOnValue).
  const [remindOn, setRemindOn] = React.useState<boolean | null>(null);
  const [remindDays, setRemindDays] = React.useState<string | null>(null);
  const sendBackMutation = useJobAction<{ note: string }>(
    jobId,
    '/send-back',
    'Job dikembalikan ke teknisi.',
  );
  // Servis banyak AC: pengajuan sparepart dipakai bersama seluruh unit; kalau unit pemegangnya dibatalkan, backend
  // memindahkannya ke unit aktif berikutnya (flag ini), bukan ikut membatalkannya.
  const cancelMutation = useJobAction<{ moveRequestsToSibling?: boolean }>(jobId, '/cancel', 'Job dibatalkan.');

  if (jobQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Memuat job...</p>;
  }
  if (jobQuery.isError || !jobQuery.data) {
    return <p className="text-sm text-destructive">Gagal memuat job. Mungkin sudah dihapus.</p>;
  }
  const job = jobQuery.data;
  // Servis banyak AC: satu halaman memuat section tiap unit (job-job di satu order). Section itu sendiri
  // (embedded) memakai komponen ini lagi, jadi tidak boleh mengalihkan lagi.
  if (!embedded && job.siblings && job.siblings.length > 0) {
    return <MultiUnitJobView job={job} role={role} />;
  }
  // Samain persis sama gate backend di addFinding/addFindingPhoto
  // (technician-jobs.service.ts): cuma admin/teknisi, cuma selama job
  // 'assigned'/'sedang_dikerjakan'. Kasir tetap bisa lihat (GET findOne
  // dia boleh), tapi kontrol tambah-temuan/upload-foto disembunyikan biar
  // gak nabrak 403 (POST findings/photos @Roles('admin','teknisi') doang).
  // Input temuan, foto, kirim temuan, dan pengajuan sparepart adalah pekerjaan TEKNISI.
  // Halaman ini untuk admin/kasir = memantau pekerjaan teknisi (read-only), jadi kontrolnya
  // hanya tampil untuk teknisi pemilik job.
  const canEditFindings = isTeknisi && ['assigned', 'sedang_dikerjakan'].includes(job.status);
  // Diagnosa / Catatan Pengerjaan: catatan teknis PER UNIT (kolom notes job) di tengah kartu unit, sama dengan app mobile.
  // Hanya teknisi yang mengisi, selama job aktif; admin/kasir melihat versi baca-saja.
  const notesEditable = isTeknisi && ['assigned', 'sedang_dikerjakan'].includes(job.status);
  // Keterangan teknisi: catatan SATU ORDER untuk admin (service_orders.technician_note), kartu di bagian paling bawah.
  // TERPISAH dari Diagnosa di atas. Hanya teknisi yang mengisi; admin/kasir membacanya (lihat KeteranganCard).
  const keteranganEditable = isTeknisi && ['assigned', 'sedang_dikerjakan'].includes(job.status);
  // Sama kayak gate start() di backend — minimal 1 foto 'sebelum' di
  // salah satu temuan job ini. Dihitung dari data yang udah ke-fetch, jadi
  // gak perlu request tambahan.
  // Hanya cuci/maintenance/pemasangan yang mengatur ulang jadwal servis
  // berikutnya (sinkron sama SCHEDULING_JOB_TYPES di backend).
  const needsSchedule =
    !!job.unit && ['cuci', 'maintenance', 'pemasangan'].includes(job.type);
  const remindDaysValue =
    remindDays ?? (job.unit?.serviceIntervalDays != null ? String(job.unit.serviceIntervalDays) : '');
  // Nilai awal saklar mengikuti kondisi unit: pengingat yang sengaja dimatikan admin (saklar mati padahal
  // siklus pernah diisi, mis. AC dibongkar) tidak otomatis menyala lagi hanya karena job disetujui.
  // Unit yang belum pernah punya siklus (data lampau, dll) tetap mulai dari Nyala.
  const remindOnValue =
    remindOn ?? !(job.unit?.reminderEnabled === false && job.unit.serviceIntervalDays != null);
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
  // Harga jasa BUKAN syarat mengajukan selesai: teknisi cukup melengkapi temuan + foto, lalu admin menetapkan harga
  // saat review. Harga (invoice ada; banyak AC: tiap unit punya harga sendiri) jadi syarat admin MENYETUJUI selesai
  // (sama dengan gate approveComplete di backend). Pembayaran bukan syarat.
  // Job komplain tidak ditagih lagi, jadi tidak ada harga jasa yang ditunggu.
  const priced = !!job.complaintOfJobId || (!!job.order?.invoice && (!embedded || job.billingDerived === true));
  const submitForReviewReady = job.findings.length > 0 && findingsMissingPhotos.length === 0;
  const submitForReviewBlockedReason =
    job.findings.length === 0
      ? 'Tambah minimal 1 temuan dulu sebelum bisa mengajukan selesai.'
      : `${findingsMissingPhotos.length} temuan belum lengkap foto sebelum/sesudahnya.`;

  // Servis banyak AC: Ajukan Selesai / Setujui / Kembalikan berlaku untuk SELURUH job dan ada di panel "Aksi Order"
  // (MultiUnitJobView). Di section satu unit tinggal scan-mulai (teknisi) dan batalkan unit (admin).
  const isFinal = ['selesai', 'dibatalkan'].includes(job.status);
  const returnedToTeknisi = isTeknisi && job.status === 'sedang_dikerjakan' && !!job.reviewNote;
  // Panel Aksi di kanan, sama dengan halaman servis banyak AC. Teknisi hanya punya aksi saat job Ditugaskan/Sedang
  // Dikerjakan; di status lain panelnya disembunyikan dan konten memakai lebar penuh (seperti MultiUnitJobView).
  const hasAside = !embedded && (!isTeknisi || ['assigned', 'sedang_dikerjakan'].includes(job.status));

  // Isi section unit: Detail Unit + (banner dikembalikan, catatan) + Temuan & Foto. Dipakai sebagai section unit di halaman
  // banyak AC (embedded) maupun di halaman satu unit, supaya struktur keduanya sama.
  const unitCards = (
    <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detail Unit</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {job.unit && hasUnitParts(job.unit) && (
                <DetailRow
                  label="Unit dalam paket"
                  value=""
                  valueNode={<UnitPartsList unit={job.unit} showSku />}
                />
              )}
              {/* Lokasi kerja unit ini bila berbeda dari alamat utama pelanggan (Detail Order). Tanpa link, Buka di Maps
                  mencari teks alamatnya (nama daerah saja cukup). */}
              {(job.workAddress || job.workMapsUrl) && (
                <DetailRow
                  label="Lokasi kerja"
                  value=""
                  valueNode={
                    <span className="grid justify-items-end gap-1">
                      {job.workAddress && <span>{job.workAddress}</span>}
                      <MapsLink mapsUrl={job.workMapsUrl} address={job.workAddress} />
                    </span>
                  }
                />
              )}
              {/* Teknisi: sama dengan app mobile — unit hanya baris teks Ruangan & Barcode (tanpa gambar QR / label). */}
              {job.unit && isTeknisi && (
                <>
                  <DetailRow label="Ruangan" value={job.unit.roomLocation || '-'} />
                  <DetailRow label="Barcode" value={job.unit.barcodeValue || 'Belum digenerate'} />
                  {/* Unit "QR dulu" (mis. AC tanpa label yang ditambahkan teknisi di tengah servis): teknisi yang
                      mencetak labelnya. Hilang sendiri setelah datanya dilengkapi (status unit jadi aktif). */}
                  {job.unit.status === 'menunggu_data' && (
                    <DetailRow
                      label="Label QR"
                      value=""
                      valueNode={
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/teknisi/jobs/${job.id}/print-labels?units=${job.unit.id}`}>
                            <Printer className="size-4" />
                            Cetak label unit
                          </Link>
                        </Button>
                      }
                    />
                  )}
                </>
              )}
              {job.unit && !isTeknisi && (
                // Preview QR unit ini — biar bisa dicek/dilihat lagi tanpa harus
                // buka halaman detail unit terpisah. Link cetak cuma admin/kasir
                // (GET /service-orders/:id 403 untuk teknisi).
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-white p-3 text-neutral-900">
                  <BarcodeQr value={job.unit.barcodeValue} size={72} className="shrink-0" />
                  <div className="min-w-0 flex-1 basis-48 text-xs text-neutral-600">
                    <p className="font-mono text-sm break-all text-neutral-900">{job.unit.barcodeValue}</p>
                    <p>QR label unit AC ini</p>
                    {(job.unit.labeled || (job.order && !isTeknisi)) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {job.unit.labeled && (
                          <Badge variant="success">
                            <CheckCircle2 className="size-3" />
                            Unit AC sudah terlabel
                          </Badge>
                        )}
                        {job.order && !isTeknisi && (
                          // Sudah terlabel: tombol sekunder (cetak ulang kalau label rusak/hilang).
                          // Belum terlabel: tombol utama, ini langkah yang masih harus dikerjakan.
                          <Button asChild size="sm" variant={job.unit.labeled ? 'outline' : 'default'}>
                            <Link
                              // Servis banyak AC: label unit ini saja (bukan seluruh unit order).
                              href={`/service-orders/${job.order.id}/print-labels${embedded ? `?units=${job.unit.id}` : ''}`}
                            >
                              <Printer className="size-4" />
                              Cetak label unit
                            </Link>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Kalau lagi bisa diedit (lihat NotesEditor di bawah), jangan
                  dobel ditampilin di sini juga - biar gak ada 2 sumber
                  kebenaran yang keliatan beda pas belum di-save. */}
              {job.notes && !notesEditable && <DetailRow label="Catatan" value={job.notes} />}
              {job.startedAt && isScanned(job) && (
                <DetailRow label="Dimulai" value={formatDateTime(job.startedAt)} />
              )}
              {/* Dialihkan saat sedang dikerjakan: kembali ke Ditugaskan, teknisi baru wajib scan ulang barcode unit. */}
              {job.startedAt && !isScanned(job) && job.status === 'assigned' && (
                <DetailRow
                  label="Menunggu scan ulang"
                  value={`Mulai pertama ${formatDateTime(job.startedAt)} (teknisi sebelumnya)`}
                />
              )}
              {job.completedAt && (
                <DetailRow label="Selesai" value={formatDateTime(job.completedAt)} />
              )}
              {job.reviewNote && !returnedToTeknisi && (
                <DetailRow label="Catatan Pengembalian" value={job.reviewNote} />
              )}
            </CardContent>
          </Card>

          {/* Seperti app mobile: teknisi melihat catatan pengembalian sebagai peringatan di atas isian kerja. */}
          {returnedToTeknisi && (
            <p className="rounded-md border border-status-warning/35 bg-status-warning/10 px-3 py-2 text-sm">
              Dikembalikan admin: {job.reviewNote}
            </p>
          )}

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
                  showAuthors={(job.handovers?.length ?? 0) > 0}
                />
              ))}
              {canEditFindings && <AddFindingForm jobId={job.id} />}
              {canEditFindings && !job.complaintOfJobId && (
                <SendFindingsBar
                  jobId={job.id}
                  findingCount={job.findings.length}
                  withoutBeforePhoto={
                    job.findings.filter((f) => !f.photos.some((p) => p.kind === 'sebelum')).length
                  }
                  findingsSentAt={job.findingsSentAt}
                  priced={priced}
                />
              )}
            </CardContent>
          </Card>
    </>
  );

  const content = (
    <div className="grid gap-6">
      {!embedded && (
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
            {/* Laporan Pekerjaan (kartu garansi): teknisi kapan saja, admin setelah job selesai. */}
            {(isTeknisi || (isAdmin && job.status === 'selesai')) && (
              <Button variant="outline" size="sm" asChild className="sm:ml-auto">
                <Link href={`/teknisi/jobs/${job.id}/print`}>
                  <Printer className="size-4" />
                  Laporan Pekerjaan
                </Link>
              </Button>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobTypeLabel(job.type)}
            {job.unit
              ? ` · ${[job.unit.brand, job.unit.model].filter(Boolean).join(' ') || 'Unit AC'}${job.unit.roomLocation ? ` (${job.unit.roomLocation})` : ''}`
              : ''}
          </p>
          {job.complaintOf && <ComplaintBanner from={job.complaintOf} linkable={!isTeknisi} />}
          <div className="mt-3">
            <JobSteps status={job.status} />
          </div>
        </div>
      )}

      {/* Servis banyak AC: Laporan Pekerjaan satu untuk seluruh job (tombolnya di header halaman, bukan per unit). */}
      {/* Semua peran: dua kolom (konten kiri, Aksi 360px di kanan), sama dengan halaman servis banyak AC. */}
      <div className={cn('grid items-start gap-6', hasAside && 'xl:grid-cols-[1fr_360px]')}>
        <div
          className={cn(
            'grid min-w-0',
            // Di dalam section unit: kartu datar (tanpa bayangan) supaya tidak bersusun kartu-di-kartu.
            embedded ? 'gap-4 [&_[data-slot=card]]:bg-background [&_[data-slot=card]]:shadow-none' : 'gap-6',
          )}
        >
          {!embedded && (
            <Card className={cn(isAdmin && job.status === 'menunggu_review' && 'order-last')}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Detail Order</CardTitle>
                <div className="flex items-center gap-1">
                  {/* Koreksi data order yang salah input (jadwal, jenis, note, lokasi kerja): khusus admin. */}
                  {isAdmin && job.order && (
                    <EditOrderButton orderId={job.order.id} memberId={job.member?.id} note={job.order.note} paymentMode={job.order.paymentMode} jobs={[job]} />
                  )}
                </div>
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
                    label="Lokasi"
                    value="-"
                    valueNode={<MapsLink mapsUrl={job.member?.mapsUrl} address={job.member?.address} />}
                  />
                <DetailRow label="Jadwal" value={job.scheduledDate ? formatDate(job.scheduledDate) : '-'} />
                <DetailRow label="Teknisi" value={technicianNames(job)} />
                {/* Komplain pelanggan: sengaja di bagian bawah (bukan header) supaya order ini tidak disangka order komplain. */}
                {isAdmin && <ComplaintButton anchorJobId={job.id} jobs={[job]} technicians={technicians} />}
              </CardContent>
            </Card>
          )}

          {/* Note pekerjaan dari kasir/admin, tepat di bawah Detail (halaman satu unit; banyak AC: di MultiUnitJobView). */}
          {!embedded && job.order?.note && !noteRepeatsComplaint(job.order.note, job.findings) && (
            <WorkNoteBox
              note={job.order.note}
              className={cn(isAdmin && job.status === 'menunggu_review' && 'order-last')}
            />
          )}

          {!embedded && <HandoverHistoryCard items={job.handovers ?? []} />}
          {!embedded && !isTeknisi && <ComplaintHistoryCard items={job.complaints ?? []} />}

          {/* Unit: Detail Unit + temuan & foto. Satu unit memakai section yang sama dengan tiap unit di halaman banyak AC. */}
          {embedded ? (
            unitCards
          ) : (
            <UnitSection job={job} index={0} total={1} defaultOpen>
              <div className="grid min-w-0 gap-4 [&_[data-slot=card]]:bg-background [&_[data-slot=card]]:shadow-none">{unitCards}</div>
            </UnitSection>
          )}

          {/* Keterangan teknisi dibaca admin/kasir sebelum menetapkan harga jasa. */}
          {!isTeknisi && !embedded && <KeteranganCard keterangan={keterangan} editable={false} />}

          {/* Job komplain tidak ditagih: tidak ada harga jasa untuk ditetapkan. */}
          {(isAdmin || role === 'kasir') && !embedded && !job.complaintOfJobId && <ServicePricingCard jobId={job.id} />}

          {/* Pengajuan sparepart tambahan — backend (material-requests
              module) udah lama ada & dipakai app mobile teknisi lama,
              sebelumnya belum ada UI-nya sama sekali di web (cuma teks
              placeholder). Admin approve/reject/revisi dari halaman
              terpisah "Pengajuan Masuk" (/material-requests), di sini
              teknisi cuma ajukan + lihat status + tandai terpakai. */}
          {!embedded && (
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
          )}

          {/* Harga jasa (teknisi) dan pembayaran di lokasi ditaruh SETELAH pengajuan sparepart: total tagihan baru final
              begitu sparepart diputuskan dan dilaporkan terpakai, dan pembayaran baru bisa dicatat sesudahnya. */}
          {isTeknisi && !embedded && !job.complaintOfJobId && job.type !== 'pemasangan' && (
            <TechnicianPriceCard jobId={job.id} canEdit={['assigned', 'sedang_dikerjakan'].includes(job.status)} />
          )}
          {!embedded && !job.complaintOfJobId && job.type !== 'pemasangan' && (
            <FieldPaymentCard jobId={job.id} role={role} jobStatus={job.status} technicians={job.technicians} />
          )}

          {/* Keterangan: paling bawah, sebelum Ajukan Selesai. */}
          {isTeknisi && !embedded && <KeteranganCard keterangan={keterangan} editable={keteranganEditable} />}
        </div>

        {embedded ? (
          isAdmin &&
          !isFinal && (
            <div className="flex justify-end border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  if (confirm('Batalkan unit AC ini dari job?')) {
                    cancelMutation.mutate({ moveRequestsToSibling: true });
                  }
                }}
              >
                {cancelMutation.isPending ? 'Memproses...' : 'Batalkan unit ini'}
              </Button>
            </div>
          )
        ) : hasAside ? (
        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader>
            <CardTitle className="text-base">Aksi</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {/* Servis banyak AC: penugasan teknisi untuk seluruh unit ada sekali di atas halaman (MultiUnitJobView). */}
            {!embedded && isAdmin && ['menunggu_penugasan', 'assigned', 'sedang_dikerjakan', 'menunggu_review'].includes(job.status) && (
              <ReassignPanel
                key={(job.technicianIds ?? []).join(',')}
                jobId={job.id}
                currentTechnicianIds={job.technicianIds ?? (job.technician ? [job.technician.id] : [])}
                started={job.status === 'sedang_dikerjakan'}
                inReview={job.status === 'menunggu_review'}
                technicians={technicians}
              />
            )}

            {!embedded && isTeknisi && job.status === 'assigned' && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Mulai Job (scan barcode unit)</label>
                {/* Unit "QR dulu": backend menolak start() selama datanya belum lengkap — arahkan ke Scan Unit di
                    depan, bukan setelah teknisi menekan Mulai. Tombol Mulai sengaja tidak dikunci di sini (cache
                    30 dtk bisa basi sesudah data dilengkapi); backend tetap penentu. */}
                {job.unit?.status === 'menunggu_data' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-warning/35 bg-status-warning/10 px-3 py-2 text-xs">
                    <p className="min-w-0 flex-1">
                      Data unit AC ini belum dilengkapi (QR dulu). Scan QR-nya di Scan Unit dan isi{' '}
                      <span className="font-medium">merk + PK</span> dulu sebelum job bisa dimulai.
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/ac-units/scan">
                        <ScanLine className="size-4" />
                        Buka Scan Unit
                      </Link>
                    </Button>
                  </div>
                )}
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
                <Button
                  disabled={!scanInput.trim() || !hasBeforePhoto || startMutation.isPending}
                  onClick={() => startMutation.mutate({ scannedBarcode: scanInput.trim() })}
                >
                  {startMutation.isPending ? 'Memproses...' : 'Mulai Job'}
                </Button>
                {/* Customer sering minta tambah AC begitu teknisi tiba, sebelum job dimulai: tidak perlu mulai dulu. */}
                {job.type !== 'pemasangan' && <AddUnitButton jobId={job.id} jobType={job.type} />}
              </div>
            )}

            {!embedded && isTeknisi && job.status === 'sedang_dikerjakan' && (
              <div className="grid gap-1.5">
                <SubmitPaymentGate jobId={job.id} reason={unpaidReason} onReasonChange={setUnpaidReason} />
                <Button
                  disabled={!submitForReviewReady || submitForReviewMutation.isPending}
                  onClick={() =>
                    keterangan
                      .flush()
                      .then(() => submitForReviewMutation.mutate({ unpaidReason: unpaidReason.trim() || undefined }), () => undefined)
                  }
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
                {/* Customer minta AC lain ikut diservis: unit tambahan masuk job ini (order pemasangan tidak). */}
                {job.type !== 'pemasangan' && <AddUnitButton jobId={job.id} jobType={job.type} />}
              </div>
            )}

            {!embedded && isAdmin && job.status === 'menunggu_review' && (
              <div className="grid gap-3">
                {needsSchedule && (
                  <ReminderScheduleFields
                    enabled={remindOnValue}
                    onEnabledChange={setRemindOn}
                    days={remindDaysValue}
                    onDaysChange={setRemindDays}
                  />
                )}
                {!priced && (
                  <p className="rounded-md border border-status-warning/35 bg-status-warning/10 px-3 py-2 text-xs">
                    Tetapkan harga jasa dulu di kartu Harga Jasa. Setelah itu kirim tagihan ke pelanggan; pekerjaan boleh
                    langsung diselesaikan atau menunggu tagihan lunas dulu, sesuai keputusan admin.
                  </p>
                )}
                <Button
                  disabled={
                    !priced ||
                    approveMutation.isPending ||
                    (needsSchedule && remindOnValue && !!intervalError(remindDaysValue))
                  }
                  onClick={() =>
                    approveMutation.mutate(
                      needsSchedule
                        ? {
                            reminderEnabled: remindOnValue,
                            ...(remindOnValue ? { serviceIntervalDays: Number(remindDaysValue) } : {}),
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
                  if (confirm(embedded ? 'Batalkan unit AC ini dari job?' : 'Batalkan job ini?')) {
                    cancelMutation.mutate(embedded ? { moveRequestsToSibling: true } : undefined);
                  }
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
        ) : null}
      </div>
    </div>
  );
  return embedded ? (
    <UnitSection job={job} index={embedded.index} total={embedded.total} defaultOpen={embedded.defaultOpen}>
      {content}
    </UnitSection>
  ) : (
    content
  );
}

/**
 * Order tanpa Deskripsi Pekerjaan memakai keluhan sebagai note-nya, padahal keluhan itu sudah jadi temuan awal
 * (origin komplain_awal) — Note Pekerjaan disembunyikan kalau isinya sama dengan temuan awal, supaya tidak muncul dua kali.
 */
function noteRepeatsComplaint(note: string, findings: { origin: string; title: string }[]): boolean {
  const n = note.trim().toLowerCase();
  return findings.some((f) => f.origin === 'komplain_awal' && f.title.trim().toLowerCase() === n);
}

/** Note pekerjaan (deskripsi pekerjaan dari kasir/admin) — tepat di bawah kartu detail order. */
function WorkNoteBox({ note, className }: { note: string; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-primary/30 bg-primary/5 px-4 py-3', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Note Pekerjaan</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{note}</p>
    </div>
  );
}

// Sudah discan = job sudah dimulai (start() mewajibkan scan barcode unit). Job yang dialihkan ke teknisi lain saat sedang
// dikerjakan kembali ke 'assigned' (wajib scan ulang): startedAt tetap terisi, tapi unit dihitung belum discan.
const isScanned = (j: { startedAt: string | null; status: string }) =>
  !!j.startedAt && !(['menunggu_penugasan', 'assigned'] as string[]).includes(j.status);

const unitTitle = (unit: JobDetail['unit']) =>
  unit ? [unit.brand, unit.model].filter(Boolean).join(' ') || 'Unit AC (tipe belum diisi)' : 'Tanpa unit';

// Sama dengan gate submitForReview() di backend, dihitung dari data yang sudah dimuat: apa yang masih menahan
// satu unit untuk diajukan selesai (kosong = siap). Harga jasa bukan syarat pengajuan: admin menetapkannya saat review.
function unitBlockers(j: JobDetail): string[] {
  const out: string[] = [];
  if (j.findings.length === 0) out.push('belum ada temuan');
  const noPhoto = j.findings.filter(
    (f) => !f.photos.some((p) => p.kind === 'sebelum') || !f.photos.some((p) => p.kind === 'sesudah'),
  ).length;
  if (noPhoto > 0) out.push(`${noPhoto} temuan belum lengkap foto sebelum/sesudah`);
  if (j.materialRequests.some((r) => r.status === 'pending')) out.push('pengajuan sparepart belum diputuskan');
  if (j.materialRequests.some((r) => r.status === 'approved' && !r.usedAt)) out.push('sparepart disetujui belum ditandai terpakai');
  return out;
}

// Hanya jenis job ini yang mengatur ulang jadwal pengingat saat disetujui (sinkron dengan backend).
const needsScheduleType = (type: string) => ['cuci', 'maintenance', 'pemasangan'].includes(type);

/**
 * Servis banyak AC: halaman satu order dengan satu section per unit AC. Tiap unit adalah job sendiri (temuan, foto
 * sebelum/sesudah, scan barcode, review, dan riwayat servis per unit), semuanya di satu order dengan satu nota.
 * Data pelanggan & penugasan teknisi ditampilkan sekali di sini; isi tiap section = JobDetailClient (embedded).
 */
function MultiUnitJobView({ job, role }: { job: JobDetail; role: Role }) {
  const queryClient = useQueryClient();
  const isAdmin = role === 'admin';
  const isTeknisi = role === 'teknisi';

  // Urut sesuai masuknya order (unit pertama di atas), job yang dibuka tetap ikut dalam urutan itu.
  const entries = [{ id: job.id, createdAt: job.createdAt }, ...(job.siblings ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // Kunci query sama dengan yang dipakai tiap section, jadi tidak ada request dobel (cache dibagi).
  const results = useQueries({
    queries: entries.map((e) => ({
      queryKey: ['technician-jobs', e.id],
      queryFn: () => apiClient.get<JobDetail>(`/technician-jobs/${e.id}`),
    })),
  });
  const jobs = results.map((r) => r.data).filter((j): j is JobDetail => !!j);
  const activeJobs = jobs.filter((j) => j.status !== 'dibatalkan');
  // Sudah discan = job sudah dimulai (start() mewajibkan scan barcode unit yang cocok).
  const scannedCount = activeJobs.filter(isScanned).length;
  const finishedCount = activeJobs.filter((j) => j.status === 'selesai').length;
  const canAssign =
    isAdmin && jobs.some((j) => ['menunggu_penugasan', 'assigned', 'sedang_dikerjakan', 'menunggu_review'].includes(j.status));
  const anyStarted = jobs.some((j) => j.status === 'sedang_dikerjakan');
  const anyInReview = jobs.some((j) => j.status === 'menunggu_review');

  const techniciansQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<UserRow[]>('/users'),
    enabled: isAdmin,
  });
  const technicians = (techniciansQuery.data ?? []).filter((u) => u.role === 'teknisi' && u.active);
  // Keterangan teknisi: satu untuk seluruh order (service_orders.technician_note); dikirim lewat job aktif mana pun.
  // Diagnosa per unit tetap di section tiap unit (kolom notes job), tidak tersentuh.
  const keteranganJob = jobs.find((j) => ['assigned', 'sedang_dikerjakan'].includes(j.status)) ?? job;
  const keterangan = useKeterangan(keteranganJob.id, job.order?.technicianNote ?? null);
  const keteranganEditable = isTeknisi && jobs.some((j) => ['assigned', 'sedang_dikerjakan'].includes(j.status));


  // ---- Aksi seluruh order: Ajukan Selesai (teknisi) dan Setujui / Kembalikan (admin) berlaku untuk SEMUA unit
  // sekaligus (satu job). Backend memeriksa semua unit dalam satu transaksi: gagal di satu unit = tidak ada yang berubah.
  const [sendBackNote, setSendBackNote] = React.useState('');
  const [sched, setSched] = React.useState<Record<string, { on: boolean | null; days: string | null }>>({});
  const refreshAll = () => {
    for (const e of entries) queryClient.invalidateQueries({ queryKey: ['technician-jobs', e.id] });
    queryClient.invalidateQueries({ queryKey: ['technician-jobs', 'all'] });
    queryClient.invalidateQueries({ queryKey: ['technician-jobs', 'queue'] });
  };
  const [unpaidReason, setUnpaidReason] = React.useState('');
  const submitAllMutation = useOrderAction<{ allInOrder: true; unpaidReason?: string }>(
    job.id,
    'submit-for-review',
    'Seluruh unit diajukan untuk review.',
    refreshAll,
  );
  const approveAllMutation = useOrderAction<{ allInOrder: true; units?: unknown[] }>(
    job.id,
    'approve-complete',
    'Job disetujui selesai (semua unit).',
    refreshAll,
  );
  const sendBackAllMutation = useOrderAction<{ allInOrder: true; note: string }>(
    job.id,
    'send-back',
    'Job dikembalikan ke teknisi (semua unit).',
    refreshAll,
  );

  // Mulai Job: satu panel untuk semua unit. Scan barcode salah satu unit yang belum discan = unit itu dimulai
  // (backend tetap memvalidasi barcode cocok, foto sebelum ada, data unit lengkap, seperti satu unit).
  const [scanInput, setScanInput] = React.useState('');
  const startUnitMutation = useMutation({
    mutationFn: ({ jobId, scannedBarcode }: { jobId: string; scannedBarcode: string }) =>
      apiClient.patch(`/technician-jobs/${jobId}/start`, { scannedBarcode }),
    onSuccess: () => {
      toast.success('Unit dimulai.');
      setScanInput('');
      refreshAll();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Aksi gagal.');
    },
  });

  const working = activeJobs.filter((j) => j.status === 'sedang_dikerjakan');
  const notStarted = activeJobs.filter((j) => ['menunggu_penugasan', 'assigned'].includes(j.status));
  const scanCode = scanInput.trim();
  const scanMatch = scanCode ? notStarted.find((j) => j.status === 'assigned' && j.unit?.barcodeValue === scanCode) : undefined;
  const hasBeforePhotoOf = (j: JobDetail) => j.findings.some((f) => f.photos.some((p) => p.kind === 'sebelum'));
  const waitingReview = activeJobs.filter((j) => j.status === 'menunggu_review');
  const allLoaded = jobs.length === entries.length;
  const unitLabel = (j: JobDetail) => `${unitTitle(j.unit)}${j.unit?.roomLocation ? ` (${j.unit.roomLocation})` : ''}`;
  // Teknisi: siap diajukan kalau semua unit sudah dimulai dan tidak ada yang kurang (temuan/foto/sparepart).
  const canSubmitAll =
    allLoaded && working.length > 0 && notStarted.length === 0 && working.every((j) => unitBlockers(j).length === 0);
  // Admin: jadwal pengingat per unit (hanya jenis job tertentu); nilai awal mengikuti kondisi unit, sama dengan satu unit.
  const schedOn = (j: JobDetail) =>
    sched[j.id]?.on ?? !(j.unit?.reminderEnabled === false && j.unit.serviceIntervalDays != null);
  const schedDays = (j: JobDetail) =>
    sched[j.id]?.days ?? (j.unit?.serviceIntervalDays != null ? String(j.unit.serviceIntervalDays) : '');
  const scheduleUnits = waitingReview.filter((j) => needsScheduleType(j.type));
  const scheduleInvalid = scheduleUnits.some((j) => schedOn(j) && !!intervalError(schedDays(j)));
  // Harga jasa tiap unit ditetapkan admin/kasir SETELAH teknisi mengajukan; syarat untuk menyetujui, bukan mengajukan.
  // (Job komplain tidak ditagih, jadi tidak pernah menunggu harga.)
  const unpricedWaiting = waitingReview.filter(
    (j) => j.type !== 'pemasangan' && j.billingDerived !== true && !j.complaintOfJobId,
  );
  // Panel Aksi Job (kanan) hanya ada bila ada yang bisa dikerjakan peran ini; kalau tidak, daftar unit memakai lebar penuh.
  const hasAside =
    (isTeknisi && (working.length > 0 || notStarted.length > 0)) || (isAdmin && (canAssign || waitingReview.length > 0));
  const canApproveAll =
    allLoaded && waitingReview.length > 0 && working.length === 0 && notStarted.length === 0 && unpricedWaiting.length === 0;
  // Pengajuan sparepart satu untuk seluruh job: daftar = gabungan pengajuan semua unit (terbaru di atas); pengajuan baru
  // dibuat di unit aktif pertama (job yang masih bisa menerima pengajuan: ditugaskan / sedang dikerjakan).
  const allRequests = jobs
    .flatMap((j) => j.materialRequests)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const requestJob = jobs.find((j) => ['assigned', 'sedang_dikerjakan'].includes(j.status));

  const invoice = job.order?.invoice;
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
          <h1 className="text-2xl font-semibold tracking-tight">{job.member?.name || 'Servis banyak unit AC'}</h1>
          <Badge variant="secondary">{entries.length} unit AC</Badge>
          {/* Laporan Pekerjaan (kartu garansi) SATU untuk seluruh job: teknisi kapan saja, admin setelah semua unit
              selesai (unit yang dibatalkan tidak dihitung). */}
          {(isTeknisi ||
            (isAdmin && allLoaded && activeJobs.length > 0 && activeJobs.every((j) => j.status === 'selesai'))) && (
            <Button variant="outline" size="sm" asChild className="sm:ml-auto">
              <Link href={`/teknisi/jobs/${job.id}/print`}>
                <Printer className="size-4" />
                Laporan Pekerjaan
              </Link>
            </Button>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {jobTypeLabel(job.type)} · {scannedCount} dari {activeJobs.length} unit sudah discan
          {finishedCount > 0 ? ` · ${finishedCount} selesai` : ''}
          {job.complaintOfJobId ? ' · komplain, tanpa nota baru' : ' · satu nota untuk semua unit'}
        </p>
        {job.complaintOf && <ComplaintBanner from={job.complaintOf} linkable={!isTeknisi} />}
      </div>

      <div className={cn('grid items-start gap-6', hasAside && 'xl:grid-cols-[1fr_360px]')}>
        <div className="grid min-w-0 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Detail Order</CardTitle>
          <div className="flex items-center gap-1">
            {/* Koreksi data order yang salah input (jadwal, jenis, note, lokasi kerja per unit): khusus admin. */}
            {isAdmin && job.order && (
              <EditOrderButton orderId={job.order.id} memberId={job.member?.id} note={job.order.note} paymentMode={job.order.paymentMode} jobs={jobs} />
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <DetailRow
            label="Pelanggan"
            value={job.member?.name || '-'}
            // GET /members/:id admin+kasir saja di backend; teknisi lihat teks biasa (sama dengan halaman satu unit).
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
            label="Lokasi"
            value="-"
            valueNode={<MapsLink mapsUrl={job.member?.mapsUrl} address={job.member?.address} />}
          />
          <DetailRow
            label="Jadwal"
            value={
              jobs.find((j) => j.scheduledDate)?.scheduledDate
                ? formatDate(jobs.find((j) => j.scheduledDate)!.scheduledDate as string)
                : '-'
            }
          />
          <DetailRow label="Teknisi" value={technicianNames(job)} />
          {invoice && (
            <DetailRow
              label="Nota"
              value={invoice.number}
              valueNode={
                isTeknisi ? undefined : (
                  <Link href={`/invoices/${invoice.id}`} className="font-medium hover:underline">
                    {invoice.number} · {statusLabel(invoice.status)} · {formatRupiah(invoice.grandTotal)}
                  </Link>
                )
              }
            />
          )}
          {/* Komplain pelanggan: di bagian bawah (bukan header) supaya order ini tidak disangka order komplain; pilih unit di dialog. */}
          {isAdmin && <ComplaintButton anchorJobId={job.id} jobs={jobs} technicians={technicians} />}
        </CardContent>
      </Card>

      {job.order?.note && !noteRepeatsComplaint(job.order.note, jobs.flatMap((j) => j.findings)) && (
        <WorkNoteBox note={job.order.note} />
      )}

      <HandoverHistoryCard items={mergeHandovers(jobs.map((j) => j.handovers ?? []))} />
      {!isTeknisi && <ComplaintHistoryCard items={jobs.flatMap((j) => j.complaints ?? [])} />}

          <div className="grid gap-4">
            {entries.map((e, i) => (
              <JobDetailClient
                key={e.id}
                jobId={e.id}
                role={role}
                embedded={{ index: i, total: entries.length, defaultOpen: e.id === job.id || entries.length <= 2 }}
              />
            ))}
          </div>

          {/* Keterangan teknisi dibaca admin/kasir sebelum menetapkan harga jasa. */}
          {!isTeknisi && <KeteranganCard keterangan={keterangan} editable={false} />}

          {/* Harga jasa: SATU untuk seluruh job (bukan per unit), seperti servis satu unit. Disimpan di job pemegang harga
              (job pertama yang belum dibatalkan); id job mana pun di order ini menunjuk ke sana. */}
          {(isAdmin || role === 'kasir') && !job.complaintOfJobId && <ServicePricingCard jobId={job.id} />}

          {/* Pengajuan sparepart: SATU untuk seluruh job (tidak dipisah per AC). Secara data melekat pada unit aktif
              pertama; daftar di sini menggabungkan pengajuan semua unit. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pengajuan Sparepart Tambahan</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-xs text-muted-foreground">
                Satu pengajuan untuk seluruh job (semua unit AC), tidak dipisah per AC.
              </p>
              {allRequests.length === 0 && <p className="text-sm text-muted-foreground">Belum ada pengajuan.</p>}
              {allRequests.length > 0 && (
                <MaterialRequestsList jobId={job.id} requests={allRequests} canMarkUsed={isAdmin || isTeknisi} />
              )}
              {isTeknisi && requestJob && <AddMaterialRequestForm jobId={requestJob.id} />}
            </CardContent>
          </Card>

          {/* Harga jasa (teknisi) dan pembayaran di lokasi: setelah pengajuan sparepart (total baru final sesudahnya). */}
          {isTeknisi && !job.complaintOfJobId && (
            <TechnicianPriceCard jobId={job.id} canEdit={jobs.some((j) => ['assigned', 'sedang_dikerjakan'].includes(j.status))} />
          )}
          {!job.complaintOfJobId && (
            <FieldPaymentCard
              jobId={working[0]?.id ?? job.id}
              role={role}
              jobStatus={working.length > 0 ? 'sedang_dikerjakan' : job.status}
              technicians={job.technicians}
            />
          )}

          {/* Keterangan: paling bawah, sebelum Ajukan Selesai (satu untuk seluruh order). */}
          {isTeknisi && <KeteranganCard keterangan={keterangan} editable={keteranganEditable} />}
        </div>
        {/* Panel aksi di samping seperti halaman satu unit (menempel di desktop; di layar sempit tampil di bawah). */}
        <div className={cn('xl:sticky xl:top-6', !hasAside && 'hidden')}>
        {/* Satu job = satu pengajuan: Ajukan Selesai / Setujui / Kembalikan berlaku untuk SEMUA unit sekaligus. */}
        {hasAside && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aksi Job (semua unit)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {/* Alihkan tugas: untuk seluruh unit order (sama dengan penempatan di halaman satu unit). */}
              {canAssign && (
                <ReassignPanel
                  key={(job.technicianIds ?? []).join(',')}
                  jobId={job.id}
                  currentTechnicianIds={job.technicianIds ?? (job.technician ? [job.technician.id] : [])}
                  started={anyStarted}
                  inReview={anyInReview}
                  allInOrder
                  technicians={technicians}
                />
              )}

              {/* Mulai Job: SATU panel (bukan per unit) yang membaca daftar unit sudah/belum discan. Scan barcode unit
                  yang belum discan memulai unit itu; semua unit tetap harus discan. */}
              {isTeknisi && notStarted.length > 0 && (
                <div className="grid gap-3">
                  <p className="text-sm font-medium">Mulai Job (scan barcode tiap unit)</p>
                  <ul className="grid gap-1.5 text-sm">
                    {activeJobs.map((j) => {
                      const scanned = isScanned(j);
                      const hints = [
                        j.unit?.status === 'menunggu_data' ? 'data unit belum dilengkapi' : null,
                        !scanned && !hasBeforePhotoOf(j) ? 'foto sebelum belum ada' : null,
                      ].filter(Boolean);
                      return (
                        <li key={j.id} className="flex items-start gap-2">
                          <CheckCircle2
                            className={cn('mt-0.5 size-4 shrink-0', scanned ? 'text-status-success' : 'text-muted-foreground/40')}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{unitLabel(j)}</span>
                            <span className="text-muted-foreground">
                              {' '}
                              - {scanned ? 'sudah discan' : ['belum discan', ...hints].join(', ')}
                            </span>
                          </span>
                          </li>
                      );
                    })}
                  </ul>
                  {notStarted.some((j) => j.unit?.status === 'menunggu_data') && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-warning/35 bg-status-warning/10 px-3 py-2 text-xs">
                      <p className="min-w-0 flex-1">
                        Ada unit &quot;QR dulu&quot; yang datanya belum dilengkapi. Scan QR-nya di Scan Unit dan isi{' '}
                        <span className="font-medium">merk + PK</span> dulu sebelum unit itu bisa dimulai.
                      </p>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/ac-units/scan">
                          <ScanLine className="size-4" />
                          Buka Scan Unit
                        </Link>
                      </Button>
                    </div>
                  )}
                  <BarcodeScanner onDetect={(code) => setScanInput(code)} manualPlaceholder="Barcode unit" />
                  {scanCode && (
                    <p className="text-xs text-muted-foreground">
                      Kode terbaca: <span className="font-medium text-foreground">{scanCode}</span>
                      {scanMatch ? ` - ${unitLabel(scanMatch)}` : ' - tidak cocok dengan unit yang belum discan'}
                    </p>
                  )}
                  <Button
                    disabled={!scanMatch || !hasBeforePhotoOf(scanMatch) || startUnitMutation.isPending}
                    onClick={() => scanMatch && startUnitMutation.mutate({ jobId: scanMatch.id, scannedBarcode: scanCode })}
                  >
                    {startUnitMutation.isPending ? 'Memproses...' : scanMatch ? `Mulai Job - ${unitLabel(scanMatch)}` : 'Mulai Job'}
                  </Button>
                </div>
              )}

              {isTeknisi && (working.length > 0 || notStarted.length > 0) && (
                <div className="grid gap-3">
                  {/* Satu tombol per tahap: selama masih ada unit yang belum discan hanya panel Mulai Job di atas yang
                      tampil; begitu semua unit dimulai, tombolnya berganti jadi Ajukan Selesai. */}
                  {notStarted.length === 0 && (
                    <>
                      <ul className="grid gap-1 text-sm">
                        {activeJobs.map((j) => {
                          const blockers = j.status === 'sedang_dikerjakan' ? unitBlockers(j) : [];
                          const state =
                            j.status === 'menunggu_review' || j.status === 'selesai'
                              ? 'sudah diajukan'
                              : blockers.length === 0
                                ? 'siap diajukan'
                                : blockers.join(', ');
                          const ok = state === 'siap diajukan' || state === 'sudah diajukan';
                          return (
                            <li key={j.id} className="flex items-start gap-2">
                              <CheckCircle2
                                className={cn('mt-0.5 size-4 shrink-0', ok ? 'text-status-success' : 'text-muted-foreground/40')}
                              />
                              <span className="min-w-0">
                                <span className="font-medium">{unitLabel(j)}</span>
                                <span className="text-muted-foreground"> - {state}</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <SubmitPaymentGate jobId={job.id} reason={unpaidReason} onReasonChange={setUnpaidReason} />
                      <Button
                        disabled={!canSubmitAll || submitAllMutation.isPending}
                        onClick={() =>
                          keterangan.flush().then(() => submitAllMutation.mutate({ allInOrder: true, unpaidReason: unpaidReason.trim() || undefined }), () => undefined)
                        }
                        className="w-full"
                      >
                        {submitAllMutation.isPending ? 'Memproses...' : `Ajukan Selesai (${working.length} unit)`}
                      </Button>
                      {!canSubmitAll && (
                        <p className="text-xs text-muted-foreground">
                          Semua unit harus lengkap (temuan, foto sebelum/sesudah) sebelum diajukan selesai sekaligus.
                          Unit yang tidak jadi diservis bisa dibatalkan admin di section-nya.
                        </p>
                      )}
                    </>
                  )}
                  {/* Customer minta AC lain ikut diservis: unit tambahan jadi section baru di halaman ini. */}
                  {requestJob && <AddUnitButton jobId={requestJob.id} jobType={requestJob.type} />}
                </div>
              )}

              {isAdmin && waitingReview.length > 0 && (
                <div className="grid gap-3">
                  {unpricedWaiting.length > 0 && (
                    <p className="rounded-md border border-status-warning/35 bg-status-warning/10 px-3 py-2 text-xs">
                      Tetapkan harga jasa dulu (kartu Harga Jasa, satu untuk seluruh job). Setelah itu kirim tagihan ke
                      pelanggan; pekerjaan boleh langsung diselesaikan atau menunggu tagihan lunas dulu, sesuai
                      keputusan admin.
                    </p>
                  )}
                  {working.length + notStarted.length > 0 && (
                    <p className="rounded-md border border-status-warning/35 bg-status-warning/10 px-3 py-2 text-xs">
                      Masih ada unit yang belum diajukan selesai oleh teknisi:{' '}
                      {[...working, ...notStarted].map(unitLabel).join(', ')}. Persetujuan dilakukan sekali untuk semua
                      unit setelah semuanya diajukan (unit yang tidak jadi diservis bisa dibatalkan di section-nya).
                    </p>
                  )}
                  {scheduleUnits.map((j) => (
                    <div key={j.id} className="grid gap-1.5">
                      <p className="text-sm font-medium">Pengingat servis - {unitLabel(j)}</p>
                      <ReminderScheduleFields
                        enabled={schedOn(j)}
                        onEnabledChange={(on) => setSched((s) => ({ ...s, [j.id]: { on, days: s[j.id]?.days ?? null } }))}
                        days={schedDays(j)}
                        onDaysChange={(days) => setSched((s) => ({ ...s, [j.id]: { on: s[j.id]?.on ?? null, days } }))}
                      />
                    </div>
                  ))}
                  <Button
                    disabled={!canApproveAll || scheduleInvalid || approveAllMutation.isPending}
                    onClick={() =>
                      approveAllMutation.mutate({
                        allInOrder: true,
                        ...(scheduleUnits.length > 0
                          ? {
                              units: scheduleUnits.map((j) => ({
                                jobId: j.id,
                                reminderEnabled: schedOn(j),
                                ...(schedOn(j) ? { serviceIntervalDays: Number(schedDays(j)) } : {}),
                              })),
                            }
                          : {}),
                      })
                    }
                    className="w-full"
                  >
                    {approveAllMutation.isPending ? 'Memproses...' : `Setujui Selesai (${waitingReview.length} unit)`}
                  </Button>
                  <div className="grid gap-1.5">
                    <label className="text-sm font-medium">Kembalikan ke Teknisi (semua unit)</label>
                    <Textarea
                      rows={2}
                      placeholder="Catatan - apa yang kurang? (sebut unitnya)"
                      value={sendBackNote}
                      onChange={(e) => setSendBackNote(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={!sendBackNote.trim() || sendBackAllMutation.isPending}
                      onClick={() => sendBackAllMutation.mutate({ allInOrder: true, note: sendBackNote.trim() })}
                      className="w-full"
                    >
                      {sendBackAllMutation.isPending ? 'Memproses...' : 'Kembalikan'}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}

/** Pembungkus satu unit di halaman servis banyak AC: header ringkas (unit, sudah/belum discan, status) + isi lipat. */
function UnitSection({
  job,
  index,
  total,
  defaultOpen,
  children,
}: {
  job: JobDetail;
  index: number;
  total: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const cancelled = job.status === 'dibatalkan';
  // Sudah discan = job sudah dimulai (start() mewajibkan scan barcode unit yang cocok).
  const scanned = isScanned(job);
  return (
    <section id={`unit-${job.id}`} className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-muted/60 px-4 py-3 text-left"
      >
        {/* Nama unit (bernomor) di atas, "Unit x dari y" di bawahnya. Layar sempit: blok ini satu baris penuh. */}
        <span className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          <span className="block truncate text-sm font-semibold">
            {total > 1 ? `${index + 1}. ` : ''}
            {unitTitle(job.unit)}
            {job.unit?.roomLocation ? ` · ${job.unit.roomLocation}` : ''}
          </span>
          <span className="block text-xs text-muted-foreground">
            {total > 1 ? `Unit ${index + 1} dari ${total}` : 'Detail unit, temuan & foto'}
          </span>
        </span>
        {!cancelled && (
          <Badge variant={scanned ? 'success' : 'warning'}>
            {scanned && <CheckCircle2 className="size-3" />}
            {scanned ? 'Sudah discan' : 'Belum discan'}
          </Badge>
        )}
        <Badge variant={statusBadgeVariant(job.status)}>{statusLabel(job.status)}</Badge>
        <ChevronDown className={cn('ml-auto size-4 shrink-0 transition-transform sm:ml-0', open && 'rotate-180')} />
      </button>
      {/* hidden (bukan di-unmount) supaya isian yang belum dikirim di section ini tidak hilang saat dilipat. */}
      <div className={cn('p-4', !open && 'hidden')}>{children}</div>
    </section>
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
              'flex size-5 items-center justify-center rounded-full border text-xs',
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
      <div className="flex size-24 items-center justify-center rounded border border-dashed p-1 text-center text-xs text-muted-foreground">
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

// Link lokasi: pakai link Google Maps yang diisi admin/kasir (member.mapsUrl, hanya http/https);
// kalau belum diisi, cari alamat teksnya di Google Maps.
function MapsLink({ mapsUrl, address }: { mapsUrl: string | null | undefined; address: string | null | undefined }) {
  const href = mapsUrl && /^https?:\/\//i.test(mapsUrl)
    ? mapsUrl
    : address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
      : null;
  if (!href) return <>-</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">
      <MapPin className="size-3.5" />
      Buka di Maps
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
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{valueNode ?? value}</span>
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

/**
 * Keterangan teknisi: catatan SATU ORDER untuk admin (mis. "Cuci 2 unit AC dibayar cash 75 ribu" atau "Pelanggan minta
 * penawaran ganti kapasitor, bisa dikerjakan besok"), diisi di bagian paling bawah halaman sebelum Ajukan Selesai.
 * TERPISAH dari "Diagnosa / Catatan Pengerjaan" (catatan teknis per unit, kolom notes job): Keterangan disimpan di order
 * (service_orders.technician_note) lewat PATCH :id/keterangan, jadi satu untuk seluruh order, baik satu unit maupun banyak AC.
 */
function useKeterangan(jobId: string, serverValue: string | null) {
  const queryClient = useQueryClient();
  // draft null = teknisi belum mengubah apa pun, jadi yang tampil isi dari server.
  const [draft, setDraft] = React.useState<string | null>(null);
  const value = draft ?? serverValue ?? '';
  const dirty = draft !== null && draft.trim() !== (serverValue ?? '').trim();
  const save = useMutation({
    mutationFn: (text: string) => apiClient.patch(`/technician-jobs/${jobId}/keterangan`, { keterangan: text.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['technician-jobs'] }),
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan keterangan.');
    },
  });
  return {
    value,
    dirty,
    saving: save.isPending,
    setValue: setDraft,
    /** Tombol "Simpan Keterangan". Galatnya sudah ditampilkan lewat toast. */
    save: () =>
      save.mutateAsync(value).then(
        () => {
          toast.success('Keterangan disimpan.');
        },
        () => undefined,
      ),
    /** Sebelum Ajukan Selesai: keterangan yang belum disimpan ikut tersimpan. Menolak bila gagal supaya pengajuan tidak jalan. */
    flush: (): Promise<void> => (dirty ? save.mutateAsync(value).then(() => undefined) : Promise.resolve()),
  };
}
type Keterangan = ReturnType<typeof useKeterangan>;

/**
 * Kartu Keterangan. Teknisi (job aktif): kolom isian di bagian paling bawah, tepat sebelum Ajukan Selesai. Selain itu
 * (admin/kasir, atau teknisi setelah diajukan): hanya tampil bila ada isinya, supaya admin membacanya saat menetapkan
 * harga jasa dan menyetujui.
 */
function KeteranganCard({ keterangan, editable }: { keterangan: Keterangan; editable: boolean }) {
  if (!editable && !keterangan.value.trim()) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{editable ? 'Keterangan' : 'Keterangan Teknisi'}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {editable ? (
          <>
            <Textarea
              rows={3}
              maxLength={1000}
              value={keterangan.value}
              onChange={(e) => keterangan.setValue(e.target.value)}
              placeholder='Catatan untuk admin, mis. "Cuci 2 unit AC, dibayar cash 75 ribu" atau "Pelanggan minta penawaran ganti kapasitor, bisa dikerjakan besok"'
            />
            <p className="text-xs text-muted-foreground">
              Isi sebelum Ajukan Selesai. Yang belum disimpan ikut tersimpan otomatis saat Ajukan Selesai.
            </p>
            <Button
              type="button"
              size="sm"
              className="justify-self-start"
              disabled={keterangan.saving || !keterangan.dirty}
              onClick={() => void keterangan.save()}
            >
              {keterangan.saving ? 'Menyimpan...' : 'Simpan Keterangan'}
            </Button>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{keterangan.value}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Penanda di job komplain: pengerjaan ulang atas pekerjaan yang sudah selesai (tanpa harga jasa/tagihan baru). */
function ComplaintBanner({ from, linkable }: { from: NonNullable<JobDetail['complaintOf']>; linkable: boolean }) {
  return (
    <div className="mt-3 rounded-md border border-status-warning/35 bg-status-warning/10 px-3 py-2 text-sm">
      <p className="font-medium">Job komplain - pengerjaan ulang</p>
      <p className="text-xs text-muted-foreground">
        Atas pekerjaan yang selesai{from.completedAt ? ` ${formatDate(from.completedAt)}` : ''}
        {from.technician ? ` oleh ${from.technician.displayName}` : ''}. Temuan dan foto di sini terpisah dari pekerjaan awal,
        tanpa harga jasa dan tagihan baru.
        {linkable && (
          <>
            {' '}
            <Link href={`/teknisi/jobs/${from.id}`} className="font-medium text-primary underline">
              Lihat pekerjaan awal
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

// Urutan tahap job; komplain satu keluhan (beberapa unit) ditampilkan dengan tahap yang paling awal.
const COMPLAINT_STAGE = ['menunggu_penugasan', 'assigned', 'sedang_dikerjakan', 'menunggu_review', 'selesai', 'dibatalkan'];

/** Di pekerjaan yang selesai: daftar komplain yang pernah diajukan atasnya, masing-masing menaut ke job komplainnya. */
function ComplaintHistoryCard({
  items,
}: {
  items: { id: string; status: string; createdAt: string; orderId: string }[];
}) {
  if (items.length === 0) return null;
  // Satu keluhan bisa mencakup beberapa unit (satu order komplain): dikelompokkan per order.
  const groups = new Map<string, typeof items>();
  for (const it of items) groups.set(it.orderId, [...(groups.get(it.orderId) ?? []), it]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Komplain atas pekerjaan ini</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {[...groups.values()].map((g) => {
          const status = [...g].sort((a, b) => COMPLAINT_STAGE.indexOf(a.status) - COMPLAINT_STAGE.indexOf(b.status))[0].status;
          return (
            <div key={g[0].orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <Link href={`/teknisi/jobs/${g[0].id}`} className="font-medium hover:underline">
                Komplain {formatDate(g[0].createdAt)}
                {g.length > 1 ? ` · ${g.length} unit` : ''}
              </Link>
              <Badge variant={statusBadgeVariant(status)}>{statusLabel(status)}</Badge>
            </div>
          );
        })}
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
  showAuthors,
}: {
  jobId: string;
  finding: JobFinding;
  canEdit: boolean;
  /** Job pernah dialihkan: tampilkan siapa yang mencatat temuan dan mengunggah foto. */
  showAuthors?: boolean;
}) {
  const before = finding.photos.filter((p) => p.kind === 'sebelum');
  const after = finding.photos.filter((p) => p.kind === 'sesudah');
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{finding.title}</p>
          {showAuthors && finding.createdBy && (
            <p className="mt-0.5 text-xs text-muted-foreground">Dicatat oleh {finding.createdBy.displayName}</p>
          )}
          <FindingNote jobId={jobId} finding={finding} canEdit={canEdit} />
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
          showAuthors={showAuthors}
        />
        <FindingPhotoGroup
          label="Sesudah"
          photos={after}
          jobId={jobId}
          findingId={finding.id}
          kind="sesudah"
          canEdit={canEdit}
          showAuthors={showAuthors}
        />
      </div>
    </div>
  );
}

/** Deskripsi temuan: teknisi boleh menulis/mengubah penjelasan tambahan per temuan (per unit AC) selama job aktif. */
function FindingNote({ jobId, finding, canEdit }: { jobId: string; finding: JobFinding; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(finding.note ?? '');
  const save = useMutation({
    mutationFn: () => apiClient.patch(`/technician-jobs/${jobId}/findings/${finding.id}`, { note: text.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      setEditing(false);
      toast.success('Deskripsi temuan disimpan.');
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan deskripsi.');
    },
  });

  if (editing) {
    return (
      <div className="mt-1.5 grid gap-1.5">
        <Textarea
          rows={3}
          autoFocus
          maxLength={1000}
          placeholder="Deskripsi temuan / penjelasan tambahan untuk unit ini"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Menyimpan...' : 'Simpan'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => {
              setText(finding.note ?? '');
              setEditing(false);
            }}
          >
            Batal
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      {finding.note && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{finding.note}</p>}
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            setText(finding.note ?? '');
            setEditing(true);
          }}
          className="mt-1 text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {finding.note ? 'Ubah deskripsi' : '+ Tambah deskripsi'}
        </button>
      )}
    </>
  );
}

function FindingPhotoGroup({
  label,
  photos,
  jobId,
  findingId,
  kind,
  canEdit,
  showAuthors,
}: {
  label: string;
  photos: JobFindingPhoto[];
  jobId: string;
  findingId: string;
  kind: 'sebelum' | 'sesudah';
  canEdit: boolean;
  showAuthors?: boolean;
}) {
  const queryClient = useQueryClient();
  const deletePhoto = useMutation({
    mutationFn: (photoId: string) =>
      apiClient.delete(`/technician-jobs/${jobId}/findings/${findingId}/photos/${photoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['technician-jobs', jobId] });
      toast.success('Foto dihapus.');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menghapus foto.'),
  });
  const uploaders = showAuthors
    ? [...new Set(photos.map((p) => p.uploadedBy?.displayName).filter((n): n is string => !!n))]
    : [];
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {label} ({photos.length})
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {photos.map((p) => (
          // Foto lewat proxy same-origin (/api/proxy/uploads/...), tidak perlu BACKEND_URL publik.
          <div key={p.id} className="relative">
            <PhotoThumb src={`/api/proxy${p.path}`} label={label} />
            {canEdit && (
              <button
                type="button"
                aria-label={`Hapus foto ${label.toLowerCase()}`}
                title="Hapus foto"
                disabled={deletePhoto.isPending}
                onClick={() => {
                  if (confirm('Hapus foto ini? Tidak bisa dikembalikan.')) deletePhoto.mutate(p.id);
                }}
                className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-white shadow focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <FindingPhotoUploadButton jobId={jobId} findingId={findingId} kind={kind} />
        )}
      </div>
      {uploaders.length > 0 && <p className="text-[11px] text-muted-foreground">Foto oleh {uploaders.join(', ')}</p>}
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
                className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
              className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
                className="block w-full px-3 py-2 pr-9 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
        placeholder="Deskripsi (opsional, berlaku untuk semua temuan di atas; bisa diubah per temuan setelahnya)"
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
        <MarkUsedDialog jobId={reporting.jobId ?? jobId} request={reporting} onClose={() => setReporting(null)} />
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
  // Tombol +/- (gaya sama dengan form pengajuan): naik/turun 1, ditahan di 0..disetujui.
  function setStepUsed(itemId: string, next: number, approved: number) {
    const v = Math.min(approved, Math.max(0, Math.round(next * 100) / 100));
    setUsed((prev) => ({ ...prev, [itemId]: String(v) }));
  }

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
                  <div
                    className={cn(
                      'flex items-center rounded-md border',
                      invalid && 'border-destructive',
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-r-none"
                      aria-label={`Kurangi ${it.name}`}
                      disabled={!(Number(used[it.id]) > 0)}
                      onClick={() => setStepUsed(it.id, Number(used[it.id]) - 1, approved)}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max={approved}
                      step="any"
                      aria-label={`Jumlah terpakai ${it.name}`}
                      className="h-9 w-14 [appearance:textfield] rounded-none border-0 px-1 text-center shadow-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      value={used[it.id] ?? ''}
                      onChange={(e) => setUsed((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-l-none"
                      aria-label={`Tambah ${it.name}`}
                      disabled={!(Number(used[it.id]) < approved)}
                      onClick={() => setStepUsed(it.id, (Number(used[it.id]) || 0) + 1, approved)}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
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
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
