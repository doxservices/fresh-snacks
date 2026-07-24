/* Fresh Snacks admin data layer - client for the Cloud Functions REST API.
 *
 * Same approach as js/firebase-store.js: every function keeps its original
 * name/signature/return shape, only the implementation changed to call
 * /admin/* endpoints instead of Firestore/Storage directly. Sign-in stays
 * real Firebase Auth (Google/Microsoft/email); FS.admin.requireAdmin() now
 * asks the API to confirm admin authority instead of reading /admins/{uid}
 * itself (the API re-checks that on every request regardless). */

FS.admin = {
  user: null,
  profile: null,
};

FS.admin._persistenceReady = null;
FS.admin._ensurePersistence = async () => {
  await FS.initFirebase();
  if (!FS.admin._persistenceReady) {
    FS.admin._persistenceReady = FS._auth
      .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch((error) => {
        FS.admin._persistenceReady = null;
        throw error;
      });
  }
  return FS.admin._persistenceReady;
};

FS.admin.signInWithGoogle = async () => {
  await FS.admin._ensurePersistence();
  const provider = new firebase.auth.GoogleAuthProvider();
  const result = await FS._auth.signInWithPopup(provider);
  FS.admin.user = result.user;
  return FS.admin.requireAdmin();
};

FS.admin.signInWithMicrosoft = async () => {
  await FS.admin._ensurePersistence();
  const provider = new firebase.auth.OAuthProvider("microsoft.com");
  provider.setCustomParameters({ tenant: "common" });
  const result = await FS._auth.signInWithPopup(provider);
  FS.admin.user = result.user;
  return FS.admin.requireAdmin();
};

FS.admin.signInWithEmail = async (email, password) => {
  await FS.admin._ensurePersistence();
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
  try {
    const profile = await FS._apiFetch("/admin/whoami");
    FS.admin.user = user;
    FS.admin.profile = profile;
    return profile;
  } catch (e) {
    await FS._auth.signOut();
    throw new Error("This Firebase user is not active in /admins.");
  }
};

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
  await FS.admin._ensurePersistence();
  await FS.admin._waitForAuthRestore();
  const user = FS._auth.currentUser;
  if (user && !user.isAnonymous) return FS.admin.requireAdmin();
  return null;
};

FS.admin.getSnapshot = async () => FS._apiFetch("/admin/snapshot");

FS.admin.setFeedbackStatus = async (id, status) => {
  await FS._apiFetch(`/admin/feedback/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status } });
};

/* Firestore Timestamps arrive here JSON-serialized (Express turns a
 * Timestamp into a plain {_seconds, _nanoseconds} object, not a Timestamp
 * instance) - this no longer has a .toDate() method, so this needs its own
 * client-side conversion rather than the server-side version's check. */
FS.admin.dateFromRecord = (record, field) => {
  const value = record && record[field];
  if (value && typeof value._seconds === "number") {
    return new Date(value._seconds * 1000).toISOString().slice(0, 10);
  }
  if (value && typeof value.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  return "";
};

FS.admin.maxDate = (a, b) => (String(a || "") > String(b || "") ? a : b);

FS.admin.createLinkInvite = async (userId) => {
  const { code } = await FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}/link-invite`, { method: "POST" });
  return code;
};

FS.admin.getLinkedDevicesInfo = async (userId) =>
  FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}/linked-devices`);

FS.admin.unlinkUserDevice = async (userId, deviceUid) => {
  await FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}/linked-devices/${encodeURIComponent(deviceUid)}`, { method: "DELETE" });
};

FS.admin.addPayment = async ({ userId, amount, note }) => {
  await FS._apiFetch("/admin/payments", { method: "POST", body: { userId, amount, note } });
};

FS.admin.addAdjustment = async ({ userId, amount, reason }) => {
  await FS._apiFetch("/admin/adjustments", { method: "POST", body: { userId, amount, reason } });
};

FS.admin.resolveTransaction = async (id) => {
  await FS._apiFetch(`/admin/transactions/${encodeURIComponent(id)}/resolve`, { method: "POST" });
};

FS.admin.updateTransaction = async (id, { quantity, createdDate }) => {
  await FS._apiFetch(`/admin/transactions/${encodeURIComponent(id)}`, {
    method: "PATCH", body: { quantity, createdDate },
  });
};

FS.admin.mergeOrMoveTransaction = async (sourceId, targetId) =>
  FS._apiFetch(`/admin/transactions/${encodeURIComponent(sourceId)}/merge-or-move`, {
    method: "POST", body: { targetId },
  });

FS.admin.voidTransaction = async (id) => {
  await FS._apiFetch(`/admin/transactions/${encodeURIComponent(id)}/void`, { method: "POST" });
};

FS.admin.voidPayment = async (id) => {
  await FS._apiFetch(`/admin/payments/${encodeURIComponent(id)}/void`, { method: "POST" });
};

FS.admin.deletePayment = async (id) => {
  await FS._apiFetch(`/admin/payments/${encodeURIComponent(id)}`, { method: "DELETE" });
};

FS.admin.recordPermanentPayment = async ({ userId, amount, note, createdDate }) =>
  FS._apiFetch("/admin/payments/permanent", { method: "POST", body: { userId, amount, note, createdDate } });

FS.admin.setTransactionReviewStatus = async (id, reviewStatus) => {
  await FS._apiFetch(`/admin/transactions/${encodeURIComponent(id)}/review-status`, {
    method: "PATCH", body: { reviewStatus },
  });
};

FS.admin.deleteTransaction = async (id) => {
  await FS._apiFetch(`/admin/transactions/${encodeURIComponent(id)}`, { method: "DELETE" });
};

FS.admin.deleteUserData = async (userId) => {
  const { count } = await FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}/data`, { method: "DELETE" });
  return count;
};

FS.admin.getUserTransactionHistory = async (userId) =>
  FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}/transaction-history`);

FS.admin.getUserAdjustments = async (userId) =>
  FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}/adjustments`);

FS.admin.addInventory = async ({ snackId, quantity, note }) => {
  await FS._apiFetch("/admin/inventory-ledger", { method: "POST", body: { snackId, quantity, note } });
};

FS.admin.getInventorySnapshot = async () => FS._apiFetch("/admin/inventory-snapshot");

FS.admin.saveSnack = async (snack) => {
  const id = snack.id || String(snack.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (!id) throw new Error("Snack name is required.");
  await FS._apiFetch(`/admin/snacks/${encodeURIComponent(id)}`, { method: "PUT", body: { ...snack, id } });
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

FS.admin.getBinsSnapshot = async (options = {}) =>
  FS._apiFetch("/admin/bins-snapshot", { query: options.source ? { source: options.source } : undefined });

FS.admin.saveBin = async (bin) => {
  const path = bin.id ? `/admin/bins/${encodeURIComponent(bin.id)}` : "/admin/bins";
  const { id } = await FS._apiFetch(path, { method: "PUT", body: bin });
  return id;
};

FS.admin.deleteBin = async (id) => {
  if (!id) throw new Error("Choose a basket to delete.");
  await FS._apiFetch(`/admin/bins/${encodeURIComponent(id)}`, { method: "DELETE" });
};

FS.admin.renameBinFloor = async (currentFloor, nextFloor) => {
  const { count } = await FS._apiFetch("/admin/bin-floors/rename", { method: "POST", body: { currentFloor, nextFloor } });
  return count;
};

FS.admin.duplicateBinFloor = async (sourceFloor, targetFloor) => {
  const { count } = await FS._apiFetch("/admin/bin-floors/duplicate", { method: "POST", body: { sourceFloor, targetFloor } });
  return count;
};

FS.admin.deleteBinFloor = async (floorName) => {
  const { count } = await FS._apiFetch("/admin/bin-floors/delete", { method: "POST", body: { floorName } });
  return count;
};

FS.admin.saveBinOrder = async (binIds) => {
  await FS._apiFetch("/admin/bins/order", { method: "POST", body: { binIds } });
};

FS.admin.duplicateBin = async (sourceId, targetFloor, targetName) => {
  const { id } = await FS._apiFetch(`/admin/bins/${encodeURIComponent(sourceId)}/duplicate`, {
    method: "POST", body: { targetFloor, targetName },
  });
  return id;
};

FS.admin.syncBundledSnackArtwork = async () => {
  const { changed } = await FS._apiFetch("/admin/snacks/sync-bundled-artwork", { method: "POST" });
  return changed;
};

/* Unchanged from the pre-migration version - pure client-side canvas
 * downscale/re-encode, no network access at all. */
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

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

/* Posts the already-compressed image as base64 JSON (via XHR, not fetch,
 * so real upload-progress events are still available for onProgress -
 * fetch() has no equivalent for outgoing request bodies). */
FS.admin.uploadSnackImage = async (snackId, file, kind = "photo", onProgress) => {
  if (!snackId) throw new Error("Choose a snack first.");
  if (!file) throw new Error("Choose an image to upload.");
  if (!String(file.type || "").startsWith("image/")) throw new Error("Only image files can be uploaded.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Images must be 10 MB or smaller.");
  if (!["photo", "favoritePhoto"].includes(kind)) throw new Error("Unknown artwork type.");

  const { blob, contentType } = await FS.admin.prepareImageForUpload(file);
  const base64 = await blobToBase64(blob);
  const token = await FS._idToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${FS.apiBase}/admin/snacks/${encodeURIComponent(snackId)}/image`);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Upload failed - network error."));
    xhr.send(JSON.stringify({ kind, contentType, base64, filename: file.name }));
  });
};

FS.admin.saveSnackOrder = async (snackIds) => {
  await FS._apiFetch("/admin/snacks/order", { method: "POST", body: { snackIds } });
};

FS.admin.deactivateSnack = async (id) => {
  await FS._apiFetch(`/admin/snacks/${encodeURIComponent(id)}/deactivate`, { method: "POST" });
};

FS.admin.renameUser = async (userId, displayName, vipStatus) => {
  await FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { displayName, vipStatus } });
};

FS.admin.getUserProfile = async (userId) => FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}`);

FS.admin.createGuestTab = async (displayName) => {
  const { userId } = await FS._apiFetch("/admin/users", { method: "POST", body: { displayName } });
  return userId;
};

FS.admin.openAdminTestProfile = async (sourceUserId) => {
  const { url } = await FS._apiFetch("/admin/test-profile", { method: "POST", body: { sourceUserId } });
  localStorage.setItem(FS.tabCodeKey, new URLSearchParams(url.split("?")[1]).get("code"));
  return url;
};

FS.admin.addTransactionFor = async (userId, items, options = {}) =>
  FS._apiFetch(`/admin/users/${encodeURIComponent(userId)}/transactions`, {
    method: "POST", body: { items, splitQuantities: !!options.splitQuantities },
  });
