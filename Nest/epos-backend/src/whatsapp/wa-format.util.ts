/**
 * Helper format WA — port 1:1 dari `wa_phone()` dan `tgl_id()` di migrasi
 * Supabase 20260815000023_service_reminders.sql, biar nomor & tanggal yang
 * dikirim ke Fonnte identik perilakunya dengan app mobile lama.
 */

/**
 * Normalisasi nomor HP ke format internasional tanpa '+', dipakai sebagai
 * `target` Fonnte. '0812…' -> '62812…', '+62 812-345' -> '62812345'.
 * String kosong/tanpa digit dikembalikan '' apa adanya supaya pemanggil bisa
 * menyaring member tanpa nomor yang valid (jangan sampai nge-hit Fonnte
 * dengan target kosong).
 */
export function waPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits === '') return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return '62' + digits;
}

const BULAN_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * Tanggal berbahasa Indonesia: "15 Agustus 2026". Dibaca dari komponen UTC
 * Date-nya (bukan lokal) karena `dueDate` disimpan sebagai kolom `@db.Date`
 * (Prisma balikin itu sebagai Date jam 00:00:00 UTC) — pakai getMonth() lokal
 * di sini beresiko geser tanggal kalau proses Node TZ-nya bukan UTC.
 */
export function formatTanggalId(date: Date | null | undefined): string {
  if (!date) return '-';
  const day = date.getUTCDate();
  const month = BULAN_ID[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}
