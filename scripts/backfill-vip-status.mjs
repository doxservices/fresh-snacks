/**
 * One-time correction for tabs stuck showing "vip" even though they
 * already have a real first+last name on file - the Generate Invite
 * auto-promotion sets vipStatus:"vip", and nothing used to re-sync it once
 * a real name arrived later (especially via an admin rename, which never
 * even wrote firstName/lastName before). Going forward, ../functions/src/
 * routes/admin.js's renameUser and store.js's PATCH /profile both keep
 * this in sync on every write - this script is only for records that were
 * already wrong before that fix shipped.
 *
 * Usage:
 *   node scripts/backfill-vip-status.mjs
 *   node scripts/backfill-vip-status.mjs --apply
 *
 * Application Default Credentials must have Firestore admin access.
 */
import { createRequire } from "node:module";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);
const { hasRealName, splitDisplayName } = require("../functions/src/lib/shared.js");

const apply = process.argv.includes("--apply");
const projectId = "fresh-snacks-ee79f";

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const usersSnap = await db.collection("users").where("vipStatus", "==", "vip").get();
const users = usersSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));

const candidates = users
  .map((user) => {
    // Prefer already-split firstName/lastName; fall back to splitting
    // displayName the same way renameUser now does, for a tab whose real
    // name only ever arrived through the single admin text field.
    const hasSplitName = (user.firstName || "").trim() && (user.lastName || "").trim();
    const fallback = hasSplitName ? null : splitDisplayName(user.displayName || "");
    const firstName = hasSplitName ? user.firstName : fallback.firstName;
    const lastName = hasSplitName ? user.lastName : fallback.lastName;
    return { user, firstName, lastName, real: hasRealName({ firstName, lastName, displayName: user.displayName, email: user.email, phone: user.phone }) };
  })
  .filter((row) => row.real);

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  vipTabCount: users.length,
  candidateCount: candidates.length,
  candidates: candidates.map((row) => ({
    id: row.user.id,
    displayName: row.user.displayName,
    firstName: row.firstName,
    lastName: row.lastName,
    hadSplitFirstLast: !!((row.user.firstName || "").trim() && (row.user.lastName || "").trim()),
  })),
}, null, 2));

if (apply && candidates.length) {
  for (const row of candidates) {
    const payload = { vipStatus: "named", updatedAt: FieldValue.serverTimestamp() };
    if (!((row.user.firstName || "").trim() && (row.user.lastName || "").trim())) {
      payload.firstName = row.firstName;
      payload.lastName = row.lastName;
    }
    await row.user.ref.set(payload, { merge: true });
  }
  console.log(`Corrected vipStatus for ${candidates.length} tab(s) that already had a real name.`);
}
