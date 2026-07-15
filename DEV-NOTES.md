# Development notes

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
