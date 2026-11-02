'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';

import { apiClient, ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ReminderScheduleFields, intervalError } from '@/components/reminder-schedule-fields';
import { PanelTitle } from '@/components/ui/panel';
import {
  BUKAN_AKTIF_HINT,
  LastWaCell,
  STATUS_META,
  STATUS_ORDER,
  STATUS_SHORT,
  scheduleLabel,
  type ScheduleItem,
  type ScheduleResponse,
} from '../../schedule-shared';

// Jadwal servis semua set AC milik SATU pelanggan (dibuka dari daftar Monitoring Jadwal). Aksi per set AC
// (kirim pengingat sekarang, atur siklus) ada di sini, bukan di daftar utama.

export function MemberScheduleClient({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ScheduleItem | null>(null);
  const [sending, setSending] = React.useState<ScheduleItem | null>(null);

  const query = useQuery({
    queryKey: ['reminders', 'schedule', 'member', memberId],
    queryFn: () =>
      apiClient.get<ScheduleResponse>(`/reminders/schedule?memberId=${encodeURIComponent(memberId)}&pageSize=100`),
  });
  const items = query.data?.items ?? [];
  const member = items[0]?.member;

  // Kembali ke daftar dengan pencarian/filter/halaman yang tadi dipakai (tersimpan di URL daftar).
  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push('/reminder-wa');
  }

  const statusCounts = STATUS_ORDER.map((st) => ({ st, n: items.filter((u) => u.status === st).length })).filter(
    (c) => c.n > 0,
  );

  return (
    <div className="grid gap-4">
      <div>
        <button
          type="button"
          onClick={goBack}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Kembali
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{member?.name ?? 'Jadwal servis pelanggan'}</h1>
          {member?.waOptOut && <Badge variant="secondary">Opt-out WA</Badge>}
        </div>
        {member && (
          <p className="mt-1 text-sm text-muted-foreground">
            {member.phone ? (
              member.phone
            ) : (
              <span className="text-amber-700 dark:text-amber-400">Tanpa nomor HP, WA tidak bisa dikirim</span>
            )}
            {' · '}
            {items.length} set AC
            {' · '}
            <Link href={`/members/${memberId}`} className="font-medium text-foreground hover:underline">
              Lihat data pelanggan
            </Link>
          </p>
        )}
        {statusCounts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {statusCounts.map(({ st, n }) => (
              <Badge key={st} variant={STATUS_META[st].badge} title={`${n} AC: ${STATUS_META[st].label}`}>
                {STATUS_SHORT[st]} · {n}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground">Memuat jadwal...</p>}
      {query.isError && <p className="text-sm text-destructive">Gagal memuat jadwal servis pelanggan ini.</p>}
      {query.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Pelanggan ini belum punya AC yang dipantau (AC belum dipasang, atau pelanggan sudah nonaktif).{' '}
          <Link href={`/members/${memberId}`} className="font-medium text-foreground hover:underline">
            Lihat data pelanggan
          </Link>
        </p>
      )}

      {items.length > 0 && <UnitScheduleTable items={items} onEdit={setEditing} onSend={setSending} />}

      {editing && <AturDialog key={editing.id} item={editing} onClose={() => setEditing(null)} />}
      {sending && <KirimDialog key={sending.id} item={sending} onClose={() => setSending(null)} />}
    </div>
  );
}

/** Tabel set AC satu pelanggan: servis terakhir, siklus, jadwal berikutnya, WA terakhir, dan aksi. */
export function UnitScheduleTable({
  items,
  onEdit,
  onSend,
}: {
  items: ScheduleItem[];
  onEdit: (u: ScheduleItem) => void;
  onSend: (u: ScheduleItem) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <PanelTitle title="Set AC milik pelanggan" count={items.length} />
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>AC</TableHead>
              <TableHead>Servis terakhir</TableHead>
              <TableHead>Siklus</TableHead>
              <TableHead>Jadwal berikutnya</TableHead>
              <TableHead className="hidden xl:table-cell">WA terakhir</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((u) => {
              const noPhone = !u.member.phone;
              return (
                <TableRow key={u.id} className={cn(u.status === 'mati' && 'opacity-60')}>
                  <TableCell>
                    <div className="font-medium">{u.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {[u.roomLocation, u.pk ? `${u.pk} PK` : null].filter(Boolean).join(' · ') || '-'}
                    </div>
                  </TableCell>
                  <TableCell>{u.lastServiceDate ? formatDate(u.lastServiceDate) : '-'}</TableCell>
                  <TableCell>{u.serviceIntervalDays ? `${u.serviceIntervalDays} hari` : '-'}</TableCell>
                  <TableCell>
                    <div>{u.nextServiceDate ? formatDate(u.nextServiceDate) : '-'}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant={STATUS_META[u.status].badge}>{scheduleLabel(u)}</Badge>
                      {u.adaJobBerjalan && <Badge variant="outline">Job berjalan</Badge>}
                      {/* Status "Dalam Maintenance" tanpa job berjalan = tersangkut: pengingat otomatis hanya
                          memproses unit berstatus Aktif, jadi AC ini dilewati sampai statusnya diperbaiki. */}
                      {u.unitStatus === 'dalam_maintenance' && !u.adaJobBerjalan && (
                        <Badge variant="warning" title={BUKAN_AKTIF_HINT}>
                          Status bukan Aktif
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <LastWaCell lastWa={u.lastWa} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!u.reminderEnabled || !u.nextServiceDate || noPhone || u.member.waOptOut}
                        title={
                          !u.reminderEnabled
                            ? 'Pengingat mati'
                            : !u.nextServiceDate
                              ? 'Belum ada jadwal servis'
                              : noPhone
                                ? 'Pelanggan tidak punya nomor HP'
                                : u.member.waOptOut
                                  ? 'Pelanggan memilih tidak menerima WA'
                                  : 'Kirim pengingat sekarang lewat WhatsApp'
                        }
                        onClick={() => onSend(u)}
                      >
                        Kirim WA
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" aria-label="Aksi lainnya" title="Aksi lainnya">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(u)}>Atur siklus pengingat</DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/ac-units/${u.id}`}>Lihat detail AC</Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
      // Prefix ini mencakup daftar per pelanggan, daftar AC per pelanggan, dan hitungan kartu.
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
            {item.member.name} - {item.label}
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
