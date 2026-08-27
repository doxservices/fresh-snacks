const assert = require("node:assert/strict");
const { isCleanupCandidate, graceRemainingMs, CLEANUP_GRACE_HOURS } = require("../src/lib/inviteCleanup");

const NOW = new Date("2026-08-25T12:00:00Z");
const hoursAgo = (h) => ({ toDate: () => new Date(NOW.getTime() - h * 3600 * 1000) });

const freshInvite = { vipStatus: "vip", displayName: "VIP Customer", createdAt: hoursAgo(1) };
const staleInvite = { vipStatus: "vip", displayName: "VIP Customer", createdAt: hoursAgo(25) };
const exactlyAtGrace = { vipStatus: "vip", displayName: "VIP Customer", createdAt: hoursAgo(CLEANUP_GRACE_HOURS) };

// Not old enough yet.
assert.equal(isCleanupCandidate(freshInvite, { answered: false, hasActivity: false, now: NOW }), false);

// Old enough, never answered, never bought anything - a real candidate.
assert.equal(isCleanupCandidate(staleInvite, { answered: false, hasActivity: false, now: NOW }), true);
assert.equal(isCleanupCandidate(exactlyAtGrace, { answered: false, hasActivity: false, now: NOW }), true);

// Answered (someone accepted the invite) - rescued regardless of age.
assert.equal(isCleanupCandidate(staleInvite, { answered: true, hasActivity: false, now: NOW }), false);

// Has a transaction/payment - rescued regardless of age.
assert.equal(isCleanupCandidate(staleInvite, { answered: false, hasActivity: true, now: NOW }), false);

// A real name means it's not a placeholder invite at all - never a candidate.
const namedTab = { vipStatus: "named", firstName: "Jordan", lastName: "Blake", createdAt: hoursAgo(200) };
assert.equal(isCleanupCandidate(namedTab, { answered: false, hasActivity: false, now: NOW }), false);

// Not a "vip" placeholder tab at all (an ordinary anonymous guest, or a
// deliberately-named tab) - never a candidate, regardless of age/activity.
const anonymousGuest = { vipStatus: "anonymous", createdAt: hoursAgo(200) };
assert.equal(isCleanupCandidate(anonymousGuest, { answered: false, hasActivity: false, now: NOW }), false);

// Already expired - not re-swept.
const alreadyExpired = { vipStatus: "vip", status: "expired", createdAt: hoursAgo(200) };
assert.equal(isCleanupCandidate(alreadyExpired, { answered: false, hasActivity: false, now: NOW }), false);

// No createdAt at all - can't compute an age, so never auto-expired.
const noCreatedAt = { vipStatus: "vip", displayName: "VIP Customer" };
assert.equal(isCleanupCandidate(noCreatedAt, { answered: false, hasActivity: false, now: NOW }), false);

// graceRemainingMs mirrors the same gate, but as a countdown for the UI.
assert.equal(graceRemainingMs(staleInvite, { answered: false, hasActivity: false, now: NOW }), 0);
assert.equal(graceRemainingMs(freshInvite, { answered: false, hasActivity: false, now: NOW }), 23 * 3600 * 1000);
assert.equal(graceRemainingMs(namedTab, { answered: false, hasActivity: false, now: NOW }), null);
assert.equal(graceRemainingMs(staleInvite, { answered: true, hasActivity: false, now: NOW }), null);

console.log("invite cleanup regression checks passed");
