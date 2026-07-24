const assert = require("node:assert/strict");
const { paymentAllocationPlan } = require("../src/lib/shared");

const transactions = [
  { id: "older-neutral", total: 100, reviewStatus: "neutral", createdDate: "2026-06-01" },
  { id: "first-approved", total: 300, reviewStatus: "approved", createdDate: "2026-07-01", createdAt: { _seconds: 1 } },
  { id: "second-approved", total: 200, reviewStatus: "approved", createdDate: "2026-07-02", createdAt: { _seconds: 2 } },
];

assert.deepEqual(paymentAllocationPlan(transactions, 400), {
  settledIds: ["first-approved"],
  credit: 100,
  paidTotal: 400,
});

assert.deepEqual(paymentAllocationPlan(transactions, 500), {
  settledIds: ["first-approved", "second-approved"],
  credit: 0,
  paidTotal: 500,
});

console.log("payment allocation regression checks passed");
