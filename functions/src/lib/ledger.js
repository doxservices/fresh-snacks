/* One shared read of a customer's transactions/payments/adjustments,
 * mapped the same way regardless of caller - store.js's GET /data (what the
 * customer sees) and the PayPal tab-payment routes (what gets charged) both
 * read through this, so the displayed balance and the charged balance can
 * never disagree. */
const admin = require("firebase-admin");
const { toEntry, toPayment, toAdjustment } = require("./shared");

const db = () => admin.firestore();

async function fetchCustomerLedger(userId) {
  const [txnSnap, paySnap, adjSnap] = await Promise.all([
    db().collection("transactions").where("userId", "==", userId).where("status", "==", "active").get(),
    db().collection("payments").where("userId", "==", userId).where("status", "==", "active").get(),
    db().collection("adjustments").where("userId", "==", userId).where("status", "==", "active").get(),
  ]);
  const rawTransactions = txnSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const entries = [
    ...rawTransactions.map(toEntry),
    ...adjSnap.docs.map((d) => toAdjustment({ id: d.id, ...d.data() })),
  ];
  const payments = paySnap.docs.map((d) => toPayment({ id: d.id, ...d.data() }));
  // rawTransactions is exposed for callers (cashback projections) that need
  // the unmapped transaction fields - entries/payments are what everything
  // else (balance math, the customer's own view) should use.
  return { entries, payments, rawTransactions };
}

module.exports = { fetchCustomerLedger };
