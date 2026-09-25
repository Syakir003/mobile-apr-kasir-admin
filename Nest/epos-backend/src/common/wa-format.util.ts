/**
 * Helper format WA — port 1:1 dari `wa_phone()` dan `tgl_id()` di migrasi
 * Supabase 20260815000023_service_reminders.sql. Nest tidak mengirim WA
 * sendiri (lihat src/wa-outbox/wa-outbox.service.ts); helper ini cuma
 * dipakai supaya nomor & tanggal yang ditampilkan/disiapkan untuk link
 * wa.me manual identik perilakunya dengan yang dibentuk di SQL.
 */

/**
 * Normalisasi nomor HP ke format internasional tanpa '+'. '0812…' ->
 * '62812…', '+62 812-345' -> '62812345'. String kosong/tanpa digit
 * dikembalikan '' apa adanya supaya pemanggil bisa menyaring nomor yang
 * tidak valid.
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
