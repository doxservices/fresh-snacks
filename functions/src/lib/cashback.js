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
 * The tier itself (10% vs 5% vs nothing) is still decided purely by
 * calendar business-local day, same as always. On TOP of that, the actual
 * payout is also gated to a daily bonus WINDOW - 7am to 3pm business-local,
 * matching the urgency bar shown on index.html's cashback card - so a
 * settlement that happens after hours on an otherwise-qualifying day earns
 * nothing, exactly as the page itself already tells the customer ("Bonus
 * period ended... more cash back bonuses will be available tomorrow"). This
 * was the original intent; a prior revision briefly made the bar purely
 * cosmetic while the backend judged same-day/next-day with no regard for
 * the hour at all - that gap let at least one payment earn a same-day
 * reward hours after the page had already told the customer the window
 * was closed, and is what isWithinDailyBonusWindow below closes for good. */
const { STATUS, deriveWorkflowStatus } = require("./transactionStatus");

const BUSINESS_UTC_OFFSET_HOURS = -5;
const TIER_RATES = { 0: 0.10, 1: 0.05 }; // daysSince 0 (same day) -> 10%, daysSince 1 (next day) -> 5%

// The daily bonus window itself - 7am up to (not including) 3pm
// business-local, mirrored from index.html's CASHBACK_BUSINESS_START_HOUR/
// CASHBACK_DAY_SEGMENTS (the same 8-hour bar the customer sees draining).
// Keep these two in sync if the on-page window ever changes.
const CASHBACK_WINDOW_START_HOUR = 7;
const CASHBACK_WINDOW_HOURS = 8;

// A pre-existing balance was never given a fair chance to act on an
// incentive that didn't exist yet - only a balance that opened (went from
// $0 to something owed) on or after this date is ever eligible.
const LAUNCH_DATE = "2026-07-29";

// The whole cashback mechanic - both the customer-facing projection and the
// actual payout - only ever applies once a balance is at least this much.
// A trivial balance (a couple of snacks) was never meant to trigger a
// percentage payout in the first place.
const MIN_BALANCE_FOR_CASHBACK_JMD = 300;

function businessDateOnlyUTC(date) {
  const local = new Date(date.getTime() + BUSINESS_UTC_OFFSET_HOURS * 3600 * 1000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

// Whether `now` falls inside today's 7am-3pm business-local bonus window -
// the actual gate on whether a settlement happening RIGHT NOW can earn a
// reward at all, independent of which calendar-day tier it would otherwise
// qualify for. Same math as index.html's currentBusinessHour().
function isWithinDailyBonusWindow(now = new Date()) {
  const local = new Date(now.getTime() + BUSINESS_UTC_OFFSET_HOURS * 3600 * 1000);
  const hour = local.getUTCHours();
  return hour >= CASHBACK_WINDOW_START_HOUR && hour < CASHBACK_WINDOW_START_HOUR + CASHBACK_WINDOW_HOURS;
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
const round4 = (n) => Math.round(n * 10000) / 10000;

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

/* A customer's current unspent cashback credit - a genuinely separate
 * bucket from "money just paid this round", tracked explicitly rather than
 * inferred: every cashback payout (payments/{id} with source:"cashback")
 * is an EARN, and every creditConsumptions/{id} doc (see evaluateCashback
 * below) is a deliberate, recorded draw-down against a later settlement.
 * Only cashback-sourced credit is ever counted here - an ordinary
 * overpayment (an admin recording more than was owed, say) is real money
 * on the account too, but it isn't a REWARD, so it was never meant to
 * gate whether a future reward double-dips; that's a different bucket. */
function creditBalance(payments, consumptions) {
  const earned = (payments || [])
    .filter((p) => p.status !== "void" && p.source === "cashback")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const consumed = (consumptions || [])
    .filter((c) => c.status !== "void")
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  return Math.max(0, round2(earned - consumed));
}

/* The per-margin breakdown: every still-owed transaction judged on its own
 * createdDate, summed into one gross total and one blended earned amount -
 * with no credit exclusion baked in here anymore (see evaluateCashback for
 * why: whether existing credit disqualifies this round from a NEW reward
 * is now an all-or-nothing gate applied on top of this, not a per-dollar
 * proration). `oldestDate` is the earliest owed transaction's date, kept
 * for audit/history and for picking the projection's headline tier. */
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

/* Given the FULL pre-action list of a customer's transactions, payments and
 * credit-consumption history, and the ids about to be finalized (marked
 * paid) by whatever settlement action is running right now, decides
 * whether this brings their WHOLE balance to $0 and, if so, what happens
 * to cashback. Returns null when there's nothing at all to record - either
 * this action doesn't fully clear the balance, the balance never reached
 * the reward floor, or there's no pre-existing credit AND no reward earned.
 *
 * Otherwise returns { bonus, creditConsumed, clearedTotal }:
 *   - `creditConsumed` is how much of the customer's existing cashback
 *     credit this round draws on (0 if none) - capped at whatever's being
 *     cleared, since credit can't be consumed past what it's paying for.
 *   - `bonus` is null WHENEVER creditConsumed > 0 - a round that's even
 *     partly funded by a past reward earns no NEW reward on top of it
 *     (that's cashback on cashback, the exact bug this replaced). Only a
 *     round funded entirely by fresh money can earn one, and when it does
 *     it's calculated on the FULL cleared total (no proration needed, since
 *     by definition none of it came from existing credit).
 *   - `bonus` is also null whenever `now` falls outside today's 7am-3pm
 *     bonus window (see isWithinDailyBonusWindow) - a settlement after
 *     hours earns nothing, same-day tier or not, matching what the page
 *     itself already tells the customer once the bar's run out.
 *   - `clearedTotal` is the gross total settled this round either way, for
 *     the creditConsumptions record and/or the bonus payment's own note. */
function evaluateCashback(transactionsBefore, paymentsBefore, consumptionsBefore, settledIds, now = new Date()) {
  const before = accountSnapshot(transactionsBefore);
  if (before.total < MIN_BALANCE_FOR_CASHBACK_JMD || !before.oldestDate) return null; // nothing owed, or below the floor
  const settled = new Set(settledIds);
  const stillOwed = (transactionsBefore || []).some((t) => t.status !== "void" && isOwed(t) && !settled.has(t.id));
  if (stillOwed) return null; // this action doesn't clear everything

  const credit = creditBalance(paymentsBefore, consumptionsBefore);
  const { total, amount, oldestDate } = marginCashback(transactionsBefore, now);
  const creditConsumed = round2(Math.min(credit, total));
  const bonus = creditConsumed <= 0 && amount > 0 && isWithinDailyBonusWindow(now)
    ? { amount, rate: round4(amount / total), clearedTotal: total, oldestDate }
    : null;
  if (!bonus && creditConsumed <= 0) return null; // nothing earned, nothing to draw down
  return { bonus, creditConsumed, clearedTotal: total };
}

/* The customer-facing projection - "if you clear your whole balance right
 * now, here's what you'd earn back" - shown on index.html's Current
 * Balance card before any payment happens. Suppressed (null) the same way
 * evaluateCashback suppresses a real payout: if existing credit would
 * cover any part of clearing this balance, this round earns nothing new,
 * so there's nothing honest to project. `tier` is a framing hint for the
 * headline copy only (1 = every margin here is still fresh as of today,
 * 2 = at least one already stepped down or expired) - it doesn't drive the
 * dollar amount, which is the true per-margin sum.
 *
 * Deliberately NOT gated by isWithinDailyBonusWindow the way evaluateCashback
 * is - index.html already runs its own live, minute-by-minute business-hour
 * clock (renderCashbackDayBar/windowOver) to swap this same card into its
 * "Bonus period ended" state the instant the window closes, without needing
 * a fresh server round-trip. Gating here too would just make the card
 * vanish outright once the window closes instead of showing that message. */
function projectedCashback(transactions, payments, consumptions, now = new Date()) {
  const { total, amount, oldestDate } = marginCashback(transactions, now);
  if (total < MIN_BALANCE_FOR_CASHBACK_JMD || amount <= 0) return null;
  const credit = creditBalance(payments, consumptions);
  if (credit > 0) return null; // existing credit would fund part of this round - no new reward to project
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
  BUSINESS_UTC_OFFSET_HOURS, TIER_RATES, LAUNCH_DATE, MIN_BALANCE_FOR_CASHBACK_JMD,
  CASHBACK_WINDOW_START_HOUR, CASHBACK_WINDOW_HOURS,
  isOwed, accountSnapshot, cashbackTierForDaysSince, daysSinceBalanceOpened, isWithinDailyBonusWindow,
  creditBalance, marginCashback, evaluateCashback, projectedCashback, expiredCashbackAmounts,
};
