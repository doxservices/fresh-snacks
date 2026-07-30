// Adapted from a supplied redesign package (cashback_simulator_html_package)
// built to match this page's approved visual reference. Mirrors
// functions/src/lib/cashback.js's per-margin model by hand (see
// marginCashback there) - no build step ties this static page to the real
// backend, so the two are kept in sync manually.
(() => {
  'use strict';

  const SEGMENT_DURATION_MS = 2000;
  const CYCLE_DAYS = 3; // the ambient clock's "Day N" label wraps every 3 days
  const SEGMENTS_PER_DAY = 8;
  // Indexed by *days since a given charge was added*, not by the ambient
  // calendar day - a fresh charge always starts at 10%, however many days
  // the clock has been running for everyone/everything else on the tab.
  const CHARGE_AGE_RATES = [0.10, 0.05, 0];

  const elements = {
    startingBalance: document.querySelector('#starting-balance'),
    playButton: document.querySelector('#play-button'),
    pauseButton: document.querySelector('#pause-button'),
    resetButton: document.querySelector('#reset-button'),
    addBalanceButton: document.querySelector('#add-balance-button'),
    payButton: document.querySelector('#pay-button'),
    dayButtons: [...document.querySelectorAll('.day-button')],
    balanceValue: document.querySelector('#balance-value'),
    balanceActiveNote: document.querySelector('#balance-active-note'),
    creditValue: document.querySelector('#credit-value'),
    dayLabel: document.querySelector('#day-label'),
    timeLabel: document.querySelector('#time-label'),
    timelineStatus: document.querySelector('#timeline-status'),
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
    instancesEmpty: document.querySelector('#instances-empty'),
    instancesList: document.querySelector('#instances-list')
  };

  let nextChargeId = 1;

  const state = {
    // Every charge currently owed - each one earns cash back on its own,
    // based on the day IT was added, not the balance as a whole. A fresh
    // charge stacked on an older one still gets its own shot at 10%; an
    // old, already-expired charge doesn't drag a newer one down with it.
    charges: [{ id: nextChargeId++, amount: sanitizeAmount(elements.startingBalance.value), openedOnDay: 0 }],
    shopCredit: 0,
    // The ambient clock: counts every simulated day that's ever passed,
    // and never resets for any reason - it just keeps going. The "Day N"
    // label is this value wrapped to CYCLE_DAYS for display.
    absoluteDay: 0,
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

  const round2 = (n) => Math.round(n * 100) / 100;

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

  function chargeAge(charge) {
    return state.absoluteDay - charge.openedOnDay;
  }

  function chargeRate(charge) {
    const age = chargeAge(charge);
    return age < CHARGE_AGE_RATES.length ? CHARGE_AGE_RATES[age] : 0;
  }

  function displayDayNumber() {
    return (state.absoluteDay % CYCLE_DAYS) + 1;
  }

  // The blended totals across every current charge - the real dollar
  // figures a customer would see and actually earn, same math as
  // functions/src/lib/cashback.js's marginCashback.
  function margin() {
    let total = 0;
    let amount = 0;
    for (const charge of state.charges) {
      total += charge.amount;
      amount += charge.amount * chargeRate(charge);
    }
    return { total: round2(total), amount: round2(amount), rate: total > 0 ? amount / total : 0 };
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
      // 3pm is passing right now - notify about any charge whose stage is
      // about to change, one instance card at a time (each charge's card
      // in the well updates in place, so the notification just calls out
      // what just moved rather than logging a separate entry for it).
      const notices = [];
      for (const charge of state.charges) {
        const age = chargeAge(charge);
        if (age === 0) notices.push(`${formatMoney(charge.amount)} drops to 5% cash back`);
        else if (age === 1) notices.push(`${formatMoney(charge.amount)} cash back has expired`);
      }
      state.segmentIndex = 0;
      // The ambient clock always advances - it doesn't pause or reset for
      // anyone, regardless of anyone's balance or payment history.
      state.absoluteDay += 1;
      state.lastPayment = null;
      if (notices.length) showToast(`🔔 ${notices.join(' · ')}`);
    }
    render();
  }

  function jumpToDay(dayIndex) {
    const clamped = Math.min(Math.max(dayIndex, 0), CYCLE_DAYS - 1);
    state.absoluteDay = clamped;
    // Preview as if the current balance were a single charge opened on
    // day 0, so the button's own label (Day N - X%) is what actually
    // shows - a preview shortcut, not simulated time actually passing,
    // so it collapses whatever charges exist into one for the preview.
    const total = margin().total;
    state.charges = total > 0 ? [{ id: nextChargeId++, amount: total, openedOnDay: 0 }] : [];
    state.segmentIndex = 0;
    state.lastPayment = null;
    render();
    showToast(`Moved to Day ${clamped + 1} at 7:00 AM.`);
  }

  function resetSimulation() {
    setPlaying(false);
    const startingAmount = sanitizeAmount(elements.startingBalance.value);
    state.charges = [{ id: nextChargeId++, amount: startingAmount, openedOnDay: 0 }];
    state.shopCredit = 0;
    state.absoluteDay = 0;
    state.segmentIndex = 0;
    state.lastPayment = null;
    render();
    showToast(startingAmount > 0
      ? `🔔 Bonus available: ${formatMoney(startingAmount)} is earning 10% cash back today.`
      : 'Simulation reset.');
  }

  function addToBalance() {
    // Parity with real snacks being logged to a tab: everything added
    // during the SAME bonus period (the same day a charge was already
    // opened on) piles onto that one charge instead of starting a
    // separate instance - a customer adding a few snacks over the course
    // of one day sees one balance, not one card per snack. It only
    // becomes its own new instance once no charge is open for today yet,
    // e.g. an older charge has already moved into a later stage.
    const openToday = state.charges.find((charge) => charge.openedOnDay === state.absoluteDay);
    if (openToday) {
      openToday.amount = round2(openToday.amount + 100);
      state.lastPayment = null;
      render();
      showToast(`🔔 Bonus available: J$100 added to today's ${formatMoney(openToday.amount)} balance - still earns 10% cash back if paid today.`);
      return;
    }
    // No charge is open for today yet (a brand-new balance, or every
    // existing charge already aged into a later stage) - this starts its
    // own fresh instance.
    state.charges.push({ id: nextChargeId++, amount: 100, openedOnDay: state.absoluteDay });
    state.lastPayment = null;
    render();
    showToast('🔔 Bonus available: J$100 charge added - earns 10% cash back if paid today.');
  }

  function payInFull() {
    const { total, amount } = margin();
    if (total <= 0) {
      showToast('There is no outstanding balance to pay.');
      return;
    }

    state.charges = [];
    state.shopCredit = round2(state.shopCredit + amount);
    state.lastPayment = { paidAmount: total, creditEarned: amount };
    // The ambient clock is untouched - paying off a balance doesn't pause
    // or reset it for anyone. The *next* charge to appear just starts its
    // own fresh count from whatever day the clock is on then.
    render();

    if (amount > 0) {
      showToast(`Payment complete. ${formatMoney(amount)} added as shop credit.`);
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
  // The bar itself is only useful while it's actually counting down
  // something - once nothing is earning a bonus, it's hidden again rather
  // than sitting there greyed out, and the space it leaves behind becomes
  // a purchase prompt instead of a dead-end status message: a new charge
  // added today still starts a fresh 10% window of its own, same as any
  // other day, so there's always something actionable to say here even
  // with no bar showing.
  function renderTimeline() {
    const stillEarning = state.charges.some((charge) => chargeRate(charge) > 0);
    elements.timeline.classList.toggle('hidden', !stillEarning);
    elements.timelineStatus.classList.toggle('hidden', stillEarning);
    elements.timelineStatus.textContent = "Purchase now for 10% cash back on today's order - a fresh discount period runs every day until 3pm.";

    const remaining = SEGMENTS_PER_DAY - state.segmentIndex;
    elements.timelineSegments.forEach((segment, index) => {
      segment.classList.toggle('is-spent', index >= remaining);
      // The highlighted segment is the boundary between lit and spent (the
      // last still-lit hour), so it travels right-to-left along with the
      // drain itself instead of drifting the opposite way.
      segment.classList.toggle('is-current', index === remaining - 1);
    });
    elements.timeline.setAttribute('aria-valuenow', String(remaining));
    elements.timeline.setAttribute('aria-valuetext', `${formatTime(state.segmentIndex)}, ${remaining} of ${SEGMENTS_PER_DAY} hours remaining${stillEarning ? '' : ' (no active bonus)'}`);
  }

  // One card per charge, living the whole time it's owed - it moves
  // through 10% -> 5% -> Expired in place as the clock advances, rather
  // than spawning a separate card/log entry each time it steps down.
  // Paying in full clears every charge (and its card) at once.
  const INSTANCE_STAGES = ['10%', '5%', 'Expired'];
  function renderInstances() {
    const hasCharges = state.charges.length > 0;
    elements.instancesEmpty.classList.toggle('hidden', hasCharges);
    elements.instancesList.innerHTML = state.charges.map((charge) => {
      const stageIndex = Math.min(chargeAge(charge), INSTANCE_STAGES.length - 1);
      const expired = stageIndex === INSTANCE_STAGES.length - 1 && chargeRate(charge) === 0;
      const stagesHtml = INSTANCE_STAGES.map((label, index) => {
        const isExpiredStage = label === 'Expired';
        const classes = ['instance-stage'];
        if (index < stageIndex) classes.push('is-past');
        if (index === stageIndex) classes.push('is-current');
        if (index === stageIndex && isExpiredStage) classes.push('is-expired-stage');
        return `<span class="${classes.join(' ')}">${label}</span>`;
      }).join('<span class="instance-arrow" aria-hidden="true">›</span>');
      return `
        <div class="instance-card${expired ? ' is-expired' : ''}">
          <div class="instance-card__amount">${formatMoney(charge.amount)}</div>
          <div class="instance-card__stages">${stagesHtml}</div>
        </div>
      `;
    }).join('');
  }

  // The promo card is the actual call-to-action - it only ever shows up
  // while there's a balance to act on (or a payment to report right after
  // clearing one), same as the real feature. The ambient clock/timeline
  // above keeps running either way.
  function renderPromo() {
    const { total, amount, rate } = margin();
    const hasBalance = total > 0;
    const justPaid = state.lastPayment !== null;

    elements.promoCard.classList.toggle('hidden', !hasBalance && !justPaid);
    if (!hasBalance && !justPaid) return;

    const expired = amount <= 0;
    const ratePercent = Math.round(rate * 100);
    const allSameAge = new Set(state.charges.map(chargeAge)).size <= 1;
    const age = allSameAge && state.charges.length ? chargeAge(state.charges[0]) : null;

    elements.promoCard.classList.toggle('is-expired', expired);
    elements.promoBalance.textContent = formatMoney(total);
    elements.rewardValue.textContent = formatMoney(amount);

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
      elements.promoDescription.textContent = 'The promotional window has ended for every charge on this balance. Payments can still be completed, but no shop credit will be added.';
    } else if (age === 0) {
      const nextRatePercent = Math.round(CHARGE_AGE_RATES[1] * 100);
      elements.cashbackRate.textContent = `${ratePercent}% cash back`;
      elements.promoTitle.textContent = "Today's the best day to clear your balance";
      elements.promoDescription.textContent = `Pay your balance in full before the timer runs out and earn ${ratePercent}% back as shop credit. Tomorrow the rate drops to ${nextRatePercent}%.`;
    } else if (age === 1) {
      // One day old - the rate already stepped down overnight, and there's
      // no third chance after this - framed around what's earned today and
      // what's already gone, not a countdown/deadline, so it reads as an
      // incentive to catch rather than pressure to beat the clock.
      elements.cashbackRate.textContent = `${ratePercent}% cash back`;
      elements.promoTitle.textContent = "Don't miss today's cash back";
      elements.promoDescription.textContent = `Pay your balance in full before the timer runs out and earn ${ratePercent}% back as shop credit. Tomorrow there's nothing left to earn.`;
    } else {
      // Mixed ages - part of the balance is still earning, part has
      // already stepped down or expired. The blended rate/amount below
      // is what a full payment right now would actually earn.
      elements.cashbackRate.textContent = `${ratePercent}% cash back`;
      elements.promoTitle.textContent = 'Part of your balance is still earning cash back';
      elements.promoDescription.textContent = `Some charges have already dropped or expired, but others are still earning. Pay your whole balance in full now and earn ${ratePercent}% back (${formatMoney(amount)}) blended across everything you owe.`;
    }
  }

  function render() {
    const dayNumber = displayDayNumber();
    const { total } = margin();
    const activeAmount = state.charges.filter((charge) => chargeRate(charge) > 0).reduce((sum, charge) => sum + charge.amount, 0);

    elements.balanceValue.textContent = formatMoney(total);
    const showActiveNote = total > 0 && activeAmount < total;
    elements.balanceActiveNote.classList.toggle('hidden', !showActiveNote);
    if (showActiveNote) elements.balanceActiveNote.textContent = `${formatMoney(activeAmount)} still earning cash back`;
    elements.creditValue.textContent = formatMoney(state.shopCredit);
    elements.dayLabel.textContent = `Day ${dayNumber}`;
    elements.timeLabel.textContent = formatTime(state.segmentIndex);
    elements.payButton.disabled = total <= 0;

    elements.dayButtons.forEach((button, index) => {
      const active = index === state.absoluteDay % CYCLE_DAYS;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    document.title = `Day ${dayNumber} - Fresh Snacks Cashback Demo`;
    renderInstances();
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
