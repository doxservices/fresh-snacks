# Development notes

## Cashback demo: cash/credit as cards integrated with Current balance (2026-07-29)

- The separate "Payment ledger" section (previous entry) is gone - Cash
  received and Credit earned now appear as their own `.stat-box` cards
  directly inside the same `.brand-stats` row as Current balance, so
  paying grows one account-summary strip instead of revealing a second
  section further down the page. Refund/Not-refundable buttons moved
  inside each card itself; behavior (refund only ever touches cash, credit
  stays either way) is unchanged.

## Cashback demo: a payment ledger with separate cash/credit buckets (2026-07-29)

- Paying in the demo used to just print a one-line result. New "Payment
  ledger" card, shown after paying, keeps cash and credit as two visibly
  separate buckets rather than netting them into one figure - "Payment
  received" (the real money actually paid, tagged refundable) and "Cashback
  earned" (account credit only, tagged not refundable, only shown when a
  tier actually applied). A "Refund" button only ever touches the cash
  bucket; the credit row's button stays permanently disabled with an
  explanatory tooltip, and refunding cash shows a note confirming the
  credit bucket is untouched either way - it was never cash to begin with.
  Demo-only (`cashback-demo.html`) - no changes to the real app's actual
  cashback settlement logic.

## Cashback demo's clock now runs the 8am-3pm window, 8 bricks (2026-07-29)

- Reworked `cashback-demo.html`'s simulated clock from a full 24-hour day
  down to just the 8am-3pm window (8 equal bricks, ~52.5 simulated minutes
  each) - the clock jumps straight from one day's 3pm to the next day's
  8am instead of animating through the uneventful overnight hours. Still
  2 real seconds per brick, so one day's window plays out in 16 seconds
  (down from the previous 48-second full-day model).

## Cashback demo page; favorite-card reorder; balance card green (2026-07-29)

- New `cashback-demo.html` - a standalone, self-contained simulation (no
  Firestore/Firebase dependency at all) for watching the early-payment
  cashback's stages play out: 2 real seconds = 1 simulated hour, so a full
  day plays out in 48 seconds. Shows a live clock, a 24-segment hourly bar
  for the current simulated day (reintroducing the "reverse loading bar"
  visual the original discount design used, now representing hours left in
  the day rather than a fixed 7am-3pm deadline), the real cashback card
  markup/styling updating live, quick-jump buttons to instantly preview
  Day 1/Day 2/expired without waiting, and a "Pay in full now" button that
  shows what cashback (if any) that moment would actually earn. Mirrors
  `functions/src/lib/cashback.js`'s `TIER_RATES` by hand, since this is a
  plain static page with no build step to share it directly. Not linked
  from any nav - a directly-navigated test page, not part of the real app.
- Favorite Snack card's two mini-stats reordered - "Last purchased" now
  comes first (where "Total spent" used to sit), "Total spent" second.
  Values/ids unchanged, so no JS changes needed, just the markup order.
- `.balance-stat` (the "Current balance" card made prominent a few entries
  back) changed from blue to green, to match the app's actual green theme
  instead of an unrelated color.

## Reset undoes only a payment claim; admin Mark as Paid supersedes confirmation (2026-07-29)

- **Reset, from a payment-dispute status, was over-resetting.** An item
  that's already confirmed and now has a payment claim in question
  (`PAYMENT_PENDING_ADMIN_CONFIRMATION`/`PAYMENT_UNDER_REVIEW`) only ever
  had that claim disputed - the customer confirmed the item itself long
  before ever reporting payment on it. But Reset sent it all the way back
  to `PENDING_USER_CONFIRMATION`, forcing a fresh confirm/dispute (the
  check/cross) instead of just undoing the payment claim and landing back
  on `CONFIRMED_UNPAID` (Mark as Paid). Fixed - Reset from those two
  statuses now targets `CONFIRMED_UNPAID`; Reset from `CONFIRMED_UNPAID`/
  `ITEM_UNDER_REVIEW` is unchanged (those genuinely are "undo the
  confirmation itself" cases). transactions.html/edit-tab.html's Reset
  confirmation dialog now describes whichever of the two actually applies,
  and the button/permission-label wording no longer hardcodes "back to
  Awaiting confirmation."
- **Product decision: an admin's Mark as Paid now supersedes the
  confirm-first order.** Previously an item still awaiting the customer's
  own confirmation (`PENDING_USER_CONFIRMATION`) could never be settled by
  any payment - not a direct admin action, not the automatic credit sweep -
  until the customer confirmed it first (a deliberate rule from earlier in
  this project). That's reversed: `PENDING_USER_CONFIRMATION` is now
  settlement-eligible right alongside the already-confirmed statuses,
  oldest-first same as everything else (`SETTLEMENT_ELIGIBLE` in
  lib/shared.js), and a new direct transition
  (`PENDING_USER_CONFIRMATION`/`ADMIN`/`MARK_AS_PAID` -> `PAID_FINALIZED`)
  lets an admin finalize one on the spot without waiting on the customer at
  all. `ITEM_UNDER_REVIEW` (a live dispute) is still excluded either way -
  a payment silently settling something actively being disputed would
  resolve that dispute without anyone actually deciding it.
- Regression coverage added to `transaction-status.test.js` (the new
  transition + availableActions entry, the split Reset targets) and
  `transaction-lifecycle.test.js` (an admin finalizing an unconfirmed item
  directly, the credit sweep settling one given enough credit, and a full
  report-payment-then-reset trace landing on Confirmed - unpaid).
  `payment-allocation.test.js`'s old "unconfirmed items are never
  auto-settled" case now asserts the opposite, oldest-first.

## Replaced the per-purchase discount with a whole-balance cashback reward (2026-07-29)

- Product decision: reframe the whole feature from a *discount* (a reduced
  charge at payment time, scoped to one day's purchases) to a *cashback*
  (pay the full amount, then get a percentage credited back - only once
  the customer's ENTIRE account balance is brought to $0, not just one
  day's batch). Tiers also reverse: same day the balance opened is now the
  BEST rate (10%), the day after is smaller (5%), and holding into a third
  day earns nothing at all, even if eventually paid in full - a front-
  loaded "act fast" reward rather than the old escalating one.
- `functions/src/lib/discount.js` replaced by `functions/src/lib/
  cashback.js`. Core building blocks: `accountSnapshot(transactions)` -
  current outstanding total and the date the balance first went above
  $0 (the oldest still-owed transaction's createdDate); `evaluateCashback
  (transactionsBefore, settledIds, now)` - given what's about to be
  finalized by whatever settlement action is running, decides whether
  that brings the WHOLE balance to zero and what tier that earns;
  `projectedCashback(transactions, now)` - the customer-facing "if you
  cleared it right now" preview, same tiers, no requirement that it's
  actually been paid yet. Same LAUNCH_DATE (2026-07-29) cutoff as before -
  a balance that opened pre-launch is never eligible.
- Since the customer now pays the FULL price to qualify (not a reduced
  charge), transaction totals are never modified anymore - the reward is a
  brand new `payments` doc (`source: "cashback"`) worth tier% of what just
  got cleared, added as account credit. Wired into both places a
  transaction can actually finalize to PAID_FINALIZED: `applyAdminAction`
  in admin.js (covers both mark-paid and confirm-payment, gated on
  `next === PAID_FINALIZED`, with a second read of the customer's full
  transaction list inside the same Firestore transaction) and
  `allocateApprovedTransactions` in settlement.js (the automatic credit
  sweep, used by both admin-recorded payments and a customer's own self-
  checkout auto-settling from existing credit).
- `paymentAllocationPlan` (shared.js) is back to its original,
  discount-unaware shape - it no longer needs to know about any of this,
  since nothing reduces a transaction's total anymore.
- index.html's card reworked for the cashback framing (balance vs. what
  you'd earn back, instead of price-before/price-after) and its 8-segment
  hourly countdown bar removed - the new rule is purely day-based (no
  intra-day deadline), so an hourly bar didn't have anything meaningful
  left to count down. The "Current Balance" stat box is now its own
  visually prominent blue card with white text, unrelated to cashback -
  just making the number a customer should notice first stand out more.
- `functions/test/discount.test.js` replaced by `functions/test/
  cashback.test.js`, covering the day-based tier table, the launch-date
  cutoff, the whole-balance (not partial) clearing trigger, and the
  customer-facing projection.

## Fix: early-payment discount was applying retroactively to pre-existing balances (2026-07-29)

- Kamoya's account was showing a 10% offer, and checking the math
  (`discountForDate` run against the real clock) confirmed it was
  technically "correct" per the day-difference rule alone - their oldest
  unpaid purchase just happened to be exactly 2 days old. But that
  purchase predated this feature ever existing, so it was never given a
  fair chance to act on an incentive that didn't exist yet when it was
  made - a purely coincidental calendar match was sweeping old, unrelated
  balances into the discount system.
- New `LAUNCH_DATE` constant (`functions/src/lib/discount.js`, set to
  2026-07-29) - `discountForDate` now excludes any `createdDate` before it
  outright, regardless of the day-math. Only a purchase made on or after
  the day this shipped is ever eligible for any tier - "start discounts
  from today onwards," per the explicit product decision. Existing older
  unpaid balances just settle at full price, exactly as they did before
  this feature existed.
- `functions/test/discount.test.js` fixture dates shifted forward (all now
  on or after LAUNCH_DATE except the cases specifically testing the cutoff
  itself) and a new case added proving a pre-launch purchase is excluded
  even when the day-math alone would otherwise read as day 1.

## Fix: invitee-name modal still disturbed customers with a name already on file (2026-07-27)

- The previous fix's `anonymous` check (vipStatus/displayName) still missed
  one case: a profile that got firstName/lastName set through the invitee
  modal *before* today's earlier vipStatus-bump fix landed would have real
  names on file but a vipStatus stuck on "anonymous" from that bug window -
  `anonymous` would still read true for it. `maybeOpenInviteeNameModal` now
  also checks firstName+lastName directly and treats either signal being
  true as "has a name" - a customer who already has one on file, by
  whichever route it got there, is never re-interrupted.

## Fix: the invitee-name modal was interrupting customers who already had a name (2026-07-27)

- `maybeOpenInviteeNameModal`'s "has a name" check was `me.firstName &&
  me.lastName` - but `FS.admin.createGuestTab`/`POST /admin/users` only
  ever sets `displayName`, never separate firstName/lastName fields, even
  when the admin typed a real name for that guest tab. Every admin-created
  tab was being treated as nameless and hit with the disruptive modal,
  named or not. Switched to reuse `renderUserSettings`'s own `anonymous`
  check (`vipStatus === "anonymous" || !displayName`) instead - the same
  signal the rest of the page already uses to decide whether a profile has
  a real name.
- Fixed a second bug this surfaced: an invitee who *did* comply and typed
  their name through the new modal (first/last name only, no email/phone -
  they were never required to supply those) never actually left
  `vipStatus: "anonymous"`, since `PATCH /store/profile` only bumped
  `vipStatus` alongside `nameSet`, which requires all four fields. The
  modal would have kept reopening forever for exactly the customers who
  did what it asked. The route now also bumps `vipStatus` alone (never
  `nameSet`, which stays strictly gated on all four fields - that's the
  real accountability backstop, unrelated to this) when a display name is
  provided by someone editing a linked target's profile rather than their
  own identity - the same relaxed no-email/phone-required rule invitees
  already get everywhere else in this route.

## Early-payment discount: 5% next-day, 10% the day after, then gone (2026-07-27)

- New behavior: a customer who pays off a day's worth of CONFIRMED_UNPAID
  purchases by 3pm the *next* day (business-local time, not same-day) gets
  5% off that whole day's batch. Miss that window and the same batch gets
  one more chance the day after, at 10% off; miss that too and it's back to
  full price for good - no further escalation. Goal: train a same-morning
  payment habit instead of letting balances drift.
- New `functions/src/lib/discount.js` - a pure function of (createdDate,
  now), nothing precomputed or stored ahead of time, so it can be
  recomputed anywhere (settlement, the customer-facing card) and can never
  drift out of sync with itself. Hours are evaluated in a hardcoded
  business-local timezone (**assumed Jamaica, UTC-5, no DST** - Cloud
  Functions run in UTC by default, and "7am"/"3pm" need to land on a
  customer's actual clock, not the server's; if the business is actually
  elsewhere, `BUSINESS_UTC_OFFSET_HOURS` is the one constant to change).
- The discount locks in at the moment a transaction is actually finalized
  (PAID_FINALIZED), whichever path gets it there first - `total` itself is
  reduced right then, permanently, with the pre-discount amount kept
  alongside (`originalTotal`, `discountRate`, `discountTier`) for the
  record. Every existing read of a transaction's `total` (accounting(), the
  customer's own Snack Log, invoices) already treats it as the
  authoritative amount, so no other code needed to learn about discounts at
  all - reducing `total` itself was the one change needed everywhere else.
  Wired into all three finalization paths: admin.js's mark-paid and
  confirm-payment routes, and the automatic credit-sweep in
  lib/settlement.js's `allocateApprovedTransactions` (used by both an
  admin-recorded payment and a customer's own self-checkout auto-settling
  from existing credit) - `paymentAllocationPlan` itself (lib/shared.js)
  now reserves the *discounted* amount out of available credit for an
  eligible transaction, so existing credit stretches further, not the
  pre-discount total.
- `GET /store/data` exposes the customer's single most-urgent active offer
  (bundled by purchase day; the 10%/day-2 tier wins over 5%/day-1 if both
  happen to be active, since it's the one gone for good today) as
  `discount`, null when nothing currently qualifies. New card on
  index.html, hidden except 7am-3pm business time on a day something
  qualifies - amount before/after, and an 8-segment "road dash" bar
  (7am-3pm = 8 hourly segments) that goes from filled to spent one segment
  at a time as the window's hours pass, rather than the bar itself
  shrinking.
- New `functions/test/discount.test.js` - the day/hour boundary math (7am
  open, 3pm close, same-day exclusion, 2-day expiry), the bundling/
  most-urgent-tier logic, and a `paymentAllocationPlan` case proving the
  discount actually reduces credit consumed - all pinned to fixed `now`
  values rather than the real clock, so the suite gives the same result
  regardless of when it's actually run.

## Notifications navigate to their transaction; invitees get a disruptive name prompt (2026-07-27)

- "Items added to tab" notifications (a self-checkout, one or several items
  in one submission) previously only dismissed on click - no navigation at
  all, unlike every other notification type. Now carries every transaction
  id from that checkout (`txnIds`, comma-joined into the same `data-txn`
  attribute the other types already use) and falls through to the existing
  `transactions.html?user=...&txn=...` navigation instead of being
  special-cased. `transactions.html`'s highlight logic now splits `txn` on
  comma and highlights every matching row, not just one - needed since a
  multi-item checkout has more than one id to point at.
- An invitee (linked/session access to someone else's shared tab) only ever
  got asked for the shared tab's name once, at the exact moment they
  accepted the invite (`maybeOpenNameCaptureModal`'s only trigger is an
  in-progress `linkCode`) - if skipped then, nothing ever asked again on any
  later visit, matching the reported "invitees aren't complying on their
  own." New `#invitee-name-backdrop` modal (first/last name only, no
  email/phone - matches the existing invitee exemption in
  `renderUserSettings`) reopens on every visit via
  `maybeOpenInviteeNameModal()` as long as `accessMode` is linked/session
  and the shared profile still has no name. Deliberately has no close
  button and no backdrop/Escape dismiss - the only way out is submitting a
  name.

## Reverted the Last Payment card, dropped Paid so far (2026-07-27)

- Pulled the Last Payment card (and the small stat-box version before it)
  back out entirely, per product decision - full revert, not just hidden:
  the `.last-payment-section`/`.last-payment-card` HTML and CSS, the
  `FS.lastPayment`/`FS.timestampMs`/`FS.formatDateTime` helpers in
  `js/firebase-store.js`, and the `createdAt`/`settlesSnackId`/
  `settlesSnackName` fields `toPayment()` (`functions/src/lib/shared.js`)
  had started exposing for it are all gone again, since nothing else in the
  app used any of them.
- Also dropped the "Paid so far" stat box next to Current balance - the top
  of the page is down to the one stat now.
- Next up (not yet decided): what replaces the freed-up space. Steered
  away from more numbers/analysis toward something that reads as freeing
  rather than another figure to track - see the conversation for candidate
  directions.

## Admin test-profile label stops drifting to "Guest Profile" (2026-07-27)

- `profilePresentation()`'s `isAdminTest` check only ever looked at the
  `?profile=admin-test` URL param (or a `claim.profileSource` that nothing
  in the backend actually ever sets - dead code, left as-is). That param
  only survives the one navigation admin.html's "Open test profile" sends
  you on; reloading, or clicking any other nav link, drops it, and the
  label then fell through to "Guest Profile" - reported for Xavier
  Hemmings' account, but really any admin test-profile session more than
  one click deep.
- `FS.admin.portalIntoAccount()` (`js/firebase-admin.js`) now also sets a
  durable `adminTestSession` localStorage flag (new key in
  `js/firebase-config.js`'s `storageKeys`), and `profilePresentation()`
  checks it alongside the URL param. Cleared by `FS.unlinkDevice()` (the
  existing "De-link this browser" button, already how a portalled-in
  session ends) and `FS.signOutCustomer()`, so it never outlives the test
  session or bleeds into a real customer's own device link.

## Last Payment card now shows what it covered, with the photo (2026-07-27)

- The small stat-box version (previous entry) only had room for an amount
  and a date/time line. Replaced it with a full `.snack-card`-style card -
  same photo-plus-details layout as the Favorite Snack card, right below
  it - so a payment can show what it actually covered.
- `settlesSnackId`/`settlesSnackName` (already written by
  `settlementPaymentWrite` in `functions/src/routes/admin.js` whenever a
  payment finalizes one specific transaction) are now exposed on
  `toPayment()`, letting the card resolve and show that snack's name and
  photo. A general/manual payment (recorded against the account rather
  than settling one particular item) has neither field - falls back to its
  note, or a plain "General payment" label, with the usual placeholder
  glyph instead of a photo.

## "Current balance" wording + a Last Payment stat card (2026-07-27)

- Renamed the "Current tab" stat label to "Current balance" everywhere it
  appears for a positive balance (index.html's top stat box and its bottom
  summary row, plus edit-tab.html's admin per-customer dashboard, for
  consistency) - the negative-balance case still reads "Available credit",
  unchanged.
- New third stat box on index.html, "Last Payment": amount plus the actual
  date *and time* it was recorded, e.g. "Jul 27, 4:32 PM" - hidden entirely
  for a customer with no payments on file yet.
  - `createdDate` (the field the rest of the app groups/sorts payments by)
    is a plain day string with no time component, and can be backdated by
    an admin entering a payment after the fact - neither is enough to show
    a real time or reliably pick the single most-recent payment among
    several from the same day. Exposed the raw Firestore `createdAt`
    timestamp on `toPayment()` (`functions/src/lib/shared.js`) instead, and
    added `FS.timestampMs`/`FS.formatDateTime` (`js/firebase-store.js`) to
    read it - the same small helpers `js/admin-notifications.js` already
    had privately for its own notification timestamps, now shared instead
    of duplicated a third time.
  - `FS.lastPayment(data)` picks the payment with the latest `createdAt`
    (falling back to `date` only for a legacy payment with no timestamp).
- `.brand-stats` switched from a fixed 2-column grid to
  `repeat(auto-fit, minmax(140px, 1fr))` so it reflows cleanly whether 2 or
  3 boxes are showing, instead of leaving a gap or forcing a cramped 3rd
  column.

## Shrank the remove/review "x" and gave it more corner margin (2026-07-27)

- `.entry-remove-btn` (previous entry) was still a bit large and sat only
  2px off the cell's edge. Down to 14px/10px font, inset to 8px/8px so it
  reads as a small corner accent with real breathing room instead of
  crowding the edge.

## Restyled the confirmed-purchase remove/review "x" (2026-07-27)

- The new remove/review button (previous entry) reused `.verdict-btn.dispute`
  - the same neutral, bordered, 24px square as the Confirm/Review pair on a
  still-pending admin item. Gave it its own `.entry-remove-btn` class instead,
  so restyling it doesn't touch that older, unrelated pair: small (18px),
  red, semi-bold, no border/background, floating in the top-right corner of
  the "Confirm or review" cell (`.tracker-actions` gets `position: relative`
  as the anchor) instead of sitting inline beside Mark as Paid like a second
  equal-weight button. Reads as a dismiss/flag affordance now, not a button.

## An "X" to request removal/review of a confirmed purchase (2026-07-27)

- Previously, the only way to dispute a purchase was the Confirm/Review
  ("&#10003;"/"&#10005;") pair on an admin-added item still awaiting the
  customer's first confirmation (`PENDING_USER_CONFIRMATION`) - once
  confirmed (`CONFIRMED_UNPAID`), a customer's only option was Mark as Paid.
  There was no way to flag or ask to remove something before paying it,
  whether the customer added it themselves or an admin logged it for them.
- `functions/src/lib/transactionStatus.js`: added
  `[CONFIRMED_UNPAID][USER][REVIEW_ITEM] -> ITEM_UNDER_REVIEW` and included
  `REVIEW_ITEM` in `availableActions()` for that status/role. This reuses the
  existing dispute status/admin resolution flow (Approve/Edit and
  Resend/Cancel/Reset) rather than inventing a parallel one - an admin
  reviewing one of these looks identical to reviewing any other disputed item.
- New `reviewRequestType: "removal" | "review"` field, set by
  `POST /store/transactions/:id/review-item`'s new `mode` body param. A
  customer may only get `"removal"` for an item they added themselves -
  the route re-derives `createdByRole` from the record itself and silently
  downgrades to `"review"` otherwise, rather than trusting the client's
  choice; index.html's own modal already only offers the Remove option for
  the customer's own items, so this is the real enforcement, not just UX.
  Cleared alongside `itemReviewReason` everywhere an admin resolves a
  disputed item (approve-item, edit/edit-and-resend, reset, confirm-item),
  so it never lingers on a transaction once it moves on.
- **Remove** hides the row entirely from the customer's own Snack Log
  (`index.html`'s `trackerTable` skips it) until an admin resolves it one
  way or the other. **Review** keeps the existing behavior: the row stays
  visible, marked "Under review." Both flavors stop counting toward the
  customer's displayed total either way - `FS.totals()`/`FS.groups()` in
  `js/firebase-store.js` now exclude any `ITEM_UNDER_REVIEW` entry from the
  value sum, matching what the server's own `accounting()` already did for
  the admin-facing balance (a real pre-existing gap between the two - the
  customer's own total previously still counted a disputed item that the
  admin's ledger had already excluded).
  The item is never actually deleted - it's still fully visible to admins
  on transactions.html/accounting.html, unaffected by any of this, since
  those pages query transactions directly rather than through the
  customer-facing route this filtering lives in.
- The existing Review modal (`#transaction-review-backdrop`) grew a
  Remove-vs-Review toggle, shown only when the entry's `createdByRole` is
  `USER`; reason dropdown options and copy adapt to the chosen mode. For an
  admin-added item the toggle stays hidden and the modal behaves exactly as
  it did before this change.
- Known gap, not fixed here: no admin page actually displays `itemReviewReason`
  or `reviewRequestType` text anywhere yet (admin-notifications.js's bell
  dropdown shows only a generic "disputed" badge) - that was already true
  before this change for the original PENDING_USER_CONFIRMATION dispute flow
  too. The data's captured and available for a future admin-side detail view;
  building that view is a reasonable fast-follow, not required for this pass.

## Themed date pickers, clickable anywhere in the field (2026-07-27)

- Every `input[type="date"]` (Payment date on accounting/transactions,
  the admin modals' listing-date and payment-date fields, the inline
  snack-log date editor) used to share the same flat grey box as every
  other input. Gave date fields their own themed rule: a green-tinted
  background, brand-green border/hover/focus state, `accent-color` for
  the native picker, and a custom SVG calendar icon (via
  `::-webkit-calendar-picker-indicator`'s `background-image`) recolored to
  the same green instead of Chrome/Edge's default flat grey glyph. Firefox
  and Safari don't expose that pseudo-element, so they fall back to their
  own native icon untouched - a real cross-browser gap CSS alone can't
  close, since the calendar popup itself is OS/browser-rendered UI with no
  styling hook.
- `color-scheme: light` on date inputs stops the OS's dark mode from handing
  back a dark-on-dark picker popup with an invisible icon.
- New `js/date-inputs.js`: natively, clicking a date field's text only
  drops a text cursor into a segment - only clicking the tiny icon opens
  the calendar. Added a single document-level delegated click listener that
  calls `showPicker()` on whatever date input was clicked, so the whole
  field (not just the icon) opens the picker, including date fields that
  admin-modals.js/admin-notifications.js inject later. `showPicker()` is
  Chromium-only; unsupported browsers just keep the native default-click
  behavior. Included on every page that has a date field (accounting,
  admin, admin-users, catalog, edit-tab, index, inventory, sitemap,
  transactions) - skipped on the rest, which have none.

## Favorite background photo now fills its frame instead of floating (2026-07-27)

- The live customer-facing favorite card (`index.html`'s `#fav-photo`,
  rendered via `.snack-image img`) was still using `object-fit: contain`,
  unlike the admin upload preview boxes which already switched to `cover`
  a couple passes back. A landscape-oriented favorite-background upload
  would render small and surrounded by empty space rather than filling the
  card's photo panel. Switched to `object-fit: cover` with an explicit
  `object-position: center` so the crop stays centered regardless of the
  uploaded photo's orientation.

## Artwork uploads back to side by side, mobile-only stacking (2026-07-27)

- Reverted the previous vertical stack: `.catalog-upload-harness` and the
  per-card modal's `.artwork-upload-grid` are grids again (side by side),
  since the vertical read made the section unnecessarily tall on a normal
  desktop/tablet width. Top-to-bottom stacking now only kicks in under a
  new `@media (max-width: 640px)` rule, for phone-width screens where a row
  really would squeeze each preview down to nothing.
- Kept `.artwork-upload-item`'s 460px `max-width` from the previous pass (so
  a preview doesn't blow up to the full width of a very wide grid column),
  but added `justify-self: center` so the item centers itself in its cell
  instead of hugging the left edge whenever the column is wider than the cap.

## Artwork uploads stack vertically instead of squeezing 3-across (2026-07-27)

- `.catalog-upload-harness` (the Snack picker + two upload items on
  catalog.html) was a 3-column grid, so each preview only ever got roughly
  a third of the card's width. Switched to a vertical flex stack - each
  item reads top to bottom and its preview can claim far more lateral
  space, up to a 460px cap (`.artwork-upload-item`'s own `max-width`) so it
  doesn't blow up to the full card width on a wide screen.
- The now-redundant `@media (max-width: 850px)` override that forced this
  same grid down to one column on mobile was removed - the base layout is
  already single-column at every width now.
- The per-card upload modal (`js/admin-modals.js`) gets the identical
  stacked treatment via a new dedicated `.artwork-upload-grid` class,
  instead of reusing `.form-grid` (which stays a generic multi-column
  layout other, unrelated forms still use as-is).

## Fix: saving a profile with a blank phone crashed ("Cannot read properties of null") (2026-07-27)

- `PATCH /store/profile` computed `phone.replace(/\D/g, "")` unconditionally,
  even though `phone` is `null` whenever the field is left blank (via
  `clean()`) - the very next line already correctly guarded its *validation*
  with `phone &&`, but the computation one line above it didn't. A real
  customer editing their own profile never hit this in practice (the Phone/
  Work email inputs are marked `required` there, so the browser blocks
  submission first) - but the Profile information modal doesn't require
  them when `accessMode` isn't `"self"` (a `linked`/`session` device is
  editing a shared tab's display info, not opening a fresh one), and an
  admin testing via the account picker also resolves to `accessMode:
  "session"` (their own uid was never added to `linkedUids`) - so blank
  phone reaches the server there and crashed. Fixed by guarding the
  computation the same way the validation already was.
- Also relabeled the Profile information modal's "Profile status" field
  from "Admin Profile" to "Admin test view" when browsing via the account
  picker - it describes the *current admin session*, not the account being
  viewed, and reads as if a real customer's own account is somehow an
  admin otherwise. Nothing about this label is ever stored on the account
  itself; it's derived purely from the page's own `?profile=admin-test`
  query param.

## Healthy accounts (zero balance) highlighted on User Accounting (2026-07-27)

- A row on accounting.html now gets a `healthy-account` class (light green
  background, `var(--green-light)`, across the whole row) whenever
  `balance === 0` - snacks and payments net out exactly, nothing owed and
  no credit sitting unused, so it's worth a quiet visual cue that this
  account needs no attention, distinct from the existing per-cell red
  "Credit" styling for a negative balance.

## Fix: basket/cart disappeared after adding to it or resolving a Snack Log item (2026-07-27)

- `FS.loadData()`'s own "profile" field is app-wide settings, not this
  visitor's own profile - the real profile (`nameSet`, `hasTab`...) only
  ever comes from a separate `FS.getMyProfile()` call, stashed onto
  `data.myProfile` for `render()`'s visitor/guest gate. Two reload paths -
  the "Add to my tab" submit handler and `performEntryAction()` (review-
  item/mark-paid/confirm-item on the Snack Log) - only did
  `LAST_DATA = await FS.loadData()` and skipped that second call, leaving
  `data.myProfile` `undefined`. `FS.hasActiveTab(undefined)` is false,
  which hides the basket panel/overlay/notification bell entirely and
  flips the whole page into visitor mode (the "Open a tab" prompt) - "the
  cart goes away" right after adding to it, until the next full page load
  quietly fixed it again.
- Not specific to the Admin test profile - any customer hits this on any
  of these two actions - but a real one-off purchase is less likely to
  immediately repeat the action and notice a transient glitch that
  self-corrects on the next visit, while testing repeatedly triggers it.
- Fixed by pulling the "fetch both, stash myProfile" pattern into one
  `refreshTabData()` helper and using it everywhere `LAST_DATA` gets
  reassigned (`startTabFlow()`, the submit handler, and
  `performEntryAction()`), instead of leaving each reload site to
  remember to do both calls itself.

## Existing credit auto-settles new items; fixed 2 spots showing raw negative balances (2026-07-27)

- **Auto-settle from existing credit**: a customer with credit on file
  (from an earlier overpayment) used to still have to click "Mark as paid"
  and wait on admin confirmation for a brand-new item, even though the
  money to cover it was already there - the oldest-first settlement sweep
  (`paymentAllocationPlan`) only ever ran when an admin recorded a payment
  or visited transactions.html (`/payments/reconcile`), never right when
  the customer's own action (self-logging a snack, or confirming an admin-
  added item) put something new on CONFIRMED_UNPAID.
  - Moved `allocateApprovedTransactions()` out of admin.js into a new
    shared `functions/src/lib/settlement.js` (admin.js now imports it) so
    store.js can call it too.
  - `POST /store/transactions` (self-log) and `applyUserAction()` (backs
    confirm-item/review-item/mark-paid) now call it immediately after
    landing a transaction on CONFIRMED_UNPAID, using a fixed
    `"auto-settlement"` actor sentinel for the audit trail instead of a
    real admin uid, since nobody actually clicked anything for this
    specific settlement.
  - Existing admin-triggered call sites (`/payments/permanent`,
    `/payments/reconcile`) are unchanged, still passing the real admin's
    uid.
- **Fixed 2 real bugs showing a raw, unlabeled negative balance** instead
  of "Available credit $X" like everywhere else in the app:
  `invoice.html`'s balance stat-box and its bottom-summary table row both
  did `FS.money(totals.balance, cur)` directly with no `< 0` check, unlike
  index.html/edit-tab.html/transactions.html/accounting.html, which all
  already handled it correctly. Also tightened `admin.html`'s Add
  Adjustment customer dropdown, which had the same gap. Verified this by
  auditing every balance-rendering call site in the app, not by inspecting
  live account data directly.

## Artwork previews: image fills and centers in the square box (2026-07-27)

- The regular catalog photo preview used `object-fit: contain`, which
  letterboxes a non-square upload (empty space on the sides or top/bottom)
  instead of filling the now-square box. Switched to `object-fit: cover`
  (matching what the favorite-background preview already did) so the image
  fills the box edge to edge, with `object-position: center` (its own
  default, restated for clarity) so the crop stays centered rather than
  anchored to a corner.
- `.artwork-preview-wide` is gone from the markup too - it had no CSS left
  behind it once both previews became the same square/cover treatment, so
  it was dead weight, not a distinction that still meant anything.

## Artwork preview boxes are proportionate now, not a thin strip (2026-07-27)

- `.artwork-preview` had a fixed 150px height regardless of how wide its
  grid column stretched, so it read as a thin strip rather than something
  you could actually inspect an upload in. Both previews - the regular
  catalog photo and the favorite-background image - now share the same
  `aspect-ratio: 1/1` (a real square that grows with the column) so uploads
  are shown at a larger, more prominent size either way. (An initial pass
  kept the favorite-background preview at 16:9; changed to match the
  regular photo at 1:1 instead, per follow-up feedback.)
- Both the catalog page's "Artwork uploads" section and the per-card
  upload modal share these same classes, so both got larger, clearer
  previews from one CSS change.

## Per-card photo upload on the catalog page (2026-07-26)

- Each catalog card (both gallery and row views) now has a camera icon
  that opens a small modal to upload that snack's two images (catalog
  photo and favorite background) directly - no more finding it in the
  separate "Artwork uploads" section's snack dropdown first. That section
  is untouched and still works exactly as before, for whoever prefers it.
- New `AdminModals.uploadArtwork(snack, { onUpload })` in
  `js/admin-modals.js` - like `editListing`, the modal doesn't touch
  Firestore/Storage itself, it just drives whatever `onUpload(kind, file,
  onProgress)` function the caller passes in (catalog.html's already-
  existing `FS.admin.uploadSnackImage`) and updates its own live preview
  from the URL it returns.
- Built as a modal rather than a dropdown from the card itself specifically
  because `.catalog-card` has `overflow: hidden` (for its rounded photo
  corners) - a dropdown positioned to extend past the card would have been
  silently clipped. A modal renders at the body level via admin-modals.js's
  existing injection pattern, so it isn't affected by that.

## Fix: expanded customer group repeated its own Purchases/Payments/Balance (2026-07-26)

- `<summary>` stays visible whether its `<details>` is open or closed, so
  the Purchases/Payments/Balance stats it carries (`.collapsed-ledger-stats`)
  sat right on top of the same three numbers restated in
  `.user-ledger-overview` just below, once a customer group was expanded.
- Hid the summary's copy specifically while open (`details[open] > summary
  .collapsed-ledger-stats { display: none; }`) - collapsed still shows the
  at-a-glance stats as before, expanded shows only the fuller version
  (which also has the Record payment button) instead of both at once.

## Add snack now takes an initial Stock amount (2026-07-26)

- The "Add snack" form only had Name/Price/Calories - stock could only be
  set afterward by editing the newly-created card. Added a Stock field
  (same "Not tracked" placeholder as the per-card one) so a starting
  inventory count can be set at creation time in one step.
- Left blank, it's sent through as `null` (same as every other Stock field
  in the app) rather than just omitted - `PUT /admin/snacks/:id` already
  handled this correctly for both create and update, so no backend change
  was needed.

## Catalog stats section (2026-07-26)

- New stats card at the top of catalog.html, matching the same `.brand-card`/
  `.brand-stats` pattern already used on admin.html's dashboard and
  inventory.html's Location inventory section: Active snacks (X/Y), Tracked
  stock units, and Inventory value.
- Inventory value here is each snack's `price × stock` (its own Stock field
  on the catalog card), summed only over snacks where stock is actually
  tracked ("Not tracked" ones contribute nothing) - a different basis than
  inventory.html's own "Inventory value" stat, which is computed from
  basket/floor placement instead. A caption under the stats says so, so the
  two same-named numbers on different pages aren't mistaken for each other.
- Computed entirely client-side from the snack list catalog.html already
  fetches (`GET /admin/snapshot`) - no new backend endpoint, and it
  recomputes live as snacks autosave (price/stock/active edits), not just
  on page load.

## Reverted: inactive snacks are hidden from the gallery again, not shown sold-out (2026-07-26)

- Earlier today's change made inactive snacks display like sold-out (visible,
  red ribbon, no Add to basket) instead of disappearing from the customer
  gallery entirely. Decision reversed: inactive is back to fully excluded
  from what customers see, same as before that change - `GET /store/data`
  and `FS.loadData()`'s no-session branch both call `getCatalogData(false)`/
  `FS.getCatalog()` (active-only) again.
- Sold-out (`stock === 0`) is unaffected and keeps everything from that same
  change: the red ribbon, and the Add to basket button/quantity stepper
  removed outright rather than merely disabled. `index.html` and `bins.html`
  no longer check `active === false` at all for this, since an inactive
  snack now never reaches the client's catalog data in the first place -
  removed as dead code rather than left in place unreachable.

## Transactions ledger: header/value alignment fix, and purposeful payment fields (2026-07-26)

- **Header/value alignment bug** (affected every `.admin-table` app-wide, not
  just Transactions - accounting.html, edit-tab.html, catalog.html,
  inventory.html too): `.admin-table th { text-align: left }` has higher
  CSS specificity (class+element) than the plain `.num`/`.num-money`
  classes those same header cells also carry, so a `<th class="num">` was
  silently rendering left-aligned instead of matching its column's actual
  right/center-aligned values - Qty and Value headers pointed a different
  way than the numbers underneath them. Added `.admin-table th.num`/
  `.admin-table th.num-money` overrides with matching specificity so
  headers now genuinely follow their column's alignment.
- **Digit alignment**: transactions.html's money cells (`Value` column,
  both the main ledger and the Voided sub-table) now wrap their value in
  the same `<span class="mv">` fixed-width-box pattern already used on the
  customer-facing pages (index.html's Snack Log, invoice.html) - amounts of
  different digit-lengths now start at the same left edge instead of each
  being centered independently within the column.
- Verified via CSS specificity analysis and syntax checks (all script
  blocks + CSS brace balance); this environment has no browser/screenshot
  tool available, so the fix was not visually confirmed in a live render.
- **Payment note field cleanup**: `settlementPaymentWrite()` (used by
  mark-paid/confirm-payment when a transaction finalizes) no longer
  synthesizes a `note: "Settles <snack name>"` string - `note` now stays
  the same empty default every other payment-creation path already uses
  when no note was given. What a payment settles was already partly
  structured (`settlesTransactionId`), so `settlesSnackId`/
  `settlesSnackName` were added alongside it - denormalized, purposeful
  fields for later analysis instead of an item name folded into free-text
  prose. Existing historical payment records keep whatever note they
  already have; this only changes what new ones get.

## Catalog view now matches the customer gallery's curated order (2026-07-26)

- `GET /admin/snapshot` returned snacks in raw Firestore document order, not
  the `displayOrder`-based order the customer-facing gallery already uses
  (`store.js`'s `getCatalogData`, driven by dragging cards in catalog.html's
  own Gallery view) - so catalog.html's row/gallery lists didn't match what
  customers actually see. Now sorted with the same `compareSnackOrder`
  helper on the way out, so both admin views (row and gallery) line up with
  the already-curated customer order with no separate migration needed -
  `displayOrder` was already the source of truth, it just wasn't being read
  here.

## Fix: admin test profile picker could silently fail to open the chosen account (2026-07-26)

- The account picker shipped earlier today minted a real device-link invite
  (`FS.admin.createLinkInvite` + auto-accepting it via `FS.loginWithInvite`)
  to portal into the chosen account. That mechanism is capped at 3 linked
  devices per account by design (for real multi-device family tab
  sharing) - an actively-used real account like Xavier Hemmings' can
  already have those slots full, so the auto-accept could fail. Worse, the
  failure was caught and silently swallowed, so the page still loaded fine
  - just as this browser's own unlinked (nameless) identity, with nothing
  explaining why it wasn't showing the expected account.
- Real fix: dropped the invite-code mechanism entirely for this feature.
  `middleware.js`'s `resolveEffectiveUid()` now trusts a verified admin's
  requested `effectiveUid` outright (same "isAdmin() first" precedent
  `authz.js`'s `canAccessTab()` already used) - an anonymous or otherwise
  non-admin caller still goes through the normal linkedUids/session checks
  unchanged. `FS.admin.portalIntoAccount(userId)` just sets this browser's
  `linkedTo` marker directly (the same marker a real linked device uses)
  before navigating to `index.html?profile=admin-test` - no invite code, no
  device-link slot consumed, and it can't fail because a real account's 3
  slots are already taken.
- `index.html`'s `startTabFlow()` needs no special-casing for this at all
  now - it's back to its original form. `FS.loadData()`/`FS.getMyProfile()`
  already read the `linkedTo` marker for any genuinely linked device; the
  server-side trust change is the only thing that's new.

## Admin test profile: portal into a real account instead of a stale clone (2026-07-26)

- Root cause of the drift: `POST /admin/test-profile` cloned a source
  customer's transactions/payments/adjustments into a separate
  `admin-test-profile` doc **once**, the first time it was ever opened, then
  reused that same doc forever - `sourceUserId` was only read on that first
  call. Xavier Hemmings' real account (`cust-d9zytpnw`, the hardcoded
  source) kept changing after that; the clone didn't, so the two silently
  decoupled over time even though they looked identical at first.
- Fix: removed the whole clone-a-copy mechanism. Admin.html's "Test customer
  profile" card is now an account picker - a dropdown of every real
  customer account (defaulting to Xavier Hemmings' account specifically,
  matched by known id or by display name) plus a "+ Create a new account"
  option with a name field that only appears when it's selected. Opening it
  now portals into whichever account is chosen via the exact same real
  link-invite mechanism as any multi-device tab share
  (`FS.admin.createLinkInvite`, reusing the existing self-service invite
  route rather than a new one) - there's no separate copy of the data to go
  stale, because there is no copy at all anymore.
- `POST /admin/test-profile` and `FS.admin.openAdminTestProfile()` are
  removed entirely (superseded by `FS.admin.createGuestTab()` +
  `FS.admin.createLinkInvite()`, both of which already existed for other
  flows). The old `admin-test-profile` Firestore doc and its cloned records
  are left in place untouched (not proactively deleted) but excluded from
  the new picker's dropdown, since portaling into it would just reopen the
  same stale snapshot this fix replaces.

## Catalog autosave/queue, snack delete, inactive-as-sold-out, and a new Stats page (2026-07-26)

- **Catalog autosave**: every field on a catalog card now writes directly -
  there's no Save button to press. Edits debounce for three seconds (same
  pattern as Accounting/Edit Tab's customer name/status debounce) keyed to
  the snack's own id. A second queue (a promise chain per id) serializes the
  actual network call: if a save for a given snack is still in flight when
  the next debounced save for that *same* snack fires, it's chained after
  the in-flight one instead of firing alongside it, so two writes for one
  snack can never race on the wire. Different snacks save independently and
  never block each other. A per-card status word ("Saving…"/"Saved"/error)
  replaces the old Save button; nothing about the card re-renders on a
  successful autosave, so it never clobbers an admin's in-progress edits on
  another card.
- **Deactivate button removed**: Active/Inactive in each card's own Status
  field was already the real control - a separate Deactivate button just
  duplicated it. The one remaining destructive action is a bin/trash icon
  button that permanently deletes the snack: `DELETE /admin/snacks/:id` now
  removes the Firestore doc, both uploaded Storage images (photo and
  favoritePhoto), and prunes this snack's entries out of every inventory
  basket's `items` array. Historical transactions/payments are deliberately
  untouched - they already snapshot snackName/price at purchase time and
  don't depend on the live snack doc.
- **Stock placeholder + calories field**: "Not tracked" was rendering in the
  browser's default (barely visible) placeholder color - now uses a real,
  legible muted color. Calories is capped at 999 (a `max="999"` attribute
  plus a matching input-clamp, since a snack calorie count is always under
  1000) and its input is now visually small instead of full-width, matching
  that it's shown to customers but never drives an admin decision.
- **Card redesign**: catalog cards (both gallery and row/table views) were
  reorganized around the changes above - a compact fields grid (Price/
  Stock/Status), a demoted small Calories field below it, and a footer that
  is just the autosave status word plus the delete icon button, instead of
  the old two-button Save/Deactivate row.
- **Inactive now displays like sold-out, everywhere a customer can add a
  snack to a tab**: Inactive was previously invisible to customers entirely
  (`GET /store/data`/`GET /store/catalog` excluded it via
  `getCatalogData(false)`) - now both include inactive snacks
  (`getCatalogData(true)`), and `index.html`, `bins.html` render the same
  red diagonal "Sold out" ribbon over the photo for `stock === 0` OR
  `active === false`, with the Add to basket button (or bins.html's +/-
  stepper) removed outright rather than merely disabled - there's no
  control left to add it with. Purchase validation
  (`POST /store/transactions`, admin's add-to-tab route, transaction edit/
  merge routes) already independently re-checks `active === false`
  server-side and was left untouched - only the *display* fetch changed,
  so a delisted snack still can't actually be purchased through either
  path.
- **New Stats page** (`stats.html`): a quick, intentionally rough usage
  dashboard, not a precise Firestore metering system. `functions/src/lib/
  stats.js` counts requests at the API level (GET = a "read", every other
  method = a "write") as a proxy for Firestore activity - not exact
  per-document read/write counts, which would need instrumenting every one
  of the 1000+ lines of existing route code rather than one small
  middleware. Counts batch in memory and flush to a single `stats/
  api-usage` Firestore doc every 30 seconds (so the dashboard's own
  overhead stays negligible), bucketed per UTC day. The page shows total
  reads/writes, a 14-day hand-drawn stacked bar chart (no chart library),
  and a static reference grid of documented Firestore Spark/Blaze plan
  limits (50k reads/day, 20k writes/day, 1 MiB per document, etc.) -
  clearly labeled as reference info, not a live quota read from Google's
  billing API. Linked from every admin page's header nav.

## Fix: Admin test profile sometimes had no Add to basket button (2026-07-26)

- Root cause: `POST /admin/test-profile` minted a `type: "view"` code for
  the Admin test profile. A view code only ever grants read access -
  `resolveEffectiveUid()` never resolves it to the viewed tab's owner (only
  a `type: "link"` code does that, per `middleware.js`'s
  `linkedTargetFromClaim()`), and `FS.getMyProfile()`/`FS.addTransaction()`
  don't even look at it - they only ever check `linkedTo`/`sessionTo` in
  localStorage. So `renderBinsGallery()`'s `hasOwnTab` check was really
  asking "does the browsing device's own, usually-tabless identity have an
  active tab?", not "can this session act on admin-test-profile?" - which
  is why the whole gallery's Add to basket buttons (and Tell a Friend, the
  basket panel/overlay/notification bell) went missing whenever that browser
  had no unrelated tab of its own, and - worse - would appear but silently
  target the wrong tab whenever it happened to have one from unrelated prior
  testing.
- Fix: `POST /admin/test-profile` now mints a `type: "link"` code instead
  (both on first creation and its repair path), and no longer pre-seeds a
  `claims/{uid}` doc itself (that shape was for view claims and wasn't even
  guaranteed to match the uid that would actually browse the URL). The
  returned URL is `index.html?link=<code>&profile=admin-test` instead of
  `?code=<code>&profile=admin-test`.
- `js/firebase-admin.js`'s `openAdminTestProfile()` now stores the code
  under `FS.linkCodeKey` instead of `FS.tabCodeKey`.
- `index.html`'s `startTabFlow()` auto-accepts a pending link code via the
  existing `FS.loginWithInvite()` helper (same accept-with-device-limit-
  fallback logic real multi-device tab sharing already uses) whenever
  `?profile=admin-test` is present, skipping the normal explicit "Link this
  device" click - safe here specifically because this URL is only ever
  minted by an authenticated admin action, never shared with anyone else.
  Errors are swallowed and the page still loads (degrading to the old
  behavior, recoverable by reopening the test profile from the dashboard).

## Status badges: who added it, and who put the payment on record (2026-07-26)

- `CONFIRMED_UNPAID`'s admin badge used to read "Customer confirmed"/"Admin
  confirmed" based on whether `userConfirmedAt` was set - which conflated a
  customer explicitly confirming an admin-added item with a customer simply
  self-logging their own snack (auto-confirmed at creation, never actually
  "confirmed" by anyone). It now reads **"Customer added to tab"** /
  **"Admin added to tab"** based on `createdByRole` instead - who originally
  put the line item on the tab, a stable fact set once at creation, rather
  than who most recently touched its confirmation state.
- `PAID_FINALIZED` used to always read "Paid - Final" regardless of path.
  It now reads **"Payment Confirmed - Final"** when `paymentMarkedByRole`
  is `USER` (the customer reported paying via `POST /store/transactions/
  :id/mark-paid`, and an admin later confirmed that claim, possibly after a
  review detour), and stays **"Paid - Final"** when it's `ADMIN` (the admin
  recorded the payment directly, e.g. cash handed over, with no prior
  customer report) - `paymentMarkedByRole` is only ever set once, by
  whichever mark-paid route actually ran, and `confirm-payment`/
  `review-payment` never touch it, so it's a reliable signal regardless of
  how many review steps happened in between.
- Backend: `GET /admin/snapshot` and `GET /admin/users/:userId/transaction-
  history` both now attach `createdByRole` (via the existing
  `deriveCreatedByRole()` fallback for older records) to every enriched
  transaction, alongside the `workflowStatus`/`availableActions` they
  already attached. `paymentMarkedByRole` needed no backend change - it was
  already passed through via the existing raw-record spread.
- Scope: this only changes the admin-facing badges in `transactions.html`/
  `edit-tab.html`. The customer-facing tracker in `index.html` still shows
  a plain "Paid - Final" for every finalized transaction - it wasn't part
  of this request, and the customer already knows whether they were the
  one who reported paying.

## Edit available directly from payment-pending/under-review, not just after Review (2026-07-26)

- Previously an admin had no way to edit a transaction's quantity/date once
  the customer reported paying (`PAYMENT_PENDING_ADMIN_CONFIRMATION`,
  "Customer reported payment") or once the admin put that claim under review
  (`PAYMENT_UNDER_REVIEW`, "Admin reviewing payment") - `EDIT` simply wasn't
  in `availableActions` for either status, and clicking "Review payment"
  first didn't unlock it either.
- `functions/src/lib/transactionStatus.js`: both statuses now also allow
  `ACTION.EDIT` for the admin role, landing back on
  `PENDING_USER_CONFIRMATION` - the same "content changed, so start the
  confirmation cycle over" rule `CONFIRMED_UNPAID`'s `EDIT` already follows.
  Review Payment is not a prerequisite for this - both actions are simply
  available side by side once a payment claim exists.
- `PATCH /admin/transactions/:id` now accepts a source status of
  `PAYMENT_PENDING_ADMIN_CONFIRMATION`/`PAYMENT_UNDER_REVIEW` in addition to
  the three it already allowed, and clears every payment-progress marker
  (`paymentMarkedAt/By/ByRole`, `paymentConfirmedAt/ByAdminId`,
  `paymentReviewedAt/ByAdminId/Reason`, `paymentClaimRejectedAt/By/Reason`)
  on every edit - the same set `RESET` already clears - so an edited
  transaction never keeps a stale claim/review marker pointing at
  pre-edit values.
- No client-side change was needed: `transactions.html`/`edit-tab.html`'s
  `renderTxnActions()` already renders a generic "Change" button whenever
  `EDIT`/`EDIT_AND_RESEND` is in the server-supplied `availableActions` list,
  so it now simply appears for these two statuses' row menus too.

## Notification click filters transactions.html to one customer (2026-07-26)

- Clicking an admin notification already navigated to
  `transactions.html?user=<id>&txn=<id>` and auto-opened/highlighted that
  customer's group, but every other customer's group still rendered above
  and below it, so filed cases pushed the target group below the fold. The
  `user` param now filters the whole `#txn-groups` list down to just that
  customer instead of only auto-expanding it among everyone else.
- A "Showing only X, opened from a notification" notice appears above the
  list whenever the filter is active, with a "Show all customers" button
  that clears the `user`/`txn` params (via `history.replaceState`, no full
  reload) and re-renders the full list.
- Navigating to `transactions.html` directly (no `user` param) is unaffected
  - full customer list, no notice.

## Voided transaction visibility and permanent delete (2026-07-26)

- Voiding a transaction (`CANCEL`) previously made it disappear entirely from
  `transactions.html`/`edit-tab.html`, since `GET /admin/snapshot` and
  `GET /admin/users/:userId/transaction-history` both filtered
  `status === "void"` records out before returning. They're still excluded
  from every balance/accounting calculation - that's correct and unchanged -
  but an admin had no way to review or act on what got voided.
- Both endpoints now return a separate `voidedTransactions` array alongside
  the existing (unchanged) active `transactions` array. The transaction-
  history endpoint's response shape changed from a flat array to
  `{ transactions, voidedTransactions }`; its only caller (`edit-tab.html`)
  was updated to match.
- `transactions.html` (per customer, inside each `<details>` group) and
  `edit-tab.html` (single customer) both render a "Voided transactions"
  sub-table beneath the normal ledger when that customer has any - showing
  day/snack/qty/value and a neutral "Voided" status pill, explicitly noting
  the totals above already exclude them.
- Permanently deleting a voided row reuses the existing `deleteTransaction`
  permission and the existing `DELETE /admin/transactions/:id` route (which
  already deleted by ID with no status filter) - only rendering a Delete
  button next to voided rows was new. Grandfathered (no `permissions` map)
  admins - "the highest elevation" - see it on every voided row; admins with
  an explicit `deleteTransaction: false` do not.

## Admin permission system, Reset action, and row-menu cleanup (2026-07-26)

- New `RESET` workflow action: "do nothing to the record, just put it back
  in the user's hands to confirm" - distinct from Edit/Edit and Resend,
  which also change quantity/date/price. Available to admins from
  `CONFIRMED_UNPAID`, `ITEM_UNDER_REVIEW`, `PAYMENT_PENDING_ADMIN_
  CONFIRMATION`, and `PAYMENT_UNDER_REVIEW`, always landing back on
  `PENDING_USER_CONFIRMATION` with every downstream progress marker
  (confirmation, review, payment-report/confirm/reject) cleared.
- New granular admin permission system (`functions/src/lib/permissions.js`):
  every sensitive transaction/payment action (`editTransaction`,
  `resetTransaction`, `cancelTransaction`, `deleteTransaction`,
  `approveItem`, `markPaid`, `confirmPayment`, `reviewPayment`,
  `rejectPaymentClaim`, `manageAdmins`) is gated by a permission key on the
  calling admin's own `admins/{uid}.permissions` map, enforced server-side
  via `requirePermission()` in `middleware.js` on every route it applies to
  - client-side checks only control what renders, never what's allowed.
  A **missing** `permissions` map grandfathers full access (today's real
  admin accounts predate this and are not locked out), matching this
  project's established grandfather-existing/gate-going-forward precedent.
  Once a map exists, only an explicit `false` denies.
- Three role presets (`admin`, `accounting`, `cashier`) are UI starting
  points only - the toggle table is the actual source of truth, so any
  individual permission can be hand-adjusted per admin regardless of which
  preset it started from. `accounting` gets full operational access except
  delete and admin-management; `cashier` gets only mark-paid/confirm-payment.
- New `admin-users.html`: lists existing admins with a permission summary,
  creates new ones (email + password only - Google/Microsoft admins need
  their first OAuth sign-in before a uid exists to attach permissions to,
  same limitation the system already had), and edits an existing admin's
  display name/permissions/active state. Gated by `manageAdmins`; every
  other admin page's nav now includes a same-gated "Admin Users" link.
  Scope is intentionally limited to transaction/payment actions - this
  does not yet cover catalog, bins/inventory, or feedback management.
- `transactions.html`/`edit-tab.html` row actions moved from a mix of icon
  buttons and inline text buttons into the same `.row-menu` dropdown
  pattern `accounting.html` already used for its customer rows - "Mark
  paid" is the one action that stays a standalone button, per explicit
  request. Menu items are filtered by both `availableActions` (workflow-
  valid) and the signed-in admin's own permissions before rendering.
- `POST /payments/:id/void` and `DELETE /payments/:id` now require
  `cancelTransaction`/`deleteTransaction` respectively - without this, an
  admin lacking `deleteTransaction` on transactions could still achieve
  the same permanent-removal result through a payment record instead.

## Transaction confirmation/payment workflow rewrite (2026-07-26)

Implements `tab_transaction_flow_implementation_spec.md` - replaces the old
two-axis `reviewStatus` (neutral/approved/paid) + `userStatus` (agreed/
disputed) pair with one authoritative `workflowStatus` per transaction:
`PENDING_USER_CONFIRMATION`, `ITEM_UNDER_REVIEW`, `CONFIRMED_UNPAID`,
`PAYMENT_PENDING_ADMIN_CONFIRMATION`, `PAYMENT_UNDER_REVIEW`,
`PAID_FINALIZED`, `CANCELLED`. All transition rules, the per-role available-
action resolver, and the audit-event types live in one new file,
`functions/src/lib/transactionStatus.js` - every route and every page's UI
reads from it rather than re-deriving status logic locally.

- `workflowStatus` is a deliberately different field from the transaction's
  existing `status` ("active"/"void" soft-delete marker used by every
  `.where("status", "==", "active")` query in the app) - naming the new
  field `status` too would have silently broken all of those. Cancelling a
  transaction sets both: `workflowStatus: CANCELLED` and the legacy
  `status: "void"`, so every existing query keeps working unchanged.
- A transaction now also carries `createdByRole` (`USER`/`ADMIN`), set once
  at creation. A user-created transaction starts `CONFIRMED_UNPAID`
  (auto-confirmed) and can never enter `PENDING_USER_CONFIRMATION` at all,
  which is what actually fixes the real bug this spec targets: self-logged
  purchases were showing the Confirm/Review buttons in the customer's own
  Snack Log, when only admin-added items were ever meant to need
  confirmation.
- New customer-facing capability: a user can self-report a transaction as
  paid (`Mark as Paid` in the Snack Log), which moves it to
  `PAYMENT_PENDING_ADMIN_CONFIRMATION` rather than finalizing it - an admin
  still has to Confirm Payment (or Review Payment / Reject Payment Claim)
  before it's `PAID_FINALIZED`. This didn't exist before; only admins could
  previously record a payment.
- Every transition (`confirm-item`, `review-item`, `mark-paid`,
  `approve-item`, `edit` (also covers "Edit and Resend"), `cancel`,
  `confirm-payment`, `review-payment`, `reject-payment`) runs inside a
  Firestore transaction that re-reads the current status, validates it via
  `assertTransition()`, and writes an audit event to a new append-only
  `transactionEvents` collection in the same atomic write - both the
  concurrency protection and the audit trail the spec asks for.
- Product decision (confirmed with the project owner): editing an
  already-`CONFIRMED_UNPAID` transaction's quantity/date resets it to
  `PENDING_USER_CONFIRMATION` rather than applying silently - every admin
  change the user hasn't seen yet requires a fresh confirmation.
- Confirming a user-reported payment or an admin directly marking a listing
  paid now also creates a real `payments` collection record for that exact
  amount, tagged with which transaction it settles. This was a real gap
  found while wiring this up: `accounting()`'s balance math nets total
  purchases against the separate `payments` collection, not against which
  transactions happen to be flagged paid - finalizing one without a
  matching payment record would have shown "Paid" on the row while still
  counting against the customer's balance.
- An item under review (disputed) now stays visible on the customer's own
  Snack Log with an "Under review" status, instead of disappearing from
  their tab entirely until resolved (the old behavior) - it still stays
  excluded from the balance calculation the same as before, just not
  hidden from view.
- Existing transactions are grandfathered rather than retroactively gated:
  `deriveWorkflowStatus()`'s fallback (used both live, for any doc that
  hasn't been backfilled yet, and by the one-off
  `scripts/backfill-transaction-workflow-status.mjs`) maps old admin-created
  listings to `CONFIRMED_UNPAID`, not `PENDING_USER_CONFIRMATION` - the
  business never asked those customers to confirm them, so surfacing a
  sudden backlog of confirmation prompts for old history would be a
  surprising regression, not a fix. Only transactions created after this
  ships start out gated. This mirrors the same grandfather-existing/gate-
  going-forward precedent used for the `nameSet` visitor gate.
- Bug fixed in passing: `asyncRoute()`'s error handler
  (`functions/src/middleware.js`) never included `error.code` (or now
  `currentStatus`) in its JSON response, only `error.message` - every route
  that set a `code` on a thrown error (e.g. the existing device-limit
  fallback in `FS.loginWithInvite`) was silently losing it before it ever
  reached the client. The new 409 `TRANSACTION_STATE_CHANGED` conflict
  response needed this fixed to work at all.
- `functions/test/transaction-status.test.js` and
  `transaction-lifecycle.test.js` are new; `payment-allocation.test.js` was
  extended for the new eligibility rules (unconfirmed and disputed
  transactions are excluded from auto-settlement; one already under payment
  review is excluded too, so an unrelated payment can't silently resolve an
  active dispute).
- Not run yet: `node scripts/backfill-transaction-workflow-status.mjs`
  (dry-run by default, `--apply` to write) should be run once after
  deploying, to backfill `workflowStatus`/`createdByRole` onto every
  existing transaction - not required for correctness (every read path
  already falls back to the same derivation live) but avoids relying on
  that fallback forever.

## Device-access revocation and invite self-service (2026-07-26)

- Unlinking a device from Accounting/Edit Tab now deactivates that device's
  claim, not just its `linkedUids` membership. Previously `canAccessTab()`
  granted access from an active claim before it ever checked `linkedUids`,
  so an "unlinked" device kept full read/write access to the tab
  indefinitely - the 3-device limit was a soft cap in practice. `hasClaimOn()`
  also now requires the underlying invite code itself to still be active.
- Accounting and Edit Tab's invite modal can activate or deactivate a tab's
  existing invite/link code in place, without generating a new one. A
  deactivated code immediately blocks new claims and cuts off anyone
  currently holding a view or session claim through it; a fully linked
  device is unaffected (that still needs the per-device Unlink control).
- Customers can now self-serve a device-link invite from User Settings
  ("Link a device") instead of needing an admin to generate and hand one
  out. The same panel always shows how many devices are linked out of the
  3-device limit, not only once a second device is already present.
- The customer nav drawer's admin-dashboard detection was silently dead
  code - it read Firestore directly through a `FS._db` handle that no
  longer exists since firebase-store.js became a thin API client. It now
  calls `GET /admin/whoami` and treats a 403 as "not an admin." This was
  also the last direct-client Firestore read anywhere in the app; every
  customer/admin page now goes through the API exclusively.
- The customer nav drawer groups its links into labeled sections (Your
  tab / Account / Support, plus Administration for verified admins)
  instead of one flat list.
- The Open-a-Tab modal and the Profile Information editor in User Settings
  now show a red asterisk on fields the current save will actually
  require. Email and phone are required when completing your own tab, but
  not when acting through a link or session claim on someone else's
  already-accountable tab (linking/joining never touches those fields).

## Admin transaction workflow and persistence (2026-07-23)

- Edit Tab now offers an optional transaction diffuser: a basket quantity such as 8 can be stored as eight catalogue-priced quantity-1 listings instead of one quantity-8 listing.
- Unapproved transaction rows on Edit Tab are draggable. Dropping onto a different snack moves the source to the destination date; dropping onto the same snack combines quantities into the destination row and removes the source record.
- Transaction creation and editing no longer trust or accept browser-submitted prices. Customer and admin creation resolve active catalogue records server-side, and listing edits expose only quantity/date while the API recalculates value from the catalogue.
- Payment allocation is restricted to approved transactions and runs oldest-first by transaction date, then creation timestamp, then ID. It settles whole listings only and leaves any unused amount as customer credit.
- Firebase Auth is explicitly configured for local persistence before admin sign-in/session restoration. API requests still verify the refreshed ID token and active admin record on every protected request.
- Customer name/status edits on Accounting and Edit Tab debounce for three seconds and save all visible fields together; explicit Save uses the same whole-form operation.
- The verified-admin notification bell remains visible at a zero count, and affected admin ledgers now have touch-friendly horizontal mobile scrolling.

## Customer session controls (2026-07-23)

- User Settings exposes Log out whenever a Firebase customer/device session is present. Logging out signs out Firebase Auth and clears only this browser's customer, invite, and navigation markers; it never deletes the customer tab or transactions.
- The banner profile/dropdown control now uses a fully rounded pill edge with a separate circular chevron surface.

## Linked-device recovery and profile prompt compatibility (2026-07-23)

- A known linked browser can now recover its target profile from its active server-side link claim when only the browser's local `linkedTo` marker is missing. Recovery requires both an active link-type code and current membership in the target profile's `linkedUids`; view-only claims cannot become device links.
- Switching profiles is now atomic. The destination profile and three-device limit are validated before the browser is removed from any prior profile, and the claim is activated only when the target membership succeeds.
- Existing profiles with a display name, email, and phone are treated as complete even when they predate the `nameSet` field. The same compatibility rule is enforced in the customer client and transaction API.
- The Open-a-Tab modal re-reads the pending invite state after linking and no longer writes a new device's blank form fields over an existing shared profile.
- The customer page begins in an explicit authentication-loading state. Profile fields and tab controls stay hidden until Firebase Auth and effective linked-profile resolution have both completed; failures show the retry panel without exposing partially populated controls.
- Visitor and active-tab presentation now share one server-backed `hasTab` decision. Complete profiles and older profiles with recorded transactions/payments are active tabs; empty anonymous or feedback-only records remain visitors. Only visitors see “Open a tab,” and snack-card/modal actions use that same concise label.
- A read-only shared-tab claim is its own explicit presentation state: it shows the shared tab without visitor prompts, but does not expose basket controls that would write against the viewer's separate identity.

## Customer recommendations and private analytics (2026-07-17)

- Average purchase per active day and active-day count were removed from the customer profile and customer activity summary. They remain available to administrators as customer-level columns on Accounting.
- The profile now offers up to three catalogue recommendations with plain-language, comparative reasons. Each recommendation can be dismissed locally for that profile without creating Firestore records.
- The basket no longer occupies a gallery column. The gallery uses the full content width, while the top-right basket notification opens a fixed overlay panel containing all quantity and checkout controls.

## Bake N Wake-inspired customer gallery (2026-07-17)

- The customer snack catalogue now follows the image-led shop hierarchy used by `doxservices.com/demo/bakenwake`: a centered catalogue heading, larger product imagery, left-aligned names and prices, and a visually distinct order summary alongside the gallery.
- Fresh Snacks colors, nutrition links, quantity steppers, modal behavior, and Add to my tab flow remain unchanged functionally.
- Desktop retains three product columns and the sticky selection panel. Mobile retains two compact columns, stacks the selection panel, and has no horizontal overflow at 390px.
- Product cards now use a single Add to basket action instead of per-card counters. Product previews also add one item at a time, while all quantity changes and removals are centralized in the selection panel.
- A fixed top-right basket notification shows the number of distinct snack selections, regardless of each selection's quantity, and brings the user directly to the basket controls.

## Customer profile load health (2026-07-17)

- Root cause of the frozen profile was a synchronous `qrcode()` call in `index.html` running before the deferred QR library. The resulting `ReferenceError` stopped the customer profile bootstrap before catalog, balances, transactions, or settings could render.
- Tell-a-Friend QR rendering now waits for `DOMContentLoaded`, after deferred scripts have executed, and safely skips QR rendering if the optional library is unavailable.
- The customer page now catches global script failures, unhandled promise failures, and profile-load failures; it replaces the indefinite loading state with a visible message and Retry action.
- Profile startup also times out after 12 seconds with a connection-focused message, covering stalled requests that never return an error.
- The Admin test profile uses the same `index.html` bootstrap as regular customers, so it remains the manual production canary without creating separate monitoring data artifacts.

## Admin test profile recovery (2026-07-17)

- The Admin dashboard now presents a visible **Test customer profile** card in addition to the header link.
- `openAdminTestProfile()` no longer requires the original source customer after the deterministic `admin-test-profile` has already been created.
- Before opening the customer index, the helper validates the stored view code and recreates it when missing, inactive, the wrong type, or linked to the wrong profile.
- The customer page URL includes `profile=admin-test` for diagnosis while retaining the private view code used by the existing claim flow.

## Basket terminology and inventory hierarchy sorting (2026-07-17)

- Customer-facing and administrator-facing copy now uses **basket** instead of **bin**. Existing internal identifiers, function names, query parameters, and Firestore `recordType: "bin"` values remain unchanged for data compatibility.
- The left inventory hierarchy now owns its drag events; the parent card-grid drag handler no longer cancels drags that begin in the hierarchy.
- Edit and delete basket actions use dedicated outline SVG icons consistent with the existing copy control.
- Collapsed transaction customer rows now show purchases, payments, and balance or credit without requiring expansion.

## Admin sitemap and inventory QR codes (2026-07-17)

- Admin header links no longer receive individual QR buttons. QR generation for application pages is centralized on the admin-only `sitemap.html` page.
- The sitemap presents customer and administrative page hierarchy, plus live inventory floors and bins after administrator authentication.
- Each floor header and bin card on `inventory.html` has an explicit QR button. Its code links back to the protected inventory page with a stable `floor` or `bin` query parameter; after authentication, the destination scrolls into view and is highlighted.
- Inventory remains admin-only. This change does not expose physical stock documents through public Firestore rules.
- Customer drawer QR buttons remain available; the removal applies to the admin header navigation.

## Location-based bin CRUD (2026-07-16)

- `inventory.html` is the admin Bins page; customer self-service remains on
  `bins.html` and the index page.
- Bin records live in `/inventory` with `recordType: "bin"`, so the existing
  admin-only Firestore rule applies without a new rules deployment.
- First authorized use seeds nine locations once: two on 9th Floor; Desk, HR
  1, HR 2, Kitchen, and Hall on 6th Floor; Nanda 1 and Nanda 2 on 5th Floor.
- Seasonal templates use Oreo, Banana Chips, Chee Zees, and Cheese Krunchies.
  Standard and J$100 templates start with one each; Large starts with two each;
  Custom starts empty. Every quantity remains editable.
- Inventory value is calculated from current catalog prices and is not stored
  as duplicated data on the bin document.
- Existing bins appear as reusable templates in the add/edit form. Snack
  searches filter the editor without clearing quantities, and editor/bin tables
  stay inside six-row scroll frames.
- Floor controls rename every bin on a floor or duplicate the full floor under
  a new name. Individual floor and location names remain editable per bin.
- Floor headers also add bins and cascade-delete the floor's bins after
  confirmation. Saved bins are the only reusable templates shown; built-in
  templates are hidden. Bins can be dragged within a floor and their global
  `displayOrder` is persisted.
- Floor and bin names support inline editing. Bin snack rows use compact numeric
  inputs with native up/down spinner controls, and each card has icon actions including same-floor duplicate,
  and every floor ends with a dashed add-bin cutout. The cutout opens a chooser
  that copies a selected existing bin into the new floor spot.
- Names and quantities now render as text controls until clicked, then reveal
  the corresponding input. Card headers remain drag surfaces outside those
  interactive labels. A sticky left layout well mirrors floors and bins; bin
  rows dragged there persist the card order. Dropping a card or layout item on
  a floor's add cutout duplicates it into that floor. Floors are also draggable
  from either the full page header or the left-well floor heading; their order is
  persisted by keeping each floor's bins together in global `displayOrder`.
- The layout well is an off-canvas drawer opened from the fixed left-edge Layout
  control. It overlays the page at every viewport and never narrows inventory
  cards or forms. Both the drawer list and gallery cards use the same persisted
  bin position; two-column gallery dragging accounts for horizontal placement.
- Drag-to-copy has a pointer fallback in addition to native HTML drag/drop, so a
  mouse, touch pointer, or automation drag released on Add Bin uses the same
  duplicate operation reliably. Add Bin remains outside the ordered card list,
  so it cannot displace a saved bin in the two-column gallery.
- Inventory now has one global floating Add Bin target rather than one target
  per floor. Dropping a bin copies it onto the dragged bin's existing floor.
  Clicking the target opens the source chooser and follows the selected bin's
  floor. The target stays fixed at the right edge without narrowing bin cards.
- The global Add Bin target is mounted at the inventory-app level instead of
  inside the rendered floor list. Its fixed, viewport-clamped position now
  remains available as the user scrolls, and inventory-level event delegation
  preserves click, desktop drag/drop, and pointer-based copy behavior.
- On wide screens, the Add Bin target is horizontally centered in the unused
  margin to the right of the 1040px page. A 22px minimum inset keeps the card
  safely on-screen when that outside margin is narrower than the card.
- The inventory overview now includes per-floor analysis cards showing bin
  count, snack units, inventory value, and the leading floor's percentage of
  total value. The floating Add Bin target is 50% larger (240x198px desktop),
  and its right-margin centering formula accounts for the new width.
- Floor totals now appear both in the Local Inventory overview and inside each
  large floor banner. Both surfaces show total inventory value and units, with
  bin count retained in the overview; typography uses restrained medium weight
  rather than bold-heavy emphasis.
- The floating Add Bin target now sizes itself to the right-side well: it keeps
  16px minimum breathing room, grows only to 210px, and remains centered in the
  available margin. It is hidden at 1390px and below because each bin's existing
  duplicate control provides the same copy action on tablet and mobile.
- Bin cards now use consistent inline SVG icons for the bin identity, drag
  handle, copy, edit, delete, and Add Bin actions. Viewports at 1390px and below
  suppress the floating Add Bin target unconditionally because the per-bin SVG
  copy action remains available. Inventory-specific typography
  uses regular and medium weights instead of repeated heavy bold treatments.

## Customer payment ledger (2026-07-17)

- Transactions now combines purchases and payment records by customer. Each
  customer header shows purchase value, payments, balance due, or available
  credit when payments exceed purchases.
- Purchases begin neutral. Admin approval moves them to approved; Mark paid
  opens the permanent payment confirmation. Approved purchases are settled
  oldest-first, stopping before the first purchase the available funds cannot
  fully cover. Remaining funds stay visible as future credit.
- Payment records are created only by authorized administrators and have no
  individual edit/delete controls. The previous Add Payment forms were removed
  from Dashboard and Edit Tab; both now link to the unified payment ledger.
- Visible admin copy uses business language such as "removed permanently" and
  "cannot be restored" instead of database and authentication terminology.

## Navigation QR copy controls (2026-07-16)

- `js/qrcode.js` was already present in the stack. Navigation destinations are
  generated on demand; no QR image files need to be prepared or stored.
- `js/nav-qr.js` adds a QR icon beside customer drawer links and admin header
  links. Pressing it renders that link's absolute URL as PNG and copies the QR
  image to the clipboard, with an accessible status toast.
- QR controls use a flat, borderless treatment with no resting shadow. The
  active state moves down and contracts slightly to read as a physical press.
- Pressing a navigation QR icon opens one shared modal across customer and
  admin pages. It shows a large scannable code, the readable destination URL,
  and flat actions to copy either the QR PNG or the text link.

## Admin-managed snack gallery order (2026-07-16)

- Customer snack catalogs use the Firestore `displayOrder` field.
- Until an admin saves an order, the default begins with Oreo, Banana Chips,
  then Plantain Chips; remaining snacks follow alphabetically.
- Admins reorder cards by dragging them in the Catalog gallery view. Dropping
  a card writes the full order to Firestore and updates the index page,
  `bins.html`, and feedback snack dropdown.

## Cloud Storage snack artwork (2026-07-15)

- `catalog.html` includes an admin upload harness for regular catalog artwork
  and favorite-snack background artwork.
- Files are uploaded to `snacks/{snackId}/`; Firestore stores the download URL
  plus its Storage object path.
- Replacing a managed upload removes the previous object after the Firestore
  record is safely updated.
- Bundled files in `assets/` remain fallbacks for records without uploaded
  artwork and are no longer allowed to overwrite a custom upload.
- `storage.rules` permits public reads and active-admin-only image writes, with
  a 10 MB maximum.

## Pilot reversion: profile-gated Request Credit card

Temporary pilot behavior added on 2026-07-15:

- Scope: `feedback.html` at every viewport size during the pilot.
- Request Credit starts disabled and only activates after `FS.getMyProfile()` verifies an existing customer tab.
- Named/legacy profiles are active. Anonymous profiles are only active when the browser has deliberately started or linked a tab.
- Public visitors, feedback-only identities, and unused anonymous/hash identities remain disabled.
- Disabled subtitle: `Coming Soon`; active subtitle: `Snack now, pay later`.
- Disabled design: grey background and border, greyscale icon, muted title/arrow, reduced opacity, and a not-allowed cursor.
- Profile verification is read-only and does not create Auth or Firestore artifacts.

To restore Request Credit after the pilot:

1. In `feedback.html`, replace the two credit subtitle spans (`request-credit-live` and `request-credit-pilot`) with the original single element:
   `<span class="request-desc">Snack now, pay later</span>`.
2. Remove `disabled`, `aria-disabled`, and the coming-soon `title` from the Request Credit button.
3. Remove `creditCard`, `setCreditAvailability`, and the `FS.getMyProfile()` pilot-gating block from the feedback page script.
4. In `styles.css`, remove the credit live/pilot display selectors and all `.request-card[data-category="credit"]:disabled` rules including its icon, image, title, and arrow descendants.
5. Verify for both a public visitor and a signed-in profile that tapping Request Credit opens the modal and the card has the same green/white treatment as the other request cards.
