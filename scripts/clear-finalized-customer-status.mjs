/**
 * Removes obsolete customer confirmation fields from finalized transactions.
 *
 * Usage:
 *   node scripts/clear-finalized-customer-status.mjs
 *   node scripts/clear-finalized-customer-status.mjs --apply
 *
 * Requires Application Default Credentials with Firestore write access.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");
const projectId = "fresh-snacks-ee79f";

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const snapshot = await db.collection("transactions")
  .where("reviewStatus", "==", "paid")
  .get();

const affected = snapshot.docs
  .filter((doc) => {
    const record = doc.data();
    return Object.hasOwn(record, "userStatus") || Object.hasOwn(record, "userStatusAt");
  })
  .map((doc) => ({
    id: doc.id,
    userId: doc.data().userId || doc.data().uid || null,
    createdDate: doc.data().createdDate || null,
    userStatus: doc.data().userStatus || null,
  }));

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  finalizedTransactions: snapshot.size,
  affectedCount: affected.length,
  affected,
}, null, 2));

if (apply && affected.length) {
  for (let offset = 0; offset < affected.length; offset += 450) {
    const batch = db.batch();
    for (const record of affected.slice(offset, offset + 450)) {
      batch.update(db.collection("transactions").doc(record.id), {
        userStatus: FieldValue.delete(),
        userStatusAt: FieldValue.delete(),
      });
    }
    await batch.commit();
  }
  console.log(`Cleared legacy customer status from ${affected.length} finalized transaction(s).`);
}
