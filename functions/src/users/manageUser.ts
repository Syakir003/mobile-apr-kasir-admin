import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { validateManageUserInput, ManageUserInput } from "./validation";

export const manageUser = onCall(async (request) => {
  if (request.auth?.token?.role !== "admin")
    throw new HttpsError("permission-denied", "Hanya Admin");

  const v = validateManageUserInput(request.data as ManageUserInput);
  if (!v.ok) throw new HttpsError("invalid-argument", v.error);
  const input = v.value;

  const auth = getAuth();
  const db = getFirestore();

  if (input.action === "create") {
    const user = await auth.createUser({
      email: input.email, password: input.password, displayName: input.displayName,
    });
    await auth.setCustomUserClaims(user.uid, { role: input.role });
    await db.doc(`users/${user.uid}`).set({
      email: input.email, display_name: input.displayName, role: input.role,
      active: true, created_at: FieldValue.serverTimestamp(),
    });
    await db.collection("audit_logs").add({
      actor_uid: request.auth!.uid, action: "user.create",
      target: user.uid, detail: { role: input.role },
      at: FieldValue.serverTimestamp(),
    });
    return { uid: user.uid };
  }

  const disabled = input.action === "disable";
  await auth.updateUser(input.uid!, { disabled });
  await db.doc(`users/${input.uid}`).update({ active: !disabled });
  await db.collection("audit_logs").add({
    actor_uid: request.auth!.uid, action: `user.${input.action}`,
    target: input.uid, at: FieldValue.serverTimestamp(),
  });
  return { uid: input.uid };
});
