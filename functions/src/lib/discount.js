/* Early-payment discount: a customer who pays off yesterday's
 * CONFIRMED_UNPAID purchases by 3pm today (business-local time) gets 5%
 * off that whole day's batch. Miss that window and the same batch gets one
 * more chance the day after, at 10% off; miss that too and it's back to
 * full price for good - no further escalation, no more chances.
 *
 * Purely a function of (createdDate, now) - nothing is precomputed or
 * stored ahead of time, so the rate can be recomputed anywhere (settlement,
 * the customer-facing countdown card) and can never drift out of sync with
 * itself the way a cached/scheduled value could.
 *
 * Hours are evaluated in the business's own local time (Jamaica, UTC-5,
 * no DST) rather than whatever timezone the server process happens to be
 * configured with - Cloud Functions run in UTC by default, and "7am"/"3pm"
 * need to land on a customer's actual wall clock, not the server's. */
const { STATUS, deriveWorkflowStatus } = require("./transactionStatus");

const BUSINESS_UTC_OFFSET_HOURS = -5;
const WINDOW_START_HOUR = 7;
const WINDOW_END_HOUR = 15; // exclusive - the window closes AT 3pm
const SEGMENT_COUNT = WINDOW_END_HOUR - WINDOW_START_HOUR; // 8 hourly segments
const TIER_RATES = { 1: 0.05, 2: 0.10 };

// Purchases made before this feature ever existed shouldn't retroactively
// fall into a discount window just because their createdDate happens to
// land 1 or 2 days back from whenever this code runs - a customer's old,
// pre-existing unpaid balance was never given a fair chance to act on an
// incentive that didn't exist yet when they bought it. Only a purchase
// made on or after this date is ever eligible for any tier.
const LAUNCH_DATE = "2026-07-29";

function businessLocal(date) {
  return new Date(date.getTime() + BUSINESS_UTC_OFFSET_HOURS * 3600 * 1000);
}

function businessDateOnlyUTC(date) {
  const local = businessLocal(date);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

/* createdDate is already a plain "YYYY-MM-DD" calendar-date string with no
 * time component (see todayISO()) - parsed as a UTC midnight so the day-
 * difference math below isn't sensitive to the server's own timezone. */
function parseCreatedDateUTC(createdDate) {
  if (!createdDate || !/^\d{4}-\d{2}-\d{2}$/.test(createdDate)) return null;
  const [y, m, d] = createdDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function businessHour(date) {
  return businessLocal(date).getUTCHours();
}

function isWithinWindow(date) {
  const hour = businessHour(date);
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/* Returns { rate, tier } for one purchase day as of `now` - tier 0 means no
 * discount right now (too early, between windows, permanently expired
 * because more than 2 days have passed, or the purchase predates
 * LAUNCH_DATE and was never eligible in the first place). */
function discountForDate(createdDate, now = new Date()) {
  if (createdDate && createdDate < LAUNCH_DATE) return { rate: 0, tier: 0 };
  const purchaseDay = parseCreatedDateUTC(createdDate);
  if (purchaseDay == null || !isWithinWindow(now)) return { rate: 0, tier: 0 };
  const daysSince = Math.round((businessDateOnlyUTC(now) - purchaseDay) / 86400000);
  const rate = TIER_RATES[daysSince];
  return rate ? { rate, tier: daysSince } : { rate: 0, tier: 0 };
}

/* How many of the 8 hourly segments are still left in TODAY's 7am-3pm
 * window, for the countdown bar - 0 outside the window entirely. Doesn't
 * depend on which purchase day is being discounted, since the window's
 * clock is the same every day. */
function segmentsRemaining(now = new Date()) {
  const hour = businessHour(now);
  if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) return 0;
  return WINDOW_END_HOUR - hour;
}

const round2 = (n) => Math.round(n * 100) / 100;

/* Applies whatever discount is active right now to one transaction record -
 * used at the moment a transaction is actually finalized (mark-paid,
 * confirm-payment, or the automatic credit sweep), never before. Returns
 * the original shape unchanged (tier 0) when no discount applies. */
function discountedTotal(record, now = new Date()) {
  const total = Number(record.total || record.value || 0);
  const { rate, tier } = discountForDate(record.createdDate, now);
  if (tier === 0) return { finalTotal: total, rate: 0, tier: 0, originalTotal: null };
  return { finalTotal: round2(total * (1 - rate)), rate, tier, originalTotal: total };
}

/* The single most-urgent active discount offer across a customer's
 * CONFIRMED_UNPAID purchases right now, bundled by purchase day, or null
 * if nothing currently qualifies. "Most urgent" prefers the 10% (second-
 * day, last-chance) tier over 5% when both happen to be active at once -
 * only one distinct purchase day can ever occupy the second-day tier (miss
 * it and it disappears for good), and it's the one gone for good today. */
function activeDiscountOffer(transactions, now = new Date()) {
  const byDate = new Map();
  for (const t of transactions || []) {
    if (deriveWorkflowStatus(t) !== STATUS.CONFIRMED_UNPAID) continue;
    if (!t.createdDate) continue;
    const { rate, tier } = discountForDate(t.createdDate, now);
    if (tier === 0) continue;
    const bucket = byDate.get(t.createdDate) || { createdDate: t.createdDate, rate, tier, total: 0 };
    bucket.total += Number(t.total || t.value || 0);
    byDate.set(t.createdDate, bucket);
  }
  const offers = [...byDate.values()];
  if (!offers.length) return null;
  const best = offers.sort((a, b) => b.tier - a.tier)[0];
  return {
    createdDate: best.createdDate,
    tier: best.tier,
    rate: best.rate,
    total: round2(best.total),
    discountedTotal: round2(best.total * (1 - best.rate)),
    segmentsRemaining: segmentsRemaining(now),
    segmentCount: SEGMENT_COUNT,
    windowStartHour: WINDOW_START_HOUR,
    windowEndHour: WINDOW_END_HOUR,
  };
}

module.exports = {
  BUSINESS_UTC_OFFSET_HOURS, WINDOW_START_HOUR, WINDOW_END_HOUR, SEGMENT_COUNT, TIER_RATES, LAUNCH_DATE,
  discountForDate, discountedTotal, activeDiscountOffer, segmentsRemaining,
};
