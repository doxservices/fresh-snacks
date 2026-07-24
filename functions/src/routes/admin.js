/* Admin-only endpoints - ports of js/firebase-admin.js's FS.admin.* functions
 * that touch Firestore/Storage. Every route below requires admin auth
 * (see router.use at the bottom of the requires). */
const express = require("express");
const admin = require("firebase-admin");
const { requireAuth, requireAdmin, asyncRoute } = require("../middleware");
const {
  uid: genId, todayISO, dateFromRecord, accounting, paymentAllocationPlan,
  binTemplates, seasonalSnackIds, templateBinItems, randomCode,
} = require("../lib/shared");

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
  const snacks = snacksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const activeTransactions = transactions.filter((x) => x.status !== "void");
  const balanceTransactions = activeTransactions.filter((x) => x.userStatus !== "disputed");
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
    payments: activePayments,
    adjustments: activeAdjustments,
    feedback: feedback.sort((a, b) => dateFromRecord(b, "createdAt").localeCompare(dateFromRecord(a, "createdAt"))),
    accounting: accounting(users, devices, balanceTransactions, activePayments, activeAdjustments),
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
    if (codeSnap.exists && codeSnap.data().active !== false) { res.json({ code: existing }); return; }
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
  res.json({ code });
}));

router.get("/users/:userId/linked-devices", asyncRoute(async (req, res) => {
  const userSnap = await db().collection("users").doc(req.params.userId).get();
  const linkedUids = userSnap.exists ? (userSnap.data().linkedUids || []) : [];
  const info = await Promise.all(linkedUids.map(async (uid) => {
    const snap = await db().collection("devices").where("uid", "==", uid).limit(1).get();
    const device = snap.empty ? null : snap.docs[0].data();
    return {
      uid,
      deviceLabel: device?.deviceLabel || "Unknown device",
      lastSeenDate: device ? dateFromRecord(device, "lastSeenAt") : "",
    };
  }));
  res.json(info);
}));

router.delete("/users/:userId/linked-devices/:deviceUid", asyncRoute(async (req, res) => {
  await db().collection("users").doc(req.params.userId).update({
    linkedUids: FieldValue.arrayRemove(req.params.deviceUid),
  });
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

router.post("/transactions/:id/resolve", asyncRoute(async (req, res) => {
  await db().collection("transactions").doc(req.params.id).update({
    userStatus: FieldValue.delete(),
    userStatusAt: FieldValue.delete(),
    resolvedBy: req.uid,
    resolvedAt: FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
}));

router.patch("/transactions/:id", asyncRoute(async (req, res) => {
  const { quantity, createdDate } = req.body;
  const qty = Math.floor(Number(quantity));
  if (!Number.isFinite(qty) || qty < 1) throw bad("Quantity must be at least one.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate || "")) throw bad("Choose a valid date.");
  const transactionRef = db().collection("transactions").doc(req.params.id);
  const transactionSnap = await transactionRef.get();
  if (!transactionSnap.exists) throw bad("Transaction not found.", 404);
  const transaction = transactionSnap.data();
  if (transaction.reviewStatus === "paid") throw bad("Paid transactions are permanent and cannot be changed.");
  const snackSnap = await db().collection("snacks").doc(transaction.snackId).get();
  if (!snackSnap.exists || snackSnap.data().active === false) throw bad("This snack is no longer available in the catalogue.");
  const snack = snackSnap.data();
  const unitPrice = Number(snack.price || 0);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw bad("This catalogue item does not have a valid price.");
  await transactionRef.update({
    quantity: qty,
    unitPrice,
    total: unitPrice * qty,
    snackName: snack.name || transaction.snackName,
    calories: snack.calories ?? null,
    createdDate,
    userStatus: FieldValue.delete(),
    userStatusAt: FieldValue.delete(),
    editedBy: req.uid,
    editedAt: FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
}));

router.post("/transactions/:id/merge-or-move", asyncRoute(async (req, res) => {
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
    if ((source.reviewStatus || "neutral") !== "neutral" || (target.reviewStatus || "neutral") !== "neutral") {
      throw bad("Only unapproved listings can be moved or combined.");
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

router.post("/transactions/:id/void", asyncRoute(async (req, res) => {
  await db().collection("transactions").doc(req.params.id).update({
    status: "void", voidedBy: req.uid, voidedAt: FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
}));

router.post("/payments/:id/void", asyncRoute(async (req, res) => {
  await db().collection("payments").doc(req.params.id).update({
    status: "void", voidedBy: req.uid, voidedAt: FieldValue.serverTimestamp(),
  });
  res.json({ ok: true });
}));

router.delete("/payments/:id", asyncRoute(async (req, res) => {
  await db().collection("payments").doc(req.params.id).delete();
  res.json({ ok: true });
}));

async function allocateApprovedTransactions(userId, uid) {
  const [transactionSnap, paymentSnap] = await Promise.all([
    db().collection("transactions").where("userId", "==", userId).get(),
    db().collection("payments").where("userId", "==", userId).get(),
  ]);
  const transactions = transactionSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => record.status !== "void" && record.userStatus !== "disputed");
  const payments = paymentSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => record.status !== "void");
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const plan = paymentAllocationPlan(transactions, paidTotal);
  const byId = new Map(transactions.map((record) => [record.id, record]));
  const batch = db().batch();
  const now = FieldValue.serverTimestamp();
  for (const id of plan.settledIds) {
    const record = byId.get(id);
    const payload = { reviewStatus: "paid", paidAt: now, paidBy: uid };
    if (record && !record.reviewStatus) {
      payload.approvedAt = now;
      payload.approvedBy = uid;
    }
    batch.update(db().collection("transactions").doc(id), payload);
  }
  if (plan.settledIds.length) await batch.commit();
  return plan;
}

router.post("/payments/permanent", asyncRoute(async (req, res) => {
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

router.patch("/transactions/:id/review-status", asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { reviewStatus } = req.body;
  if (!["neutral", "approved"].includes(reviewStatus)) throw bad("Choose a valid transaction status.");
  const ref = db().collection("transactions").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw bad("Transaction not found.", 404);
  const record = snap.data();
  if (record.reviewStatus === "paid") throw bad("Paid transactions are permanent and cannot be changed.");
  const payload = reviewStatus === "neutral"
    ? { reviewStatus: FieldValue.delete(), approvedAt: FieldValue.delete(), approvedBy: FieldValue.delete() }
    : {
        reviewStatus: "approved",
        userStatus: FieldValue.delete(),
        userStatusAt: FieldValue.delete(),
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: req.uid,
      };
  await ref.update(payload);
  if (reviewStatus === "approved") await allocateApprovedTransactions(record.userId || record.uid, req.uid);
  res.json({ ok: true });
}));

router.delete("/transactions/:id", asyncRoute(async (req, res) => {
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
  res.json(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((t) => t.status !== "void"));
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

router.post("/snacks/:id/deactivate", asyncRoute(async (req, res) => {
  await db().collection("snacks").doc(req.params.id).set({
    active: false, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  res.json({ ok: true });
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

router.post("/test-profile", asyncRoute(async (req, res) => {
  let sourceUserId = req.body.sourceUserId;
  const targetUserId = "admin-test-profile";
  const targetRef = db().collection("users").doc(targetUserId);
  const targetSnap = await targetRef.get();

  let viewCode = targetSnap.exists ? targetSnap.data().adminViewCode : null;
  if (!targetSnap.exists) {
    let sourceSnap = sourceUserId ? await db().collection("users").doc(sourceUserId).get() : null;
    if (!sourceSnap?.exists) {
      const candidates = (await getCollection("users"))
        .filter((record) => record.userId !== targetUserId && record.vipStatus !== "feedback");
      sourceSnap = candidates.length ? await db().collection("users").doc(candidates[0].id).get() : null;
      sourceUserId = sourceSnap?.id || null;
    }
    if (!sourceSnap?.exists || !sourceUserId) throw bad("No customer profile is available to create the Admin test tab.");
    const collections = ["transactions", "payments", "adjustments"];
    const sourceRecords = await Promise.all(collections.map((name) =>
      db().collection(name).where("userId", "==", sourceUserId).get()
    ));
    const recordCount = sourceRecords.reduce((count, snap) => count + snap.size, 0);
    if (recordCount + 2 > 490) throw bad("The VIP tab is too large to clone in one operation.");

    for (let attempt = 0; attempt < 6 && !viewCode; attempt++) {
      const candidate = randomCode(10);
      const clash = await db().collection("codes").doc(candidate).get();
      if (!clash.exists) viewCode = candidate;
    }
    if (!viewCode) throw bad("Could not create a private Admin profile code.");

    const batch = db().batch();
    const now = FieldValue.serverTimestamp();
    batch.set(targetRef, {
      userId: targetUserId, uid: targetUserId, tabId: targetUserId,
      displayName: "Admin", vipStatus: "named", profileSource: "admin-test",
      clonedFrom: sourceUserId, linkedUids: [], adminViewCode: viewCode,
      createdByAdmin: req.uid, createdAt: now,
    });
    collections.forEach((name, index) => {
      for (const sourceDoc of sourceRecords[index].docs) {
        const source = sourceDoc.data();
        const idField = name === "transactions" ? "transactionId" : name === "payments" ? "paymentId" : "adjustmentId";
        const clonedId = `admin-test-${name}-${sourceDoc.id}`;
        batch.set(db().collection(name).doc(clonedId), {
          ...source,
          [idField]: clonedId,
          uid: targetUserId,
          userId: targetUserId,
          deviceId: "admin-test",
          source: "admin-test-clone",
          clonedFrom: sourceDoc.id,
          clonedFromUserId: sourceUserId,
          createdBy: req.uid,
        });
      }
    });
    batch.set(db().collection("codes").doc(viewCode), {
      code: viewCode, userId: targetUserId, type: "view", active: true,
      purpose: "admin-test-profile", createdBy: req.uid, createdAt: now,
    });
    await batch.commit();
  }

  let codeIsValid = false;
  if (viewCode) {
    const codeSnap = await db().collection("codes").doc(viewCode).get();
    codeIsValid = codeSnap.exists && codeSnap.data().active !== false
      && codeSnap.data().type === "view" && codeSnap.data().userId === targetUserId;
  }
  if (!codeIsValid) {
    viewCode = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = randomCode(10);
      const clash = await db().collection("codes").doc(candidate).get();
      if (!clash.exists) { viewCode = candidate; break; }
    }
    if (!viewCode) throw bad("Could not repair the Admin test profile link.");
    const now = FieldValue.serverTimestamp();
    const batch = db().batch();
    batch.set(targetRef, { adminViewCode: viewCode, updatedAt: now }, { merge: true });
    batch.set(db().collection("codes").doc(viewCode), {
      code: viewCode, userId: targetUserId, type: "view", active: true,
      purpose: "admin-test-profile", createdBy: req.uid, createdAt: now,
    });
    await batch.commit();
  }

  await db().collection("claims").doc(req.uid).set({
    uid: req.uid, code: viewCode, purpose: "admin-test-profile",
    createdAt: FieldValue.serverTimestamp(),
  });
  res.json({ url: `index.html?code=${encodeURIComponent(viewCode)}&profile=admin-test` });
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
      };
      batch.set(db().collection("transactions").doc(transactionId), record);
      saved.push(record);
    }
  }
  await batch.commit();
  res.json(saved);
}));

module.exports = router;
