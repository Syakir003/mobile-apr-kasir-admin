'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ReminderScheduleFields, intervalError } from '@/components/reminder-schedule-fields';

// Monitoring jadwal servis (2026-09-30). 1 baris = 1 set AC (indoor+outdoor)
// = 1 pengingat. Sinkron dengan ScheduleStatus di backend
// (reminders/service-schedule.util.ts).

type ScheduleStatus =
  | 'terlambat'
  | 'segera'
  | 'bulan_ini'
  | 'aman'
  | 'belum_terjadwal'
  | 'siklus_kosong'
  | 'mati'
  | 'menunggu_data';

const STATUS_META: Record<
  ScheduleStatus,
  { label: string; badge: 'destructive' | 'warning' | 'success' | 'secondary' | 'outline' }
> = {
  terlambat: { label: 'Terlambat', badge: 'destructive' },
  segera: { label: 'Segera (≤7 hari)', badge: 'warning' },
  bulan_ini: { label: '8–30 hari', badge: 'secondary' },
  aman: { label: 'Aman', badge: 'success' },
  belum_terjadwal: { label: 'Belum terjadwal', badge: 'outline' },
  siklus_kosong: { label: 'Siklus belum diisi', badge: 'outline' },
  mati: { label: 'Pengingat mati', badge: 'secondary' },
  menunggu_data: { label: 'Menunggu data teknisi', badge: 'warning' },
};

const CARDS: { status: ScheduleStatus; title: string }[] = [
  { status: 'terlambat', title: 'Terlambat' },
  { status: 'segera', title: '7 hari ke depan' },
  { status: 'bulan_ini', title: '8–30 hari' },
  { status: 'siklus_kosong', title: 'Siklus belum diisi' },
  { status: 'mati', title: 'Pengingat mati' },
  { status: 'menunggu_data', title: 'Menunggu data' },
];

const WA_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  terkirim: 'Terkirim',
  gagal: 'Gagal',
  dibatalkan: 'Dibatalkan',
};

interface ScheduleItem {
  id: string;
  label: string;
  roomLocation: string | null;
  pk: string | null;
  member: { id: string; name: string; phone: string | null; waOptOut: boolean };
  lastServiceDate: string | null;
  serviceIntervalDays: number | null;
  nextServiceDate: string | null;
  reminderEnabled: boolean;
  status: ScheduleStatus;
  adaJobBerjalan: boolean;
  lastWa: { kind: string; status: string; error: string | null; at: string } | null;
}
interface ScheduleResponse {
  counts: Record<ScheduleStatus, number>;
  items: ScheduleItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function MonitoringTab() {
  const [status, setStatus] = React.useState<ScheduleStatus | 'semua'>('semua');
  const [qInput, setQInput] = React.useState('');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [editing, setEditing] = React.useState<ScheduleItem | null>(null);
  const [sending, setSending] = React.useState<ScheduleItem | null>(null);

  const query = useQuery({
    queryKey: ['reminders', 'schedule', { status, q, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (status !== 'semua') params.set('status', status);
      if (q) params.set('q', q);
      return apiClient.get<ScheduleResponse>(`/reminders/schedule?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
  const data = query.data;

  function pickStatus(next: ScheduleStatus | 'semua') {
    setStatus(next);
    setPage(1);
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {CARDS.map((c) => {
          const active = status === c.status;
          return (
            <button
              key={c.status}
              type="button"
              onClick={() => pickStatus(active ? 'semua' : c.status)}
              className={cn(
                'rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent',
                active && 'border-primary ring-2 ring-primary/30',
              )}
            >
              <div className="text-2xl font-semibold tabular-nums">{data?.counts[c.status] ?? '–'}</div>
              <div className="text-xs text-muted-foreground">{c.title}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex w-full gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qInput.trim());
            setPage(1);
          }}
        >
          <Input
            className="min-w-0 flex-1 sm:w-64 sm:flex-none"
            placeholder="Cari pelanggan, HP, lokasi, AC..."
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <Button type="submit" variant="outline">
            Cari
          </Button>
        </form>
        <Select value={status} onValueChange={(v) => pickStatus(v as ScheduleStatus | 'semua')}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="semua">Semua status</SelectItem>
            {(Object.keys(STATUS_META) as ScheduleStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data && (
          <span className="ml-auto text-sm text-muted-foreground">{data.total} set AC</span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pelanggan</TableHead>
                <TableHead>AC</TableHead>
                <TableHead>Servis terakhir</TableHead>
                <TableHead>Siklus</TableHead>
                <TableHead>Jadwal berikutnya</TableHead>
                <TableHead className="hidden xl:table-cell">WA terakhir</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Memuat jadwal...
                  </TableCell>
                </TableRow>
              )}
              {query.isError && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-destructive">
                    Gagal memuat jadwal servis.
                  </TableCell>
                </TableRow>
              )}
              {data && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Tidak ada AC yang cocok dengan filter ini.
                  </TableCell>
                </TableRow>
              )}
              {data?.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.member.name}</div>
                    <div className="text-xs text-muted-foreground">{u.member.phone || 'Tanpa HP'}</div>
                    {u.member.waOptOut && (
                      <Badge variant="secondary" className="mt-1">
                        Opt-out WA
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>{u.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {[u.roomLocation, u.pk ? `${u.pk} PK` : null].filter(Boolean).join(' · ') || '-'}
                    </div>
                  </TableCell>
                  <TableCell>{u.lastServiceDate ? formatDate(u.lastServiceDate) : '-'}</TableCell>
                  <TableCell>{u.serviceIntervalDays ? `${u.serviceIntervalDays} hari` : '-'}</TableCell>
                  <TableCell>
                    <div>{u.nextServiceDate ? formatDate(u.nextServiceDate) : '-'}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant={STATUS_META[u.status].badge}>{STATUS_META[u.status].label}</Badge>
                      {u.adaJobBerjalan && <Badge variant="outline">Job berjalan</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {u.lastWa ? (
                      <div>
                        <Badge
                          variant={
                            u.lastWa.status === 'terkirim'
                              ? 'success'
                              : u.lastWa.status === 'gagal'
                                ? 'destructive'
                                : 'secondary'
                          }
                          title={u.lastWa.error ?? undefined}
                        >
                          {WA_STATUS_LABEL[u.lastWa.status] ?? u.lastWa.status}
                        </Badge>
                        <div className="mt-1 text-xs text-muted-foreground">{formatDate(u.lastWa.at)}</div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Belum ada</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(u)}>
                        Atur
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!u.reminderEnabled || !u.nextServiceDate}
                        title={
                          !u.reminderEnabled
                            ? 'Pengingat mati'
                            : !u.nextServiceDate
                              ? 'Belum ada jadwal servis'
                              : undefined
                        }
                        onClick={() => setSending(u)}
                      >
                        Kirim
                      </Button>
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/ac-units/${u.id}`}>Detail</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Sebelumnya
          </Button>
          <span>
            Hal. {data.page} / {data.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Berikutnya
          </Button>
        </div>
      )}

      {editing && <AturDialog key={editing.id} item={editing} onClose={() => setEditing(null)} />}
      {sending && <KirimDialog key={sending.id} item={sending} onClose={() => setSending(null)} />}
    </div>
  );
}

function AturDialog({ item, onClose }: { item: ScheduleItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = React.useState(item.reminderEnabled);
  const [days, setDays] = React.useState(item.serviceIntervalDays != null ? String(item.serviceIntervalDays) : '');

  const prevDays = item.serviceIntervalDays != null ? String(item.serviceIntervalDays) : '';
  const toggled = enabled !== item.reminderEnabled;
  const daysChanged = days.trim() !== prevDays;
  // Siklus wajib diisi saat pengingat DINYALAKAN dari mati atau kalau diisi;
  // unit lama yang masih kosong boleh tetap kosong (hanya ubah saklar).
  const needsDays = enabled && (!item.reminderEnabled || days.trim() !== '');
  const err = needsDays ? intervalError(days) : null;
  const nothingChanged = !toggled && !daysChanged;

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch(`/ac-units/${item.id}`, {
        reminderEnabled: toggled ? enabled : undefined,
        serviceIntervalDays: enabled && days.trim() && daysChanged ? Number(days) : undefined,
      }),
    onSuccess: () => {
      toast.success('Pengingat AC diperbarui.');
      queryClient.invalidateQueries({ queryKey: ['reminders', 'schedule'] });
      queryClient.invalidateQueries({ queryKey: ['ac-units', item.id] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal menyimpan.'),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atur pengingat servis</DialogTitle>
          <DialogDescription>
            {item.member.name} — {item.label}
            {item.roomLocation ? ` (${item.roomLocation})` : ''}. Satu set AC = satu pengingat.
          </DialogDescription>
        </DialogHeader>
        <ReminderScheduleFields
          enabled={enabled}
          onEnabledChange={setEnabled}
          days={days}
          onDaysChange={setDays}
          baseDate={toggled ? undefined : item.lastServiceDate ? new Date(item.lastServiceDate) : undefined}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={nothingChanged || !!err || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Menyimpan...' : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KirimDialog({ item, onClose }: { item: ScheduleItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const send = useMutation({
    mutationFn: () =>
      apiClient.post<{ status: string; error: string | null }>(`/reminders/units/${item.id}/send-now`, {}),
    onSuccess: (res) => {
      if (res.status === 'terkirim') toast.success('Pengingat terkirim.');
      else toast.warning(`Pesan dicatat tapi belum terkirim: ${res.error ?? 'alasan tidak diketahui'}`);
      queryClient.invalidateQueries({ queryKey: ['reminders', 'schedule'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-logs'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Gagal mengirim pengingat.'),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kirim pengingat sekarang?</DialogTitle>
          <DialogDescription>
            Pengingat servis untuk {item.label}
            {item.roomLocation ? ` (${item.roomLocation})` : ''} akan dikirim ke {item.member.name} (
            {item.member.phone}) lewat WhatsApp, di luar jadwal otomatis. Pesan yang sama tidak bisa
            dikirim lagi dalam 24 jam.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? 'Mengirim...' : 'Kirim sekarang'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
