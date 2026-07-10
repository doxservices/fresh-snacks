# Fresh Snacks Firebase setup

This branch moves Fresh Snacks from browser-side GitHub token writes to Firebase
Auth plus Firestore.

## Firebase Console

1. Create or open the `fresh-snacks` Firebase project.
2. Add a Web app and copy its config into `js/firebase-config.js`.
3. Enable Authentication.
4. Enable Anonymous sign-in for regular snack users.
5. Enable Google sign-in or Email/password for admins.
6. Enable Firestore.
7. Publish `firestore.rules`.
8. Create the first admin document at `/admins/{yourFirebaseAuthUid}` with:

```json
{
  "uid": "yourFirebaseAuthUid",
  "email": "you@example.com",
  "displayName": "Owner",
  "role": "owner",
  "active": true
}
```

## Firebase CLI

The app login and the Firebase CLI login are separate:

- App login uses Firebase Auth in the browser.
- CLI login uses `firebase login` on this machine so rules, indexes, and hosting can be deployed.

Install and authenticate:

```powershell
npm install
npm run firebase:login
```

Then copy `.firebaserc.example` to `.firebaserc` and replace
`YOUR_FIREBASE_PROJECT_ID` with the Firebase project ID.

For local service-account access, keep the Admin SDK JSON outside the repo and
set it only for the shell running Firebase commands:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\Users\Xavier\Downloads\fresh-snacks-ee79f-firebase-adminsdk-fbsvc-9c6b6929b0.json"
$env:FIREBASE_CLI_DISABLE_UPDATE_CHECK="true"
```

Do not commit Admin SDK JSON files.

Useful commands:

```powershell
npm run firebase:projects
npm run firebase:use
npm run firebase:setup-auth
npm run deploy:rules
npm run deploy:hosting
```

`npm run firebase:setup-auth` enables Firebase Authentication for the app:

- Anonymous sign-in for snack users
- Email/password sign-in for admin fallback

## Seed data

`firebase-seed.json` maps the old `data.json` into Firestore collections:

- `/settings/app`
- `/snacks/{snackId}`
- `/users/legacy-profile`
- `/transactions/{legacyEntryId}`
- `/payments/{legacyPaymentId}`

Import it manually from the Firebase console, a short admin script, or the
Firebase CLI. Replace `REPLACE_WITH_ADMIN_FIREBASE_UID` with your real admin
UID before importing the admin seed.

## Runtime model

Regular users:

1. Open `bins.html`.
2. Sign in anonymously through Firebase Auth.
3. Receive a generated browser/device ID in localStorage.
4. Add snack transactions to Firestore.

Admins:

1. Open `admin.html`.
2. Sign in with Google or email/password.
3. The app checks `/admins/{uid}.active == true`.
4. Admin can view accounting, add payments, add adjustments, and manage snacks.

No GitHub personal access token is used by the browser after this migration.
