/* Fresh Snacks Firebase data layer.
 *
 * This replaces browser-side GitHub Contents API writes. Regular snack users
 * sign in anonymously, receive a local browser/device ID, and write only their
 * own snack transactions to Firestore.
 */

const FS = window.FS || {};
window.FS = FS;

FS.appConfig = window.FS_APP_CONFIG || {};
FS.firebaseConfig = window.FS_FIREBASE_CONFIG || {};
FS._ready = null;
FS._auth = null;
FS._db = null;
FS.currentUser = null;
FS.currentDevice = null;
FS.firebaseConfigStorageKey = "fresh_snacks_firebase_config";

FS.configured = () =>
  FS.firebaseConfig &&
  FS.firebaseConfig.apiKey &&
  !String(FS.firebaseConfig.apiKey).startsWith("YOUR_") &&
  !String(FS.firebaseConfig.projectId || "").startsWith("YOUR_");

FS.initFirebase = async () => {
  if (FS._ready) return FS._ready;
  FS._ready = (async () => {
    if (!FS.configured()) {
      throw new Error("Firebase is not configured yet. Add your Web app config in js/firebase-config.js.");
    }
    if (!window.firebase) {
      throw new Error("Firebase SDK failed to load.");
    }
    if (!firebase.apps.length) firebase.initializeApp(FS.firebaseConfig);
    FS._auth = firebase.auth();
    FS._db = firebase.firestore();
    return FS;
  })();
  return FS._ready;
};

FS.showFirebaseSetupPrompt = (target, message) => {
  const el = typeof target === "string" ? document.getElementById(target) : target;
  if (!el) return;
  const cfg = FS.firebaseConfig || {};
  el.innerHTML = `
    <section class="card section-card firebase-auth-card">
      <h2>Connect Firebase</h2>
      <p style="margin-bottom:10px;">${FS.escapeHtml(message || "Enter your Firebase Web app config to continue.")}</p>
      <div class="form-grid">
        <div class="field"><label for="fb-api-key">API key</label><input id="fb-api-key" value="${FS.escapeHtml(cfg.apiKey || "")}" /></div>
        <div class="field"><label for="fb-auth-domain">Auth domain</label><input id="fb-auth-domain" value="${FS.escapeHtml(cfg.authDomain || "")}" /></div>
        <div class="field"><label for="fb-project-id">Project ID</label><input id="fb-project-id" value="${FS.escapeHtml(cfg.projectId || "")}" /></div>
        <div class="field"><label for="fb-storage-bucket">Storage bucket</label><input id="fb-storage-bucket" value="${FS.escapeHtml(cfg.storageBucket || "")}" /></div>
        <div class="field"><label for="fb-sender-id">Messaging sender ID</label><input id="fb-sender-id" value="${FS.escapeHtml(cfg.messagingSenderId || "")}" /></div>
        <div class="field"><label for="fb-app-id">App ID</label><input id="fb-app-id" value="${FS.escapeHtml(cfg.appId || "")}" /></div>
        <button class="primary" id="fb-config-save">Save Firebase config</button>
        <button id="fb-config-clear">Clear saved config</button>
      </div>
      <div class="status" id="fb-config-status"></div>
    </section>`;

  const status = document.getElementById("fb-config-status");
  const value = (id) => document.getElementById(id).value.trim();
  document.getElementById("fb-config-save").onclick = () => {
    const next = {
      apiKey: value("fb-api-key"),
      authDomain: value("fb-auth-domain"),
      projectId: value("fb-project-id"),
      storageBucket: value("fb-storage-bucket"),
      messagingSenderId: value("fb-sender-id"),
      appId: value("fb-app-id"),
    };
    if (!next.apiKey || !next.authDomain || !next.projectId || !next.appId) {
      status.textContent = "API key, auth domain, project ID, and app ID are required.";
      status.className = "status err";
      return;
    }
    localStorage.setItem(FS.firebaseConfigStorageKey, JSON.stringify(next));
    status.textContent = "Firebase config saved. Reloading...";
    status.className = "status ok";
    location.reload();
  };
  document.getElementById("fb-config-clear").onclick = () => {
    localStorage.removeItem(FS.firebaseConfigStorageKey);
    status.textContent = "Saved Firebase config cleared.";
    status.className = "status ok";
  };
};

FS.escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

FS.signInAnonymous = async () => {
  await FS.initFirebase();
  if (!FS._sessionReady) {
    FS._sessionReady = (async () => {
      // wait for the persisted session (if any) to finish restoring
      await new Promise((resolve) => {
        const unsub = FS._auth.onAuthStateChanged(() => { unsub(); resolve(); });
      });
      const existing = FS._auth.currentUser;
      if (existing) {
        try {
          // force a token refresh: detects sessions whose account was
          // deleted/disabled server-side, which would otherwise poison
          // every Firestore call with permission errors
          await existing.getIdToken(true);
        } catch (e) {
          await FS._auth.signOut().catch(() => {});
        }
      }
      if (!FS._auth.currentUser) await FS._auth.signInAnonymously();
    })();
  }
  await FS._sessionReady;
  FS.currentUser = FS._auth.currentUser;
  localStorage.setItem(FS.appConfig.storageKeys.uid, FS.currentUser.uid);
  return FS.currentUser;
};

FS.uid = (prefix) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

FS.randomCode = (len = 4) =>
  Math.random().toString(36).slice(2, 2 + len).toUpperCase();

FS.money = (n, currency) => `${currency || FS.appConfig.currency || "J$"}${Number(n || 0).toLocaleString("en-US")}`;

FS.todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

FS.parseDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

FS.fmtDay = (iso) => {
  const d = FS.parseDate(iso);
  return d ? `${d.getDate()} ${d.toLocaleString("en", { month: "short" })}` : "-";
};

FS.monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  const name = new Date(y, m - 1, 1).toLocaleString("en", { month: "long" });
  return y === new Date().getFullYear() ? name : `${name} ${y}`;
};

FS.factsPath = (factsId) => `nutritional-facts/${factsId}.jpg`;

/* Generic grey avatar for anonymous guests, inline so no extra asset file
 * is needed. Named/claimed viewers get profile-icon.png (the "VIP" icon)
 * instead — see FS.avatarFor. */
FS.greySilhouette =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
  "<rect width='64' height='64' fill='%23d8ded9'/>" +
  "<circle cx='32' cy='25' r='12' fill='%23a9b3ac'/>" +
  "<path d='M10 58c0-13 10-21 22-21s22 8 22 21' fill='%23a9b3ac'/>" +
  "</svg>";

/* A viewer counts as "vip" (gets the nice icon instead of the grey
 * silhouette) once they're either viewing through a claimed tab code or
 * have given themselves a name — i.e. no longer a brand-new anonymous guest. */
FS.avatarFor = (me, claim) => (claim || (me && me.vipStatus !== "anonymous" && me.displayName))
  ? "profile-icon.png"
  : FS.greySilhouette;

FS.showFacts = (url, name) => {
  const ov = document.createElement("div");
  ov.className = "facts-overlay";
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  img.src = url;
  img.alt = `Nutrition facts for ${name}`;
  const cap = document.createElement("figcaption");
  cap.textContent = `${name} - nutrition facts (tap anywhere to close)`;
  fig.append(img, cap);
  ov.append(fig);
  const close = () => {
    ov.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  ov.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(ov);
};

FS.deviceLabel = () => {
  const ua = navigator.userAgent || "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android phone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Windows/i.test(ua)) return "Windows browser";
  if (/Mac/i.test(ua)) return "Mac browser";
  return "Browser";
};

FS.userAgentBrief = () => (navigator.userAgent || "").slice(0, 160);

FS.ensureLocalId = (key, prefix) => {
  let id = localStorage.getItem(key);
  if (!id) {
    id = FS.uid(prefix);
    localStorage.setItem(key, id);
  }
  return id;
};

FS.getOrCreateDevice = async () => {
  const user = await FS.signInAnonymous();
  const keys = FS.appConfig.storageKeys;
  let deviceId = FS.ensureLocalId(keys.deviceId, FS.appConfig.devicePrefix || "fs_dev");
  const visitorId = FS.ensureLocalId(keys.visitorId, FS.appConfig.visitorPrefix || "fs_guest");
  const now = firebase.firestore.FieldValue.serverTimestamp();
  let deviceRef = FS._db.collection("devices").doc(deviceId);
  let deviceSnap;
  try {
    deviceSnap = await deviceRef.get();
  } catch (e) {
    // the stored device id belongs to a previous identity (e.g. the account
    // was recreated) so its doc is unreadable — rotate to a fresh device id
    deviceId = FS.uid(FS.appConfig.devicePrefix || "fs_dev");
    localStorage.setItem(keys.deviceId, deviceId);
    deviceRef = FS._db.collection("devices").doc(deviceId);
    deviceSnap = await deviceRef.get();
  }
  const base = {
    deviceId,
    uid: user.uid,
    visitorId,
    userId: user.uid,
    deviceLabel: FS.deviceLabel(),
    status: "active",
    lastSeenAt: now,
    userAgentBrief: FS.userAgentBrief(),
    source: "web",
  };
  if (deviceSnap.exists) {
    await deviceRef.set(base, { merge: true });
  } else {
    await deviceRef.set({ ...base, firstSeenAt: now });
  }

  const userRef = FS._db.collection("users").doc(user.uid);
  const userSnap = await userRef.get();
  const displayName = `${FS.appConfig.anonUserPrefix || "Guest"} ${FS.randomCode(4)}`;
  const userBase = {
    userId: user.uid,
    uid: user.uid,
    vipStatus: "anonymous",
    lastSeenAt: now,
    linkedDevices: firebase.firestore.FieldValue.arrayUnion(deviceId),
  };
  if (userSnap.exists) {
    await userRef.set(userBase, { merge: true });
  } else {
    await userRef.set({
      ...userBase,
      displayName,
      email: null,
      phone: null,
      favoriteSnackId: null,
      createdAt: now,
    });
  }

  FS.currentDevice = { deviceId, visitorId, userId: user.uid };
  return FS.currentDevice;
};

/* ---------- share-code claims (view an existing tab via 8-char code) ---------- */

FS.tabCodeKey = "fresh_snacks_tab_code";

/* Reads ?code= from the URL (persisting it) or falls back to the stored one. */
FS.getTabCode = () => {
  const fromUrl = new URLSearchParams(location.search).get("code");
  if (fromUrl && fromUrl.trim()) {
    localStorage.setItem(FS.tabCodeKey, fromUrl.trim().toUpperCase());
  }
  return localStorage.getItem(FS.tabCodeKey) || null;
};

FS.clearTabCode = () => localStorage.removeItem(FS.tabCodeKey);

/* Stores the code on the visitor's own user doc (the rules verify it against
 * codes/{code} on every read) and resolves who the code points at. */
FS.resolveClaim = async () => {
  const code = FS.getTabCode();
  if (!code) return null;
  const user = await FS.signInAnonymous();
  await FS._db.collection("users").doc(user.uid).set({ claimedCode: code }, { merge: true });
  const snap = await FS._db.collection("codes").doc(code).get();
  if (!snap.exists || snap.data().active === false || !snap.data().userId) return null;
  const target = snap.data().userId;
  if (target === user.uid) return null;
  let displayName = null;
  try {
    const u = await FS._db.collection("users").doc(target).get();
    if (u.exists) displayName = u.data().displayName || null;
  } catch (e) { /* profile read is cosmetic */ }
  return { code, userId: target, displayName };
};

FS.getUserTransactions = async (userId) => {
  await FS.initFirebase();
  const snap = await FS._db.collection("transactions")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

FS.getUserPayments = async (userId) => {
  await FS.initFirebase();
  const snap = await FS._db.collection("payments")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

/* ---------- feedback ---------- */

FS.feedbackCategories = [
  { id: "question", label: "A question" },
  { id: "concern", label: "A concern" },
  { id: "change", label: "Request a change" },
  { id: "snack", label: "Request a snack" },
  { id: "credit", label: "Request credit" },
  { id: "other", label: "Something else" },
];

FS.submitFeedback = async ({ firstName, lastName, email, phone, category, amount, requestedSnack, message }) => {
  const user = await FS.signInAnonymous();
  const clean = (v) => {
    const s = (v ?? "").toString().trim();
    return s || null;
  };
  const msg = clean(message);
  if (!msg) throw new Error("Please enter a message before sending.");
  const id = FS.uid("fs_fb");
  const payload = {
    feedbackId: id,
    uid: user.uid,
    firstName: clean(firstName),
    lastName: clean(lastName),
    email: clean(email),
    phone: clean(phone),
    amount: amount > 0 ? Number(amount) : null,
    requestedSnack: clean(requestedSnack),
    category: category || "other",
    message: msg,
    status: "new",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  await FS._db.collection("feedback").doc(id).set(payload);
  return payload;
};

/* ---------- user identity (optional, anonymous by default) ---------- */

FS.getMyProfile = async () => {
  const user = await FS.signInAnonymous();
  const snap = await FS._db.collection("users").doc(user.uid).get();
  return { userId: user.uid, vipStatus: "anonymous", ...(snap.exists ? snap.data() : {}) };
};

/* Users start as an anonymous guest profile. Adding a name (and optionally
 * email/phone) is opt-in; leaving the name blank keeps the guest identity. */
FS.updateMyProfile = async (fields) => {
  const user = await FS.signInAnonymous();
  const clean = (v) => {
    const s = (v ?? "").toString().trim();
    return s || null;
  };
  const firstName = clean(fields.firstName);
  const lastName = clean(fields.lastName);
  // username wins; otherwise compose a display name from first/last
  const displayName = clean(fields.displayName)
    || clean(`${firstName || ""} ${lastName || ""}`);
  const payload = {
    firstName,
    lastName,
    email: clean(fields.email),
    phone: clean(fields.phone),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  if (displayName) {
    payload.displayName = displayName;
    payload.vipStatus = "named";
  }
  await FS._db.collection("users").doc(user.uid).set(payload, { merge: true });
  return FS.getMyProfile();
};

FS.getSettings = async () => {
  await FS.initFirebase();
  const snap = await FS._db.collection("settings").doc("app").get();
  const settings = snap.exists ? snap.data() : {};
  return {
    brand: settings.brand || FS.appConfig.appName || "Fresh Snacks",
    subtitle: settings.subtitle || "Private snack profile",
    currency: settings.currency || FS.appConfig.currency || "J$",
    openingLabel: settings.openingLabel || "Previous Period",
    openingNote: settings.openingNote || "Before daily records",
    favoriteSnackId: settings.favoriteSnackId || null,
    favoriteName: settings.favoriteName || "Favorite snack",
    favoriteDescription: settings.favoriteDescription || "",
  };
};

FS.getCatalog = async (includeInactive = false) => {
  await FS.initFirebase();
  const ref = includeInactive
    ? FS._db.collection("snacks")
    : FS._db.collection("snacks").where("active", "==", true);
  const snap = await ref.get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((s) => includeInactive || s.active !== false)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
};

FS.snackById = (data, id) => (data.catalog || []).find((s) => s.id === id) || null;

FS.entryName = (data, entry) => {
  if (entry.snackId) {
    const s = FS.snackById(data, entry.snackId);
    if (s) return s.name;
  }
  return entry.label || entry.snackName || "Item";
};

FS.entryPillClass = (data, entry) => {
  const s = entry.snackId ? FS.snackById(data, entry.snackId) : null;
  return s && s.style !== "other" ? "snack-pill" : "snack-pill other-pill";
};

FS.getOwnTransactions = async () => {
  const user = await FS.signInAnonymous();
  const snap = await FS._db.collection("transactions")
    .where("uid", "==", user.uid)
    .where("status", "==", "active")
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

FS.getOwnPayments = async () => {
  const user = await FS.signInAnonymous();
  const snap = await FS._db.collection("payments")
    .where("userId", "==", user.uid)
    .where("status", "==", "active")
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

FS.toEntry = (t) => ({
  id: t.transactionId || t.id,
  date: t.createdDate || null,
  snackId: t.snackId || null,
  label: t.snackName || t.label || null,
  count: Number(t.quantity || t.count || 1),
  value: Number(t.total || t.value || 0),
  source: t.source || "self",
  userStatus: t.userStatus || null,
});

/* Owner/claim-holder verdict on a listing: "agreed", "disputed", or null to
 * clear back to neutral. Rules restrict the write to exactly these fields. */
FS.setEntryStatus = async (transactionId, verdict) => {
  await FS.signInAnonymous();
  const payload = verdict
    ? {
        userStatus: verdict,
        userStatusAt: firebase.firestore.FieldValue.serverTimestamp(),
      }
    : {
        userStatus: firebase.firestore.FieldValue.delete(),
        userStatusAt: firebase.firestore.FieldValue.delete(),
      };
  await FS._db.collection("transactions").doc(transactionId).update(payload);
};

FS.toPayment = (p) => ({
  id: p.paymentId || p.id,
  date: p.createdDate || null,
  amount: Number(p.amount || 0),
  note: p.note || "",
});

FS.loadData = async () => {
  await FS.getOrCreateDevice();
  const claim = await FS.resolveClaim().catch(() => null);
  const [profile, catalog, transactions, payments] = await Promise.all([
    FS.getSettings(),
    FS.getCatalog(),
    FS.getOwnTransactions(),
    FS.getOwnPayments(),
  ]);
  let entries = transactions.map(FS.toEntry);
  let pays = payments.map(FS.toPayment);
  if (claim) {
    // merge the claimed tab's history (e.g. the migrated legacy data) with
    // whatever this browser has logged itself
    const [ct, cp] = await Promise.all([
      FS.getUserTransactions(claim.userId),
      FS.getUserPayments(claim.userId),
    ]);
    entries = entries.concat(ct.map(FS.toEntry));
    pays = pays.concat(cp.map(FS.toPayment));
  }
  const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));
  return {
    profile,
    catalog,
    claim,
    entries: entries.sort(byDate),
    payments: pays.sort(byDate),
  };
};

FS.addTransaction = async (items) => {
  const device = await FS.getOrCreateDevice();
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
      uid: FS.currentUser.uid,
      userId: FS.currentUser.uid,
      deviceId: device.deviceId,
      visitorId: device.visitorId,
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
    };
    batch.set(ref, record);
    saved.push(record);
  }
  if (!saved.length) throw new Error("Choose at least one snack.");
  await batch.commit();
  return saved;
};

FS.totals = (data) => {
  const value = data.entries.reduce((t, e) => t + Number(e.value || 0), 0);
  const paid = data.payments.reduce((t, p) => t + Number(p.amount || 0), 0);
  return { value, paid, balance: value - paid };
};

FS.getMyBalance = async () => FS.totals(await FS.loadData());

FS.getMyHistory = async () => {
  const data = await FS.loadData();
  return data.entries;
};

FS.groups = (data) => {
  const buckets = new Map();
  const keyOf = (dated) => (dated ? dated.slice(0, 7) : "opening");
  for (const e of data.entries) {
    const k = keyOf(e.date);
    if (!buckets.has(k)) buckets.set(k, { key: k, entries: [], payments: [] });
    buckets.get(k).entries.push(e);
  }
  for (const p of data.payments) {
    const k = keyOf(p.date);
    if (!buckets.has(k)) buckets.set(k, { key: k, entries: [], payments: [] });
    buckets.get(k).payments.push(p);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === "opening") return -1;
    if (b === "opening") return 1;
    return a.localeCompare(b);
  });
  return keys.map((k) => {
    const g = buckets.get(k);
    const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));
    g.entries.sort(byDate);
    g.payments.sort(byDate);
    g.value = g.entries.reduce((t, e) => t + Number(e.value || 0), 0);
    g.paid = g.payments.reduce((t, p) => t + Number(p.amount || 0), 0);
    return g;
  });
};
