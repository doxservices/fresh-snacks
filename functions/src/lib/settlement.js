/* Shared between admin.js (an admin explicitly recording a payment, or the
 * bulk /payments/reconcile sweep) and store.js (right after a customer's
 * own action lands a transaction on CONFIRMED_UNPAID) - a customer who
 * already has enough credit on file from an earlier payment should never
 * have to separately "mark as paid" and sit in Payment pending admin
 * confirmation for something that credit already covers. */
const admin = require("firebase-admin");
const { STATUS, ROLE, ACTION, EVENT_TYPE, assertTransition, deriveWorkflowStatus } = require("./transactionStatus");
const { buildTransactionEvent } = require("./transactionEvents");
const { paymentAllocationPlan, uid: genId, todayISO } = require("./shared");
const { evaluateCashback } = require("./cashback");

const db = () => admin.firestore();
const FieldValue = admin.firestore.FieldValue;

/* Recorded as who/what confirmed the payment when this runs automatically
 * off a customer's own action - nobody actually clicked a confirm button
 * for this specific settlement, so a real admin uid would misattribute it. */
const AUTO_SETTLE_ACTOR = "auto-settlement";

/* Runs the oldest-first settlement plan (paymentAllocationPlan) against
 * every payment already on file for this customer and finalizes whatever
 * their existing credit covers. `actorUid` is who to credit in the audit
 * trail - pass a real admin uid for an admin-triggered call; defaults to
 * AUTO_SETTLE_ACTOR for the automatic customer-triggered path. */
async function allocateApprovedTransactions(userId, actorUid = AUTO_SETTLE_ACTOR) {
  const [transactionSnap, paymentSnap] = await Promise.all([
    db().collection("transactions").where("userId", "==", userId).get(),
    db().collection("payments").where("userId", "==", userId).get(),
  ]);
  const transactions = transactionSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => record.status !== "void");
  const payments = paymentSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((record) => record.status !== "void");
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const plan = paymentAllocationPlan(transactions, paidTotal);
  const byId = new Map(transactions.map((record) => [record.id, record]));
  const batch = db().batch();
  const now = FieldValue.serverTimestamp();
  for (const id of plan.settledIds) {
    const current = deriveWorkflowStatus(byId.get(id));
    const action = current === STATUS.CONFIRMED_UNPAID ? ACTION.MARK_AS_PAID : ACTION.CONFIRM_PAYMENT;
    const next = assertTransition(current, ROLE.ADMIN, action);
    batch.update(db().collection("transactions").doc(id), {
      workflowStatus: next,
      version: FieldValue.increment(1),
      finalizedAt: now,
      paymentConfirmedAt: now,
      paymentConfirmedByAdminId: actorUid,
      ...(action === ACTION.MARK_AS_PAID
        ? { paymentMarkedAt: now, paymentMarkedBy: actorUid, paymentMarkedByRole: ROLE.ADMIN }
        : {}),
    });
    const event = buildTransactionEvent(db(), {
      transactionId: id,
      eventType: action === ACTION.MARK_AS_PAID ? EVENT_TYPE.PAYMENT_MARKED_BY_ADMIN : EVENT_TYPE.PAYMENT_CONFIRMED_BY_ADMIN,
      fromStatus: current,
      toStatus: next,
      actorUserId: actorUid,
      actorRole: ROLE.ADMIN,
    });
    batch.set(event.ref, event.data);
  }

  // This sweep might be exactly what brings the customer's WHOLE balance to
  // $0 (not just what this specific payment happened to cover) - evaluated
  // against the pre-sweep `transactions` snapshot, same as everything above.
  const cashback = evaluateCashback(transactions, plan.settledIds, new Date());
  if (cashback) {
    const paymentId = genId("fs_pay");
    batch.set(db().collection("payments").doc(paymentId), {
      paymentId, userId, amount: cashback.amount,
      note: `${Math.round(cashback.rate * 100)}% early-payment cashback`,
      source: "cashback",
      cashbackTier: cashback.tier,
      cashbackRate: cashback.rate,
      clearedTotal: cashback.clearedTotal,
      createdBy: "cashback-system",
      createdAt: FieldValue.serverTimestamp(),
      createdDate: todayISO(),
      status: "active",
    });
  }

  if (plan.settledIds.length || cashback) await batch.commit();
  return plan;
}

module.exports = { allocateApprovedTransactions, AUTO_SETTLE_ACTOR };
