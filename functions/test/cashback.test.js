// Early-payment cashback (see ../src/lib/cashback.js) - every check below
// pins an explicit `now` rather than using the real clock, so this test
// suite gives the same result no matter what day/time it's actually run.
// Fixture dates are chosen on or after LAUNCH_DATE (2026-07-29) unless a
// case is specifically testing the pre-launch cutoff itself.
const assert = require("node:assert/strict");
const { STATUS } = require("../src/lib/transactionStatus");
const {
  accountSnapshot, cashbackTierForDaysSince, daysSinceBalanceOpened,
  evaluateCashback, projectedCashback, LAUNCH_DATE, TIER_RATES,
} = require("../src/lib/cashback");

assert.equal(LAUNCH_DATE, "2026-07-29");
assert.deepEqual(TIER_RATES, { 0: 0.10, 1: 0.05 });

// --- cashbackTierForDaysSince: the tier table itself ---
assert.deepEqual(cashbackTierForDaysSince(0), { rate: 0.10, tier: 1 }, "same day the balance opened - first-day, biggest reward");
assert.deepEqual(cashbackTierForDaysSince(1), { rate: 0.05, tier: 2 }, "the day after - second-day, smaller reward");
assert.deepEqual(cashbackTierForDaysSince(2), { rate: 0, tier: 0 }, "third day holding a balance - no reward at all");
assert.deepEqual(cashbackTierForDaysSince(30), { rate: 0, tier: 0 });

// --- daysSinceBalanceOpened: the launch-date cutoff ---
assert.equal(daysSinceBalanceOpened("2026-07-29", new Date("2026-07-29T12:00:00Z")), 0, "LAUNCH_DATE itself is eligible, day 0");
assert.equal(daysSinceBalanceOpened("2026-07-28", new Date("2026-07-29T12:00:00Z")), null, "a pre-launch balance is never eligible, no matter the day-math");
assert.equal(daysSinceBalanceOpened(null, new Date()), null, "no oldest date at all");

// --- accountSnapshot: what's currently owed, and since when ---
const mixed = [
  { id: "a", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "b", total: 50, createdDate: "2026-07-30", workflowStatus: STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION },
  { id: "c", total: 999, createdDate: "2026-07-01", workflowStatus: STATUS.ITEM_UNDER_REVIEW }, // disputed - excluded
  { id: "d", total: 999, createdDate: "2026-07-01", workflowStatus: STATUS.PAID_FINALIZED }, // already settled - excluded
  { id: "e", total: 999, createdDate: "2026-07-01", workflowStatus: STATUS.CONFIRMED_UNPAID, status: "void" }, // voided - excluded
];
const snap = accountSnapshot(mixed);
assert.equal(snap.total, 150, "only the two genuinely-owed records count (100 + 50)");
assert.equal(snap.oldestDate, "2026-07-30", "the earlier of the two owed records' dates");
assert.deepEqual(accountSnapshot([]), { total: 0, oldestDate: null });

// --- evaluateCashback: the whole-balance-clearing trigger ---
// Same-day clearing -> 10%.
const sameDayTxns = [{ id: "t1", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID }];
assert.deepEqual(
  evaluateCashback(sameDayTxns, ["t1"], new Date("2026-08-01T15:00:00Z")),
  { amount: 10, rate: 0.10, tier: 1, clearedTotal: 100, oldestDate: "2026-08-01" }
);
// Next-day clearing -> 5%.
assert.deepEqual(
  evaluateCashback(sameDayTxns, ["t1"], new Date("2026-08-02T15:00:00Z")),
  { amount: 5, rate: 0.05, tier: 2, clearedTotal: 100, oldestDate: "2026-08-01" }
);
// Third-day (or later) clearing -> nothing, even though it's paid in full.
assert.equal(evaluateCashback(sameDayTxns, ["t1"], new Date("2026-08-03T15:00:00Z")), null);
assert.equal(evaluateCashback(sameDayTxns, ["t1"], new Date("2026-09-01T15:00:00Z")), null);

// Clearing only PART of the balance earns nothing - the rule is "clear it
// in full," not "clear whatever this one payment happened to cover."
const twoTxns = [
  { id: "t1", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "t2", total: 50, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
];
assert.equal(evaluateCashback(twoTxns, ["t1"], new Date("2026-08-01T15:00:00Z")), null, "one of two items still owed - no cashback yet");
assert.deepEqual(
  evaluateCashback(twoTxns, ["t1", "t2"], new Date("2026-08-01T15:00:00Z")),
  { amount: 15, rate: 0.10, tier: 1, clearedTotal: 150, oldestDate: "2026-08-01" },
  "clearing both together earns 10% of the combined total"
);

// Nothing was owed to begin with - no cashback, regardless of what's "settled".
assert.equal(evaluateCashback([], [], new Date()), null);

// A pre-launch balance is never eligible, even when fully cleared same-day.
const preLaunch = [{ id: "old", total: 100, createdDate: "2026-07-20", workflowStatus: STATUS.CONFIRMED_UNPAID }];
assert.equal(evaluateCashback(preLaunch, ["old"], new Date("2026-07-20T15:00:00Z")), null);

// --- projectedCashback: what the customer-facing card shows before paying ---
const projection = projectedCashback(sameDayTxns, new Date("2026-08-01T15:00:00Z"));
assert.deepEqual(projection, { rate: 0.10, tier: 1, balance: 100, cashbackAmount: 10, oldestDate: "2026-08-01" });
assert.equal(projectedCashback(sameDayTxns, new Date("2026-08-05T15:00:00Z")), null, "expired - no projection shown");
assert.equal(projectedCashback([], new Date()), null, "no balance at all - no projection");

console.log("early-payment cashback regression checks passed");
