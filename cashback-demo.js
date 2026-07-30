// Adapted from a supplied redesign package (cashback_simulator_html_package)
// built to match this page's approved visual reference. Mirrors
// functions/src/lib/cashback.js's TIER_RATES by hand, same as the demo
// this replaced - no build step ties this static page to the real backend.
(() => {
  'use strict';

  const SEGMENT_DURATION_MS = 2000;
  const CYCLE_DAYS = 3; // the ambient clock's "Day N" label wraps every 3 days
  const SEGMENTS_PER_DAY = 8;
  // Indexed by *days since the current balance was opened*, not by the
  // ambient calendar day - a fresh balance always starts at 10%, however
  // many days the clock has been running for everyone else.
  const BALANCE_AGE_RATES = [0.10, 0.05, 0];

  const elements = {
    startingBalance: document.querySelector('#starting-balance'),
    playButton: document.querySelector('#play-button'),
    pauseButton: document.querySelector('#pause-button'),
    resetButton: document.querySelector('#reset-button'),
    addBalanceButton: document.querySelector('#add-balance-button'),
    payButton: document.querySelector('#pay-button'),
    dayButtons: [...document.querySelectorAll('.day-button')],
    balanceValue: document.querySelector('#balance-value'),
    creditValue: document.querySelector('#credit-value'),
    dayLabel: document.querySelector('#day-label'),
    timeLabel: document.querySelector('#time-label'),
    timelinePanel: document.querySelector('#timeline-panel'),
    timeline: document.querySelector('#timeline'),
    timelineSegments: [...document.querySelectorAll('.timeline__segment')],
    promoCard: document.querySelector('#promo-card'),
    cashbackPill: document.querySelector('#cashback-pill'),
    cashbackRate: document.querySelector('#cashback-rate'),
    promoTitle: document.querySelector('#promo-title'),
    promoDescription: document.querySelector('#promo-description'),
    promoBalance: document.querySelector('#promo-balance'),
    rewardValue: document.querySelector('#reward-value'),
    toast: document.querySelector('#toast'),
    notice: document.querySelector('#notice'),
    noticeClose: document.querySelector('#notice-close'),
    missedBonusEmpty: document.querySelector('#missed-bonus-empty'),
    missedBonusList: document.querySelector('#missed-bonus-list')
  };

  const state = {
    balance: sanitizeAmount(elements.startingBalance.value),
    shopCredit: 0,
    // The ambient clock: counts every simulated day that's ever passed,
    // and never resets for any reason - it just keeps going. The "Day N"
    // label is this value wrapped to CYCLE_DAYS for display.
    absoluteDay: 0,
    // Which absoluteDay the *current* balance last went from $0 to
    // something owed - a fresh balance always starts its own count here,
    // whatever the ambient clock happens to read at that moment.
    balanceOpenedOnDay: 0,
    segmentIndex: 0,
    isPlaying: false,
    intervalId: null,
    lastPayment: null,
    // A running log of bonuses lost by leaving a balance unpaid past 3pm -
    // one entry per tier a balance ages out of (10%, then 5%), captured at
    // the moment each one is gone for good. Persists across reset-free
    // balance cycles so the well can show more than just the latest miss;
    // only Reset clears it.
    missedBonuses: []
  };

  let toastTimer = null;

  function sanitizeAmount(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
  }

  function formatMoney(value) {
    return `J$${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value)}`;
  }

  function formatTime(segmentIndex) {
    const hour24 = 7 + segmentIndex;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
    return `${hour12}:00 ${suffix}`;
  }

  function daysSinceBalanceOpened() {
    return state.absoluteDay - state.balanceOpenedOnDay;
  }

  function currentRate() {
    const age = daysSinceBalanceOpened();
    return age < BALANCE_AGE_RATES.length ? BALANCE_AGE_RATES[age] : 0;
  }

  function displayDayNumber() {
    return (state.absoluteDay % CYCLE_DAYS) + 1;
  }

  function projectedReward() {
    return Math.round(state.balance * currentRate() * 100) / 100;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove('is-visible');
    }, 2800);
  }

  function setPlaying(playing) {
    state.isPlaying = playing;
    elements.playButton.disabled = playing;
    elements.pauseButton.disabled = !playing;

    if (playing && state.intervalId === null) {
      state.intervalId = window.setInterval(advanceSegment, SEGMENT_DURATION_MS);
    } else if (!playing && state.intervalId !== null) {
      window.clearInterval(state.intervalId);
      state.intervalId = null;
    }
  }

  function advanceSegment() {
    if (state.segmentIndex < SEGMENTS_PER_DAY - 1) {
      state.segmentIndex += 1;
    } else {
      // 3pm is passing right now - if there's still a balance sitting at a
      // tier that actually paid something, that tier's bonus is gone for
      // good the instant the clock rolls to the next day. Only the two
      // paying tiers (age 0 and age 1) are ever recordable this way - once
      // age reaches 2 there's nothing left to lose, so no further entries
      // pile up for the same balance cycle.
      const age = daysSinceBalanceOpened();
      if (state.balance > 0 && age < BALANCE_AGE_RATES.length - 1) {
        recordMissedBonus(BALANCE_AGE_RATES[age]);
      }
      state.segmentIndex = 0;
      // The ambient clock always advances - it doesn't pause or reset for
      // anyone, regardless of anyone's balance or payment history.
      state.absoluteDay += 1;
      state.lastPayment = null;
    }
    render();
  }

  function recordMissedBonus(rate) {
    state.missedBonuses.unshift({
      balance: state.balance,
      pct: Math.round(rate * 100),
      amount: Math.round(state.balance * rate * 100) / 100
    });
  }

  function jumpToDay(dayIndex) {
    const clamped = Math.min(Math.max(dayIndex, 0), CYCLE_DAYS - 1);
    state.absoluteDay = clamped;
    // Preview as if the current balance opened on day 0, so the button's
    // own label (Day N - X%) is what actually shows.
    state.balanceOpenedOnDay = 0;
    state.segmentIndex = 0;
    state.lastPayment = null;
    render();
    showToast(`Moved to Day ${clamped + 1} at 7:00 AM.`);
  }

  function resetSimulation() {
    setPlaying(false);
    state.balance = sanitizeAmount(elements.startingBalance.value);
    state.shopCredit = 0;
    state.absoluteDay = 0;
    state.balanceOpenedOnDay = 0;
    state.segmentIndex = 0;
    state.lastPayment = null;
    state.missedBonuses = [];
    render();
    showToast('Simulation reset to the starting balance.');
  }

  function addToBalance() {
    // Any new charge re-activates the cashback window for the whole
    // balance - it's "fresh" again as of right now, whatever day the
    // ambient clock happens to be on, even if the existing balance had
    // already expired.
    state.balanceOpenedOnDay = state.absoluteDay;
    state.balance = Math.round((state.balance + 100) * 100) / 100;
    state.lastPayment = null;
    render();
    showToast('J$100 added to the current balance.');
  }

  function payInFull() {
    if (state.balance <= 0) {
      showToast('There is no outstanding balance to pay.');
      return;
    }

    const paidAmount = state.balance;
    const rate = currentRate();
    const creditEarned = Math.round(paidAmount * rate * 100) / 100;

    state.balance = 0;
    state.shopCredit = Math.round((state.shopCredit + creditEarned) * 100) / 100;
    state.lastPayment = { paidAmount, creditEarned };
    // The ambient clock is untouched - paying off a balance doesn't pause
    // or reset it for anyone. The *next* balance to appear just starts its
    // own fresh count from whatever day the clock is on then.
    render();

    if (creditEarned > 0) {
      showToast(`Payment complete. ${formatMoney(creditEarned)} added as shop credit.`);
    } else {
      showToast('Payment complete. The cashback offer is expired for this day.');
    }
  }

  // A "reverse loading bar" - every segment starts lit (the whole day still
  // ahead) and fades to spent as each simulated hour passes, rather than
  // filling up from empty. Mirrors the real feature's original hourly-
  // deadline visualization, kept here since it's still a clear way to
  // *watch* time run out rather than watch it accumulate.
  //
  // The bar itself only means something while there's a balance actively
  // earning something - once it's expired (or there's no balance at all),
  // showing a countdown implies there's still something to lose, which
  // isn't true anymore. It disappears at that point; the promo card below
  // still reminds the customer they have a balance to pay off either way.
  function renderTimeline() {
    const stillEarning = state.balance > 0 && currentRate() > 0;
    elements.timelinePanel.classList.toggle('hidden', !stillEarning);
    if (!stillEarning) return;

    const remaining = SEGMENTS_PER_DAY - state.segmentIndex;
    elements.timelineSegments.forEach((segment, index) => {
      segment.classList.toggle('is-spent', index >= remaining);
      // The highlighted segment is the boundary between lit and spent (the
      // last still-lit hour), so it travels right-to-left along with the
      // drain itself instead of drifting the opposite way.
      segment.classList.toggle('is-current', index === remaining - 1);
    });
    elements.timeline.setAttribute('aria-valuenow', String(remaining));
    elements.timeline.setAttribute('aria-valuetext', `${formatTime(state.segmentIndex)}, ${remaining} of ${SEGMENTS_PER_DAY} hours remaining`);
  }

  // The promo card is the actual call-to-action - it only ever shows up
  // while there's a balance to act on (or a payment to report right after
  // clearing one), same as the real feature. The ambient clock/timeline
  // above keeps running either way.
  function renderPromo() {
    const hasBalance = state.balance > 0;
    const justPaid = state.lastPayment !== null;

    elements.promoCard.classList.toggle('hidden', !hasBalance && !justPaid);
    if (!hasBalance && !justPaid) return;

    const age = daysSinceBalanceOpened();
    const rate = currentRate();
    const expired = rate === 0;
    const ratePercent = Math.round(rate * 100);

    elements.promoCard.classList.toggle('is-expired', expired);
    elements.promoBalance.textContent = formatMoney(state.balance);
    elements.rewardValue.textContent = formatMoney(projectedReward());

    if (justPaid) {
      elements.cashbackRate.textContent = state.lastPayment.creditEarned > 0 ? 'Cashback credited' : 'No cashback';
      elements.promoTitle.textContent = 'Payment complete';
      elements.promoDescription.textContent = state.lastPayment.creditEarned > 0
        ? `${formatMoney(state.lastPayment.paidAmount)} was paid and ${formatMoney(state.lastPayment.creditEarned)} was added as shop credit.`
        : `${formatMoney(state.lastPayment.paidAmount)} was paid after the cashback offer had expired.`;
      elements.promoBalance.textContent = formatMoney(state.lastPayment.paidAmount);
      elements.rewardValue.textContent = formatMoney(state.lastPayment.creditEarned);
      return;
    }

    if (expired) {
      elements.cashbackRate.textContent = 'Offer expired';
      elements.promoTitle.textContent = 'No cashback is available today';
      elements.promoDescription.textContent = 'The promotional window has ended. Payments can still be completed, but no shop credit will be added.';
    } else if (age === 0) {
      const nextRatePercent = Math.round(BALANCE_AGE_RATES[age + 1] * 100);
      elements.cashbackRate.textContent = `${ratePercent}% cash back`;
      elements.promoTitle.textContent = "Today's the best day to clear your balance";
      elements.promoDescription.textContent = `Pay your balance in full before the timer runs out and earn ${ratePercent}% back as shop credit. Tomorrow the rate drops to ${nextRatePercent}%.`;
    } else {
      // One day old - the rate already stepped down overnight, and there's
      // no third chance after this - framed around what's earned today and
      // what's already gone, not a countdown/deadline, so it reads as an
      // incentive to catch rather than pressure to beat the clock.
      elements.cashbackRate.textContent = `${ratePercent}% cash back`;
      elements.promoTitle.textContent = "Don't miss today's cash back";
      elements.promoDescription.textContent = `Pay your balance in full before the timer runs out and earn ${ratePercent}% back as shop credit. Tomorrow there's nothing left to earn.`;
    }
  }

  // The left-side "well" is a running list, not a live snapshot - it only
  // ever grows (until Reset), so a customer can see every bonus they've
  // let slip across the whole session, not just the most recent one.
  function renderMissedBonusWell() {
    const hasEntries = state.missedBonuses.length > 0;
    elements.missedBonusEmpty.classList.toggle('hidden', hasEntries);
    elements.missedBonusList.innerHTML = state.missedBonuses.map((entry) => `
      <div class="missed-bonus-card">
        <span class="missed-bonus-card__pct">${entry.pct}% expired</span>
        <p class="missed-bonus-card__balance">On a balance of ${formatMoney(entry.balance)}</p>
        <div class="missed-bonus-card__amount">${formatMoney(entry.amount)}</div>
      </div>
    `).join('');
  }

  function render() {
    const dayNumber = displayDayNumber();

    elements.balanceValue.textContent = formatMoney(state.balance);
    elements.creditValue.textContent = formatMoney(state.shopCredit);
    elements.dayLabel.textContent = `Day ${dayNumber}`;
    elements.timeLabel.textContent = formatTime(state.segmentIndex);
    elements.payButton.disabled = state.balance <= 0;

    elements.dayButtons.forEach((button, index) => {
      const active = index === state.absoluteDay % CYCLE_DAYS;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    document.title = `Day ${dayNumber} - Fresh Snacks Cashback Demo`;
    renderTimeline();
    renderPromo();
    renderMissedBonusWell();
  }

  elements.playButton.addEventListener('click', () => {
    setPlaying(true);
    render();
  });

  elements.pauseButton.addEventListener('click', () => {
    setPlaying(false);
    render();
  });

  elements.resetButton.addEventListener('click', resetSimulation);
  elements.addBalanceButton.addEventListener('click', addToBalance);
  elements.payButton.addEventListener('click', payInFull);

  elements.startingBalance.addEventListener('change', () => {
    const sanitized = sanitizeAmount(elements.startingBalance.value);
    elements.startingBalance.value = String(sanitized);
  });

  elements.dayButtons.forEach((button) => {
    button.addEventListener('click', () => jumpToDay(Number(button.dataset.day)));
  });

  window.addEventListener('beforeunload', () => {
    if (state.intervalId !== null) window.clearInterval(state.intervalId);
  });

  // Dismissing the test/demo notice persists across reloads - once seen,
  // there's no need to keep re-showing it every time this page is opened.
  const NOTICE_DISMISSED_KEY = 'fresh_snacks_cashback_demo_notice_dismissed';
  try {
    if (window.localStorage.getItem(NOTICE_DISMISSED_KEY) === '1') {
      elements.notice.classList.add('hidden');
    }
  } catch (_) {}

  elements.noticeClose.addEventListener('click', () => {
    elements.notice.classList.add('hidden');
    try { window.localStorage.setItem(NOTICE_DISMISSED_KEY, '1'); } catch (_) {}
  });

  render();
})();
