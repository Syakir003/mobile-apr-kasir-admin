import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "localhost:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "localhost:8080";

initializeApp({ projectId: "demo-epos-ac" });

const email = "admin@eposac.local";
const password = "admin12345";

const auth = getAuth();
const db = getFirestore();

let user;
try {
  user = await auth.getUserByEmail(email);
} catch {
  user = await auth.createUser({ email, password, displayName: "Admin Utama" });
}
await auth.setCustomUserClaims(user.uid, { role: "admin" });
await db.doc(`users/${user.uid}`).set({
  email, display_name: "Admin Utama", role: "admin", active: true,
  created_at: FieldValue.serverTimestamp(),
}, { merge: true });

console.log(`Admin siap: ${email} / ${password} (uid ${user.uid})`);
