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

FS.admin.getCollection = async (name) => {
  const snap = await FS._db.collection(name).get();
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
    accounting: FS.admin.accounting(users, devices, activeTransactions, activePayments, activeAdjustments),
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
        paidTotal: 0,
        adjustmentTotal: 0,
        balance: 0,
        lastActivity: "",
        linkedUids: [],
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
    row.lastActivity = FS.admin.maxDate(row.lastActivity, t.createdDate || FS.admin.dateFromRecord(t, "createdAt"));
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
  await FS._db.collection("snacks").doc(id).set({
    id,
    name: snack.name,
    price: Number(snack.price || 0),
    calories: snack.calories === "" || snack.calories == null ? null : Number(snack.calories),
    style: snack.style || "green",
    factsId: snack.factsId || null,
    photo: snack.photo || null,
    active: snack.active !== false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
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
  const [sourceSnap, targetSnap] = await Promise.all([
    FS._db.collection("users").doc(sourceUserId).get(),
    targetRef.get(),
  ]);
  if (!sourceSnap.exists) throw new Error("The original VIP Customer tab was not found.");

  let viewCode = targetSnap.exists ? targetSnap.data().adminViewCode : null;
  if (!targetSnap.exists) {
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
  } else if (!viewCode) {
    viewCode = await FS.admin.createLinkInvite(targetUserId);
  }

  await FS._db.collection("claims").doc(FS.admin.user.uid).set({
    uid: FS.admin.user.uid,
    code: viewCode,
    purpose: "admin-test-profile",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  localStorage.setItem(FS.tabCodeKey, viewCode);
  return `index.html?code=${encodeURIComponent(viewCode)}`;
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
