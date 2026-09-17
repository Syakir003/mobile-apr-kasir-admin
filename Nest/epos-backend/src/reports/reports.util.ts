import { BadRequestException } from '@nestjs/common';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse rentang tanggal dari query string `from`/`to` (format "YYYY-MM-DD").
 * `to` dibikin inklusif sampai akhir hari itu (23:59:59.999) — biar
 * `from=to=hari-ini` beneran nyakup semua transaksi hari ini, bukan cuma
 * jam 00:00:00.
 *
 * PENTING: toko ini WIB (UTC+7), dipaksa eksplisit di sini lewat offset
 * `+07:00` — BUKAN ngandelin timezone lokal proses Node (`setHours` versi
 * lama). Kalau server-nya di-deploy dengan TZ=UTC (umum buat VM/cloud),
 * versi lama bikin `start` jatuh di UTC 00:00 (=WIB 07:00) tapi `end` di UTC
 * 23:59:59.999 (=WIB 06:59:59.999 KEESOKAN harinya) — jendela laporan jadi
 * cuma nyakup ~17 jam, dan jam 00:00–07:00 WIB tiap hari SELALU bolong di
 * SEMUA laporan (sales/service/profit-loss) berapa pun rentang yang dipilih,
 * gak ketahuan karena query-nya tetep jalan tanpa error. */
export function parseDateRange(from: string, to: string) {
  const start = DATE_ONLY.test(from) ? new Date(`${from}T00:00:00.000+07:00`) : new Date(from);
  const end = DATE_ONLY.test(to) ? new Date(`${to}T23:59:59.999+07:00`) : new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException('Format `from`/`to` tidak valid (pakai YYYY-MM-DD)');
  }
  if (start.getTime() > end.getTime()) throw new BadRequestException('`from` tidak boleh setelah `to`');
  return { start, end };
}
