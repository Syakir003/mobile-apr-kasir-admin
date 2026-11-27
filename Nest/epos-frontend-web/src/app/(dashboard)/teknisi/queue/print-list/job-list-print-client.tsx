'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';

import { apiClient } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { wibDateKey } from '@/lib/wib-date';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  matchesStatusTab,
  NO_TECHNICIAN,
  NO_TYPE_TEXT,
  groupByOrder,
  jobLocation,
  jobMatchesTechnician,
  rowSearchText,
  technicianOptions,
  typeMeta,
  unitTypeText,
  type QueueRow,
  type TechnicianJob,
} from '../queue-client';
import { ErrorBlock, LoadingBlock } from '@/components/query-state';

type StatusFilter = 'aktif' | 'review' | 'selesai' | 'semua';
const STATUS_LABEL: Record<StatusFilter, string> = {
  aktif: 'Aktif',
  review: 'Menunggu Review',
  selesai: 'Selesai',
  semua: 'Semua status',
};

// Tanggal jadwal satu baris (servis banyak AC: satu order = satu jadwal). Tanpa jadwal = ''.
const rowDate = (row: QueueRow) => {
  const s = row.jobs.find((j) => j.scheduledDate)?.scheduledDate;
  return s ? wibDateKey(s) : '';
};
const dayHeading = (key: string) =>
  key
    ? new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(`${key}T00:00:00Z`),
      )
    : 'Tanpa jadwal';

/**
 * Daftar pekerjaan servis siap cetak: pelanggan, lokasi kerja, unit AC, jenis pekerjaan, jadwal, dan catatan. Sengaja
 * TANPA nama teknisi, status, dan harga: lembar ini daftar apa yang dikerjakan. Filter: rentang tanggal jadwal, status,
 * dan kata kunci (nilai awal dari filter yang sedang aktif di Antrian Servis). Servis banyak AC tetap satu baris.
 */
export function JobListPrintClient({
  initialFrom,
  initialTo,
  initialStatus,
  initialQuery,
  initialTechnician,
}: {
  initialFrom: string;
  initialTo: string;
  initialStatus: StatusFilter;
  initialQuery: string;
  initialTechnician: string;
}) {
  const router = useRouter();
  const [from, setFrom] = React.useState(initialFrom);
  const [to, setTo] = React.useState(initialTo);
  const [status, setStatus] = React.useState<StatusFilter>(initialStatus);
  const [query, setQuery] = React.useState(initialQuery);
  // Filter teknisi hanya menyaring pekerjaan; nama teknisi tetap tidak dicetak.
  const [technician, setTechnician] = React.useState(initialTechnician);

  // Kunci yang sama dengan Antrian Servis (admin/kasir): data dibagi lewat cache, tidak diambil dua kali.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['technician-jobs', 'all'],
    queryFn: () => apiClient.get<TechnicianJob[]>('/technician-jobs'),
  });

  const rows = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = (data ?? []).filter((j) => {
      if (j.status === 'dibatalkan') return false; // pekerjaan batal tidak masuk daftar, di status apa pun
      // Sama persis dengan tab di Antrian Servis (satu fungsi): Aktif tanpa yang menunggu review.
      if (status !== 'semua' && !matchesStatusTab(j, status)) return false;
      if (!jobMatchesTechnician(j, technician)) return false;
      if (from || to) {
        if (!j.scheduledDate) return false; // tanpa jadwal tidak masuk bila tanggal dibatasi
        const key = wibDateKey(j.scheduledDate);
        if (from && key < from) return false;
        if (to && key > to) return false;
      }
      return true;
    });
    return groupByOrder(filtered)
      .filter((r) => !term || rowSearchText(r, false).includes(term))
      .sort((a, b) => {
        const da = rowDate(a);
        const db = rowDate(b);
        if (da !== db) return da === '' ? 1 : db === '' ? -1 : da < db ? -1 : 1;
        return (a.jobs[0].member?.name ?? '').localeCompare(b.jobs[0].member?.name ?? '', 'id');
      });
  }, [data, status, from, to, query, technician]);
  const techChoices = React.useMemo(() => technicianOptions(data ?? [], []), [data]);

  const byDay = React.useMemo(() => {
    const m = new Map<string, QueueRow[]>();
    for (const r of rows) m.set(rowDate(r), [...(m.get(rowDate(r)) ?? []), r]);
    return [...m.entries()];
  }, [rows]);

  const totalUnits = rows.reduce((n, r) => n + r.jobs.length, 0);
  const periode =
    from && to
      ? from === to
        ? formatDate(from)
        : `${formatDate(from)} - ${formatDate(to)}`
      : from
        ? `mulai ${formatDate(from)}`
        : to
          ? `sampai ${formatDate(to)}`
          : 'Semua tanggal';
  const printedAt = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
  const cell = 'border border-black px-1.5 py-1 align-top';
  const head = 'border border-black bg-gray-200 px-1 py-1.5 text-center align-middle text-[11px] font-bold leading-tight';
  // Lebar kolom (px @96dpi, A4 landscape ~1047px): kolom teks panjang dapat sisa lebar.
  const widths = [32, 150, undefined, 250, 110, 190];

  return (
    <div className="mx-auto max-w-[297mm]">
      <style>{`@page { size: A4 landscape; margin: 10mm; }
        .joblist-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .joblist-print thead { display: table-header-group; }
        .joblist-print tr { break-inside: avoid; }`}</style>

      {/* Kontrol (tidak ikut tercetak): filter tanggal, status, kata kunci. */}
      <div className="mb-4 grid gap-3 rounded-lg border p-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => router.push('/teknisi/queue')}>
            <ArrowLeft className="size-4" />
            Kembali
          </Button>
          <Button onClick={() => window.print()} disabled={rows.length === 0}>
            <Printer className="size-4" />
            Cetak ({rows.length} pekerjaan)
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Dari tanggal</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Sampai tanggal</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" />
          </label>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Status</span>
            <div className="flex gap-1.5">
              {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={status === k ? 'default' : 'outline'}
                  aria-pressed={status === k}
                  onClick={() => setStatus(k)}
                >
                  {STATUS_LABEL[k]}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Teknisi</span>
            <Select value={technician} onValueChange={setTechnician}>
              <SelectTrigger aria-label="Filter teknisi" className="h-9 w-52 text-sm">
                <SelectValue placeholder="Semua teknisi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua teknisi</SelectItem>
                <SelectItem value={NO_TECHNICIAN}>Belum ditugaskan</SelectItem>
                {techChoices.options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="grid min-w-48 flex-1 gap-1">
            <span className="text-xs text-muted-foreground">Kata kunci (pelanggan, unit, lokasi)</span>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Opsional" className="h-9" />
          </label>
          {(from || to) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Semua tanggal
            </Button>
          )}
        </div>
      </div>

      {isLoading && <LoadingBlock label="Memuat daftar pekerjaan" className="p-6 print:hidden" />}
      {isError && <ErrorBlock title="Gagal memuat daftar pekerjaan" detail="Periksa koneksi internet, lalu muat ulang halaman." className="p-6 print:hidden" />}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="p-6 text-sm text-muted-foreground print:hidden">
          Tidak ada pekerjaan pada filter ini. Ubah tanggal atau status di atas.
        </p>
      )}

      {rows.length > 0 && (
        <div className="joblist-print bg-white p-2 text-black">
          {/* Kop surat: sama dengan laporan stok. */}
          <div className="flex items-center gap-4 border-b-2 border-black pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-apr-hd.png" alt="APR" className="h-auto w-24 shrink-0" />
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold tracking-wide">AYUB AC</p>
              <p className="text-[11px]">Penjualan • Service • Spare Part • Rental AC</p>
              <p className="text-[11px]">JL. GUNUNG ANYAR RT. 01 RW. 06, KEL. GUNUNG GEDANGAN - MOJOKERTO</p>
              <p className="text-[11px]">Telp. 0857 332 7112 - 0822 3388 9990 - 0321 - 325831</p>
            </div>
            <div className="w-24 shrink-0" aria-hidden />
          </div>
          <p className="mt-2 text-center text-lg font-bold uppercase tracking-wide">Daftar Pekerjaan Servis</p>
          <div className="mt-1.5 flex justify-between text-[11px]">
            <p>
              Jadwal: <b>{periode}</b> • Status: <b>{STATUS_LABEL[status]}</b>
              {query.trim() && (
                <>
                  {' '}
                  • Kata kunci: <b>{query.trim()}</b>
                </>
              )}
            </p>
            <p>Dicetak: {printedAt}</p>
          </div>

          <table className="mt-2 w-full table-fixed border-collapse border border-black text-[12px]">
            <colgroup>
              {widths.map((w, i) => (
                <col key={i} style={w ? { width: `${w}px` } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={head}>No</th>
                <th className={head}>Pelanggan</th>
                <th className={head}>Unit AC</th>
                <th className={head}>Lokasi Kerja</th>
                <th className={head}>Jenis</th>
                <th className={head}>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let no = 0;
                return byDay.flatMap(([day, dayRows]) => [
                  <tr key={`h-${day || 'none'}`}>
                    <td colSpan={6} className="border border-black bg-gray-100 px-1.5 py-1 text-[12px] font-bold">
                      {dayHeading(day)} <span className="font-normal">({dayRows.length} pekerjaan)</span>
                    </td>
                  </tr>,
                  ...dayRows.map((row) => {
                    no += 1;
                    const first = row.jobs[0];
                    const units = row.jobs.map(unitTypeText);
                    const locations = [...new Set(row.jobs.map(jobLocation).filter(Boolean))];
                    const types = [...new Set(row.jobs.map((j) => typeMeta(j.type).label))];
                    const note = row.jobs.map((j) => j.notes?.trim()).find(Boolean);
                    return (
                      <tr key={row.key}>
                        <td className={`${cell} text-center tabular-nums`}>{no}</td>
                        <td className={`${cell} font-semibold`}>{first.member?.name || 'Order servis'}</td>
                        <td className={cell}>
                          {units.length > 1 ? (
                            <>
                              <p className="font-semibold">{units.length} unit AC</p>
                              {units.map((u, i) => (
                                <p key={i}>
                                  {i + 1}. {u === NO_TYPE_TEXT ? 'tanpa tipe' : u}
                                </p>
                              ))}
                            </>
                          ) : (
                            units[0] || '-'
                          )}
                        </td>
                        <td className={cell}>
                          {locations.length === 0
                            ? '-'
                            : locations.map((l, i) => (
                                <p key={i}>{locations.length > 1 ? `${i + 1}. ${l}` : l}</p>
                              ))}
                        </td>
                        <td className={cell}>{types.join(', ')}</td>
                        <td className={cell}>{note ?? ''}</td>
                      </tr>
                    );
                  }),
                ]);
              })()}
            </tbody>
          </table>
          <p className="mt-2 text-[11px]">
            Total: <b>{rows.length}</b> pekerjaan ({totalUnits} unit AC)
          </p>
        </div>
      )}
    </div>
  );
}
