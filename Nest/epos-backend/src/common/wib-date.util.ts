/**
 * Helper WIB (UTC+7) BERSAMA — dipakai di tempat mana pun yang butuh
 * "tanggal hari ini menurut toko" tanpa bergantung timezone lokal proses
 * Node. Sama alasannya kayak `reports/reports.util.ts` (`parseDateRange`):
 * kalau server di-deploy TZ=UTC (umum buat VM/cloud), `new Date()` +
 * `setHours(0,0,0,0)` versi lama itung tengah malam UTC, bukan tengah malam
 * WIB — geser 7 jam. Ini fix dari audit lanjutan: `reports.util.ts` sudah
 * dibenerin pola ini sebelumnya, tapi `CountersService.dateKey()` (nomor
 * invoice harian) dan `DashboardService.summary()` ("hari ini") kelewat,
 * masing-masing masih pakai `getFullYear()/getMonth()/getDate()` dan
 * `setHours()` versi lama.
 *
 * Pakai `Intl.DateTimeFormat` dengan `timeZone: 'Asia/Jakarta'` — ini yang
 * BENERAN nanya "jam berapa ini di WIB", bukan cuma nge-geser angka manual
 * (dan otomatis bener soal DST kalau suatu saat ada, walau Indonesia gak
 * pakai DST — tetap lebih robust daripada hardcode offset di banyak tempat).
 */
const WIB_YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "YYYY-MM-DD" versi WIB dari sebuah instant (Date apa pun, timezone-nya
 * gak ngaruh — Date selalu instant absolut, cuma REPRESENTASI teksnya yang
 * di-render pakai timeZone Asia/Jakarta di sini). */
function wibDateParts(date: Date): string {
  // en-CA locale render sebagai YYYY-MM-DD langsung, gak perlu rakit manual.
  return WIB_YMD_FORMATTER.format(date);
}

/** "YYYYMMDD" (tanpa dash) — buat dipakai sebagai bagian key counter/nomor
 * invoice, gantiin CountersService.dateKey() versi lama. */
export function wibDateKey(date: Date): string {
  return wibDateParts(date).replace(/-/g, '');
}

/** Awal & akhir "hari ini" (atau tanggal dari `referenceDate` manapun) dalam
 * WIB, sebagai instant UTC yang bener — buat query `WHERE createdAt BETWEEN
 * start AND end`. */
export function wibDayRange(referenceDate: Date = new Date()): {
  start: Date;
  end: Date;
} {
  const ymd = wibDateParts(referenceDate);
  return {
    start: new Date(`${ymd}T00:00:00.000+07:00`),
    end: new Date(`${ymd}T23:59:59.999+07:00`),
  };
}

/**
 * Instant UTC yang merepresentasikan tengah malam dari TANGGAL KALENDER WIB
 * milik `date` (bukan tengah malam UTC) — dipakai buat nyimpen kolom
 * `@db.Date` (mis. WhatsappLog.dueDate di RemindersService) biar makna
 * "tanggal"-nya konsisten sama seluruh logic penjadwalan lain di sini yang
 * berbasis kalender WIB, bukan UTC. Nilai baliknya aman dibaca balik pakai
 * `getUTCFullYear()/getUTCMonth()/getUTCDate()` (lihat formatTanggalId di
 * whatsapp/wa-format.util.ts).
 */
export function wibDateOnly(date: Date): Date {
  return new Date(`${wibDateParts(date)}T00:00:00.000Z`);
}
