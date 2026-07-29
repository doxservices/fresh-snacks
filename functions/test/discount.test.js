// Early-payment discount (see ../src/lib/discount.js) - every check below
// pins an explicit `now` rather than using the real clock, so this test
// suite gives the same result no matter what day/time it's actually run.
// All fixture dates are chosen on or after LAUNCH_DATE (2026-07-29) unless
// a case is specifically testing the pre-launch cutoff itself.
const assert = require("node:assert/strict");
const { STATUS } = require("../src/lib/transactionStatus");
const {
  discountForDate, discountedTotal, activeDiscountOffer, segmentsRemaining,
  WINDOW_START_HOUR, WINDOW_END_HOUR, SEGMENT_COUNT, LAUNCH_DATE,
} = require("../src/lib/discount");
const { paymentAllocationPlan } = require("../src/lib/shared");

assert.equal(WINDOW_START_HOUR, 7);
assert.equal(WINDOW_END_HOUR, 15);
assert.equal(SEGMENT_COUNT, 8);
assert.equal(LAUNCH_DATE, "2026-07-29");

// 2026-08-02T15:00:00Z = 10:00am business-local (UTC-5) on 2026-08-02 -
// mid-window, used as "now" for the hour/day-math checks below.
const MID_WINDOW = new Date("2026-08-02T15:00:00Z");
const BEFORE_WINDOW = new Date("2026-08-02T11:59:00Z"); // 6:59am business
const WINDOW_OPENS = new Date("2026-08-02T12:00:00Z"); // 7:00am business
const WINDOW_CLOSES = new Date("2026-08-02T20:00:00Z"); // 3:00pm business
const LAST_MINUTE = new Date("2026-08-02T19:59:00Z"); // 2:59pm business

// --- discountForDate: hour-of-day boundaries (createdDate fixed 1 day back) ---
assert.deepEqual(discountForDate("2026-08-01", BEFORE_WINDOW), { rate: 0, tier: 0 }, "before 7am, window hasn't opened yet");
assert.deepEqual(discountForDate("2026-08-01", WINDOW_OPENS), { rate: 0.05, tier: 1 }, "7am on the dot opens the window");
assert.deepEqual(discountForDate("2026-08-01", MID_WINDOW), { rate: 0.05, tier: 1 }, "mid-window");
assert.deepEqual(discountForDate("2026-08-01", LAST_MINUTE), { rate: 0.05, tier: 1 }, "still active one minute before 3pm");
assert.deepEqual(discountForDate("2026-08-01", WINDOW_CLOSES), { rate: 0, tier: 0 }, "3pm on the dot closes the window");

// --- discountForDate: day-math tiers, all as of the same MID_WINDOW moment ---
assert.deepEqual(discountForDate("2026-08-02", MID_WINDOW), { rate: 0, tier: 0 }, "same-day purchase never qualifies");
assert.deepEqual(discountForDate("2026-08-01", MID_WINDOW), { rate: 0.05, tier: 1 }, "1 day old - first-day tier");
assert.deepEqual(discountForDate("2026-07-31", MID_WINDOW), { rate: 0.10, tier: 2 }, "2 days old - second-day tier");
assert.deepEqual(discountForDate("2026-07-30", MID_WINDOW), { rate: 0, tier: 0 }, "3 days old - expired via day-math (still post-launch)");
assert.deepEqual(discountForDate(null, MID_WINDOW), { rate: 0, tier: 0 }, "no createdDate at all never qualifies");

// --- discountForDate: the LAUNCH_DATE cutoff itself ---
// 2026-07-29T15:00:00Z = 10:00am business-local on LAUNCH_DATE - a purchase
// from the day before (pre-launch) would otherwise read as "1 day old" by
// the same day-math above, but must NOT get a discount - it was never
// eligible in the first place, launched or not.
const LAUNCH_DAY_MID_WINDOW = new Date("2026-07-29T15:00:00Z");
assert.deepEqual(
  discountForDate("2026-07-28", LAUNCH_DAY_MID_WINDOW), { rate: 0, tier: 0 },
  "a pre-launch purchase is excluded even though the day-math alone would read as day 1"
);
// LAUNCH_DATE itself is the first eligible day, not excluded.
const DAY_AFTER_LAUNCH_MID_WINDOW = new Date("2026-07-30T15:00:00Z");
assert.deepEqual(
  discountForDate(LAUNCH_DATE, DAY_AFTER_LAUNCH_MID_WINDOW), { rate: 0.05, tier: 1 },
  "LAUNCH_DATE's own purchases are eligible once they age into the window"
);

// --- segmentsRemaining: the 8-bar countdown ---
assert.equal(segmentsRemaining(WINDOW_OPENS), 8, "full bar right when the window opens");
assert.equal(segmentsRemaining(LAST_MINUTE), 1, "one segment left in the final hour");
assert.equal(segmentsRemaining(WINDOW_CLOSES), 0, "no segments once the window closes");
assert.equal(segmentsRemaining(BEFORE_WINDOW), 0, "no segments before the window opens either");

// --- discountedTotal: what actually gets charged ---
assert.deepEqual(
  discountedTotal({ total: 100, createdDate: "2026-08-01" }, MID_WINDOW),
  { finalTotal: 95, rate: 0.05, tier: 1, originalTotal: 100 }
);
assert.deepEqual(
  discountedTotal({ total: 100, createdDate: "2026-07-31" }, MID_WINDOW),
  { finalTotal: 90, rate: 0.10, tier: 2, originalTotal: 100 }
);
assert.deepEqual(
  discountedTotal({ total: 100, createdDate: "2026-08-02" }, MID_WINDOW),
  { finalTotal: 100, rate: 0, tier: 0, originalTotal: null },
  "no discount active - total passes through unchanged, no originalTotal recorded"
);

// --- activeDiscountOffer: what the customer-facing card shows ---
const txns = [
  { id: "t1", userId: "u1", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "t2", userId: "u1", total: 40, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "t3", userId: "u1", total: 500, createdDate: "2026-07-20", workflowStatus: STATUS.CONFIRMED_UNPAID }, // pre-launch, long expired either way
  { id: "t4", userId: "u1", total: 999, createdDate: "2026-08-01", workflowStatus: STATUS.PAID_FINALIZED }, // already settled
];
const offer = activeDiscountOffer(txns, MID_WINDOW);
assert.equal(offer.tier, 1);
assert.equal(offer.rate, 0.05);
assert.equal(offer.createdDate, "2026-08-01");
assert.equal(offer.total, 140, "bundles same-day CONFIRMED_UNPAID purchases together (100 + 40)");
assert.equal(offer.discountedTotal, 133, "140 * 0.95");
assert.equal(offer.segmentsRemaining, 5);
assert.equal(offer.segmentCount, 8);

assert.equal(activeDiscountOffer([], MID_WINDOW), null, "no transactions at all - no offer");
assert.equal(
  activeDiscountOffer([{ id: "old", userId: "u1", total: 50, createdDate: "2026-07-01", workflowStatus: STATUS.CONFIRMED_UNPAID }], MID_WINDOW),
  null,
  "nothing currently in an active window - no offer"
);

// Both tiers active at once (a customer behind by two separate days) -
// the second-day (10%, about to expire for good) batch wins over the
// first-day (5%) one, since it's the one truly gone if missed today.
const bothTiers = [
  { id: "day1", userId: "u1", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID },
  { id: "day2", userId: "u1", total: 200, createdDate: "2026-07-31", workflowStatus: STATUS.CONFIRMED_UNPAID },
];
const urgent = activeDiscountOffer(bothTiers, MID_WINDOW);
assert.equal(urgent.tier, 2);
assert.equal(urgent.createdDate, "2026-07-31");

// --- paymentAllocationPlan: the discount actually stretches existing credit ---
// A $100 purchase eligible for 5% off only costs $95 of credit to settle,
// leaving $5 more available than a same-priced, non-discounted purchase
// would have.
const discountEligible = [{ id: "eligible", total: 100, createdDate: "2026-08-01", workflowStatus: STATUS.CONFIRMED_UNPAID }];
const plan = paymentAllocationPlan(discountEligible, 100, MID_WINDOW);
assert.deepEqual(plan.settledIds, ["eligible"]);
assert.equal(plan.credit, 5, "5% of the $100 total stays as leftover credit");
assert.deepEqual(plan.discounts.eligible, { finalTotal: 95, rate: 0.05, tier: 1, originalTotal: 100 });

const notEligible = [{ id: "not-eligible", total: 100, createdDate: "2026-08-02", workflowStatus: STATUS.CONFIRMED_UNPAID }];
const noDiscountPlan = paymentAllocationPlan(notEligible, 100, MID_WINDOW);
assert.deepEqual(noDiscountPlan.settledIds, ["not-eligible"]);
assert.equal(noDiscountPlan.credit, 0, "same-day purchase settles at full price, no leftover credit");
assert.deepEqual(noDiscountPlan.discounts, {});

console.log("early-payment discount regression checks passed");
