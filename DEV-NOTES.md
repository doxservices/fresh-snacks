# Development notes

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
