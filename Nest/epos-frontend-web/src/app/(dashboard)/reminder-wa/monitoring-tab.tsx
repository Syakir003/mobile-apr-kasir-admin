'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock,
  BellOff,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Hourglass,
  Search,
  type LucideIcon,
} from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
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
import { PanelTitle } from '@/components/ui/panel';
import {
  BUKAN_AKTIF_HINT,
  LastWaCell,
  STATUS_META,
  STATUS_ORDER,
  STATUS_SHORT,
  scheduleLabel,
  type MemberScheduleItem,
  type MemberScheduleResponse,
  type ScheduleStatus,
} from './schedule-shared';

// Monitoring jadwal servis. 1 baris = 1 PELANGGAN dengan ringkasan semua set AC-nya (1 set = indoor+outdoor
// = 1 pengingat); klik baris untuk melihat dan mengatur tiap set AC di halaman pelanggan itu
// (member/[id]). Sinkron dengan ScheduleStatus di backend (reminders/service-schedule.util.ts).

// Ringkasan jadwal: satu deret sel netral, bukan enam kartu berwarna. Satu-satunya penekanan warna:
// angka "Terlambat" memakai warna bahaya saat > 0, dan sel yang sedang jadi filter memakai warna utama.
// Angka di kartu = jumlah SET AC (bukan jumlah pelanggan).
const CARDS: { status: ScheduleStatus; title: string; icon: LucideIcon }[] = [
  { status: 'terlambat', title: 'Terlambat', icon: AlarmClock },
  { status: 'segera', title: '7 hari ke depan', icon: CalendarClock },
  { status: 'bulan_ini', title: '8–30 hari', icon: CalendarDays },
  { status: 'siklus_kosong', title: 'Siklus belum diisi', icon: CircleHelp },
  { status: 'mati', title: 'Pengingat mati', icon: BellOff },
  { status: 'menunggu_data', title: 'Menunggu data teknisi', icon: Hourglass },
];

function parseStatus(value: string | null): ScheduleStatus | 'semua' {
  return value && (STATUS_ORDER as string[]).includes(value) ? (value as ScheduleStatus) : 'semua';
}

export function MonitoringTab() {
  // Pencarian, filter, dan halaman disimpan di URL: tombol Kembali dari halaman pelanggan membawa kembali ke
  // daftar yang sama. replaceState tidak memicu navigasi/permintaan server dan useSearchParams ikut berubah.
  const searchParams = useSearchParams();
  const status = parseStatus(searchParams.get('status'));
  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Math.floor(Number(searchParams.get('page'))) || 1);
  const [qInput, setQInput] = React.useState(q);

  function setParams(next: { status?: ScheduleStatus | 'semua'; q?: string; page?: number }) {
    const merged = { status, q, page, ...next };
    const params = new URLSearchParams();
    if (merged.status !== 'semua') params.set('status', merged.status);
    if (merged.q) params.set('q', merged.q);
    if (merged.page > 1) params.set('page', String(merged.page));
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }

  const query = useQuery({
    // Prefix ['reminders', 'schedule'] sama dengan halaman pelanggan, jadi simpan/kirim di sana ikut menyegarkan daftar ini.
    queryKey: ['reminders', 'schedule', 'members', { status, q, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (status !== 'semua') params.set('status', status);
      if (q) params.set('q', q);
      return apiClient.get<MemberScheduleResponse>(`/reminders/schedule/members?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
  const data = query.data;

  function pickStatus(next: ScheduleStatus | 'semua') {
    setParams({ status: next, page: 1 });
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-card shadow-sm md:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
        {CARDS.map((c) => {
          const active = status === c.status;
          const count = data?.counts[c.status];
          return (
            <button
              key={c.status}
              type="button"
              aria-pressed={active}
              onClick={() => pickStatus(active ? 'semua' : c.status)}
              className={cn(
                'grid gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active && 'bg-accent',
              )}
            >
              <span className="flex items-start gap-1.5 text-xs leading-tight text-muted-foreground">
                <c.icon className="mt-px size-3.5 shrink-0" />
                {c.title}
              </span>
              <span
                className={cn(
                  'text-2xl leading-none font-semibold tabular-nums',
                  c.status === 'terlambat' && !!count && 'text-destructive',
                  active && c.status !== 'terlambat' && 'text-primary',
                )}
              >
                {count ?? '–'}
              </span>
            </button>
          );
        })}
      </div>

      <p className="-mt-2 text-xs text-muted-foreground">
        Angka di kartu = jumlah set AC. Klik kartu untuk menampilkan pelanggan yang punya AC di status itu. Daftar
        diurutkan dari jadwal servis terdekat; klik pelanggan untuk melihat semua AC-nya.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex w-full gap-2 sm:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: qInput.trim(), page: 1 });
          }}
        >
          <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Cari pelanggan, HP, lokasi, AC..."
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
          </div>
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
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <MemberScheduleTable
        items={data?.items}
        total={data?.total}
        isLoading={query.isLoading}
        isError={query.isError}
      />

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParams({ page: page - 1 })}>
            Sebelumnya
          </Button>
          <span>
            Hal. {data.page} / {data.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => setParams({ page: page + 1 })}
          >
            Berikutnya
          </Button>
        </div>
      )}
    </div>
  );
}

/** Daftar pelanggan dengan ringkasan set AC-nya; klik baris membuka halaman AC pelanggan itu. */
export function MemberScheduleTable({
  items,
  total,
  isLoading,
  isError,
}: {
  items: MemberScheduleItem[] | undefined;
  total: number | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const router = useRouter();

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <PanelTitle title="Jadwal servis per pelanggan" count={total} />
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Pelanggan</TableHead>
              <TableHead>AC</TableHead>
              <TableHead>Status jadwal</TableHead>
              <TableHead>Jadwal terdekat</TableHead>
              <TableHead className="hidden xl:table-cell">WA terakhir</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Buka</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Memuat jadwal...
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-destructive">
                  Gagal memuat jadwal servis.
                </TableCell>
              </TableRow>
            )}
            {items && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Tidak ada pelanggan yang cocok dengan filter ini.
                </TableCell>
              </TableRow>
            )}
            {items?.map((m) => {
              const href = `/reminder-wa/member/${m.memberId}`;
              const allOff = m.unitCount > 0 && m.counts.mati === m.unitCount;
              return (
                <TableRow
                  key={m.memberId}
                  className={cn('cursor-pointer', allOff && 'opacity-60')}
                  onClick={() => router.push(href)}
                >
                  <TableCell>
                    <Link
                      href={href}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {m.name}
                    </Link>
                    {m.phone ? (
                      <div className="text-xs text-muted-foreground">{m.phone}</div>
                    ) : (
                      <div className="text-xs text-amber-700 dark:text-amber-400">
                        Tanpa nomor HP, WA tidak bisa dikirim
                      </div>
                    )}
                    {m.waOptOut && (
                      <Badge variant="secondary" className="mt-1">
                        Opt-out WA
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{m.unitCount} AC</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {STATUS_ORDER.filter((st) => m.counts[st] > 0).map((st) => (
                        <Badge
                          key={st}
                          variant={STATUS_META[st].badge}
                          title={`${m.counts[st]} AC: ${STATUS_META[st].label}`}
                        >
                          {STATUS_SHORT[st]} · {m.counts[st]}
                        </Badge>
                      ))}
                      {m.jobBerjalanCount > 0 && <Badge variant="outline">Job berjalan · {m.jobBerjalanCount}</Badge>}
                      {/* Status "Dalam Maintenance" tanpa job berjalan = tersangkut: pengingat otomatis hanya
                          memproses unit berstatus Aktif, jadi AC itu dilewati sampai statusnya diperbaiki. */}
                      {m.bukanAktifCount > 0 && (
                        <Badge variant="warning" title={BUKAN_AKTIF_HINT}>
                          Status bukan Aktif · {m.bukanAktifCount}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.nextService ? (
                      <>
                        <div>{formatDate(m.nextService.date)}</div>
                        <Badge variant={STATUS_META[m.nextService.status].badge} className="mt-1">
                          {scheduleLabel({ status: m.nextService.status, nextServiceDate: m.nextService.date })}
                        </Badge>
                      </>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <LastWaCell lastWa={m.lastWa} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
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
