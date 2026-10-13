# Tipe Pembeli: Ritel, Installer, Reseller

Tanggal: 2026-10-13. Status: selesai (backend, form master, Member, POS, laporan).

## Tujuan

Harga dan hak beli berbeda menurut jenis member.

| Tipe | Siapa | AC | Sparepart | Jasa | Instalasi / Paket Instalasi |
|---|---|---|---|---|---|
| Ritel (`retail`) | Pembeli dan pemakai langsung | Ya | Ya | Ya | Ya |
| Installer (`installer`) | Teknisi luar, menjual lagi ke pelanggannya | Ya | Ya | Tidak | Tidak |
| Reseller (`reseller`) | Punya toko, menjual lagi. Harga paling murah | Ya | Ya | Tidak | Tidak |

Ini tipe pembeli, bukan role login. Role `admin`, `kasir`, `teknisi`, dan `gudang` tidak berubah.

## Keputusan

- Tipe melekat pada member (`Member.priceTier`, default `retail`). Checkout selalu memakai atau membuat member, jadi tidak ada pembeli tanpa tipe.
- Tipe selalu dibaca server dari database. Klien tidak mengirim harga.
- Kasir boleh memilih tipe **saat membuat member baru** (form Member atau saat checkout dengan nomor HP yang belum terdaftar). Mengubah tipe member yang sudah ada hanya boleh admin.
- Kasir tetap boleh mengganti harga manual (`unitPriceOverride`), memberi diskon, dan memakai voucher untuk semua tipe.
- Harga tipe yang belum diisi **memblokir** checkout tipe itu. Tidak ada fallback ke harga Ritel.
- Tipe di-snapshot ke invoice (`Invoice.priceTier`). Mengubah tipe member tidak mengubah invoice lama.

## Data

Migrasi `20261013000000_price_tiers`, hanya menambah:

- Enum `PriceTier`: `retail | installer | reseller`.
- `members.price_tier` dan `invoices.price_tier`, default `retail`.
- Tabel `tier_prices(kind, ref_id, tier, price, price_pack)`, unik per `(kind, ref_id, tier)`. `kind` adalah `product` atau `sparepart`. `price_pack` untuk harga utuh sparepart.

Harga Ritel tidak disimpan di `tier_prices`. Harga Ritel tetap `Product.sellPrice`, `Sparepart.sellPrice` (eceran), dan `Sparepart.sellPricePack` (utuh).

## API

Semua perubahan hanya menambah field, bentuk lama tetap berlaku.

| Endpoint | Perubahan |
|---|---|
| `GET /products`, `GET /products/:id` | Tambah `priceInstaller`, `priceReseller` (angka atau `null`) |
| `POST /products`, `PATCH /products/:id` | Terima `priceInstaller`, `priceReseller`. `null` menghapus harga. Tidak dikirim berarti tidak diubah |
| `GET /spareparts` | Tambah `priceInstaller`, `priceReseller`, `pricePackInstaller`, `pricePackReseller` |
| `POST /spareparts`, `PATCH /spareparts/:id` | Terima empat field di atas. Harga utuh butuh harga eceran tipe yang sama |
| `POST /members` | Terima `priceTier` (admin dan kasir) |
| `PATCH /members/:id/price-tier` | Baru. Body `{ priceTier }`. Admin saja |
| `POST /pos/checkout` | `customer.priceTier` opsional, hanya dipakai kalau member baru dibuat |
| `GET /reports/sales` | Tambah `perTipePembeli: [{ tier, total, count }]`, definisi total sama dengan `totalPenjualan` |

## Aturan checkout

1. Tipe diambil dari member di database.
2. Installer dan Reseller: baris `service` dan `installations` ditolak dengan 400.
3. Harga satuan produk: Outdoor pasangan Split tetap 0, lalu `unitPriceOverride` kalau dikirim, lalu harga tipe dari `tier_prices`, dan untuk Ritel `Product.sellPrice`.
4. Harga satuan sparepart: harga tipe (`price` untuk eceran, `price_pack` untuk utuh), dan untuk Ritel harga lama.
5. Cek jual di bawah modal memakai harga hasil langkah 3 dan 4, mekanisme `confirm_required` tidak berubah.

## Jejak audit

- `member.create_tiered`: checkout membuat member baru bertipe Installer atau Reseller.
- `member.create_manual`: detail sekarang menyertakan `priceTier`.
- `member.set_price_tier`: admin mengubah tipe, berisi tipe lama dan baru.

## Web

- Form Produk dan Sparepart: input Harga Installer dan Harga Reseller (sparepart mode kemasan: eceran dan utuh).
- Form Member: pilihan Tipe Pembeli saat membuat. Halaman detail member: admin bisa mengubah tipe.
- POS: tipe mengikuti member yang dipilih, atau dipilih kasir untuk pelanggan baru. Harga kartu dan keranjang mengikuti tipe. Untuk Installer dan Reseller, Jasa dan opsi pasang unit disembunyikan, dan saat tipe berganti keranjang disesuaikan (baris Jasa dan sparepart tanpa harga tipe dikeluarkan).
- POS hanya mengirim `unitPriceOverride` untuk harga yang diketik kasir atau harga manual murni (unit satuan dari paket). Harga katalog yang tidak diedit dihitung server dari tipe member di database.
- Produk tanpa harga tipe: kasir wajib mengisi harga manual. Sparepart tanpa harga tipe: kartunya dimatikan.
- Laporan Penjualan: tabel Penjualan per Tipe Pembeli.

## Risiko yang diterima

- Kasir bisa memberi harga Reseller ke siapa pun dengan mendaftarkannya sebagai Reseller baru. Jejaknya ada di Log Audit dan di tipe invoice.
- Nomor HP yang cocok dengan member Reseller membuat pembeli itu mendapat harga Reseller.
- App mobile tetap membaca harga Ritel sampai disesuaikan.
- Pelanggan baru bertipe Reseller yang nomor HP-nya ternyata sudah terdaftar sebagai Ritel: layar menampilkan harga Reseller, server menagih harga Ritel (tipe database menang). Total akhir selalu dari server.
