/* One-time (idempotent) backfill: any profile that already has both a
 * firstName and lastName on file gets its displayName corrected to match
 * ("First Last"), overriding any older/placeholder value (e.g. "Guest
 * ABCD") that predates PATCH /store/profile deriving displayName from
 * name parts. Matches what that route now does automatically going
 * forward - see functions/src/routes/store.js.
 * Requires GOOGLE_APPLICATION_CREDENTIALS. Run: node scripts/fix-display-name-from-name-parts.mjs
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const clean = (v) => {
  const s = (v ?? "").toString().trim();
  return s || null;
};

const snap = await db.collection("users").get();
let updated = 0;
const batch = db.batch();
for (const doc of snap.docs) {
  const data = doc.data();
  const firstName = clean(data.firstName);
  const lastName = clean(data.lastName);
  if (!firstName || !lastName) continue;
  const correctName = `${firstName} ${lastName}`;
  if (data.displayName === correctName) continue;
  batch.update(doc.ref, { displayName: correctName });
  updated++;
}
if (updated) await batch.commit();
console.log(JSON.stringify({ scanned: snap.size, updated }, null, 2));
