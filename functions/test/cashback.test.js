// Early-payment cashback (see ../src/lib/cashback.js) - every check below
// pins an explicit `now` rather than using the real clock, so this test
// suite gives the same result no matter what day/time it's actually run.
// Fixture dates are chosen on or after LAUNCH_DATE (2026-07-29) unless a
// case is specifically testing the pre-launch cutoff itself.
const assert = require("node:assert/strict");
const { STATUS } = require("../src/lib/transactionStatus");
const {
  accountSnapshot, cashbackTierForDaysSince, daysSinceBalanceOpened,
  marginCashback, evaluateCashback, projectedCashback, expiredCashbackAmounts,
  LAUNCH_DATE, TIER_RATES,
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

// --- marginCashback: every still-owed transaction judged on its OWN date ---
const sameDayTxns = [{ id: "t1", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID }];
assert.deepEqual(
  marginCashback(sameDayTxns, new Date("2026-08-01T15:00:00Z")),
  { total: 100, amount: 10, oldestDate: "2026-08-01" },
  "a single fresh margin earns its own 10%"
);

const twoTxns = [
  { id: "t1", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "t2", total: 50, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
];
assert.deepEqual(
  marginCashback(twoTxns, new Date("2026-08-01T15:00:00Z")),
  { total: 150, amount: 15, oldestDate: "2026-08-01" },
  "two margins opened the same day both earn 10% - same as treating them as one lump sum"
);

// The case this whole model exists for: an old, already-expired charge
// sitting alongside a freshly added one on the SAME balance. The fresh
// charge still earns its own 10% - it isn't dragged down to the old
// charge's 0%, and the old charge doesn't dilute the new one either.
const mixedMargins = [
  { id: "old", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "new", total: 50, createdDate: "2026-08-03", workflowStatus: STATUS.CONFIRMED_UNPAID },
];
assert.deepEqual(
  marginCashback(mixedMargins, new Date("2026-08-03T15:00:00Z")),
  { total: 150, amount: 5, oldestDate: "2026-08-01" },
  "old margin (2 days old) earns 0, new margin (fresh today) earns 10% of its own $50 -> $5 total"
);

// --- evaluateCashback: the whole-balance-clearing trigger ---
// Same-day clearing -> 10%.
assert.deepEqual(
  evaluateCashback(sameDayTxns, ["t1"], new Date("2026-08-01T15:00:00Z")),
  { amount: 10, rate: 0.10, clearedTotal: 100, oldestDate: "2026-08-01" }
);
// Next-day clearing -> 5%.
assert.deepEqual(
  evaluateCashback(sameDayTxns, ["t1"], new Date("2026-08-02T15:00:00Z")),
  { amount: 5, rate: 0.05, clearedTotal: 100, oldestDate: "2026-08-01" }
);
// Third-day (or later) clearing -> nothing, even though it's paid in full.
assert.equal(evaluateCashback(sameDayTxns, ["t1"], new Date("2026-08-03T15:00:00Z")), null);
assert.equal(evaluateCashback(sameDayTxns, ["t1"], new Date("2026-09-01T15:00:00Z")), null);

// Clearing only PART of the balance earns nothing - the rule is "clear it
// in full," not "clear whatever this one payment happened to cover."
assert.equal(evaluateCashback(twoTxns, ["t1"], new Date("2026-08-01T15:00:00Z")), null, "one of two items still owed - no cashback yet");
assert.deepEqual(
  evaluateCashback(twoTxns, ["t1", "t2"], new Date("2026-08-01T15:00:00Z")),
  { amount: 15, rate: 0.10, clearedTotal: 150, oldestDate: "2026-08-01" },
  "clearing both together earns 10% of the combined total, since both margins are fresh"
);

// The mixed-margin case, cleared in full: earns a BLENDED rate (the old
// margin's 0% and the new margin's 10%, weighted by size), not the 0%
// the whole-balance-keyed-off-oldest rule would have given before, and
// not the 10% a naive "any new charge resets everything" rule would give.
assert.deepEqual(
  evaluateCashback(mixedMargins, ["old", "new"], new Date("2026-08-03T15:00:00Z")),
  { amount: 5, rate: 0.0333, clearedTotal: 150, oldestDate: "2026-08-01" }
);

// Nothing was owed to begin with - no cashback, regardless of what's "settled".
assert.equal(evaluateCashback([], [], new Date()), null);

// A pre-launch balance is never eligible, even when fully cleared same-day.
const preLaunch = [{ id: "old", total: 100, createdDate: "2026-07-20", workflowStatus: STATUS.CONFIRMED_UNPAID }];
assert.equal(evaluateCashback(preLaunch, ["old"], new Date("2026-07-20T15:00:00Z")), null);

// --- projectedCashback: what the customer-facing card shows before paying ---
const projection = projectedCashback(sameDayTxns, new Date("2026-08-01T15:00:00Z"));
assert.deepEqual(projection, { rate: 0.10, tier: 1, balance: 100, cashbackAmount: 10, oldestDate: "2026-08-01" });
assert.equal(projectedCashback(sameDayTxns, new Date("2026-08-05T15:00:00Z")), null, "the only margin present has expired - no projection shown");
assert.equal(projectedCashback([], new Date()), null, "no balance at all - no projection");

// The key behavioral change: a fresh margin stacked on an already-expired
// one still produces a (blended) projection - the old whole-balance rule
// would have shown nothing at all here, hiding a real, still-earning $2.
assert.deepEqual(
  projectedCashback(mixedMargins, new Date("2026-08-03T15:00:00Z")),
  { rate: 0.0333, tier: 2, balance: 150, cashbackAmount: 5, oldestDate: "2026-08-01" }
);

// --- expiredCashbackAmounts: the "here's what you missed" coupon display ---
// Still within a live tier (same day, or next day) - nothing expired yet.
assert.equal(expiredCashbackAmounts(sameDayTxns, new Date("2026-08-01T15:00:00Z")), null, "day 0 - still eligible for 10%, nothing expired");
assert.equal(expiredCashbackAmounts(sameDayTxns, new Date("2026-08-02T15:00:00Z")), null, "day 1 - still eligible for 5%, nothing expired");
// Third day (or later) with the balance still unpaid - both tiers gone.
assert.deepEqual(
  expiredCashbackAmounts(sameDayTxns, new Date("2026-08-03T15:00:00Z")),
  { balance: 100, tenPercentAmount: 10, fivePercentAmount: 5, oldestDate: "2026-08-01" }
);
assert.deepEqual(
  expiredCashbackAmounts(sameDayTxns, new Date("2026-09-01T15:00:00Z")),
  { balance: 100, tenPercentAmount: 10, fivePercentAmount: 5, oldestDate: "2026-08-01" },
  "still shows the missed amounts arbitrarily far past expiry, not just on the exact third day"
);
// No balance at all, or a pre-launch balance - nothing to show either way.
assert.equal(expiredCashbackAmounts([], new Date()), null, "no balance at all");
assert.equal(expiredCashbackAmounts(preLaunch, new Date("2026-09-01T15:00:00Z")), null, "pre-launch balance never had a tier to expire");

// A newer charge added on top of an already-expired one only shows the
// OLD margin as expired - the new one is still live, so it's excluded
// here (it shows up in projectedCashback instead, above). The two never
// double-count the same dollar.
assert.deepEqual(
  expiredCashbackAmounts(mixedMargins, new Date("2026-08-03T15:00:00Z")),
  { balance: 100, tenPercentAmount: 10, fivePercentAmount: 5, oldestDate: "2026-08-01" },
  "only the $100 old margin counts as expired - the fresh $50 margin is excluded, not lumped in"
);

console.log("early-payment cashback regression checks passed");
