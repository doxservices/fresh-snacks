/* Customer-facing endpoints - ports of js/firebase-store.js's FS.* functions
 * that touch Firestore. Every write re-checks the same ownership/linking
 * conditions firestore.rules used to enforce (see ../lib/authz.js), since
 * the Admin SDK used here bypasses those rules entirely. */
const express = require("express");
const admin = require("firebase-admin");
const { requireAuth, optionalAuth, resolveEffectiveUid, asyncRoute } = require("../middleware");
const { canAccessTab, isLinkedMember } = require("../lib/authz");
const {
  uid: genId, todayISO, withBundledSnackArtwork, compareSnackOrder,
  bundledSnackArtwork, toEntry, toPayment, clean, randomCode,
} = require("../lib/shared");

const router = express.Router();
const db = () => admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const APP_NAME = "Fresh Snacks";
const CURRENCY = "J$";
const ANON_PREFIX = "Guest";

function profileComplete(profile) {
  if (!profile) return false;
  const displayName = clean(profile.displayName)
    || clean(`${profile.firstName || ""} ${profile.lastName || ""}`);
  return profile.nameSet === true
    || !!profile.createdByAdmin
    || !!(displayName && clean(profile.email) && clean(profile.phone));
}

async function getSettingsData() {
  const snap = await db().collection("settings").doc("app").get();
  const settings = snap.exists ? snap.data() : {};
  return {
    brand: settings.brand || APP_NAME,
    subtitle: settings.subtitle || "Private snack profile",
    currency: settings.currency || CURRENCY,
    openingLabel: settings.openingLabel || "Previous Period",
    openingNote: settings.openingNote || "Before daily records",
    favoriteSnackId: settings.favoriteSnackId || null,
    favoriteName: settings.favoriteName || "Favorite snack",
    favoriteDescription: settings.favoriteDescription || "",
  };
}

async function getCatalogData(includeInactive) {
  const ref = includeInactive
    ? db().collection("snacks")
    : db().collection("snacks").where("active", "==", true);
  const snap = await ref.get();
  return snap.docs
    .map((doc) => withBundledSnackArtwork({ id: doc.id, ...doc.data() }, bundledSnackArtwork))
    .filter((s) => includeInactive || s.active !== false)
    .sort(compareSnackOrder);
}

router.get("/settings", asyncRoute(async (req, res) => {
  res.json(await getSettingsData());
}));

router.get("/catalog", asyncRoute(async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  res.json(await getCatalogData(includeInactive));
}));

router.get("/profile", optionalAuth, asyncRoute(async (req, res) => {
  if (!req.uid) { res.json({ userId: null, vipStatus: "anonymous" }); return; }
  const effectiveUid = await resolveEffectiveUid(req);
  const snap = await db().collection("users").doc(effectiveUid).get();
  res.json({ userId: effectiveUid, vipStatus: "anonymous", ...(snap.exists ? snap.data() : {}) });
}));

router.patch("/profile", requireAuth, asyncRoute(async (req, res) => {
  const effectiveUid = await resolveEffectiveUid(req);
  const ref = db().collection("users").doc(effectiveUid);
  const existing = await ref.get();
  const firstName = clean(req.body.firstName);
  const lastName = clean(req.body.lastName);
  const email = clean(req.body.email);
  const phone = clean(req.body.phone);
  const displayName = clean(req.body.displayName) || clean(`${firstName || ""} ${lastName || ""}`);
  const payload = {
    firstName,
    lastName,
    email,
    phone,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (displayName) payload.displayName = displayName;

  // A tab only counts as "opened" once a real name AND real contact info
  // are on file - this is the actual accountability backstop that
  // POST /transactions checks before allowing a self-logged purchase (see
  // below), not just a UX nicety, so it takes all four fields rather than
  // a name alone. Existing profiles that already earned nameSet under the
  // old (name-only) rule are untouched, since this only ever sets the
  // field forward, never clears it.
  if (displayName && email && phone) {
    payload.vipStatus = "named";
    payload.nameSet = true;
    // Referral/de-link origin is only worth capturing the moment a tab is
    // actually opened, and only for the caller's own identity - not while
    // editing a linked target's shared profile.
    if (effectiveUid === req.uid) {
      const referredBy = clean(req.body.referredBy);
      if (referredBy && !(existing.exists && existing.data().referredBy)) {
        payload.referredBy = referredBy;
      }
      const claimSnap = await db().collection("claims").doc(req.uid).get();
      if (claimSnap.exists && claimSnap.data().active === false) {
        payload.previousLinkedTo = claimSnap.data().unlinkedFrom || null;
        payload.previousLinkCode = claimSnap.data().code || null;
        payload.previousLinkUnlinkedAt = claimSnap.data().unlinkedAt || null;
      }
    }
  }
  if (!existing.exists) {
    payload.userId = effectiveUid;
    payload.uid = effectiveUid;
    payload.vipStatus = payload.vipStatus || "anonymous";
    payload.createdAt = FieldValue.serverTimestamp();
  }
  await ref.set(payload, { merge: true });
  const fresh = await ref.get();
  res.json({ userId: effectiveUid, vipStatus: "anonymous", ...fresh.data() });
}));

router.post("/feedback", requireAuth, asyncRoute(async (req, res) => {
  const { firstName, lastName, email, phone, category, amount, requestType, requestedSnack, contactConsent, details } = req.body;
  const id = genId("fs_fb");
  const now = FieldValue.serverTimestamp();
  const feedbackName = [clean(firstName), clean(lastName)].filter(Boolean).join(" ") || "Feedback User";
  const payload = {
    feedbackId: id,
    uid: req.uid,
    firstName: clean(firstName),
    lastName: clean(lastName),
    email: clean(email),
    phone: clean(phone),
    contactConsent: !!phone && !!contactConsent,
    amount: amount > 0 ? Number(amount) : null,
    requestType: clean(requestType),
    requestedSnack: clean(requestedSnack),
    category: category || "other",
    details: clean(details) || "",
    status: "new",
    createdAt: now,
  };
  const userRef = db().collection("users").doc(req.uid);
  const userSnap = await userRef.get();
  const batch = db().batch();
  batch.set(db().collection("feedback").doc(id), payload);
  batch.set(userRef, userSnap.exists ? {
    tabId: req.uid,
    lastFeedbackAt: now,
  } : {
    userId: req.uid,
    uid: req.uid,
    tabId: req.uid,
    displayName: feedbackName,
    vipStatus: "feedback",
    profileSource: "feedback",
    createdAt: now,
    lastFeedbackAt: now,
  }, { merge: true });
  await batch.commit();
  res.json(payload);
}));

/* Ports FS.loadData(). tabCode/linkedTo are client-supplied (they live in
 * the browser's own URL/localStorage) but never trusted blindly - the
 * claim/link relationship is re-verified server-side before any other
 * user's data is included. */
/* Read-only lookups by an arbitrary userId (used internally by loadData's
 * claim-merge, and exposed here too for 1:1 parity with the original
 * FS.getUserTransactions/FS.getUserPayments). Gated the same way the read
 * rule for these collections used to be: admin, own uid, claim, or linked
 * membership - never a blind lookup of someone else's tab. */
router.get("/user-transactions", requireAuth, asyncRoute(async (req, res) => {
  const { userId } = req.query;
  if (!userId) throw Object.assign(new Error("userId is required."), { status: 400 });
  if (!(await canAccessTab(req.uid, userId))) throw Object.assign(new Error("Not authorized for this tab."), { status: 403 });
  const snap = await db().collection("transactions").where("userId", "==", userId).where("status", "==", "active").get();
  res.json(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}));

router.get("/user-payments", requireAuth, asyncRoute(async (req, res) => {
  const { userId } = req.query;
  if (!userId) throw Object.assign(new Error("userId is required."), { status: 400 });
  if (!(await canAccessTab(req.uid, userId))) throw Object.assign(new Error("Not authorized for this tab."), { status: 403 });
  const snap = await db().collection("payments").where("userId", "==", userId).where("status", "==", "active").get();
  res.json(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}));

router.get("/data", optionalAuth, asyncRoute(async (req, res) => {
  const [profile, catalog] = await Promise.all([getSettingsData(), getCatalogData(false)]);
  const tabCode = req.query.tabCode ? String(req.query.tabCode).toUpperCase() : null;

  if (!req.uid) {
    res.json({ profile, catalog, claim: null, entries: [], payments: [] });
    return;
  }

  const effectiveUid = await resolveEffectiveUid(req);

  let claim = null;
  if (tabCode) {
    const codeSnap = await db().collection("codes").doc(tabCode).get();
    if (codeSnap.exists && codeSnap.data().active !== false && codeSnap.data().userId && codeSnap.data().type !== "link") {
      await db().collection("claims").doc(req.uid).set({
        uid: req.uid,
        code: tabCode,
        createdAt: FieldValue.serverTimestamp(),
      });
      const target = codeSnap.data().userId;
      if (target !== req.uid) {
        let displayName = null;
        const u = await db().collection("users").doc(target).get();
        if (u.exists) displayName = u.data().displayName || null;
        claim = { code: tabCode, userId: target, displayName };
      }
    }
  }

  const fetchFor = async (userId) => {
    const [txnSnap, paySnap] = await Promise.all([
      db().collection("transactions").where("userId", "==", userId).where("status", "==", "active").get(),
      db().collection("payments").where("userId", "==", userId).where("status", "==", "active").get(),
    ]);
    return {
      transactions: txnSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      payments: paySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  };

  const own = await fetchFor(effectiveUid);
  let entries = own.transactions.map(toEntry);
  let pays = own.payments.map(toPayment);

  if (claim) {
    const claimed = await fetchFor(claim.userId);
    entries = entries.concat(claimed.transactions.map(toEntry));
    pays = pays.concat(claimed.payments.map(toPayment));
  }

  entries = entries.filter((entry) => entry.userStatus !== "disputed");
  const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));
  res.json({
    profile,
    catalog,
    claim,
    entries: entries.sort(byDate),
    payments: pays.sort(byDate),
  });
}));

router.post("/transactions", requireAuth, asyncRoute(async (req, res) => {
  const items = req.body.items || [];
  const validItems = items.map((item) => {
    const snack = item.snack || item;
    const quantity = Number(item.qty || item.quantity || 1);
    return { snack, quantity };
  }).filter(({ snack, quantity }) => snack && snack.id && quantity > 0 && Number(snack.price || 0) > 0);
  if (!validItems.length) throw Object.assign(new Error("Choose at least one priced snack."), { status: 400 });

  const effectiveUid = await resolveEffectiveUid(req);
  const userRef = db().collection("users").doc(effectiveUid);
  const userSnap = await userRef.get();

  // A device acting as its own (not a linked/effective) identity must have
  // actually opened a tab - name, email, and phone all on file - before it
  // can self-log a purchase. This is the real enforcement; index.html's
  // visitor-only gallery is just the UX for it. A device linked onto an
  // already-complete target profile is unaffected, and so is any profile an
  // admin already set up in person (createdByAdmin) - that's already a
  // vetted, accountable tab, not an anonymous one hiding behind this gate.
  if (effectiveUid === req.uid) {
    const self = userSnap.exists ? userSnap.data() : null;
    if (!profileComplete(self)) {
      throw Object.assign(new Error("Open a tab first - add your name, email, and phone to start logging snacks."), { status: 403 });
    }
  }

  const deviceId = `fs_dev-${req.uid}`;
  const visitorId = `fs_guest-${req.uid}`;
  const batch = db().batch();
  const today = todayISO();
  const now = FieldValue.serverTimestamp();

  batch.set(db().collection("devices").doc(deviceId), {
    deviceId,
    uid: req.uid,
    visitorId,
    userId: effectiveUid,
    deviceLabel: req.body.deviceLabel || "Browser",
    status: "active",
    lastSeenAt: now,
    userAgentBrief: String(req.headers["user-agent"] || "").slice(0, 160),
    source: "web",
  }, { merge: true });

  const userBase = {
    userId: effectiveUid,
    uid: effectiveUid,
    lastSeenAt: now,
    linkedDevices: FieldValue.arrayUnion(deviceId),
  };
  if (userSnap.exists) {
    batch.set(userRef, userBase, { merge: true });
  } else {
    batch.set(userRef, {
      ...userBase,
      displayName: `${ANON_PREFIX} ${randomCode(4)}`,
      vipStatus: "anonymous",
      email: null,
      phone: null,
      favoriteSnackId: null,
      createdAt: now,
    });
  }

  const saved = [];
  for (const { snack, quantity } of validItems) {
    const transactionId = genId("fs_txn");
    const record = {
      transactionId,
      uid: effectiveUid,
      userId: effectiveUid,
      deviceId,
      visitorId,
      snackId: snack.id,
      snackName: snack.name,
      quantity,
      unitPrice: Number(snack.price || 0),
      total: Number(snack.price || 0) * quantity,
      calories: snack.calories ?? null,
      source: "self",
      createdAt: now,
      createdDate: today,
      status: "active",
      reviewStatus: "approved",
      approvedAt: now,
    };
    batch.set(db().collection("transactions").doc(transactionId), record);
    saved.push(record);
  }
  await batch.commit();
  res.json(saved);
}));

router.patch("/transactions/:id/status", requireAuth, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const verdict = req.body.verdict || null;
  if (verdict && !["agreed", "disputed"].includes(verdict)) {
    throw Object.assign(new Error("Choose a valid verdict."), { status: 400 });
  }
  const ref = db().collection("transactions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error("Transaction not found."), { status: 404 });
  const record = snap.data();
  if (!(await canAccessTab(req.uid, record.userId))) {
    throw Object.assign(new Error("Not authorized for this transaction."), { status: 403 });
  }
  const payload = verdict
    ? { userStatus: verdict, userStatusAt: FieldValue.serverTimestamp() }
    : { userStatus: FieldValue.delete(), userStatusAt: FieldValue.delete() };
  await ref.update(payload);
  res.json({ ok: true });
}));

router.patch("/transactions/:id/date", requireAuth, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { createdDate } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate || "")) throw Object.assign(new Error("Choose a valid date."), { status: 400 });
  const ref = db().collection("transactions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error("Transaction not found."), { status: 404 });
  const record = snap.data();
  if (!(await canAccessTab(req.uid, record.userId))) {
    throw Object.assign(new Error("Not authorized for this transaction."), { status: 403 });
  }
  await ref.update({ createdDate, dateEditedAt: FieldValue.serverTimestamp() });
  res.json({ ok: true });
}));

router.post("/claim/resolve", requireAuth, asyncRoute(async (req, res) => {
  const code = String(req.body.code || "").toUpperCase();
  if (!code) { res.json(null); return; }
  const snap = await db().collection("codes").doc(code).get();
  if (!snap.exists || snap.data().active === false || !snap.data().userId || snap.data().type === "link") {
    res.json(null);
    return;
  }
  await db().collection("claims").doc(req.uid).set({
    uid: req.uid,
    code,
    createdAt: FieldValue.serverTimestamp(),
  });
  const target = snap.data().userId;
  if (target === req.uid) { res.json(null); return; }
  let displayName = null;
  const u = await db().collection("users").doc(target).get();
  if (u.exists) displayName = u.data().displayName || null;
  res.json({ code, userId: target, displayName });
}));

router.post("/link/accept", requireAuth, asyncRoute(async (req, res) => {
  const code = String(req.body.code || "").toUpperCase();
  if (!code) throw Object.assign(new Error("No invite link found."), { status: 400 });
  const codeSnap = await db().collection("codes").doc(code).get();
  if (!codeSnap.exists || codeSnap.data().active === false || codeSnap.data().type !== "link" || !codeSnap.data().userId) {
    throw Object.assign(new Error("This invite link is no longer valid."), { status: 400 });
  }
  const targetUid = codeSnap.data().userId;
  if (targetUid === req.uid) { res.json({ alreadySelf: true }); return; }

  const priorLinkedTo = req.body.priorLinkedTo;
  const targetRef = db().collection("users").doc(targetUid);
  const claimRef = db().collection("claims").doc(req.uid);
  const priorRef = priorLinkedTo && priorLinkedTo !== req.uid && priorLinkedTo !== targetUid
    ? db().collection("users").doc(priorLinkedTo)
    : null;
  let targetData;

  // Capacity check, new membership, claim activation, and removal from a
  // genuinely different prior profile are one transaction. Previously the
  // old membership was removed before checking the destination's 3-device
  // limit, so a failed switch could strand a known browser on neither tab.
  await db().runTransaction(async (transaction) => {
    const targetSnap = await transaction.get(targetRef);
    const priorSnap = priorRef ? await transaction.get(priorRef) : null;
    if (!targetSnap.exists) throw Object.assign(new Error("That tab no longer exists."), { status: 404 });

    targetData = targetSnap.data();
    const linked = [...new Set(targetData.linkedUids || [])];
    if (!linked.includes(req.uid) && linked.length >= 3) {
      throw Object.assign(new Error("This tab already has the maximum of 3 linked devices."), { status: 400 });
    }

    if (!linked.includes(req.uid)) {
      transaction.update(targetRef, { linkedUids: FieldValue.arrayUnion(req.uid) });
    }
    transaction.set(claimRef, {
      uid: req.uid,
      code,
      active: true,
      linkedTo: targetUid,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (priorRef && priorSnap?.exists && (priorSnap.data().linkedUids || []).includes(req.uid)) {
      transaction.update(priorRef, { linkedUids: FieldValue.arrayRemove(req.uid) });
    }
  });

  res.json({ userId: targetUid, displayName: targetData.displayName || ANON_PREFIX });
}));

router.post("/link/unlink", requireAuth, asyncRoute(async (req, res) => {
  const linkedTo = req.body.linkedTo;
  if (!linkedTo || linkedTo === req.uid) { res.json({ ok: true }); return; }
  if (!(await isLinkedMember(req.uid, linkedTo))) {
    // already not a member - nothing to do, mirrors the client's own no-op guard
    res.json({ ok: true });
    return;
  }
  await db().collection("users").doc(linkedTo).update({
    linkedUids: FieldValue.arrayRemove(req.uid),
  });
  // Keep the claims doc around as de-link history instead of deleting it -
  // surfaced later if this device ever opens its own tab (see PATCH
  // /profile). myClaimedCode() in authz.js already treats an inactive claim
  // as no claim at all, so this doesn't restore any access.
  await db().collection("claims").doc(req.uid).set({
    active: false,
    unlinkedFrom: linkedTo,
    unlinkedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => {});
  res.json({ ok: true });
}));

module.exports = router;
