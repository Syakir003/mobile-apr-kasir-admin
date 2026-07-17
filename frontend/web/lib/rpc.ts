import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemKind, PaymentMethod } from "./types";

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
