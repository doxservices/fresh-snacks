/* Mints an 8-character share code for a user's tab and prints the link.
 *
 * The code goes in codes/{CODE} -> { userId }. Anyone opening
 * index.html?code=CODE sees that user's history merged into their own tab
 * (enforced by firestore.rules — codes can't be listed, only fetched).
 *
 * Usage:
 *   node scripts/make-code.mjs [userId]        (default: legacy-profile)
 *   DISPLAY_NAME="Xavier" node scripts/make-code.mjs legacy-profile
 * Requires GOOGLE_APPLICATION_CREDENTIALS.
 */
import { randomInt } from "node:crypto";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
const userId = process.argv[2] || "legacy-profile";
const siteBase = process.env.SITE_BASE || "https://doxservices.github.io/fresh-snacks";

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const userSnap = await db.collection("users").doc(userId).get();
if (!userSnap.exists) {
  console.error(`users/${userId} does not exist — refusing to mint a code for it.`);
  process.exit(1);
}

// unambiguous charset (no 0/O/1/I)
const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const gen = () => Array.from({ length: 8 }, () => chars[randomInt(chars.length)]).join("");

let code;
for (let i = 0; i < 5; i++) {
  const candidate = gen();
  const clash = await db.collection("codes").doc(candidate).get();
  if (!clash.exists) { code = candidate; break; }
}
if (!code) throw new Error("could not find a free code (very unlikely) — rerun");

await db.collection("codes").doc(code).set({
  code,
  userId,
  active: true,
  createdAt: FieldValue.serverTimestamp(),
});

if (process.env.DISPLAY_NAME) {
  await db.collection("users").doc(userId).set(
    { displayName: process.env.DISPLAY_NAME.trim() }, { merge: true });
}

console.log(JSON.stringify({
  code,
  userId,
  displayName: process.env.DISPLAY_NAME || userSnap.data().displayName || null,
  link: `${siteBase}/?code=${code}`,
}, null, 2));
