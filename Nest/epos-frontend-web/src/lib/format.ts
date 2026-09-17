// Helper format angka/tanggal yang dipakai berulang di seluruh halaman
// (POS, laporan, riwayat servis, dll) — biar konsisten Rp & format tanggal
// Indonesia di satu tempat, gak copy-paste Intl.NumberFormat di tiap page.

export function formatRupiah(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

// "Selasa, 2 September 2026" — padanan formatTanggalPanjang() di app mobile,
// dipakai buat subjudul header dashboard.
export function formatDateLong(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

// Label ramah-manusia buat status job/invoice — dipetakan manual (bukan
// cuma capitalize) karena istilahnya snake_case dari backend
// (mis. 'menunggu_penugasan', 'kurang_bayar').
const STATUS_LABELS: Record<string, string> = {
  menunggu_penugasan: 'Menunggu Penugasan',
  assigned: 'Ditugaskan',
  sedang_dikerjakan: 'Sedang Dikerjakan',
  menunggu_review: 'Menunggu Review',
  selesai: 'Selesai',
  dibatalkan: 'Dibatalkan',
  belum_dibayar: 'Belum Dibayar',
  dp: 'DP',
  kurang_bayar: 'Kurang Bayar',
  lunas: 'Lunas',
  pending: 'Pending',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  // Status MemberAcUnit — dipakai halaman Member & detail unit AC.
  aktif: 'Aktif',
  menunggu_pemasangan: 'Menunggu Pemasangan',
  dalam_maintenance: 'Dalam Maintenance',
  // Sisa InvoiceStatus yang belum ke-cover di atas — dipakai halaman
  // Riwayat Transaksi.
  refund: 'Refund',
  batal: 'Batal',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// "5 menit lalu" dkk — dipakai bell notifikasi (NotificationBell) biar gak
// perlu mikirin tanggal buat notif yang baru aja masuk. Lewat 7 hari jatuh
// balik ke formatDate biasa (relative time buat notif seminggu lalu gak
// informatif lagi).
export function formatRelativeTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);

  if (diffSec < 5) return 'Baru saja';
  if (diffSec < 60) return `${diffSec} detik lalu`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return formatDate(d);
}
