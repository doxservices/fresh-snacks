/**
 * Audits guest profiles and removes only guests with no recorded activity.
 *
 * Usage:
 *   node scripts/remove-orphan-guests.mjs
 *   node scripts/remove-orphan-guests.mjs --apply
 *
 * Recorded activity means any transaction, payment, adjustment, or feedback.
 * Application Default Credentials must have Firestore and Auth admin access.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");
const projectId = "fresh-snacks-ee79f";

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const auth = getAuth();
const collectionNames = [
  "users",
  "devices",
  "transactions",
  "payments",
  "adjustments",
  "feedback",
  "codes",
];
const snapshots = Object.fromEntries(await Promise.all(collectionNames.map(async (name) => {
  const snapshot = await db.collection(name).get();
  return [name, snapshot.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }))];
})));

const belongsTo = (record, ids) =>
  ids.has(record.userId) || ids.has(record.uid) || ids.has(record.ownerId);
const guestProfiles = snapshots.users.filter((profile) =>
  /^guest(?:\s|$)/i.test(String(profile.displayName || ""))
  || profile.vipStatus === "anonymous");

const audits = guestProfiles.map((profile) => {
  const linkedUids = [...new Set(profile.linkedUids || [])].filter(Boolean);
  const ids = new Set([profile.id, profile.userId, profile.uid, ...linkedUids].filter(Boolean));
  const related = {
    transactions: snapshots.transactions.filter((record) => belongsTo(record, ids)),
    payments: snapshots.payments.filter((record) => belongsTo(record, ids)),
    adjustments: snapshots.adjustments.filter((record) => belongsTo(record, ids)),
    feedback: snapshots.feedback.filter((record) => belongsTo(record, ids)),
    devices: snapshots.devices.filter((record) => belongsTo(record, ids) || ids.has(record.id)),
    codes: snapshots.codes.filter((record) => belongsTo(record, ids)),
  };
  const hasActivity = related.transactions.length > 0
    || related.payments.length > 0
    || related.adjustments.length > 0
    || related.feedback.length > 0;
  return {
    id: profile.id,
    displayName: profile.displayName || "",
    vipStatus: profile.vipStatus || "anonymous",
    profileSource: profile.profileSource || null,
    createdByAdmin: profile.createdByAdmin || null,
    linkedUids,
    counts: Object.fromEntries(Object.entries(related).map(([name, records]) =>
      [name, records.length])),
    hasActivity,
    profile,
    related,
  };
});

const rd16 = audits.filter((audit) => /rd16/i.test(audit.displayName));
const orphans = audits.filter((audit) => !audit.hasActivity);
const printable = (audit) => ({
  id: audit.id,
  displayName: audit.displayName,
  vipStatus: audit.vipStatus,
  profileSource: audit.profileSource,
  createdByAdmin: audit.createdByAdmin,
  linkedUids: audit.linkedUids,
  counts: audit.counts,
  hasActivity: audit.hasActivity,
});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  guestProfileCount: audits.length,
  rd16: rd16.map(printable),
  orphanCount: orphans.length,
  orphans: orphans.map(printable),
}, null, 2));

if (apply && orphans.length) {
  for (const orphan of orphans) {
    const batch = db.batch();
    batch.delete(db.collection("users").doc(orphan.id));
    for (const collection of ["devices", "codes"]) {
      for (const record of orphan.related[collection]) batch.delete(record.ref);
    }
    await batch.commit();

    const authUids = [...new Set([
      orphan.id,
      orphan.profile.userId,
      orphan.profile.uid,
      ...orphan.linkedUids,
    ].filter(Boolean))];
    for (const uid of authUids) {
      await auth.deleteUser(uid).catch((error) => {
        if (error.code !== "auth/user-not-found") throw error;
      });
    }
  }
  console.log(`Removed ${orphans.length} orphan guest profile(s) and their inactive links.`);
}
