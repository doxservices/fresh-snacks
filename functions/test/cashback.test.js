// Early-payment cashback (see ../src/lib/cashback.js) - every check below
// pins an explicit `now` rather than using the real clock, so this test
// suite gives the same result no matter what day/time it's actually run.
// Fixture dates are chosen on or after LAUNCH_DATE (2026-07-29) unless a
// case is specifically testing the pre-launch cutoff itself. Balance
// fixtures are all >= MIN_BALANCE_FOR_CASHBACK_JMD (300) so they actually
// clear the eligibility floor.
const assert = require("node:assert/strict");
const { STATUS } = require("../src/lib/transactionStatus");
const {
  accountSnapshot, cashbackTierForDaysSince, daysSinceBalanceOpened, creditBalance,
  marginCashback, evaluateCashback, projectedCashback, expiredCashbackAmounts, isWithinDailyBonusWindow,
  LAUNCH_DATE, TIER_RATES, MIN_BALANCE_FOR_CASHBACK_JMD, CASHBACK_WINDOW_START_HOUR, CASHBACK_WINDOW_HOURS,
} = require("../src/lib/cashback");

assert.equal(LAUNCH_DATE, "2026-07-29");
assert.deepEqual(TIER_RATES, { 0: 0.10, 1: 0.05 });
assert.equal(MIN_BALANCE_FOR_CASHBACK_JMD, 300);

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

// --- isWithinDailyBonusWindow: the 7am-3pm business-local bonus window ---
assert.equal(CASHBACK_WINDOW_START_HOUR, 7);
assert.equal(CASHBACK_WINDOW_HOURS, 8);
// 15:00Z minus the -5 business offset = 10am local - inside the window.
assert.equal(isWithinDailyBonusWindow(new Date("2026-08-01T15:00:00Z")), true, "10am local - well inside 7am-3pm");
// Exactly 7am local (12:00Z) - the window's opening edge, inclusive.
assert.equal(isWithinDailyBonusWindow(new Date("2026-08-01T12:00:00Z")), true, "7am local exactly - window just opened");
// Exactly 3pm local (20:00Z) - the window's closing edge, exclusive.
assert.equal(isWithinDailyBonusWindow(new Date("2026-08-01T20:00:00Z")), false, "3pm local exactly - window just closed");
// Before 7am local (10:00Z = 5am local).
assert.equal(isWithinDailyBonusWindow(new Date("2026-08-01T10:00:00Z")), false, "5am local - too early, window hasn't opened");
// Kaceanne's actual case: 4:07pm local (21:07Z) - well after the window closed.
assert.equal(isWithinDailyBonusWindow(new Date("2026-08-17T21:07:45Z")), false, "4:07pm local - hours after the window closed");

// --- creditBalance: explicit, intentional credit tracking ---
// Nothing earned, nothing consumed - no credit either way.
assert.equal(creditBalance([], []), 0);
// A cashback payout sitting unspent, nothing has drawn on it yet.
assert.equal(
  creditBalance([{ amount: 30, status: "active", source: "cashback" }], []),
  30, "an earned cashback payout is credit until something consumes it"
);
// An ordinary (non-cashback) overpayment is real money, but a different
// bucket - it never counts as "credit" for this gate.
assert.equal(
  creditBalance([{ amount: 30, status: "active", source: "admin" }], []),
  0, "an admin overpayment isn't a cashback reward - different bucket, not counted here"
);
// A recorded consumption draws the balance down.
assert.equal(
  creditBalance(
    [{ amount: 30, status: "active", source: "cashback" }],
    [{ amount: 30, status: "active" }],
  ),
  0, "fully consumed - no credit left"
);
assert.equal(
  creditBalance(
    [{ amount: 30, status: "active", source: "cashback" }],
    [{ amount: 12, status: "active" }],
  ),
  18, "partially consumed - the remainder is still credit"
);
// Never negative.
assert.equal(
  creditBalance(
    [{ amount: 30, status: "active", source: "cashback" }],
    [{ amount: 1000, status: "active" }],
  ),
  0, "floors at 0, never negative"
);
// Voided entries on either side don't count.
assert.equal(
  creditBalance(
    [{ amount: 30, status: "active", source: "cashback" }, { amount: 15, status: "void", source: "cashback" }],
    [{ amount: 100, status: "void" }],
  ),
  30, "voided cashback payments and voided consumptions are both ignored"
);

// --- marginCashback: every still-owed transaction judged on its OWN date ---
const sameDayTxns = [{ id: "t1", total: 300, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID }];
assert.deepEqual(
  marginCashback(sameDayTxns, new Date("2026-08-01T15:00:00Z")),
  { total: 300, amount: 30, oldestDate: "2026-08-01" },
  "a single fresh margin earns its own 10%"
);

const twoTxns = [
  { id: "t1", total: 200, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "t2", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
];
assert.deepEqual(
  marginCashback(twoTxns, new Date("2026-08-01T15:00:00Z")),
  { total: 300, amount: 30, oldestDate: "2026-08-01" },
  "two margins opened the same day both earn 10% - same as treating them as one lump sum"
);

// The case this whole model exists for: an old, already-expired charge
// sitting alongside a freshly added one on the SAME balance. The fresh
// charge still earns its own 10% - it isn't dragged down to the old
// charge's 0%, and the old charge doesn't dilute the new one either.
const mixedMargins = [
  { id: "old", total: 200, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "new", total: 100, createdDate: "2026-08-03", workflowStatus: STATUS.CONFIRMED_UNPAID },
];
assert.deepEqual(
  marginCashback(mixedMargins, new Date("2026-08-03T15:00:00Z")),
  { total: 300, amount: 10, oldestDate: "2026-08-01" },
  "old margin (2 days old) earns 0, new margin (fresh today) earns 10% of its own $100 -> $10 total"
);

// --- evaluateCashback: the whole-balance-clearing trigger ---
// Same-day clearing -> 10%. No prior payments/credit at all - full eligibility.
assert.deepEqual(
  evaluateCashback(sameDayTxns, [], [], ["t1"], new Date("2026-08-01T15:00:00Z")),
  { bonus: { amount: 30, rate: 0.10, clearedTotal: 300, oldestDate: "2026-08-01" }, creditConsumed: 0, clearedTotal: 300 }
);
// Next-day clearing -> 5%.
assert.deepEqual(
  evaluateCashback(sameDayTxns, [], [], ["t1"], new Date("2026-08-02T15:00:00Z")),
  { bonus: { amount: 15, rate: 0.05, clearedTotal: 300, oldestDate: "2026-08-01" }, creditConsumed: 0, clearedTotal: 300 }
);
// Third-day (or later) clearing -> no bonus, and nothing was drawn from credit either - null.
assert.equal(evaluateCashback(sameDayTxns, [], [], ["t1"], new Date("2026-08-03T15:00:00Z")), null);
assert.equal(evaluateCashback(sameDayTxns, [], [], ["t1"], new Date("2026-09-01T15:00:00Z")), null);

// Clearing only PART of the balance earns nothing - the rule is "clear it
// in full," not "clear whatever this one payment happened to cover."
assert.equal(evaluateCashback(twoTxns, [], [], ["t1"], new Date("2026-08-01T15:00:00Z")), null, "one of two items still owed - no cashback yet");
assert.deepEqual(
  evaluateCashback(twoTxns, [], [], ["t1", "t2"], new Date("2026-08-01T15:00:00Z")),
  { bonus: { amount: 30, rate: 0.10, clearedTotal: 300, oldestDate: "2026-08-01" }, creditConsumed: 0, clearedTotal: 300 },
  "clearing both together earns 10% of the combined total, since both margins are fresh"
);

// The mixed-margin case, cleared in full: earns a BLENDED rate (the old
// margin's 0% and the new margin's 10%, weighted by size).
assert.deepEqual(
  evaluateCashback(mixedMargins, [], [], ["old", "new"], new Date("2026-08-03T15:00:00Z")),
  { bonus: { amount: 10, rate: 0.0333, clearedTotal: 300, oldestDate: "2026-08-01" }, creditConsumed: 0, clearedTotal: 300 }
);

// --- evaluateCashback + isWithinDailyBonusWindow: the real Kaceanne bug ---
// Same-day clearing, but the settlement itself happens well after the
// 7am-3pm window (4:07pm local, same shape as Kaceanne's actual case) -
// earns nothing, even though the tier math alone would call this "same
// day, 10%". No credit involved either, so there's nothing at all to
// record - null, not a zeroed-out object.
assert.equal(
  evaluateCashback(sameDayTxns, [], [], ["t1"], new Date("2026-08-01T21:07:00Z")),
  null,
  "settled at 4:07pm local - after the daily window closed, no bonus despite same-day tier"
);
// The same round, settled earlier the same day while the window is still
// open, earns the full 10% as normal - proves the suppression above is
// really about the hour, not something else about this fixture.
assert.deepEqual(
  evaluateCashback(sameDayTxns, [], [], ["t1"], new Date("2026-08-01T15:00:00Z")),
  { bonus: { amount: 30, rate: 0.10, clearedTotal: 300, oldestDate: "2026-08-01" }, creditConsumed: 0, clearedTotal: 300 },
  "same round, settled at 10am local instead - window's open, full 10% earned"
);
// Right at the boundary (3pm local exactly) - already closed (exclusive).
assert.equal(
  evaluateCashback(sameDayTxns, [], [], ["t1"], new Date("2026-08-01T20:00:00Z")),
  null,
  "settled at exactly 3pm local - the window has already closed by this instant"
);

// Nothing was owed to begin with - no cashback, regardless of what's "settled".
assert.equal(evaluateCashback([], [], [], [], new Date()), null);

// A pre-launch balance is never eligible, even when fully cleared same-day -
// and since nothing was earned and no credit exists, there's nothing to
// record at all (null, not a zeroed-out object).
const preLaunch = [{ id: "old", total: 300, createdDate: "2026-07-20", workflowStatus: STATUS.CONFIRMED_UNPAID }];
assert.equal(evaluateCashback(preLaunch, [], [], ["old"], new Date("2026-07-20T15:00:00Z")), null);

// --- evaluateCashback + creditBalance: no discount on a discount ---
// Andreanna's actual case, reproduced: a $300 balance was cleared once
// already, earning a $30 cashback (now sitting as unspent credit on the
// books). $300 of brand-new same-day purchases come in; the account is
// fully cleared again, this time with $270 of fresh payment plus that
// $30 of leftover credit. Under the new all-or-nothing rule, ANY existing
// credit involved in a settlement round means NO new bonus for that round
// (not a prorated one) - the $30 already earned its reward once, and the
// two buckets (fresh money vs. reused credit) are never blended into one
// reward calculation again. The $30 is instead recorded as a deliberate
// creditConsumed draw-down.
//
// `paymentsBefore` here deliberately excludes the fresh $270 payment that
// actually funds this round's clearance - that's what allocateApprovedTransactions
// (../lib/settlement.js) passes in practice via its freshPaymentIds
// exclusion, since evaluateCashback itself has no notion of "which
// payment is the fresh one." Only prior, already-on-file money belongs here.
const priorCashbackPayment = { amount: 30, status: "active", source: "cashback" };
const priorRealPayment = { amount: 300, status: "active", source: "admin" };
const newRoundTxns = [
  { id: "old1", total: 200, createdDate: "2026-08-01", workflowStatus: STATUS.PAID_FINALIZED }, // already settled by the first $300 round
  { id: "old2", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.PAID_FINALIZED },
  { id: "new1", total: 200, createdDate: "2026-08-02", workflowStatus: STATUS.CONFIRMED_UNPAID }, // this round's fresh $300
  { id: "new2", total: 100, createdDate: "2026-08-02", workflowStatus: STATUS.CONFIRMED_UNPAID },
];
const priorPaymentsOnly = [priorRealPayment, priorCashbackPayment];
assert.deepEqual(
  evaluateCashback(newRoundTxns, priorPaymentsOnly, [], ["new1", "new2"], new Date("2026-08-02T15:00:00Z")),
  { bonus: null, creditConsumed: 30, clearedTotal: 300 },
  "existing $30 credit funds part of this round - no new bonus, $30 recorded as consumed instead"
);
// Without the prior cashback credit in the picture (a plain first-time
// clearance of the same $300), the reward is the full 10% of $300 - proves
// the suppression above really is coming from the prior credit, not some
// other side effect of the fixture shape.
assert.deepEqual(
  evaluateCashback(newRoundTxns, [priorRealPayment], [], ["new1", "new2"], new Date("2026-08-02T15:00:00Z")),
  { bonus: { amount: 30, rate: 0.10, clearedTotal: 300, oldestDate: "2026-08-02" }, creditConsumed: 0, clearedTotal: 300 },
  "no cashback payment in the history - full $300 is eligible, full bonus"
);
// Once that $30 has already been recorded as consumed (a creditConsumptions
// entry from a PRIOR round), it no longer counts as available credit - a
// later, fully-fresh-money round earns its bonus normally again.
assert.deepEqual(
  evaluateCashback(newRoundTxns, priorPaymentsOnly, [{ amount: 30, status: "active" }], ["new1", "new2"], new Date("2026-08-02T15:00:00Z")),
  { bonus: { amount: 30, rate: 0.10, clearedTotal: 300, oldestDate: "2026-08-02" }, creditConsumed: 0, clearedTotal: 300 },
  "the $30 credit was already spent in an earlier round - nothing left to gate this one"
);

// --- projectedCashback: what the customer-facing card shows before paying ---
const projection = projectedCashback(sameDayTxns, [], [], new Date("2026-08-01T15:00:00Z"));
assert.deepEqual(projection, { rate: 0.10, tier: 1, balance: 300, cashbackAmount: 30, oldestDate: "2026-08-01" });
assert.equal(projectedCashback(sameDayTxns, [], [], new Date("2026-08-05T15:00:00Z")), null, "the only margin present has expired - no projection shown");
assert.equal(projectedCashback([], [], [], new Date()), null, "no balance at all - no projection");

// The key behavioral change from the original flat model: a fresh margin
// stacked on an already-expired one still produces a (blended) projection.
assert.deepEqual(
  projectedCashback(mixedMargins, [], [], new Date("2026-08-03T15:00:00Z")),
  { rate: 0.0333, tier: 2, balance: 300, cashbackAmount: 10, oldestDate: "2026-08-01" }
);

// The projection is suppressed entirely once existing credit would fund
// part of clearing the balance - matches evaluateCashback's all-or-nothing
// rule, so what's shown before paying never promises a reward that won't
// actually be paid out.
assert.equal(
  projectedCashback(newRoundTxns, priorPaymentsOnly, [], new Date("2026-08-02T15:00:00Z")),
  null,
  "existing $30 credit would fund part of this round - no reward projected"
);

// --- expiredCashbackAmounts: the "here's what you missed" coupon display ---
// Still within a live tier (same day, or next day) - nothing expired yet.
assert.equal(expiredCashbackAmounts(sameDayTxns, new Date("2026-08-01T15:00:00Z")), null, "day 0 - still eligible for 10%, nothing expired");
assert.equal(expiredCashbackAmounts(sameDayTxns, new Date("2026-08-02T15:00:00Z")), null, "day 1 - still eligible for 5%, nothing expired");
// Third day (or later) with the balance still unpaid - both tiers gone.
assert.deepEqual(
  expiredCashbackAmounts(sameDayTxns, new Date("2026-08-03T15:00:00Z")),
  { balance: 300, tenPercentAmount: 30, fivePercentAmount: 15, oldestDate: "2026-08-01" }
);
assert.deepEqual(
  expiredCashbackAmounts(sameDayTxns, new Date("2026-09-01T15:00:00Z")),
  { balance: 300, tenPercentAmount: 30, fivePercentAmount: 15, oldestDate: "2026-08-01" },
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
  { balance: 200, tenPercentAmount: 20, fivePercentAmount: 10, oldestDate: "2026-08-01" },
  "only the $200 old margin counts as expired - the fresh $100 margin is excluded, not lumped in"
);

console.log("early-payment cashback regression checks passed");
