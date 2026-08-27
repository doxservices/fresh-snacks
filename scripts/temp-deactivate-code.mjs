/* One-off: deactivate a leaked code so the old value stops working. */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const code = process.argv[2];
if (!code) { console.error("usage: node scripts/temp-deactivate-code.mjs CODE"); process.exit(1); }

initializeApp({ credential: applicationDefault(), projectId: "fresh-snacks-ee79f" });
const db = getFirestore();

await db.collection("codes").doc(code).set({
  active: false,
  deactivatedBy: "security-rotation-2026-08-27",
  deactivatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

console.log(`codes/${code} deactivated.`);
