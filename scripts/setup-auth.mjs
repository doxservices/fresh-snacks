import { GoogleAuth } from "google-auth-library";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
const projectNumber = process.env.FIREBASE_PROJECT_NUMBER || "710277534828";

const auth = new GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/firebase",
  ],
});

async function authedFetch(url, options = {}) {
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders(url);
  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = body.error?.message || text || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return body;
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to the Firebase Admin SDK JSON path.");
  }

  // The default Admin SDK service account often lacks serviceusage.enable;
  // the API is usually already on for Firebase projects, so warn and continue.
  await authedFetch(
    `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services/identitytoolkit.googleapis.com:enable`,
    { method: "POST", body: "{}" },
  ).catch((error) => {
    const msg = String(error.message);
    if (msg.includes("has already been enabled")) return;
    if (msg.includes("Permission denied")) {
      console.warn("warn: could not enable identitytoolkit API (no serviceusage permission); continuing — it is usually already enabled.");
      return;
    }
    throw error;
  });

  // A fresh Firebase project has no Identity Platform config until Auth is
  // initialized once (console does this implicitly; do it explicitly here).
  const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  const configExists = await authedFetch(configUrl).then(() => true).catch((e) => {
    if (String(e.message).includes("CONFIGURATION_NOT_FOUND")) return false;
    throw e;
  });
  if (!configExists) {
    // initializeAuth provisions paid Identity Platform; on the free (Spark)
    // plan it fails with BILLING_NOT_ENABLED. Free Firebase Auth can only be
    // provisioned by the console's one-time "Get started" click.
    try {
      await authedFetch(
        `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/identityPlatform:initializeAuth`,
        { method: "POST", body: "{}" },
      );
      console.log("initialized Identity Platform for the project");
    } catch (e) {
      if (String(e.message).includes("BILLING_NOT_ENABLED")) {
        throw new Error(
          "Firebase Auth is not provisioned yet and cannot be provisioned via API on the free plan.\n" +
          `Open https://console.firebase.google.com/project/${projectId}/authentication ` +
          'and click "Get started" once, then rerun this script.',
        );
      }
      throw e;
    }
  }

  const updated = await authedFetch(
    `${configUrl}?updateMask=signIn.email.enabled,signIn.email.passwordRequired,signIn.anonymous.enabled`,
    {
      method: "PATCH",
      body: JSON.stringify({
        signIn: {
          email: { enabled: true, passwordRequired: true },
          anonymous: { enabled: true },
        },
      }),
    },
  );

  console.log(JSON.stringify({
    projectId,
    anonymousEnabled: updated.signIn?.anonymous?.enabled === true,
    emailEnabled: updated.signIn?.email?.enabled === true,
    passwordRequired: updated.signIn?.email?.passwordRequired === true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
