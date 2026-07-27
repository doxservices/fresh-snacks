/* Admin-only endpoints - ports of js/firebase-admin.js's FS.admin.* functions
 * that touch Firestore/Storage. Every route below requires admin auth
 * (see router.use at the bottom of the requires). */
const express = require("express");
const admin = require("firebase-admin");
const { requireAuth, requireAdmin, requirePermission, asyncRoute } = require("../middleware");
const {
  uid: genId, todayISO, dateFromRecord, accounting, paymentAllocationPlan,
  binTemplates, seasonalSnackIds, templateBinItems, randomCode, clean, compareSnackOrder,
} = require("../lib/shared");
const {
  STATUS, ROLE, ACTION, EVENT_TYPE, assertTransition, deriveWorkflowStatus, deriveCreatedByRole,
  availableActions: resolveAvailableActions,
} = require("../lib/transactionStatus");
const { buildTransactionEvent } = require("../lib/transactionEvents");
const { PERMISSION, ROLE_PRESETS } = require("../lib/permissions");

const router = express.Router();
const db = () => admin.firestore();
const FieldValue = admin.firestore.FieldValue;

router.use(requireAuth, requireAdmin);

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function getCollection(name) {
  const snap = await db().collection(name).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/* Replaces FS.admin.currentAdmin()/requireAdmin() on the client - if this
 * 403s, the middleware already rejected the request; reaching the handler
 * itself proves admin authority. */
router.get("/whoami", asyncRoute(async (req, res) => {
  res.json(req.adminProfile);
}));

// Backing data for stats.html - see src/lib/stats.js for exactly what's
// being counted (API requests as a proxy for Firestore reads/writes, not
// exact document-level counts).
router.get("/stats", asyncRoute(async (req, res) => {
  const snap = await db().collection("stats").doc("api-usage").get();
  res.json(snap.exists ? snap.data() : { totalReads: 0, totalWrites: 0, days: {} });
}));

router.get("/admins", requirePermission(PERMISSION.MANAGE_ADMINS), asyncRoute(async (req, res) => {
  const snap = await db().collection("admins").get();
  res.json(snap.docs.map((doc) => ({ uid: doc.id, ...doc.data() })));
}));

// Creates the Firebase Auth user directly (email + password) and its
// admins/{uid} doc together - the only admin sign-in method that can be
// provisioned without the person having signed in themselves first (Google/
// Microsoft admins still need their first OAuth sign-in before a uid
// exists to attach permissions to).
router.post("/admins", requirePermission(PERMISSION.MANAGE_ADMINS), asyncRoute(async (req, res) => {
  const { email, password, displayName, role } = req.body;
  const cleanEmail = clean(email);
  if (!cleanEmail) throw bad("Email is required.");
  if (!password || String(password).length < 8) throw bad("Choose a password at least 8 characters long.");
  const permissions = req.body.permissions && typeof req.body.permissions === "object"
    ? req.body.permissions
    : (ROLE_PRESETS[role] || ROLE_PRESETS.cashier);

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email: cleanEmail,
      password: String(password),
      displayName: clean(displayName) || cleanEmail,
    });
  } catch (error) {
    throw bad(error.code === "auth/email-already-exists" ? "An account with that email already exists." : error.message);
  }

  await db().collection("admins").doc(userRecord.uid).set({
    email: cleanEmail,
    displayName: clean(displayName) || cleanEmail,
    role: role || "custom",
    permissions,
    active: true,
    createdBy: req.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  res.json({ uid: userRecord.uid });
}));

router.patch("/admins/:uid", requirePermission(PERMISSION.MANAGE_ADMINS), asyncRoute(async (req, res) => {
  const { uid } = req.params;
  const { displayName, role, permissions, active } = req.body;
  if (uid === req.uid && active === false) throw bad("You cannot deactivate your own admin account.");
  if (uid === req.uid && permissions && permissions[PERMISSION.MANAGE_ADMINS] === false) {
    throw bad("You cannot remove your own admin-management permission.");
  }
  const payload = { updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() };
  if (displayName !== undefined) payload.displayName = clean(displayName);
  if (role !== undefined) payload.role = role;
  if (permissions && typeof permissions === "object") payload.permissions = permissions;
  if (active !== undefined) payload.active = active !== false;
  await db().collection("admins").doc(uid).set(payload, { merge: true });
  res.json({ ok: true });
}));

router.get("/snapshot", asyncRoute(async (req, res) => {
  const [settings, snacksSnap, users, devices, transactions, payments, adjustments, feedback] = await Promise.all([
    db().collection("settings").doc("app").get(),
    db().collection("snacks").get(),
    getCollection("users"),
    getCollection("devices"),
    getCollection("transactions"),
    getCollection("payments"),
    getCollection("adjustments"),
    getCollection("feedback"),
  ]);
  const settingsData = settings.exists ? settings.data() : {};
  // Same displayOrder-based sort the customer-facing catalog already uses
  // (store.js's getCatalogData) - catalog.html was showing raw Firestore
  // doc order instead of the curated gallery order set by dragging cards.
  const snacks = snacksSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(compareSnackOrder);
  // Every admin page renders its row actions from this - the same
  // server-computed availableActions() the customer side gets via toEntry(),
  // just for ROLE.ADMIN, so "what buttons show for this status" only ever
  // has one implementation to keep in sync.
  const enrichTransaction = (t) => {
    const workflowStatus = deriveWorkflowStatus(t);
    return {
      ...t,
      workflowStatus,
      createdByRole: deriveCreatedByRole(t),
      availableActions: resolveAvailableActions(workflowStatus, ROLE.ADMIN),
    };
  };
  const activeTransactions = transactions.filter((x) => x.status !== "void").map(enrichTransaction);
  // Voided transactions are deliberately excluded from `transactions`/
  // accounting() (that's the whole point of voiding one), but kept
  // reachable here in their own list rather than actually gone - the
  // highest-elevation admin (full permissions, nothing to hide from) can
  // still see and, if they choose to, permanently Delete one from it.
  const voidedTransactions = transactions.filter((x) => x.status === "void").map(enrichTransaction);
  const activePayments = payments.filter((x) => x.status !== "void");
  const activeAdjustments = adjustments.filter((x) => x.status !== "void");
  res.json({
    settings: {
      brand: settingsData.brand || "Fresh Snacks",
      currency: settingsData.currency || "J$",
      ...settingsData,
    },
    snacks,
    users,
    devices,
    transactions: activeTransactions,
    voidedTransactions,
    payments: activePayments,
    adjustments: activeAdjustments,
    feedback: feedback.sort((a, b) => dateFromRecord(b, "createdAt").localeCompare(dateFromRecord(a, "createdAt"))),
    accounting: accounting(users, devices, activeTransactions, activePayments, activeAdjustments),
  });
}));

router.patch("/feedback/:id/status", asyncRoute(async (req, res) => {
  await db().collection("feedback").doc(req.params.id).update({
    status: req.body.status,
    updatedBy: req.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
}));

router.post("/users/:userId/link-invite", asyncRoute(async (req, res) => {
  const { userId } = req.params;
  const userRef = db().collection("users").doc(userId);
  const userSnap = await userRef.get();
  const existing = userSnap.exists ? userSnap.data().linkInviteCode : null;
  if (existing) {
    const codeSnap = await db().collection("codes").doc(existing).get();
    if (codeSnap.exists && codeSnap.data().active !== false) { res.json({ code: existing, active: true }); return; }
  }
  let code;
  for (let i = 0; i < 6; i++) {
    const candidate = randomCode(8);
    const clash = await db().collection("codes").doc(candidate).get();
    if (!clash.exists) { code = candidate; break; }
  }
  if (!code) throw bad("Could not generate a unique invite code, try again.");
  await db().collection("codes").doc(code).set({
    code, userId, type: "link", active: true,
    createdBy: req.uid, createdAt: FieldValue.serverTimestamp(),
  });
  await userRef.set({ linkInviteCode: code }, { merge: true });
  res.json({ code, active: true });
}));

/* Flips the *existing* invite code active/inactive without replacing it -
 * lets an admin temporarily shut off joining (or re-open the same link
 * later) instead of only ever being able to mint a brand new code. An
 * inactive code immediately blocks new claims (POST /link/accept,
 * /link/session both check codes.active) and cuts off any device only
 * holding a view/session claim through it (see authz.js's hasClaimOn) - a
 * fully linked device is unaffected here; that needs the per-device
 * Unlink control instead. */
router.patch("/users/:userId/link-invite", asyncRoute(async (req, res) => {
  const { userId } = req.params;
  const active = req.body.active !== false;
  const userSnap = await db().collection("users").doc(userId).get();
  const code = userSnap.exists ? userSnap.data().linkInviteCode : null;
  if (!code) throw bad("No invite link exists yet for this tab. Generate one first.", 404);
  await db().collection("codes").doc(code).set({
    active,
    ...(active
      ? { reactivatedBy: req.uid, reactivatedAt: FieldValue.serverTimestamp() }
      : { deactivatedBy: req.uid, deactivatedAt: FieldValue.serverTimestamp() }),
  }, { merge: true });
  res.json({ code, active });
}));

router.get("/users/:userId/linked-devices", asyncRoute(async (req, res) => {
  const userSnap = await db().collection("users").doc(req.params.userId).get();
  const profile = userSnap.exists ? userSnap.data() : {};
  const linkedUids = [...new Set(profile.linkedUids || [])].filter(Boolean);
  const linkedDeviceIds = [...new Set(profile.linkedDevices || [])].filter(Boolean);
  const deviceDocs = new Map();
  const remember = (doc) => {
    if (doc?.exists) deviceDocs.set(doc.id, doc);
  };
  const [ownedSnap, linkedDeviceDocs, linkedUidSnaps] = await Promise.all([
    db().collection("devices").where("userId", "==", req.params.userId).get(),
    Promise.all(linkedDeviceIds.map((id) => db().collection("devices").doc(id).get())),
    Promise.all(linkedUids.map((uid) =>
      db().collection("devices").where("uid", "==", uid).get())),
  ]);
  ownedSnap.docs.forEach(remember);
  linkedDeviceDocs.forEach(remember);
  linkedUidSnaps.forEach((snapshot) => snapshot.docs.forEach(remember));

  const describeUserAgent = (value = "") => {
    const ua = String(value);
    const browser = /Edg\//i.test(ua) ? "Microsoft Edge"
      : /OPR\//i.test(ua) ? "Opera"
        : /CriOS|Chrome\//i.test(ua) ? "Google Chrome"
          : /FxiOS|Firefox\//i.test(ua) ? "Mozilla Firefox"
            : /Safari\//i.test(ua) ? "Safari" : "";
    const platform = /iPhone/i.test(ua) ? "iPhone"
      : /iPad/i.test(ua) ? "iPad"
        : /Android/i.test(ua) ? "Android"
          : /Windows/i.test(ua) ? "Windows"
            : /Mac OS X|Macintosh/i.test(ua) ? "macOS"
              : /Linux/i.test(ua) ? "Linux" : "";
    return { browser, platform };
  };
  const info = [...deviceDocs.values()].map((doc) => {
    const device = doc.data();
    const { browser, platform } = describeUserAgent(device.userAgentBrief);
    const recordId = doc.id;
    const deviceId = device.deviceId || recordId;
    const uid = device.uid || null;
    return {
      uid,
      recordId,
      deviceId,
      deviceLabel: device.deviceLabel
        || [browser, platform].filter(Boolean).join(" on ")
        || deviceId || recordId || uid,
      browser,
      platform,
      source: device.source || "",
      userAgentBrief: device.userAgentBrief || "",
      lastSeenDate: dateFromRecord(device, "lastSeenAt"),
    };
  });
  const representedUids = new Set(info.map((device) => device.uid).filter(Boolean));
  for (const uid of linkedUids) {
    if (!representedUids.has(uid)) {
      info.push({
        uid,
        recordId: null,
        deviceId: null,
        deviceLabel: `Linked device ${uid.slice(0, 8)}`,
        browser: "",
        platform: "",
        source: "",
        userAgentBrief: "",
        lastSeenDate: "",
      });
    }
  }
  info.sort((a, b) => String(a.deviceLabel).localeCompare(String(b.deviceLabel))
    || String(a.deviceId || a.uid).localeCompare(String(b.deviceId || b.uid)));
  res.json(info);
}));

router.delete("/users/:userId/linked-devices/:deviceUid", asyncRoute(async (req, res) => {
  await db().collection("users").doc(req.params.userId).update({
    linkedUids: FieldValue.arrayRemove(req.params.deviceUid),
  });
  // Removing membership alone doesn't revoke access - canAccessTab() grants
  // it from an active claims doc before it ever checks linkedUids. The
  // claim must be deactivated too, or the "unlinked" device keeps full
  // read/write access to this tab indefinitely (mirrors the deactivation
  // POST /store/link/unlink already does for a customer's own self-unlink).
  await db().collection("claims").doc(req.params.deviceUid).set({
    active: false,
    unlinkedFrom: req.params.userId,
    unlinkedBy: req.uid,
    unlinkedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => {});
  res.json({ ok: true });
}));

router.post("/payments", asyncRoute(async (req, res) => {
  const { userId, amount, note } = req.body;
  const paymentId = genId("fs_pay");
  await db().collection("payments").doc(paymentId).set({
    paymentId, userId, amount: Number(amount), note: note || "",
    source: "admin", createdBy: req.uid, createdAt: FieldValue.serverTimestamp(),
    createdDate: todayISO(), status: "active",
  });
  res.json({ paymentId });
}));

router.post("/adjustments", asyncRoute(async (req, res) => {
  const { userId, amount, reason } = req.body;
  const adjustmentId = genId("fs_adj");
  await db().collection("adjustments").doc(adjustmentId).set({
    adjustmentId, userId, amount: Number(amount), reason: reason || "",
    createdBy: req.uid, createdAt: FieldValue.serverTimestamp(),
    createdDate: todayISO(), status: "active",
  });
  res.json({ adjustmentId });
}));

/* "Approve" (spec section 18): admin accepts a disputed item back into the
 * workflow with no content changes. Use PATCH /transactions/:id (Edit and
 * Resend) instead when the item itself needs to change - that always
 * routes back through the user for a fresh confirmation. */
router.post("/transactions/:id/approve-item", requirePermission(PERMISSION.APPROVE_ITEM), asyncRoute(async (req, res) => {
  const ref = db().collection("transactions").doc(req.params.id);
  await db().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw bad("Transaction not found.", 404);
    const current = deriveWorkflowStatus(snap.data());
    const next = assertTransition(current, ROLE.ADMIN, ACTION.APPROVE_ITEM);
    transaction.update(ref, {
      workflowStatus: next,
      version: FieldValue.increment(1),
      itemReviewedAt: FieldValue.delete(),
      itemReviewedBy: FieldValue.delete(),
      itemReviewReason: FieldValue.delete(),
      resolvedBy: req.uid,
      resolvedAt: FieldValue.serverTimestamp(),
    });
    const event = buildTransactionEvent(db(), {
      transactionId: req.params.id,
      eventType: EVENT_TYPE.ITEM_APPROVED_BY_ADMIN,
      fromStatus: current,
      toStatus: next,
      actorUserId: req.uid,
      actorRole: ROLE.ADMIN,
    });
    transaction.set(event.ref, event.data);
  });
  res.json({ ok: true });
}));

/* Covers both spec actions "Edit" (PENDING_USER_CONFIRMATION -> itself) and
 * "Edit and Resend" (ITEM_UNDER_REVIEW -> PENDING_USER_CONFIRMATION) - both
 * land on PENDING_USER_CONFIRMATION, and per product decision an edit to an
 * already-CONFIRMED_UNPAID listing resets it there too, since the user only
 * ever owes what they actually confirmed. Any prior confirmation/review is
 * cleared because the transaction has changed and needs a fresh look. */
router.patch("/transactions/:id", requirePermission(PERMISSION.EDIT_TRANSACTION), asyncRoute(async (req, res) => {
  const { quantity, createdDate } = req.body;
  const qty = Math.floor(Number(quantity));
  if (!Number.isFinite(qty) || qty < 1) throw bad("Quantity must be at least one.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate || "")) throw bad("Choose a valid date.");
  const transactionRef = db().collection("transactions").doc(req.params.id);
  await db().runTransaction(async (transaction) => {
    const transactionSnap = await transaction.get(transactionRef);
    if (!transactionSnap.exists) throw bad("Transaction not found.", 404);
    const record = transactionSnap.data();
    const current = deriveWorkflowStatus(record);
    const editableStatuses = [
      STATUS.PENDING_USER_CONFIRMATION, STATUS.ITEM_UNDER_REVIEW, STATUS.CONFIRMED_UNPAID,
      STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION, STATUS.PAYMENT_UNDER_REVIEW,
    ];
    if (!editableStatuses.includes(current)) {
      throw bad("This transaction can no longer be edited.", 409);
    }
    const action = current === STATUS.ITEM_UNDER_REVIEW ? ACTION.EDIT_AND_RESEND : ACTION.EDIT;
    const next = assertTransition(current, ROLE.ADMIN, action);
    const snackSnap = await transaction.get(db().collection("snacks").doc(record.snackId));
    if (!snackSnap.exists || snackSnap.data().active === false) throw bad("This snack is no longer available in the catalogue.");
    const snack = snackSnap.data();
    const unitPrice = Number(snack.price || 0);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw bad("This catalogue item does not have a valid price.");
    transaction.update(transactionRef, {
      quantity: qty,
      unitPrice,
      total: unitPrice * qty,
      snackName: snack.name || record.snackName,
      calories: snack.calories ?? null,
      createdDate,
      workflowStatus: next,
      version: FieldValue.increment(1),
      userConfirmedAt: FieldValue.delete(),
      userConfirmedBy: FieldValue.delete(),
      itemReviewedAt: FieldValue.delete(),
      itemReviewedBy: FieldValue.delete(),
      itemReviewReason: FieldValue.delete(),
      // Editing content while a payment claim was in flight (pending or
      // under review) invalidates that claim entirely - it referred to the
      // pre-edit quantity/price. Clearing these mirrors what RESET already
      // clears, so the transaction starts its confirmation/payment cycle
      // over with no stale markers left pointing at the old values.
      paymentMarkedAt: FieldValue.delete(),
      paymentMarkedBy: FieldValue.delete(),
      paymentMarkedByRole: FieldValue.delete(),
      paymentConfirmedAt: FieldValue.delete(),
      paymentConfirmedByAdminId: FieldValue.delete(),
      paymentReviewedAt: FieldValue.delete(),
      paymentReviewedByAdminId: FieldValue.delete(),
      paymentReviewReason: FieldValue.delete(),
      paymentClaimRejectedAt: FieldValue.delete(),
      paymentClaimRejectedBy: FieldValue.delete(),
      paymentClaimRejectReason: FieldValue.delete(),
      editedBy: req.uid,
      editedAt: FieldValue.serverTimestamp(),
    });
    const event = buildTransactionEvent(db(), {
      transactionId: req.params.id,
      eventType: EVENT_TYPE.ITEM_EDITED_BY_ADMIN,
      fromStatus: current,
      toStatus: next,
      actorUserId: req.uid,
      actorRole: ROLE.ADMIN,
      payload: { quantity: qty, createdDate, total: unitPrice * qty },
    });
    transaction.set(event.ref, event.data);
  });
  res.json({ ok: true });
}));

router.post("/transactions/:id/merge-or-move", requirePermission(PERMISSION.EDIT_TRANSACTION), asyncRoute(async (req, res) => {
  const sourceId = req.params.id;
  const targetId = String(req.body.targetId || "");
  if (!targetId || sourceId === targetId) throw bad("Choose a different destination listing.");
  const sourceRef = db().collection("transactions").doc(sourceId);
  const targetRef = db().collection("transactions").doc(targetId);
  let result = null;

  await db().runTransaction(async (transaction) => {
    const [sourceSnap, targetSnap] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(targetRef),
    ]);
    if (!sourceSnap.exists || !targetSnap.exists) throw bad("One of these listings no longer exists.", 404);
    const source = sourceSnap.data();
    const target = targetSnap.data();
    if ((source.userId || source.uid) !== (target.userId || target.uid)) {
      throw bad("Listings can only be moved within the same customer tab.");
    }
    if (deriveWorkflowStatus(source) !== STATUS.PENDING_USER_CONFIRMATION || deriveWorkflowStatus(target) !== STATUS.PENDING_USER_CONFIRMATION) {
      throw bad("Only listings still awaiting the customer's confirmation can be moved or combined.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target.createdDate || "")) throw bad("The destination listing needs a valid date.");

    if (source.snackId === target.snackId) {
      const snackRef = db().collection("snacks").doc(source.snackId);
      const snackSnap = await transaction.get(snackRef);
      if (!snackSnap.exists || snackSnap.data().active === false) throw bad("This snack is no longer available in the catalogue.");
      const snack = snackSnap.data();
      const quantity = Math.floor(Number(source.quantity || 1)) + Math.floor(Number(target.quantity || 1));
      const unitPrice = Number(snack.price || 0);
      transaction.update(targetRef, {
        quantity,
        unitPrice,
        total: unitPrice * quantity,
        snackName: snack.name || target.snackName,
        calories: snack.calories ?? null,
        editedBy: req.uid,
        editedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(sourceRef);
      result = { action: "merged", targetId, quantity };
    } else {
      transaction.update(sourceRef, {
        createdDate: target.createdDate,
        editedBy: req.uid,
        editedAt: FieldValue.serverTimestamp(),
      });
      result = { action: "moved", targetId, createdDate: target.createdDate };
    }
  });
  res.json(result);
}));

/* "Cancel" (spec section 6/8) - allowed from any pre-payment status. Also
 * sets the legacy `status: "void"` soft-delete marker so every existing
 * `.where("status", "==", "active")` query keeps excluding it with no
 * changes needed there; CANCELLED is the workflow-level record of *why*. */
router.post("/transactions/:id/cancel", requirePermission(PERMISSION.CANCEL_TRANSACTION), asyncRoute(async (req, res) => {
  const ref = db().collection("transactions").doc(req.params.id);
  const reason = clean(req.body.reason);
  await db().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw bad("Transaction not found.", 404);
    const current = deriveWorkflowStatus(snap.data());
    const next = assertTransition(current, ROLE.ADMIN, ACTION.CANCEL);
    transaction.update(ref, {
      status: "void",
      workflowStatus: next,
      version: FieldValue.increment(1),
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: req.uid,
      cancellationReason: reason,
      voidedBy: req.uid,
      voidedAt: FieldValue.serverTimestamp(),
    });
    const event = buildTransactionEvent(db(), {
      transactionId: req.params.id,
      eventType: EVENT_TYPE.ITEM_CANCELLED,
      fromStatus: current,
      toStatus: next,
      actorUserId: req.uid,
      actorRole: ROLE.ADMIN,
      payload: { reason },
    });
    transaction.set(event.ref, event.data);
  });
  res.json({ ok: true });
}));

router.post("/payments/:id/void", requirePermission(PERMISSION.CANCEL_TRANSACTION), asyncRoute(async (req, res) => {
  await db().collection("payments").doc(req.params.id).update({
    status: "void", voidedBy: req.uid, voidedAt: FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
}));

router.delete("/payments/:id", requirePermission(PERMISSION.DELETE_TRANSACTION), asyncRoute(async (req, res) => {
  await db().collection("payments").doc(req.params.id).delete();
  res.json({ ok: true });
}));

/* Runs the oldest-first settlement plan against every payment on file for
 * this customer, and finalizes whatever it covers. A transaction already
 * CONFIRMED_UNPAID settles via the admin's own Mark as Paid; one already
 * PAYMENT_PENDING_ADMIN_CONFIRMATION (the user reported paying) settles via
 * Confirm Payment instead - either way the destination is PAID_FINALIZED,
 * so the same pass safely covers both without needing to know which path
 * a given payment actually arrived through. */
async function allocateApprovedTransactions(userId, adminUid) {
  const [transactionSnap, paymentSnap] = await Promise.all([
    db().collection("transactions").where("userId", "==", userId).get(),
    db().collection("payments").where("userId", "==", userId).get(),
  ]);
  const transactions = transactionSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => record.status !== "void");
  const payments = paymentSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => record.status !== "void");
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const plan = paymentAllocationPlan(transactions, paidTotal);
  const byId = new Map(transactions.map((record) => [record.id, record]));
  const batch = db().batch();
  const now = FieldValue.serverTimestamp();
  for (const id of plan.settledIds) {
    const current = deriveWorkflowStatus(byId.get(id));
    const action = current === STATUS.CONFIRMED_UNPAID ? ACTION.MARK_AS_PAID : ACTION.CONFIRM_PAYMENT;
    const next = assertTransition(current, ROLE.ADMIN, action);
    batch.update(db().collection("transactions").doc(id), {
      workflowStatus: next,
      version: FieldValue.increment(1),
      finalizedAt: now,
      paymentConfirmedAt: now,
      paymentConfirmedByAdminId: adminUid,
      ...(action === ACTION.MARK_AS_PAID
        ? { paymentMarkedAt: now, paymentMarkedBy: adminUid, paymentMarkedByRole: ROLE.ADMIN }
        : {}),
    });
    const event = buildTransactionEvent(db(), {
      transactionId: id,
      eventType: action === ACTION.MARK_AS_PAID ? EVENT_TYPE.PAYMENT_MARKED_BY_ADMIN : EVENT_TYPE.PAYMENT_CONFIRMED_BY_ADMIN,
      fromStatus: current,
      toStatus: next,
      actorUserId: adminUid,
      actorRole: ROLE.ADMIN,
    });
    batch.set(event.ref, event.data);
  }
  if (plan.settledIds.length) await batch.commit();
  return plan;
}

router.post("/payments/reconcile", asyncRoute(async (req, res) => {
  const paymentSnap = await db().collection("payments").get();
  const userIds = [...new Set(paymentSnap.docs
    .filter((doc) => doc.data().status !== "void")
    .map((doc) => doc.data().userId || doc.data().uid)
    .filter(Boolean))];
  const results = [];
  for (const userId of userIds) {
    const plan = await allocateApprovedTransactions(userId, req.uid);
    if (plan.settledIds.length) results.push({ userId, ...plan });
  }
  res.json({
    checkedUsers: userIds.length,
    reconciledUsers: results.length,
    settledCount: results.reduce((sum, result) => sum + result.settledIds.length, 0),
    results,
  });
}));

router.post("/payments/permanent", requirePermission(PERMISSION.MARK_PAID), asyncRoute(async (req, res) => {
  const { userId, amount, note, createdDate } = req.body;
  const value = Number(amount);
  if (!userId) throw bad("Choose a customer.");
  if (!Number.isFinite(value) || value <= 0) throw bad("Enter a payment greater than zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate || "")) throw bad("Choose a valid payment date.");
  const paymentId = genId("fs_pay");
  await db().collection("payments").doc(paymentId).set({
    paymentId, userId, amount: value, note: (note || "").trim(),
    source: "admin", permanent: true, createdBy: req.uid,
    createdAt: FieldValue.serverTimestamp(), createdDate, status: "active",
  });
  const allocation = await allocateApprovedTransactions(userId, req.uid);
  res.json({ paymentId, ...allocation });
}));

/* Shared body for the four admin-side payment-pipeline actions (mark-paid,
 * confirm-payment, review-payment, reject-payment) - same shape as
 * store.js's applyUserAction, just for the ADMIN role. `extraWrites` lets a
 * caller add more writes to the SAME Firestore transaction (used to create
 * the actual `payments` doc a finalization needs - see the comment on
 * mark-paid/confirm-payment below for why that's required, not optional). */
async function applyAdminAction(req, res, { action, eventType, extraFields = () => ({}), extraWrites = () => {} }) {
  const { id } = req.params;
  const ref = db().collection("transactions").doc(id);
  await db().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw bad("Transaction not found.", 404);
    const record = snap.data();
    const current = deriveWorkflowStatus(record);
    const next = assertTransition(current, ROLE.ADMIN, action);
    transaction.update(ref, {
      workflowStatus: next,
      version: FieldValue.increment(1),
      ...extraFields(next),
    });
    const event = buildTransactionEvent(db(), {
      transactionId: id,
      eventType,
      fromStatus: current,
      toStatus: next,
      actorUserId: req.uid,
      actorRole: ROLE.ADMIN,
    });
    transaction.set(event.ref, event.data);
    extraWrites(transaction, record);
  });
  res.json({ ok: true });
}

/* Finalizing a transaction only means something for the customer's overall
 * balance if a matching `payments` doc exists too - accounting()/balance
 * math nets snackTotal against the separate payments collection, not
 * against which transactions happen to be flagged paid, so confirming or
 * directly marking one paid without also recording its payment would leave
 * it displaying "Paid" while still counting against the customer's balance. */
function settlementPaymentWrite(transaction, record, { userId, uid, source }) {
  const paymentId = genId("fs_pay");
  transaction.set(db().collection("payments").doc(paymentId), {
    paymentId, userId, amount: Number(record.total || 0), note: `Settles ${record.snackName || record.snackId || "a snack purchase"}`,
    source, settlesTransactionId: record.transactionId || null,
    createdBy: uid, createdAt: FieldValue.serverTimestamp(), createdDate: todayISO(), status: "active",
  });
}

// Admin directly records a confirmed-unpaid listing as paid (e.g. cash
// handed over on the spot) - finalizes immediately, no separate customer
// confirmation of the payment is needed since the admin observed it.
router.post("/transactions/:id/mark-paid", requirePermission(PERMISSION.MARK_PAID), asyncRoute(async (req, res) => {
  const now = FieldValue.serverTimestamp();
  await applyAdminAction(req, res, {
    action: ACTION.MARK_AS_PAID,
    eventType: EVENT_TYPE.PAYMENT_MARKED_BY_ADMIN,
    extraFields: () => ({
      paymentMarkedAt: now, paymentMarkedBy: req.uid, paymentMarkedByRole: ROLE.ADMIN,
      paymentConfirmedAt: now, paymentConfirmedByAdminId: req.uid,
      finalizedAt: now,
    }),
    extraWrites: (transaction, record) => settlementPaymentWrite(transaction, record, {
      userId: record.userId || record.uid, uid: req.uid, source: "admin",
    }),
  });
}));

router.post("/transactions/:id/confirm-payment", requirePermission(PERMISSION.CONFIRM_PAYMENT), asyncRoute(async (req, res) => {
  const now = FieldValue.serverTimestamp();
  await applyAdminAction(req, res, {
    action: ACTION.CONFIRM_PAYMENT,
    eventType: EVENT_TYPE.PAYMENT_CONFIRMED_BY_ADMIN,
    extraFields: () => ({ paymentConfirmedAt: now, paymentConfirmedByAdminId: req.uid, finalizedAt: now }),
    extraWrites: (transaction, record) => settlementPaymentWrite(transaction, record, {
      userId: record.userId || record.uid, uid: req.uid, source: "customer-reported",
    }),
  });
}));

router.post("/transactions/:id/review-payment", requirePermission(PERMISSION.REVIEW_PAYMENT), asyncRoute(async (req, res) => {
  const reason = clean(req.body.reason);
  await applyAdminAction(req, res, {
    action: ACTION.REVIEW_PAYMENT,
    eventType: EVENT_TYPE.PAYMENT_REVIEW_REQUESTED_BY_ADMIN,
    extraFields: () => ({
      paymentReviewedAt: FieldValue.serverTimestamp(),
      paymentReviewedByAdminId: req.uid,
      paymentReviewReason: reason,
    }),
  });
}));

router.post("/transactions/:id/reject-payment", requirePermission(PERMISSION.REJECT_PAYMENT_CLAIM), asyncRoute(async (req, res) => {
  const reason = clean(req.body.reason);
  await applyAdminAction(req, res, {
    action: ACTION.REJECT_PAYMENT_CLAIM,
    eventType: EVENT_TYPE.PAYMENT_CLAIM_REJECTED_BY_ADMIN,
    extraFields: () => ({
      paymentReviewedAt: FieldValue.delete(),
      paymentReviewedByAdminId: FieldValue.delete(),
      paymentReviewReason: FieldValue.delete(),
      paymentMarkedAt: FieldValue.delete(),
      paymentMarkedBy: FieldValue.delete(),
      paymentMarkedByRole: FieldValue.delete(),
      paymentClaimRejectedAt: FieldValue.serverTimestamp(),
      paymentClaimRejectedBy: req.uid,
      paymentClaimRejectReason: reason,
    }),
  });
}));

// "Do nothing to the record, just put it back in the user's hands to
// confirm" - reverts to PENDING_USER_CONFIRMATION with no content change,
// clearing every downstream progress marker (confirmation, review,
// payment-report/confirm/reject) since the workflow is starting over.
router.post("/transactions/:id/reset", requirePermission(PERMISSION.RESET_TRANSACTION), asyncRoute(async (req, res) => {
  await applyAdminAction(req, res, {
    action: ACTION.RESET,
    eventType: EVENT_TYPE.TRANSACTION_RESET_BY_ADMIN,
    extraFields: () => ({
      userConfirmedAt: FieldValue.delete(),
      userConfirmedBy: FieldValue.delete(),
      itemReviewedAt: FieldValue.delete(),
      itemReviewedBy: FieldValue.delete(),
      itemReviewReason: FieldValue.delete(),
      paymentMarkedAt: FieldValue.delete(),
      paymentMarkedBy: FieldValue.delete(),
      paymentMarkedByRole: FieldValue.delete(),
      paymentConfirmedAt: FieldValue.delete(),
      paymentConfirmedByAdminId: FieldValue.delete(),
      paymentReviewedAt: FieldValue.delete(),
      paymentReviewedByAdminId: FieldValue.delete(),
      paymentReviewReason: FieldValue.delete(),
      paymentClaimRejectedAt: FieldValue.delete(),
      paymentClaimRejectedBy: FieldValue.delete(),
      paymentClaimRejectReason: FieldValue.delete(),
      resetBy: req.uid,
      resetAt: FieldValue.serverTimestamp(),
    }),
  });
}));

router.delete("/transactions/:id", requirePermission(PERMISSION.DELETE_TRANSACTION), asyncRoute(async (req, res) => {
  await db().collection("transactions").doc(req.params.id).delete();
  res.json({ ok: true });
}));

router.delete("/users/:userId/data", asyncRoute(async (req, res) => {
  const { userId } = req.params;
  const batch = db().batch();
  let count = 0;
  for (const [col, field] of [["transactions", "uid"], ["payments", "userId"], ["adjustments", "userId"], ["devices", "uid"], ["codes", "userId"]]) {
    const snap = await db().collection(col).where(field, "==", userId).get();
    for (const doc of snap.docs) { batch.delete(doc.ref); count++; }
  }
  batch.delete(db().collection("users").doc(userId));
  await batch.commit();
  res.json({ count });
}));

router.get("/users/:userId/transaction-history", asyncRoute(async (req, res) => {
  const snap = await db().collection("transactions").where("uid", "==", req.params.userId).get();
  const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).map((t) => {
    const workflowStatus = deriveWorkflowStatus(t);
    return {
      ...t,
      workflowStatus,
      createdByRole: deriveCreatedByRole(t),
      availableActions: resolveAvailableActions(workflowStatus, ROLE.ADMIN),
    };
  });
  // Same voided/active split as GET /snapshot, and same reason - see its
  // comment. `transactions` stays active-only so every existing balance/
  // table calculation that already reads it is unaffected; voided ones are
  // reachable in their own list for the highest-elevation admin to review
  // or, if they choose to, permanently delete.
  res.json({
    transactions: all.filter((t) => t.status !== "void"),
    voidedTransactions: all.filter((t) => t.status === "void"),
  });
}));

router.get("/users/:userId/adjustments", asyncRoute(async (req, res) => {
  const snap = await db().collection("adjustments").where("userId", "==", req.params.userId).get();
  res.json(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((a) => a.status !== "void"));
}));

router.post("/inventory-ledger", asyncRoute(async (req, res) => {
  const { snackId, quantity, note } = req.body;
  const qty = Number(quantity);
  if (!snackId) throw bad("Choose a snack.");
  if (!qty || qty <= 0) throw bad("Enter a quantity greater than zero.");
  const id = genId("fs_inv");
  await db().collection("inventory").doc(id).set({
    entryId: id, snackId, quantity: qty, note: (note || "").trim(),
    createdBy: req.uid, createdAt: FieldValue.serverTimestamp(),
  });
  res.json({ id });
}));

router.get("/inventory-snapshot", asyncRoute(async (req, res) => {
  const [settingsSnap, snacksSnap, entries, transactions] = await Promise.all([
    db().collection("settings").doc("app").get(),
    db().collection("snacks").get(),
    getCollection("inventory"),
    getCollection("transactions"),
  ]);
  const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
  const snacks = snacksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const activeTxns = transactions.filter((t) => t.status !== "void");
  const bySnack = new Map(snacks.map((s) => [s.id, { snack: s, stocked: 0, sold: 0, revenue: 0 }]));
  for (const e of entries) {
    const row = bySnack.get(e.snackId);
    if (row) row.stocked += Number(e.quantity || 0);
  }
  for (const t of activeTxns) {
    const row = t.snackId && bySnack.get(t.snackId);
    if (row) { row.sold += Number(t.quantity || 0); row.revenue += Number(t.total || 0); }
  }
  const rows = [...bySnack.values()].map((r) => ({ ...r, remaining: r.stocked - r.sold }));
  const totals = rows.reduce((acc, r) => ({
    stocked: acc.stocked + r.stocked, sold: acc.sold + r.sold,
    remaining: acc.remaining + r.remaining, revenue: acc.revenue + r.revenue,
  }), { stocked: 0, sold: 0, remaining: 0, revenue: 0 });
  res.json({
    settings: settingsData, rows, totals,
    entries: entries.sort((a, b) => dateFromRecord(b, "createdAt").localeCompare(dateFromRecord(a, "createdAt"))),
  });
}));

router.put("/snacks/:id", asyncRoute(async (req, res) => {
  const snack = { ...req.body, id: req.params.id || req.body.id };
  const id = snack.id || String(snack.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (!id) throw bad("Snack name is required.");
  const payload = {
    id,
    name: snack.name,
    price: Number(snack.price || 0),
    calories: snack.calories === "" || snack.calories == null ? null : Number(snack.calories),
    style: snack.style || "green",
    factsId: snack.factsId || null,
    photo: snack.photo || null,
    active: snack.active !== false,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (Object.prototype.hasOwnProperty.call(snack, "favoritePhoto")) {
    payload.favoritePhoto = snack.favoritePhoto || null;
  }
  if (Object.prototype.hasOwnProperty.call(snack, "stock")) {
    payload.stock = snack.stock === "" || snack.stock == null ? null : Math.max(0, Math.floor(Number(snack.stock)));
  }
  await db().collection("snacks").doc(id).set(payload, { merge: true });
  res.json({ id });
}));

router.post("/snacks/order", asyncRoute(async (req, res) => {
  const ids = [...new Set((req.body.snackIds || []).filter(Boolean))];
  if (!ids.length) throw bad("No snacks were provided for ordering.");
  const batch = db().batch();
  ids.forEach((id, displayOrder) => {
    batch.set(db().collection("snacks").doc(id), {
      displayOrder, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  await batch.commit();
  res.json({ ok: true });
}));

/* Permanent delete - Active/Inactive on the same card is now the only
 * status control (a separate Deactivate action was redundant with it), so
 * this is the one remaining destructive action and needs to actually clean
 * up after itself: the uploaded Storage images (same object-delete pattern
 * as the image-replace path above) and this snack's entries in any
 * inventory basket's `items` array. Historical transactions/payments are
 * deliberately left untouched - they already snapshot snackName/price at
 * the time of purchase and don't depend on the live snack doc existing. */
router.delete("/snacks/:id", asyncRoute(async (req, res) => {
  const id = req.params.id;
  const ref = db().collection("snacks").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw bad("Snack not found.", 404);
  const snack = snap.data();

  const bucket = admin.storage().bucket();
  const storagePaths = [snack.photoStoragePath, snack.favoritePhotoStoragePath].filter(Boolean);
  await Promise.all(storagePaths.map((path) =>
    bucket.file(path).delete().catch((error) => {
      if (error.code !== 404) console.warn("Snack image cleanup failed", error);
    })
  ));

  const inventorySnap = await db().collection("inventory").get();
  const batch = db().batch();
  let binsUpdated = 0;
  inventorySnap.docs.forEach((doc) => {
    const items = doc.data().items || [];
    if (!items.some((item) => item.snackId === id)) return;
    batch.update(doc.ref, { items: items.filter((item) => item.snackId !== id) });
    binsUpdated++;
  });
  batch.delete(ref);
  await batch.commit();

  res.json({ ok: true, binsUpdated });
}));

router.post("/snacks/sync-bundled-artwork", asyncRoute(async (req, res) => {
  const { bundledSnackArtwork } = require("../lib/shared");
  const entries = Object.entries(bundledSnackArtwork || {});
  const snapshots = await Promise.all(entries.map(([id]) => db().collection("snacks").doc(id).get()));
  const batch = db().batch();
  let changed = 0;
  entries.forEach(([id, artwork], index) => {
    const snap = snapshots[index];
    if (!snap.exists) return;
    const current = snap.data();
    const missing = {};
    if (!current.photo) missing.photo = artwork.photo;
    if (!current.favoritePhoto) missing.favoritePhoto = artwork.favoritePhoto;
    if (!Object.keys(missing).length) return;
    batch.set(snap.ref, { ...missing, artworkUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
    changed++;
  });
  if (changed) await batch.commit();
  res.json({ changed });
}));

/* Image upload: the client already downscales/re-encodes to WebP
 * (FS.admin.prepareImageForUpload stays client-side - it's pure canvas
 * work, no network) and posts the result here as base64 JSON rather than
 * uploading straight to Storage itself, so this goes through the API too. */
router.post("/snacks/:id/image", asyncRoute(async (req, res) => {
  const snackId = req.params.id;
  const { kind = "photo", contentType, base64, filename } = req.body;
  if (!snackId) throw bad("Choose a snack first.");
  if (!base64) throw bad("Choose an image to upload.");
  if (!String(contentType || "").startsWith("image/")) throw bad("Only image files can be uploaded.");
  if (!["photo", "favoritePhoto"].includes(kind)) throw bad("Unknown artwork type.");
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > 10 * 1024 * 1024) throw bad("Images must be 10 MB or smaller.");

  const docRef = db().collection("snacks").doc(snackId);
  const currentSnap = await docRef.get();
  if (!currentSnap.exists) throw bad("Snack record not found.", 404);
  const current = currentSnap.data();
  const pathField = kind === "photo" ? "photoStoragePath" : "favoritePhotoStoragePath";
  const extension = (contentType.split("/")[1] || "jpg").toLowerCase();
  const safeName = String(filename || "image")
    .toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
  const objectPath = `snacks/${snackId}/${kind}-${Date.now()}-${safeName}.${extension}`;
  const bucket = admin.storage().bucket();
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    contentType,
    metadata: { cacheControl: "public,max-age=31536000,immutable", metadata: { snackId, artworkKind: kind } },
  });
  await file.makePublic();
  const url = `https://storage.googleapis.com/${bucket.name}/${objectPath}`;
  await docRef.set({
    [kind]: url,
    [pathField]: objectPath,
    artworkUpdatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const previousPath = current[pathField];
  if (previousPath && previousPath !== objectPath && previousPath.startsWith(`snacks/${snackId}/`)) {
    await bucket.file(previousPath).delete().catch((error) => {
      if (error.code !== 404) console.warn("Old snack image cleanup failed", error);
    });
  }
  res.json({ url, objectPath });
}));

async function ensureStandardBins(snacks, uid) {
  const setupRef = db().collection("inventory").doc("bin-location-setup");
  const setup = await setupRef.get();
  if (setup.exists) return false;
  const definitions = [
    ["bin-9th-floor-1", "9th Floor", "Basket 1", "standard"],
    ["bin-9th-floor-2", "9th Floor", "Basket 2", "standard"],
    ["bin-6th-floor-desk", "6th Floor", "Desk", "standard"],
    ["bin-6th-floor-hr-1", "6th Floor", "HR 1", "standard"],
    ["bin-6th-floor-hr-2", "6th Floor", "HR 2", "standard"],
    ["bin-6th-floor-kitchen", "6th Floor", "Kitchen", "hundred"],
    ["bin-6th-floor-hall", "6th Floor", "Hall", "large"],
    ["bin-5th-floor-nanda-1", "5th Floor", "Nanda 1", "standard"],
    ["bin-5th-floor-nanda-2", "5th Floor", "Nanda 2", "standard"],
  ];
  const batch = db().batch();
  const now = FieldValue.serverTimestamp();
  definitions.forEach(([id, floor, name, templateId], displayOrder) => {
    batch.set(db().collection("inventory").doc(id), {
      id, recordType: "bin", floor, name, templateId,
      items: templateBinItems(templateId, snacks),
      displayOrder, active: true, createdBy: uid, createdAt: now, updatedAt: now,
    });
  });
  batch.set(setupRef, { recordType: "binSetup", version: 1, createdBy: uid, createdAt: now });
  await batch.commit();
  return true;
}

router.get("/bins-snapshot", asyncRoute(async (req, res) => {
  const [settingsSnap, snacksSnap] = await Promise.all([
    db().collection("settings").doc("app").get(),
    db().collection("snacks").get(),
  ]);
  const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
  const snacks = snacksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (req.query.source !== "cache") await ensureStandardBins(snacks, req.uid);
  const records = (await getCollection("inventory")).filter((r) => r.recordType === "bin");
  const bySnack = new Map(snacks.map((snack) => [snack.id, snack]));
  const bins = records.map((bin) => {
    const items = (bin.items || []).map((item) => ({
      snackId: item.snackId, quantity: Math.max(0, Number(item.quantity || 0)),
    })).filter((item) => item.snackId && item.quantity > 0);
    const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalValue = items.reduce((sum, item) => sum + item.quantity * Number(bySnack.get(item.snackId)?.price || 0), 0);
    return { ...bin, items, totalUnits, totalValue };
  }).sort((a, b) =>
    Number(a.displayOrder ?? 999) - Number(b.displayOrder ?? 999)
    || String(a.floor || "").localeCompare(String(b.floor || ""))
    || String(a.name || "").localeCompare(String(b.name || "")));
  res.json({ settings: settingsData, snacks, bins });
}));

router.put("/bins/:id?", asyncRoute(async (req, res) => {
  const bin = req.body;
  const floor = String(bin.floor || "").trim();
  const name = String(bin.name || "").trim();
  if (!floor || !name) throw bad("Floor and location name are required.");
  const id = req.params.id || bin.id || genId("bin");
  const items = (bin.items || []).map((item) => ({
    snackId: String(item.snackId || ""),
    quantity: Math.max(0, Math.floor(Number(item.quantity || 0))),
  })).filter((item) => item.snackId && item.quantity > 0);
  await db().collection("inventory").doc(id).set({
    id, recordType: "bin", floor, name,
    templateId: binTemplates[bin.templateId] ? bin.templateId : "custom",
    templateSourceId: bin.templateSourceId || null,
    items,
    active: bin.active !== false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: req.uid,
    ...(req.params.id ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: req.uid }),
  }, { merge: true });
  res.json({ id });
}));

router.delete("/bins/:id", asyncRoute(async (req, res) => {
  await db().collection("inventory").doc(req.params.id).delete();
  res.json({ ok: true });
}));

router.post("/bin-floors/rename", asyncRoute(async (req, res) => {
  const from = String(req.body.currentFloor || "").trim();
  const to = String(req.body.nextFloor || "").trim();
  if (!from || !to) throw bad("Both floor names are required.");
  const records = (await getCollection("inventory")).filter((r) => r.recordType === "bin" && r.floor === from);
  if (!records.length) throw bad("No baskets were found on that floor.");
  const batch = db().batch();
  records.forEach((record) => batch.set(db().collection("inventory").doc(record.id), {
    floor: to, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.uid,
  }, { merge: true }));
  await batch.commit();
  res.json({ count: records.length });
}));

router.post("/bin-floors/duplicate", asyncRoute(async (req, res) => {
  const from = String(req.body.sourceFloor || "").trim();
  const to = String(req.body.targetFloor || "").trim();
  if (!from || !to) throw bad("Source and new floor names are required.");
  const allBins = (await getCollection("inventory")).filter((r) => r.recordType === "bin");
  const source = allBins.filter((r) => r.floor === from);
  if (!source.length) throw bad("No baskets were found on that floor.");
  if (allBins.some((r) => r.floor.toLowerCase() === to.toLowerCase())) throw bad("A floor with that name already exists.");
  const nextOrder = Math.max(-1, ...allBins.map((r) => Number(r.displayOrder ?? -1))) + 1;
  const batch = db().batch();
  const now = FieldValue.serverTimestamp();
  source.forEach((record, index) => {
    const id = genId("bin");
    batch.set(db().collection("inventory").doc(id), {
      id, recordType: "bin", floor: to, name: record.name,
      templateId: record.templateId || "custom",
      templateSourceId: record.templateSourceId || null,
      items: (record.items || []).map((item) => ({
        snackId: item.snackId, quantity: Math.max(0, Number(item.quantity || 0)),
      })),
      displayOrder: nextOrder + index,
      active: record.active !== false,
      duplicatedFromFloor: from,
      createdAt: now, updatedAt: now, createdBy: req.uid, updatedBy: req.uid,
    });
  });
  await batch.commit();
  res.json({ count: source.length });
}));

router.post("/bin-floors/delete", asyncRoute(async (req, res) => {
  const floor = String(req.body.floorName || "").trim();
  if (!floor) throw bad("Choose a floor to delete.");
  const records = (await getCollection("inventory")).filter((r) => r.recordType === "bin" && r.floor === floor);
  if (!records.length) throw bad("No baskets were found on that floor.");
  const batch = db().batch();
  records.forEach((record) => batch.delete(db().collection("inventory").doc(record.id)));
  await batch.commit();
  res.json({ count: records.length });
}));

router.post("/bins/order", asyncRoute(async (req, res) => {
  const ids = [...new Set((req.body.binIds || []).filter(Boolean))];
  if (!ids.length) throw bad("No baskets were provided for ordering.");
  const batch = db().batch();
  ids.forEach((id, displayOrder) => batch.set(db().collection("inventory").doc(id), {
    displayOrder, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.uid,
  }, { merge: true }));
  await batch.commit();
  res.json({ ok: true });
}));

router.post("/bins/:id/duplicate", asyncRoute(async (req, res) => {
  const sourceId = req.params.id;
  const { targetFloor, targetName } = req.body;
  const sourceSnap = await db().collection("inventory").doc(sourceId).get();
  if (!sourceSnap.exists || sourceSnap.data().recordType !== "bin") throw bad("Source basket not found.", 404);
  const source = sourceSnap.data();
  const floor = String(targetFloor || source.floor || "").trim();
  const name = String(targetName || `${source.name || "Basket"} Copy`).trim();
  if (!floor || !name) throw bad("Floor and basket name are required.");
  const id = genId("bin");
  const now = FieldValue.serverTimestamp();
  await db().collection("inventory").doc(id).set({
    id, recordType: "bin", floor, name, templateId: "custom", templateSourceId: sourceId,
    items: (source.items || []).map((item) => ({
      snackId: item.snackId, quantity: Math.max(0, Number(item.quantity || 0)),
    })),
    active: source.active !== false,
    duplicatedFromBin: sourceId,
    createdAt: now, updatedAt: now, createdBy: req.uid, updatedBy: req.uid,
  });
  res.json({ id });
}));

router.patch("/users/:userId", asyncRoute(async (req, res) => {
  const { displayName, vipStatus } = req.body;
  await db().collection("users").doc(req.params.userId).set({
    displayName, vipStatus, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  res.json({ ok: true });
}));

router.get("/users/:userId", asyncRoute(async (req, res) => {
  const snap = await db().collection("users").doc(req.params.userId).get();
  if (!snap.exists) throw bad("That tab no longer exists.", 404);
  res.json({ id: snap.id, ...snap.data() });
}));

router.post("/users", asyncRoute(async (req, res) => {
  const userId = genId("cust");
  const name = (req.body.displayName || "").trim();
  const finalName = name || `Guest ${randomCode(4)}`;
  await db().collection("users").doc(userId).set({
    userId, uid: userId, displayName: finalName,
    vipStatus: name ? "named" : "anonymous",
    linkedUids: [],
    createdByAdmin: req.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  res.json({ userId });
}));

router.post("/users/:userId/transactions", asyncRoute(async (req, res) => {
  const { userId } = req.params;
  const items = req.body.items || [];
  const splitQuantities = req.body.splitQuantities === true;
  const requested = items.map((item) => {
    const raw = item.snack || item;
    return { snackId: raw?.id, quantity: Math.floor(Number(item.qty || item.quantity || 1)) };
  }).filter((item) => item.snackId && item.quantity > 0);
  const totalUnits = requested.reduce((sum, item) => sum + item.quantity, 0);
  if (!requested.length) throw bad("Choose at least one snack.");
  if (splitQuantities && totalUnits > 200) throw bad("Split orders are limited to 200 individual listings at a time.");
  const snackEntries = await Promise.all([...new Set(requested.map((item) => item.snackId))].map(async (snackId) => {
    const snap = await db().collection("snacks").doc(snackId).get();
    return [snackId, snap.exists ? snap.data() : null];
  }));
  const catalogue = new Map(snackEntries);
  const batch = db().batch();
  const today = todayISO();
  const now = FieldValue.serverTimestamp();
  const saved = [];
  for (const item of requested) {
    const snack = catalogue.get(item.snackId);
    if (!snack || snack.active === false) throw bad("Every order item must be an active catalogue snack.");
    const unitPrice = Number(snack.price || 0);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw bad(`${snack.name || item.snackId} does not have a valid catalogue price.`);
    const quantities = splitQuantities ? Array(item.quantity).fill(1) : [item.quantity];
    for (const quantity of quantities) {
      const transactionId = genId("fs_txn");
      const record = {
        transactionId, uid: userId, userId,
        deviceId: "admin", visitorId: null,
        snackId: item.snackId, snackName: snack.name, quantity,
        unitPrice,
        total: unitPrice * quantity,
        calories: snack.calories ?? null,
        source: "admin", createdAt: now, createdDate: today, status: "active",
        createdByRole: ROLE.ADMIN,
        workflowStatus: STATUS.PENDING_USER_CONFIRMATION,
        version: 1,
      };
      batch.set(db().collection("transactions").doc(transactionId), record);
      const event = buildTransactionEvent(db(), {
        transactionId,
        eventType: EVENT_TYPE.TRANSACTION_CREATED_BY_ADMIN,
        fromStatus: null,
        toStatus: STATUS.PENDING_USER_CONFIRMATION,
        actorUserId: req.uid,
        actorRole: ROLE.ADMIN,
        payload: { snackId: item.snackId, quantity, total: record.total },
      });
      batch.set(event.ref, event.data);
      saved.push(record);
    }
  }
  await batch.commit();
  res.json(saved);
}));

module.exports = router;
