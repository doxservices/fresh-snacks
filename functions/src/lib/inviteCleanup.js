/* 24-hour cleanup for still-unnamed, unanswered VIP invites (see
 * ./shared.js's hasRealName/isPlaceholderDisplayName - a tab still sitting
 * on the Generate Invite placeholder, "VIP Customer"/vipStatus "vip",
 * never got a real identity). A tab nobody has accepted the invite for and
 * nobody has bought anything on, a full day after it was created, is
 * treated as a dead invite, not a real customer - deactivated, not
 * deleted, matching how every other removal in this app works
 * (transactions/payments are "voided," never hard-deleted). Runs on an
 * hourly schedule (see functions/index.js's expireStaleInvites) and is
 * also callable one at a time from accounting.html's "Expire now" button.
 */
const admin = require("firebase-admin");
const { hasRealName } = require("./shared");

const CLEANUP_GRACE_HOURS = 24;
const EXPIRED_REASON = "invite-unanswered-24h";

function ageMs(createdAt, now) {
  if (!createdAt) return null;
  const date = typeof createdAt.toDate === "function" ? createdAt.toDate() : new Date(createdAt);
  const ms = now.getTime() - date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Pure predicate - given a user record and whatever's already known about
// it (answered / has real activity), decide whether it's a candidate for
// the 24-hour sweep. Kept separate from the Firestore orchestration below
// so it's directly unit-testable.
function isCleanupCandidate(user, { answered, hasActivity, now }) {
  if (!user || user.status === "expired") return false;
  if (user.vipStatus !== "vip") return false;
  if (hasRealName(user)) return false;
  if (answered || hasActivity) return false;
  const age = ageMs(user.createdAt, now);
  return age != null && age >= CLEANUP_GRACE_HOURS * 3600 * 1000;
}

// Same rule, expressed as "how much grace time is left" rather than a
// pass/fail - what accounting.html's Pending invites section shows a
// countdown from. Returns null once the tab no longer qualifies at all
// (has a real name, already has activity, or is already expired).
function graceRemainingMs(user, { answered, hasActivity, now }) {
  if (!user || user.status === "expired") return null;
  if (user.vipStatus !== "vip") return null;
  if (hasRealName(user)) return null;
  if (answered || hasActivity) return null;
  const age = ageMs(user.createdAt, now);
  if (age == null) return null;
  return Math.max(0, CLEANUP_GRACE_HOURS * 3600 * 1000 - age);
}

async function activeLinkCodeIdsFor(firestore, userId) {
  const snap = await firestore.collection("codes")
    .where("type", "==", "link").where("userId", "==", userId).where("active", "==", true).get();
  return snap.docs.map((d) => d.id);
}

// Fixed reason tag on the CODE doc's deactivatedBy, regardless of whether
// this ran from the hourly sweep or an admin's "Expire now" button - what
// reactivateInvite below matches on, so it only ever undoes an expiry THIS
// mechanism made, never a code an admin separately deactivated for an
// unrelated reason. `expiredBy` on the USER doc is the real actor (a real
// admin uid, or the literal string "system-cleanup" for the sweep) and is
// audit-only - it's never read back to decide anything.
const CLEANUP_DEACTIVATE_TAG = "invite-cleanup";

// Deactivates every active link invite for one tab and marks it expired -
// the one place both the scheduled sweep and the manual "Expire now"
// button actually write. `now` is a plain Date (not FieldValue.serverTimestamp)
// so the same value can be asserted on immediately after in a test or in
// the calling route's response.
async function expireInvite(userId, { now = new Date(), actor = "system-cleanup", firestore = admin.firestore() } = {}) {
  const codeIds = await activeLinkCodeIdsFor(firestore, userId);
  const batch = firestore.batch();
  batch.set(firestore.collection("users").doc(userId), {
    status: "expired", expiredAt: now, expiredReason: EXPIRED_REASON, expiredBy: actor,
  }, { merge: true });
  for (const codeId of codeIds) {
    batch.set(firestore.collection("codes").doc(codeId), {
      active: false, deactivatedBy: CLEANUP_DEACTIVATE_TAG, deactivatedAt: now,
    }, { merge: true });
  }
  await batch.commit();
  return { userId, deactivatedCodeIds: codeIds };
}

// Reverses expireInvite - only reactivates codes THIS mechanism
// deactivated (deactivatedBy === CLEANUP_DEACTIVATE_TAG), never a code an
// admin deliberately deactivated for an unrelated reason before the sweep
// ever ran.
async function reactivateInvite(userId, { firestore = admin.firestore() } = {}) {
  const [userSnap, codesSnap] = await Promise.all([
    firestore.collection("users").doc(userId).get(),
    firestore.collection("codes").where("type", "==", "link").where("userId", "==", userId)
      .where("deactivatedBy", "==", CLEANUP_DEACTIVATE_TAG).get(),
  ]);
  if (!userSnap.exists) return { userId, reactivatedCodeIds: [] };
  const batch = firestore.batch();
  batch.set(firestore.collection("users").doc(userId), {
    status: admin.firestore.FieldValue.delete(),
    expiredAt: admin.firestore.FieldValue.delete(),
    expiredReason: admin.firestore.FieldValue.delete(),
    expiredBy: admin.firestore.FieldValue.delete(),
  }, { merge: true });
  const codeIds = codesSnap.docs.map((d) => d.id);
  for (const codeId of codeIds) {
    batch.set(firestore.collection("codes").doc(codeId), {
      active: true, deactivatedBy: admin.firestore.FieldValue.delete(), deactivatedAt: admin.firestore.FieldValue.delete(),
    }, { merge: true });
  }
  await batch.commit();
  return { userId, reactivatedCodeIds: codeIds };
}

async function runInviteCleanup({ now = new Date(), firestore = admin.firestore() } = {}) {
  const [usersSnap, transactionsSnap, paymentsSnap] = await Promise.all([
    firestore.collection("users").where("vipStatus", "==", "vip").get(),
    firestore.collection("transactions").select("userId").get(),
    firestore.collection("payments").select("userId").get(),
  ]);
  const activityUserIds = new Set([
    ...transactionsSnap.docs.map((d) => d.data().userId).filter(Boolean),
    ...paymentsSnap.docs.map((d) => d.data().userId).filter(Boolean),
  ]);

  const expiredUserIds = [];
  for (const doc of usersSnap.docs) {
    const user = { id: doc.id, ...doc.data() };
    const answered = (user.linkedUids || []).length > 0;
    const hasActivity = activityUserIds.has(doc.id);
    if (!isCleanupCandidate(user, { answered, hasActivity, now })) continue;
    await expireInvite(doc.id, { now, actor: "system-cleanup", firestore });
    expiredUserIds.push(doc.id);
  }
  return { expiredCount: expiredUserIds.length, expiredUserIds };
}

module.exports = {
  CLEANUP_GRACE_HOURS, EXPIRED_REASON, CLEANUP_DEACTIVATE_TAG,
  isCleanupCandidate, graceRemainingMs,
  expireInvite, reactivateInvite, runInviteCleanup,
};
