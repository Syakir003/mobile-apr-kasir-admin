# Flow Sistem E-POS AC

Alur inti sistem — dipakai bersama oleh **Flutter (mobile)** dan **Next.js (web)** di atas backend Supabase yang sama. Semua penulisan data lewat **RPC**; pembacaan lewat `select` (dibatasi RLS); peran dibaca dari **klaim JWT `user_role`**.

---

## 1. Arsitektur — satu backend, dua frontend

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#CCFBF1','primaryBorderColor':'#0F766E','lineColor':'#64748B','primaryTextColor':'#0F172A','fontFamily':'system-ui'}}}%%
flowchart LR
  M["📱 Flutter<br/>(mobile)"]
  W["🌐 Next.js<br/>(web) — kamu"]

  subgraph SB["Supabase"]
    direction TB
    A["Auth<br/>+ JWT user_role"]
    R["RPC<br/>SECURITY DEFINER"]
    DB[("Postgres<br/>tabel + RLS")]
    RT["Realtime"]
  end

  M -->|login| A
  W -->|login| A
  M -->|"TULIS: rpc()"| R
  W -->|"TULIS: rpc()"| R
  M -->|"BACA: select"| DB
  W -->|"BACA: select"| DB
  R --> DB
  RT -.->|stream| DB
```

> Web tidak membuat backend baru — hanya memanggil auth, RPC, dan tabel yang sama. RLS menjaga data di sisi server apa pun frontend-nya.

---

## 2. Login & Peran (dari mana `user_role` datang)

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#CCFBF1','primaryBorderColor':'#0F766E','lineColor':'#64748B','fontFamily':'system-ui'}}}%%
sequenceDiagram
  autonumber
  participant C as Client (web/mobile)
  participant Auth as Supabase Auth
  participant Hook as custom_access_token_hook
  participant U as tabel users
  C->>Auth: signInWithPassword(email, password)
  Auth->>Hook: terbitkan access token
  Hook->>U: baca role (hanya jika active)
  U-->>Hook: admin | kasir | teknisi
  Hook-->>Auth: sisipkan klaim user_role
  Auth-->>C: JWT berisi user_role
  Note over C: gate menu berdasar role;<br/>server tetap dijaga RLS
```

> Baca role di client: decode `session.access_token` → `user_role`. Jangan query tabel `users` untuk otorisasi menu — pakai klaim JWT.

---

## 3. Checkout POS → member, unit, order, job

Satu panggilan `checkout_transaction` mengurus semuanya secara atomik.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#CCFBF1','primaryBorderColor':'#0F766E','lineColor':'#64748B','primaryTextColor':'#0F172A','fontFamily':'system-ui'}}}%%
flowchart TD
  K["Kasir/Admin: keranjang<br/>+ data pelanggan"] --> RPC{{"rpc: checkout_transaction"}}
  RPC --> MEM["Member: cari by No. HP<br/>buat baru bila belum ada"]
  RPC --> STK["Stok −qty<br/>catat stock_movements"]
  RPC --> INV["Invoice + item<br/>status: belum_dibayar"]
  RPC -->|"item punya jasa pasang"| UNIT["Unit AC baru<br/>+ barcode ACUNIT-…"]
  UNIT --> ORD["service_order<br/>(terjadwal)"]
  ORD --> OU["service_order_unit<br/>(per unit)"]
  ORD --> JOB["technician_job<br/>assigned / menunggu_penugasan"]

  JOB -.->|lanjut| L["Lihat Flow 4"]
```

> Beli AC + jasa pasang otomatis melahirkan member, unit, barcode, order, dan job teknisi — tanpa input ganda.

---

## 4. Siklus status Job Teknisi

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#CCFBF1','primaryBorderColor':'#0F766E','lineColor':'#64748B','fontFamily':'system-ui'}}}%%
stateDiagram-v2
  [*] --> menunggu_penugasan
  menunggu_penugasan --> assigned: assign_technician_job<br/>(admin/kasir)
  assigned --> sedang_dikerjakan: start + scan barcode COCOK
  sedang_dikerjakan --> selesai: complete + diagnosa
  menunggu_penugasan --> dibatalkan: cancel (admin)
  assigned --> dibatalkan: cancel (admin)
  sedang_dikerjakan --> dibatalkan: cancel (admin)
  selesai --> [*]

  note right of sedang_dikerjakan
    scan wajib & harus
    cocok unit (rule 8.2)
  end note
  note right of selesai
    unit AC -> aktif
    last_service_date terisi
    next_service_date dijadwalkan
    (cuci/maintenance saja)
    order selesai bila
    semua unit selesai
  end note
```

> Transisi dilakukan lewat `update_technician_job_status` (`start` / `complete` / `cancel`). Teknisi hanya boleh mengubah job miliknya; `cancel` hanya admin.

---

## 5. Pembayaran manual & status invoice

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#CCFBF1','primaryBorderColor':'#0F766E','lineColor':'#64748B','primaryTextColor':'#0F172A','fontFamily':'system-ui'}}}%%
flowchart LR
  P["rpc: record_payment<br/>tunai/transfer/qris/ewallet"] --> C{"total bayar<br/>vs total invoice"}
  C -->|"0"| B["belum_dibayar"]
  C -->|"sebagian"| D["dp / kurang_bayar"]
  C -->|"≥ total"| L["lunas"]
  ADJ["tambahan biaya disetujui<br/>setelah lunas"] --> KB["kurang_bayar"]
```

> Satu invoice bisa punya banyak pembayaran. Status dihitung otomatis oleh RPC (total invoice − total bayar). Kalau sudah lunas lalu ada biaya tambahan → kembali `kurang_bayar`.

---

## 6. Pengingat servis via WhatsApp

Pesan tidak pernah dikirim langsung dari trigger — semuanya masuk antrean
`wa_outbox` dulu, supaya cara kirimnya bisa diganti tanpa menyentuh skema.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#CCFBF1','primaryBorderColor':'#0F766E','lineColor':'#64748B','primaryTextColor':'#0F172A','fontFamily':'system-ui'}}}%%
flowchart TD
  J["Job cuci/maintenance selesai"] --> N["member_ac_units<br/>next_service_date = +interval"]
  J --> Q1["wa_outbox: selesai_servis"]
  N --> CRON{{"pg_cron harian 09:00 WIB<br/>enqueue_service_reminders()"}}
  CRON -->|"H-3"| Q2["wa_outbox: reminder_h3"]
  CRON -->|"H+7 & belum pesan"| Q3["wa_outbox: reminder_h7"]

  Q1 --> UI["Layar Pengingat<br/>(admin/kasir)"]
  Q2 --> UI
  Q3 --> UI
  UI -->|"buka wa.me lalu"| MS["rpc: mark_wa_sent<br/>status: terkirim"]
  UI -->|"tidak relevan"| CX["rpc: cancel_wa_message<br/>status: dibatalkan"]

  UI -.->|"nanti, adapter cloud_api"| EF["Edge Function send-wa<br/>(kirim otomatis)"]
```

> Interval diambil dari override per unit (`service_interval_days`), lalu default
> per jenis job (`reminder_settings`). Job berjalan pada unit yang sama otomatis
> menghentikan pengingatnya. `dedupe_key` menjamin scheduler yang jalan berkali-kali
> tidak pernah membuat pesan kembar.

---

### Ringkas untuk web (Next.js)

| Butuh | Caranya |
|-------|---------|
| Login | `supabase.auth.signInWithPassword(...)` |
| Tahu peran | decode JWT → klaim `user_role` |
| Buat transaksi | `supabase.rpc('checkout_transaction', { payload })` |
| Catat bayar | `supabase.rpc('record_payment', { payload })` |
| Tugaskan/kerjakan job | `assign_technician_job` / `update_technician_job_status` |
| Kirim pengingat servis | buka `https://wa.me/<phone>?text=…` lalu `mark_wa_sent` |
| Tampilkan data | `supabase.from('...').select()` (RLS otomatis) |

Semua RPC & kontrak lengkapnya ada di halaman **Panduan Backend**.
