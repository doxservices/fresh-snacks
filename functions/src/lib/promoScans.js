/* Promotional QR tracking - a promoLinks/{qrId} doc is one printed/displayed
 * QR code (see POST /admin/promo-links), and a promoScans/{scanId} doc is one
 * landing that arrived carrying that code (see GET /store/data's `promo`/`qr`
 * query params). Two codes on the same campaign (promoCode) but different
 * physical placements (qrId) stay distinguishable in the scan log even
 * though they both land on the same page.
 *
 * `scannedVia` is future-facing scaffolding: every scan recorded today comes
 * through a customer's browser just following a link ("url") - a future
 * in-app scanner (an already-signed-in customer scanning a code from inside
 * the Fresh Snacks app itself, not landing fresh via a URL) is expected to
 * call recordPromoScan() too, passing scannedVia: "in-app" and the real,
 * already-known uid doing the scanning. No schema change needed when that
 * ships - just a second call site. */
const admin = require("firebase-admin");
const { uid: genId, todayISO } = require("./shared");

const db = () => admin.firestore();

async function recordPromoScan({ userId, promoCode, qrId, scannedVia = "url", landingPage = null, userAgentBrief = null }) {
  if (!promoCode) return;
  const scanId = genId("fs_scan");
  try {
    await db().collection("promoScans").doc(scanId).set({
      scanId,
      userId: userId || null,
      promoCode: String(promoCode),
      qrId: qrId ? String(qrId) : null,
      scannedVia,
      landingPage,
      userAgentBrief,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdDate: todayISO(),
    });
  } catch (e) {
    // Best-effort - a tracking hiccup should never break the customer's
    // actual page load.
    console.error("recordPromoScan failed", e);
  }
}

module.exports = { recordPromoScan };
