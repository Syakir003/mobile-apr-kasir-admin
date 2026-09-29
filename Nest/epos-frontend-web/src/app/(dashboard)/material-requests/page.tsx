'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Halaman admin "Pengajuan Masuk" — padanan prototype "DealDeck E-POS AC":
// daftar SEMUA pengajuan sparepart tambahan dari teknisi lintas job, bisa
// difilter per status, dan diputuskan (setuju/revisi/tolak) dari sini tanpa
// harus buka halaman job satu-satu. Backend-nya (material-requests module)
// sebelumnya SUDAH lengkap & dipakai app mobile lama — cuma belum ada UI
// web-nya sama sekali (lihat placeholder yang tadinya ada di job-detail-client.tsx).
//
// GET /material-requests admin-only. Teknisi tetap lihat pengajuan MILIKNYA
// sendiri lewat kartu "Pengajuan Sparepart" di halaman job (job-detail-client.tsx),
// gak lewat halaman ini.

interface MaterialRequestItemRow {
  id: string;
  refId: string | null;
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
  decidedAt: string | null;
  usedAt: string | null;
  items: MaterialRequestItemRow[];
  job: {
    id: string;
    type: string;
    unit: { brand: string | null; model: string | null; barcodeValue: string } | null;
    member: { name: string } | null;
  };
  createdBy: { id: string; displayName: string };
}
interface MaterialRequestListResponse {
  items: MaterialRequestRow[];
  counts: { all: number; pending: number; approved: number; rejected: number };
}

const STATUS_TABS = [
  { value: 'all', label: 'Semua' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Disetujui' },
  { value: 'rejected', label: 'Ditolak' },
] as const;

function statusVariant(status: string): 'success' | 'warning' | 'secondary' {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'secondary';
  return 'warning';
}
function statusLabelId(status: string): string {
  if (status === 'approved') return 'Disetujui';
  if (status === 'rejected') return 'Ditolak';
  return 'Pending';
}

export default function MaterialRequestsPage() {
  const [statusFilter, setStatusFilter] = React.useState<(typeof STATUS_TABS)[number]['value']>(
    'all',
  );
  const [detailId, setDetailId] = React.useState<string | null>(null);

  const params = new URLSearchParams();
  if (statusFilter !== 'all') params.set('status', statusFilter);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['material-requests', statusFilter],
    queryFn: () =>
      apiClient.get<MaterialRequestListResponse>(
        `/material-requests${params.toString() ? `?${params.toString()}` : ''}`,
      ),
  });

  // Dialog detail selalu ngikutin data TERBARU dari list (bukan snapshot
  // beku pas diklik "Lihat") — biar abis approve/reject/revisi, badge
  // status di dialog yang lagi kebuka ikut keupdate.
  const detail = detailId ? (data?.items.find((r) => r.id === detailId) ?? null) : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pengajuan Masuk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Permintaan sparepart tambahan dari teknisi lapangan.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
              statusFilter === tab.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'hover:bg-accent',
            )}
          >
            {tab.label}
            {data && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs',
                  statusFilter === tab.value
                    ? 'bg-white/20'
                    : 'bg-secondary text-secondary-foreground',
                )}
              >
                {data.counts[tab.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Memuat pengajuan...</p>}
      {isError && <p className="text-sm text-destructive">Gagal memuat pengajuan.</p>}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada pengajuan.</p>
      )}

      {data && data.items.length > 0 && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID Req</TableHead>
                <TableHead>Teknisi</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Biaya</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => setDetailId(r.id)}
                >
                  <TableCell className="font-mono text-xs">
                    REQ-{r.id.slice(0, 8).toUpperCase()}
                  </TableCell>
                  <TableCell className="font-medium">{r.createdBy.displayName}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">
                    {r.items.map((it) => it.name).join(', ')}
                  </TableCell>
                  <TableCell className="font-medium">{formatRupiah(r.total)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(r.status)}>{statusLabelId(r.status)}</Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => setDetailId(r.id)}>
                      Lihat
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          {detail && <RequestDetail request={detail} onDecided={() => setDetailId(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequestDetail({
  request,
  onDecided,
}: {
  request: MaterialRequestRow;
  onDecided: () => void;
}) {
  const queryClient = useQueryClient();
  const [decisionNote, setDecisionNote] = React.useState('');
  const [revising, setRevising] = React.useState(false);
  const [reviseItems, setReviseItems] = React.useState(
    request.items.map((it) => ({ refId: it.refId ?? '', name: it.name, qty: it.qty })),
  );

  const unitLabel = request.job.unit
    ? [request.job.unit.brand, request.job.unit.model].filter(Boolean).join(' ') || 'Unit AC'
    : null;

  const decideMutation = useMutation({
    mutationFn: (body: {
      decision: 'approve' | 'revise' | 'reject';
      decisionNote?: string;
      items?: { kind: 'sparepart'; refId: string; qty: number }[];
    }) => apiClient.patch(`/material-requests/${request.id}/decide`, body),
    onSuccess: (_, variables) => {
      const label =
        variables.decision === 'reject'
          ? 'ditolak'
          : variables.decision === 'revise'
            ? 'direvisi & disetujui'
            : 'disetujui';
      toast.success(`Pengajuan ${label}.`);
      queryClient.invalidateQueries({ queryKey: ['material-requests'] });
      // Job & invoice terkait ikut berubah (adjustment/notifikasi) — jaga
      // biar halaman job & invoice gak nampilin data basi kalau lagi kebuka.
      queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onDecided();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal memproses keputusan.');
    },
  });

  function setReviseQty(index: number, qty: string) {
    setReviseItems((prev) => prev.map((it, i) => (i === index ? { ...it, qty } : it)));
  }
  function removeReviseItem(index: number) {
    setReviseItems((prev) => prev.filter((_, i) => i !== index));
  }
  function submitRevision() {
    const items = reviseItems
      .filter((it) => Number(it.qty) > 0)
      .map((it) => ({ kind: 'sparepart' as const, refId: it.refId, qty: Number(it.qty) }));
    if (items.length === 0) {
      toast.error('Minimal 1 item dengan qty > 0.');
      return;
    }
    decideMutation.mutate({
      decision: 'revise',
      decisionNote: decisionNote.trim() || undefined,
      items,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>REQ-{request.id.slice(0, 8).toUpperCase()}</DialogTitle>
      </DialogHeader>

      <div className="grid gap-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Teknisi</span>
          <span className="font-medium">{request.createdBy.displayName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Job</span>
          <Link
            href={`/teknisi/jobs/${request.job.id}`}
            className="font-medium text-primary hover:underline"
          >
            {unitLabel ?? request.job.type}
          </Link>
        </div>
        {request.job.member && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pelanggan</span>
            <span className="font-medium">{request.job.member.name}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Tanggal</span>
          <span className="font-medium">{formatDateTime(request.createdAt)}</span>
        </div>
        {request.note && (
          <div className="rounded-md bg-muted px-3 py-2">
            <p className="text-xs text-muted-foreground">Catatan teknisi</p>
            <p>{request.note}</p>
          </div>
        )}

        <div className="rounded-md border">
          {!revising ? (
            <div className="grid gap-2 p-3">
              {request.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-medium">{it.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {trimZero(it.qty)} {it.unit || ''} × {formatRupiah(it.unitPrice)}
                    </p>
                  </div>
                  <p className="font-medium">{formatRupiah(it.lineTotal)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-2 p-3">
              <p className="text-xs text-muted-foreground">
                Ubah qty per item, atau hapus item yang gak disetujui.
              </p>
              {reviseItems.map((it, i) => (
                <div key={`${it.refId}-${i}`} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">{it.name}</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    className="w-20"
                    value={it.qty}
                    onChange={(e) => setReviseQty(i, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeReviseItem(i)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              {reviseItems.length === 0 && (
                <p className="text-xs text-destructive">Semua item dihapus — minimal sisa 1.</p>
              )}
            </div>
          )}
          <div className="flex items-center justify-between border-t px-3 py-2 text-sm font-semibold">
            <span>Total</span>
            <span>{formatRupiah(request.total)}</span>
          </div>
        </div>

        {request.status !== 'pending' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={statusVariant(request.status)}>
                {statusLabelId(request.status)}
              </Badge>
            </div>
            {request.decisionNote && (
              <div className="rounded-md bg-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">Catatan keputusan</p>
                <p>{request.decisionNote}</p>
              </div>
            )}
            {request.status === 'approved' && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pemakaian</span>
                <span className="font-medium">
                  {request.usedAt
                    ? `Sudah dipakai — ${formatDateTime(request.usedAt)}`
                    : 'Belum ditandai dipakai teknisi'}
                </span>
              </div>
            )}
          </>
        )}

        {request.status === 'pending' && (
          <div className="grid gap-2">
            <Textarea
              rows={2}
              placeholder="Catatan keputusan (opsional)"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
            />
            {!revising ? (
              <DialogFooter className="grid grid-cols-3 gap-2 sm:flex">
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={decideMutation.isPending}
                  onClick={() =>
                    decideMutation.mutate({
                      decision: 'reject',
                      decisionNote: decisionNote.trim() || undefined,
                    })
                  }
                >
                  Tolak
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={decideMutation.isPending}
                  onClick={() => setRevising(true)}
                >
                  Revisi
                </Button>
                <Button
                  type="button"
                  disabled={decideMutation.isPending}
                  onClick={() => decideMutation.mutate({ decision: 'approve', decisionNote: decisionNote.trim() || undefined })}
                >
                  {decideMutation.isPending ? 'Memproses...' : 'Setujui'}
                </Button>
              </DialogFooter>
            ) : (
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={decideMutation.isPending}
                  onClick={() => setRevising(false)}
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  disabled={decideMutation.isPending || reviseItems.length === 0}
                  onClick={submitRevision}
                >
                  {decideMutation.isPending ? 'Menyimpan...' : 'Simpan Revisi & Setujui'}
                </Button>
              </DialogFooter>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function trimZero(v: string): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : v;
}
