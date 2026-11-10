'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, X } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  SettlementForm,
  errMsg,
  useOutstanding,
  useRefreshAll,
  type OutstandingItem,
  type PendingData,
} from '../../../setoran/setoran-shared';
import { methodLabel } from './payment-card';

// Panel Aksi pengganti saat admin membuka job dari tab "Setoran Teknisi" (?setoran=1): isi halaman tetap laporan pekerjaan
// teknisi, aksinya mencocokkan pembayaran order ini sesuai tipenya (non-tunai: Cocok/Tolak, tunai: setoran uang).

export function SetoranJobPanel({ orderId, backHref = '/teknisi/queue?tab=setoran' }: { orderId: string; backHref?: string }) {
  const outstanding = useOutstanding();
  const items = (outstanding.data?.items ?? []).filter((i) => i.orderId === orderId);
  const nonCash = items.filter((i) => i.status === 'menunggu_cocok');
  const cash = items.filter((i) => i.status === 'dipegang_teknisi');
  const cashTechnicianIds = [...new Set(cash.map((i) => i.technician.id))];

  return (
    <Card className="h-fit xl:sticky xl:top-6">
      <CardHeader>
        <CardTitle className="text-base">Verifikasi Setoran</CardTitle>
        <CardDescription>
          Cocokkan pembayaran order ini dengan uang atau mutasi yang diterima. Pembayaran baru lunas setelah diverifikasi.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {outstanding.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
        {outstanding.isError && <p className="text-sm text-destructive">Gagal memuat pembayaran.</p>}
        {outstanding.data && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Semua pembayaran order ini sudah diverifikasi.</p>
        )}

        {nonCash.length > 0 && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">Cocokkan mutasi</p>
            <p className="text-xs text-muted-foreground">
              Buka m-banking atau dashboard QRIS toko. Tekan Cocok bila transfernya ada; Tolak hanya bila tidak ditemukan.
            </p>
            {nonCash.map((it) => (
              <NonCashRow key={it.paymentId} item={it} />
            ))}
          </div>
        )}

        {cashTechnicianIds.map((techId) => (
          <CashSettle
            key={techId}
            technicianId={techId}
            paymentIds={cash.filter((i) => i.technician.id === techId).map((i) => i.paymentId)}
          />
        ))}

        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>
            <ArrowLeft className="size-4" />
            Kembali ke Setoran Teknisi
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function CashSettle({ technicianId, paymentIds }: { technicianId: string; paymentIds: string[] }) {
  const pending = useQuery({
    queryKey: ['settlements', 'pending', technicianId],
    queryFn: () => apiClient.get<PendingData>(`/settlements/pending?technicianId=${technicianId}`),
  });
  if (pending.isLoading) return <p className="text-sm text-muted-foreground">Memuat uang tunai...</p>;
  if (pending.isError || !pending.data) return <p className="text-sm text-destructive">Gagal memuat data setoran.</p>;
  const mine = pending.data.payments.filter((p) => paymentIds.includes(p.id));
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">Setoran tunai - {pending.data.technician.displayName}</p>
      <SettlementForm
        key={mine.map((p) => p.id).join(',')}
        variant="panel"
        data={{ ...pending.data, payments: mine }}
      />
    </div>
  );
}

function NonCashRow({ item }: { item: OutstandingItem }) {
  const refresh = useRefreshAll();
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const verify = useMutation({
    mutationFn: () => apiClient.post(`/field-payments/${item.paymentId}/verify`),
    onSuccess: () => {
      toast.success('Pembayaran dicocokkan dan dilunasi.');
      refresh();
    },
    onError: (err) => toast.error(errMsg(err, 'Gagal memverifikasi pembayaran.')),
  });
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="font-medium">
            {methodLabel(item.method)} <Badge variant="warning">menunggu dicocokkan</Badge>
          </p>
          <p className="font-mono text-xs text-muted-foreground">{item.receiptNumber}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(item.createdAt)} · {item.technician.displayName}
          </p>
          {item.proofUrl && (
            <a
              href={`/api/proxy${item.proofUrl}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              Lihat bukti
            </a>
          )}
        </div>
        <span className="shrink-0 font-semibold">{formatRupiah(item.amount)}</span>
      </div>
      <div className="flex gap-1.5">
        <Button type="button" size="sm" className="flex-1" disabled={verify.isPending} onClick={() => verify.mutate()}>
          <Check className="size-4" />
          {verify.isPending ? 'Memproses...' : 'Cocok'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="flex-1 text-destructive hover:text-destructive"
          onClick={() => setRejectOpen(true)}
        >
          <X className="size-4" />
          Tolak
        </Button>
      </div>
      {rejectOpen && <RejectDialog item={item} open={rejectOpen} onOpenChange={setRejectOpen} onDone={refresh} />}
    </div>
  );
}

function RejectDialog({
  item,
  open,
  onOpenChange,
  onDone,
}: {
  item: OutstandingItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  // Dipasang hanya saat terbuka, jadi isian selalu mulai kosong.
  const [reason, setReason] = React.useState('');
  const reject = useMutation({
    mutationFn: () => apiClient.post(`/field-payments/${item.paymentId}/reject`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Pembayaran ditolak. Teknisi diberi tahu.');
      onOpenChange(false);
      onDone();
    },
    onError: (err) => toast.error(errMsg(err, 'Gagal menolak pembayaran.')),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tolak pembayaran</DialogTitle>
          <DialogDescription>
            Pembayaran tidak dilunasi dan teknisi diberi tahu. Tanda Terima yang sudah terkirim ke pelanggan perlu Anda urus
            secara manual.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="alasan-tolak">Alasan (min. 5 karakter)</Label>
          <Textarea
            id="alasan-tolak"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Mis. transfer tidak ada di mutasi"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={reason.trim().length < 5 || reject.isPending}
            onClick={() => reject.mutate()}
          >
            {reject.isPending ? 'Menolak...' : 'Tolak Pembayaran'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
