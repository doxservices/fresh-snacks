const assert = require("node:assert/strict");
const { dailySales } = require("../src/lib/shared");
const { STATUS } = require("../src/lib/transactionStatus");

// Two snacks sold on the same day sum into that day's revenue/units, split
// out per-snack; a third, later transaction lands on its own day.
const transactions = [
  { transactionId: "t1", snackId: "chips", snackName: "Chips", quantity: 2, total: 200, createdDate: "2026-08-20", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { transactionId: "t2", snackId: "soda", snackName: "Soda", quantity: 1, total: 100, createdDate: "2026-08-20", workflowStatus: STATUS.PAID_FINALIZED },
  { transactionId: "t3", snackId: "chips", snackName: "Chips", quantity: 1, total: 100, createdDate: "2026-08-21", workflowStatus: STATUS.CONFIRMED_UNPAID },
  // A live dispute is never a confirmed sale - excluded entirely, same rule accounting() applies.
  { transactionId: "t4", snackId: "chips", snackName: "Chips", quantity: 5, total: 500, createdDate: "2026-08-20", workflowStatus: STATUS.ITEM_UNDER_REVIEW },
];

const payments = [
  { paymentId: "p1", amount: 150, source: "admin", createdDate: "2026-08-20" },
  { paymentId: "p2", amount: 100, source: "paypal", createdDate: "2026-08-20" },
  { paymentId: "p3", amount: 50, source: "cashback", createdDate: "2026-08-21" },
];

const snacks = [{ id: "chips", name: "Chips" }, { id: "soda", name: "Soda" }];

const days = dailySales(transactions, payments, snacks);

assert.equal(days["2026-08-20"].revenue, 300);
assert.equal(days["2026-08-20"].units, 3);
assert.equal(days["2026-08-20"].transactions, 2);
assert.deepEqual(days["2026-08-20"].bySnack, {
  chips: { name: "Chips", revenue: 200, units: 2 },
  soda: { name: "Soda", revenue: 100, units: 1 },
});
assert.equal(days["2026-08-20"].paymentsCollected, 250);
assert.deepEqual(days["2026-08-20"].byPaymentSource, { admin: 150, paypal: 100 });

assert.equal(days["2026-08-21"].revenue, 100);
assert.equal(days["2026-08-21"].units, 1);
// p3 is a cashback payout, not money collected - paymentsCollected excludes
// it (byPaymentSource still shows it, same as before).
assert.equal(days["2026-08-21"].paymentsCollected, 0);
assert.deepEqual(days["2026-08-21"].byPaymentSource, { cashback: 50 });

// The disputed transaction contributed nothing to either day's totals.
assert.equal(Object.keys(days).length, 2);

console.log("daily sales rollup regression checks passed");
