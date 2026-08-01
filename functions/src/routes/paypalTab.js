/* The REAL "clear tab with PayPal" feature - unlike paypal-clear-tab-demo.html's
 * routes (../routes/paypal.js, deliberately left untouched for isolated
 * testing), every route here is authenticated and the amount charged is
 * always the caller's own real balance, computed server-side from
 * ../lib/ledger.js - never a number the client sends.
 *
 * paypalOrders/{orderId} anchors the whole flow so a payment can never be
 * settled twice: status moves created -> capturing -> captured -> settled,
 * and every step is safe to retry/replay from wherever it left off. */
const express = require("express");
const admin = require("firebase-admin");
const router = express.Router();
const { requireAuth, resolveEffectiveUid, asyncRoute } = require("../middleware");
const { uid: genId, todayISO, computeBalance } = require("../lib/shared");
const { fetchCustomerLedger } = require("../lib/ledger");
const { getTodayRate } = require("../lib/paypalRate");
const { createOrder, captureOrder } = require("../lib/paypalClientLive");
const { allocateApprovedTransactions } = require("../lib/settlement");

const db = () => admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function quoteForUser(userId) {
  const { entries, payments } = await fetchCustomerLedger(userId);
  const { balance } = computeBalance(entries, payments);
  if (!(balance > 0)) throw bad("Your tab is already clear.");
  const forDate = todayISO();
  const rate = await getTodayRate(forDate);
  const usdAmount = Math.round((balance / rate) * 100) / 100;
  return { balanceJmd: balance, rate, usdAmount, forDate };
}

router.get("/quote", requireAuth, asyncRoute(async (req, res) => {
  const effectiveUid = await resolveEffectiveUid(req);
  res.json(await quoteForUser(effectiveUid));
}));

router.post("/create-order", requireAuth, asyncRoute(async (req, res) => {
  const effectiveUid = await resolveEffectiveUid(req);
  const quote = await quoteForUser(effectiveUid);
  const order = await createOrder(quote.usdAmount, "Fresh Snacks - clear tab balance");
  const orderId = order.id;
  await db().collection("paypalOrders").doc(orderId).set({
    orderId,
    userId: effectiveUid,
    createdBy: req.uid,
    balanceJmd: quote.balanceJmd,
    rate: quote.rate,
    usdAmount: quote.usdAmount,
    forDate: quote.forDate,
    status: "created",
    createdAt: FieldValue.serverTimestamp(),
  });
  res.json({ orderID: orderId, ...quote });
}));

router.post("/capture-order", requireAuth, asyncRoute(async (req, res) => {
  const effectiveUid = await resolveEffectiveUid(req);
  const orderId = req.body.orderID;
  if (!orderId || typeof orderId !== "string") throw bad("orderID is required.");

  const orderRef = db().collection("paypalOrders").doc(orderId);
  const snap = await orderRef.get();
  if (!snap.exists) throw bad("Unknown order.", 404);
  let order = snap.data();
  // Even if a device link was revoked between create-order and this call,
  // this is the check that actually stops the money from settling onto the
  // wrong tab - everything upstream is just UX.
  if (order.userId !== effectiveUid) throw bad("This order doesn't belong to your tab.", 403);

  if (order.status === "settled") {
    res.json({ paymentId: order.paymentId, allocation: order.allocation || null, alreadySettled: true });
    return;
  }
  if (order.status === "capturing") {
    throw bad("This payment is already being processed.", 409);
  }

  if (order.status === "created") {
    // Claim exclusive right to call PayPal for this order BEFORE making the
    // network call - a concurrent/duplicate request landing here while
    // this is mid-flight sees status !== "created" and 409s instead of
    // ever calling captureOrder() twice.
    await db().runTransaction(async (txn) => {
      const fresh = await txn.get(orderRef);
      if (fresh.data().status !== "created") throw bad("This payment is already being processed.", 409);
      txn.update(orderRef, { status: "capturing" });
    });

    let capture;
    try {
      capture = await captureOrder(orderId);
    } catch (e) {
      await orderRef.update({ status: "created" });
      throw bad("Your payment didn't go through. Please try again.", 502);
    }
    // Money has moved - persist proof of that immediately, in its own
    // write, before doing anything else that could fail.
    await orderRef.update({
      status: "captured",
      paypalCaptureId: capture.id || null,
      capturedAt: FieldValue.serverTimestamp(),
    });
    order = { ...order, status: "captured", paypalCaptureId: capture.id || null };
  }

  // order.status is "captured" here - either just now, or left over from a
  // previous call that captured successfully but crashed before finishing
  // the bookkeeping below. Either way, PayPal is never called again past
  // this point; only the local payment record + settlement remain to do.
  const paymentId = genId("fs_pay");
  await db().collection("payments").doc(paymentId).set({
    paymentId,
    userId: effectiveUid,
    // JMD, not the USD amount PayPal actually processed - every other
    // amount in this app's ledger (transactions, other payments) is JMD,
    // so settlement math (paymentAllocationPlan) has to compare like with like.
    amount: order.balanceJmd,
    note: "Paid via PayPal",
    source: "paypal",
    paypalOrderId: orderId,
    paypalCaptureId: order.paypalCaptureId || null,
    paypalUsdAmount: order.usdAmount,
    paypalRate: order.rate,
    createdBy: req.uid,
    createdAt: FieldValue.serverTimestamp(),
    createdDate: todayISO(),
    status: "active",
  });
  const allocation = await allocateApprovedTransactions(effectiveUid);
  await orderRef.update({
    status: "settled",
    paymentId,
    allocation,
    settledAt: FieldValue.serverTimestamp(),
  });

  res.json({ paymentId, allocation, capture: { id: order.paypalCaptureId } });
}));

module.exports = router;
