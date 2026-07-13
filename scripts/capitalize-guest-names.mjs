/* One-time (idempotent) fix: existing anonymous users were seeded with a
 * lowercase "guest XXXX" displayName before the app switched to "Guest".
 * Only touches docs that are still anonymous and still match the old
 * "guest <code>" pattern -- named/VIP/legacy profiles are untouched.
 * Requires GOOGLE_APPLICATION_CREDENTIALS. Run: node scripts/capitalize-guest-names.mjs
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const snap = await db.collection("users").get();
let updated = 0;
const batch = db.batch();
for (const doc of snap.docs) {
  const data = doc.data();
  if (data.vipStatus !== "anonymous") continue;
  const m = /^guest (\S+)$/.exec(data.displayName || "");
  if (!m) continue;
  batch.update(doc.ref, { displayName: `Guest ${m[1]}` });
  updated++;
}
if (updated) await batch.commit();
console.log(JSON.stringify({ scanned: snap.size, updated }, null, 2));
