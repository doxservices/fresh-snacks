/* Server-side ports of firestore.rules' authorization helper functions
 * (isLinkedMember, hasClaimOn, hasLinkOn). The Admin SDK bypasses
 * firestore.rules entirely, so every customer-facing write/read that used
 * to be gated by these must re-check the same conditions here, by hand,
 * before touching data - the endpoint's own code is now the only thing
 * standing in for what the rules used to enforce. */
const admin = require("firebase-admin");

async function isLinkedMember(uid, ownerId) {
  if (!ownerId) return false;
  const snap = await admin.firestore().collection("users").doc(ownerId).get();
  return snap.exists && (snap.data().linkedUids || []).includes(uid);
}

async function myClaimedCode(uid) {
  const snap = await admin.firestore().collection("claims").doc(uid).get();
  if (!snap.exists || snap.data().active === false) return "";
  return snap.data().code || "";
}

async function hasClaimOn(uid, ownerId) {
  if (!ownerId) return false;
  const code = await myClaimedCode(uid);
  if (!code) return false;
  const codeSnap = await admin.firestore().collection("codes").doc(code).get();
  return codeSnap.exists && codeSnap.data().userId === ownerId;
}

async function claimedCodeType(uid) {
  const code = await myClaimedCode(uid);
  if (!code) return "view";
  const codeSnap = await admin.firestore().collection("codes").doc(code).get();
  return codeSnap.exists ? (codeSnap.data().type || "view") : "view";
}

async function hasLinkOn(uid, ownerId) {
  if (!(await hasClaimOn(uid, ownerId))) return false;
  return (await claimedCodeType(uid)) === "link";
}

async function hasInviteSession(uid, ownerId) {
  if (!ownerId) return false;
  const snap = await admin.firestore().collection("claims").doc(uid).get();
  if (!snap.exists) return false;
  const claim = snap.data();
  return claim.active !== false
    && claim.accessMode === "session"
    && claim.linkedTo === ownerId
    && await hasLinkOn(uid, ownerId);
}

async function isAdmin(uid) {
  if (!uid) return false;
  const snap = await admin.firestore().collection("admins").doc(uid).get();
  return snap.exists && snap.data().active === true;
}

/* True if `uid` is allowed to read/act on `ownerId`'s tab - an admin
 * (checked first, exactly like firestore.rules' `isAdmin() || ...`
 * ordering on every users/transactions/payments read rule - edit-tab.html
 * and similar admin pages call these same customer-facing endpoints to
 * view a customer's tab, so admin must always pass here too, not just
 * the tab's own owner/claim/linked-member), own uid, a view-code claim,
 * or full device-linked membership. */
async function canAccessTab(uid, ownerId) {
  if (uid === ownerId) return true;
  if (await isAdmin(uid)) return true;
  if (await hasClaimOn(uid, ownerId)) return true;
  if (await isLinkedMember(uid, ownerId)) return true;
  if (await hasInviteSession(uid, ownerId)) return true;
  return false;
}

module.exports = { isLinkedMember, hasClaimOn, hasLinkOn, hasInviteSession, canAccessTab, isAdmin, myClaimedCode };
