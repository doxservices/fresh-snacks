/* Extended full check of the LIVE site: nav drawer, nutrition facts door,
 * invoice page (with claimed tab), and the admin dashboard login. */
import puppeteer from "puppeteer-core";

const scratch = process.env.SCRATCH_DIR || ".";
const base = "https://doxservices.github.io/fresh-snacks";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1400 });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));

  if (process.env.ONLY_ADMIN) {
    await runAdmin();
    console.log(results.every(Boolean) ? "FULL CHECK: ALL PASSED" : "FULL CHECK: FAILURES ABOVE");
    if (!results.every(Boolean)) process.exitCode = 1;
    await browser.close();
    process.exit();
  }

  // --- index via path code link (exercises the 404 router)
  await page.goto(`${base}/25E4BYJH`, { waitUntil: "networkidle2", timeout: 60000 });
  check("404 router rewrote path to tab view", page.url().includes("?code=25E4BYJH"), page.url());
  await page.waitForFunction(
    () => document.getElementById("stat-balance")?.textContent.includes("2,050"),
    { timeout: 30000 },
  );
  check("claimed tab balance", true, "J$2,050");

  // --- left nav drawer
  await page.click("#nav-toggle");
  await page.waitForSelector(".drawer.open", { timeout: 10000 });
  const links = await page.$$eval(".drawer.open .drawer-link", (els) => els.map((e) => e.textContent.trim()));
  check("nav drawer opens", links.length >= 3, links.join(" | "));
  await page.keyboard.press("Escape");

  // --- nutrition facts slide door
  await page.waitForSelector("#fav-facts a", { timeout: 15000 });
  await page.click("#fav-facts a");
  await page.waitForSelector("#facts-door.open", { timeout: 10000 });
  const doorImg = await page.$eval("#facts-door img", (i) => i.complete && i.naturalWidth > 0);
  check("nutrition facts door opens with image", doorImg);
  await page.screenshot({ path: `${scratch}\\full-facts.png` });
  await page.click("#facts-door");

  // --- right settings well
  await page.click("#profile-toggle");
  await page.waitForSelector("#settings-drawer.open", { timeout: 10000 });
  const fields = await page.$$eval("#settings-drawer input", (els) => els.map((e) => e.id));
  check("settings well fields", fields.join(",") === "us-username,us-first,us-last,us-email,us-phone", fields.join(","));
  await page.keyboard.press("Escape");

  // --- invoice page (same device, still claimed)
  await page.goto(`${base}/invoice.html`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(
    () => (document.getElementById("invoice-root")?.textContent || "").includes("2,050"),
    { timeout: 30000 },
  );
  const invoiceRows = await page.$$eval("#invoice-root .admin-table tbody tr", (r) => r.length);
  check("invoice renders claimed history", invoiceRows >= 16, `${invoiceRows} activity rows, balance J$2,050`);
  await page.screenshot({ path: `${scratch}\\full-invoice.png`, fullPage: true });

  await runAdmin();

  // self-cleanup: the customer-view page created a guest user via the code link
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const uid = await page.evaluate(() => localStorage.getItem("fresh_snacks_uid"));
    if (uid) {
      const { initializeApp, applicationDefault } = await import("firebase-admin/app");
      const { getFirestore } = await import("firebase-admin/firestore");
      const { getAuth } = await import("firebase-admin/auth");
      initializeApp({ credential: applicationDefault(), projectId: "fresh-snacks-ee79f" });
      const db = getFirestore();
      for (const col of ["transactions", "devices"]) {
        const q = await db.collection(col).where("uid", "==", uid).get();
        for (const d of q.docs) await d.ref.delete();
      }
      await db.collection("users").doc(uid).delete().catch(() => {});
      await getAuth().deleteUser(uid).catch(() => {});
      console.log(`cleanup: removed check guest ${uid}`);
    }
  }

  console.log(results.every(Boolean) ? "FULL CHECK: ALL PASSED" : "FULL CHECK: FAILURES ABOVE");
  if (!results.every(Boolean)) process.exitCode = 1;
} finally {
  await browser.close();
}

// --- admin login + dashboard
async function runAdmin() {
  const adminPage = await browser.newPage();
  await adminPage.setViewport({ width: 1200, height: 1400 });
  await adminPage.goto(`${base}/admin.html`, { waitUntil: "networkidle2", timeout: 60000 });
  await adminPage.type("#admin-email", process.env.ADMIN_EMAIL);
  await adminPage.type("#admin-password", process.env.ADMIN_PASSWORD);
  await adminPage.click("#email-login");
  await adminPage.waitForFunction(
    () => !document.getElementById("admin-app").classList.contains("hidden"),
    { timeout: 30000 },
  ).catch(async (e) => {
    console.log("login-status:", await adminPage.$eval("#login-status", (el) => el.textContent));
    throw e;
  });
  await adminPage.waitForFunction(
    () => (document.getElementById("dash-balance")?.textContent || "-") !== "-",
    { timeout: 30000 },
  );
  const dash = await adminPage.evaluate(() => ({
    balance: document.getElementById("dash-balance").textContent,
    snacks: document.getElementById("dash-snacks").textContent,
    paid: document.getElementById("dash-paid").textContent,
    users: document.getElementById("dash-users").textContent,
  }));
  check("admin login + dashboard", true,
    `open balance ${dash.balance}, snacks ${dash.snacks}, paid ${dash.paid}, accounts ${dash.users}`);
  const acctRows = await adminPage.$$eval("#accounting-list tbody tr", (r) => r.length);
  check("admin accounting table", acctRows >= 1, `${acctRows} account rows`);
  await adminPage.screenshot({ path: `${scratch}\\full-admin.png`, fullPage: true });
}
