/* Creates the (default) Firestore database and authorizes the GitHub Pages
 * domain for Firebase Auth. Idempotent. Requires
 * GOOGLE_APPLICATION_CREDENTIALS pointing at the Admin SDK JSON. */
import { GoogleAuth } from "google-auth-library";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";
const location = process.env.FIRESTORE_LOCATION || "nam5";
const pagesDomain = process.env.PAGES_DOMAIN || "doxservices.github.io";

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
    headers: { ...headers, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(body.error?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to the Firebase Admin SDK JSON path.");
  }

  // Firestore API must be enabled before the database can be created. The
  // default Admin SDK service account often lacks serviceusage.enable; the
  // API is usually already on for Firebase projects, so warn and continue.
  await authedFetch(
    `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/firestore.googleapis.com:enable`,
    { method: "POST", body: "{}" },
  ).catch((e) => {
    const msg = String(e.message);
    if (msg.includes("already been enabled")) return;
    if (msg.includes("Permission denied")) {
      console.warn("warn: could not enable firestore API (no serviceusage permission); continuing — it is usually already enabled.");
      return;
    }
    throw e;
  });

  let dbCreated = false;
  try {
    await authedFetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`,
      {
        method: "POST",
        body: JSON.stringify({ type: "FIRESTORE_NATIVE", locationId: location }),
      },
    );
    dbCreated = true;
  } catch (e) {
    if (e.status !== 409) throw e; // 409 = already exists
  }

  // Add the Pages domain to Auth authorized domains (keeps existing ones)
  const cfgUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  const cfg = await authedFetch(cfgUrl);
  const domains = new Set(cfg.authorizedDomains || []);
  const hadDomain = domains.has(pagesDomain);
  if (!hadDomain) {
    domains.add(pagesDomain);
    await authedFetch(`${cfgUrl}?updateMask=authorizedDomains`, {
      method: "PATCH",
      body: JSON.stringify({ authorizedDomains: [...domains] }),
    });
  }

  console.log(JSON.stringify({
    projectId,
    database: dbCreated ? `created (${location})` : "already exists",
    authorizedDomains: [...domains],
  }, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
