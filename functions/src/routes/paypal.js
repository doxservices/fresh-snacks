/* Backs the standalone paypal-clear-tab-demo.html test page. Deliberately
 * NOT wired to any real customer/tab data (see that page's own notices) -
 * balanceJmd is just a number the page sends, same as a real integration
 * would eventually send a customer's real "Current balance". What IS
 * fully real and production-grade here: the conversion rate and the
 * resulting USD amount are computed entirely server-side from the
 * Firestore-stored daily rate (see ../lib/paypalRate.js) - the client
 * never sends, sets, or overrides either one, and PayPal's actual order
 * creation/capture happen server-side too, so there's no front-end-
 * reachable variable that changes what gets charged.
 *
 * Always talks to PayPal's SANDBOX via ../lib/paypalClientSandbox.js -
 * deliberately separate credentials from ../lib/paypalClientLive.js (used
 * by ../routes/paypalTab.js for real customers), so this page can never
 * start moving real money just because the real feature went live. */
const express = require("express");
const router = express.Router();
const { asyncRoute } = require("../middleware");
const { todayISO } = require("../lib/shared");
const { getTodayRate } = require("../lib/paypalRate");
const { createOrder, captureOrder } = require("../lib/paypalClientSandbox");

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function readBalanceJmd(value) {
  const balanceJmd = Number(value);
  if (!Number.isFinite(balanceJmd) || balanceJmd <= 0) {
    throw bad("A valid balanceJmd (a positive number) is required.");
  }
  return balanceJmd;
}

async function quoteFor(balanceJmd) {
  const forDate = todayISO();
  const rate = await getTodayRate(forDate);
  const usdAmount = Math.round((balanceJmd / rate) * 100) / 100;
  return { balanceJmd, rate, usdAmount, forDate };
}

// Read-only preview - what today's locked-in rate would charge for a given
// JMD balance, so the page can show a live-looking amount without the
// client ever computing or supplying the rate itself.
router.get("/quote", asyncRoute(async (req, res) => {
  const balanceJmd = readBalanceJmd(req.query.balanceJmd);
  res.json(await quoteFor(balanceJmd));
}));

// The only place a PayPal order actually gets created - re-derives the
// USD amount the same way /quote does (today's stored rate, not
// anything the client sent) immediately before creating the order, so
// the amount PayPal is told to charge is always the server's own number.
router.post("/create-order", asyncRoute(async (req, res) => {
  const balanceJmd = readBalanceJmd(req.body.balanceJmd);
  const quote = await quoteFor(balanceJmd);
  const order = await createOrder(quote.usdAmount, "Fresh Snacks - clear tab balance (test)");
  res.json({ orderID: order.id, ...quote });
}));

router.post("/capture-order", asyncRoute(async (req, res) => {
  const orderId = req.body.orderID;
  if (!orderId || typeof orderId !== "string") throw bad("orderID is required.");
  const capture = await captureOrder(orderId);
  res.json({ capture });
}));

module.exports = router;
