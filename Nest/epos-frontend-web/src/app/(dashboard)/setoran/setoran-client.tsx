'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import { formatRupiah } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PanelTitle } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RepayDialog, useRefreshAll } from './setoran-shared';

// Laporan Uang di Teknisi (admin): uang yang masih dipegang, saldo kurang setor, selisih yang ditutup dengan alasan.
// Verifikasi setoran (tunai dan non-tunai) dikerjakan di Antrian Servis > tab Setoran Teknisi dan di halaman job.

interface CashRow {
  technicianId: string;
  displayName: string;
  heldTotal: number;
  heldCount: number;
  oldestHeldAgeDays: number | null;
  awaitingCount: number;
  saldo: number;
  closedWithReason30d: { count: number; total: number };
  excessCustomer: number;
}

export function SetoranClient() {
  const refresh = useRefreshAll();
  const [repay, setRepay] = React.useState<{ technicianId: string; saldo: number } | null>(null);
  const query = useQuery({
    queryKey: ['settlements', 'technician-cash'],
    queryFn: () => apiClient.get<CashRow[]>('/settlements/technician-cash'),
  });
  const rows = query.data ?? [];
  const excess = rows.reduce((s, r) => s + r.excessCustomer, 0);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Uang di Teknisi</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Laporan uang pembayaran lapangan yang belum selesai diverifikasi. Verifikasi setoran dilakukan di Antrian Servis.
          </p>
        </div>
        <Button asChild>
          <Link href="/teknisi/queue?tab=setoran">Verifikasi Setoran</Link>
        </Button>
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {query.isError && <p className="text-sm text-destructive">Gagal memuat laporan.</p>}
      {excess > 0 && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <Badge variant="warning">Perlu dikembalikan ke pelanggan</Badge>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Total kelebihan bayar pelanggan {formatRupiah(excess)} (tagihan turun sesudah Tanda Terima terbit). Belum ada refund
            otomatis; kembalikan manual.
          </p>
        </div>
      )}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <PanelTitle title="Uang di Teknisi" count={rows.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Teknisi</TableHead>
                <TableHead className="text-right">Dipegang</TableHead>
                <TableHead>Menunggu cocok</TableHead>
                <TableHead className="text-right">Saldo kurang setor</TableHead>
                <TableHead>Selisih ditutup alasan (30 hari)</TableHead>
                <TableHead className="text-right">Kelebihan pelanggan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.technicianId}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/teknisi/queue?tab=setoran&technicianId=${encodeURIComponent(r.technicianId)}`}
                      className="text-primary hover:underline"
                      title="Buka setoran teknisi ini"
                    >
                      {r.displayName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.heldCount > 0 ? (
                      <>
                        <span className="font-medium">{formatRupiah(r.heldTotal)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.heldCount} pembayaran
                          {r.oldestHeldAgeDays !== null && r.oldestHeldAgeDays >= 1 && (
                            <Badge variant="warning" className="ml-1">
                              tertua {r.oldestHeldAgeDays} hari
                            </Badge>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{r.awaitingCount > 0 ? `${r.awaitingCount} pembayaran` : '-'}</TableCell>
                  <TableCell className={cn('text-right', r.saldo > 0 && 'font-medium text-destructive')}>
                    {r.saldo !== 0 ? formatRupiah(r.saldo) : '-'}
                    {r.saldo > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="ml-2"
                        onClick={() => setRepay({ technicianId: r.technicianId, saldo: r.saldo })}
                      >
                        Terima Pelunasan
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.closedWithReason30d.count > 0
                      ? `${r.closedWithReason30d.count}x, total ${formatRupiah(r.closedWithReason30d.total)}`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-right">{r.excessCustomer > 0 ? formatRupiah(r.excessCustomer) : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {repay && (
        <RepayDialog
          key={repay.technicianId}
          technicianId={repay.technicianId}
          saldo={repay.saldo}
          open
          onOpenChange={(o) => !o && setRepay(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
