/* Builds a real user profile for data migrated from the legacy app.
 *
 * Creates users/{cust-XXXXXXXX}, re-homes every transaction/payment from the
 * old placeholder profile onto it, repoints existing share codes, and removes
 * the placeholder. The share link (site/CODE) keeps working throughout.
 *
 * Usage:
 *   node scripts/migrate-legacy-user.mjs [oldUserId]     (default: legacy-profile)
 *   DISPLAY_NAME="Real Name" node scripts/migrate-legacy-user.mjs
 * Requires GOOGLE_APPLICATION_CREDENTIALS.
 */
import { randomInt } from "node:crypto";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
const siteBase = process.env.SITE_BASE || "https://doxservices.github.io/fresh-snacks";
const oldId = process.argv[2] || "legacy-profile";

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const oldSnap = await db.collection("users").doc(oldId).get();
if (!oldSnap.exists) {
  console.error(`users/${oldId} does not exist — nothing to migrate.`);
  process.exit(1);
}
const old = oldSnap.data();
const displayName = (process.env.DISPLAY_NAME || "").trim() || old.displayName || "Fresh Snacks Customer";

const chars = "abcdefghjkmnpqrstuvwxyz23456789";
const newId = "cust-" + Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");

const batch = db.batch();
batch.set(db.collection("users").doc(newId), {
  userId: newId,
  uid: newId,
  displayName,
  vipStatus: "vip",
  email: old.email || null,
  phone: old.phone || null,
  favoriteSnackId: old.favoriteSnackId || null,
  linkedDevices: old.linkedDevices || [],
  migratedFrom: oldId,
  createdAt: FieldValue.serverTimestamp(),
});

const counts = {};
for (const col of ["transactions", "payments"]) {
  const q = await db.collection(col).where("userId", "==", oldId).get();
  counts[col] = q.size;
  for (const d of q.docs) {
    const patch = { userId: newId };
    if ("uid" in d.data()) patch.uid = newId;
    batch.update(d.ref, patch);
  }
}

const codes = await db.collection("codes").where("userId", "==", oldId).get();
counts.codes = codes.size;
const codeIds = codes.docs.map((d) => d.id);
for (const d of codes.docs) batch.update(d.ref, { userId: newId });

batch.delete(db.collection("users").doc(oldId));
await batch.commit();

console.log(JSON.stringify({
  newUserId: newId,
  displayName,
  rehomed: counts,
  links: codeIds.map((c) => `${siteBase}/${c}`),
  removed: `users/${oldId}`,
}, null, 2));
