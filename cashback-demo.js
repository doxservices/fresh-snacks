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
    creditValue: document.querySelector('#credit-value'),
    dayLabel: document.querySelector('#day-label'),
    timeLabel: document.querySelector('#time-label'),
    chargesPanel: document.querySelector('#charges-panel'),
    chargesList: document.querySelector('#charges-list'),
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
    lastPayment: null,
    // A running log of bonuses lost by leaving a charge unpaid past 3pm -
    // one entry per charge per tier it ages out of (10%, then 5%),
    // captured at the moment each one is gone for good. Persists across
    // reset-free cycles so the well can show more than just the latest
    // miss; only Reset clears it.
    missedBonuses: []
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
      // 3pm is passing right now - any charge still sitting at a tier
      // that actually paid something loses that tier's bonus for good
      // the instant the clock rolls to the next day. Each charge is
      // judged on its OWN age, so a single rollover can record more than
      // one miss at once if multiple charges each lose a tier together.
      for (const charge of state.charges) {
        const age = chargeAge(charge);
        if (age < CHARGE_AGE_RATES.length - 1) {
          recordMissedBonus(charge, CHARGE_AGE_RATES[age]);
        }
      }
      state.segmentIndex = 0;
      // The ambient clock always advances - it doesn't pause or reset for
      // anyone, regardless of anyone's balance or payment history.
      state.absoluteDay += 1;
      state.lastPayment = null;
    }
    render();
  }

  function recordMissedBonus(charge, rate) {
    state.missedBonuses.unshift({
      balance: charge.amount,
      pct: Math.round(rate * 100),
      amount: round2(charge.amount * rate)
    });
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
    state.charges = [{ id: nextChargeId++, amount: sanitizeAmount(elements.startingBalance.value), openedOnDay: 0 }];
    state.shopCredit = 0;
    state.absoluteDay = 0;
    state.segmentIndex = 0;
    state.lastPayment = null;
    state.missedBonuses = [];
    render();
    showToast('Simulation reset to the starting balance.');
  }

  function addToBalance() {
    // A new charge is its own margin - it earns its own fresh 10% as of
    // today, whatever day the ambient clock is on, but it does NOT reset
    // or reactivate any existing charge already on the balance.
    state.charges.push({ id: nextChargeId++, amount: 100, openedOnDay: state.absoluteDay });
    state.lastPayment = null;
    render();
    showToast('J$100 charge added - it earns cash back on its own schedule.');
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
  // The bar itself only means something while at least one charge is
  // actively earning something - once every charge has expired (or
  // there's no balance at all), showing a countdown implies there's still
  // something to lose, which isn't true anymore. It disappears at that
  // point; the promo card below still reminds the customer they have a
  // balance to pay off either way.
  function renderTimeline() {
    const stillEarning = state.charges.some((charge) => chargeRate(charge) > 0);
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

  // A per-charge breakdown so the blended balance/reward numbers below
  // are checkable at a glance - only shown once there's more than one
  // charge, since a single charge is already fully explained by the
  // promo card itself.
  function renderCharges() {
    elements.chargesPanel.classList.toggle('hidden', state.charges.length < 2);
    if (state.charges.length < 2) return;

    elements.chargesList.innerHTML = state.charges.map((charge) => {
      const age = chargeAge(charge);
      const rate = chargeRate(charge);
      const expired = rate === 0;
      const dayWord = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`;
      return `
        <div class="charge-row${expired ? ' is-expired' : ''}">
          <div class="charge-row__meta">
            <span class="charge-row__amount">${formatMoney(charge.amount)}</span>
            <span class="charge-row__day">Added ${dayWord}</span>
          </div>
          <span class="charge-row__rate">${expired ? 'Expired' : `${Math.round(rate * 100)}%`}</span>
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
    const { total } = margin();

    elements.balanceValue.textContent = formatMoney(total);
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
    renderCharges();
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
