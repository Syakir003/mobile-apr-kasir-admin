'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Correction {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  brand: string | null;
  model: string | null;
  pk: string | null;
  roomLocation: string | null;
  serialNumber: string | null;
  installationDate: string | null;
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  requestedBy: { displayName: string };
  reviewedBy: { displayName: string } | null;
  unit: {
    id: string;
    barcodeValue: string;
    brand: string | null;
    model: string | null;
    pk: string | null;
    roomLocation: string | null;
    serialNumber: string | null;
    installationDate: string | null;
    member: { name: string; address: string | null };
  };
}
interface CorrectionList {
  pendingCount: number;
  items: Correction[];
  totalPages: number;
}

const STATUS_LABEL = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' } as const;
const STATUS_VARIANT = { pending: 'warning', approved: 'success', rejected: 'secondary' } as const;

function diffRows(c: Correction) {
  const rows: { label: string; oldV: string; newV: string }[] = [];
  const add = (label: string, oldV: string | null, newV: string | null) => {
    if (newV != null) rows.push({ label, oldV: oldV || '-', newV });
  };
  add('Merk', c.unit.brand, c.brand);
  add('Model', c.unit.model, c.model);
  add('PK', c.unit.pk != null ? String(Number(c.unit.pk)) : null, c.pk != null ? String(Number(c.pk)) : null);
  add('Ruangan', c.unit.roomLocation, c.roomLocation);
  add('No. seri', c.unit.serialNumber, c.serialNumber);
  add('Tgl pasang', c.unit.installationDate ? formatDate(c.unit.installationDate) : null, c.installationDate ? formatDate(c.installationDate) : null);
  return rows;
}

export function KoreksiTab() {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<'pending' | 'approved' | 'rejected'>('pending');
  const [rejecting, setRejecting] = React.useState<Correction | null>(null);
  const [reason, setReason] = React.useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['unit-corrections', 'list', status],
    queryFn: () => apiClient.get<CorrectionList>(`/unit-corrections?status=${status}&pageSize=50`),
  });

  function done(msg: string) {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['unit-corrections'] });
    qc.invalidateQueries({ queryKey: ['unit-labels'] });
  }
  const approve = useMutation({
    mutationFn: (id: string) => apiClient.post(`/unit-corrections/${id}/approve`, {}),
    onSuccess: () => done('Disetujui - data unit sudah berganti.'),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal menyetujui.'),
  });
  const reject = useMutation({
    mutationFn: ({ id, reviewNote }: { id: string; reviewNote: string }) =>
      apiClient.post(`/unit-corrections/${id}/reject`, { reviewNote }),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      done('Koreksi ditolak.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal menolak.'),
  });

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Menunggu</SelectItem>
            <SelectItem value="approved">Disetujui</SelectItem>
            <SelectItem value="rejected">Ditolak</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">{isFetching ? 'Memuat...' : 'Tidak ada koreksi.'}</p>
      )}

      {data?.items.map((c) => (
        <Card key={c.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                {c.unit.member.name} <span className="font-mono text-xs font-normal text-muted-foreground">{c.unit.barcodeValue}</span>
              </CardTitle>
              <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Diajukan {c.requestedBy.displayName} · {formatDateTime(c.createdAt)}
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="overflow-hidden rounded-md border text-sm">
              {diffRows(c).map((r) => (
                <div key={r.label} className="grid grid-cols-[7rem_1fr_1fr] gap-2 border-b px-3 py-1.5 last:border-b-0">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="line-through opacity-70">{r.oldV}</span>
                  <span className="font-medium">{r.newV}</span>
                </div>
              ))}
            </div>
            {c.note && <p className="text-sm">Catatan teknisi: {c.note}</p>}
            {c.status !== 'pending' && (
              <p className="text-xs text-muted-foreground">
                {STATUS_LABEL[c.status]} oleh {c.reviewedBy?.displayName ?? '-'}
                {c.reviewedAt ? ` · ${formatDateTime(c.reviewedAt)}` : ''}
                {c.reviewNote ? ` - ${c.reviewNote}` : ''}
              </p>
            )}
            {c.status === 'pending' && (
              <div className="flex gap-2">
                <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(c.id)}>
                  <Check className="size-4" /> Setujui &amp; ganti data
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRejecting(c)}>
                  <X className="size-4" /> Tolak
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak koreksi</DialogTitle>
            <DialogDescription>Alasan penolakan wajib diisi supaya teknisi tahu.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Batal</Button>
            <Button
              disabled={!reason.trim() || reject.isPending}
              onClick={() => rejecting && reject.mutate({ id: rejecting.id, reviewNote: reason.trim() })}
            >
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
