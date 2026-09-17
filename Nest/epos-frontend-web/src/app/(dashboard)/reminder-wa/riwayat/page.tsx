'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Halaman "Riwayat WA" (admin) — Siklus WA/Fonnte. Gabungan padanan
// wa_history_screen.dart + wa_outbox_screen.dart mobile (di sini gak perlu
// dipisah antrean/riwayat lagi karena pengiriman sudah otomatis).

const KIND_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  selesai_servis: 'Selesai Servis',
  reminder_h3: 'Pengingat H-3',
  reminder_h7: 'Pengingat H+7',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  terkirim: 'Terkirim',
  gagal: 'Gagal',
  dibatalkan: 'Dibatalkan',
};

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'terkirim') return 'success';
  if (status === 'gagal') return 'destructive';
  if (status === 'pending') return 'warning';
  return 'secondary';
}

interface WhatsappLogRow {
  id: string;
  kind: string;
  phone: string;
  message: string;
  status: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  member: { id: string; name: string } | null;
}
interface WhatsappLogPage {
  items: WhatsappLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function RiwayatWaPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [kind, setKind] = React.useState<string>('semua');
  const [status, setStatus] = React.useState<string>('semua');
  const [q, setQ] = React.useState('');

  const query = useQuery({
    queryKey: ['whatsapp-logs', page, kind, status, q],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (kind !== 'semua') params.set('kind', kind);
      if (status !== 'semua') params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      return apiClient.get<WhatsappLogPage>(`/whatsapp-logs?${params.toString()}`);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/whatsapp-logs/${id}/retry`),
    onSuccess: () => {
      toast.success('Pesan dikirim ulang.');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-logs'] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengirim ulang.');
    },
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Riwayat WA</h1>
        <p className="text-sm text-muted-foreground">
          Semua pesan WhatsApp yang pernah dikirim — invoice manual maupun pengingat servis otomatis.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Cari nomor HP / nama member..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="w-64"
        />
        <Select
          value={kind}
          onValueChange={(v) => {
            setKind(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="semua">Semua Jenis</SelectItem>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="semua">Semua Status</SelectItem>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {query.isLoading && (
            <p className="p-4 text-sm text-muted-foreground">Memuat riwayat...</p>
          )}
          {query.isError && (
            <p className="p-4 text-sm text-destructive">Gagal memuat riwayat WA.</p>
          )}
          {query.data && query.data.items.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Belum ada pesan WA.</p>
          )}
          {query.data && query.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Penerima</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell>{KIND_LABEL[log.kind] ?? log.kind}</TableCell>
                    <TableCell>
                      <div>{log.member?.name ?? '-'}</div>
                      <div className="text-xs text-muted-foreground">{log.phone}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(log.status)}>
                        {STATUS_LABEL[log.status] ?? log.status}
                      </Badge>
                      {log.status === 'gagal' && log.error && (
                        <div className="mt-1 text-xs text-destructive">{log.error}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.status === 'gagal' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={retryMutation.isPending}
                          onClick={() => retryMutation.mutate(log.id)}
                        >
                          Kirim Ulang
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {query.data && query.data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Halaman {query.data.page} dari {query.data.totalPages} ({query.data.total} pesan)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= query.data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
