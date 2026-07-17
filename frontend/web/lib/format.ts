/** Rupiah dengan pemisah ribuan titik (mirror app formatRupiah). */
export function formatRupiah(value: number): string {
  return "Rp" + Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Tanggal ringkas: DD-MM-YYYY HH:mm (waktu lokal). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
