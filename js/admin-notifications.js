/* Shared admin notifications bell - fixed top-right on every admin page.
 * Covers new feedback + transactions still needing a decision (never-
 * approved admin-logged purchases, plus anything a customer has disputed).
 * Only actionable items are counted/listed; once handled in Firestore, an
 * item just drops off on its own (no resolved-history feed to maintain).
 *
 * A customer with more than AGGREGATE_THRESHOLD actionable transactions
 * collapses into a single "N items need review" row so the panel stays
 * scannable - clicking it (or any single-transaction row) jumps to
 * transactions.html, which highlights that customer's ledger group (and,
 * for a single transaction, that exact row) so the admin can't lose track
 * of what they navigated there to look at. */
(function () {
  const AGGREGATE_THRESHOLD = 5;
  const esc = (s) => FS.escapeHtml(s);
  let snapshot = null;

  function ensureMarkup() {
    if (document.getElementById("admin-notifications-bell")) return;
    const bell = document.createElement("button");
    bell.type = "button";
    bell.id = "admin-notifications-bell";
    bell.className = "admin-notifications-bell hidden";
    bell.setAttribute("aria-label", "0 notifications");
    bell.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3a5 5 0 0 0-5 5v3.2c0 .9-.35 1.77-.97 2.42L4.6 15.1c-.6.62-.17 1.65.7 1.65h13.4c.87 0 1.3-1.03.7-1.65l-1.43-1.48A3.5 3.5 0 0 1 17 11.2V8a5 5 0 0 0-5-5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><span id="admin-notifications-count" aria-hidden="true">0</span>`;
    document.body.appendChild(bell);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id = "admin-notifications-backdrop";
    backdrop.innerHTML = `<div class="modal notifications-modal" role="dialog" aria-modal="true" aria-labelledby="admin-notifications-title">
      <button type="button" class="modal-close" id="admin-notifications-close" aria-label="Close">&times;</button>
      <h2 id="admin-notifications-title">Notifications</h2>
      <div id="admin-notifications-list"></div>
    </div>`;
    document.body.appendChild(backdrop);

    bell.addEventListener("click", openPanel);
    document.getElementById("admin-notifications-close").addEventListener("click", closePanel);
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closePanel(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closePanel(); });
    document.getElementById("admin-notifications-list").addEventListener("click", onListClick);
  }

  function openPanel() {
    renderList();
    document.getElementById("admin-notifications-backdrop").classList.add("show");
  }

  function closePanel() {
    document.getElementById("admin-notifications-backdrop").classList.remove("show");
  }

  function onListClick(ev) {
    const item = ev.target.closest(".notif-item");
    if (!item) return;
    if (item.dataset.type === "feedback") {
      closePanel();
      location.href = "admin.html#feedback-list";
      return;
    }
    const params = new URLSearchParams({ user: item.dataset.user });
    if (item.dataset.txn) params.set("txn", item.dataset.txn);
    location.href = `transactions.html?${params.toString()}`;
  }

  // One row per customer with >AGGREGATE_THRESHOLD actionable transactions,
  // otherwise one row per transaction - each carries the customer's name
  // (looked up via SNAPSHOT.accounting, the same source transactions.html
  // itself uses) since a bare snack name alone isn't enough to act on.
  function notificationItems() {
    if (!snapshot) return [];
    const byUser = new Map(snapshot.accounting.map((r) => [r.userId, r]));
    const nameFor = (userId) => byUser.get(userId)?.displayName || userId || "Unknown";

    const feedbackItems = snapshot.feedback.filter((f) => f.status === "new").map((f) => ({
      type: "feedback",
      id: f.feedbackId || f.id,
      date: FS.admin.dateFromRecord(f, "createdAt"),
      name: [f.firstName, f.lastName].filter(Boolean).join(" ") || "Anonymous",
      detail: f.details != null ? f.details : (f.message || ""),
    }));

    const actionableTxns = snapshot.transactions.filter((t) => (t.reviewStatus || "neutral") === "neutral" || t.userStatus === "disputed");
    const byCustomer = new Map();
    for (const t of actionableTxns) {
      const userId = t.userId || t.uid || "unassigned";
      if (!byCustomer.has(userId)) byCustomer.set(userId, []);
      byCustomer.get(userId).push(t);
    }

    const txnItems = [];
    for (const [userId, txns] of byCustomer) {
      const mostRecent = txns.reduce((a, b) => {
        const da = a.createdDate || FS.admin.dateFromRecord(a, "createdAt");
        const db = b.createdDate || FS.admin.dateFromRecord(b, "createdAt");
        return String(db).localeCompare(String(da)) > 0 ? b : a;
      });
      const anyDisputed = txns.some((t) => t.userStatus === "disputed");
      const anyApproved = txns.some((t) => (t.reviewStatus || "neutral") === "approved");
      if (txns.length > AGGREGATE_THRESHOLD) {
        txnItems.push({
          type: "transaction-group",
          userId,
          name: nameFor(userId),
          count: txns.length,
          date: mostRecent.createdDate || FS.admin.dateFromRecord(mostRecent, "createdAt"),
          disputed: anyDisputed,
          reviewStatus: anyApproved ? "approved" : "neutral",
        });
      } else {
        for (const t of txns) {
          txnItems.push({
            type: "transaction",
            id: t.transactionId || t.id,
            userId,
            name: nameFor(userId),
            date: t.createdDate || FS.admin.dateFromRecord(t, "createdAt"),
            snackId: t.snackId,
            snackName: t.snackName,
            reviewStatus: t.reviewStatus || "neutral",
            disputed: t.userStatus === "disputed",
          });
        }
      }
    }

    return [...feedbackItems, ...txnItems].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  function statusBadge(reviewStatus) {
    return reviewStatus === "approved"
      ? `<span class="verdict-badge agreed">Approved</span>`
      : `<span class="verdict-badge needs-review">Needs your review</span>`;
  }

  function renderBadge() {
    const count = notificationItems().length;
    const bell = document.getElementById("admin-notifications-bell");
    bell.classList.toggle("hidden", count === 0);
    document.getElementById("admin-notifications-count").textContent = count;
    bell.setAttribute("aria-label", `${count} notification${count === 1 ? "" : "s"}`);
  }

  function renderList() {
    const items = notificationItems();
    const list = document.getElementById("admin-notifications-list");
    if (!items.length) {
      list.innerHTML = `<p class="muted-small">Nothing needs your attention right now.</p>`;
      return;
    }
    list.innerHTML = items.map((it) => {
      if (it.type === "feedback") {
        return `<div class="notif-item" data-type="feedback" data-id="${esc(it.id)}">
          <div class="notif-item-body">
            <div class="notif-item-title">${esc(it.name)}</div>
            <div class="muted-small">${esc(String(it.detail).slice(0, 120))}</div>
          </div>
          <div class="notif-item-meta">
            <span class="muted-small">${esc(it.date)}</span>
            <span class="verdict-badge needs-review">New feedback</span>
          </div>
        </div>`;
      }
      if (it.type === "transaction-group") {
        return `<div class="notif-item${it.disputed ? " disputed" : ""}" data-type="transaction-group" data-id="" data-user="${esc(it.userId)}">
          <div class="notif-item-photo"><span class="bin-placeholder" aria-hidden="true">&#128203;</span></div>
          <div class="notif-item-body">
            <div class="notif-item-title">${esc(it.name)}</div>
            <div class="muted-small">${it.count} items need review</div>
          </div>
          <div class="notif-item-meta">
            <span class="muted-small">${esc(it.date)}</span>
            ${statusBadge(it.reviewStatus)}
          </div>
        </div>`;
      }
      const snack = it.snackId ? snapshot.snacks.find((s) => s.id === it.snackId) : null;
      const itemName = snack ? snack.name : (it.snackName || "Item");
      return `<div class="notif-item${it.disputed ? " disputed" : ""}" data-type="transaction" data-id="${esc(it.id)}" data-txn="${esc(it.id)}" data-user="${esc(it.userId)}">
        <div class="notif-item-photo">${snack && snack.photo
          ? `<img src="${esc(snack.photo)}" alt="${esc(itemName)}" loading="lazy" />`
          : `<span class="bin-placeholder" aria-hidden="true">&#127850;</span>`}</div>
        <div class="notif-item-body">
          <div class="notif-item-title">${esc(it.name)}</div>
          <div class="muted-small">${esc(itemName)}</div>
        </div>
        <div class="notif-item-meta">
          <span class="muted-small">${esc(it.date)}</span>
          ${statusBadge(it.reviewStatus)}
        </div>
      </div>`;
    }).join("");
  }

  async function refreshSnapshot() {
    try {
      snapshot = await FS.admin.getSnapshot();
      renderBadge();
    } catch {
      // not actually an active admin (e.g. requireAdmin rejected mid-flight) - stay hidden
      snapshot = null;
      document.getElementById("admin-notifications-bell")?.classList.add("hidden");
    }
  }

  async function checkAndLoad() {
    const user = FS._auth.currentUser;
    if (!user || user.isAnonymous) {
      document.getElementById("admin-notifications-bell")?.classList.add("hidden");
      return;
    }
    try {
      await FS.admin.requireAdmin();
    } catch {
      document.getElementById("admin-notifications-bell")?.classList.add("hidden");
      return;
    }
    ensureMarkup();
    await refreshSnapshot();
  }

  async function init() {
    await FS.initFirebase().catch(() => null);
    if (!FS._auth) return; // Firebase not configured on this page load - nothing to show
    ensureMarkup();
    FS._auth.onAuthStateChanged(checkAndLoad);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.AdminNotifications = { refresh: refreshSnapshot };
})();
