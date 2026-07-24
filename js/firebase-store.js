/* Fresh Snacks data layer - client for the Cloud Functions REST API.
 *
 * Every function here keeps its original name/signature/return shape from
 * the pre-migration version (which called Firestore directly from the
 * browser). Only the *implementation* changed: each one now calls the API
 * in functions/ instead of touching Firestore/Storage itself. Firebase Auth
 * stays exactly as it was - the browser still signs in (anonymously for
 * customers, via Google/Microsoft/email for admins) and the API verifies
 * that same ID token on every request.
 */

const FS = window.FS || {};
window.FS = FS;

FS.appConfig = window.FS_APP_CONFIG || {};
FS.firebaseConfig = window.FS_FIREBASE_CONFIG || {};
FS._ready = null;
FS._auth = null;
FS.currentUser = null;
FS.currentDevice = null;
FS.firebaseConfigStorageKey = "fresh_snacks_firebase_config";

// Local dev serves the site itself over http://127.0.0.1:8800 (see this
// repo's established test pattern) and points at the local API test
// server; everywhere else (GitHub Pages) talks to the real deployed API.
FS.apiBase = /^(127\.0\.0\.1|localhost)$/.test(location.hostname)
  ? "http://127.0.0.1:5050"
  : "https://us-central1-fresh-snacks-ee79f.cloudfunctions.net/api";

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

/* Every authenticated API call needs the current Firebase ID token - this
 * is the one thing that replaces "the browser has a live Firestore/Auth
 * SDK session" from the pre-API version. Anonymous calls simply omit it. */
FS._idToken = async () => {
  if (!FS._auth || !FS._auth.currentUser) return null;
  return FS._auth.currentUser.getIdToken();
};

FS._apiFetch = async (path, { method = "GET", body, auth = true, query } = {}) => {
  const url = new URL(`${FS.apiBase}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = await FS._idToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status}).`);
    error.status = res.status;
    error.code = data && data.code;
    throw error;
  }
  return data;
};

FS.uid = (prefix) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

FS.randomCode = (len = 4) =>
  Math.random().toString(36).slice(2, 2 + len).toUpperCase();

// A profile counts as "opened" once it was explicitly marked complete,
// created by an admin, or already contains the real name/contact fields the
// Open-a-Tab flow collects. The field-based fallback keeps older profiles
// from being treated as brand-new merely because they predate `nameSet`.
// POST /store/transactions mirrors this exact compatibility rule.
FS.profileComplete = (profile) => !!(profile && (
  profile.nameSet === true
  || profile.createdByAdmin
  || ((profile.displayName || `${profile.firstName || ""} ${profile.lastName || ""}`.trim())
    && profile.email
    && profile.phone)
));

// One source of truth for visitor versus active-tab presentation. The API
// also marks older profiles with recorded activity as active tabs even when
// they predate today's profile-completion fields.
FS.hasActiveTab = (profile) => !!(
  profile
  && profile.vipStatus !== "feedback"
  && (profile.hasTab === true || FS.profileComplete(profile))
);

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

FS.greySilhouette =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
  "<rect width='64' height='64' fill='%23d8ded9'/>" +
  "<circle cx='32' cy='25' r='12' fill='%23a9b3ac'/>" +
  "<path d='M10 58c0-13 10-21 22-21s22 8 22 21' fill='%23a9b3ac'/>" +
  "</svg>";

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

FS.getTabCode = () => {
  const fromUrl = new URLSearchParams(location.search).get("code");
  if (fromUrl && fromUrl.trim()) {
    localStorage.setItem(FS.tabCodeKey, fromUrl.trim().toUpperCase());
  }
  return localStorage.getItem(FS.tabCodeKey) || null;
};

FS.clearTabCode = () => localStorage.removeItem(FS.tabCodeKey);

FS.resolveClaim = async () => {
  const code = FS.getTabCode();
  if (!code) return null;
  await FS.signInAnonymous();
  return FS._apiFetch("/store/claim/resolve", { method: "POST", body: { code } });
};

/* ---------- device linking ---------- */

FS.linkCodeKey = "fresh_snacks_link_code";
FS.inviteCookieKey = "fresh_snacks_invite";

FS.setInviteCookie = (code) => {
  const value = String(code || "").trim().toUpperCase();
  if (!value) return;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${FS.inviteCookieKey}=${encodeURIComponent(value)}; Max-Age=2592000; Path=/; SameSite=Lax${secure}`;
};

FS.getRememberedInviteCode = () => {
  const prefix = `${FS.inviteCookieKey}=`;
  const part = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)).trim().toUpperCase() : null;
};

FS.forgetInviteCode = () => {
  document.cookie = `${FS.inviteCookieKey}=; Max-Age=0; Path=/; SameSite=Lax`;
  localStorage.removeItem(FS.linkCodeKey);
};

FS.getLinkCode = () => {
  const fromUrl = new URLSearchParams(location.search).get("link");
  if (fromUrl && fromUrl.trim()) {
    const code = fromUrl.trim().toUpperCase();
    localStorage.setItem(FS.linkCodeKey, code);
    FS.setInviteCookie(code);
  }
  return localStorage.getItem(FS.linkCodeKey) || null;
};

FS.clearLinkCode = () => {
  localStorage.removeItem(FS.linkCodeKey);
  if (typeof history !== "undefined" && new URLSearchParams(location.search).has("link")) {
    const url = new URL(location.href);
    url.searchParams.delete("link");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
};

/* ---------- referral tracking ---------- */

// A ?ref=<uid> from the "Tell a Friend" QR (a real Firebase uid, so unlike
// FS.getLinkCode this is case-sensitive and never uppercased) - captured
// once on load and carried through to the eventual "Open a tab" submit.
FS.referralCodeKey = "fresh_snacks_referral_code";

FS.getReferralCode = () => {
  const fromUrl = new URLSearchParams(location.search).get("ref");
  if (fromUrl && fromUrl.trim()) {
    localStorage.setItem(FS.referralCodeKey, fromUrl.trim());
  }
  return localStorage.getItem(FS.referralCodeKey) || null;
};

FS.clearReferralCode = () => {
  localStorage.removeItem(FS.referralCodeKey);
  if (typeof history !== "undefined" && new URLSearchParams(location.search).has("ref")) {
    const url = new URL(location.href);
    url.searchParams.delete("ref");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
};

FS.signOutCustomer = async () => {
  await FS.initFirebase();
  // A linked browser must release its server-side membership before its
  // Firebase identity is discarded, otherwise it would continue occupying
  // one of the profile's three device slots with no way to use that uid.
  if (localStorage.getItem(FS.appConfig.storageKeys.linkedTo)
    || localStorage.getItem(FS.appConfig.storageKeys.sessionTo)) {
    await FS.unlinkDevice();
  }
  await FS._auth.signOut();
  FS.currentUser = null;
  FS.currentDevice = null;
  FS._sessionReady = null;
  [
    FS.appConfig.storageKeys.uid,
    FS.appConfig.storageKeys.deviceId,
    FS.appConfig.storageKeys.visitorId,
    FS.appConfig.storageKeys.linkedTo,
    FS.appConfig.storageKeys.sessionTo,
    "fresh_snacks_device_started",
    "fresh_snacks_profile_active",
    FS.tabCodeKey,
    FS.linkCodeKey,
    FS.referralCodeKey,
  ].filter(Boolean).forEach((key) => localStorage.removeItem(key));
};

/* This browser's "effective" identity - its own uid normally, or the
 * primary profile's uid once linked. The API re-verifies the link on
 * every call that passes effectiveUid (never trusted blindly server-
 * side), so this client-side function just reports what's in
 * localStorage optimistically; any actually-revoked link self-heals the
 * moment a real data call reveals the server fell back to the own uid
 * (see FS.getMyProfile). */
FS.getEffectiveUser = async () => {
  const user = await FS.signInAnonymous();
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  const sessionTo = localStorage.getItem(FS.appConfig.storageKeys.sessionTo);
  const effectiveUid = linkedTo || sessionTo;
  if (!effectiveUid || effectiveUid === user.uid) return { uid: user.uid, effectiveUid: user.uid, linked: false, session: false };
  return { uid: user.uid, effectiveUid, linked: !!linkedTo, session: !!sessionTo };
};

FS.isThisBrowserLinked = () => {
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  return !!(linkedTo && linkedTo !== FS.currentUser?.uid);
};

FS.acceptLinkInvite = async () => {
  const code = FS.getLinkCode();
  if (!code) throw new Error("No invite link found.");
  await FS.signInAnonymous();
  const priorLinkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  const result = await FS._apiFetch("/store/link/accept", { method: "POST", body: { code, priorLinkedTo } });
  if (!result.alreadySelf) {
    localStorage.setItem(FS.appConfig.storageKeys.linkedTo, result.userId);
    localStorage.removeItem(FS.appConfig.storageKeys.sessionTo);
  }
  FS.clearLinkCode();
  return result;
};

FS.loginWithInvite = async (code = FS.getRememberedInviteCode()) => {
  const invite = String(code || "").trim().toUpperCase();
  if (!invite) throw new Error("No saved invite was found on this browser.");
  await FS.signInAnonymous();
  let result;
  try {
    result = await FS._apiFetch("/store/link/accept", {
      method: "POST",
      body: {
        code: invite,
        priorLinkedTo: localStorage.getItem(FS.appConfig.storageKeys.linkedTo),
      },
    });
    if (!result.alreadySelf) {
      localStorage.setItem(FS.appConfig.storageKeys.linkedTo, result.userId);
      localStorage.removeItem(FS.appConfig.storageKeys.sessionTo);
    }
  } catch (error) {
    if (error.code !== "device-limit") throw error;
    result = await FS._apiFetch("/store/link/session", { method: "POST", body: { code: invite } });
    if (!result.alreadySelf) {
      localStorage.setItem(FS.appConfig.storageKeys.sessionTo, result.userId);
      localStorage.removeItem(FS.appConfig.storageKeys.linkedTo);
    }
  }
  FS.setInviteCookie(invite);
  FS.clearLinkCode();
  return result;
};

FS.unlinkDevice = async () => {
  await FS.signInAnonymous();
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo)
    || localStorage.getItem(FS.appConfig.storageKeys.sessionTo);
  if (!linkedTo) return;
  await FS._apiFetch("/store/link/unlink", { method: "POST", body: { linkedTo } });
  localStorage.removeItem(FS.appConfig.storageKeys.linkedTo);
  localStorage.removeItem(FS.appConfig.storageKeys.sessionTo);
  FS.clearLinkCode();
};

FS.getUserTransactions = async (userId) => FS._apiFetch("/store/user-transactions", { query: { userId } });
FS.getUserPayments = async (userId) => FS._apiFetch("/store/user-payments", { query: { userId } });

/* ---------- feedback ---------- */

FS.feedbackCategories = [
  { id: "question", label: "A question" },
  { id: "concern", label: "A concern" },
  { id: "change", label: "Request a change" },
  { id: "snack", label: "Request a snack" },
  { id: "credit", label: "Request credit" },
  { id: "other", label: "Something else" },
];

FS.submitFeedback = async (fields) => {
  await FS.signInAnonymous();
  return FS._apiFetch("/store/feedback", { method: "POST", body: fields });
};

/* ---------- user identity ---------- */

FS.getMyProfile = async () => {
  const restored = await FS.restoreSession();
  if (!restored) return { userId: null, vipStatus: "anonymous" };
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  const sessionTo = localStorage.getItem(FS.appConfig.storageKeys.sessionTo);
  const expected = linkedTo || sessionTo;
  const profile = await FS._apiFetch("/store/profile", { query: expected ? { effectiveUid: expected } : undefined });
  // Self-heal: if we asked for a linked profile but the server fell back to
  // our own uid (the link was revoked server-side since we last checked),
  // forget the stale link locally too - mirrors the old client-side
  // isLinkedMember() re-check that used to run on every page load.
  if (expected && profile.userId !== expected) {
    localStorage.removeItem(FS.appConfig.storageKeys.linkedTo);
    localStorage.removeItem(FS.appConfig.storageKeys.sessionTo);
  } else if (!expected && profile.userId && profile.userId !== restored.uid) {
    // Recover a known linked browser whose local `linkedTo` marker was lost
    // while its authenticated uid is still an active member of the profile.
    // The API only resolves this way from a verified active link claim plus
    // target membership, so a view-only code can never become a device link.
    const key = profile.accessMode === "session"
      ? FS.appConfig.storageKeys.sessionTo
      : FS.appConfig.storageKeys.linkedTo;
    localStorage.setItem(key, profile.userId);
  }
  return profile;
};

FS.updateMyProfile = async (fields) => {
  await FS.getEffectiveUser();
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo);
  const sessionTo = localStorage.getItem(FS.appConfig.storageKeys.sessionTo);
  return FS._apiFetch("/store/profile", {
    method: "PATCH",
    body: { ...fields, effectiveUid: linkedTo || sessionTo || undefined },
  });
};

FS.getSettings = async () => FS._apiFetch("/store/settings", { auth: false });

FS.bundledSnackArtwork = {
  chewy: { photo: "assets/chewy.jpg", favoritePhoto: "assets/chewy-background.webp" },
  "kiss-banana-bread": { photo: "assets/kiss-banana-bread.webp", favoritePhoto: "assets/kiss-banana-bread-background.webp" },
  "kiss-brownie-rich-dark-chocolate": { photo: "assets/kiss-brownie.webp", favoritePhoto: "assets/kiss-brownie-background.webp" },
  oreo: { photo: "assets/oreo.webp", favoritePhoto: "assets/oreo-background.webp" },
};

FS.withBundledSnackArtwork = (snack) => {
  const bundled = FS.bundledSnackArtwork[snack.id] || {};
  return {
    ...snack,
    photo: snack.photo || bundled.photo || null,
    favoritePhoto: snack.favoritePhoto || bundled.favoritePhoto || null,
  };
};

FS.defaultSnackOrder = ["oreo", "banana-chips", "plantain-chips"];

FS.compareSnackOrder = (a, b) => {
  const explicitA = a.displayOrder != null && Number.isFinite(Number(a.displayOrder)) ? Number(a.displayOrder) : null;
  const explicitB = b.displayOrder != null && Number.isFinite(Number(b.displayOrder)) ? Number(b.displayOrder) : null;
  const defaultA = FS.defaultSnackOrder.indexOf(a.id);
  const defaultB = FS.defaultSnackOrder.indexOf(b.id);
  const orderA = explicitA ?? (defaultA >= 0 ? defaultA : 1000);
  const orderB = explicitB ?? (defaultB >= 0 ? defaultB : 1000);
  return orderA - orderB || String(a.name || "").localeCompare(String(b.name || ""));
};

FS.getCatalog = async (includeInactive = false) =>
  FS._apiFetch("/store/catalog", { auth: false, query: { includeInactive: includeInactive ? "true" : undefined } });

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
  return FS.getUserTransactions(eff.effectiveUid);
};

FS.getOwnPayments = async () => {
  const eff = await FS.getEffectiveUser();
  return FS.getUserPayments(eff.effectiveUid);
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

FS.setEntryStatus = async (transactionId, verdict) => {
  await FS.signInAnonymous();
  await FS._apiFetch(`/store/transactions/${encodeURIComponent(transactionId)}/status`, {
    method: "PATCH", body: { verdict },
  });
};

FS.setEntryDate = async (transactionId, createdDate) => {
  await FS.signInAnonymous();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate || "")) throw new Error("Choose a valid date.");
  await FS._apiFetch(`/store/transactions/${encodeURIComponent(transactionId)}/date`, {
    method: "PATCH", body: { createdDate },
  });
};

FS.toPayment = (p) => ({
  id: p.paymentId || p.id,
  date: p.createdDate || null,
  amount: Number(p.amount || 0),
  note: p.note || "",
});

FS.loadData = async () => {
  const user = await FS.restoreSession();
  const tabCode = FS.getTabCode();
  if (!user && !tabCode) {
    const [profile, catalog] = await Promise.all([FS.getSettings(), FS.getCatalog()]);
    return { profile, catalog, claim: null, entries: [], payments: [] };
  }
  if (tabCode) await FS.signInAnonymous();
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo)
    || localStorage.getItem(FS.appConfig.storageKeys.sessionTo);
  // Note: unlike FS.getMyProfile, this response doesn't echo back which uid
  // it actually resolved effectiveUid to, so a revoked link isn't self-
  // healed from here - startTabFlow() always calls FS.getMyProfile() too
  // on every page load, and that's where the self-heal actually happens.
  return FS._apiFetch("/store/data", {
    query: { tabCode: tabCode || undefined, effectiveUid: linkedTo || undefined },
  });
};

FS.addTransaction = async (items) => {
  const validItems = (items || []).map((item) => {
    const snack = item.snack || item;
    const quantity = Number(item.qty || item.quantity || 1);
    return { snack, quantity };
  }).filter(({ snack, quantity }) => snack && snack.id && quantity > 0 && Number(snack.price || 0) > 0);
  if (!validItems.length) throw new Error("Choose at least one priced snack.");

  await FS.signInAnonymous();
  const linkedTo = localStorage.getItem(FS.appConfig.storageKeys.linkedTo)
    || localStorage.getItem(FS.appConfig.storageKeys.sessionTo);
  const saved = await FS._apiFetch("/store/transactions", {
    method: "POST",
    body: {
      items: validItems,
      effectiveUid: linkedTo || undefined,
      deviceLabel: FS.deviceLabel(),
    },
  });
  const device = FS.deviceIdentity(FS.currentUser);
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
