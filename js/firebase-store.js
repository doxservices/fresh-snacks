/* Fresh Snacks Firebase data layer.
 *
 * This replaces browser-side GitHub Contents API writes. Regular snack users
 * browse without an account and only receive an anonymous identity when they
 * deliberately start a tab or accept an invite.
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

FS.restoreSession = async () => {
  await FS.initFirebase();
  if (!FS._sessionReady) {
    FS._sessionReady = new Promise((resolve) => {
      const unsub = FS._auth.onAuthStateChanged((user) => { unsub(); resolve(user || null); });
    });
  }
  const restored = await FS._sessionReady;
  FS.currentUser = FS._auth.currentUser || restored;
  return FS.currentUser;
};

FS.signInAnonymous = async () => {
  const restored = await FS.restoreSession();
  if (!restored) {
    const credential = await FS._auth.signInAnonymously();
    FS.currentUser = credential.user;
  }
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

FS.deviceIdentity = (user) => {
  const deviceId = `${FS.appConfig.devicePrefix || "fs_dev"}-${user.uid}`;
  const visitorId = `${FS.appConfig.visitorPrefix || "fs_guest"}-${user.uid}`;
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

/* Stores the code in a short-lived authorization claim (not a customer profile;
 * the rules verify it against
 * codes/{code} on every read) and resolves who the code points at. "link"-type
 * codes are handled by the device-linking flow below instead — this only
 * resolves the read-only "view" codes. */
FS.resolveClaim = async () => {
  const code = FS.getTabCode();
  if (!code) return null;
  const user = await FS.signInAnonymous();
  const snap = await FS._db.collection("codes").doc(code).get();
  if (!snap.exists || snap.data().active === false || !snap.data().userId) return null;
  if (snap.data().type === "link") return null;
  await FS._db.collection("claims").doc(user.uid).set({
    uid: user.uid,
    code,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  const target = snap.data().userId;
  if (target === user.uid) return null;
  let displayName = null;
  try {
    const u = await FS._db.collection("users").doc(target).get();
    if (u.exists) displayName = u.data().displayName || null;
  } catch (e) { /* profile read is cosmetic */ }
  return { code, userId: target, displayName };
};

/* ---------- device linking (an invite lets a new browser join a customer's
 * profile as a full member, up to 3 devices, rather than just viewing it) --- */

FS.linkCodeKey = "fresh_snacks_link_code";

FS.getLinkCode = () => {
  const fromUrl = new URLSearchParams(location.search).get("link");
  if (fromUrl && fromUrl.trim()) {
    localStorage.setItem(FS.linkCodeKey, fromUrl.trim().toUpperCase());
  }
  return localStorage.getItem(FS.linkCodeKey) || null;
};

/* Also strips ?link= from the visible URL, not just localStorage - since
 * getLinkCode() re-derives the code from the URL on every call, leaving the
 * param in place meant a plain reload of this same tab (e.g. right after
 * de-linking) would immediately re-discover the code and re-run the whole
 * accept flow, silently linking the browser right back to the same tab. */
FS.clearLinkCode = () => {
  localStorage.removeItem(FS.linkCodeKey);
  if (typeof history !== "undefined" && new URLSearchParams(location.search).has("link")) {
    const url = new URL(location.href);
    url.searchParams.delete("link");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
};

/* This browser's "effective" identity: its own uid normally, or the primary
 * profile's uid once this browser has joined via an invite link. Cached in
 * localStorage after joining, so this is a plain read with no extra
 * round-trip once linked.
 *
 * Self-heals if the admin has since removed this device from the target's
 * linkedUids (the Devices panel's "remove" action only ever touches the
 * server - it has no way to reach into this browser's own localStorage - so
 * without this check a removed device would keep treating itself as linked
 * forever). Verified once per page load and cached for the rest of it. */
FS._linkVerifyPromise = null;

FS.getEffectiveUser = async () => {
  const user = await FS.signInAnonymous();
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  if (!linkedTo || linkedTo === user.uid) return { uid: user.uid, effectiveUid: user.uid, linked: false };

  if (!FS._linkVerifyPromise) {
    FS._linkVerifyPromise = FS._db.collection("users").doc(linkedTo).get()
      .then((snap) => snap.exists && (snap.data().linkedUids || []).includes(user.uid))
      // a genuine removal surfaces as permission-denied (isLinkedMember no
      // longer holds); anything else (offline, a transient blip) fails open
      // so a network hiccup can never silently kick a device off its tab
      .catch((e) => !(e && e.code === "permission-denied"));
  }
  if (!(await FS._linkVerifyPromise)) {
    localStorage.removeItem(FS.appConfig.storageKeys.linkedTo);
    return { uid: user.uid, effectiveUid: user.uid, linked: false };
  }
  return { uid: user.uid, effectiveUid: linkedTo, linked: true };
};

FS.isThisBrowserLinked = () => {
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  return !!(linkedTo && linkedTo !== FS.currentUser?.uid);
};

/* Joins this browser to the profile a pending ?link= invite points at.
 * Capped at 3 linked devices per profile (enforced by firestore.rules, not
 * just this check). Safe to call again for an invite already joined. */
FS.acceptLinkInvite = async () => {
  const code = FS.getLinkCode();
  if (!code) throw new Error("No invite link found.");
  const user = await FS.signInAnonymous();
  const codeSnap = await FS._db.collection("codes").doc(code).get();
  if (!codeSnap.exists || codeSnap.data().active === false || codeSnap.data().type !== "link" || !codeSnap.data().userId) {
    FS.clearLinkCode();
    throw new Error("This invite link is no longer valid.");
  }
  const targetUid = codeSnap.data().userId;
  if (targetUid === user.uid) {
    FS.clearLinkCode();
    return { alreadySelf: true };
  }

  // Switching to a different tab than whatever this browser was already
  // linked to (e.g. testing several invite links from one browser) - drop
  // the old link first so this device doesn't linger as a phantom slot on
  // it, taking up one of its 3 device slots forever.
  const priorLinkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  if (priorLinkedTo && priorLinkedTo !== user.uid && priorLinkedTo !== targetUid) {
    await FS._db.collection("users").doc(priorLinkedTo).update({
      linkedUids: firebase.firestore.FieldValue.arrayRemove(user.uid),
    }).catch(() => {});
  }

  await FS._db.collection("claims").doc(user.uid).set({
    uid: user.uid,
    code,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  const targetRef = FS._db.collection("users").doc(targetUid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) throw new Error("That tab no longer exists.");
  const linked = targetSnap.data().linkedUids || [];
  if (!linked.includes(user.uid)) {
    if (linked.length >= 3) throw new Error("This tab already has the maximum of 3 linked devices.");
    await targetRef.update({ linkedUids: firebase.firestore.FieldValue.arrayUnion(user.uid) });
  }
  localStorage.setItem(FS.appConfig.storageKeys.linkedTo, targetUid);
  FS.clearLinkCode();
  return { userId: targetUid, displayName: targetSnap.data().displayName || FS.appConfig.anonUserPrefix || "Guest" };
};

/* Self-service: forget this browser's link and return it to being its own
 * separate guest identity. Only removes this browser, never other devices. */
FS.unlinkDevice = async () => {
  const user = await FS.signInAnonymous();
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  if (!linkedTo || linkedTo === user.uid) return;
  await FS._db.collection("users").doc(linkedTo).update({
    linkedUids: firebase.firestore.FieldValue.arrayRemove(user.uid),
  });
  await FS._db.collection("claims").doc(user.uid).delete().catch(() => {});
  localStorage.removeItem(FS.appConfig.storageKeys.linkedTo);
  // also drop any invite code still sitting in the URL/localStorage - without
  // this, a reload right after de-linking (common if the invite link is
  // still the page's own address) would silently re-link this browser
  // right back to the tab it just left.
  FS.clearLinkCode();
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

FS.submitFeedback = async ({ firstName, lastName, email, phone, category, amount, requestedSnack, contactConsent, message }) => {
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
    contactConsent: !!phone && !!contactConsent,
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
  const restored = await FS.restoreSession();
  if (!restored) return { userId: null, vipStatus: "anonymous" };
  const eff = await FS.getEffectiveUser();
  const snap = await FS._db.collection("users").doc(eff.effectiveUid).get();
  return { userId: eff.effectiveUid, vipStatus: "anonymous", ...(snap.exists ? snap.data() : {}) };
};

/* Users start as an anonymous guest profile. Adding a name (and optionally
 * email/phone) is opt-in; leaving the name blank keeps the guest identity.
 * Writes to the effective profile, so a linked device edits the shared tab. */
FS.updateMyProfile = async (fields) => {
  const restored = await FS.restoreSession();
  if (!restored) throw new Error("Start a tab before saving a profile.");
  const eff = await FS.getEffectiveUser();
  const existing = await FS._db.collection("users").doc(eff.effectiveUid).get();
  if (!existing.exists) throw new Error("Start a tab before saving a profile.");
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
  await FS._db.collection("users").doc(eff.effectiveUid).set(payload, { merge: true });
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

FS.favoriteSnack = (data) => {
  const totals = new Map();
  for (const entry of data.entries || []) {
    if (!entry || entry.userStatus === "disputed") continue;
    const name = FS.entryName(data, entry);
    const key = entry.snackId || `name:${String(name).trim().toLowerCase()}`;
    const current = totals.get(key) || {
      snackId: entry.snackId || null,
      name,
      spend: 0,
      count: 0,
      lastDate: null,
    };
    current.spend += Number(entry.value || 0);
    current.count += Number(entry.count || 0);
    if (entry.date && (!current.lastDate || entry.date > current.lastDate)) current.lastDate = entry.date;
    totals.set(key, current);
  }

  const favorite = [...totals.values()].sort((a, b) =>
    b.spend - a.spend || b.count - a.count || String(a.name).localeCompare(String(b.name))
  )[0] || null;
  if (!favorite) return null;
  return { ...favorite, snack: favorite.snackId ? FS.snackById(data, favorite.snackId) : null };
};

FS.entryPillClass = (data, entry) => {
  const s = entry.snackId ? FS.snackById(data, entry.snackId) : null;
  return s && s.style !== "other" ? "snack-pill" : "snack-pill other-pill";
};

FS.getOwnTransactions = async () => {
  const eff = await FS.getEffectiveUser();
  // filtered by userId (not uid) to match what the transactions read rule's
  // claim/link check inspects — Firestore rejects a list query whose filter
  // field doesn't align with what the security rule reads, even though uid
  // and userId are always equal on every transaction doc in this schema.
  const snap = await FS._db.collection("transactions")
    .where("userId", "==", eff.effectiveUid)
    .where("status", "==", "active")
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

FS.getOwnPayments = async () => {
  const eff = await FS.getEffectiveUser();
  const snap = await FS._db.collection("payments")
    .where("userId", "==", eff.effectiveUid)
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

/* Tab-member verdict on a listing: "agreed", "disputed", or null to clear
 * back to neutral. Rules restrict customer writes to verdict/date fields. */
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

FS.setEntryDate = async (transactionId, createdDate) => {
  await FS.signInAnonymous();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate || "")) throw new Error("Choose a valid date.");
  await FS._db.collection("transactions").doc(transactionId).update({
    createdDate,
    dateEditedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

FS.toPayment = (p) => ({
  id: p.paymentId || p.id,
  date: p.createdDate || null,
  amount: Number(p.amount || 0),
  note: p.note || "",
});

FS.loadData = async () => {
  // Public browsing is account-free: restore an existing session if this
  // browser already owns a tab, but never create Auth or Firestore records.
  const user = await FS.restoreSession();
  const [profile, catalog] = await Promise.all([FS.getSettings(), FS.getCatalog()]);
  if (!user && !FS.getTabCode()) {
    return { profile, catalog, claim: null, entries: [], payments: [] };
  }
  const claim = FS.getTabCode() ? await FS.resolveClaim().catch(() => null) : null;
  if (!user && !claim) {
    return { profile, catalog, claim: null, entries: [], payments: [] };
  }
  const [transactions, payments] = await Promise.all([FS.getOwnTransactions(), FS.getOwnPayments()]);
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
  // A customer dispute removes the listing from that customer's history and
  // balance immediately. The document remains active so admins can review,
  // correct, approve, void, or permanently delete it.
  entries = entries.filter((entry) => entry.userStatus !== "disputed");
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
  const validItems = (items || []).map((item) => {
    const snack = item.snack || item;
    const quantity = Number(item.qty || item.quantity || 1);
    return { snack, quantity };
  }).filter(({ snack, quantity }) => snack && snack.id && quantity > 0 && Number(snack.price || 0) > 0);
  if (!validItems.length) throw new Error("Choose at least one priced snack.");

  const user = await FS.signInAnonymous();
  const device = FS.deviceIdentity(user);
  const eff = await FS.getEffectiveUser();
  const batch = FS._db.batch();
  const today = FS.todayISO();
  const now = firebase.firestore.FieldValue.serverTimestamp();
  const deviceRef = FS._db.collection("devices").doc(device.deviceId);
  batch.set(deviceRef, {
    deviceId: device.deviceId,
    uid: user.uid,
    visitorId: device.visitorId,
    userId: eff.effectiveUid,
    deviceLabel: FS.deviceLabel(),
    status: "active",
    lastSeenAt: now,
    userAgentBrief: FS.userAgentBrief(),
    source: "web",
  }, { merge: true });

  const userRef = FS._db.collection("users").doc(eff.effectiveUid);
  const userSnap = await userRef.get();
  const userBase = {
    userId: eff.effectiveUid,
    uid: eff.effectiveUid,
    lastSeenAt: now,
    linkedDevices: firebase.firestore.FieldValue.arrayUnion(device.deviceId),
  };
  if (userSnap.exists) {
    batch.set(userRef, userBase, { merge: true });
  } else {
    batch.set(userRef, {
      ...userBase,
      displayName: `${FS.appConfig.anonUserPrefix || "Guest"} ${FS.randomCode(4)}`,
      vipStatus: "anonymous",
      email: null,
      phone: null,
      favoriteSnackId: null,
      createdAt: now,
    });
  }
  const saved = [];
  for (const { snack, quantity } of validItems) {
    const transactionId = FS.uid("fs_txn");
    const ref = FS._db.collection("transactions").doc(transactionId);
    const record = {
      transactionId,
      uid: eff.effectiveUid,
      userId: eff.effectiveUid,
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
  await batch.commit();
  localStorage.setItem(FS.appConfig.storageKeys.deviceId, device.deviceId);
  localStorage.setItem(FS.appConfig.storageKeys.visitorId, device.visitorId);
  localStorage.setItem("fresh_snacks_device_started", "1");
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
