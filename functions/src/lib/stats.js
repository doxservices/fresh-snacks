/* Very rough, "quick" usage dashboard - not exact Firestore document
 * read/write counts (metering every individual document read/write across
 * 1000+ lines of route code would need a much deeper rewrite than a
 * dashboard page justifies). Instead this counts requests at the API level
 * - GET is treated as a "read", everything else (POST/PUT/PATCH/DELETE) as
 * a "write" - a reasonable proxy since nearly every route does at least one
 * matching Firestore operation, without touching any existing route logic.
 * Counts are held in memory per warm instance and flushed to Firestore in
 * one batched increment periodically, rather than writing on every single
 * request (which would make the dashboard a meaningful fraction of its own
 * traffic). A day's counts can therefore lag by up to FLUSH_MS behind the
 * dashboard's own "last updated" moment - fine for a rough trend view. */
const admin = require("firebase-admin");

const FLUSH_MS = 30000;
let pendingReads = 0;
let pendingWrites = 0;
let flushTimer = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function flush() {
  flushTimer = null;
  const reads = pendingReads;
  const writes = pendingWrites;
  if (!reads && !writes) return;
  pendingReads = 0;
  pendingWrites = 0;
  const FieldValue = admin.firestore.FieldValue;
  const day = todayKey();
  try {
    await admin.firestore().collection("stats").doc("api-usage").set({
      totalReads: FieldValue.increment(reads),
      totalWrites: FieldValue.increment(writes),
      updatedAt: FieldValue.serverTimestamp(),
      days: {
        [day]: { reads: FieldValue.increment(reads), writes: FieldValue.increment(writes) },
      },
    }, { merge: true });
  } catch (error) {
    // Best-effort only - a stats write failing must never surface as an
    // error on the real request that triggered it. Put the counts back so
    // the next flush attempt (or process exit) doesn't just lose them.
    pendingReads += reads;
    pendingWrites += writes;
    console.warn("Stats flush failed", error.message);
  }
}

function trackRequest(method) {
  if (method === "GET") pendingReads++;
  else pendingWrites++;
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_MS);
    flushTimer.unref?.();
  }
}

module.exports = { trackRequest, flush };
