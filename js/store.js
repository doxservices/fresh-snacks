/* Fresh Snacks data layer.
 *
 * The "database" is data.json in this repository. Reads go through the
 * GitHub Contents API (always fresh, works from GitHub Pages and file://),
 * falling back to a relative fetch of data.json. Writes use the Contents
 * API PUT endpoint and therefore need a fine-grained personal access token
 * with Contents read/write on this repo, stored once per device in
 * localStorage.
 */

const FS = {
  owner: "doxservices",
  repo: "fresh-snacks",
  branch: "main",
  path: "data.json",
  tokenKey: "fresh-snacks-token",
};

FS.apiUrl = () =>
  `https://api.github.com/repos/${FS.owner}/${FS.repo}/contents/${FS.path}?ref=${FS.branch}`;

FS.getToken = () => localStorage.getItem(FS.tokenKey) || "";
FS.setToken = (t) => localStorage.setItem(FS.tokenKey, t.trim());
FS.clearToken = () => localStorage.removeItem(FS.tokenKey);

FS.headers = () => {
  const h = { Accept: "application/vnd.github+json" };
  const t = FS.getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
};

FS.b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

FS.b64decode = (b64) => {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/* Fetch data.json plus its blob sha (needed for writes). */
FS.fetchFresh = async () => {
  const res = await fetch(`${FS.apiUrl()}&_=${Date.now()}`, { headers: FS.headers() });
  if (!res.ok) throw new Error(`GitHub API read failed (${res.status})`);
  const body = await res.json();
  return { data: JSON.parse(FS.b64decode(body.content)), sha: body.sha };
};

/* Read-only load with a fallback to the copy served by GitHub Pages
 * (which can lag a few minutes behind the API). */
FS.loadData = async () => {
  try {
    return (await FS.fetchFresh()).data;
  } catch (e) {
    const res = await fetch(`data.json?_=${Date.now()}`);
    if (!res.ok) throw e;
    return res.json();
  }
};

/* Atomic-ish update: fetch the freshest copy, apply mutate(data), PUT it
 * back guarded by the blob sha. On a conflict (someone else wrote in
 * between) refetch and retry once, so concurrent admin/bin writes merge
 * instead of clobbering each other. */
FS.saveData = async (mutate, message) => {
  if (!FS.getToken()) throw new Error("No access token set on this device.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, sha } = await FS.fetchFresh();
    mutate(data);
    const res = await fetch(FS.apiUrl().split("?")[0], {
      method: "PUT",
      headers: { ...FS.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        branch: FS.branch,
        sha,
        content: FS.b64encode(JSON.stringify(data, null, 2) + "\n"),
      }),
    });
    if (res.ok) return data;
    if (res.status === 409 && attempt === 0) continue;
    if (res.status === 401 || res.status === 403)
      throw new Error("Token rejected. Check it has Contents read/write on this repo.");
    throw new Error(`GitHub API write failed (${res.status})`);
  }
};

FS.testToken = async () => {
  const res = await fetch(`https://api.github.com/repos/${FS.owner}/${FS.repo}`, {
    headers: FS.headers(),
  });
  if (!res.ok) throw new Error(`Token check failed (${res.status})`);
  const repo = await res.json();
  if (!repo.permissions || !repo.permissions.push)
    throw new Error("Token is valid but has no write access to this repo.");
  return true;
};

/* ---------- shared helpers ---------- */

FS.uid = (prefix) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

FS.money = (n, currency) => `${currency || "J$"}${Number(n || 0).toLocaleString("en-US")}`;

FS.todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* Parse "YYYY-MM-DD" as a local date (avoids UTC off-by-one). */
FS.parseDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

FS.fmtDay = (iso) => {
  const d = FS.parseDate(iso);
  return `${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`;
};

FS.monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  const name = new Date(y, m - 1, 1).toLocaleString("en", { month: "long" });
  return y === new Date().getFullYear() ? name : `${name} ${y}`;
};

FS.snackById = (data, id) => data.catalog.find((s) => s.id === id) || null;

FS.entryName = (data, entry) => {
  if (entry.snackId) {
    const s = FS.snackById(data, entry.snackId);
    if (s) return s.name;
  }
  return entry.label || "Item";
};

FS.entryPillClass = (data, entry) => {
  const s = entry.snackId ? FS.snackById(data, entry.snackId) : null;
  return s && s.style !== "other" ? "snack-pill" : "snack-pill other-pill";
};

FS.totals = (data) => {
  const value = data.entries.reduce((t, e) => t + Number(e.value || 0), 0);
  const paid = data.payments.reduce((t, p) => t + Number(p.amount || 0), 0);
  return { value, paid, balance: value - paid };
};

/* Group entries and payments into the opening bucket (date: null) plus
 * one bucket per calendar month, sorted oldest first. */
FS.groups = (data) => {
  const buckets = new Map();
  const keyOf = (dated) => (dated ? dated.slice(0, 7) : "opening");
  for (const e of data.entries) {
    const k = keyOf(e.date);
    if (!buckets.has(k)) buckets.set(k, { key: k, entries: [], payments: [] });
    buckets.get(k).entries.push(e);
  }
  for (const p of data.payments) {
    const k = keyOf(p.date);
    if (!buckets.has(k)) buckets.set(k, { key: k, entries: [], payments: [] });
    buckets.get(k).payments.push(p);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === "opening") return -1;
    if (b === "opening") return 1;
    return a.localeCompare(b);
  });
  return keys.map((k) => {
    const g = buckets.get(k);
    const byDate = (a, b) => (a.date || "").localeCompare(b.date || "");
    g.entries.sort(byDate);
    g.payments.sort(byDate);
    g.value = g.entries.reduce((t, e) => t + Number(e.value || 0), 0);
    g.paid = g.payments.reduce((t, p) => t + Number(p.amount || 0), 0);
    return g;
  });
};
