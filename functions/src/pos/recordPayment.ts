import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { computeInvoiceStatus } from "./invoice";
import { validateRecordPaymentInput, RecordPaymentInput } from "./validation";

const BLOCKED_STATUS = new Set(["batal", "refund"]);

export const recordPayment = onCall(async (request) => {
  const role = request.auth?.token?.role;
  if (role !== "admin" && role !== "kasir")
    throw new HttpsError("permission-denied", "Hanya Admin/Kasir");

  const v = validateRecordPaymentInput(request.data);
  if (!v.ok) throw new HttpsError("invalid-argument", v.error);
  const input: RecordPaymentInput = v.value;

  const uid = request.auth!.uid;
  const db = getFirestore();
  const invoiceRef = db.doc(`invoices/${input.invoiceId}`);

  const result = await db.runTransaction(async (tx) => {
    // ---------- SEMUA READ DULU ----------
    const invoiceSnap = await tx.get(invoiceRef);

    // ---------- VALIDASI ----------
    if (!invoiceSnap.exists) throw new HttpsError("not-found", "Invoice tidak ditemukan");

    const grandTotal = Number(invoiceSnap.get("grand_total") ?? 0);
    const currentPaid = Number(invoiceSnap.get("total_paid") ?? 0);
    const currentStatus = String(invoiceSnap.get("status") ?? "");

    if (BLOCKED_STATUS.has(currentStatus))
      throw new HttpsError("failed-precondition", "Invoice sudah batal/refund");

    if (input.amount > grandTotal - currentPaid)
      throw new HttpsError("failed-precondition", "Melebihi sisa tagihan");

    const newTotalPaid = currentPaid + input.amount;
    const newStatus = computeInvoiceStatus(grandTotal, newTotalPaid);

    // ---------- SEMUA WRITE ----------
    const paymentRef = db.collection("manual_payments").doc();
    tx.set(paymentRef, {
      invoice_id: input.invoiceId,
      method: input.method,
      amount: input.amount,
      note: input.note ?? null,
      proof_url: null,
      created_by: uid,
      created_at: FieldValue.serverTimestamp(),
    });

    tx.update(invoiceRef, {
      total_paid: newTotalPaid,
      status: newStatus,
    });

    tx.set(db.collection("audit_logs").doc(), {
      actor_uid: uid,
      action: "pos.payment",
      target: input.invoiceId,
      detail: { method: input.method, amount: input.amount, status: newStatus },
      at: FieldValue.serverTimestamp(),
    });

    return { status: newStatus, totalPaid: newTotalPaid };
  });

  return result;
});
