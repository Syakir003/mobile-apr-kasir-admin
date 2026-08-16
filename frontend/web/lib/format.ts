/** Rupiah dengan pemisah ribuan titik (mirror app formatRupiah). */
export function formatRupiah(value: number): string {
  return "Rp" + Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const BULAN = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/**
 * `20 Agustus 2026` — untuk tanggal jatuh tempo servis.
 *
 * Bagian tanggalnya dipotong sebagai teks, bukan lewat `new Date()`: kolom
 * `date` Postgres datang sebagai "YYYY-MM-DD" dan `new Date("2026-08-20")`
 * dibaca sebagai tengah malam UTC, yang di zona waktu barat mundur sehari.
 */
export function formatTanggalPanjang(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${BULAN[m - 1]} ${y}`;
}

/** Tanggal ringkas: DD-MM-YYYY HH:mm (waktu lokal). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
