/* Fresh Snacks Firebase configuration.
 *
 * Replace the placeholder values with the Web app config from Firebase Console.
 * This object is not a database secret. Firestore privacy is enforced by
 * Firebase Auth plus firestore.rules.
 */

const FS_DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDgdTpvDZCc7a-YPIc5bkwE48STVJOUMUU",
  authDomain: "fresh-snacks-ee79f.firebaseapp.com",
  projectId: "fresh-snacks-ee79f",
  storageBucket: "fresh-snacks-ee79f.firebasestorage.app",
  messagingSenderId: "710277534828",
  appId: "1:710277534828:web:c28bded73237007ff4f449",
};

let fsSavedFirebaseConfig = null;
try {
  fsSavedFirebaseConfig = JSON.parse(localStorage.getItem("fresh_snacks_firebase_config") || "null");
} catch (e) {
  fsSavedFirebaseConfig = null;
}

const fsConfigLooksUsable = (cfg) =>
  cfg &&
  cfg.apiKey &&
  cfg.authDomain &&
  cfg.projectId &&
  cfg.appId &&
  !String(cfg.apiKey).startsWith("YOUR_") &&
  !String(cfg.projectId).startsWith("YOUR_");

window.FS_FIREBASE_CONFIG = fsConfigLooksUsable(fsSavedFirebaseConfig)
  ? fsSavedFirebaseConfig
  : FS_DEFAULT_FIREBASE_CONFIG;

window.FS_APP_CONFIG = {
  appName: "Fresh Snacks",
  currency: "J$",
  anonUserPrefix: "guest",
  devicePrefix: "fs_dev",
  visitorPrefix: "fs_guest",
  storageKeys: {
    deviceId: "fresh_snacks_device_id",
    visitorId: "fresh_snacks_visitor_id",
    uid: "fresh_snacks_uid",
  },
};
