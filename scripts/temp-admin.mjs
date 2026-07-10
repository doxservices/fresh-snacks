/* Creates or deletes a throwaway admin for the admin-UI check.
 * Usage: node scripts/_temp-admin.mjs create|delete
 * On create, prints JSON {email, password, uid}. Deleted in the same session.
 */
import { randomBytes } from "node:crypto";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

initializeApp({ credential: applicationDefault(), projectId: "fresh-snacks-ee79f" });
const db = getFirestore();
const auth = getAuth();
const email = "e2e-temp-admin@fresh-snacks.invalid";

if (process.argv[2] === "create") {
  const password = randomBytes(12).toString("base64url");
  const user = await auth.createUser({ email, password, displayName: "E2E Temp Admin" });
  await db.collection("admins").doc(user.uid).set({
    uid: user.uid,
    email,
    displayName: "E2E Temp Admin",
    role: "e2e-temp",
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(JSON.stringify({ email, password, uid: user.uid }));
} else if (process.argv[2] === "delete") {
  const user = await auth.getUserByEmail(email).catch(() => null);
  if (user) {
    await db.collection("admins").doc(user.uid).delete();
    await auth.deleteUser(user.uid);
    console.log("temp admin removed:", user.uid);
  } else {
    console.log("temp admin not found (already removed)");
  }
} else {
  throw new Error("pass create or delete");
}
