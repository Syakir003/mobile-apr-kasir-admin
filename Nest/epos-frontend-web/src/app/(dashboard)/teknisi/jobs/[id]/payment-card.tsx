'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, FileText, MessageCircle, Plus } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { randomKey } from '@/lib/random-key';
import type { Role } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Pembayaran yang diterima teknisi di lokasi (order "bayar di lokasi"): teknisi mencatat nominal + metode + foto bukti,
// lalu mengirim Tanda Terima singkat ke pelanggan lewat WhatsApp toko (atau memakai laporan kertas bila tanpa sinyal).
// Uang baru dianggap lunas setelah admin memverifikasi lewat Antrian Servis > tab Setoran Teknisi.

export const METHOD_OPTIONS = [
  { value: 'tunai', label: 'Tunai' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'qris', label: 'QRIS' },
  { value: 'ewallet', label: 'E-Wallet' },
  { value: 'debit', label: 'Debit' },
] as const;

export function methodLabel(method: string): string {
  return METHOD_OPTIONS.find((m) => m.value === method)?.label ?? method;
}

export const FIELD_PAYMENT_STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  dipegang_teknisi: { label: 'Uang dipegang teknisi', variant: 'warning' },
  menunggu_cocok: { label: 'Menunggu dicocokkan', variant: 'warning' },
  diverifikasi: { label: 'Terverifikasi', variant: 'success' },
  ditolak: { label: 'Ditolak', variant: 'destructive' },
};

export interface FieldPaymentRow {
  id: string;
  receiptNumber: string;
  method: string;
  amount: number;
  note: string | null;
  status: string;
  proofUrl: string | null;
  receiptChannel: 'wa' | 'kertas' | null;
  receiptSentAt: string | null;
  createdAt: string;
  recordedBy: { id: string; displayName: string };
}

export interface FieldPaymentSummary {
  paymentMode: 'bayar_di_lokasi' | 'ditagih_admin' | null;
  unpaidReason: string | null;
  invoice: { id: string; number: string; status: string; grandTotal: number; totalPaid: number } | null;
  activeTotal: number;
  remaining: number | null;
  canRecord: boolean;
  canSendWa: boolean;
  blockedReason: string | null;
  payments: FieldPaymentRow[];
}

/** Ringkasan pembayaran lapangan satu order (dipakai kartu pembayaran dan kotak alasan "belum bayar"). */
export function useFieldPayments(jobId: string, enabled = true) {
  return useQuery({
    queryKey: ['field-payments', jobId],
    queryFn: () => apiClient.get<FieldPaymentSummary>(`/technician-jobs/${jobId}/field-payments`),
    enabled,
    retry: false,
  });
}

function useRefreshPayments() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    // Seluruh awalan: halaman banyak unit memakai kunci berbeda (job anchor vs job yang dikerjakan) untuk order yang sama.
    queryClient.invalidateQueries({ queryKey: ['field-payments'] });
    queryClient.invalidateQueries({ queryKey: ['technician-jobs'] });
  }, [queryClient]);
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Teknisi: kotak alasan di dekat tombol Ajukan Selesai. Hanya tampil bila order dibayar di lokasi, masih ada tagihan, dan
 * belum ada pembayaran yang dicatat; selain itu tidak merender apa pun (backend yang memutuskan gerbangnya).
 */
export function SubmitPaymentGate({
  jobId,
  reason,
  onReasonChange,
}: {
  jobId: string;
  reason: string;
  onReasonChange: (value: string) => void;
}) {
  const { data } = useFieldPayments(jobId);
  if (!data || data.paymentMode !== 'bayar_di_lokasi' || !data.invoice) return null;
  const outstanding = data.invoice.grandTotal - data.invoice.totalPaid;
  const recorded = data.payments.some((p) => p.status !== 'ditolak');
  if (outstanding <= 0 || recorded) return null;
  return (
    <div className="grid gap-1.5 rounded-md border bg-muted/40 p-3">
      <Label htmlFor={`unpaid-${jobId}`} className="text-sm font-medium">
        Pelanggan belum membayar?
      </Label>
      <p className="text-xs text-muted-foreground">
        Order ini dibayar di lokasi. Catat pembayarannya dulu, atau tulis alasan bila pelanggan belum bisa membayar.
      </p>
      <Textarea
        id={`unpaid-${jobId}`}
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
        placeholder="Mis. pelanggan transfer besok pagi"
        rows={2}
      />
    </div>
  );
}

export function FieldPaymentCard({
  jobId,
  role,
  jobStatus,
  technicians,
}: {
  jobId: string;
  role: Role;
  jobStatus: string;
  /** Teknisi job ini (untuk admin mencatat dari kertas atas nama salah satunya). */
  technicians?: { id: string; displayName: string }[];
}) {
  const { data } = useFieldPayments(jobId);
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [paperOpen, setPaperOpen] = React.useState(false);
  if (!data) return null;
  if (data.paymentMode !== 'bayar_di_lokasi' && data.payments.length === 0) return null;

  const isTeknisi = role === 'teknisi';
  const isAdmin = role === 'admin';
  const grand = data.invoice?.grandTotal ?? 0;
  const verified = data.invoice?.totalPaid ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          Pembayaran di Lokasi
          {data.paymentMode === 'bayar_di_lokasi' ? (
            <Badge variant="secondary">Dibayar di lokasi</Badge>
          ) : (
            <Badge variant="secondary">Ditagih admin</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Teknisi mencatat uang yang diterima di lokasi dan memberi Tanda Terima ke pelanggan. Uang baru dianggap lunas
          setelah admin memverifikasi setoran atau mutasinya.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {data.invoice && (
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Tagihan</dt>
              <dd className="font-medium">{formatRupiah(grand)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sudah dicatat</dt>
              <dd className="font-medium">{formatRupiah(verified + data.activeTotal)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Sisa</dt>
              <dd className="font-medium">{formatRupiah(data.remaining ?? 0)}</dd>
            </div>
          </dl>
        )}

        {data.unpaidReason && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <Badge variant="warning">Belum dibayar</Badge>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Teknisi mengajukan selesai tanpa pembayaran. Alasannya: {data.unpaidReason}
            </p>
          </div>
        )}

        {data.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada pembayaran yang dicatat.</p>
        ) : (
          <ul className="grid gap-2">
            {data.payments.map((p) => (
              <PaymentRowItem key={p.id} payment={p} role={role} canSendWa={data.canSendWa} />
            ))}
          </ul>
        )}

        {isTeknisi && jobStatus === 'sedang_dikerjakan' && (
          <div className="grid gap-1.5">
            <Button type="button" disabled={!data.canRecord} onClick={() => setRecordOpen(true)}>
              <Plus className="size-4" />
              Catat Pembayaran
            </Button>
            {!data.canRecord && data.blockedReason && (
              <p className="text-xs text-muted-foreground">{data.blockedReason}</p>
            )}
          </div>
        )}

        {isAdmin && data.invoice && (data.remaining ?? 0) > 0 && (technicians?.length ?? 0) > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setPaperOpen(true)}>
            <FileText className="size-4" />
            Catat dari Laporan Kertas
          </Button>
        )}
      </CardContent>

      {isTeknisi && recordOpen && (
        <RecordPaymentDialog
          jobId={jobId}
          remaining={data.remaining ?? 0}
          open={recordOpen}
          onOpenChange={setRecordOpen}
        />
      )}
      {isAdmin && paperOpen && (
        <PaperPaymentDialog
          jobId={jobId}
          technicians={technicians ?? []}
          remaining={data.remaining ?? 0}
          open={paperOpen}
          onOpenChange={setPaperOpen}
        />
      )}
    </Card>
  );
}

function PaymentRowItem({
  payment: p,
  role,
  canSendWa,
}: {
  payment: FieldPaymentRow;
  role: Role;
  canSendWa: boolean;
}) {
  const refresh = useRefreshPayments();
  const [paperOpen, setPaperOpen] = React.useState(false);
  const [paperNo, setPaperNo] = React.useState('');
  const status = FIELD_PAYMENT_STATUS[p.status] ?? { label: p.status, variant: 'secondary' as const };
  const canSend = (role === 'teknisi' || role === 'admin') && p.status !== 'ditolak';

  const send = useMutation({
    mutationFn: (body: { channel?: 'wa' | 'kertas'; paperReportNo?: string }) =>
      apiClient.post<{ sent: boolean; channel: 'wa' | 'kertas'; error?: string | null }>(
        `/field-payments/${p.id}/send-receipt`,
        body,
      ),
    onSuccess: (r) => {
      if (r.channel === 'kertas') toast.success('Ditandai memakai laporan kertas.');
      else if (r.sent) toast.success('Tanda Terima terkirim ke pelanggan.');
      else toast.error(r.error ?? 'Gagal mengirim WhatsApp. Coba lagi, atau pakai laporan kertas.');
      setPaperOpen(false);
      refresh();
    },
    onError: (err) => toast.error(errMessage(err, 'Gagal mengirim Tanda Terima.')),
  });

  return (
    <li className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {formatRupiah(p.amount)} <span className="font-normal text-muted-foreground">· {methodLabel(p.method)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {p.receiptNumber} · {p.recordedBy.displayName} · {formatDateTime(p.createdAt)}
          </p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      {p.note && <p className="text-xs text-muted-foreground">Catatan: {p.note}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {p.proofUrl && (
          <a
            href={`/api/proxy${p.proofUrl}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            <Camera className="size-3.5" />
            Lihat bukti
          </a>
        )}
        {p.receiptChannel === 'wa' && p.receiptSentAt && (
          <span className="text-status-success">Tanda Terima terkirim {formatDateTime(p.receiptSentAt)}</span>
        )}
        {p.receiptChannel === 'kertas' && <span className="text-muted-foreground">Bukti: laporan kertas</span>}
        {!p.receiptChannel && <span className="text-muted-foreground">Tanda Terima belum diberikan</span>}
      </div>
      {canSend && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!canSendWa || send.isPending}
            onClick={() => send.mutate({ channel: 'wa' })}
          >
            <MessageCircle className="size-4" />
            {send.isPending ? 'Mengirim...' : p.receiptChannel === 'wa' && p.receiptSentAt ? 'Kirim Ulang Tanda Terima' : 'Kirim Tanda Terima (WA)'}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={send.isPending} onClick={() => setPaperOpen(true)}>
            <FileText className="size-4" />
            Pakai laporan kertas
          </Button>
        </div>
      )}
      {canSend && !canSendWa && (
        <p className="text-xs text-muted-foreground">
          Nomor WhatsApp pelanggan belum ada atau tidak valid, jadi Tanda Terima dibuktikan dengan laporan kertas.
        </p>
      )}

      <Dialog open={paperOpen} onOpenChange={setPaperOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pakai laporan kertas</DialogTitle>
            <DialogDescription>
              Berikan lembar laporan kertas ke pelanggan sebagai bukti. Nomor lembar boleh dikosongkan.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`paper-${p.id}`}>Nomor lembar (opsional)</Label>
            <Input id={`paper-${p.id}`} value={paperNo} onChange={(e) => setPaperNo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPaperOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              disabled={send.isPending}
              onClick={() => send.mutate({ channel: 'kertas', paperReportNo: paperNo.trim() || undefined })}
            >
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function RecordPaymentDialog({
  jobId,
  remaining,
  open,
  onOpenChange,
}: {
  jobId: string;
  remaining: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshPayments();
  // Dialog hanya dipasang saat terbuka (lihat pemakainya), jadi isian selalu mulai dari nilai awal ini.
  const [method, setMethod] = React.useState<string>('tunai');
  const [amount, setAmount] = React.useState(remaining > 0 ? String(remaining) : '');
  const [note, setNote] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  // Satu kunci per percobaan: bila request terkirim dua kali (sinyal putus-nyambung), pembayaran tidak tercatat ganda.
  const [clientRef] = React.useState(() => randomKey());

  const value = Number(amount) || 0;
  const partial = value > 0 && value < remaining;
  const valid = value > 0 && value <= remaining && !!file && (!partial || note.trim().length >= 3);

  const record = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set('method', method);
      form.set('amount', String(value));
      if (note.trim()) form.set('note', note.trim());
      form.set('clientRef', clientRef);
      form.set('proof', file as File);
      return apiClient.post(`/technician-jobs/${jobId}/field-payments`, form);
    },
    onSuccess: () => {
      toast.success('Pembayaran dicatat. Kirim Tanda Terima ke pelanggan.');
      onOpenChange(false);
      refresh();
    },
    onError: (err) => toast.error(errMessage(err, 'Gagal mencatat pembayaran.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat Pembayaran</DialogTitle>
          <DialogDescription>
            Sisa tagihan {formatRupiah(remaining)}. Foto bukti wajib untuk semua metode (foto uang/nota, atau bukti transfer
            di HP pelanggan).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Metode</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full" aria-label="Metode bayar">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {method !== 'tunai' && (
              <p className="text-xs text-muted-foreground">
                Hanya untuk transfer/QRIS ke rekening toko. Admin akan mencocokkannya dengan mutasi.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`amt-${jobId}`}>Nominal</Label>
            <CurrencyInput id={`amt-${jobId}`} value={amount} onChange={setAmount} />
            {value > remaining && <p className="text-xs text-destructive">Melebihi sisa tagihan.</p>}
          </div>
          {partial && (
            <div className="grid gap-1.5">
              <Label htmlFor={`note-${jobId}`}>Catatan (wajib untuk pembayaran sebagian)</Label>
              <Textarea
                id={`note-${jobId}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Mis. DP, sisanya dibayar besok"
                rows={2}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`proof-${jobId}`}>Foto bukti</Label>
            <Input
              id={`proof-${jobId}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="button" disabled={!valid || record.isPending} onClick={() => record.mutate()}>
            {record.isPending ? 'Menyimpan...' : 'Simpan Pembayaran'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaperPaymentDialog({
  jobId,
  technicians,
  remaining,
  open,
  onOpenChange,
}: {
  jobId: string;
  technicians: { id: string; displayName: string }[];
  remaining: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshPayments();
  // Dialog hanya dipasang saat terbuka (lihat pemakainya), jadi isian selalu mulai dari nilai awal ini.
  const [technicianId, setTechnicianId] = React.useState(technicians[0]?.id ?? '');
  const [method, setMethod] = React.useState<string>('tunai');
  const [amount, setAmount] = React.useState(remaining > 0 ? String(remaining) : '');
  const [note, setNote] = React.useState('');
  const [paperNo, setPaperNo] = React.useState('');
  const [clientRef] = React.useState(() => randomKey());

  const value = Number(amount) || 0;
  const partial = value > 0 && value < remaining;
  const valid = !!technicianId && value > 0 && value <= remaining && (!partial || note.trim().length >= 3);

  const save = useMutation({
    mutationFn: () =>
      apiClient.post('/field-payments/from-paper', {
        jobId,
        technicianId,
        method,
        amount: value,
        note: note.trim() || undefined,
        paperReportNo: paperNo.trim() || undefined,
        clientRef,
      }),
    onSuccess: () => {
      toast.success('Pembayaran dari laporan kertas dicatat.');
      onOpenChange(false);
      refresh();
    },
    onError: (err) => toast.error(errMessage(err, 'Gagal mencatat dari laporan kertas.')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat dari Laporan Kertas</DialogTitle>
          <DialogDescription>
            Untuk pekerjaan tanpa sinyal: catat pembayaran atas nama teknisi dari lembar laporan kertasnya. Setelah itu
            diverifikasi lewat Antrian Servis, tab Setoran Teknisi, seperti biasa.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Teknisi yang menerima uang</Label>
            <Select value={technicianId} onValueChange={setTechnicianId}>
              <SelectTrigger className="w-full" aria-label="Teknisi">
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
          <div className="grid gap-1.5">
            <Label>Metode</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full" aria-label="Metode bayar">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`paper-amt-${jobId}`}>Nominal (sisa {formatRupiah(remaining)})</Label>
            <CurrencyInput id={`paper-amt-${jobId}`} value={amount} onChange={setAmount} />
            {value > remaining && <p className="text-xs text-destructive">Melebihi sisa tagihan.</p>}
          </div>
          {partial && (
            <div className="grid gap-1.5">
              <Label htmlFor={`paper-note-${jobId}`}>Catatan (wajib untuk pembayaran sebagian)</Label>
              <Textarea id={`paper-note-${jobId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`paper-no-${jobId}`}>Nomor lembar kertas (opsional)</Label>
            <Input id={`paper-no-${jobId}`} value={paperNo} onChange={(e) => setPaperNo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="button" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
