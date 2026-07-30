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
    timeline: document.querySelector('#timeline'),
    timelineSegments: [...document.querySelectorAll('.timeline__segment')],
    promoCard: document.querySelector('#promo-card'),
    cashbackPill: document.querySelector('#cashback-pill'),
    cashbackRate: document.querySelector('#cashback-rate'),
    promoTitle: document.querySelector('#promo-title'),
    promoDescription: document.querySelector('#promo-description'),
    promoBalance: document.querySelector('#promo-balance'),
    rewardValue: document.querySelector('#reward-value'),
    toast: document.querySelector('#toast')
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
    lastPayment: null
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
      state.segmentIndex = 0;
      // The ambient clock always advances - it doesn't pause or reset for
      // anyone, regardless of anyone's balance or payment history.
      state.absoluteDay += 1;
      state.lastPayment = null;
    }
    render();
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
    render();
    showToast('Simulation reset to the starting balance.');
  }

  function addToBalance() {
    if (state.balance <= 0) {
      // A fresh balance starts its own cashback window as of right now,
      // whatever day the ambient clock happens to be on.
      state.balanceOpenedOnDay = state.absoluteDay;
    }
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
  // *watch* time run out rather than watch it accumulate. This is the
  // ambient clock - it runs the same for everyone, balance or not - so the
  // gray "nothing left to earn" tint only applies while there's actually a
  // balance that's stopped earning, not as a global property of the day.
  function renderTimeline() {
    const remaining = SEGMENTS_PER_DAY - state.segmentIndex;
    const expiredForBalance = state.balance > 0 && currentRate() === 0;
    elements.timelineSegments.forEach((segment, index) => {
      segment.classList.toggle('is-spent', index >= remaining);
      segment.classList.toggle('is-expired-day', expiredForBalance);
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

  render();
})();
