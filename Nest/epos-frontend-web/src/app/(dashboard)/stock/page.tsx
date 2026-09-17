import { redirect } from 'next/navigation';

// Halaman "Barang Masuk" berdiri sendiri DIHAPUS per 2026-09-15 — form
// stock-in-nya digabung langsung ke dialog "Lihat Batch" (Master > Produk)
// dan "Stok" (Master > Sparepart), lihat komentar di kedua halaman itu.
// Rute ini disisain sebagai redirect doang, biar bookmark/link lama (mis.
// dari toast notif sebelumnya) gak 404. `stock-client.tsx` di folder ini
// sekarang gak dipakai lagi — boleh dihapus manual kalau mau beres-beres.
export default function StockPage() {
  redirect('/master/produk');
}
