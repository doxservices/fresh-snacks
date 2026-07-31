/* The JMD->USD conversion rate used for the PayPal "clear tab" checkout is
 * generated ONCE PER DAY, server-side, and stored in Firestore
 * (settings/paypalRate). It is never sent by, read from, or influenced by
 * the client in any way - every quote/order this calendar day is computed
 * against this one stored value, so nothing about the rate is tamperable
 * from the front end. See functions/index.js's scheduled
 * `refreshPaypalRate` trigger for what runs this daily; getTodayRate()
 * below is the read path every route actually uses, and self-heals (does
 * a live fetch + store) if the scheduled run hasn't happened yet for
 * whatever reason, rather than ever falling back to a client-supplied
 * number. */
const admin = require("firebase-admin");

const RATE_DOC = () => admin.firestore().collection("settings").doc("paypalRate");

const roundUpToTen = (n) => Math.ceil(Number(n) / 10) * 10;

/* Same free, no-key public endpoint the demo originally used client-side -
 * now called only from the server, never trusted from a request body. */
async function fetchLiveJmdRate() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`FX rate API returned HTTP ${res.status}`);
  const data = await res.json();
  const rate = data && data.rates && data.rates.JMD;
  if (typeof rate !== "number" || !(rate > 0)) throw new Error("JMD rate missing or invalid in FX API response");
  return rate;
}

async function refreshDailyRate(todayISO) {
  const liveRate = await fetchLiveJmdRate();
  const rate = roundUpToTen(liveRate);
  const doc = {
    rate,
    liveRateSeen: liveRate,
    forDate: todayISO,
    source: "open.er-api.com",
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await RATE_DOC().set(doc);
  return doc;
}

async function getTodayRate(todayISO) {
  const snap = await RATE_DOC().get();
  const data = snap.exists ? snap.data() : null;
  if (data && data.forDate === todayISO && typeof data.rate === "number") return data.rate;
  const fresh = await refreshDailyRate(todayISO);
  return fresh.rate;
}

module.exports = { roundUpToTen, fetchLiveJmdRate, refreshDailyRate, getTodayRate };
