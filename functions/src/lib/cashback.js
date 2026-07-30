/* Early-payment CASHBACK: a customer who brings their ENTIRE account
 * balance down to $0 gets a percentage of what they just paid credited
 * back to their account (a new payment/credit line, available toward
 * their next purchase) - not a reduced charge at payment time, a reward
 * for actually clearing the debt in full.
 *
 * The reward is calculated per MARGIN (each individual still-owed
 * transaction), not on the balance as one lump sum - every transaction's
 * own createdDate decides its own tier: same day it was added earns 10%,
 * the day after earns 5%, any later than that earns nothing for that
 * one transaction specifically. A charge added after an existing balance
 * has already aged past a tier still gets its own fresh shot at 10% -
 * it isn't dragged down to whatever the oldest item in the balance has
 * decayed to, and an old, already-expired item doesn't dilute what a
 * newer one on the same balance still earns either. Clearing the WHOLE
 * balance to $0 is still what triggers a payout at all; only the rate
 * applied to each dollar within it now depends on that dollar's own age.
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

const round4 = (n) => Math.round(n * 10000) / 10000;

/* The per-margin breakdown itself: every still-owed transaction judged on
 * its own createdDate, summed into one total and one blended earned
 * amount. `oldestDate` is still the earliest owed transaction's date -
 * kept for audit/history, not for deciding anyone's rate anymore. */
function marginCashback(transactions, now = new Date()) {
  const owed = (transactions || []).filter((t) => t.status !== "void" && isOwed(t));
  let total = 0;
  let amount = 0;
  let oldestDate = null;
  for (const t of owed) {
    const value = Number(t.total || t.value || 0);
    total += value;
    if (t.createdDate && (!oldestDate || t.createdDate < oldestDate)) oldestDate = t.createdDate;
    const daysSince = daysSinceBalanceOpened(t.createdDate, now);
    if (daysSince == null) continue; // this margin itself is pre-launch or dateless - earns nothing
    amount += value * cashbackTierForDaysSince(daysSince).rate;
  }
  return { total: round2(total), amount: round2(amount), oldestDate };
}

/* Given the FULL pre-action list of a customer's transactions and the ids
 * about to be finalized (marked paid) by whatever settlement action is
 * running right now, decides whether this brings their WHOLE balance to
 * $0 and, if so, what cashback (if any) that earns. Returns null when no
 * cashback should be granted - either this action doesn't fully clear the
 * balance, or every margin in it has aged past its own tier. `now` is the
 * moment this settlement action is happening. */
function evaluateCashback(transactionsBefore, settledIds, now = new Date()) {
  const before = accountSnapshot(transactionsBefore);
  if (before.total <= 0 || !before.oldestDate) return null; // nothing was owed to begin with
  const settled = new Set(settledIds);
  const stillOwed = (transactionsBefore || []).some((t) => t.status !== "void" && isOwed(t) && !settled.has(t.id));
  if (stillOwed) return null; // this action doesn't clear everything

  const { total, amount, oldestDate } = marginCashback(transactionsBefore, now);
  if (amount <= 0) return null;
  return { amount, rate: round4(amount / total), clearedTotal: total, oldestDate };
}

/* The customer-facing projection - "if you clear your whole balance right
 * now, here's what you'd earn back" - shown on index.html's Current
 * Balance card before any payment happens. Earns whenever ANY margin in
 * the balance still qualifies, even if the oldest item in it has already
 * fully expired - a fresher charge stacked on top of an old, unpaid one
 * still gets its own shot. `tier` is a framing hint for the headline copy
 * only (1 = every margin here is still fresh as of today, 2 = at least
 * one already stepped down or expired) - it doesn't drive the dollar
 * amount, which is the true per-margin sum. */
function projectedCashback(transactions, now = new Date()) {
  const { total, amount, oldestDate } = marginCashback(transactions, now);
  if (total <= 0 || amount <= 0) return null;
  const oldestAge = daysSinceBalanceOpened(oldestDate, now);
  const tier = oldestAge === 0 ? 1 : 2;
  return { rate: round4(amount / total), tier, balance: total, cashbackAmount: amount, oldestDate };
}

/* Purely informational - "here's what you missed" on whichever margins
 * have aged past both tiers (2+ days since THAT transaction, specifically
 * - not the balance as a whole). `balance` here is just the sum of the
 * expired margins, not the full account balance, so this never overlaps
 * or double-counts with projectedCashback above: a dollar is either still
 * earning something (shown there) or permanently missed (shown here),
 * never both. Nothing here changes what a payment actually earns. */
function expiredCashbackAmounts(transactions, now = new Date()) {
  const owed = (transactions || []).filter((t) => t.status !== "void" && isOwed(t));
  let total = 0;
  let tenPercentAmount = 0;
  let fivePercentAmount = 0;
  let oldestDate = null;
  for (const t of owed) {
    const daysSince = daysSinceBalanceOpened(t.createdDate, now);
    if (daysSince == null || daysSince < 2) continue; // still eligible, or never was - not expired
    const value = Number(t.total || t.value || 0);
    total += value;
    tenPercentAmount += value * TIER_RATES[0];
    fivePercentAmount += value * TIER_RATES[1];
    if (t.createdDate && (!oldestDate || t.createdDate < oldestDate)) oldestDate = t.createdDate;
  }
  if (total <= 0) return null;
  return {
    balance: round2(total),
    tenPercentAmount: round2(tenPercentAmount),
    fivePercentAmount: round2(fivePercentAmount),
    oldestDate,
  };
}

module.exports = {
  BUSINESS_UTC_OFFSET_HOURS, TIER_RATES, LAUNCH_DATE,
  isOwed, accountSnapshot, cashbackTierForDaysSince, daysSinceBalanceOpened,
  marginCashback, evaluateCashback, projectedCashback, expiredCashbackAmounts,
};
