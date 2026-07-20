/* Fresh Snacks Firebase admin helpers. */

FS.admin = {
  user: null,
  profile: null,
};

FS.admin.signInWithGoogle = async () => {
  await FS.initFirebase();
  const provider = new firebase.auth.GoogleAuthProvider();
  const result = await FS._auth.signInWithPopup(provider);
  FS.admin.user = result.user;
  return FS.admin.requireAdmin();
};

FS.admin.signInWithMicrosoft = async () => {
  await FS.initFirebase();
  const provider = new firebase.auth.OAuthProvider("microsoft.com");
  // "common" allows both personal Microsoft accounts and org (Entra) accounts
  provider.setCustomParameters({ tenant: "common" });
  const result = await FS._auth.signInWithPopup(provider);
  FS.admin.user = result.user;
  return FS.admin.requireAdmin();
};

FS.admin.signInWithEmail = async (email, password) => {
  await FS.initFirebase();
  const result = await FS._auth.signInWithEmailAndPassword(email, password);
  FS.admin.user = result.user;
  return FS.admin.requireAdmin();
};

FS.admin.signOut = async () => {
  await FS.initFirebase();
  await FS._auth.signOut();
  FS.admin.user = null;
  FS.admin.profile = null;
};

FS.admin.requireAdmin = async () => {
  await FS.initFirebase();
  const user = FS._auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("Admin login required.");
  const snap = await FS._db.collection("admins").doc(user.uid).get();
  if (!snap.exists || snap.data().active !== true) {
    await FS._auth.signOut();
    throw new Error("This Firebase user is not active in /admins.");
  }
  FS.admin.user = user;
  FS.admin.profile = { uid: user.uid, ...snap.data() };
  return FS.admin.profile;
};

// Firebase Auth restores a persisted session asynchronously — right after
// initFirebase() resolves, currentUser can still be null even when a real
// session exists, because the SDK's own IndexedDB read hasn't finished.
// Waiting for the first onAuthStateChanged firing (once, cached) avoids
// bouncing a still-logged-in admin back to the login screen on a fresh
// page load, e.g. navigating between admin.html/accounting.html/transactions.html.
FS.admin._authRestored = null;
FS.admin._waitForAuthRestore = () => {
  if (!FS.admin._authRestored) {
    FS.admin._authRestored = new Promise((resolve) => {
      const unsub = FS._auth.onAuthStateChanged(() => { unsub(); resolve(); });
    });
  }
  return FS.admin._authRestored;
};

FS.admin.currentAdmin = async () => {
  await FS.initFirebase();
  await FS.admin._waitForAuthRestore();
  const user = FS._auth.currentUser;
  if (user && !user.isAnonymous) return FS.admin.requireAdmin();
  return null;
};

FS.admin.getCollection = async (name, options = {}) => {
  const snap = await FS._db.collection(name).get(options);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

FS.admin.getSnapshot = async () => {
  await FS.admin.requireAdmin();
  const [settings, snacks, users, devices, transactions, payments, adjustments, feedback] = await Promise.all([
    FS.getSettings(),
    FS.getCatalog(true),
    FS.admin.getCollection("users"),
    FS.admin.getCollection("devices"),
    FS.admin.getCollection("transactions"),
    FS.admin.getCollection("payments"),
    FS.admin.getCollection("adjustments"),
    FS.admin.getCollection("feedback"),
  ]);
  const activeTransactions = transactions.filter((x) => x.status !== "void");
  const balanceTransactions = activeTransactions.filter((x) => x.userStatus !== "disputed");
  const activePayments = payments.filter((x) => x.status !== "void");
  const activeAdjustments = adjustments.filter((x) => x.status !== "void");
  return {
    settings,
    snacks,
    users,
    devices,
    transactions: activeTransactions,
    payments: activePayments,
    adjustments: activeAdjustments,
    feedback: feedback.sort((a, b) => FS.admin.dateFromRecord(b, "createdAt").localeCompare(FS.admin.dateFromRecord(a, "createdAt"))),
    accounting: FS.admin.accounting(users, devices, balanceTransactions, activePayments, activeAdjustments),
  };
};

FS.admin.setFeedbackStatus = async (id, status) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("feedback").doc(id).update({
    status,
    updatedBy: FS.admin.user.uid,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

FS.admin.accountKey = (record) => record.userId || record.uid || record.deviceId || "unassigned";

FS.admin.accounting = (users, devices, transactions, payments, adjustments) => {
  const rows = new Map();
  const ensure = (id) => {
    if (!rows.has(id)) {
      rows.set(id, {
        userId: id,
        displayName: id,
        vipStatus: "anonymous",
        deviceCount: 0,
        snackTotal: 0,
        datedSnackTotal: 0,
        paidTotal: 0,
        adjustmentTotal: 0,
        balance: 0,
        lastActivity: "",
        linkedUids: [],
        snackActivityDates: [],
      });
    }
    return rows.get(id);
  };
  for (const user of users) {
    const row = ensure(user.userId || user.uid || user.id);
    row.displayName = user.displayName || row.displayName;
    row.vipStatus = user.vipStatus || row.vipStatus;
    row.email = user.email || "";
    row.linkedUids = user.linkedUids || [];
    row.createdByAdmin = user.createdByAdmin || null;
  }
  for (const device of devices) {
    const row = ensure(device.userId || device.uid || device.deviceId || device.id);
    row.deviceCount += 1;
    if (!row.displayName || row.displayName === row.userId) row.displayName = device.deviceLabel || device.deviceId || row.userId;
    row.lastActivity = FS.admin.maxDate(row.lastActivity, FS.admin.dateFromRecord(device, "lastSeenAt"));
  }
  for (const t of transactions) {
    const row = ensure(FS.admin.accountKey(t));
    row.snackTotal += Number(t.total || t.value || 0);
    const activityDate = t.createdDate || FS.admin.dateFromRecord(t, "createdAt");
    if (activityDate) {
      row.datedSnackTotal += Number(t.total || t.value || 0);
      if (!row.snackActivityDates.includes(activityDate)) row.snackActivityDates.push(activityDate);
    }
    row.lastActivity = FS.admin.maxDate(row.lastActivity, activityDate);
  }
  for (const p of payments) {
    const row = ensure(FS.admin.accountKey(p));
    row.paidTotal += Number(p.amount || 0);
    row.lastActivity = FS.admin.maxDate(row.lastActivity, p.createdDate || FS.admin.dateFromRecord(p, "createdAt"));
  }
  for (const a of adjustments) {
    const row = ensure(FS.admin.accountKey(a));
    row.adjustmentTotal += Number(a.amount || 0);
    row.lastActivity = FS.admin.maxDate(row.lastActivity, a.createdDate || FS.admin.dateFromRecord(a, "createdAt"));
  }
  return [...rows.values()].map((row) => ({
    ...row,
    balance: row.snackTotal + row.adjustmentTotal - row.paidTotal,
    activityDays: row.snackActivityDates.length,
    averagePurchasePerDay: row.snackActivityDates.length ? Math.round(row.datedSnackTotal / row.snackActivityDates.length) : 0,
  })).filter((row) =>
    row.snackTotal !== 0 ||
    row.paidTotal !== 0 ||
    row.adjustmentTotal !== 0 ||
    row.vipStatus !== "anonymous" ||
    !!row.createdByAdmin
  ).sort((a, b) => b.balance - a.balance || String(a.displayName).localeCompare(String(b.displayName)));
};

FS.admin.dateFromRecord = (record, field) => {
  const value = record[field];
  if (value && typeof value.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  return "";
};

FS.admin.maxDate = (a, b) => String(a || "") > String(b || "") ? a : b;

/* Reusable device-linking invite for a customer: fetching/creating is
 * idempotent (repeat clicks return the same code) so admin can safely
 * re-open the "Invite link" panel any time. Up to 3 devices can join via
 * this one code, enforced by firestore.rules. */
FS.admin.createLinkInvite = async (userId) => {
  await FS.admin.requireAdmin();
  const userRef = FS._db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  const existing = userSnap.exists ? userSnap.data().linkInviteCode : null;
  if (existing) {
    const codeSnap = await FS._db.collection("codes").doc(existing).get();
    if (codeSnap.exists && codeSnap.data().active !== false) return existing;
  }
  let code;
  for (let i = 0; i < 6; i++) {
    const candidate = FS.randomCode(8);
    const clash = await FS._db.collection("codes").doc(candidate).get();
    if (!clash.exists) { code = candidate; break; }
  }
  if (!code) throw new Error("Could not generate a unique invite code, try again.");
  await FS._db.collection("codes").doc(code).set({
    code,
    userId,
    type: "link",
    active: true,
    createdBy: FS.admin.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await userRef.set({ linkInviteCode: code }, { merge: true });
  return code;
};

/* Linked devices for a profile, with a friendly label/last-seen pulled from
 * each device's own devices/{deviceId} doc (devices are keyed by deviceId,
 * not uid, so this needs a small lookup per linked uid — capped at 3). */
FS.admin.getLinkedDevicesInfo = async (userId) => {
  await FS.admin.requireAdmin();
  const userSnap = await FS._db.collection("users").doc(userId).get();
  const linkedUids = userSnap.exists ? (userSnap.data().linkedUids || []) : [];
  const info = await Promise.all(linkedUids.map(async (uid) => {
    const snap = await FS._db.collection("devices").where("uid", "==", uid).limit(1).get();
    const device = snap.empty ? null : snap.docs[0].data();
    return {
      uid,
      deviceLabel: device?.deviceLabel || "Unknown device",
      lastSeenDate: device ? FS.admin.dateFromRecord(device, "lastSeenAt") : "",
    };
  }));
  return info;
};

/* Admin-side unlink: removes one device's uid from a profile's linkedUids.
 * Useful for handing a profile off cleanly (e.g. removing the admin's own
 * test device before sharing the invite with the real customer). */
FS.admin.unlinkUserDevice = async (userId, deviceUid) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("users").doc(userId).update({
    linkedUids: firebase.firestore.FieldValue.arrayRemove(deviceUid),
  });
};

FS.admin.addPayment = async ({ userId, amount, note }) => {
  await FS.admin.requireAdmin();
  const paymentId = FS.uid("fs_pay");
  await FS._db.collection("payments").doc(paymentId).set({
    paymentId,
    userId,
    amount: Number(amount),
    note: note || "",
    source: "admin",
    createdBy: FS.admin.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdDate: FS.todayISO(),
    status: "active",
  });
};

FS.admin.addAdjustment = async ({ userId, amount, reason }) => {
  await FS.admin.requireAdmin();
  const adjustmentId = FS.uid("fs_adj");
  await FS._db.collection("adjustments").doc(adjustmentId).set({
    adjustmentId,
    userId,
    amount: Number(amount),
    reason: reason || "",
    createdBy: FS.admin.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdDate: FS.todayISO(),
    status: "active",
  });
};

/* Dispute handling: approve keeps the listing and clears the customer's
 * flag; change edits it; void removes it from the tab and totals. */
FS.admin.resolveTransaction = async (id) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("transactions").doc(id).update({
    userStatus: firebase.firestore.FieldValue.delete(),
    userStatusAt: firebase.firestore.FieldValue.delete(),
    resolvedBy: FS.admin.user.uid,
    resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

FS.admin.updateTransaction = async (id, { quantity, total, createdDate }) => {
  await FS.admin.requireAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate || "")) throw new Error("Choose a valid date.");
  await FS._db.collection("transactions").doc(id).update({
    quantity: Number(quantity),
    total: Number(total),
    createdDate,
    userStatus: firebase.firestore.FieldValue.delete(),
    userStatusAt: firebase.firestore.FieldValue.delete(),
    editedBy: FS.admin.user.uid,
    editedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

FS.admin.voidTransaction = async (id) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("transactions").doc(id).update({
    status: "void",
    voidedBy: FS.admin.user.uid,
    voidedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

FS.admin.voidPayment = async (id) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("payments").doc(id).update({
    status: "void",
    voidedBy: FS.admin.user.uid,
    voidedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

FS.admin.deletePayment = async (id) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("payments").doc(id).delete();
};

FS.admin.paymentAllocationPlan = (transactions, paidTotal) => {
  const alreadySettled = transactions
    .filter((record) => record.reviewStatus === "paid")
    .reduce((sum, record) => sum + Number(record.total || record.value || 0), 0);
  let available = Math.max(0, paidTotal - alreadySettled);
  // Eligible for settlement means "not already paid" - this deliberately
  // includes neutral (not-yet-reviewed) admin-sourced purchases, not just
  // ones an admin explicitly approved first. If a recorded payment already
  // covers a purchase, that money is itself the confirmation - there's no
  // separate approval step left to wait on. Void/disputed purchases are
  // already filtered out by the caller before this ever sees them.
  const eligible = transactions
    .filter((record) => record.reviewStatus !== "paid")
    .sort((a, b) => String(a.createdDate || "").localeCompare(String(b.createdDate || ""))
      || String(a.id).localeCompare(String(b.id)));
  const settledIds = [];
  for (const record of eligible) {
    const value = Number(record.total || record.value || 0);
    if (value <= 0) continue;
    if (available < value) break;
    available -= value;
    settledIds.push(record.id);
  }
  return { settledIds, credit: available, paidTotal };
};

FS.admin.allocateApprovedTransactions = async (userId) => {
  await FS.admin.requireAdmin();
  const [transactionSnap, paymentSnap] = await Promise.all([
    FS._db.collection("transactions").where("userId", "==", userId).get(),
    FS._db.collection("payments").where("userId", "==", userId).get(),
  ]);
  const transactions = transactionSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => record.status !== "void" && record.userStatus !== "disputed");
  const payments = paymentSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => record.status !== "void");
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const plan = FS.admin.paymentAllocationPlan(transactions, paidTotal);
  const byId = new Map(transactions.map((record) => [record.id, record]));
  const batch = FS._db.batch();
  const now = firebase.firestore.FieldValue.serverTimestamp();
  for (const id of plan.settledIds) {
    const record = byId.get(id);
    const payload = {
      reviewStatus: "paid",
      paidAt: now,
      paidBy: FS.admin.user.uid,
    };
    // A neutral purchase settled straight from an existing/incoming payment
    // never went through an explicit Approve click - stamp the approval
    // fields too so the audit trail still shows it was reviewed.
    if (record && !record.reviewStatus) {
      payload.approvedAt = now;
      payload.approvedBy = FS.admin.user.uid;
    }
    batch.update(FS._db.collection("transactions").doc(id), payload);
  }
  if (plan.settledIds.length) await batch.commit();
  return plan;
};

FS.admin.recordPermanentPayment = async ({ userId, amount, note, createdDate }) => {
  await FS.admin.requireAdmin();
  const value = Number(amount);
  if (!userId) throw new Error("Choose a customer.");
  if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a payment greater than zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate || "")) throw new Error("Choose a valid payment date.");
  const paymentId = FS.uid("fs_pay");
  await FS._db.collection("payments").doc(paymentId).set({
    paymentId,
    userId,
    amount: value,
    note: (note || "").trim(),
    source: "admin",
    permanent: true,
    createdBy: FS.admin.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdDate,
    status: "active",
  });
  const allocation = await FS.admin.allocateApprovedTransactions(userId);
  return { paymentId, ...allocation };
};

FS.admin.setTransactionReviewStatus = async (id, reviewStatus) => {
  await FS.admin.requireAdmin();
  if (!['neutral', 'approved'].includes(reviewStatus)) throw new Error("Choose a valid transaction status.");
  const ref = FS._db.collection("transactions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Transaction not found.");
  const record = snap.data();
  if (record.reviewStatus === "paid") throw new Error("Paid transactions are permanent and cannot be changed.");
  const payload = reviewStatus === "neutral"
    ? {
        reviewStatus: firebase.firestore.FieldValue.delete(),
        approvedAt: firebase.firestore.FieldValue.delete(),
        approvedBy: firebase.firestore.FieldValue.delete(),
      }
    : {
        reviewStatus: "approved",
        userStatus: firebase.firestore.FieldValue.delete(),
        userStatusAt: firebase.firestore.FieldValue.delete(),
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        approvedBy: FS.admin.user.uid,
      };
  await ref.update(payload);
  if (reviewStatus === "approved") await FS.admin.allocateApprovedTransactions(record.userId || record.uid);
};

FS.admin.deleteTransaction = async (id) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("transactions").doc(id).delete();
};

/* Wipes every trace of one identity (transactions/payments/adjustments/
 * devices/codes-pointing-at-them/the user doc itself) so that browser gets
 * a genuinely clean slate next time it loads the app — used for clearing
 * test guests. The underlying Firebase Auth account isn't reachable from
 * client code, so it isn't deleted; a wiped identity that revisits just
 * regenerates the same records from zero (same effect as a fresh guest). */
FS.admin.deleteUserData = async (userId) => {
  await FS.admin.requireAdmin();
  const batch = FS._db.batch();
  let count = 0;
  for (const [col, field] of [["transactions", "uid"], ["payments", "userId"], ["adjustments", "userId"], ["devices", "uid"], ["codes", "userId"]]) {
    const snap = await FS._db.collection(col).where(field, "==", userId).get();
    for (const doc of snap.docs) { batch.delete(doc.ref); count++; }
  }
  batch.delete(FS._db.collection("users").doc(userId));
  await batch.commit();
  return count;
};

FS.admin.getUserTransactionHistory = async (userId) => {
  await FS.admin.requireAdmin();
  const snap = await FS._db.collection("transactions").where("uid", "==", userId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((t) => t.status !== "void");
};

/* ---------- bin inventory (admin stock-keeping, separate from customer self-serve) ---------- */

FS.admin.addInventory = async ({ snackId, quantity, note }) => {
  await FS.admin.requireAdmin();
  const qty = Number(quantity);
  if (!snackId) throw new Error("Choose a snack.");
  if (!qty || qty <= 0) throw new Error("Enter a quantity greater than zero.");
  const id = FS.uid("fs_inv");
  await FS._db.collection("inventory").doc(id).set({
    entryId: id,
    snackId,
    quantity: qty,
    note: (note || "").trim(),
    createdBy: FS.admin.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

FS.admin.getInventorySnapshot = async () => {
  await FS.admin.requireAdmin();
  const [settings, snacks, entries, transactions] = await Promise.all([
    FS.getSettings(),
    FS.getCatalog(true),
    FS.admin.getCollection("inventory"),
    FS.admin.getCollection("transactions"),
  ]);
  const activeTxns = transactions.filter((t) => t.status !== "void");

  const bySnack = new Map(snacks.map((s) => [s.id, { snack: s, stocked: 0, sold: 0, revenue: 0 }]));
  for (const e of entries) {
    const row = bySnack.get(e.snackId);
    if (row) row.stocked += Number(e.quantity || 0);
  }
  for (const t of activeTxns) {
    const row = t.snackId && bySnack.get(t.snackId);
    if (row) {
      row.sold += Number(t.quantity || 0);
      row.revenue += Number(t.total || 0);
    }
  }
  const rows = [...bySnack.values()].map((r) => ({ ...r, remaining: r.stocked - r.sold }));
  const totals = rows.reduce((acc, r) => ({
    stocked: acc.stocked + r.stocked,
    sold: acc.sold + r.sold,
    remaining: acc.remaining + r.remaining,
    revenue: acc.revenue + r.revenue,
  }), { stocked: 0, sold: 0, remaining: 0, revenue: 0 });

  return {
    settings,
    rows,
    totals,
    entries: entries.sort((a, b) => FS.admin.dateFromRecord(b, "createdAt").localeCompare(FS.admin.dateFromRecord(a, "createdAt"))),
  };
};

FS.admin.saveSnack = async (snack) => {
  await FS.admin.requireAdmin();
  const id = snack.id || String(snack.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (!id) throw new Error("Snack name is required.");
  const payload = {
    id,
    name: snack.name,
    price: Number(snack.price || 0),
    calories: snack.calories === "" || snack.calories == null ? null : Number(snack.calories),
    style: snack.style || "green",
    factsId: snack.factsId || null,
    photo: snack.photo || null,
    active: snack.active !== false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (Object.prototype.hasOwnProperty.call(snack, "favoritePhoto")) {
    payload.favoritePhoto = snack.favoritePhoto || null;
  }
  await FS._db.collection("snacks").doc(id).set(payload, { merge: true });
};

FS.admin.binTemplates = {
  standard: { label: "Standard seasonal basket", quantity: 1 },
  hundred: { label: "J$100 basket", quantity: 1 },
  large: { label: "Large seasonal basket", quantity: 2 },
  custom: { label: "Custom basket", quantity: 0 },
};

FS.admin.seasonalSnackIds = (snacks) => {
  const wanted = ["oreo", "banana chips", "chee zees", "cheese krunchies"];
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return wanted.map((name) => snacks.find((snack) =>
    normalize(snack.id) === name || normalize(snack.name) === name
  )?.id).filter(Boolean);
};

FS.admin.templateBinItems = (templateId, snacks) => {
  const quantity = FS.admin.binTemplates[templateId]?.quantity || 0;
  if (!quantity) return [];
  return FS.admin.seasonalSnackIds(snacks).map((snackId) => ({ snackId, quantity }));
};

FS.admin.ensureStandardBins = async (snacks) => {
  await FS.admin.requireAdmin();
  const setupRef = FS._db.collection("inventory").doc("bin-location-setup");
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
  const batch = FS._db.batch();
  const now = firebase.firestore.FieldValue.serverTimestamp();
  definitions.forEach(([id, floor, name, templateId], displayOrder) => {
    batch.set(FS._db.collection("inventory").doc(id), {
      id,
      recordType: "bin",
      floor,
      name,
      templateId,
      items: FS.admin.templateBinItems(templateId, snacks),
      displayOrder,
      active: true,
      createdBy: FS.admin.user.uid,
      createdAt: now,
      updatedAt: now,
    });
  });
  batch.set(setupRef, {
    recordType: "binSetup",
    version: 1,
    createdBy: FS.admin.user.uid,
    createdAt: now,
  });
  await batch.commit();
  return true;
};

// options.source: "cache" paints instantly from whatever Firestore already
// has persisted locally (see FS.initFirebase's enablePersistence), skipping
// the one-time bin-seeding check entirely - seeding must only ever act on
// authoritative server data, never on a possibly-incomplete local cache, so
// callers doing a cache-first paint should always follow up with a normal
// (server-sourced) call to get the real, authoritative snapshot.
FS.admin.getBinsSnapshot = async (options = {}) => {
  await FS.admin.requireAdmin();
  const [settings, snacks] = await Promise.all([
    FS.getSettings(options),
    FS.getCatalog(true, options),
  ]);
  if (options.source !== "cache") {
    await FS.admin.ensureStandardBins(snacks);
  }
  const records = (await FS.admin.getCollection("inventory", options))
    .filter((record) => record.recordType === "bin");
  const bySnack = new Map(snacks.map((snack) => [snack.id, snack]));
  const bins = records.map((bin) => {
    const items = (bin.items || []).map((item) => ({
      snackId: item.snackId,
      quantity: Math.max(0, Number(item.quantity || 0)),
    })).filter((item) => item.snackId && item.quantity > 0);
    const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalValue = items.reduce((sum, item) =>
      sum + item.quantity * Number(bySnack.get(item.snackId)?.price || 0), 0);
    return { ...bin, items, totalUnits, totalValue };
  }).sort((a, b) =>
    Number(a.displayOrder ?? 999) - Number(b.displayOrder ?? 999)
    || String(a.floor || "").localeCompare(String(b.floor || ""))
    || String(a.name || "").localeCompare(String(b.name || ""))
  );
  return { settings, snacks, bins };
};

FS.admin.saveBin = async (bin) => {
  await FS.admin.requireAdmin();
  const floor = String(bin.floor || "").trim();
  const name = String(bin.name || "").trim();
  if (!floor || !name) throw new Error("Floor and location name are required.");
  const id = bin.id || FS.uid("bin");
  const items = (bin.items || []).map((item) => ({
    snackId: String(item.snackId || ""),
    quantity: Math.max(0, Math.floor(Number(item.quantity || 0))),
  })).filter((item) => item.snackId && item.quantity > 0);
  await FS._db.collection("inventory").doc(id).set({
    id,
    recordType: "bin",
    floor,
    name,
    templateId: FS.admin.binTemplates[bin.templateId] ? bin.templateId : "custom",
    templateSourceId: bin.templateSourceId || null,
    items,
    active: bin.active !== false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: FS.admin.user.uid,
    ...(bin.id ? {} : {
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: FS.admin.user.uid,
    }),
  }, { merge: true });
  return id;
};

FS.admin.deleteBin = async (id) => {
  await FS.admin.requireAdmin();
  if (!id) throw new Error("Choose a basket to delete.");
  await FS._db.collection("inventory").doc(id).delete();
};

FS.admin.renameBinFloor = async (currentFloor, nextFloor) => {
  await FS.admin.requireAdmin();
  const from = String(currentFloor || "").trim();
  const to = String(nextFloor || "").trim();
  if (!from || !to) throw new Error("Both floor names are required.");
  const records = (await FS.admin.getCollection("inventory"))
    .filter((record) => record.recordType === "bin" && record.floor === from);
  if (!records.length) throw new Error("No baskets were found on that floor.");
  const batch = FS._db.batch();
  records.forEach((record) => batch.set(FS._db.collection("inventory").doc(record.id), {
    floor: to,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: FS.admin.user.uid,
  }, { merge: true }));
  await batch.commit();
  return records.length;
};

FS.admin.duplicateBinFloor = async (sourceFloor, targetFloor) => {
  await FS.admin.requireAdmin();
  const from = String(sourceFloor || "").trim();
  const to = String(targetFloor || "").trim();
  if (!from || !to) throw new Error("Source and new floor names are required.");
  const allBins = (await FS.admin.getCollection("inventory"))
    .filter((record) => record.recordType === "bin");
  const source = allBins.filter((record) => record.floor === from);
  if (!source.length) throw new Error("No baskets were found on that floor.");
  if (allBins.some((record) => record.floor.toLowerCase() === to.toLowerCase())) {
    throw new Error("A floor with that name already exists.");
  }
  const nextOrder = Math.max(-1, ...allBins.map((record) => Number(record.displayOrder ?? -1))) + 1;
  const batch = FS._db.batch();
  const now = firebase.firestore.FieldValue.serverTimestamp();
  source.forEach((record, index) => {
    const id = FS.uid("bin");
    batch.set(FS._db.collection("inventory").doc(id), {
      id,
      recordType: "bin",
      floor: to,
      name: record.name,
      templateId: record.templateId || "custom",
      templateSourceId: record.templateSourceId || null,
      items: (record.items || []).map((item) => ({
        snackId: item.snackId,
        quantity: Math.max(0, Number(item.quantity || 0)),
      })),
      displayOrder: nextOrder + index,
      active: record.active !== false,
      duplicatedFromFloor: from,
      createdAt: now,
      updatedAt: now,
      createdBy: FS.admin.user.uid,
      updatedBy: FS.admin.user.uid,
    });
  });
  await batch.commit();
  return source.length;
};

FS.admin.deleteBinFloor = async (floorName) => {
  await FS.admin.requireAdmin();
  const floor = String(floorName || "").trim();
  if (!floor) throw new Error("Choose a floor to delete.");
  const records = (await FS.admin.getCollection("inventory"))
    .filter((record) => record.recordType === "bin" && record.floor === floor);
  if (!records.length) throw new Error("No baskets were found on that floor.");
  const batch = FS._db.batch();
  records.forEach((record) => batch.delete(FS._db.collection("inventory").doc(record.id)));
  await batch.commit();
  return records.length;
};

FS.admin.saveBinOrder = async (binIds) => {
  await FS.admin.requireAdmin();
  const ids = [...new Set((binIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("No baskets were provided for ordering.");
  const batch = FS._db.batch();
  ids.forEach((id, displayOrder) => batch.set(FS._db.collection("inventory").doc(id), {
    displayOrder,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: FS.admin.user.uid,
  }, { merge: true }));
  await batch.commit();
};

FS.admin.duplicateBin = async (sourceId, targetFloor, targetName) => {
  await FS.admin.requireAdmin();
  const sourceSnap = await FS._db.collection("inventory").doc(sourceId).get();
  if (!sourceSnap.exists || sourceSnap.data().recordType !== "bin") throw new Error("Source basket not found.");
  const source = sourceSnap.data();
  const floor = String(targetFloor || source.floor || "").trim();
  const name = String(targetName || `${source.name || "Basket"} Copy`).trim();
  if (!floor || !name) throw new Error("Floor and basket name are required.");
  const id = FS.uid("bin");
  const now = firebase.firestore.FieldValue.serverTimestamp();
  await FS._db.collection("inventory").doc(id).set({
    id,
    recordType: "bin",
    floor,
    name,
    templateId: "custom",
    templateSourceId: sourceId,
    items: (source.items || []).map((item) => ({
      snackId: item.snackId,
      quantity: Math.max(0, Number(item.quantity || 0)),
    })),
    active: source.active !== false,
    duplicatedFromBin: sourceId,
    createdAt: now,
    updatedAt: now,
    createdBy: FS.admin.user.uid,
    updatedBy: FS.admin.user.uid,
  });
  return id;
};

// Persists the bundled artwork map when an authorized Admin opens Catalog.
// Reads first and writes only records whose paths are stale, so ordinary
// catalog refreshes do not create repeated update noise.
FS.admin.syncBundledSnackArtwork = async () => {
  await FS.admin.requireAdmin();
  const entries = Object.entries(FS.bundledSnackArtwork || {});
  const snapshots = await Promise.all(entries.map(([id]) =>
    FS._db.collection("snacks").doc(id).get()
  ));
  const batch = FS._db.batch();
  let changed = 0;
  entries.forEach(([id, artwork], index) => {
    const snap = snapshots[index];
    if (!snap.exists) return;
    const current = snap.data();
    const missing = {};
    if (!current.photo) missing.photo = artwork.photo;
    if (!current.favoritePhoto) missing.favoritePhoto = artwork.favoritePhoto;
    if (!Object.keys(missing).length) return;
    batch.set(snap.ref, {
      ...missing,
      artworkUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    changed++;
  });
  if (changed) await batch.commit();
  return changed;
};

/* Downsizes and re-encodes an admin's uploaded photo as WebP client-side
 * before it ever reaches Storage, so every new upload is already an
 * optimized copy instead of storing whatever raw size the source file (a
 * camera photo, an unoptimized PNG export, etc.) happened to be - several of
 * the bundled snack photos this app shipped with were 1.5-2.5MB PNGs for
 * what should be a ~100-200KB product photo, purely because nothing
 * compressed them on the way in. Falls back to the original file untouched
 * if the browser can't encode WebP, if decoding fails, or if the re-encoded
 * result somehow isn't actually smaller. */
FS.admin.prepareImageForUpload = (file, maxDimension = 1600, quality = 0.82) =>
  new Promise((resolve) => {
    const fallback = () => resolve({
      blob: file,
      contentType: file.type,
      extension: (String(file.name || "").split(".").pop() || "jpg").toLowerCase(),
    });
    if (typeof document === "undefined" || !document.createElement) return fallback();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); fallback(); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return fallback();
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob || blob.size >= file.size) { fallback(); return; }
        resolve({ blob, contentType: "image/webp", extension: "webp" });
      }, "image/webp", quality);
    };
    img.src = url;
  });

FS.admin.uploadSnackImage = async (snackId, file, kind = "photo", onProgress) => {
  await FS.admin.requireAdmin();
  if (!FS._storage) throw new Error("Firebase Storage SDK is unavailable.");
  if (!snackId) throw new Error("Choose a snack first.");
  if (!file) throw new Error("Choose an image to upload.");
  if (!String(file.type || "").startsWith("image/")) throw new Error("Only image files can be uploaded.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Images must be 10 MB or smaller.");
  if (!["photo", "favoritePhoto"].includes(kind)) throw new Error("Unknown artwork type.");

  const docRef = FS._db.collection("snacks").doc(snackId);
  const currentSnap = await docRef.get();
  if (!currentSnap.exists) throw new Error("Snack record not found.");
  const current = currentSnap.data();
  const pathField = kind === "photo" ? "photoStoragePath" : "favoritePhotoStoragePath";
  const { blob, contentType, extension } = await FS.admin.prepareImageForUpload(file);
  const safeName = String(file.name || "image")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";
  const objectPath = `snacks/${snackId}/${kind}-${Date.now()}-${safeName}.${extension}`;
  const objectRef = FS._storage.ref(objectPath);
  const task = objectRef.put(blob, {
    contentType,
    cacheControl: "public,max-age=31536000,immutable",
    customMetadata: { snackId, artworkKind: kind },
  });
  const snapshot = await new Promise((resolve, reject) => {
    task.on("state_changed", (state) => {
      const percent = state.totalBytes ? Math.round((state.bytesTransferred / state.totalBytes) * 100) : 0;
      if (onProgress) onProgress(percent);
    }, reject, () => resolve(task.snapshot));
  });
  const url = await snapshot.ref.getDownloadURL();
  await docRef.set({
    [kind]: url,
    [pathField]: objectPath,
    artworkUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const previousPath = current[pathField];
  if (previousPath && previousPath !== objectPath && previousPath.startsWith(`snacks/${snackId}/`)) {
    try { await FS._storage.ref(previousPath).delete(); } catch (error) {
      if (error.code !== "storage/object-not-found") console.warn("Old snack image cleanup failed", error);
    }
  }
  return { url, objectPath };
};

FS.admin.saveSnackOrder = async (snackIds) => {
  await FS.admin.requireAdmin();
  const ids = [...new Set((snackIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("No snacks were provided for ordering.");
  const batch = FS._db.batch();
  ids.forEach((id, displayOrder) => {
    batch.set(FS._db.collection("snacks").doc(id), {
      displayOrder,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  await batch.commit();
};

FS.admin.deactivateSnack = async (id) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("snacks").doc(id).set({
    active: false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
};

FS.admin.renameUser = async (userId, displayName, vipStatus) => {
  await FS.admin.requireAdmin();
  await FS._db.collection("users").doc(userId).set({
    displayName,
    vipStatus,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
};

/* ---------- admin-owned tabs: pre-create a guest profile, build it out,
 * and only share the invite once it's ready ---------- */

FS.admin.getUserProfile = async (userId) => {
  await FS.admin.requireAdmin();
  const snap = await FS._db.collection("users").doc(userId).get();
  if (!snap.exists) throw new Error("That tab no longer exists.");
  return { id: snap.id, ...snap.data() };
};

FS.admin.createGuestTab = async (displayName) => {
  await FS.admin.requireAdmin();
  const userId = FS.uid("cust");
  const name = (displayName || "").trim();
  // Same "Guest XXXX" pattern a real anonymous customer gets on first visit
  // (see FS.getOrCreateDevice) — not a "New Guest" placeholder, so an
  // admin-created tab looks identical to an organic one until it's named.
  const finalName = name || `${FS.appConfig.anonUserPrefix || "Guest"} ${FS.randomCode(4)}`;
  await FS._db.collection("users").doc(userId).set({
    userId,
    uid: userId,
    displayName: finalName,
    vipStatus: name ? "named" : "anonymous",
    linkedUids: [],
    createdByAdmin: FS.admin.user.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return userId;
};

/* One reusable customer-shaped tab for the signed-in Admin to test the
 * profile experience. The source customer's records are read and copied;
 * they are never updated. A deterministic target id makes the operation
 * idempotent, so the Admin menu cannot create duplicate test profiles. */
FS.admin.openAdminTestProfile = async (sourceUserId) => {
  await FS.admin.requireAdmin();
  const targetUserId = "admin-test-profile";
  const targetRef = FS._db.collection("users").doc(targetUserId);
  const targetSnap = await targetRef.get();

  let viewCode = targetSnap.exists ? targetSnap.data().adminViewCode : null;
  if (!targetSnap.exists) {
    let sourceSnap = sourceUserId
      ? await FS._db.collection("users").doc(sourceUserId).get()
      : null;
    if (!sourceSnap?.exists) {
      const candidates = (await FS.admin.getCollection("users"))
        .filter((record) => record.userId !== targetUserId && record.vipStatus !== "feedback");
      sourceSnap = candidates.length
        ? await FS._db.collection("users").doc(candidates[0].id).get()
        : null;
      sourceUserId = sourceSnap?.id || null;
    }
    if (!sourceSnap?.exists || !sourceUserId) throw new Error("No customer profile is available to create the Admin test tab.");
    const collections = ["transactions", "payments", "adjustments"];
    const sourceRecords = await Promise.all(collections.map((name) =>
      FS._db.collection(name).where("userId", "==", sourceUserId).get()
    ));
    const recordCount = sourceRecords.reduce((count, snap) => count + snap.size, 0);
    if (recordCount + 2 > 490) throw new Error("The VIP tab is too large to clone in one operation.");

    for (let attempt = 0; attempt < 6 && !viewCode; attempt++) {
      const candidate = FS.randomCode(10);
      const clash = await FS._db.collection("codes").doc(candidate).get();
      if (!clash.exists) viewCode = candidate;
    }
    if (!viewCode) throw new Error("Could not create a private Admin profile code.");

    const batch = FS._db.batch();
    const now = firebase.firestore.FieldValue.serverTimestamp();
    batch.set(targetRef, {
      userId: targetUserId,
      uid: targetUserId,
      tabId: targetUserId,
      displayName: "Admin",
      vipStatus: "named",
      profileSource: "admin-test",
      clonedFrom: sourceUserId,
      linkedUids: [],
      adminViewCode: viewCode,
      createdByAdmin: FS.admin.user.uid,
      createdAt: now,
    });
    collections.forEach((name, index) => {
      for (const sourceDoc of sourceRecords[index].docs) {
        const source = sourceDoc.data();
        const idField = name === "transactions" ? "transactionId"
          : name === "payments" ? "paymentId" : "adjustmentId";
        const clonedId = `admin-test-${name}-${sourceDoc.id}`;
        batch.set(FS._db.collection(name).doc(clonedId), {
          ...source,
          [idField]: clonedId,
          uid: targetUserId,
          userId: targetUserId,
          deviceId: "admin-test",
          source: "admin-test-clone",
          clonedFrom: sourceDoc.id,
          clonedFromUserId: sourceUserId,
          createdBy: FS.admin.user.uid,
        });
      }
    });
    batch.set(FS._db.collection("codes").doc(viewCode), {
      code: viewCode,
      userId: targetUserId,
      type: "view",
      active: true,
      purpose: "admin-test-profile",
      createdBy: FS.admin.user.uid,
      createdAt: now,
    });
    await batch.commit();
  }

  let codeIsValid = false;
  if (viewCode) {
    const codeSnap = await FS._db.collection("codes").doc(viewCode).get();
    codeIsValid = codeSnap.exists
      && codeSnap.data().active !== false
      && codeSnap.data().type === "view"
      && codeSnap.data().userId === targetUserId;
  }
  if (!codeIsValid) {
    viewCode = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = FS.randomCode(10);
      const clash = await FS._db.collection("codes").doc(candidate).get();
      if (!clash.exists) { viewCode = candidate; break; }
    }
    if (!viewCode) throw new Error("Could not repair the Admin test profile link.");
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const batch = FS._db.batch();
    batch.set(targetRef, { adminViewCode: viewCode, updatedAt: now }, { merge: true });
    batch.set(FS._db.collection("codes").doc(viewCode), {
      code: viewCode,
      userId: targetUserId,
      type: "view",
      active: true,
      purpose: "admin-test-profile",
      createdBy: FS.admin.user.uid,
      createdAt: now,
    });
    await batch.commit();
  }

  await FS._db.collection("claims").doc(FS.admin.user.uid).set({
    uid: FS.admin.user.uid,
    code: viewCode,
    purpose: "admin-test-profile",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  localStorage.setItem(FS.tabCodeKey, viewCode);
  return `index.html?code=${encodeURIComponent(viewCode)}&profile=admin-test`;
};

// Logs a snack directly onto a customer's tab as the admin - e.g. building
// out a guest profile before sharing its invite, or adding on a regular's
// behalf. Mirrors FS.addTransaction's record shape but isn't tied to the
// admin's own device/uid.
FS.admin.addTransactionFor = async (userId, items) => {
  await FS.admin.requireAdmin();
  const batch = FS._db.batch();
  const today = FS.todayISO();
  const now = firebase.firestore.FieldValue.serverTimestamp();
  const saved = [];
  for (const item of items) {
    const snack = item.snack || item;
    const quantity = Number(item.qty || item.quantity || 1);
    if (!snack || !snack.id || quantity < 1) continue;
    const transactionId = FS.uid("fs_txn");
    const ref = FS._db.collection("transactions").doc(transactionId);
    const record = {
      transactionId,
      uid: userId,
      userId,
      deviceId: "admin",
      visitorId: null,
      snackId: snack.id,
      snackName: snack.name,
      quantity,
      unitPrice: Number(snack.price || 0),
      total: Number(snack.price || 0) * quantity,
      calories: snack.calories ?? null,
      source: "admin",
      createdAt: now,
      createdDate: today,
      status: "active",
    };
    batch.set(ref, record);
    saved.push(record);
  }
  if (!saved.length) throw new Error("Choose at least one snack.");
  await batch.commit();
  return saved;
};
