import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { dateKey, formatBarcode } from "./barcode";

export const generateAcUnitBarcode = onCall(async (request) => {
  const role = request.auth?.token?.role;
  if (role !== "admin" && role !== "kasir")
    throw new HttpsError("permission-denied", "Hanya Admin/Kasir");

  const unitId = (request.data as { unitId?: unknown })?.unitId;
  if (typeof unitId !== "string" || !unitId)
    throw new HttpsError("invalid-argument", "unitId wajib diisi");

  const db = getFirestore();
  const now = new Date();
  const counterRef = db.doc(`counters/acunit_${dateKey(now)}`);
  const unitRef = db.doc(`member_ac_units/${unitId}`);

  const barcode = await db.runTransaction(async (tx) => {
    const unit = await tx.get(unitRef);
    if (!unit.exists)
      throw new HttpsError("failed-precondition", "Unit tidak ditemukan");
    if (unit.get("barcode_value"))
      throw new HttpsError("failed-precondition", "Barcode sudah digenerate");

    const counter = await tx.get(counterRef);
    const seq = ((counter.data()?.seq as number | undefined) ?? 0) + 1;
    const value = formatBarcode(now, seq);
    tx.set(counterRef, { seq });
    tx.update(unitRef, { barcode_value: value });
    return value;
  });

  return { barcode };
});
