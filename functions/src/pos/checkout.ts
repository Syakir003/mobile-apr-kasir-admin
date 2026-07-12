import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  DocumentReference,
  DocumentData,
  DocumentSnapshot,
} from "firebase-admin/firestore";
import { normalizePhone } from "./phone";
import { computeTotals } from "./totals";
import { formatInvoiceNumber } from "./invoice";
import { dateKey, formatBarcode } from "../units/barcode";
import { validateCheckoutInput, CheckoutInput, CheckoutItem } from "./validation";

const MASTER_COLLECTION: Record<CheckoutItem["kind"], string> = {
  product: "products",
  sparepart: "spareparts",
  service: "services",
};

type MasterLine = {
  name: string;
  unit: string;
  unitPrice: number;
};

/** Snapshot item transaksi (dipakai untuk subcollection `items` & array `items[]` invoice). */
type TxItemSnapshot = {
  kind: CheckoutItem["kind"];
  ref_id: string;
  name: string;
  unit: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

export const checkoutTransaction = onCall(async (request) => {
  const role = request.auth?.token?.role;
  if (role !== "admin" && role !== "kasir")
    throw new HttpsError("permission-denied", "Hanya Admin/Kasir");

  const v = validateCheckoutInput(request.data);
  if (!v.ok) throw new HttpsError("invalid-argument", v.error);
  const input: CheckoutInput = v.value;

  const uid = request.auth!.uid;
  const db = getFirestore();
  const now = new Date();
  const phone = normalizePhone(input.customer.phone);
  const discount = input.discount ?? 0;
  const taxPercent = input.taxPercent ?? 0;
  const transportFee = input.transportFee ?? 0;
  const installations = input.installations ?? [];
  const hasInstallations = installations.length > 0;

  const invoiceCounterRef = db.doc(`counters/invoice_${dateKey(now)}`);
  const acUnitCounterRef = db.doc(`counters/acunit_${dateKey(now)}`);
  const memberQuery = db.collection("members").where("phone", "==", phone).limit(1);

  const itemRefs = input.items.map((item) =>
    db.doc(`${MASTER_COLLECTION[item.kind]}/${item.refId}`)
  );

  const technicianIds = Array.from(
    new Set(
      installations
        .map((i) => i.technicianId)
        .filter((t): t is string => typeof t === "string" && t.length > 0)
    )
  );
  const technicianRefs = technicianIds.map((tid) => db.doc(`users/${tid}`));

  const result = await db.runTransaction(async (tx) => {
    // ---------- SEMUA READ DULU ----------
    const memberSnap = await tx.get(memberQuery);
    const itemSnaps = await Promise.all(itemRefs.map((ref) => tx.get(ref)));
    const invoiceCounterSnap = await tx.get(invoiceCounterRef);
    const acUnitCounterSnap = hasInstallations ? await tx.get(acUnitCounterRef) : null;
    const technicianSnaps = await Promise.all(technicianRefs.map((ref) => tx.get(ref)));

    // ---------- VALIDASI MASTER DATA (murni baca, belum nulis) ----------
    const masterLines: MasterLine[] = input.items.map((item, idx) => {
      const snap = itemSnaps[idx];
      if (!snap.exists)
        throw new HttpsError("failed-precondition", `Item ${item.refId} tidak ditemukan`);
      const data = snap.data() as DocumentData;
      const name = String(data.name ?? item.refId);
      if (data.active === false)
        throw new HttpsError("failed-precondition", `${name} tidak aktif`);
      if (item.kind === "product" || item.kind === "sparepart") {
        const stock = Number(data.stock ?? 0);
        if (stock < item.qty)
          throw new HttpsError("failed-precondition", `Stok ${name} tidak cukup`);
      }
      const unitPrice =
        item.kind === "service" ? Number(data.basePrice ?? 0) : Number(data.sellPrice ?? 0);
      const unit =
        item.kind === "product" ? "unit" : item.kind === "service" ? "jasa" : String(data.unit ?? "");
      return { name, unit, unitPrice };
    });

    const technicianByIndex = new Map<string, DocumentSnapshot>();
    technicianIds.forEach((tid, idx) => technicianByIndex.set(tid, technicianSnaps[idx]));
    for (const tid of technicianIds) {
      const snap = technicianByIndex.get(tid)!;
      if (!snap.exists || snap.get("role") !== "teknisi" || snap.get("active") !== true)
        throw new HttpsError("invalid-argument", "Teknisi tidak valid atau tidak aktif");
    }

    const totals = computeTotals(
      input.items.map((item, idx) => ({ qty: item.qty, unitPrice: masterLines[idx].unitPrice })),
      discount,
      taxPercent,
      transportFee
    );
    if (discount > totals.subtotal)
      throw new HttpsError("failed-precondition", "Diskon melebihi subtotal");

    const memberDoc = memberSnap.docs[0];
    const isNewMember = !memberDoc;
    const memberRef: DocumentReference = memberDoc ? memberDoc.ref : db.collection("members").doc();
    const totalNewUnits = installations.length;

    const invoiceSeq = Number(invoiceCounterSnap.data()?.seq ?? 0) + 1;
    const invoiceNumber = formatInvoiceNumber(now, invoiceSeq);
    let acUnitSeq = Number(acUnitCounterSnap?.data()?.seq ?? 0);

    // ---------- SEMUA WRITE ----------
    if (isNewMember) {
      tx.set(memberRef, {
        name: input.customer.name,
        phone,
        address: input.customer.address ?? "",
        customer_type: "lainnya",
        member_since: FieldValue.serverTimestamp(),
        total_ac_units: totalNewUnits,
        notes: null,
        active: true,
      });
    } else if (totalNewUnits > 0) {
      tx.update(memberRef, { total_ac_units: FieldValue.increment(totalNewUnits) });
    }

    tx.set(invoiceCounterRef, { seq: invoiceSeq });

    const transactionRef = db.collection("transactions").doc();
    tx.set(transactionRef, {
      member_id: memberRef.id,
      customer_name: input.customer.name,
      customer_phone: phone,
      subtotal: totals.subtotal,
      discount,
      tax_percent: taxPercent,
      tax_amount: totals.taxAmount,
      transport_fee: transportFee,
      grand_total: totals.grandTotal,
      notes: input.notes ?? null,
      created_by: uid,
      created_at: FieldValue.serverTimestamp(),
    });

    const itemSnapshots: TxItemSnapshot[] = input.items.map((item, idx) => {
      const m = masterLines[idx];
      const lineTotal = Math.round(item.qty * m.unitPrice);
      const itemDoc: TxItemSnapshot = {
        kind: item.kind,
        ref_id: item.refId,
        name: m.name,
        unit: m.unit,
        qty: item.qty,
        unit_price: m.unitPrice,
        line_total: lineTotal,
      };
      tx.set(transactionRef.collection("items").doc(), itemDoc);

      if (item.kind === "product" || item.kind === "sparepart") {
        tx.set(db.collection("stock_movements").doc(), {
          item_kind: item.kind,
          ref_id: item.refId,
          name: m.name,
          qty_change: -item.qty,
          reason: "penjualan",
          transaction_id: transactionRef.id,
          created_by: uid,
          created_at: FieldValue.serverTimestamp(),
        });
        tx.update(itemRefs[idx], { stock: FieldValue.increment(-item.qty) });
      }
      return itemDoc;
    });

    const invoiceRef = db.collection("invoices").doc();
    tx.set(invoiceRef, {
      number: invoiceNumber,
      transaction_id: transactionRef.id,
      member_id: memberRef.id,
      customer_name: input.customer.name,
      customer_phone: phone,
      items: itemSnapshots,
      subtotal: totals.subtotal,
      discount,
      tax_percent: taxPercent,
      tax_amount: totals.taxAmount,
      transport_fee: transportFee,
      grand_total: totals.grandTotal,
      total_paid: 0,
      status: "belum_dibayar",
      notes: input.notes ?? null,
      created_by: uid,
      created_at: FieldValue.serverTimestamp(),
    });

    if (hasInstallations) {
      const orderRef = db.collection("service_orders").doc();
      const orderUnits: { unit_id: string; status: string }[] = [];

      for (const inst of installations) {
        const productData = itemSnaps[inst.itemIndex].data() as DocumentData;
        acUnitSeq += 1;
        const barcodeValue = formatBarcode(now, acUnitSeq);
        const unitRef = db.collection("member_ac_units").doc();
        tx.set(unitRef, {
          member_id: memberRef.id,
          brand: productData.brand ?? "",
          model: productData.type ?? "",
          pk: productData.pk ?? 0,
          room_location: inst.roomLocation ?? "",
          barcode_value: barcodeValue,
          serial_number: null,
          installation_date: null,
          last_service_date: null,
          next_service_date: null,
          status: "menunggu_pemasangan",
        });
        orderUnits.push({ unit_id: unitRef.id, status: "menunggu_pemasangan" });

        const technicianId = inst.technicianId ?? null;
        tx.set(db.collection("technician_jobs").doc(), {
          order_id: orderRef.id,
          member_id: memberRef.id,
          unit_id: unitRef.id,
          technician_id: technicianId,
          type: "pemasangan",
          status: technicianId ? "assigned" : "menunggu_penugasan",
          scheduled_date: null,
          created_by: uid,
          created_at: FieldValue.serverTimestamp(),
        });
      }

      tx.set(orderRef, {
        member_id: memberRef.id,
        transaction_id: transactionRef.id,
        invoice_id: invoiceRef.id,
        type: "pemasangan",
        status: "terjadwal",
        units: orderUnits,
        created_by: uid,
        created_at: FieldValue.serverTimestamp(),
      });

      tx.set(acUnitCounterRef, { seq: acUnitSeq });
    }

    tx.set(db.collection("audit_logs").doc(), {
      actor_uid: uid,
      action: "pos.checkout",
      target: invoiceRef.id,
      detail: { number: invoiceNumber, grand_total: totals.grandTotal },
      at: FieldValue.serverTimestamp(),
    });

    return {
      invoiceId: invoiceRef.id,
      invoiceNumber,
      memberId: memberRef.id,
      transactionId: transactionRef.id,
    };
  });

  return result;
});
