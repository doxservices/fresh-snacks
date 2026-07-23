const admin = require("firebase-admin");

/* Verifies the Firebase ID token in the Authorization header, mirroring
 * what the client SDK proved just by having a signed-in session. Every
 * route needs this - even "public" reads need to know which uid (if any)
 * is asking, since some reads are gated on ownership/linking. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    res.status(401).json({ error: "Missing Authorization header." });
    return;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.uid = decoded.uid;
    req.isAnonymous = decoded.firebase?.sign_in_provider === "anonymous";
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid or expired session." });
  }
}

/* Same authorization proof FS.admin.requireAdmin() used to do client-side:
 * a non-anonymous Firebase user with admins/{uid}.active === true. This is
 * the ONLY thing that proves admin authority - re-implemented here exactly
 * since the Admin SDK bypasses firestore.rules entirely. */
async function requireAdmin(req, res, next) {
  if (!req.uid || req.isAnonymous) {
    res.status(403).json({ error: "Admin login required." });
    return;
  }
  try {
    const snap = await admin.firestore().collection("admins").doc(req.uid).get();
    if (!snap.exists || snap.data().active !== true) {
      res.status(403).json({ error: "This Firebase user is not active in /admins." });
      return;
    }
    req.adminProfile = { uid: req.uid, ...snap.data() };
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/* Recover an active device link from server-side records when this known
 * browser has lost only its localStorage `linkedTo` marker. A claim alone is
 * not enough: it must point to an active link code AND the target profile
 * must still list this exact authenticated uid in linkedUids. */
async function linkedTargetFromClaim(uid) {
  const firestore = admin.firestore();
  const claimSnap = await firestore.collection("claims").doc(uid).get();
  if (!claimSnap.exists || claimSnap.data().active === false || !claimSnap.data().code) return null;

  const codeSnap = await firestore.collection("codes").doc(claimSnap.data().code).get();
  if (!codeSnap.exists || codeSnap.data().active === false || codeSnap.data().type !== "link") return null;
  const targetUid = codeSnap.data().userId;
  if (!targetUid || targetUid === uid) return null;

  const targetSnap = await firestore.collection("users").doc(targetUid).get();
  if (!targetSnap.exists || !(targetSnap.data().linkedUids || []).includes(uid)) return null;
  return targetUid;
}

/* Resolves + VERIFIES the "effective" uid a customer request wants to act
 * as, mirroring firestore.rules' isLinkedMember(). A different requested uid
 * only works when the target still lists this caller. When no usable target
 * was supplied, an existing active link can be recovered from server state;
 * otherwise the request safely falls back to the caller's own uid. */
async function resolveEffectiveUid(req) {
  const requested = req.query.effectiveUid || req.body?.effectiveUid;
  if (requested && requested !== req.uid) {
    const snap = await admin.firestore().collection("users").doc(requested).get();
    if (snap.exists && (snap.data().linkedUids || []).includes(req.uid)) {
      return requested;
    }
    return req.uid;
  }
  return (await linkedTargetFromClaim(req.uid)) || req.uid;
}

/* Same token verification as requireAuth, but never rejects a missing/
 * invalid token - just leaves req.uid unset. Mirrors functions like
 * FS.getMyProfile()/FS.loadData() that work fine for a browser that's
 * never signed in at all (a genuinely fresh guest). */
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) { next(); return; }
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.uid = decoded.uid;
    req.isAnonymous = decoded.firebase?.sign_in_provider === "anonymous";
  } catch (e) {
    // an expired/invalid token on an optional-auth route just means "treat
    // this as a signed-out visitor", not a hard failure
  }
  next();
}

function asyncRoute(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((e) => {
      res.status(e.status || 400).json({ error: e.message || "Something went wrong." });
    });
  };
}

module.exports = { requireAuth, optionalAuth, requireAdmin, resolveEffectiveUid, asyncRoute };
