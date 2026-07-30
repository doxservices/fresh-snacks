/* Early-payment CASHBACK: a customer who brings their ENTIRE account
 * balance down to $0 gets a percentage of what they just paid credited
 * back to their account (a new payment/credit line, available toward
 * their next purchase) - not a reduced charge at payment time, a reward
 * for actually clearing the debt in full.
 *
 * Tiers count from the day the balance first went above $0 (the
 * createdDate of the oldest still-owed transaction) - clear it the SAME
 * day for 10%, the day after for 5%; any later than that and there's no
 * reward at all for that debt cycle, even if it's eventually paid in
 * full. A fresh cycle (and a fresh shot at 10%) starts the next time a
 * new purchase takes the balance from $0 back above zero.
 *
 * Only the calendar business-local day matters here, not the hour - no
 * intra-day deadline the way the (now-replaced) per-purchase discount had. */
const { STATUS, deriveWorkflowStatus } = require("./transactionStatus");

const BUSINESS_UTC_OFFSET_HOURS = -5;
const TIER_RATES = { 0: 0.10, 1: 0.05 }; // daysSince 0 (same day) -> 10%, daysSince 1 (next day) -> 5%

// A pre-existing balance was never given a fair chance to act on an
// incentive that didn't exist yet - only a balance that opened (went from
// $0 to something owed) on or after this date is ever eligible.
const LAUNCH_DATE = "2026-07-29";

function businessDateOnlyUTC(date) {
  const local = new Date(date.getTime() + BUSINESS_UTC_OFFSET_HOURS * 3600 * 1000);
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

const round2 = (n) => Math.round(n * 100) / 100;

/* A transaction still counts against the balance unless it's cancelled,
 * disputed (ITEM_UNDER_REVIEW - a live question over whether it's owed at
 * all), or already finalized - matches accounting()'s own balance rule. */
function isOwed(record) {
  const status = deriveWorkflowStatus(record);
  return status !== STATUS.ITEM_UNDER_REVIEW && status !== STATUS.PAID_FINALIZED && status !== STATUS.CANCELLED;
}

/* The account's current outstanding total and the date its balance most
 * recently went from $0 to something owed (the oldest still-owed
 * transaction's createdDate) - total 0 / oldestDate null if nothing is
 * currently owed. */
function accountSnapshot(transactions) {
  const owed = (transactions || []).filter((t) => t.status !== "void" && isOwed(t));
  const total = round2(owed.reduce((sum, t) => sum + Number(t.total || t.value || 0), 0));
  let oldestDate = null;
  for (const t of owed) {
    if (t.createdDate && (!oldestDate || t.createdDate < oldestDate)) oldestDate = t.createdDate;
  }
  return { total, oldestDate };
}

function cashbackTierForDaysSince(daysSince) {
  const rate = TIER_RATES[daysSince];
  return rate ? { rate, tier: daysSince + 1 } : { rate: 0, tier: 0 };
}

// null (never eligible) when there's no oldestDate at all, or it predates
// LAUNCH_DATE.
function daysSinceBalanceOpened(oldestDate, now = new Date()) {
  if (!oldestDate || oldestDate < LAUNCH_DATE) return null;
  const opened = parseCreatedDateUTC(oldestDate);
  if (opened == null) return null;
  return Math.round((businessDateOnlyUTC(now) - opened) / 86400000);
}

/* Given the FULL pre-action list of a customer's transactions and the ids
 * about to be finalized (marked paid) by whatever settlement action is
 * running right now, decides whether this brings their WHOLE balance to
 * $0 and, if so, what cashback (if any) that earns. Returns null when no
 * cashback should be granted - either this action doesn't fully clear the
 * balance, or it does but the timing no longer qualifies for any tier.
 * `now` is the moment this settlement action is happening. */
function evaluateCashback(transactionsBefore, settledIds, now = new Date()) {
  const before = accountSnapshot(transactionsBefore);
  if (before.total <= 0 || !before.oldestDate) return null; // nothing was owed to begin with
  const settled = new Set(settledIds);
  const stillOwed = (transactionsBefore || []).some((t) => t.status !== "void" && isOwed(t) && !settled.has(t.id));
  if (stillOwed) return null; // this action doesn't clear everything

  const daysSince = daysSinceBalanceOpened(before.oldestDate, now);
  const { rate, tier } = cashbackTierForDaysSince(daysSince);
  if (tier === 0) return null;
  return { amount: round2(before.total * rate), rate, tier, clearedTotal: before.total, oldestDate: before.oldestDate };
}

/* The customer-facing projection - "if you clear your whole balance right
 * now, here's what you'd earn back" - shown on index.html's Current
 * Balance card before any payment happens. Same tier rule, just without
 * requiring the balance to actually be zero yet. */
function projectedCashback(transactions, now = new Date()) {
  const { total, oldestDate } = accountSnapshot(transactions);
  if (total <= 0 || !oldestDate) return null;
  const daysSince = daysSinceBalanceOpened(oldestDate, now);
  const { rate, tier } = cashbackTierForDaysSince(daysSince);
  if (tier === 0) return null;
  return { rate, tier, balance: total, cashbackAmount: round2(total * rate), oldestDate };
}

/* Purely informational - "here's what you missed" once a balance has sat
 * unpaid past every tier (2+ days since it opened). Nothing here changes
 * what a payment actually earns (that's still evaluateCashback, driven
 * solely by the oldest still-owed transaction's date) - this just derives
 * a display of the 10%/5% amounts that were on the table each day this
 * balance sat open, computed against its current total, for a "these
 * bonuses expired" coupon-style card. Adding a new charge does NOT reset
 * this or grant a fresh 10% for the combined balance - the tier a payment
 * actually earns is still tied to the oldest unpaid item, same as ever. */
function expiredCashbackAmounts(transactions, now = new Date()) {
  const { total, oldestDate } = accountSnapshot(transactions);
  if (total <= 0 || !oldestDate) return null;
  const daysSince = daysSinceBalanceOpened(oldestDate, now);
  if (daysSince == null || daysSince < 2) return null; // still within a live tier, or pre-launch
  return {
    balance: total,
    tenPercentAmount: round2(total * TIER_RATES[0]),
    fivePercentAmount: round2(total * TIER_RATES[1]),
    oldestDate,
  };
}

module.exports = {
  BUSINESS_UTC_OFFSET_HOURS, TIER_RATES, LAUNCH_DATE,
  isOwed, accountSnapshot, cashbackTierForDaysSince, daysSinceBalanceOpened,
  evaluateCashback, projectedCashback, expiredCashbackAmounts,
};
