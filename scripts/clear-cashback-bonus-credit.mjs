/* Testing-phase reset: voids every cashback-sourced payment (source:
 * "cashback") for every user/tab in the database, across all of them - not
 * a specific test account. Uses the same soft-delete convention as the
 * existing admin "void payment" endpoint (status: "void" + voidedBy/
 * voidedAt) rather than hard-deleting, so every `.where("status", "==",
 * "active")` balance/credit query (store.js, settlement.js, firebase-
 * store.js's FS.totals()) stops counting it immediately, while still
 * leaving an audit trail instead of erasing the record outright.
 *
 * Does NOT touch the underlying snack-charge transactions - only the
 * cashback bonus credit itself is reset, per explicit confirmation this
 * is testing-phase data with no real customers yet.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (or `gcloud auth application-
 * default login`) for a principal with Firestore write access to the
 * fresh-snacks-ee79f project.
 * Run: node scripts/clear-cashback-bonus-credit.mjs
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const snap = await db.collection("payments").where("source", "==", "cashback").where("status", "==", "active").get();
let voided = 0;
let batch = db.batch();
let pending = 0;

for (const doc of snap.docs) {
  batch.update(doc.ref, {
    status: "void",
    voidedBy: "testing-reset",
    voidedAt: FieldValue.serverTimestamp(),
    voidReason: "Cashback bonus credit reset during testing phase",
  });
  voided++;
  pending++;
  if (pending >= 400) {
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }
}
if (pending) await batch.commit();
console.log(JSON.stringify({ scanned: snap.size, voided }, null, 2));
