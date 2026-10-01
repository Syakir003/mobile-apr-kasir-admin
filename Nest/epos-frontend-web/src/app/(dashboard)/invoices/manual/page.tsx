import { redirect } from 'next/navigation';

// "Input Transaksi Manual" dipindah & disempurnakan jadi "Input Data Lampau"
// di grup Administrasi (2026-10-01). Rute lama diarahkan supaya bookmark
// tetap jalan.
export default function ManualInvoiceRedirect() {
  redirect('/administrasi/data-lampau');
}
