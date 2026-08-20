/* One shared read of a customer's transactions/payments/adjustments,
 * mapped the same way regardless of caller - store.js's GET /data (what the
 * customer sees) and the PayPal tab-payment routes (what gets charged) both
 * read through this, so the displayed balance and the charged balance can
 * never disagree. */
const admin = require("firebase-admin");
const { toEntry, toPayment, toAdjustment } = require("./shared");
const { creditBalance } = require("./cashback");

const db = () => admin.firestore();

async function fetchCustomerLedger(userId) {
  const [txnSnap, paySnap, adjSnap, creditSnap] = await Promise.all([
    db().collection("transactions").where("userId", "==", userId).where("status", "==", "active").get(),
    db().collection("payments").where("userId", "==", userId).where("status", "==", "active").get(),
    db().collection("adjustments").where("userId", "==", userId).where("status", "==", "active").get(),
    db().collection("creditConsumptions").where("userId", "==", userId).where("status", "==", "active").get(),
  ]);
  const rawTransactions = txnSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const rawPayments = paySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const consumptions = creditSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const entries = [
    ...rawTransactions.map(toEntry),
    ...adjSnap.docs.map((d) => toAdjustment({ id: d.id, ...d.data() })),
  ];
  const payments = rawPayments.map(toPayment);
  // rawTransactions/rawPayments/consumptions are exposed for callers
  // (cashback projections) that need the unmapped fields - entries/payments
  // are what everything else (balance math, the customer's own view) should
  // use. creditBalance is the customer's own unspent cashback-reward credit
  // (see ./cashback) - a distinct number from the snack-log balance above,
  // kept visible on its own rather than silently folded into it.
  return { entries, payments, rawTransactions, rawPayments, consumptions, creditBalance: creditBalance(rawPayments, consumptions) };
}

module.exports = { fetchCustomerLedger };
