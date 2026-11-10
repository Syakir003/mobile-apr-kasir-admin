'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ClipboardList } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatDateTime, formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PanelTitle } from '@/components/ui/panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { methodLabel } from '../jobs/[id]/payment-card';
import {
  SettlementForm,
  useOutstanding,
  type OutstandingItem,
  type PendingData,
} from '../../setoran/setoran-shared';
import { setoranJobHref } from '../../setoran/setoran-links';

// Tab "Setoran Teknisi" di Antrian Servis (admin): job yang pembayarannya belum diverifikasi. Pilih teknisi untuk melihat
// uangnya; verifikasi satuan dilakukan di halaman job (Buka Job), setoran tunai sekaligus lewat formulir di bawah tabel.

// Radix Select tidak menerima nilai kosong, jadi "semua teknisi" memakai penanda ini.
const ALL = '__all__';

interface OrderRow {
  orderId: string;
  jobId: string | null;
  customerName: string | null;
  unitLabel: string | null;
  invoiceNumber: string;
  technicianName: string;
  total: number;
  oldest: string;
  items: OutstandingItem[];
}

function groupByOrder(items: OutstandingItem[]): OrderRow[] {
  const map = new Map<string, OrderRow>();
  for (const it of items) {
    const row = map.get(it.orderId);
    if (row) {
      row.items.push(it);
      row.total += it.amount;
      if (it.createdAt < row.oldest) row.oldest = it.createdAt;
      continue;
    }
    map.set(it.orderId, {
      orderId: it.orderId,
      jobId: it.jobId,
      customerName: it.customerName,
      unitLabel: it.unitLabel,
      invoiceNumber: it.invoiceNumber,
      technicianName: it.technician.displayName,
      total: it.amount,
      oldest: it.createdAt,
      items: [it],
    });
  }
  return [...map.values()].sort((a, b) => a.oldest.localeCompare(b.oldest));
}

export function SetoranTab({ initialTechnicianId }: { initialTechnicianId: string }) {
  const [technicianId, setTechnicianId] = React.useState(initialTechnicianId);
  const outstanding = useOutstanding();
  const data = outstanding.data;

  const techs = data?.technicians ?? [];
  const visible = (data?.items ?? []).filter((i) => !technicianId || i.technician.id === technicianId);
  const rows = groupByOrder(visible);
  const selected = techs.find((t) => t.technicianId === technicianId);

  const pendingQuery = useQuery({
    queryKey: ['settlements', 'pending', technicianId],
    queryFn: () => apiClient.get<PendingData>(`/settlements/pending?technicianId=${technicianId}`),
    enabled: !!technicianId,
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid w-full max-w-sm gap-1.5">
          <Label>Teknisi</Label>
          <Select value={technicianId || ALL} onValueChange={(v) => setTechnicianId(v === ALL ? "" : v)}>
            <SelectTrigger className="w-full" aria-label="Pilih teknisi">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua teknisi</SelectItem>
              {technicianId && !selected && <SelectItem value={technicianId}>Teknisi terpilih</SelectItem>}
              {techs.map((t) => (
                <SelectItem key={t.technicianId} value={t.technicianId}>
                  {t.displayName} - {formatRupiah(t.heldTotal + t.awaitingTotal)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button asChild variant="outline">
          <Link href="/setoran">
            <ClipboardList className="size-4" />
            Laporan Uang di Teknisi
            <ChevronRight className="size-4" />
          </Link>
        </Button>
      </div>

      {outstanding.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {outstanding.isError && <p className="text-sm text-destructive">Gagal memuat setoran.</p>}
      {data && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {technicianId && !selected
            ? 'Teknisi ini tidak punya pembayaran yang belum diverifikasi.'
            : 'Semua pembayaran lapangan sudah diverifikasi.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <PanelTitle title="Job menunggu verifikasi setoran" count={rows.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pelanggan</TableHead>
                <TableHead>Teknisi</TableHead>
                <TableHead>Pembayaran</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.orderId}>
                  <TableCell>
                    <p className="font-medium">{r.customerName ?? '-'}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.invoiceNumber}
                      {r.unitLabel ? ` · ${r.unitLabel}` : ''}
                    </p>
                  </TableCell>
                  <TableCell>{r.technicianName}</TableCell>
                  <TableCell>
                    <div className="grid gap-1">
                      {r.items.map((it) => (
                        <span key={it.paymentId} className="flex flex-wrap items-center gap-1.5 text-xs">
                          <Badge variant="warning">
                            {it.status === 'dipegang_teknisi' ? 'Tunai dipegang' : `${methodLabel(it.method)} - cocokkan`}
                          </Badge>
                          <span className="text-muted-foreground">{formatDateTime(it.createdAt)}</span>
                          {it.ageDays >= 1 && <Badge variant="warning">{it.ageDays} hari</Badge>}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatRupiah(r.total)}</TableCell>
                  <TableCell className="text-right">
                    {r.jobId ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={setoranJobHref(r.jobId, technicianId)}>Buka Job</Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {technicianId && (
        <div className={cn('grid gap-3')}>
          <h2 className="text-base font-semibold tracking-tight">
            Setor tunai sekaligus {selected ? `- ${selected.displayName}` : ''}
          </h2>
          <p className="text-sm text-muted-foreground">
            Untuk teknisi yang menyerahkan beberapa pembayaran tunai sekaligus. Verifikasi satu job saja bisa dari halaman
            job (Buka Job).
          </p>
          {pendingQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {pendingQuery.isError && <p className="text-sm text-destructive">Gagal memuat data setoran.</p>}
          {pendingQuery.data && <SettlementForm key={technicianId} data={pendingQuery.data} />}
        </div>
      )}
    </div>
  );
}
