/* Server-side ports of the pure helpers from js/firebase-store.js and
 * js/firebase-admin.js that the backend itself needs (id/date generation,
 * accounting rollups, payment allocation). Logic is copied verbatim from
 * the client version - these were already pure functions with no
 * Firestore/network access, just moved to run here since the endpoints
 * that use them now live here too. */

const uid = (prefix) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const randomCode = (len = 4) =>
  Math.random().toString(36).slice(2, 2 + len).toUpperCase();

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dateFromRecord = (record, field) => {
  const value = record && record[field];
  if (value && typeof value.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  return "";
};

const maxDate = (a, b) => (String(a || "") > String(b || "") ? a : b);

const accountKey = (record) => record.userId || record.uid || record.deviceId || "unassigned";

function accounting(users, devices, transactions, payments, adjustments) {
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
    row.lastActivity = maxDate(row.lastActivity, dateFromRecord(device, "lastSeenAt"));
  }
  for (const t of transactions) {
    const row = ensure(accountKey(t));
    row.snackTotal += Number(t.total || t.value || 0);
    const activityDate = t.createdDate || dateFromRecord(t, "createdAt");
    if (activityDate) {
      row.datedSnackTotal += Number(t.total || t.value || 0);
      if (!row.snackActivityDates.includes(activityDate)) row.snackActivityDates.push(activityDate);
    }
    row.lastActivity = maxDate(row.lastActivity, activityDate);
  }
  for (const p of payments) {
    const row = ensure(accountKey(p));
    row.paidTotal += Number(p.amount || 0);
    row.lastActivity = maxDate(row.lastActivity, p.createdDate || dateFromRecord(p, "createdAt"));
  }
  for (const a of adjustments) {
    const row = ensure(accountKey(a));
    row.adjustmentTotal += Number(a.amount || 0);
    row.lastActivity = maxDate(row.lastActivity, a.createdDate || dateFromRecord(a, "createdAt"));
  }
  return [...rows.values()].map((row) => ({
    ...row,
    balance: row.snackTotal + row.adjustmentTotal - row.paidTotal,
    activityDays: row.snackActivityDates.length,
    averagePurchasePerDay: row.snackActivityDates.length ? Math.round(row.datedSnackTotal / row.snackActivityDates.length) : 0,
  })).filter((row) =>
    row.snackTotal !== 0
    || row.paidTotal !== 0
    || row.adjustmentTotal !== 0
    || row.vipStatus !== "anonymous"
    || !!row.createdByAdmin
  ).sort((a, b) => b.balance - a.balance || String(a.displayName).localeCompare(String(b.displayName)));
}

function paymentAllocationPlan(transactions, paidTotal) {
  const alreadySettled = transactions
    .filter((record) => record.reviewStatus === "paid")
    .reduce((sum, record) => sum + Number(record.total || record.value || 0), 0);
  let available = Math.max(0, paidTotal - alreadySettled);
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
}

const withBundledSnackArtwork = (snack, bundledSnackArtwork) => {
  const bundled = bundledSnackArtwork[snack.id] || {};
  return {
    ...snack,
    photo: snack.photo || bundled.photo || null,
    favoritePhoto: snack.favoritePhoto || bundled.favoritePhoto || null,
  };
};

const defaultSnackOrder = ["oreo", "banana-chips", "plantain-chips"];

const compareSnackOrder = (a, b) => {
  const explicitA = a.displayOrder != null && Number.isFinite(Number(a.displayOrder)) ? Number(a.displayOrder) : null;
  const explicitB = b.displayOrder != null && Number.isFinite(Number(b.displayOrder)) ? Number(b.displayOrder) : null;
  const defaultA = defaultSnackOrder.indexOf(a.id);
  const defaultB = defaultSnackOrder.indexOf(b.id);
  const orderA = explicitA ?? (defaultA >= 0 ? defaultA : 1000);
  const orderB = explicitB ?? (defaultB >= 0 ? defaultB : 1000);
  return orderA - orderB || String(a.name || "").localeCompare(String(b.name || ""));
};

const bundledSnackArtwork = {
  chewy: { photo: "assets/chewy.jpg", favoritePhoto: "assets/chewy-background.webp" },
  "kiss-banana-bread": { photo: "assets/kiss-banana-bread.webp", favoritePhoto: "assets/kiss-banana-bread-background.webp" },
  "kiss-brownie-rich-dark-chocolate": { photo: "assets/kiss-brownie.webp", favoritePhoto: "assets/kiss-brownie-background.webp" },
  oreo: { photo: "assets/oreo.webp", favoritePhoto: "assets/oreo-background.webp" },
};

const binTemplates = {
  standard: { label: "Standard seasonal basket", quantity: 1 },
  hundred: { label: "J$100 basket", quantity: 1 },
  large: { label: "Large seasonal basket", quantity: 2 },
  custom: { label: "Custom basket", quantity: 0 },
};

const seasonalSnackIds = (snacks) => {
  const wanted = ["oreo", "banana chips", "chee zees", "cheese krunchies"];
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return wanted.map((name) => snacks.find((snack) =>
    normalize(snack.id) === name || normalize(snack.name) === name
  )?.id).filter(Boolean);
};

const templateBinItems = (templateId, snacks) => {
  const quantity = binTemplates[templateId]?.quantity || 0;
  if (!quantity) return [];
  return seasonalSnackIds(snacks).map((snackId) => ({ snackId, quantity }));
};

const toEntry = (t) => ({
  id: t.transactionId || t.id,
  date: t.createdDate || null,
  snackId: t.snackId || null,
  label: t.snackName || t.label || null,
  count: Number(t.quantity || t.count || 1),
  value: Number(t.total || t.value || 0),
  source: t.source || "self",
  userStatus: t.userStatus || null,
});

const toPayment = (p) => ({
  id: p.paymentId || p.id,
  date: p.createdDate || null,
  amount: Number(p.amount || 0),
  note: p.note || "",
});

const clean = (v) => {
  const s = (v ?? "").toString().trim();
  return s || null;
};

module.exports = {
  uid,
  randomCode,
  todayISO,
  dateFromRecord,
  maxDate,
  accountKey,
  accounting,
  paymentAllocationPlan,
  withBundledSnackArtwork,
  compareSnackOrder,
  bundledSnackArtwork,
  binTemplates,
  seasonalSnackIds,
  templateBinItems,
  toEntry,
  toPayment,
  clean,
};
