# Sistem Voucher/Diskon + Undian — Design Spec

**Status:** disetujui garis besar oleh user, boleh direvisi saat implementasi kalau ada yang meleset.

## Tujuan

Admin bisa membuat **undian** (lottery — ada pengundian pemenang beneran) dan
**voucher ad-hoc** (nego harga on the spot), keduanya menghasilkan **kode
voucher** yang terikat ke satu pelanggan. Pelanggan tidak punya akun/app —
kode dikirim via WhatsApp (pola manual-tap-kirim yang sama seperti Pengingat
Servis), lalu ditukar dengan cara diinput oleh admin/kasir saat checkout.
Tidak ada langkah "klaim" terpisah — pemakaian kode DI checkout ITU klaimnya.

## Keputusan desain (dari brainstorming)

- Undian = pengundian acak sungguhan, bukan sekadar istilah promo.
- Peserta undian: kombinasi otomatis (kriteria) + admin bisa tambah/hapus manual.
- Voucher selalu terikat ke satu `member_id` — tidak bisa dipakai orang lain.
- Voucher berlaku untuk **semua jenis transaksi** (tidak dibatasi kategori item).
- Tipe potongan: persen (dengan cap opsional) atau nominal rupiah — admin pilih per voucher.
- Voucher nego harga admin bisa dipakai langsung di transaksi yang sama, atau
  jadi kode buat nanti — **satu mekanisme yang sama** (voucher dibuat, lalu
  ditukar kapan pun sebelum expired; "langsung" cuma berarti kasir input
  kodenya di checkout yang sedang berjalan begitu admin selesai membuatnya).
- Pengiriman WA ikut pola `wa_outbox` yang sudah ada (Pengingat Servis): sistem
  auto-susun pesan & antre, admin/kasir tap kirim. Tidak mengaktifkan Cloud
  API sekarang.
- **Hanya admin** yang boleh membuat undian atau voucher (termasuk voucher
  nego). Kasir & admin sama-sama boleh menukarkan kode saat checkout (sudah
  jadi bagian alur checkout yang ada).
- Field `discount` (rupiah bebas) yang sudah ada di `checkout_transaction`
  **tidak disentuh** — voucher adalah potongan tambahan yang berjalan
  berdampingan (subtotal dikurangi `discount` manual DAN potongan voucher).

## Model Data

```
vouchers
  id uuid pk
  code text unique              -- format VCR-XXXXXX (random alfanumerik)
  member_id uuid not null references members(id)
  discount_type text check in ('persen','nominal')
  discount_value numeric not null check (> 0)   -- persen: 1-100, nominal: rupiah > 0
  max_discount_cap integer      -- nullable; hanya relevan utk 'persen'
  min_purchase integer          -- nullable; subtotal minimum biar valid
  expires_at timestamptz not null
  status text check in ('aktif','terpakai','kadaluarsa','dibatalkan') default 'aktif'
  source text check in ('undian','manual')
  undian_id uuid references undian(id)   -- null kalau source='manual'
  note text                     -- syarat & ketentuan / alasan admin
  used_at timestamptz
  used_in_transaction_id uuid references transactions(id)
  created_by uuid references users(id)
  created_at timestamptz default now()

undian
  id uuid pk
  title text not null
  description text
  criteria jsonb          -- { "dateFrom": "...", "dateTo": "...", "mustHaveAcPurchase": true }
  winner_count integer not null check (> 0)
  -- Hadiahnya SATU macam untuk semua pemenang undian ini (ditentukan saat
  -- undian dibuat) — celah yang kelewat di draft awal: setiap pemenang perlu
  -- voucher dengan nilai diskon, jadi undian wajib bawa syaratnya sendiri.
  discount_type text not null check in ('persen','nominal')
  discount_value integer not null check (> 0, <= 100 kalau persen)
  max_discount_cap integer          -- nullable; hanya relevan utk 'persen'
  min_purchase integer              -- nullable
  voucher_valid_days integer not null check (> 0)  -- masa berlaku voucher pemenang, dihitung dari tanggal ditarik
  status text check in ('berjalan','selesai','dibatalkan') default 'berjalan'
  drawn_at timestamptz
  created_by uuid references users(id)
  created_at timestamptz default now()

undian_participants
  id uuid pk
  undian_id uuid references undian(id) on delete cascade
  member_id uuid references members(id)
  source text check in ('otomatis','manual')
  added_at timestamptz default now()
  unique (undian_id, member_id)
```

`wa_outbox.kind` nambah 2 nilai baru: `menang_undian`, `voucher_baru`.
`build_wa_body()` nambah cabang buat kedua kind ini (kode voucher, syarat, tgl expired).

**RLS:** `vouchers` select → admin & kasir (butuh cek kode saat checkout).
`undian` & `undian_participants` select → admin saja. Tulis semua lewat RPC.

**Realtime:** `vouchers` masuk `supabase_realtime` (biar layar voucher live
kayak wa_outbox). `undian`/`undian_participants` tidak perlu — dikelola dari
satu layar admin, refresh cukup dari return value RPC.

## RPC Baru

| RPC | Peran | Payload → Efek |
|---|---|---|
| `create_undian` | admin | `{title, description?, criteria, winnerCount, discountType, discountValue, maxDiscountCap?, minPurchase?, voucherValidDays}` → insert `undian` (status `berjalan`, hadiah = satu paket diskon untuk semua pemenang) + auto-populate `undian_participants` dari kriteria |
| `update_undian_participants` | admin | `{undianId, add: uuid[], remove: uuid[]}` → tambah/hapus peserta manual |
| `draw_undian` | admin | `{undianId}` → pilih `winner_count` peserta acak (`order by random()`), buat 1 voucher `source='undian'` per pemenang (nilai diskon dari `undian`, `expires_at = drawn_at + voucher_valid_days`) + 1 baris `wa_outbox` (`kind='menang_undian'`) per pemenang, set undian `status='selesai', drawn_at=now()`. Gagal kalau sudah `selesai`/`dibatalkan` atau peserta < winner_count. |
| `cancel_undian` | admin | `{undianId}` → status `dibatalkan` (hanya kalau masih `berjalan`) — konsisten dengan `cancel_wa_message`/`cancel_voucher`, buat undian yang salah dibuat |
| `create_voucher` | admin | `{memberId, discountType, discountValue, maxDiscountCap?, minPurchase?, expiresAt, note}` → insert `vouchers` (`source='manual'`) + 1 baris `wa_outbox` (`kind='voucher_baru'`) |
| `cancel_voucher` | admin | `{voucherId, reason?}` → status `dibatalkan` (hanya kalau masih `aktif`) |

**Modifikasi `checkout_transaction`:** payload tambah field opsional
`voucherCode`. Kalau diisi:
1. Cari `vouchers` by `code`, harus `status='aktif'`, `expires_at > now()`.
2. `member_id` voucher harus match member hasil resolve transaksi ini (by
   phone) — kalau tidak cocok, `raise exception 'Kode voucher ini bukan milik pelanggan ini'`.
3. `subtotal >= min_purchase` (kalau ada), else exception jelas jumlah kurangnya.
4. Hitung potongan: `nominal` → `discount_value`; `persen` →
   `least(subtotal * discount_value / 100, coalesce(max_discount_cap, 'infinity'))`.
5. Potongan voucher **ditambahkan** ke `discount` manual (dua-duanya mengurangi subtotal).
6. Sukses → update voucher `status='terpakai', used_at=now(), used_in_transaction_id=<id baru>`.
   Kode invalid/expired/sudah dipakai/tidak cocok pelanggan → **transaksi gagal total**
   (tidak checkout tanpa voucher diam-diam) supaya kasir sadar & bisa perbaiki.

Semua RPC baru dikunci pola standar (`revoke ... from anon, public; grant ... to authenticated;`),
audit log tiap tulis, pesan error Bahasa Indonesia.

## UI

**Pengiriman WA tidak butuh layar baru.** Layar **Pengingat** (`/pengingat`,
mobile & web) yang sudah ada menampilkan SEMUA baris `wa_outbox` berstatus
`pending` tanpa filter `kind` — begitu `menang_undian`/`voucher_baru` masuk,
baris itu otomatis muncul di sana dan `mark_wa_sent`/`cancel_wa_message` yang
sudah ada langsung berfungsi (keduanya generik, tidak peduli `kind`). Yang
perlu ditambah di layar itu cuma label & warna badge untuk 2 `kind` baru.

**Mobile + Web — `/undian` (admin only):**
List undian + status badge, form buat baru (judul, deskripsi, kriteria
tanggal + toggle "harus pernah beli AC baru", jumlah pemenang, DAN hadiahnya:
tipe+nilai diskon, cap opsional, min pembelian opsional, masa berlaku voucher
dalam hari), detail undian nampilin jumlah peserta + tombol tambah/hapus
manual + tombol **Tarik Undian** (dialog konfirmasi, ireversibel) + tombol
**Batalkan** (selama masih `berjalan`). Setelah ditarik: daftar pemenang
tampil, pengiriman WA-nya lewat `/pengingat` seperti di atas.

**Mobile + Web — `/voucher` (admin bikin; admin+kasir lihat & pakai):**
List semua voucher (kode, pemilik, status, expired), search by kode/nama.
Admin: tombol "Buat Voucher" (pilih member via search, tipe+nilai diskon,
cap, min pembelian, expired, catatan). Kasir: read-only list (buat cek kode
manual kalau perlu), tapi field kode dipakai langsung di layar Checkout.

**Checkout (mobile `checkout_screen.dart` + web setara):** tambah field
opsional "Kode Voucher" di bagian Rincian Biaya, di atas field Diskon yang
sudah ada. Validasi & perhitungan potongan **sepenuhnya di server**
(`checkout_transaction`) — client cuma kirim kode, tampilkan error dari RPC
kalau invalid. Tidak ada preview real-time terpisah (submit → tahu hasilnya);
kalau nanti terasa kurang, tambah RPC preview terpisah.

## Testing

Ikuti pola migrasi yang sudah ada di repo (verifikasi manual psql +
`flutter analyze && flutter test`):

- Generate kode voucher unik, cek tidak collide.
- RLS: teknisi 0 baris di `vouchers`/`undian`; kasir bisa `select vouchers`
  tapi RPC `create_voucher`/`create_undian`/`draw_undian` ditolak untuk kasir.
- `draw_undian`: peserta < winner_count → exception; hasil pemenang tidak
  duplikat; voucher & wa_outbox row jumlahnya = winner_count.
- `checkout_transaction` + voucherCode: sukses (persen dengan cap, nominal),
  gagal (expired, sudah `terpakai`, member tidak cocok, di bawah `min_purchase`).
  Setelah sukses, voucher tidak bisa dipakai lagi (double-spend ditolak).
- Flutter: model test buat `Voucher`/`Undian` (`fromMap`), widget test dasar
  (empty state, form validasi) ikut pola `wa_message_test.dart`.

## Di luar cakupan

- Preview potongan voucher real-time sebelum submit checkout.
- Ronde undian ulang otomatis / undian berulang terjadwal.
- Klaim mandiri oleh pelanggan (perlu portal/app pelanggan — tidak ada saat ini).
