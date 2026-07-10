/* Seeds Firestore from firebase-seed.json and bootstraps the first admin.
 *
 * - Writes settings/snacks/users/transactions/payments docs (merge, so
 *   rerunning is safe and won't clobber newer live data fields).
 * - Skips the placeholder admins entry in the seed file.
 * - If ADMIN_EMAIL is set: creates (or reuses) that Firebase Auth user and
 *   writes an active /admins/{uid} doc. Prints a generated password only
 *   when the user is newly created.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS. Run: node scripts/seed.mjs
 */
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

async function seedCollections(seed) {
  const summary = {};
  for (const [collection, docs] of Object.entries(seed)) {
    if (collection === "admins") continue; // placeholder UID — handled below
    let count = 0;
    const batch = db.batch();
    for (const [id, data] of Object.entries(docs)) {
      batch.set(db.collection(collection).doc(id), {
        ...data,
        seededAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      count++;
    }
    await batch.commit();
    summary[collection] = count;
  }
  return summary;
}

async function ensureAdmin(email) {
  const auth = getAuth();
  let user;
  let password = null;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    password = randomBytes(9).toString("base64url");
    user = await auth.createUser({ email, password, displayName: "Owner" });
  }
  await db.collection("admins").doc(user.uid).set({
    uid: user.uid,
    email,
    displayName: user.displayName || "Owner",
    role: "owner",
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { uid: user.uid, email, password };
}

async function main() {
  const seed = JSON.parse(await readFile(new URL("../firebase-seed.json", import.meta.url), "utf8"));
  const seeded = await seedCollections(seed);

  let admin = null;
  if (process.env.ADMIN_EMAIL) {
    admin = await ensureAdmin(process.env.ADMIN_EMAIL.trim());
  }

  console.log(JSON.stringify({
    projectId,
    seeded,
    admin: admin && {
      uid: admin.uid,
      email: admin.email,
      password: admin.password || "(existing user — password unchanged)",
    },
  }, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
