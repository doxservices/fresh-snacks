/* Promotional QR tracking - a promoLinks/{qrId} doc is one printed/displayed
 * QR code (see POST /admin/promo-links), and a promoScans/{scanId} doc is one
 * landing that arrived carrying that code (see GET /store/data's `promo`/
 * `qr`/`browserToken` query params). `promoCode` is the only thing any
 * caller ever needs to trust - it's the campaign identity ("hydrate", etc.)
 * and every recording/eligibility decision keys off it alone. `qrId`
 * (which physical placement) and `browserToken` (which browser) are both
 * purely descriptive detail recorded alongside it, never validated against
 * anything - an unrecognized, stale, or missing qrId still records a
 * perfectly good scan for its promoCode; it just can't be attributed to one
 * specific printed code afterward. Never gate a promo's actual behavior
 * (the offer modal, eligibility, etc.) on qrId/browserToken being present
 * or well-formed - only ever gate on promoCode.
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

async function recordPromoScan({
  userId, promoCode, qrId, browserToken, scannedVia = "url", landingPage = null, userAgentBrief = null,
}) {
  if (!promoCode) return;
  const scanId = genId("fs_scan");
  try {
    await db().collection("promoScans").doc(scanId).set({
      scanId,
      userId: userId || null,
      promoCode: String(promoCode),
      qrId: qrId ? String(qrId) : null,
      // The browser's own persisted token (see FS.getBrowserToken in
      // firebase-store.js) - lets repeat scans from the same browser be
      // told apart from genuinely new visitors, independent of whether
      // they ever sign in or complete a tab.
      browserToken: browserToken ? String(browserToken) : null,
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
