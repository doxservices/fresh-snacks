/* Deploys firestore.rules and firestore.indexes.json via the REST APIs.
 *
 * The firebase CLI's deploy preflight needs serviceusage permissions the
 * Admin SDK service account doesn't have; this script talks straight to the
 * firebaserules + firestore admin APIs instead. Idempotent.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS. Run: node scripts/deploy-rules.mjs
 */
import { readFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";

const projectId = process.env.FIREBASE_PROJECT_ID || "fresh-snacks-ee79f";

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

async function deployRules() {
  const content = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const rulesBase = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;

  const ruleset = await authedFetch(`${rulesBase}/rulesets`, {
    method: "POST",
    body: JSON.stringify({ source: { files: [{ name: "firestore.rules", content }] } }),
  });

  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  try {
    await authedFetch(`${rulesBase}/releases/cloud.firestore`, {
      method: "PATCH",
      body: JSON.stringify({
        release: { name: releaseName, rulesetName: ruleset.name },
      }),
    });
  } catch (e) {
    if (e.status !== 404) throw e;
    await authedFetch(`${rulesBase}/releases`, {
      method: "POST",
      body: JSON.stringify({ name: releaseName, rulesetName: ruleset.name }),
    });
  }
  return ruleset.name;
}

async function deployIndexes() {
  const spec = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const results = [];
  for (const idx of spec.indexes || []) {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${idx.collectionGroup}/indexes`;
    try {
      await authedFetch(url, {
        method: "POST",
        body: JSON.stringify({ queryScope: idx.queryScope, fields: idx.fields }),
      });
      results.push(`${idx.collectionGroup}: created`);
    } catch (e) {
      if (e.status === 409) results.push(`${idx.collectionGroup}: already exists`);
      else if (e.status === 403) {
        // current app queries are equality-only and need no composite index;
        // create these from the console if an ordered query ever demands them
        results.push(`${idx.collectionGroup}: SKIPPED (no permission — optional for current queries)`);
      } else throw e;
    }
  }
  return results;
}

const rulesetName = await deployRules();
const indexes = await deployIndexes();
console.log(JSON.stringify({ projectId, rulesetName, release: "cloud.firestore", indexes }, null, 2));
