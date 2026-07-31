// The only pure, deterministic piece of paypalRate.js - the live fetch and
// Firestore read/write paths need real network/DB and are exercised via
// the actual deployed environment instead (see DEV-NOTES.md).
const assert = require("node:assert/strict");
const { roundUpToTen } = require("../src/lib/paypalRate");

assert.equal(roundUpToTen(157.91), 160, "a typical fractional rate rounds up to the next multiple of 10");
assert.equal(roundUpToTen(160), 160, "an exact multiple of 10 stays put, not bumped to the next one");
assert.equal(roundUpToTen(160.01), 170, "just over a multiple of 10 still rounds up to the NEXT one");
assert.equal(roundUpToTen(1), 10, "small rates still round up to at least 10");

console.log("PayPal rate rounding regression checks passed");
