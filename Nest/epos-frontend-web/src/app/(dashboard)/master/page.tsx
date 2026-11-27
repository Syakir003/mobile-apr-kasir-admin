import { redirect } from 'next/navigation';

// Halaman hub "Master Data" (empat kartu Produk/Sparepart/Jasa/Paket) DIHAPUS: isinya hanya mengulang grup menu
// "Data Master" di sidebar (nav-config.ts), jadi tidak ada informasi yang hilang. Rute ini disisakan sebagai redirect
// supaya bookmark/tautan lama tetap jalan (jalur akses: proxy.ts tetap menjaga prefix /master per peran).
export default function MasterDataPage() {
  redirect('/master/produk');
}
