/* Shared admin notifications bell - fixed top-right on every admin page.
 * Covers two different kinds of notice:
 *
 * 1. Actionable backlog - new feedback, plus transactions still needing a
 *    decision (never-approved admin-logged purchases, or anything a
 *    customer has disputed). These resolve themselves: once the underlying
 *    Firestore state actually changes (approved, read, etc.), the item
 *    just drops off on its own - no dismiss needed or offered.
 *
 * 2. Activity notices - a customer added their name, or logged a purchase
 *    themselves via the basket's "Add to tab" button. These don't have a
 *    natural "resolved" state to watch for, so per explicit product
 *    decision they show immediately (scoped to ACTIVITY_CUTOFF onward, so
 *    the entire pre-existing history doesn't flood the panel on rollout)
 *    and stay until the admin manually dismisses them (small x button,
 *    persisted in this browser's localStorage) - no auto-expiry.
 *
 * Both kinds count toward the bell's number (also an explicit decision).
 *
 * A customer with more than AGGREGATE_THRESHOLD actionable transactions
 * collapses into a single "N items need review" row so the panel stays
 * scannable - clicking it (or any single-transaction row) jumps to
 * transactions.html, which highlights that customer's ledger group (and,
 * for a single transaction, that exact row) so the admin can't lose track
 * of what they navigated there to look at. */
(function () {
  const AGGREGATE_THRESHOLD = 5;
  // Only self-service activity (naming, self-logged purchases) from this
  // point onward counts as a notification - without this, the very first
  // load after shipping this feature would flood the panel with every
  // customer who was ever named and every purchase ever self-logged.
  const ACTIVITY_CUTOFF_MS = Date.parse("2026-07-21T00:00:00Z");
  const DISMISS_STORAGE_KEY = "fresh_snacks_admin_dismissed_notifications";
  const esc = (s) => FS.escapeHtml(s);
  let snapshot = null;

  function getDismissed() {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISS_STORAGE_KEY) || "[]")); }
    catch { return new Set(); }
  }

  function dismissKey(key) {
    const set = getDismissed();
    set.add(key);
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...set]));
  }

  function timestampMs(record, field) {
    const v = record && record[field];
    return v && typeof v.toDate === "function" ? v.toDate().getTime() : 0;
  }

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

    // Its own payment modal (same fields/flow as transactions.html's) so
    // "Approve & pay" works from the panel on any page, not just
    // transactions.html - the panel commonly gets used from pages that
    // never had a payment modal of their own.
    const paymentBackdrop = document.createElement("div");
    paymentBackdrop.className = "modal-backdrop";
    paymentBackdrop.id = "admin-notifications-payment-backdrop";
    paymentBackdrop.innerHTML = `<div class="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="anp-title">
      <h2 id="anp-title">Record payment</h2>
      <p class="muted-small" id="anp-customer"></p>
      <form id="anp-form" class="payment-form">
        <input type="hidden" id="anp-user-id" />
        <div class="field"><label for="anp-amount">Amount received</label><input id="anp-amount" type="number" min="1" step="1" required /></div>
        <div class="field"><label for="anp-date">Payment date</label><input id="anp-date" type="date" required /></div>
        <div class="field"><label for="anp-note">Note <span class="muted-small">(optional)</span></label><input id="anp-note" type="text" maxlength="160" placeholder="Cash, transfer, or reference" /></div>
        <div class="modal-actions"><button type="button" id="anp-cancel">Cancel</button><button type="submit" class="primary">Review payment</button></div>
      </form>
    </div>`;
    document.body.appendChild(paymentBackdrop);

    bell.addEventListener("click", openPanel);
    document.getElementById("admin-notifications-close").addEventListener("click", closePanel);
    backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) closePanel(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closePanel(); closeEmbeddedPaymentModal(); } });
    document.getElementById("admin-notifications-list").addEventListener("click", onListClick);

    document.getElementById("anp-cancel").addEventListener("click", closeEmbeddedPaymentModal);
    paymentBackdrop.addEventListener("click", (ev) => { if (ev.target === paymentBackdrop) closeEmbeddedPaymentModal(); });
    document.getElementById("anp-form").addEventListener("submit", onPaymentSubmit);
  }

  function openEmbeddedPaymentModal(userId, amount, note) {
    const info = snapshot.accounting.find((r) => r.userId === userId);
    document.getElementById("anp-user-id").value = userId;
    document.getElementById("anp-amount").value = amount || "";
    document.getElementById("anp-date").value = FS.todayISO();
    document.getElementById("anp-note").value = note || "";
    document.getElementById("anp-customer").textContent = `For ${info?.displayName || userId}. Approved purchases will be settled from oldest to newest.`;
    document.getElementById("admin-notifications-payment-backdrop").classList.add("show");
    document.getElementById("anp-amount").focus();
  }

  function closeEmbeddedPaymentModal() {
    document.getElementById("admin-notifications-payment-backdrop")?.classList.remove("show");
  }

  async function onPaymentSubmit(ev) {
    ev.preventDefault();
    const userId = document.getElementById("anp-user-id").value;
    const amount = Number(document.getElementById("anp-amount").value || 0);
    const info = snapshot.accounting.find((r) => r.userId === userId);
    const ok = await window.AdminModals.confirm(
      "Confirm this payment?",
      `You are recording ${FS.money(amount, snapshot.settings.currency)} for ${info?.displayName || userId}. This payment is permanent. It will settle approved purchases from oldest to newest, and any amount left over will remain as credit for future snacks.`,
      { confirmText: "Record payment" }
    );
    if (!ok) return;
    try {
      const result = await FS.admin.recordPermanentPayment({
        userId,
        amount,
        note: document.getElementById("anp-note").value,
        createdDate: document.getElementById("anp-date").value,
      });
      closeEmbeddedPaymentModal();
      await refreshSnapshot();
      renderList();
      await window.AdminModals.alert(
        "Payment recorded",
        `${result.settledIds.length} approved purchase${result.settledIds.length === 1 ? " was" : "s were"} marked paid. ${result.credit > 0 ? `${FS.money(result.credit, snapshot.settings.currency)} remains as credit for future snacks.` : "There is no unused credit from this payment."}`
      );
    } catch (e) {
      await window.AdminModals.alert("Payment could not be recorded", e.message);
    }
  }

  function openPanel() {
    renderList();
    document.getElementById("admin-notifications-backdrop").classList.add("show");
  }

  function closePanel() {
    document.getElementById("admin-notifications-backdrop").classList.remove("show");
  }

  function onListClick(ev) {
    const actionBtn = ev.target.closest("[data-notif-act]");
    if (actionBtn) {
      ev.stopPropagation();
      handleAction(actionBtn);
      return;
    }
    const dismissBtn = ev.target.closest(".notif-dismiss");
    if (dismissBtn) {
      ev.stopPropagation();
      dismissKey(dismissBtn.dataset.key);
      dismissBtn.closest(".notif-item").remove();
      renderBadge();
      const list = document.getElementById("admin-notifications-list");
      if (!list.querySelector(".notif-item")) {
        list.innerHTML = `<p class="muted-small">Nothing needs your attention right now.</p>`;
      }
      return;
    }
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

  // Lets the admin resolve a "needs review" notification right here instead
  // of having to navigate to transactions.html first - mirrors the exact
  // same FS.admin.* calls that page's own buttons make.
  async function handleAction(btn) {
    const act = btn.dataset.notifAct;
    const item = btn.closest(".notif-item");
    const buttons = [...item.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      if (act === "txn-approve-pay") {
        const id = btn.dataset.id;
        const userId = btn.dataset.user;
        const t = snapshot.transactions.find((x) => (x.transactionId || x.id) === id);
        const amount = t?.total || "";
        const note = t ? `Payment toward ${t.snackName || t.label || "snack purchase"}` : "";
        await FS.admin.setTransactionReviewStatus(id, "approved");
        await refreshSnapshot();
        renderList();
        const updated = snapshot.transactions.find((x) => (x.transactionId || x.id) === id);
        // Approving re-runs allocation against any credit already on file -
        // if that alone settled it, opening the payment modal here would
        // prompt for (and could record) a second, redundant payment.
        if (!updated || updated.reviewStatus !== "paid") openEmbeddedPaymentModal(userId, amount, note);
      } else if (act === "txn-group-approve-all") {
        const userId = btn.dataset.user;
        const ok = await window.AdminModals.confirm(
          "Approve all?",
          "Every listed purchase for this customer will be approved and any dispute flags cleared.",
          { confirmText: "Approve all" }
        );
        if (!ok) return;
        const txns = snapshot.transactions.filter((t) =>
          (t.userId || t.uid) === userId && ((t.reviewStatus || "neutral") === "neutral" || t.userStatus === "disputed"));
        for (const t of txns) {
          await FS.admin.setTransactionReviewStatus(t.transactionId || t.id, "approved");
        }
        await refreshSnapshot();
        renderList();
      } else if (act === "fb-read") {
        await FS.admin.setFeedbackStatus(btn.dataset.id, "read");
        await refreshSnapshot();
        renderList();
      } else if (act === "fb-archive") {
        await FS.admin.setFeedbackStatus(btn.dataset.id, "archived");
        await refreshSnapshot();
        renderList();
      }
    } catch (e) {
      const alertFn = window.AdminModals?.alert || ((title, msg) => Promise.resolve(alert(`${title}: ${msg}`)));
      await alertFn("Action failed", e.message);
      buttons.forEach((b) => (b.disabled = false));
    }
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

    const dismissed = getDismissed();

    // "A name was added" - approximated by vipStatus flipping to "named"
    // with a recent updatedAt, since no dedicated "namedAt" field exists;
    // a later unrelated profile edit (e.g. email) could occasionally
    // re-surface one after it's been dismissed, but that's an acceptable,
    // easily-dismissed edge case rather than a new persisted field/rule.
    const nameAddedItems = snapshot.users
      .filter((u) => {
        const userId = u.userId || u.uid;
        return userId && u.vipStatus === "named" && u.displayName && timestampMs(u, "updatedAt") >= ACTIVITY_CUTOFF_MS
          && !dismissed.has(`name:${userId}`);
      })
      .map((u) => ({
        type: "name-added",
        key: `name:${u.userId || u.uid}`,
        userId: u.userId || u.uid,
        name: u.displayName,
        date: FS.admin.dateFromRecord(u, "updatedAt"),
      }));

    // "Items were added to a tab" via the basket's own "Add to tab" button -
    // one notification per checkout, not per line item: FS.addTransaction
    // writes every item from one basket submission with the identical
    // server timestamp in the same batch, so grouping by (userId, exact
    // timestamp) reconstitutes "one Add to tab click" from the flat
    // transactions list.
    const selfTxns = snapshot.transactions.filter((t) => t.source === "self" && timestampMs(t, "createdAt") >= ACTIVITY_CUTOFF_MS);
    const byCheckout = new Map();
    for (const t of selfTxns) {
      const groupKey = `${t.userId}|${timestampMs(t, "createdAt")}`;
      if (!byCheckout.has(groupKey)) byCheckout.set(groupKey, []);
      byCheckout.get(groupKey).push(t);
    }
    const itemsAddedItems = [...byCheckout.entries()]
      .map(([groupKey, txns]) => ({ groupKey, txns, first: txns[0] }))
      .filter(({ groupKey }) => !dismissed.has(`items:${groupKey}`))
      .map(({ groupKey, txns, first }) => ({
        type: "items-added",
        key: `items:${groupKey}`,
        userId: first.userId,
        name: nameFor(first.userId),
        count: txns.length,
        snackId: first.snackId,
        snackName: first.snackName,
        date: first.createdDate || FS.admin.dateFromRecord(first, "createdAt"),
      }));

    return [...feedbackItems, ...txnItems, ...nameAddedItems, ...itemsAddedItems]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
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
            <div class="notif-item-actions">
              <button type="button" data-notif-act="fb-read" data-id="${esc(it.id)}">Mark read</button>
              <button type="button" data-notif-act="fb-archive" data-id="${esc(it.id)}">Archive</button>
            </div>
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
            <div class="notif-item-actions">
              <button type="button" class="primary" data-notif-act="txn-group-approve-all" data-user="${esc(it.userId)}">Approve all</button>
            </div>
          </div>
          <div class="notif-item-meta">
            <span class="muted-small">${esc(it.date)}</span>
            ${statusBadge(it.reviewStatus)}
          </div>
        </div>`;
      }
      if (it.type === "name-added") {
        return `<div class="notif-item" data-type="name-added" data-user="${esc(it.userId)}">
          <div class="notif-item-photo"><span class="bin-placeholder" aria-hidden="true">&#128100;</span></div>
          <div class="notif-item-body">
            <div class="notif-item-title">${esc(it.name)}</div>
            <div class="muted-small">Added their name</div>
          </div>
          <div class="notif-item-meta">
            <span class="muted-small">${esc(it.date)}</span>
            <span class="verdict-badge activity">New profile</span>
          </div>
          <button type="button" class="notif-dismiss" data-key="${esc(it.key)}" aria-label="Dismiss this notification" title="Dismiss">&times;</button>
        </div>`;
      }
      if (it.type === "items-added") {
        const snack = it.snackId ? snapshot.snacks.find((s) => s.id === it.snackId) : null;
        const itemName = snack ? snack.name : (it.snackName || "Item");
        return `<div class="notif-item" data-type="items-added" data-user="${esc(it.userId)}">
          <div class="notif-item-photo">${snack && snack.photo
            ? `<img src="${esc(snack.photo)}" alt="${esc(itemName)}" loading="lazy" />`
            : `<span class="bin-placeholder" aria-hidden="true">&#127850;</span>`}</div>
          <div class="notif-item-body">
            <div class="notif-item-title">${esc(it.name)}</div>
            <div class="muted-small">${it.count > 1 ? `${it.count} items added to tab` : `Added ${esc(itemName)} to tab`}</div>
          </div>
          <div class="notif-item-meta">
            <span class="muted-small">${esc(it.date)}</span>
            <span class="verdict-badge activity">Logged</span>
          </div>
          <button type="button" class="notif-dismiss" data-key="${esc(it.key)}" aria-label="Dismiss this notification" title="Dismiss">&times;</button>
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
          <div class="notif-item-actions">
            <button type="button" class="primary" data-notif-act="txn-approve-pay" data-id="${esc(it.id)}" data-user="${esc(it.userId)}">Approve &amp; pay</button>
          </div>
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
