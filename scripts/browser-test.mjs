/* Drives the LIVE site in real Chrome via CDP: loads bins.html, waits for the
 * snack bins from Firestore, logs a snack, checks index.html shows it, and
 * saves a User Settings identity. Cleans up the test user afterwards when
 * GOOGLE_APPLICATION_CREDENTIALS is set.
 *
 * Needs: npm i --no-save puppeteer-core  (drives the installed Chrome)
 * Run:   node scripts/browser-test.mjs
 */
import puppeteer from "puppeteer-core";

const scratch = process.env.SCRATCH_DIR || ".";
const base = "https://doxservices.github.io/fresh-snacks";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1300 });
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text()); });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));

  // --- optional: share-code link shows the claimed tab's history merged in
  if (process.env.TAB_CODE) {
    await page.goto(`${base}/?code=${process.env.TAB_CODE}`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(
      () => {
        const t = document.getElementById("stat-balance")?.textContent.trim();
        return t && t !== "–";
      },
      { timeout: 30000 },
    );
    const claimed = await page.$eval("#stat-balance", (e) => e.textContent);
    const sub = await page.$eval("#brand-subtitle", (e) => e.textContent);
    console.log(`PASS code link loaded — balance: ${claimed} | ${sub}`);
    await page.screenshot({ path: `${scratch}\\drive-code.png`, fullPage: true });
  }

  // --- bins.html: catalog should load from Firestore
  await page.goto(`${base}/bins.html`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector(".bin-card", { timeout: 30000 });
  const bins = await page.$$eval(".bin-card .bin-name", (els) => els.map((e) => e.textContent));
  console.log("PASS bins loaded:", bins.join(", "));

  // --- log a snack: tap + on the first bin, then submit
  await page.click('.bin-card button[data-d="1"]');
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click("#submit");
  await page.waitForFunction(
    () => /Added .+ to your tab/.test(document.getElementById("submit-status")?.textContent || ""),
    { timeout: 30000 },
  ).catch(async (e) => {
    console.log("submit-status was:", await page.$eval("#submit-status", (el) => el.textContent));
    throw e;
  });
  console.log("PASS snack logged:", await page.$eval("#submit-status", (e) => e.textContent));
  await page.screenshot({ path: `${scratch}\\drive-bins.png` });

  // --- index.html (same browser profile = same anonymous user): tab shows it
  await page.goto(`${base}/index.html`, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(
    () => document.getElementById("stat-balance")?.textContent.trim() !== "–",
    { timeout: 30000 },
  );
  const balance = await page.$eval("#stat-balance", (e) => e.textContent);
  const subtitle = await page.$eval("#brand-subtitle", (e) => e.textContent);
  console.log("PASS index loaded — balance:", balance, "| profile:", subtitle);

  // --- user settings right well: save an identity, check it reflects
  await page.click("#profile-toggle");
  await page.waitForSelector("#settings-drawer.open", { timeout: 10000 });
  await page.type("#us-username", "Browser E2E");
  await page.type("#us-first", "Browser");
  await page.type("#us-last", "Tester");
  await page.click("#us-save");
  await page.waitForFunction(
    () => (document.getElementById("us-status")?.textContent || "").includes("saved"),
    { timeout: 30000 },
  );
  const current = await page.$eval("#us-current", (e) => e.textContent);
  console.log("PASS user settings saved:", current);
  await page.screenshot({ path: `${scratch}\\drive-index.png`, fullPage: true });

  console.log("ALL BROWSER CHECKS PASSED");

  // self-cleanup: remove the test user's auth account and Firestore docs
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
      console.log(`cleanup: removed test user ${uid}`);
    }
  } else {
    console.log("cleanup skipped (set GOOGLE_APPLICATION_CREDENTIALS to auto-remove the test user)");
  }
} finally {
  await browser.close();
}
