const assert = require("node:assert/strict");
const { paymentAllocationPlan, toEntry, accounting } = require("../src/lib/shared");
const { STATUS, ROLE, ACTION } = require("../src/lib/transactionStatus");

// Legacy-shaped records (pre-migration, no workflowStatus field yet) still
// derive the expected eligibility via deriveWorkflowStatus()'s fallback.
const transactions = [
  { id: "older-neutral", total: 100, reviewStatus: "neutral", createdDate: "2026-06-01" },
  { id: "first-approved", total: 300, reviewStatus: "approved", createdDate: "2026-07-01", createdAt: { _seconds: 1 } },
  { id: "second-approved", total: 200, reviewStatus: "approved", createdDate: "2026-07-02", createdAt: { _seconds: 2 } },
];

assert.deepEqual(paymentAllocationPlan(transactions, 400), {
  settledIds: ["older-neutral", "first-approved"],
  credit: 0,
  paidTotal: 400,
  discounts: {},
});

assert.deepEqual(paymentAllocationPlan(transactions, 500), {
  settledIds: ["older-neutral", "first-approved"],
  credit: 100,
  paidTotal: 500,
  discounts: {},
});

assert.deepEqual(paymentAllocationPlan(transactions, 600), {
  settledIds: ["older-neutral", "first-approved", "second-approved"],
  credit: 0,
  paidTotal: 600,
  discounts: {},
});

const withExistingSettlement = [
  { id: "already-paid", total: 50, reviewStatus: "paid", createdDate: "2026-05-01" },
  ...transactions,
];
assert.deepEqual(paymentAllocationPlan(withExistingSettlement, 450), {
  settledIds: ["older-neutral", "first-approved"],
  credit: 0,
  paidTotal: 450,
  discounts: {},
});

// New behavior: an admin-added item still awaiting the user's own
// confirmation is NOT eligible for auto-settlement, even though there's
// more than enough payment on file to cover it - it must be confirmed
// first. This is the actual behavior change the new workflow spec asks for.
const withUnconfirmed = [
  { id: "unconfirmed", total: 500, workflowStatus: STATUS.PENDING_USER_CONFIRMATION, createdDate: "2026-07-01" },
  { id: "confirmed", total: 100, workflowStatus: STATUS.CONFIRMED_UNPAID, createdDate: "2026-07-02" },
];
assert.deepEqual(paymentAllocationPlan(withUnconfirmed, 500), {
  settledIds: ["confirmed"],
  credit: 400,
  paidTotal: 500,
  discounts: {},
});

// A disputed (ITEM_UNDER_REVIEW) transaction is likewise excluded from
// settlement until the dispute is resolved.
const withDisputed = [
  { id: "disputed", total: 500, workflowStatus: STATUS.ITEM_UNDER_REVIEW, createdDate: "2026-07-01" },
  { id: "confirmed", total: 100, workflowStatus: STATUS.CONFIRMED_UNPAID, createdDate: "2026-07-02" },
];
assert.deepEqual(paymentAllocationPlan(withDisputed, 500), {
  settledIds: ["confirmed"],
  credit: 400,
  paidTotal: 500,
  discounts: {},
});

// A transaction already reported paid by the customer is still eligible to
// be settled by a separate admin-recorded payment (e.g. cash handed over
// directly) - it isn't locked out just because the user already claimed to
// have paid some other way. One actively under payment review is NOT -
// an admin put that specific claim under active scrutiny, and an unrelated
// payment shouldn't silently resolve it; only an explicit Confirm Payment
// or Reject Payment Claim on that transaction can move it forward.
const withPaymentReported = [
  { id: "user-reported", total: 300, workflowStatus: STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION, createdDate: "2026-07-01" },
  { id: "under-payment-review", total: 200, workflowStatus: STATUS.PAYMENT_UNDER_REVIEW, createdDate: "2026-07-02" },
];
assert.deepEqual(paymentAllocationPlan(withPaymentReported, 500), {
  settledIds: ["user-reported"],
  credit: 200,
  paidTotal: 500,
  discounts: {},
});

assert.deepEqual(toEntry({
  transactionId: "paid-needs-customer-approval",
  createdDate: "2026-07-21",
  total: 200,
  reviewStatus: "paid",
}), {
  id: "paid-needs-customer-approval",
  date: "2026-07-21",
  snackId: null,
  label: null,
  count: 1,
  value: 200,
  source: "self",
  createdByRole: ROLE.USER,
  workflowStatus: STATUS.PAID_FINALIZED,
  itemReviewReason: null,
  reviewRequestType: null,
  availableActions: [ACTION.VIEW_DETAILS],
});

assert.deepEqual(toEntry({
  transactionId: "pending-admin-item",
  createdDate: "2026-07-22",
  total: 150,
  source: "admin",
  createdByRole: ROLE.ADMIN,
  workflowStatus: STATUS.PENDING_USER_CONFIRMATION,
}).availableActions, [ACTION.CONFIRM_ITEM, ACTION.REVIEW_ITEM, ACTION.VIEW_DETAILS]);

// accounting(): an ITEM_UNDER_REVIEW transaction stays out of the balance
// entirely (a live dispute over whether it's owed at all) until resolved,
// while a PENDING_USER_CONFIRMATION one still counts (the debt is real -
// confirmation is an accountability step, not a precondition for owing it).
const acctUser = { userId: "u1", uid: "u1", displayName: "Test User", vipStatus: "named" };
const acctRows = accounting(
  [acctUser],
  [],
  [
    { userId: "u1", total: 100, workflowStatus: STATUS.CONFIRMED_UNPAID, createdDate: "2026-07-01" },
    { userId: "u1", total: 250, workflowStatus: STATUS.ITEM_UNDER_REVIEW, createdDate: "2026-07-02" },
    { userId: "u1", total: 60, workflowStatus: STATUS.PENDING_USER_CONFIRMATION, createdDate: "2026-07-03" },
  ],
  [],
  []
);
assert.equal(acctRows.find((r) => r.userId === "u1").snackTotal, 160);

console.log("payment allocation regression checks passed");
