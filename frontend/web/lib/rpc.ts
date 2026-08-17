import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemKind, PaymentMethod, VoucherDiscountType } from "./types";

// Wrapper typed untuk RPC Postgres. SEMUA penulisan data lewat sini — jangan
// insert/update tabel finansial/operasional langsung dari client.
//
// Semua RPC menerima satu argumen `payload` dan melempar Error berpesan
// Indonesia bila gagal (diteruskan dari PostgREST).

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  payload: unknown,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { payload });
  if (error) throw new Error(error.message);
  return data as T;
}

// ---- checkout_transaction -------------------------------------------------

export type CheckoutItem = { kind: ItemKind; refId: string; qty: number };
export type CheckoutInstallation = {
  itemIndex: number;
  roomLocation: string;
  technicianId?: string | null;
};
export type CheckoutPayload = {
  customer: { name: string; phone: string; address?: string };
  items: CheckoutItem[];
  discount: number;
  taxPercent: number;
  transportFee: number;
  notes: string;
  installations?: CheckoutInstallation[];
};
export type CheckoutResult = {
  invoiceId: string;
  invoiceNumber: string;
  memberId: string;
  transactionId: string;
};

export function checkoutTransaction(
  supabase: SupabaseClient,
  payload: CheckoutPayload,
) {
  return callRpc<CheckoutResult>(supabase, "checkout_transaction", payload);
}

// ---- record_payment -------------------------------------------------------

export type RecordPaymentPayload = {
  invoiceId: string;
  method: PaymentMethod;
  amount: number;
  note?: string;
};

export function recordPayment(
  supabase: SupabaseClient,
  payload: RecordPaymentPayload,
) {
  return callRpc<{ status: string; totalPaid: number }>(
    supabase,
    "record_payment",
    payload,
  );
}

// ---- job teknisi ----------------------------------------------------------

export function assignTechnicianJob(
  supabase: SupabaseClient,
  payload: { jobId: string; technicianId: string },
) {
  return callRpc<{ ok: boolean }>(supabase, "assign_technician_job", payload);
}

// ---- antrean pengingat WhatsApp -------------------------------------------

/**
 * Menandai satu pesan antrean sudah dikirim. Dipanggil SETELAH tautan wa.me
 * benar-benar terbuka — kalau statusnya diubah lebih dulu dan WhatsApp gagal
 * terbuka, pesan itu hilang dari antrean tanpa pernah sampai ke pelanggan.
 */
export function markWaSent(supabase: SupabaseClient, payload: { id: string }) {
  return callRpc<{ ok: boolean }>(supabase, "mark_wa_sent", payload);
}

export function cancelWaMessage(
  supabase: SupabaseClient,
  payload: { id: string; reason?: string },
) {
  return callRpc<{ ok: boolean }>(supabase, "cancel_wa_message", payload);
}

// ---- voucher & undian --------------------------------------------------

export type CreateVoucherPayload = {
  memberId: string;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscountCap?: number;
  minPurchase?: number;
  expiresAt: string; // 'YYYY-MM-DD'
  note?: string;
};

export function createVoucher(
  supabase: SupabaseClient,
  payload: CreateVoucherPayload,
) {
  return callRpc<{ ok: boolean; voucherId: string; code: string }>(
    supabase,
    "create_voucher",
    payload,
  );
}

export function cancelVoucher(
  supabase: SupabaseClient,
  payload: { voucherId: string; reason?: string },
) {
  return callRpc<{ ok: boolean }>(supabase, "cancel_voucher", payload);
}

export type CreateUndianPayload = {
  title: string;
  description?: string;
  criteria: { dateFrom?: string; dateTo?: string; mustHaveAcPurchase?: boolean };
  winnerCount: number;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscountCap?: number;
  minPurchase?: number;
  voucherValidDays: number;
};

export function createUndian(
  supabase: SupabaseClient,
  payload: CreateUndianPayload,
) {
  return callRpc<{ ok: boolean; undianId: string; participantCount: number }>(
    supabase,
    "create_undian",
    payload,
  );
}

export function updateUndianParticipants(
  supabase: SupabaseClient,
  payload: { undianId: string; add?: string[]; remove?: string[] },
) {
  return callRpc<{ ok: boolean; participantCount: number }>(
    supabase,
    "update_undian_participants",
    payload,
  );
}

export function drawUndian(
  supabase: SupabaseClient,
  payload: { undianId: string },
) {
  return callRpc<{ ok: boolean; undianId: string; winnerCount: number }>(
    supabase,
    "draw_undian",
    payload,
  );
}

export function cancelUndian(
  supabase: SupabaseClient,
  payload: { undianId: string },
) {
  return callRpc<{ ok: boolean }>(supabase, "cancel_undian", payload);
}

export type JobAction = "start" | "complete" | "cancel";

export function updateTechnicianJobStatus(
  supabase: SupabaseClient,
  payload: {
    jobId: string;
    action: JobAction;
    scannedBarcode?: string;
    notes?: string;
  },
) {
  return callRpc<{ ok: boolean; status: string }>(
    supabase,
    "update_technician_job_status",
    payload,
  );
}
