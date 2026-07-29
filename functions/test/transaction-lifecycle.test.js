// End-to-end trace of the full spec lifecycle through the pure functions
// only (no Firestore) - catches composition mistakes between
// transactionStatus.js and shared.js's accounting()/paymentAllocationPlan()
// that the narrower unit tests wouldn't notice.
const assert = require("node:assert/strict");
const { STATUS, ROLE, ACTION, nextStatusFor } = require("../src/lib/transactionStatus");
const { accounting, paymentAllocationPlan } = require("../src/lib/shared");

// --- Scenario A: admin adds an item, user confirms it, reports payment,
// admin confirms the payment - the balance must land back at zero. ---
const user = { userId: "u1", uid: "u1", displayName: "Test Customer", vipStatus: "named" };
let txn = {
  id: "t1", userId: "u1", total: 150, createdDate: "2026-07-01",
  workflowStatus: STATUS.PENDING_USER_CONFIRMATION,
};

// Nothing payable yet - there's no credit on file at all (unrelated to
// whether it's confirmed; see Scenario F below for that policy directly).
assert.equal(
  paymentAllocationPlan([txn], 0).settledIds.length, 0,
  "with zero credit on file, nothing settles regardless of status"
);

txn = { ...txn, workflowStatus: nextStatusFor(txn.workflowStatus, ROLE.USER, ACTION.CONFIRM_ITEM) };
assert.equal(txn.workflowStatus, STATUS.CONFIRMED_UNPAID);

txn = { ...txn, workflowStatus: nextStatusFor(txn.workflowStatus, ROLE.USER, ACTION.MARK_AS_PAID) };
assert.equal(txn.workflowStatus, STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION);

txn = { ...txn, workflowStatus: nextStatusFor(txn.workflowStatus, ROLE.ADMIN, ACTION.CONFIRM_PAYMENT) };
assert.equal(txn.workflowStatus, STATUS.PAID_FINALIZED);

const settlementPayment = { userId: "u1", amount: 150, createdDate: "2026-07-02" };
const rowsA = accounting([user], [], [txn], [settlementPayment], []);
assert.equal(rowsA.find((r) => r.userId === "u1").balance, 0, "a confirmed, paid, and payment-matched item nets to zero balance");

// --- Scenario B: admin adds an item, user disputes it, admin edits and
// resends, user confirms the revised version. ---
let disputed = {
  id: "t2", userId: "u1", total: 200, createdDate: "2026-07-03",
  workflowStatus: STATUS.PENDING_USER_CONFIRMATION,
};
disputed = { ...disputed, workflowStatus: nextStatusFor(disputed.workflowStatus, ROLE.USER, ACTION.REVIEW_ITEM) };
assert.equal(disputed.workflowStatus, STATUS.ITEM_UNDER_REVIEW);

// While under review it must not count toward balance.
const rowsB1 = accounting([user], [], [disputed], [], []);
assert.equal((rowsB1.find((r) => r.userId === "u1")?.snackTotal) || 0, 0, "a disputed item is excluded from balance");

disputed = { ...disputed, total: 120, workflowStatus: nextStatusFor(disputed.workflowStatus, ROLE.ADMIN, ACTION.EDIT_AND_RESEND) };
assert.equal(disputed.workflowStatus, STATUS.PENDING_USER_CONFIRMATION);

disputed = { ...disputed, workflowStatus: nextStatusFor(disputed.workflowStatus, ROLE.USER, ACTION.CONFIRM_ITEM) };
assert.equal(disputed.workflowStatus, STATUS.CONFIRMED_UNPAID);

const rowsB2 = accounting([user], [], [disputed], [], []);
assert.equal(rowsB2.find((r) => r.userId === "u1").snackTotal, 120, "the revised amount counts once resolved and confirmed");

// --- Scenario C: a finalized transaction has no further valid transitions
// for either role. ---
for (const role of [ROLE.USER, ROLE.ADMIN]) {
  for (const action of Object.values(ACTION)) {
    if (action === "VIEW_DETAILS") continue;
    assert.equal(nextStatusFor(STATUS.PAID_FINALIZED, role, action), null, `PAID_FINALIZED must reject ${role}/${action}`);
    assert.equal(nextStatusFor(STATUS.CANCELLED, role, action), null, `CANCELLED must reject ${role}/${action}`);
  }
}

// --- Scenario D: a customer self-logs an item, then requests its removal
// before paying - the "X" on their own Snack Log entry. Must exclude from
// balance like any other disputed item, and an admin rejecting the removal
// (Approve) must bring it right back. ---
let selfLogged = {
  id: "t3", userId: "u1", total: 80, createdDate: "2026-07-05",
  createdByRole: ROLE.USER, workflowStatus: STATUS.CONFIRMED_UNPAID,
};
selfLogged = { ...selfLogged, workflowStatus: nextStatusFor(selfLogged.workflowStatus, ROLE.USER, ACTION.REVIEW_ITEM) };
assert.equal(selfLogged.workflowStatus, STATUS.ITEM_UNDER_REVIEW, "a customer can request removal/review of their own confirmed item");

const rowsD1 = accounting([user], [], [selfLogged], [], []);
assert.equal((rowsD1.find((r) => r.userId === "u1")?.snackTotal) || 0, 0, "a removal-pending item is excluded from balance, same as any dispute");

selfLogged = { ...selfLogged, workflowStatus: nextStatusFor(selfLogged.workflowStatus, ROLE.ADMIN, ACTION.APPROVE_ITEM) };
assert.equal(selfLogged.workflowStatus, STATUS.CONFIRMED_UNPAID, "admin rejecting the removal request restores it to confirmed");
const rowsD2 = accounting([user], [], [selfLogged], [], []);
assert.equal(rowsD2.find((r) => r.userId === "u1").snackTotal, 80, "once restored, it counts toward the balance again");

// --- Scenario E: a customer flags an admin-added, already-confirmed item -
// this is Review only (never Remove, enforced by store.js re-checking
// createdByRole server-side) - and the admin instead cancels it outright. ---
let adminItem = {
  id: "t4", userId: "u1", total: 60, createdDate: "2026-07-06",
  createdByRole: ROLE.ADMIN, workflowStatus: STATUS.CONFIRMED_UNPAID,
};
adminItem = { ...adminItem, workflowStatus: nextStatusFor(adminItem.workflowStatus, ROLE.USER, ACTION.REVIEW_ITEM) };
assert.equal(adminItem.workflowStatus, STATUS.ITEM_UNDER_REVIEW);
adminItem = { ...adminItem, workflowStatus: nextStatusFor(adminItem.workflowStatus, ROLE.ADMIN, ACTION.CANCEL) };
assert.equal(adminItem.workflowStatus, STATUS.CANCELLED, "an admin can still cancel a flagged item outright, regardless of who created it");

// --- Scenario F: an admin's Mark as Paid supersedes the usual confirm-first
// order - it can finalize an item the customer hasn't confirmed yet, and the
// oldest-first credit sweep does the same when enough credit is on file. ---
let unconfirmed = {
  id: "t5", userId: "u1", total: 90, createdDate: "2026-07-10",
  workflowStatus: STATUS.PENDING_USER_CONFIRMATION,
};
unconfirmed = { ...unconfirmed, workflowStatus: nextStatusFor(unconfirmed.workflowStatus, ROLE.ADMIN, ACTION.MARK_AS_PAID) };
assert.equal(unconfirmed.workflowStatus, STATUS.PAID_FINALIZED, "admin Mark as Paid finalizes an unconfirmed item directly");

const stillUnconfirmed = {
  id: "t6", userId: "u1", total: 90, createdDate: "2026-07-10",
  workflowStatus: STATUS.PENDING_USER_CONFIRMATION,
};
const planF = paymentAllocationPlan([stillUnconfirmed], 90);
assert.deepEqual(planF.settledIds, ["t6"], "the oldest-first credit sweep also settles an unconfirmed item, given enough credit");

// --- Scenario G: resetting a payment CLAIM (not the item's own
// confirmation) lands back on Confirmed - unpaid, not all the way back at
// Awaiting confirmation - the customer already confirmed this item once,
// before ever reporting payment on it. ---
let reported = {
  id: "t7", userId: "u1", total: 70, createdDate: "2026-07-11",
  workflowStatus: STATUS.CONFIRMED_UNPAID,
};
reported = { ...reported, workflowStatus: nextStatusFor(reported.workflowStatus, ROLE.USER, ACTION.MARK_AS_PAID) };
assert.equal(reported.workflowStatus, STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION);
reported = { ...reported, workflowStatus: nextStatusFor(reported.workflowStatus, ROLE.ADMIN, ACTION.RESET) };
assert.equal(reported.workflowStatus, STATUS.CONFIRMED_UNPAID, "Reset undoes the payment claim only, not the item's own confirmation");
const rowsG = accounting([user], [], [reported], [], []);
assert.equal(rowsG.find((r) => r.userId === "u1").snackTotal, 70, "still counts toward balance - it's confirmed, just unpaid again");

console.log("transaction lifecycle regression checks passed");
