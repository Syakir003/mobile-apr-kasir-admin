'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/** Satu baris riwayat alih tugas (GET /technician-jobs/:id -> handovers). */
export interface HandoverRow {
  id: string;
  createdAt: string;
  statusAtHandover: string;
  reason: string | null;
  fromTechnician: { id: string; displayName: string };
  toTechnician: { id: string; displayName: string };
  handedBy: { id: string; displayName: string };
}

/**
 * Admin: menugaskan / mengalihtugaskan job ke teknisi lain. Alih tugas boleh kapan saja selama job belum selesai —
 * sebelum mulai, saat sudah dikerjakan sebagian (teknisi berhalangan, lanjut hari lain; teknisi baru wajib scan ulang),
 * atau saat menunggu review (tetap menunggu review, admin tetap bisa menyetujui; tanpa scan ulang).
 * Temuan & foto teknisi sebelumnya tetap di job dan terlihat oleh teknisi baru; pergantian tercatat di riwayat.
 */
export function ReassignPanel({
  jobId,
  currentTechnicianId,
  started,
  inReview,
  allInOrder,
  technicians,
}: {
  jobId: string;
  currentTechnicianId: string | null;
  /** true = job sudah dikerjakan sebagian (status sedang_dikerjakan). */
  started: boolean;
  /** true = sudah diajukan selesai (status menunggu_review): dialihkan tetap menunggu review. */
  inReview?: boolean;
  /** Servis banyak AC: pindahkan SEMUA unit order yang masih bisa dialihkan. */
  allInOrder?: boolean;
  technicians: { id: string; displayName: string }[];
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState('');
  const [reason, setReason] = React.useState('');
  const isHandover = !!currentTechnicianId;
  const options = technicians.filter((t) => t.id !== currentTechnicianId);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch(`/technician-jobs/${jobId}/assign`, {
        technicianId: selected,
        ...(allInOrder ? { allInOrder: true } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(isHandover ? 'Job dialihkan ke teknisi lain.' : 'Teknisi ditugaskan.');
      setSelected('');
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menugaskan teknisi.');
    },
  });

  function submit() {
    const name = technicians.find((t) => t.id === selected)?.displayName ?? 'teknisi ini';
    const confirmText = started
      ? `Alihkan job yang sedang dikerjakan ke ${name}? Temuan & foto yang sudah ada tetap di job, tapi teknisi baru wajib scan ulang barcode unit sebelum melanjutkan.`
      : inReview
        ? `Alihkan job yang menunggu review ke ${name}? Job tetap menunggu review dan bisa langsung disetujui admin.`
        : null;
    if (confirmText && !window.confirm(confirmText)) return;
    mutation.mutate();
  }

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <label className="text-sm font-medium">
        {isHandover ? 'Alihkan Tugas ke Teknisi Lain' : 'Tugaskan Teknisi'}
        {allInOrder ? ' (semua unit yang belum selesai)' : ''}
      </label>
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Pilih teknisi" />
        </SelectTrigger>
        <SelectContent>
          {options.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isHandover && (
        <Textarea
          rows={2}
          maxLength={500}
          placeholder="Alasan (opsional), mis. teknisi berhalangan / dilanjutkan besok"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      {isHandover && (
        <p className="text-xs text-muted-foreground">
          Temuan dan foto teknisi sebelumnya tetap ada dan bisa dilihat teknisi baru.
          {started ? ' Teknisi baru wajib scan ulang barcode unit (Mulai Job) sebelum melanjutkan.' : ''}
          {inReview ? ' Unit yang sudah diajukan tetap menunggu review dan bisa langsung disetujui admin.' : ''} Alih
          tugas tercatat di riwayat job.
        </p>
      )}
      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={!selected || mutation.isPending}
        onClick={submit}
      >
        {mutation.isPending ? 'Memproses...' : isHandover ? 'Alihkan' : 'Tugaskan'}
      </Button>
    </div>
  );
}

/** Keterangan status job saat dialihkan (dipakai kartu riwayat job dan riwayat servis unit). */
export function handoverStatusText(status: string): string {
  if (status === 'sedang_dikerjakan') return 'dialihkan saat sedang dikerjakan';
  if (status === 'menunggu_review') return 'dialihkan saat menunggu review';
  return 'dialihkan sebelum dimulai';
}

/** Riwayat alih tugas job (kosong = tidak ditampilkan). `unitLabel` untuk servis banyak AC yang digabung. */
export function HandoverHistoryCard({ items }: { items: HandoverRow[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Riwayat Alih Tugas</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {items.map((h) => (
          <div key={h.id} className="grid gap-0.5 rounded-md border p-3">
            <p className="flex flex-wrap items-center gap-1.5 font-medium">
              {h.fromTechnician.displayName}
              <ArrowRight className="size-3.5 text-muted-foreground" />
              {h.toTechnician.displayName}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(h.createdAt)} · oleh {h.handedBy.displayName} ·{' '}
              {handoverStatusText(h.statusAtHandover)}
            </p>
            {h.reason && <p className="whitespace-pre-wrap text-xs">Alasan: {h.reason}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Gabungkan riwayat alih tugas beberapa job (servis banyak AC dialihkan serentak = satu entri, bukan satu per unit).
 * Entri yang sama = teknisi asal/tujuan, alasan, dan detik yang sama.
 */
export function mergeHandovers(lists: HandoverRow[][]): HandoverRow[] {
  const seen = new Map<string, HandoverRow>();
  for (const h of lists.flat()) {
    const key = `${h.fromTechnician.id}|${h.toTechnician.id}|${h.reason ?? ''}|${h.createdAt.slice(0, 19)}`;
    if (!seen.has(key)) seen.set(key, h);
  }
  return [...seen.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
