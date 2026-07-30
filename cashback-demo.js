// Adapted from a supplied redesign package (cashback_simulator_html_package)
// built to match this page's approved visual reference. Mirrors
// functions/src/lib/cashback.js's TIER_RATES by hand, same as the demo
// this replaced - no build step ties this static page to the real backend.
(() => {
  'use strict';

  const SEGMENT_DURATION_MS = 2000;
  const DAY_COUNT = 4;
  const SEGMENTS_PER_DAY = 8;
  const DAY_RATES = [0.10, 0.05, 0, 0];
  const DAY_STAGES = [
    'Day 1 - the best rate',
    'Day 2 - last chance',
    'expired - no cashback left',
    'expired - no cashback left'
  ];

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
    stageLabel: document.querySelector('#stage-label'),
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
    dayIndex: 0,
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

  function currentRate() {
    return DAY_RATES[state.dayIndex];
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
      state.dayIndex = (state.dayIndex + 1) % DAY_COUNT;
      state.lastPayment = null;
    }
    render();
  }

  function jumpToDay(dayIndex) {
    state.dayIndex = Math.min(Math.max(dayIndex, 0), DAY_COUNT - 1);
    state.segmentIndex = 0;
    state.lastPayment = null;
    render();
    showToast(`Moved to Day ${state.dayIndex + 1} at 7:00 AM.`);
  }

  function resetSimulation() {
    setPlaying(false);
    state.balance = sanitizeAmount(elements.startingBalance.value);
    state.shopCredit = 0;
    state.dayIndex = 0;
    state.segmentIndex = 0;
    state.lastPayment = null;
    render();
    showToast('Simulation reset to the starting balance.');
  }

  function addToBalance() {
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
    state.lastPayment = { paidAmount, creditEarned, dayIndex: state.dayIndex };
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
  function renderTimeline() {
    const remaining = SEGMENTS_PER_DAY - state.segmentIndex;
    const expiredDay = currentRate() === 0;
    elements.timelineSegments.forEach((segment, index) => {
      segment.classList.toggle('is-spent', index >= remaining);
      segment.classList.toggle('is-expired-day', expiredDay);
      segment.classList.toggle('is-current', index === state.segmentIndex);
    });
    elements.timeline.setAttribute('aria-valuenow', String(remaining));
    elements.timeline.setAttribute('aria-valuetext', `${formatTime(state.segmentIndex)}, ${remaining} of ${SEGMENTS_PER_DAY} hours remaining`);
  }

  function renderPromo() {
    const rate = currentRate();
    const expired = rate === 0;
    const ratePercent = Math.round(rate * 100);
    const paymentOnCurrentDay = state.lastPayment && state.lastPayment.dayIndex === state.dayIndex;

    elements.promoCard.classList.toggle('is-expired', expired);
    elements.promoBalance.textContent = formatMoney(state.balance);
    elements.rewardValue.textContent = formatMoney(projectedReward());

    if (paymentOnCurrentDay) {
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
    } else if (state.dayIndex === 0) {
      elements.cashbackRate.textContent = `${ratePercent}% cash back`;
      elements.promoTitle.textContent = 'Clear your balance before 3pm today';
      elements.promoDescription.textContent = `Pay your whole balance in full before 3pm and get ${ratePercent}% credited back as shop credit.`;
    } else {
      // Day 2 - the rate already stepped down overnight, and there's no
      // third chance after this: say so explicitly rather than repeating
      // Day 1's generic copy with a smaller number.
      elements.cashbackRate.textContent = `${ratePercent}% cash back`;
      elements.promoTitle.textContent = 'Last chance before 3pm today';
      elements.promoDescription.textContent = `The rate dropped to ${ratePercent}% overnight and holds until 3pm - clear your whole balance in full before then, or it's gone for good.`;
    }
  }

  function render() {
    const rate = currentRate();
    const dayNumber = state.dayIndex + 1;

    elements.balanceValue.textContent = formatMoney(state.balance);
    elements.creditValue.textContent = formatMoney(state.shopCredit);
    elements.dayLabel.textContent = `Day ${dayNumber}`;
    elements.timeLabel.textContent = formatTime(state.segmentIndex);
    elements.stageLabel.textContent = DAY_STAGES[state.dayIndex];
    elements.payButton.disabled = state.balance <= 0;

    elements.dayButtons.forEach((button, index) => {
      const active = index === state.dayIndex;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    document.title = `Day ${dayNumber} · ${Math.round(rate * 100)}% Cashback Simulation`;
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
