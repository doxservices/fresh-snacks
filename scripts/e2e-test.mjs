/* End-to-end smoke test against the LIVE Firebase backend, simulating what
 * bins.html does in the browser — no Admin SDK privileges on the client path:
 *
 *   1. anonymous sign-in via the public Identity Toolkit REST API
 *   2. read settings/app and the snack catalog (rules: signed-in read)
 *   3. create own transaction (rules: uid must match) — must succeed
 *   4. write to /snacks (admin only) — must be DENIED
 *   5. read back own transactions
 *
 * Cleanup (test transaction + throwaway anonymous user) uses the Admin SDK,
 * so GOOGLE_APPLICATION_CREDENTIALS is required. Run: node scripts/e2e-test.mjs
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
const apiKey = process.env.FIREBASE_API_KEY || "AIzaSyDgdTpvDZCc7a-YPIc5bkwE48STVJOUMUU";
const fsBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  // 1. anonymous sign-in (public API key, same as the browser)
  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) },
  );
  const signInBody = await signIn.json();
  check("anonymous sign-in", signIn.ok, signInBody.localId || signInBody.error?.message);
  if (!signIn.ok) return;
  const uid = signInBody.localId;
  const authz = { Authorization: `Bearer ${signInBody.idToken}`, "Content-Type": "application/json" };

  // 2. signed-in reads
  const settings = await fetch(`${fsBase}/settings/app`, { headers: authz });
  check("read settings/app", settings.ok, settings.ok ? "" : (await settings.json()).error?.message);
  const snack = await fetch(`${fsBase}/snacks/chewy`, { headers: authz });
  const snackBody = await snack.json();
  check("read snacks/chewy", snack.ok && snackBody.fields?.price?.integerValue === "100",
    snack.ok ? `price=${snackBody.fields?.price?.integerValue}` : snackBody.error?.message);

  // 2b. first-visit device flow (what bins.html/index.html actually do):
  // read a device doc that does not exist yet, then create it
  const devId = `e2e-dev-${Date.now().toString(36)}`;
  const devProbe = await fetch(`${fsBase}/devices/${devId}`, { headers: authz });
  check("probe missing device doc allowed", devProbe.status === 404, `status=${devProbe.status}`);
  const devCreate = await fetch(`${fsBase}/devices?documentId=${devId}`, {
    method: "POST",
    headers: authz,
    body: JSON.stringify({ fields: {
      deviceId: { stringValue: devId },
      uid: { stringValue: uid },
      userId: { stringValue: uid },
      status: { stringValue: "active" },
      source: { stringValue: "e2e" },
    } }),
  });
  check("create own device doc", devCreate.ok,
    devCreate.ok ? devId : (await devCreate.json()).error?.message);
  const devRead = await fetch(`${fsBase}/devices/${devId}`, { headers: authz });
  check("read own device doc", devRead.ok, `status=${devRead.status}`);

  // 3. create own transaction — allowed by rules
  const txnId = `fs_txn-e2e-${Date.now().toString(36)}`;
  const today = new Date().toISOString().slice(0, 10);
  const txn = await fetch(`${fsBase}/transactions?documentId=${txnId}`, {
    method: "POST",
    headers: authz,
    body: JSON.stringify({
      fields: {
        transactionId: { stringValue: txnId },
        uid: { stringValue: uid },
        userId: { stringValue: uid },
        deviceId: { stringValue: "e2e-device" },
        visitorId: { stringValue: "e2e-visitor" },
        snackId: { stringValue: "chewy" },
        snackName: { stringValue: "Chewy" },
        quantity: { integerValue: "1" },
        unitPrice: { integerValue: "100" },
        total: { integerValue: "100" },
        source: { stringValue: "self" },
        createdDate: { stringValue: today },
        status: { stringValue: "active" },
      },
    }),
  });
  check("create own transaction", txn.ok, txn.ok ? txnId : (await txn.json()).error?.message);

  // 4. forbidden write — must be denied by rules
  const forbidden = await fetch(`${fsBase}/snacks/chewy?updateMask.fieldPaths=price`, {
    method: "PATCH",
    headers: authz,
    body: JSON.stringify({ fields: { price: { integerValue: "1" } } }),
  });
  check("non-admin snack write DENIED", forbidden.status === 403, `status=${forbidden.status}`);

  // 5. read back own transactions
  const query = await fetch(`${fsBase.replace(/\/documents$/, "")}/documents:runQuery`, {
    method: "POST",
    headers: authz,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "transactions" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "uid" },
            op: "EQUAL",
            value: { stringValue: uid },
          },
        },
      },
    }),
  });
  const queryBody = await query.json();
  const mine = (Array.isArray(queryBody) ? queryBody : []).filter((r) => r.document);
  check("read back own transactions", query.ok && mine.length === 1, `found=${mine.length}`);

  // 6. user settings: update own users/{uid} profile — allowed
  const ownProfile = await fetch(
    `${fsBase}/users/${uid}?updateMask.fieldPaths=displayName&updateMask.fieldPaths=vipStatus`,
    {
      method: "PATCH",
      headers: authz,
      body: JSON.stringify({ fields: {
        displayName: { stringValue: "E2E Tester" },
        vipStatus: { stringValue: "named" },
      } }),
    },
  );
  check("update own user profile", ownProfile.ok,
    ownProfile.ok ? "" : (await ownProfile.json()).error?.message);

  // 7. user settings: update someone else's profile — must be DENIED
  const otherProfile = await fetch(
    `${fsBase}/users/legacy-profile?updateMask.fieldPaths=displayName`,
    {
      method: "PATCH",
      headers: authz,
      body: JSON.stringify({ fields: { displayName: { stringValue: "hacked" } } }),
    },
  );
  check("other user's profile write DENIED", otherProfile.status === 403,
    `status=${otherProfile.status}`);

  // cleanup with Admin SDK
  initializeApp({ credential: applicationDefault(), projectId });
  await getFirestore().collection("transactions").doc(txnId).delete();
  await getFirestore().collection("devices").doc(devId).delete().catch(() => {});
  await getFirestore().collection("users").doc(uid).delete().catch(() => {});
  await getAuth().deleteUser(uid);
  console.log("cleanup: test transaction, device, profile, and anonymous user removed");

  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
