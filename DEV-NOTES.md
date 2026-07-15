# Development notes

## Pilot reversion: mobile Request Credit card

Temporary pilot behavior added on 2026-07-15:

- Scope: `feedback.html` at the mobile breakpoint (`max-width: 560px`) only.
- Request Credit remains visible but is disabled and cannot open its modal.
- Mobile subtitle: `Coming Soon`.
- Normal desktop subtitle remains: `Snack now, pay later`.
- Mobile design: grey background and border, greyscale icon, muted title/arrow, reduced opacity, and a not-allowed cursor.
- Desktop Request Credit behavior and styling remain active and unchanged.

To restore Request Credit after the pilot:

1. In `feedback.html`, replace the two credit subtitle spans (`request-credit-live` and `request-credit-pilot`) with the original single element:
   `<span class="request-desc">Snack now, pay later</span>`.
2. Remove the `creditPilotQuery`, `creditCard`, `syncCreditPilotState`, media-query listener, and initial sync call from the feedback page script.
3. In `styles.css`, remove `.request-credit-pilot` and all mobile rules for `request-credit-live`, `request-credit-pilot`, and `.request-card[data-category="credit"]:disabled` including its icon, image, title, and arrow descendants.
4. Verify at 390px and 320px that tapping Request Credit opens the credit request modal and that the card has the same green/white treatment as the other request cards.
