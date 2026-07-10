# Fresh Snacks

A Firebase-backed snack tab tracker for anonymous phone users, VIP conversion,
and admin accounting.

## Pages

| Page | Purpose |
|---|---|
| [`index.html`](index.html) | Current user's tab, balance, favorite snack, and recent activity. |
| [`bins.html`](bins.html) | Frictionless snack logging. Users sign in anonymously through Firebase Auth. |
| [`invoice.html`](invoice.html) | Printable invoice. Print / Save PDF appears only here. |
| [`admin.html`](admin.html) | Admin accounting, payments, adjustments, users/devices, and snack catalog management. |

## Data model

Firebase Auth handles identity:

- regular snack users use anonymous auth
- admins use Google or email/password auth
- admin authorization is checked against `/admins/{uid}`

Firestore holds the private records:

```text
/settings/app
/snacks/{snackId}
/devices/{deviceId}
/users/{uid}
/codes/{shareCode}
/transactions/{transactionId}
/payments/{paymentId}
/adjustments/{adjustmentId}
/admins/{uid}
```

Browse and edit the live data in the Firebase console:
https://console.firebase.google.com/project/fresh-snacks-ee79f/firestore/databases/-default-/data

`data.json` remains in the repo as legacy migration context only. It is no
longer the writable database.

## Accounting

Balances are computed from raw records:

```text
current_balance = transactions.total + adjustments.amount - payments.amount
```

Transactions are snack activity. Payments are money received. Adjustments are
admin corrections. Keep those records separate.

## Firebase setup

See [`README-FIREBASE.md`](README-FIREBASE.md).

Minimum setup:

1. Add the Firebase Web app config to `js/firebase-config.js`, or enter it in the browser prompt.
2. Enable Firebase Authentication.
3. Enable Anonymous sign-in.
4. Enable Google or Email/password sign-in for admins.
5. Enable Firestore.
6. Publish `firestore.rules`.
7. Seed the first `/admins/{uid}` document.
8. Import `firebase-seed.json` if you want the legacy catalog/history.

## Privacy

The browser does not store or use a GitHub personal access token. Firestore
access is controlled by Firebase Auth and Firestore security rules.

Do not store payment card details, private notes, or sensitive identity data in
public client code. For VIPs, start with display names and only collect contact
information once you have a clear privacy policy.

## Nutrition facts

A snack with `"factsId": "0001"` uses its nutrition facts label image at
[`nutritional-facts/0001.jpg`](nutritional-facts/0001.jpg). The profile and
bins pages open facts images in a lightbox.
