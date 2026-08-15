// Tipe & nilai status yang mencerminkan backend (lihat supabase/migrations
// dan app/lib/data/models). Semua status disimpan text snake_case di DB.

export type Role = "admin" | "kasir" | "teknisi";

export type PaymentMethod = "tunai" | "transfer" | "qris" | "ewallet";

export type InvoiceStatus =
  | "belum_dibayar"
  | "dp"
  | "kurang_bayar"
  | "lunas"
  | "refund"
  | "batal";

export type JobStatus =
  | "menunggu_penugasan"
  | "assigned"
  | "sedang_dikerjakan"
  | "selesai"
  | "dibatalkan";

export type OrderStatus =
  | "terjadwal"
  | "dalam_pengerjaan"
  | "selesai"
  | "dibatalkan";

export type AcUnitStatus =
  | "menunggu_pemasangan"
  | "aktif"
  | "dalam_maintenance"
  | "rusak"
  | "nonaktif";

export type ItemKind = "product" | "sparepart" | "service";

export type WaKind = "selesai_servis" | "reminder_h3" | "reminder_h7";

export type WaStatus = "pending" | "terkirim" | "gagal" | "dibatalkan";

// ---- Label Indonesia untuk UI ---------------------------------------------

export const roleLabel: Record<Role, string> = {
  admin: "Admin",
  kasir: "Kasir",
  teknisi: "Teknisi",
};

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  belum_dibayar: "Belum Dibayar",
  dp: "DP",
  kurang_bayar: "Kurang Bayar",
  lunas: "Lunas",
  refund: "Refund",
  batal: "Batal",
};

export const jobStatusLabel: Record<JobStatus, string> = {
  menunggu_penugasan: "Menunggu Penugasan",
  assigned: "Ditugaskan",
  sedang_dikerjakan: "Sedang Dikerjakan",
  selesai: "Selesai",
  dibatalkan: "Dibatalkan",
};

export const waKindLabel: Record<WaKind, string> = {
  selesai_servis: "Selesai Servis",
  reminder_h3: "Pengingat H-3",
  reminder_h7: "Terlambat 7 Hari",
};

// ---- Baris tabel (subset yang dipakai contoh) -----------------------------

export type Invoice = {
  id: string;
  number: string;
  customer_name: string;
  grand_total: number;
  status: InvoiceStatus;
  created_at: string;
};

/**
 * Satu baris antrean WhatsApp (`wa_outbox`). `phone` sudah ternormalisasi ke
 * `62xxx` dan `body` sudah tersusun lengkap oleh Postgres — web hanya
 * menampilkannya, tidak pernah menyusun ulang redaksi pesannya.
 */
export type WaMessage = {
  id: string;
  member_id: string;
  phone: string;
  kind: WaKind;
  unit_ids: string[] | null;
  due_date: string | null;
  body: string;
  status: WaStatus;
  created_at: string;
};

export type TechnicianJob = {
  id: string;
  order_id: string;
  member_id: string | null;
  unit_id: string | null;
  technician_id: string | null;
  type: string;
  status: JobStatus;
  notes: string | null;
  created_at: string;
};
