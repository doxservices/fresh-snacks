const assert = require("node:assert/strict");
const { STATUS, ROLE, ACTION, availableActions, nextStatusFor, assertTransition, isFinal, initialStatus } = require("../src/lib/transactionStatus");

// Creation (spec section 16)
assert.equal(initialStatus(ROLE.USER), STATUS.CONFIRMED_UNPAID);
assert.equal(initialStatus(ROLE.ADMIN), STATUS.PENDING_USER_CONFIRMATION);

// Section 24 acceptance criteria, as direct transition checks
assert.equal(nextStatusFor(STATUS.PENDING_USER_CONFIRMATION, ROLE.USER, ACTION.CONFIRM_ITEM), STATUS.CONFIRMED_UNPAID);
assert.equal(nextStatusFor(STATUS.PENDING_USER_CONFIRMATION, ROLE.USER, ACTION.REVIEW_ITEM), STATUS.ITEM_UNDER_REVIEW);
assert.equal(nextStatusFor(STATUS.CONFIRMED_UNPAID, ROLE.USER, ACTION.MARK_AS_PAID), STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION);
assert.equal(nextStatusFor(STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION, ROLE.ADMIN, ACTION.CONFIRM_PAYMENT), STATUS.PAID_FINALIZED);
assert.equal(nextStatusFor(STATUS.CONFIRMED_UNPAID, ROLE.ADMIN, ACTION.MARK_AS_PAID), STATUS.PAID_FINALIZED);
assert.equal(nextStatusFor(STATUS.ITEM_UNDER_REVIEW, ROLE.ADMIN, ACTION.EDIT_AND_RESEND), STATUS.PENDING_USER_CONFIRMATION);
assert.equal(nextStatusFor(STATUS.ITEM_UNDER_REVIEW, ROLE.ADMIN, ACTION.APPROVE_ITEM), STATUS.CONFIRMED_UNPAID);
assert.equal(nextStatusFor(STATUS.PAYMENT_UNDER_REVIEW, ROLE.ADMIN, ACTION.REJECT_PAYMENT_CLAIM), STATUS.CONFIRMED_UNPAID);
assert.equal(nextStatusFor(STATUS.PAYMENT_UNDER_REVIEW, ROLE.ADMIN, ACTION.CONFIRM_PAYMENT), STATUS.PAID_FINALIZED);

// Decided product rule: admin editing an already-confirmed listing resets
// it back to pending re-confirmation rather than applying silently.
assert.equal(nextStatusFor(STATUS.CONFIRMED_UNPAID, ROLE.ADMIN, ACTION.EDIT), STATUS.PENDING_USER_CONFIRMATION);

// Rule 4: a user-created transaction never exposes Confirm Item/Review Item
// because it never visits PENDING_USER_CONFIRMATION in the first place.
assert.deepEqual(availableActions(STATUS.CONFIRMED_UNPAID, ROLE.USER), [ACTION.MARK_AS_PAID, ACTION.VIEW_DETAILS]);
assert.ok(!availableActions(STATUS.CONFIRMED_UNPAID, ROLE.USER).includes(ACTION.CONFIRM_ITEM));
assert.ok(!availableActions(STATUS.CONFIRMED_UNPAID, ROLE.USER).includes(ACTION.REVIEW_ITEM));

// Rule 3: admin-created, awaiting confirmation - user sees exactly these
assert.deepEqual(
  availableActions(STATUS.PENDING_USER_CONFIRMATION, ROLE.USER),
  [ACTION.CONFIRM_ITEM, ACTION.REVIEW_ITEM, ACTION.VIEW_DETAILS]
);
assert.ok(!availableActions(STATUS.PENDING_USER_CONFIRMATION, ROLE.USER).includes(ACTION.MARK_AS_PAID));

// Rule 7/8: finalized/cancelled/under-review never expose workflow actions
// beyond VIEW_DETAILS for either role.
for (const status of [STATUS.PAID_FINALIZED, STATUS.CANCELLED]) {
  assert.deepEqual(availableActions(status, ROLE.USER), [ACTION.VIEW_DETAILS]);
  assert.deepEqual(availableActions(status, ROLE.ADMIN), [ACTION.VIEW_DETAILS]);
}
assert.deepEqual(availableActions(STATUS.ITEM_UNDER_REVIEW, ROLE.USER), [ACTION.VIEW_DETAILS]);
assert.deepEqual(availableActions(STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION, ROLE.USER), [ACTION.VIEW_DETAILS]);
assert.deepEqual(availableActions(STATUS.PAYMENT_UNDER_REVIEW, ROLE.USER), [ACTION.VIEW_DETAILS]);

// isFinal()
assert.ok(isFinal(STATUS.PAID_FINALIZED));
assert.ok(isFinal(STATUS.CANCELLED));
assert.ok(!isFinal(STATUS.CONFIRMED_UNPAID));

// Invalid transitions return null / throw a 409 with currentStatus attached
assert.equal(nextStatusFor(STATUS.PAID_FINALIZED, ROLE.ADMIN, ACTION.CANCEL), null);
assert.equal(nextStatusFor(STATUS.CONFIRMED_UNPAID, ROLE.USER, ACTION.CONFIRM_ITEM), null);
assert.throws(
  () => assertTransition(STATUS.PAID_FINALIZED, ROLE.ADMIN, ACTION.CANCEL),
  (err) => err.status === 409 && err.code === "TRANSACTION_STATE_CHANGED" && err.currentStatus === STATUS.PAID_FINALIZED
);

// A user can never confirm/review/mark-paid a transaction from a status the
// USER role doesn't own an entry for at all.
assert.equal(nextStatusFor(STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION, ROLE.USER, ACTION.CONFIRM_PAYMENT), null);
assert.equal(nextStatusFor(STATUS.ITEM_UNDER_REVIEW, ROLE.USER, ACTION.CONFIRM_ITEM), null);

console.log("transaction status/transition regression checks passed");
