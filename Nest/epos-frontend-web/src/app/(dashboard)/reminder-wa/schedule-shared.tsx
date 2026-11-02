import * as React from 'react';

import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';

// Bagian bersama Monitoring Jadwal servis: daftar per pelanggan (monitoring-tab.tsx) dan halaman AC milik
// satu pelanggan (member/[id]). "Unit AC" = 1 set AC (indoor+outdoor) = 1 pengingat. Sinkron dengan
// ScheduleStatus di backend (reminders/service-schedule.util.ts).

export type ScheduleStatus =
  | 'terlambat'
  | 'segera'
  | 'bulan_ini'
  | 'aman'
  | 'belum_terjadwal'
  | 'siklus_kosong'
  | 'mati'
  | 'menunggu_data';

/** Urutan prioritas (sama dengan SCHEDULE_STATUSES di backend). */
export const STATUS_ORDER: ScheduleStatus[] = [
  'terlambat',
  'segera',
  'bulan_ini',
  'aman',
  'belum_terjadwal',
  'siklus_kosong',
  'mati',
  'menunggu_data',
];

export const STATUS_META: Record<
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
  menunggu_data: { label: 'Menunggu data teknisi', badge: 'outline' },
};

/** Label pendek untuk lencana "jumlah AC per status" (ditulis "label · jumlah", mis. "8–30 hari · 2"). */
export const STATUS_SHORT: Record<ScheduleStatus, string> = {
  terlambat: 'Terlambat',
  segera: 'Segera',
  bulan_ini: '8–30 hari',
  aman: 'Aman',
  belum_terjadwal: 'Belum terjadwal',
  siklus_kosong: 'Siklus kosong',
  mati: 'Pengingat mati',
  menunggu_data: 'Menunggu data',
};

// Selisih hari kalender (WIB) dari hari ini: negatif = sudah lewat.
const wibDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
export function daysUntil(iso: string): number {
  const [y1, m1, d1] = wibDay(new Date(iso)).split('-').map(Number);
  const [y2, m2, d2] = wibDay(new Date()).split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

// Label badge jadwal: "Terlambat 20 hari" / "3 hari lagi" menggantikan label kategori
// yang kurang jelas ("Segera (≤7 hari)"). Status lain tetap memakai label bawaan.
export function scheduleLabel(u: { status: ScheduleStatus; nextServiceDate: string | null }): string {
  const timed = u.status === 'terlambat' || u.status === 'segera' || u.status === 'bulan_ini' || u.status === 'aman';
  if (!timed || !u.nextServiceDate) return STATUS_META[u.status].label;
  const n = daysUntil(u.nextServiceDate);
  return n < 0 ? `Terlambat ${-n} hari` : n === 0 ? 'Jatuh tempo hari ini' : `${n} hari lagi`;
}

export const WA_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu',
  terkirim: 'Terkirim',
  gagal: 'Gagal',
  dibatalkan: 'Dibatalkan',
};

/** Penjelasan lencana "Status bukan Aktif" (unit Dalam Maintenance tanpa job berjalan). */
export const BUKAN_AKTIF_HINT =
  'Status unit Dalam Maintenance tanpa job yang berjalan. Pengingat otomatis hanya memproses unit berstatus Aktif, jadi AC ini dilewati. Ubah status ke Aktif di halaman detail unit.';

export interface LastWa {
  kind: string;
  status: string;
  error: string | null;
  at: string;
}

/** Satu set AC (GET /reminders/schedule). */
export interface ScheduleItem {
  id: string;
  label: string;
  roomLocation: string | null;
  pk: string | null;
  member: { id: string; name: string; phone: string | null; waOptOut: boolean };
  lastServiceDate: string | null;
  serviceIntervalDays: number | null;
  nextServiceDate: string | null;
  reminderEnabled: boolean;
  // Status unit AC (bukan klasifikasi jadwal di `status`): 'aktif' | 'dalam_maintenance' | dst.
  unitStatus?: string;
  status: ScheduleStatus;
  adaJobBerjalan: boolean;
  lastWa: LastWa | null;
}

export interface ScheduleResponse {
  counts: Record<ScheduleStatus, number>;
  items: ScheduleItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Satu pelanggan beserta ringkasan semua set AC-nya (GET /reminders/schedule/members). */
export interface MemberScheduleItem {
  memberId: string;
  name: string;
  phone: string | null;
  waOptOut: boolean;
  unitCount: number;
  /** Jumlah set AC milik pelanggan ini per status jadwal. */
  counts: Record<ScheduleStatus, number>;
  /** Jadwal servis paling awal di antara set AC yang pengingatnya menyala. */
  nextService: { date: string; status: ScheduleStatus } | null;
  jobBerjalanCount: number;
  bukanAktifCount: number;
  lastWa: LastWa | null;
}

export interface MemberScheduleResponse {
  /** Hitungan per set AC (bukan per pelanggan), untuk kartu ringkasan. */
  counts: Record<ScheduleStatus, number>;
  items: MemberScheduleItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Status & tanggal pesan WA pengingat terakhir (atau "Belum ada"). */
export function LastWaCell({ lastWa }: { lastWa: LastWa | null }) {
  if (!lastWa) return <span className="text-xs text-muted-foreground">Belum ada</span>;
  return (
    <div>
      <Badge
        variant={lastWa.status === 'terkirim' ? 'success' : lastWa.status === 'gagal' ? 'destructive' : 'secondary'}
        title={lastWa.error ?? undefined}
      >
        {WA_STATUS_LABEL[lastWa.status] ?? lastWa.status}
      </Badge>
      <div className="mt-1 text-xs text-muted-foreground">{formatDate(lastWa.at)}</div>
      {lastWa.status === 'gagal' && lastWa.error && (
        <div className="mt-0.5 max-w-40 text-xs whitespace-normal text-destructive">{lastWa.error}</div>
      )}
    </div>
  );
}
