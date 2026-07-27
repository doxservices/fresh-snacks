/* One-time (idempotent) cleanup: before today's fix, settlementPaymentWrite()
 * (mark-paid/confirm-payment) wrote note: "Settles <snack name>" instead of
 * a plain empty note plus structured settlesSnackName/settlesSnackId fields.
 * This backfills settlesSnackName onto those older payment docs (parsed from
 * the note text, or from the referenced transaction if still present for a
 * more reliable settlesSnackId too) and clears note to "" to match every
 * other payment's default - only touches docs whose note still matches the
 * old "Settles ..." pattern, so it's safe to re-run.
 * Requires GOOGLE_APPLICATION_CREDENTIALS. Run: node scripts/backfill-payment-settlement-fields.mjs
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const snap = await db.collection("payments").get();
let updated = 0;
let batch = db.batch();
let pending = 0;

for (const doc of snap.docs) {
  const data = doc.data();
  const match = /^Settles (.+)$/.exec(data.note || "");
  if (!match) continue;

  const fields = { note: "" };
  if (!data.settlesSnackName) fields.settlesSnackName = match[1];
  if (!data.settlesSnackId && data.settlesTransactionId) {
    const txnSnap = await db.collection("transactions").doc(data.settlesTransactionId).get();
    if (txnSnap.exists && txnSnap.data().snackId) fields.settlesSnackId = txnSnap.data().snackId;
  }

  batch.update(doc.ref, fields);
  updated++;
  pending++;
  if (pending >= 400) {
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }
}
if (pending) await batch.commit();
console.log(JSON.stringify({ scanned: snap.size, updated }, null, 2));
