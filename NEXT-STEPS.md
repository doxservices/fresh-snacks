# Next steps: security gaps, workflow inconsistencies, and open feature work

Written after reviewing the visitor-gate / Open-a-Tab implementation and the
follow-on transaction/payment/device-detail commits (`6e93a4a` through
`e5704dc`), then updated after the 2026-07-26 device-access-revocation and
invite-self-service pass. Items are grouped by severity, with concrete
file/line pointers. Where a real product decision is needed, this doc lists
options instead of picking one — raise those with the project owner before
implementing, rather than guessing.

---

## Resolved (2026-07-26)

- **Admin "Unlink" didn't actually revoke access.** `DELETE
  /admin/users/:userId/linked-devices/:deviceUid` now also deactivates that
  device's `claims/{deviceUid}` doc, mirroring what self-service unlink
  already did. Previously `canAccessTab()` granted access from an active
  claim before ever checking `linkedUids`, so an "unlinked" device kept
  full read/write access indefinitely.
- **No way to revoke a leaked/compromised invite code.** Accounting and
  Edit Tab's invite modal can now activate/deactivate the tab's *existing*
  code in place. `hasClaimOn()` also now requires the code itself to still
  be active, so deactivating immediately cuts off anyone holding a view or
  session claim through it. A fully linked device is deliberately
  unaffected by code deactivation alone — that still requires the
  per-device Unlink control above.
- **Dual authorization systems.** Resolved as a side effect of fixing the
  bug it was masking: `js/nav.js`'s admin-nav-badge check was reading
  Firestore directly through a `FS._db` handle that no longer exists (dead
  code since the API migration, silently swallowed by its own catch). It
  now calls `GET /admin/whoami` instead. That was also the *last*
  direct-client Firestore read anywhere in the app — `firestore.rules` is
  no longer read by any live code path. The rules file is now inert;
  locking it to deny-all is a hygiene nice-to-have, not a functional need.
- Shipped alongside these: self-service "Link a device" + a persistent
  device count in User Settings (previously only a customer viewing the
  admin-generated invite could add a second device at all); and red
  asterisks on required fields in the Open-a-Tab and Profile Information
  forms, conditional on whether the current viewer is the tab's own opener
  (email/phone required) or an invitee acting through a link/session claim
  on someone else's already-accountable tab (email/phone not required).
  See `DEV-NOTES.md` for the full writeup.

---

## Security gaps

### C. [MEDIUM] "Session" access mode is invisible to admins and never expires

The device-limit workaround added in the visitor-gate batch
(`POST /store/link/session`, [functions/src/routes/store.js:513-544](functions/src/routes/store.js#L513-L544))
grants a 4th+ device full `canAccessTab` access via a `claims` doc with
`accessMode: "session"`. Two problems remain:

1. `GET /admin/users/:userId/linked-devices`
   ([functions/src/routes/admin.js:102-175](functions/src/routes/admin.js#L102-L175))
   only sources from the `devices` collection and `profile.linkedUids` /
   `linkedDevices` — it never looks at `claims` docs with
   `accessMode: "session"`. Such a device stays completely invisible to the
   admin's device list until (if ever) it happens to submit a transaction,
   which incidentally creates a `devices/fs_dev-{uid}` doc.
2. Despite the name, a "session" claim has no expiry — it's `active: true`
   indefinitely, identical in duration to a full link, until someone calls
   unlink on it (or, as of the fix above, until the invite code it rides on
   is deactivated — which now at least gives admins *one* way to cut every
   session claim on a tab off at once, just not to see them individually
   first).

**Fix direction:** surface active `accessMode: "session"` claims for a
target uid in the linked-devices response (even without a `devices` doc
backing them yet), and decide what "session" should actually mean duration-
wise.

**Options for the developer to raise before implementing:**
- What should "temporary" mean here in practice: expire after N hours,
  after N days of inactivity, or not at all (in which case, consider
  renaming the concept so it doesn't imply something it isn't)?
- Should the 4th+ device slot be capped too (e.g. max 2 concurrent session
  claims), or is it meant to be unlimited on purpose?

### D. [LOW-MEDIUM] No rate limiting on any public write endpoint

`POST /store/profile`, `POST /store/transactions`, and `POST /store/feedback`
are public HTTPS endpoints gated only by a trivially-self-serve Firebase
anonymous sign-in — no per-uid or per-IP throttling anywhere in
`functions/index.js` or the route handlers. A scripted client could mass-
create profiles or spam transactions/feedback with no server-side limit.

**Fix direction:** add a lightweight throttle (Firestore-backed counter, or
`express-rate-limit` keyed by uid/IP) on the write-heavy public routes.

**Options for the developer to raise before implementing:**
- Is abuse a realistic concern for this deployment's actual size/audience,
  or is this pure hardening that can be deprioritized?

### E. [LOW] Customer-facing transaction POST has no item-count cap

`POST /store/transactions` ([functions/src/routes/store.js:290-303](functions/src/routes/store.js#L290-L303))
validates each item but never caps how many items can be submitted in one
request. The admin equivalent explicitly caps split-quantity expansion at
200 ([functions/src/routes/admin.js:928](functions/src/routes/admin.js#L928)).
An oversized customer-submitted `items` array could exceed Firestore's
500-operation batch limit and throw an ungraceful 500, or just spam the
`transactions` collection.

**Fix direction:** cap `items.length` (e.g. 50) with a clear 400 error,
mirroring the admin route's existing cap.

### F. [LOW, code hygiene] Dead authorization branch

`hasInviteSession()` inside `canAccessTab()`
([functions/src/lib/authz.js:70-76](functions/src/lib/authz.js#L70-L76)) can
never be reached — `hasClaimOn()`, checked immediately before it, already
returns `true` for session claims too (it never distinguishes
`accessMode`). Not a vulnerability, just confusing for a future reader.
Either remove it or add a comment explaining it's intentional
defense-in-depth for a code path that doesn't currently exist.

---

## Inconsistent workflows

### H. Undocumented pivot from the original visitor-gate plan

The plan that shipped this feature said existing anonymous guests would be
gated the same as brand-new visitors (not grandfathered). The shipped
behavior instead grandfathers by recorded activity — any profile with a
transaction or payment on file counts as an "active tab" regardless of
`nameSet`
([functions/src/routes/store.js:20-27](functions/src/routes/store.js#L20-L27),
mirrored client-side at
[js/firebase-store.js:170-183](js/firebase-store.js#L170-L183)). This is
documented as a fact in `DEV-NOTES.md` ("Existing profiles... are treated
as complete...") but the *why* behind the change isn't recorded anywhere.
Worth a one-line rationale so a future reader doesn't mistake it for drift.

### I. The originally-requested "flagged accounts" admin section was never built

Earlier work this project identified exactly four real, active accounts with
genuine transaction/payment history that remain anonymous or incomplete
under the `nameSet`/`createdByAdmin` standard (see accounting.html's own
incomplete-profile rows for the current list). The ask was a distinct "Flagged" section
on `accounting.html`, below the main accounts table, surfacing exactly this
set — accounts with real money moving through them but no verified identity.
That still hasn't been built.

This is exactly the case gap C above makes worse: an account already
flagged as "money moving, identity unknown," combined with limited
visibility into which devices/sessions currently have access to it, is the
accountability gap this whole project (visitor gate, orphan cleanup, device
details, invite revocation) has otherwise been closing.

**Suggested implementation** (criteria already settled from prior analysis):
a row belongs in "Flagged" when
`(row.snackTotal !== 0 || row.paidTotal !== 0 || row.adjustmentTotal !== 0)`
**and** `!FS.profileComplete(row)` (i.e. no `nameSet`, no `createdByAdmin`).
Reuse the existing accounting row rendering/save logic
(`saveAccountingRow`/`scheduleAccountingSave` in
[accounting.html:673-697](accounting.html#L673-L697)) for consistency rather
than building a second, divergent table implementation.

**Options for the developer to raise before implementing:**
- Second `<table>` with its own "Flagged: incomplete accounts with activity"
  heading (simplest, matches existing patterns), or a filter/toggle on the
  existing table instead of a physically separate section?
- Should a flagged row get a direct action to nudge/require completion
  (e.g. a "Request info" button that does something), or is visibility
  alone the goal for now?
- Should the Flagged section also surface each account's device/invite
  state inline (now buildable given the activate/deactivate and per-device
  unlink controls above), given that's exactly the context an admin would
  want when deciding whether to act on a flagged account?

---

## Lower-priority follow-ups

- **Orphan cleanup is currently manual.** `scripts/remove-orphan-guests.mjs`
  is a safe, dry-run-by-default script (confirmed working, confirmed the
  database currently has zero unexplained orphans as of the last review)
  but there's no scheduled job — it only runs when someone remembers to
  invoke it. Consider a periodic scheduled Cloud Function if orphan
  accumulation becomes a recurring cleanup chore rather than a one-off.
- **`transactions.html` reconciles all payments on every refresh**
  ([transactions.html:293-296](transactions.html#L293-L296) calls
  `FS.admin.reconcilePayments()`, which re-scans every user with a payment
  on every admin action on that page). Fine at current scale; consider
  scoping reconciliation to the affected user only if the customer list
  grows significantly.
- **`POST /admin/payments/reconcile` and the customer/admin transaction
  routes duplicate a fair amount of allocation logic** across
  `allocateApprovedTransactions` call sites. No bug found, just worth a
  glance if payment logic needs to change again — the repair/backfill pass
  inside `allocateApprovedTransactions` ([functions/src/routes/admin.js:319-377](functions/src/routes/admin.js#L319-L377))
  is doing double duty as both "settle new payments" and "repair legacy
  data," which makes it a bit dense to reason about.
- **`POST /admin/users/:userId/link-invite` and `POST /store/link/invite`
  duplicate the same code-generation block** ([functions/src/routes/admin.js:78-100](functions/src/routes/admin.js#L78-L100)
  vs. [functions/src/routes/store.js:461-483](functions/src/routes/store.js#L461-L483)).
  Left duplicated deliberately since `shared.js` is pure-logic-only (no
  Firestore access) by convention — worth a shared Firestore-aware helper
  if a third call site ever needs the same "reuse if active, else mint a
  fresh code" logic.

---

## Suggested priority order

1. **I** (flagged accounts section) — the originally-requested feature,
   now well-scoped given the access-revocation controls already in place.
2. **C** (session-mode visibility/expiry) — depends on a product decision
   about what "session" should mean.
3. **D, E, F** and the lower-priority follow-ups — opportunistic, no
   pressing risk at current scale.
4. **H** — a documentation-only fix, cheap whenever someone's already in
   that area of the code.
