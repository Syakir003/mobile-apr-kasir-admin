'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { statusLabel } from '@/lib/format';
import type { Role } from '@/lib/session';
import type { TechnicianJob } from '../queue/queue-client';
import { statusBadgeVariant } from '../queue/queue-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface HistoryPage {
  items: TechnicianJob[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function RiwayatClient({ role }: { role: Role }) {
  const [page, setPage] = React.useState(1);

  // GET /technician-jobs/history di backend @Roles('teknisi') doang — admin
  // gak punya riwayat pribadi (job bukan "milik" admin manapun). Nav admin
  // juga memang gak ngarahin ke sini (nav-config.ts), tapi rute ini tetap
  // bisa diketik manual, jadi ditangani dengan pesan, bukan error mentah.
  const historyQuery = useQuery({
    queryKey: ['technician-jobs', 'history', page],
    queryFn: () => apiClient.get<HistoryPage>(`/technician-jobs/history?page=${page}&pageSize=20`),
    enabled: role === 'teknisi',
  });

  if (role !== 'teknisi') {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Riwayat Servis</h1>
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Halaman ini khusus akun teknisi (riwayat job pribadi). Untuk melihat semua job yang
            sudah selesai, buka menu{' '}
            <Link href="/teknisi/queue" className="text-primary underline">
              Servis &amp; Teknisi
            </Link>{' '}
            lalu pilih filter &ldquo;Selesai&rdquo;.
          </CardContent>
        </Card>
      </div>
    );
  }

  const data = historyQuery.data;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Riwayat Servis</h1>
        <p className="mt-1 text-sm text-muted-foreground">Job yang sudah Anda selesaikan.</p>
      </div>

      {historyQuery.isLoading && <p className="text-sm text-muted-foreground">Memuat riwayat...</p>}
      {historyQuery.isError && <p className="text-sm text-destructive">Gagal memuat riwayat.</p>}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada job selesai.</p>
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="grid gap-3">
            {data.items.map((job) => (
              <Link key={job.id} href={`/teknisi/jobs/${job.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-3 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {job.unit
                          ? [job.unit.brand, job.unit.model].filter(Boolean).join(' ') || 'Unit AC'
                          : `Order ${job.type}`}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {job.type} • {job.member?.name || '-'}
                      </p>
                    </div>
                    <Badge variant={statusBadgeVariant(job.status)}>{statusLabel(job.status)}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Halaman {data.page} dari {data.totalPages} ({data.total} job)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
