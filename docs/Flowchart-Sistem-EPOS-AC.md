# Flowchart Sistem EPOS AC (Mermaid)

Dibaca dari kode backend NestJS dan skema database. Satu bagian = satu alur. Versi draw.io: `Flowchart-Sistem-EPOS-AC.drawio`.

Legenda: kotak **merah** = ditolak / error, belah ketupat = keputusan.

---

## 01. Arsitektur

```mermaid
flowchart LR
  subgraph KLIEN["Klien"]
    W["Web Next.js<br/>admin, kasir, gudang, teknisi<br/>sesi di cookie"]
    M["Aplikasi mobile Flutter<br/>sedang dimigrasi ke backend ini"]
  end
  subgraph SERVER["Backend NestJS"]
    API["REST API<br/>JWT + penjaga peran<br/>validasi input"]
    RT["Realtime Socket.IO<br/>room user:id dan admin-dashboard"]
    CR["Jadwal harian 09:00 WIB<br/>pengingat servis"]
    AU["Log audit semua aksi penting"]
  end
  DB[("PostgreSQL epos_db")]
  WA["Fonnte WhatsApp"]
  FCM["Firebase push"]

  W -- "lewat proxy Next" --> API
  M -.-> API
  API -- "baca dan tulis" --> DB
  API --> RT
  RT -- "event websocket" --> W
  CR --> API
  API --> AU
  API -- "invoice, selesai servis, pengingat, menang undian" --> WA
  API -- "push bila dikonfigurasi" --> FCM
  FCM -.-> M

  classDef plan stroke-dasharray: 5 4,stroke:#d97706,stroke-width:2px
  class M plan
```

---

## 02. Login dan keamanan

Role dibaca ulang dari database di setiap request, bukan dipercaya dari isi token.

```mermaid
flowchart TD
  S(["Pengguna isi email dan password"]) --> D1{"Dalam batas percobaan?<br/>10 per menit per IP+email<br/>40 per menit per IP"}
  D1 -- "tidak" --> X1["Ditolak 429<br/>terlalu banyak percobaan"]
  D1 -- "ya" --> D2{"Email ada dan akun aktif?"}
  D2 -- "tidak" --> DM["Tetap hitung bcrypt dengan hash palsu<br/>agar waktu respons sama"]
  DM --> X2["Ditolak 401<br/>Email atau password salah"]
  D2 -- "ya" --> D3{"Password cocok?"}
  D3 -- "tidak" --> X2
  D3 -- "ya" --> T["Buat JWT: id user + role<br/>berlaku 8 jam"]
  T --> RQ["Setiap request berikutnya:<br/>cek akun masih aktif dan token terbit<br/>setelah password terakhir diganti"]
  RQ --> D4{"Token valid?"}
  D4 -- "tidak" --> X3["Ditolak 401"]
  D4 -- "ya" --> D5{"Role user diizinkan<br/>untuk endpoint ini?"}
  D5 -- "tidak" --> X4["Ditolak 403<br/>Role tidak diizinkan"]
  D5 -- "ya" --> GO["Jalankan aksi"]
  GO --> AU["Aksi penting dicatat di log audit"]
  AU --> EN(["Selesai"])

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1,X2,X3,X4 err
```

---

## 03. Barang masuk (stock-in)

```mermaid
flowchart TD
  S(["Gudang: barang masuk<br/>item, jumlah, harga beli, supplier"]) --> D1{"Jenis barang?"}
  D1 -- "produk AC" --> D2{"Mode produk AC?"}
  D1 -- "sparepart" --> D4{"Dilacak per gulungan?"}

  D2 -- "satuan" --> A1["1 batch untuk produk ini<br/>modal = harga beli"]
  D2 -- "unit lengkap" --> A2["2 batch terhubung Indoor + Outdoor<br/>modal semua di Indoor, Outdoor Rp0<br/>jumlah Outdoor boleh beda"]
  A1 --> D3{"Harga beli lebih tinggi<br/>dari harga jual produk?"}
  A2 --> D3
  D3 -- "ya" --> CF["Minta konfirmasi<br/>confirmOverride, lalu kirim ulang"]
  CF --> U
  D3 -- "tidak" --> U["Buat unit fisik sebanyak qty<br/>kode PRD-xxxx-Uxxxx + token QR acak<br/>status di_gudang"]

  D4 -- "ya" --> B1["Isi jumlah dan panjang tiap gulungan<br/>1 batch per gulungan, FIFO saat dipakai"]
  D4 -- "tidak" --> B2["Tambah stok datar sebanyak qty"]
  B1 --> B3["Sinkronkan angka stok sparepart"]
  B2 --> B3

  U --> M["Catat mutasi stok pembelian per batch"]
  B3 --> M
  M --> LB["Cetak label QR batch<br/>tempel di kardus unit"]
  LB --> AU["Catat log audit"]
  AU --> EN(["Selesai"])
```

---

## 04. Checkout POS

Semua langkah berjalan dalam satu transaksi database. Gagal di tengah berarti tidak ada yang tersimpan.

```mermaid
flowchart TD
  S(["Kasir: checkout<br/>keranjang + data pelanggan"]) --> V1["Validasi awal:<br/>diskon wajib beralasan, tidak ada item dobel,<br/>qty produk dan sparepart utuh harus bulat"]
  V1 -- "aturan dilanggar" --> X1["Ditolak 400"]
  V1 --> D1{"Pelanggan sudah member?"}
  D1 -- "belum" --> M1["Cari atau buat member otomatis<br/>dari nama + nomor HP"]
  D1 -- "sudah" --> PK
  M1 --> PK["Cek paket instalasi:<br/>harus ada dan aktif"]
  PK --> ST["Kunci stok FIFO per batch atau gulungan<br/>unit AC dijatah ke invoice: reserved"]
  ST -- "stok kurang" --> X2["Ditolak 400<br/>Stok tidak cukup"]
  ST --> SP["Validasi bundel AC Split:<br/>Outdoor harus pasangan Indoor, jumlah sama<br/>unit satuan dari paket wajib diisi harga"]
  SP --> PR["Tentukan harga tiap baris:<br/>jasa = harga dasar, produk = harga katalog atau override<br/>Outdoor unit lengkap = Rp0"]
  PR --> D2{"Ada kode voucher?"}
  D2 -- "ya" --> VC["Kunci dan validasi voucher:<br/>kode ada, aktif, belum kedaluwarsa,<br/>milik member ini, minimal belanja terpenuhi"]
  VC -- "tidak valid" --> X3["Ditolak 400<br/>voucher tidak valid"]
  VC --> TT
  D2 -- "tidak" --> TT["Hitung total:<br/>subtotal - diskon, lalu pajak dan ongkir"]
  TT --> D3{"Diskon lebih besar<br/>dari subtotal?"}
  D3 -- "ya" --> X4["Ditolak 400"]
  D3 -- "tidak" --> D4{"Ada baris jual di bawah modal<br/>atau unit satuan dari paket?"}
  D4 -- "ya" --> D5{"Kasir sudah menyetujui<br/>confirmOverride?"}
  D5 -- "belum" --> CR["Balik confirm_required<br/>tidak ada yang tersimpan<br/>kasir setujui lalu kirim ulang"]
  D5 -- "sudah" --> SV
  D4 -- "tidak" --> SV["Simpan transaksi, invoice, baris invoice,<br/>mutasi stok penjualan"]
  SV --> AD["Catat penyesuaian invoice diskon dan voucher<br/>voucher berubah jadi terpakai"]
  AD --> D6{"Ada pemasangan?"}
  D6 -- "ya" --> IN["Buat service order pemasangan,<br/>unit AC terpasang barcode ACUNIT-tanggal-nomor<br/>status menunggu_pemasangan,<br/>dan satu job teknisi per unit"]
  D6 -- "tidak" --> AU
  IN --> AU["Catat log audit"]
  AU --> AF["Setelah sukses di luar transaksi:<br/>realtime ke admin, notifikasi gudang siapkan unit,<br/>cek sparepart menipis"]
  AF --> EN(["Invoice terbit<br/>Kasir lanjut ke pembayaran"])

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1,X2,X3,X4 err
```

---

## 05. Pembayaran, kirim WhatsApp, dan shift kasir

Tidak ada verifikasi pembayaran terpisah: pembayaran yang dicatat kasir langsung berlaku. Shift hanya pencatatan kas, bukan syarat checkout.

```mermaid
flowchart TD
  subgraph PAY["Pembayaran dan invoice WhatsApp"]
    direction TB
    S(["Kasir catat pembayaran invoice"]) --> D1{"Invoice batal atau refund?"}
    D1 -- "ya" --> X1["Ditolak 400"]
    D1 -- "tidak" --> D2{"Nominal melebihi<br/>sisa tagihan?"}
    D2 -- "ya" --> X2["Ditolak 400<br/>Melebihi sisa tagihan"]
    D2 -- "tidak" --> PM["Catat pembayaran, langsung berlaku<br/>terhubung ke shift yang terbuka bila ada"]
    PM --> HS["Hitung ulang status invoice:<br/>lunas bila terbayar penuh, belum_dibayar bila 0,<br/>selain itu dp, bertahan kurang_bayar bila pernah"]
    HS --> RT["Event realtime ke admin"]
    RT --> WA["Kasir klik Kirim WA di invoice"]
    WA --> LG["Buat log WA berstatus pending<br/>sebelum memanggil Fonnte"]
    LG --> FN["Panggil Fonnte"]
    FN --> D3{"Berhasil?"}
    D3 -- "ya" --> OK(["Log: terkirim"])
    D3 -- "tidak" --> GL["Log: gagal"]
    GL --> RR["Admin klik Kirim ulang di riwayat WA"]
    RR --> FN
  end

  subgraph SHIFT["Shift kasir"]
    direction TB
    H1(["Kasir buka shift<br/>isi saldo awal"]) --> HD{"Sudah punya shift terbuka?"}
    HD -- "ya" --> HX["Ditolak 400"]
    HD -- "tidak" --> H2["Shift terbuka"]
    H2 --> H3["Pembayaran selama shift<br/>otomatis terhubung ke shift"]
    H3 --> H4["Kasir tutup shift<br/>saldo akhir + catatan"]
    H4 --> H5["Laporan shift: kas diharapkan<br/>saldo awal + semua pembayaran vs saldo akhir<br/>kasir lihat miliknya, admin semua"]
  end

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1,X2,GL,HX err
```

---

## 06. Keluar gudang (scan QR atau ceklist manual)

Checkout hanya menjatah unit (reserved). Unit baru resmi keluar setelah discan. Dikerjakan **gudang** (atau admin) di halaman Keluar Gudang; kasir cukup checkout. Scan menerima token QR atau kode label (PRD-0001-U0007).

```mermaid
flowchart TD
  S(["Gudang buka halaman Keluar Gudang<br/>daftar invoice dengan unit reserved"]) --> P1["Pilih invoice<br/>lihat per produk: jumlah, sudah keluar, sisa"]
  P1 --> D0{"Cara konfirmasi?"}
  D0 -- "scan" --> SC["Scan QR di label unit"]
  D0 -- "QR rusak atau tidak terbaca" --> MN["Ceklist manual per produk"]

  SC --> D1{"QR dikenali sistem?"}
  D1 -- "tidak" --> X1["Ditolak<br/>QR tidak dikenali"]
  D1 -- "ya" --> D2{"Unit ini jatah invoice ini?"}
  D2 -- "ya" --> D3{"Status unit?"}
  D3 -- "reserved" --> OK1["Unit ditandai KELUAR"]
  D3 -- "keluar" --> X2["Ditolak<br/>sudah pernah dikeluarkan"]
  D2 -- "tidak" --> D4{"Status unit yang discan?"}
  D4 -- "keluar" --> X3["Ditolak<br/>sudah keluar untuk invoice lain"]
  D4 -- "reserved" --> X4["Ditolak<br/>sudah dijatah invoice lain<br/>ambil unit setipe lain"]
  D4 -- "di_gudang" --> D5{"Produknya ada di invoice ini<br/>dan masih ada jatah?"}
  D5 -- "tidak" --> X5["Ditolak<br/>bukan bagian invoice atau sudah selesai discan"]
  D5 -- "ya" --> SW["Tukar jatah:<br/>unit yang discan jadi KELUAR,<br/>unit yang tadinya dijatah dilepas ke di_gudang,<br/>catatan batch ikut bergeser bila batch berbeda"]

  MN --> D6{"Masih ada unit reserved<br/>untuk produk ini?"}
  D6 -- "tidak" --> X6["Ditolak<br/>tidak ada unit tersisa"]
  D6 -- "ya" --> MM["Ambil 1 unit reserved TERTUA FIFO<br/>tandai KELUAR"]

  OK1 --> D7{"Semua unit invoice<br/>sudah keluar?"}
  SW --> D7
  MM --> D7
  D7 -- "ya" --> EN(["Invoice hilang dari daftar tunggu"])
  D7 -- "belum" --> P1

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1,X2,X3,X4,X5,X6 err
```

---

## 07. Servis masuk (servis mandiri)

Jalur selain checkout: pelanggan membawa AC lama. Memakai mesin job teknisi yang sama dengan pemasangan.

```mermaid
flowchart TD
  S(["Kasir: servis mandiri<br/>pelanggan bawa AC"]) --> M["Pilih atau buat member<br/>nama + nomor HP"]
  M --> D1{"Unit AC-nya?"}
  D1 -- "terdaftar" --> U1["Pilih unit milik member ini"]
  D1 -- "belum ada" --> U2["Isi data unit baru<br/>langsung berstatus aktif, barcode dibuat"]
  D1 -- "tidak valid" --> X1["Ditolak 400<br/>pilih unit lama ATAU unit baru, bukan dua-duanya<br/>unit lama harus milik member ini"]
  U1 --> K["Isi keluhan, jenis pekerjaan<br/>cuci, maintenance, service, dst<br/>teknisi opsional"]
  U2 --> K
  K --> O["Buat service order + satu job per unit<br/>keluhan jadi temuan awal"]
  O --> D2{"Teknisi dipilih?"}
  D2 -- "ya" --> A1["Job assigned<br/>teknisi dapat notifikasi"]
  D2 -- "tidak" --> A2["Job menunggu_penugasan<br/>admin atau kasir menugaskan nanti"]
  A1 --> SJ["Surat jalan bisa dicetak<br/>dari detail service order"]
  A2 --> SJ
  SJ --> EN(["Job masuk antrean teknisi"])

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1 err
```

Mobile memakai endpoint lain (service order manual): unit harus sudah terdaftar dan milik member yang sama, teknisi harus aktif.

---

## 08. Siklus job teknisi

```mermaid
flowchart TD
  S(["Job: menunggu_penugasan"]) --> A["Admin atau kasir menugaskan teknisi<br/>teknisi harus aktif"]
  A --> AS["Job assigned<br/>teknisi dapat notifikasi"]
  AS --> F1["Teknisi tambah temuan masalah<br/>dan unggah foto SEBELUM"]
  F1 --> D1{"Teknisi tekan Mulai. Syarat terpenuhi?<br/>status assigned, minimal 1 foto sebelum,<br/>barcode yang discan = unit job ini,<br/>unit tidak menunggu_data"}
  D1 -- "tidak" --> X1["Ditolak 400<br/>pesan menyebut syarat yang kurang"]
  D1 -- "ya" --> W["Job sedang_dikerjakan"]
  W --> K["Teknisi bekerja: tambah temuan,<br/>foto sebelum dan sesudah per temuan, catatan,<br/>ajukan material tambahan"]
  K --> D2{"Teknisi kirim untuk review. Syarat terpenuhi?<br/>minimal 1 temuan, tiap temuan ada foto sebelum DAN sesudah,<br/>tidak ada pengajuan pending,<br/>material disetujui sudah ditandai dipakai"}
  D2 -- "tidak" --> X2["Ditolak 400<br/>sebut temuan atau pengajuan yang kurang"]
  D2 -- "ya" --> R["Job menunggu_review"]
  R --> D3{"Admin memeriksa"}
  D3 -- "kembalikan dengan catatan" --> SB["Job kembali sedang_dikerjakan"]
  SB --> K
  D3 -- "setuju" --> OK["Job selesai"]
  OK --> E1["Order unit selesai<br/>unit pemasangan jadi aktif + tanggal pasang"]
  E1 --> D4{"Siklus pengingat dinyalakan?<br/>hanya cuci atau maintenance"}
  D4 -- "ya" --> E2["Hitung jadwal servis berikutnya<br/>antre WA selesai servis"]
  D4 -- "tidak" --> E3["Matikan pengingat unit<br/>batalkan WA pengingat yang pending"]
  E2 --> D5{"Semua job di order ini<br/>selesai atau dibatalkan?"}
  E3 --> D5
  D5 -- "ya" --> E4(["Service order selesai"])
  AS -. "admin batalkan" .-> CX["Job dibatalkan<br/>hanya admin"]
  W -. "admin batalkan" .-> CX

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1,X2,CX err
```

Mode offline teknisi (mobile): aksi disimpan di HP lalu dikirim batch ke `sync-batch`. Tiap aksi punya id unik (idempoten), konflik bila job berubah di server, satu aksi gagal tidak membatalkan aksi lain.

---

## 09. Pengajuan material oleh teknisi

Stok baru dipotong saat teknisi menandai material dipakai, bukan saat diajukan atau disetujui.

```mermaid
flowchart TD
  S(["Teknisi di lokasi butuh sparepart tambahan"]) --> A["Teknisi ajukan: hanya sparepart, bukan produk AC<br/>sistem hitung harga tiap baris"]
  A --> RT["Status pending, stok belum dipotong<br/>event realtime ke admin"]
  RT --> D1{"Admin memutuskan"}
  D1 -- "tolak" --> RJ["Status rejected"]
  D1 -- "revisi" --> RV["Ubah baris lalu setujui<br/>revisi yang menyisakan 0 baris ditolak"]
  D1 -- "setuju" --> AP["Status approved"]
  RV --> INV
  AP --> INV["Tambah tagihan invoice lewat penyesuaian<br/>bila invoice tadinya lunas jadi kurang_bayar<br/>bertahan sampai lunas lagi, tidak turun ke dp"]
  RJ --> NT["Notifikasi pribadi ke teknisi:<br/>ditolak, direvisi dan disetujui, atau disetujui"]
  INV --> NT
  INV --> US["Teknisi tandai material dipakai"]
  US --> D2{"Sudah pernah ditandai dipakai?"}
  D2 -- "ya" --> X1["Ditolak 400<br/>sudah ditandai dipakai"]
  D2 -- "belum" --> ST["Stok sparepart dipotong<br/>FIFO per gulungan bila dilacak per gulungan"]
  ST --> EN(["Syarat kirim review terpenuhi<br/>tidak ada pending, approved sudah dipakai"])

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class RJ,X1 err
```

---

## 10. Unit AC terpasang: data, scan, koreksi, label

Satu unit terpasang = satu barcode, walau terdiri dari dua produk (Indoor dan Outdoor). Teknisi tidak boleh mengubah data unit aktif langsung.

```mermaid
flowchart TD
  S(["Unit AC terdaftar<br/>dari checkout, servis mandiri, atau data lampau"]) --> D1{"Asalnya?"}
  D1 -- "checkout" --> C1["Status menunggu_pemasangan"]
  D1 -- "servis mandiri atau data lampau dengan tipe diketahui" --> C2["Status aktif"]
  D1 -- "data lampau QR dulu, tipe belum diketahui" --> C3["Status menunggu_data"]
  C1 --> LB
  C2 --> LB
  C3 --> LB["Label QR dicetak, tandai dicetak<br/>ditempel: otomatis saat QR pertama discan<br/>atau ditandai manual"]
  LB --> SC["Teknisi scan QR di lokasi"]
  SC --> D2{"Status unit?"}
  D2 -- "menunggu_data" --> CD["Teknisi lengkapi data: merk, PK, dll<br/>sekali saja, hanya saat menunggu_data<br/>status jadi aktif, label dianggap menempel"]
  D2 -- "aktif atau menunggu_pemasangan" --> AK["Lihat riwayat servis<br/>buka job di unit ini"]
  CD --> AK
  AK --> D3{"Data unit salah?"}
  D3 -- "tidak" --> EN(["Selesai"])
  D3 -- "ya" --> KR["Teknisi ajukan koreksi<br/>harus ada perbedaan dari data sekarang<br/>hanya 1 koreksi pending per unit"]
  KR --> D4{"Admin memutuskan"}
  D4 -- "setuju" --> AP["Data unit otomatis berganti"]
  D4 -- "tolak" --> RJ["Alasan penolakan wajib diisi"]
  AP --> EN
  RJ --> EN

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class RJ err
```

---

## 11. Pengingat servis otomatis lewat WhatsApp

Berjalan tiap hari 09:00 WIB, bisa dipicu manual admin. Aman dijalankan berulang karena kunci unik mencegah pesan dobel.

```mermaid
flowchart TD
  S(["Cron 09:00 WIB<br/>atau admin klik Jalankan sekarang"]) --> Q["Cari unit AC yang memenuhi SEMUA syarat:<br/>aktif, pengingat nyala, punya tanggal servis berikutnya,<br/>member aktif dan tidak opt-out WA,<br/>tidak punya job yang masih berjalan"]
  Q --> D1{"Tanggal servis berikutnya<br/>jatuh pada?"}
  D1 -- "tepat 3 hari lagi" --> H3["Jenis pesan reminder_h3"]
  D1 -- "7 hari yang lalu, sudah lewat" --> H7["Jenis pesan reminder_h7"]
  H3 --> G
  H7 --> G["Kelompokkan: satu member dengan beberapa AC<br/>yang jatuh tempo bersamaan menerima SATU pesan"]
  G --> D2{"Nomor HP member valid?"}
  D2 -- "tidak" --> SK(["Dilewati"])
  D2 -- "ya" --> D3{"Kunci dedupe<br/>member + jenis + tanggal sudah ada?"}
  D3 -- "ya" --> DU(["Dilewati: sudah pernah diantre"])
  D3 -- "belum" --> LG["Isi template nama, unit, tanggal<br/>buat log WA berstatus pending"]
  LG --> FN["Kirim lewat Fonnte"]
  FN --> D4{"Berhasil?"}
  D4 -- "ya" --> OK(["Log: terkirim"])
  D4 -- "tidak" --> GL["Log: gagal<br/>admin bisa kirim ulang dari riwayat WA"]

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class GL err
```

Catatan: member opt-out WA membatalkan pesan yang masih pending (log: dibatalkan). Admin mengatur siklus servis per jenis job (hanya cuci atau maintenance), interval per unit, dan redaksi template (invoice, selesai servis, reminder_h3, reminder_h7).

---

## 12. Member, voucher, dan undian

Voucher itu satu kode untuk satu member, dibuat admin, dipakai kasir dengan mengetik kode saat checkout. Tidak ada langkah klaim.

```mermaid
flowchart TD
  subgraph VOUCHER["Member dan voucher"]
    direction TB
    M(["Member dibuat otomatis saat checkout<br/>nama + nomor HP, tanpa duplikat"]) --> MV["Admin buat voucher untuk satu member:<br/>diskon rupiah atau persen maks 100,<br/>minimal belanja, tanggal kedaluwarsa di masa depan"]
    MV --> D1{"Member aktif?"}
    D1 -- "tidak" --> X1["Ditolak 400"]
    D1 -- "ya" --> VK["Kode unik dibuat<br/>status aktif"]
    VK --> KC["Kasir ketik kode saat checkout"]
    KC --> D2{"Kode ada, aktif, belum kedaluwarsa,<br/>milik member ini, minimal belanja terpenuhi?"}
    D2 -- "tidak" --> X2["Checkout ditolak<br/>voucher tidak valid"]
    D2 -- "ya" --> PK["Potongan dihitung<br/>setelah invoice terbit voucher terpakai<br/>dan terhubung ke invoice itu"]
    VK --> CN["Admin batalkan voucher<br/>hanya yang masih aktif"]
  end

  subgraph UNDIAN["Undian"]
    direction TB
    U1(["Admin buat undian:<br/>kriteria peserta, rentang tanggal, hadiah voucher"]) --> U2["Peserta dipilih dari invoice<br/>batal dan refund tidak dihitung"]
    U2 --> U3["Admin edit daftar peserta"]
    U3 --> D3{"Admin memilih"}
    D3 -- "undi" --> U4["Pemenang dapat voucher<br/>kedaluwarsa sesuai masa berlaku undian"]
    D3 -- "batalkan" --> U5["Undian dibatalkan"]
    U4 --> U6["WA menang undian ke pemenang"]
    U6 --> U7(["Undian selesai"])
  end

  U4 -. "voucher dibuat" .-> VK

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1,X2,U5 err
```

Undian yang sudah selesai atau dibatalkan tidak bisa diubah, diundi, atau dibatalkan lagi.

---

## 13. Opname, koreksi stok, dan laporan stok

Opname produk AC per unit belum didukung, karena stok AC dihitung dari unit QR. Koreksi manual produk juga ditolak.

```mermaid
flowchart TD
  S(["Gudang: hitung fisik opname"]) --> D1{"Jenis item?"}
  D1 -- "produk AC" --> X1["Ditolak 400<br/>Opname produk per-unit belum didukung"]
  D1 -- "sparepart" --> D2{"Sparepart dilacak per gulungan?"}
  D2 -- "tidak" --> O1["Pilih sparepart<br/>isi angka fisik"]
  D2 -- "ya" --> O2["Pilih gulungan batch yang dihitung<br/>isi angka fisik gulungan itu"]
  O1 --> D3{"Selisih fisik vs sistem?"}
  O2 --> D3
  D3 -- "0" --> Z(["Tidak ada perubahan<br/>tetap dicatat di hasil"])
  D3 -- "ada selisih" --> UP["Stok disetel ke angka fisik<br/>mutasi stok opname, log audit"]
  UP --> NF["Gudang yang input: admin dapat notifikasi ringkasan selisih<br/>sparepart di bawah minimum:<br/>admin dan gudang dapat notifikasi stok menipis"]
  NF --> LP
  Z --> LP["Laporan stok admin dan gudang:<br/>rentang tanggal, filter jenis dan merk<br/>tiap item: stok awal, masuk, keluar, sisa<br/>gudang TIDAK melihat modal, omzet, untung"]
  AJ["Koreksi manual: rusak, retur, koreksi, pembelian<br/>hanya sparepart, produk AC ditolak<br/>qty negatif = keluar FIFO, positif = masuk"] --> LP
  LP --> D4{"Cetak?"}
  D4 -- "ya" --> PR["Satu merk satu lembar A4 landscape<br/>total sisa per merk, kolom Fisik dan Selisih<br/>untuk ditulis tangan, baris tanda tangan"]
  D4 -- "tidak" --> EN(["Selesai"])
  PR --> EN

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1 err
```

---

## 14. Administrasi: data lampau, pengguna, reset sistem

Hanya admin. Fitur yang mengubah banyak data sekaligus berjalan dalam satu transaksi dan tercatat di log audit.

```mermaid
flowchart TD
  subgraph LAMPAU["Input data lampau"]
    direction TB
    A1(["Admin: input data lampau"]) --> A2["Pilih atau buat member lama<br/>isi unit AC, transaksi lampau opsional"]
    A2 --> D1{"Minimal 1 unit atau 1 transaksi?<br/>transaksi punya minimal 1 item?"}
    D1 -- "tidak" --> X1["Ditolak 400"]
    D1 -- "ya" --> A3["Per unit: mode diketahui = aktif<br/>atau QR dulu = menunggu_data<br/>pengingat nyala hanya bila diketahui dan siklus 7-730 hari"]
    A3 --> A4["Semua tersimpan dalam SATU transaksi<br/>gagal di tengah = tidak ada member setengah jadi"]
    A4 --> A5(["Label QR unit dicetak lalu ditempel"])
  end

  subgraph PENGGUNA["Kelola pengguna"]
    direction TB
    U1(["Admin: kelola pengguna"]) --> U2["Buat akun: email, nama, peran admin kasir teknisi gudang<br/>nonaktifkan, reset password, ubah nama atau peran"]
    U2 --> D2{"Menurunkan atau menonaktifkan<br/>admin aktif TERAKHIR atau diri sendiri?"}
    D2 -- "ya" --> X2["Ditolak 403<br/>agar tidak ada sistem tanpa admin"]
    D2 -- "tidak" --> U3["Berlaku di request berikutnya<br/>role dibaca ulang dari database"]
  end

  subgraph RESET["Reset sistem"]
    direction TB
    R1(["Admin: reset sistem"]) --> D3{"Teks konfirmasi<br/>sama persis dengan yang diminta?"}
    D3 -- "tidak" --> X3["Ditolak 400<br/>Teks konfirmasi salah"]
    D3 -- "ya" --> R2["Hapus data dalam satu transaksi:<br/>lapis 1 transaksi dan histori bisnis semua scope,<br/>lapis berikutnya sesuai scope"]
    R2 --> R3(["Jumlah data terhapus dilaporkan"])
  end

  classDef err fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d
  class X1,X2,X3 err
```

---

## 15. Status dokumen

Setiap dokumen hanya bisa berpindah mengikuti panah ini.

### Job teknisi

```mermaid
stateDiagram-v2
  direction LR
  [*] --> menunggu_penugasan
  menunggu_penugasan --> assigned: ditugaskan
  assigned --> sedang_dikerjakan: teknisi mulai
  sedang_dikerjakan --> menunggu_review: kirim review
  menunggu_review --> selesai: admin setuju
  menunggu_review --> sedang_dikerjakan: admin kembalikan
  menunggu_penugasan --> dibatalkan: admin batalkan
  assigned --> dibatalkan: admin batalkan
  sedang_dikerjakan --> dibatalkan: admin batalkan
  selesai --> [*]
  dibatalkan --> [*]
```

### Invoice

Status dihitung otomatis dari jumlah yang dibayar. Setelah pernah `kurang_bayar`, statusnya bertahan sampai lunas lagi. Status `batal` dan `refund` ada di database dan pembayaran untuk invoice itu ditolak, tapi belum ada alur di kode yang menyetelnya.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> belum_dibayar
  belum_dibayar --> dp: bayar sebagian
  belum_dibayar --> lunas: bayar penuh
  dp --> lunas: pelunasan
  lunas --> kurang_bayar: tagihan naik karena material disetujui
  kurang_bayar --> lunas: dilunasi lagi
```

### Unit AC di gudang

```mermaid
stateDiagram-v2
  direction LR
  [*] --> di_gudang: barang masuk
  di_gudang --> reserved: checkout
  reserved --> keluar: scan atau ceklist
  reserved --> di_gudang: jatah ditukar unit setipe lain
  keluar --> [*]
```

### Pengajuan material teknisi

Setelah `approved`, teknisi menandai material dipakai (penanda terpisah, saat itu stok dipotong).

```mermaid
stateDiagram-v2
  direction LR
  [*] --> pending: teknisi mengajukan
  pending --> approved: admin setuju atau revisi
  pending --> rejected: admin tolak
```

### Unit AC terpasang

```mermaid
stateDiagram-v2
  direction LR
  [*] --> menunggu_pemasangan: checkout dengan pemasangan
  [*] --> aktif: servis mandiri atau data lampau diketahui
  [*] --> menunggu_data: data lampau QR dulu
  menunggu_pemasangan --> aktif: job pemasangan selesai
  menunggu_data --> aktif: teknisi lengkapi data
```

### Voucher

```mermaid
stateDiagram-v2
  direction LR
  [*] --> aktif
  aktif --> terpakai: dipakai di checkout
  aktif --> dibatalkan: admin batalkan
  aktif --> kedaluwarsa: lewat tanggal
```

### Log WhatsApp

```mermaid
stateDiagram-v2
  direction LR
  [*] --> pending
  pending --> terkirim: Fonnte sukses
  pending --> gagal: Fonnte gagal
  gagal --> terkirim: kirim ulang
  pending --> dibatalkan: member opt-out
```

### Undian

```mermaid
stateDiagram-v2
  direction LR
  [*] --> berjalan
  berjalan --> selesai: diundi
  berjalan --> dibatalkan: admin batalkan
```

---

## 16. Notifikasi: siapa diberi tahu apa

Notifikasi pribadi tersimpan di database, tampil di lonceng web, dan dikirim sebagai push bila Firebase dikonfigurasi. Event admin hanya sampai ke admin yang sedang membuka dashboard.

```mermaid
flowchart LR
  T1["Checkout selesai"] --> D1["Event realtime ke admin<br/>transaksi baru"]
  T2["Checkout berisi produk AC"] --> D2["Notifikasi ke gudang<br/>siapkan N unit"]
  T3["Stok sparepart turun<br/>sampai batas minimum"] --> D3["Notifikasi ke admin + gudang<br/>tidak dikirim ulang selama belum dibaca"]
  T4["Opname dengan selisih<br/>oleh gudang"] --> D4["Notifikasi ringkasan selisih ke admin"]
  T5["Admin menugaskan job"] --> D5["Notifikasi pribadi ke teknisi terkait"]
  T6["Status job berubah"] --> D6["Event realtime ke admin"]
  T7["Teknisi mengajukan material"] --> D7["Event realtime ke admin"]
  T8["Admin memutuskan pengajuan"] --> D8["Notifikasi pribadi ke teknisi terkait"]
  T9["Pembayaran dicatat atau<br/>service order dibuat"] --> D9["Event realtime ke admin"]
  T10["Invoice, selesai servis,<br/>pengingat, menang undian"] --> D10["WhatsApp ke pelanggan<br/>Fonnte, tercatat di riwayat WA"]
```

---

## 17. Akses per peran

Dibaca dari penjaga peran di tiap endpoint.

| Bidang | Admin | Kasir | Teknisi | Gudang |
|---|:-:|:-:|:-:|:-:|
| POS dan checkout | ✓ | ✓ | – | – |
| Pembayaran dan riwayat transaksi | ✓ | ✓ | – | – |
| Shift kasir | – | ✓ buka dan tutup | – | – |
| Member | ✓ | ✓ | – | – |
| Voucher dan undian | ✓ kelola | ✓ lihat voucher | – | – |
| Service order dan penugasan | ✓ | ✓ intake, lihat, tugaskan | ✓ job miliknya | – |
| Kerja teknisi (temuan, foto, review) | ✓ | – | ✓ | – |
| Pengajuan material | ✓ putuskan | – | ✓ ajukan dan tandai dipakai | – |
| Stok: masuk, opname, adjust, mutasi | ✓ | – | – | ✓ |
| Label QR unit | ✓ | ✓ | – | ✓ |
| Scan unit keluar gudang (Keluar Gudang) | ✓ | – | – | ✓ |
| Lihat produk dan sparepart | ✓ | ✓ | ✓ | ✓ |
| Ubah produk, sparepart, harga jual | ✓ | – | – | – |
| Laporan stok tanpa modal, omzet, untung | ✓ | – | – | ✓ |
| Laporan penjualan, servis, laba-rugi | ✓ | – | – | – |
| Pengingat dan template WA | ✓ kelola | ✓ lihat | – | – |
| Pengguna, pengaturan, audit, data lampau, reset | ✓ | – | – | – |

---

## 18. Alur QR unit AC

Dua QR berbeda: QR unit gudang (kardus di rak, kode `PRD-0001-U0007`) dan QR unit terpasang (di AC rumah pelanggan, dipindai teknisi).

```mermaid
flowchart TB
  subgraph GUDANG["GUDANG"]
    direction TB
    G1["Barang masuk stock-in<br/>tiap unit dapat kode + QR"]
    G2["Cetak label QR<br/>tempel di kardus unit"]
    G5["Ambil unit dari rak"]
    G6["Scan QR di label unit"]
    G7{"QR terbaca?"}
    G8["Ceklist manual tanpa scan"]
  end
  subgraph KASIR["KASIR"]
    direction TB
    K1["Checkout di POS<br/>pilih produk, bayar"]
  end
  subgraph SISTEM["SISTEM"]
    direction TB
    S1["Unit dijatah ke invoice<br/>status reserved"]
    S2["Notifikasi ke gudang<br/>siapkan N unit"]
    S3["Unit ditandai KELUAR<br/>stok resmi berkurang"]
  end
  subgraph TEKNISI["TEKNISI"]
    direction TB
    T1["Pasang AC di rumah pelanggan<br/>unit terpasang dapat barcode sendiri"]
    T2["Scan QR unit terpasang<br/>lihat riwayat, lengkapi data"]
  end

  G1 --> G2
  G2 -- "unit siap dijual" --> K1
  K1 --> S1
  S1 --> S2
  S2 --> G5
  G5 --> G6
  G6 --> G7
  G7 -- "ya" --> S3
  G7 -- "tidak" --> G8
  G8 --> S3
  S3 --> T1
  T1 --> T2

```
