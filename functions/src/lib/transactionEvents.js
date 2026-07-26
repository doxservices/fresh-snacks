/* Append-only audit trail for transaction workflow transitions (spec
 * section 11). Every status change writes one event here in the SAME
 * batch/Firestore transaction as the transaction doc's own update, so the
 * event and the state change can never land inconsistently (one committed,
 * the other lost to a mid-write failure). */
const admin = require("firebase-admin");
const { uid: genId } = require("./shared");

/* Returns { ref, data } for one event doc - callers add it to their own
 * batch.set()/transaction.set() alongside the actual state-changing write,
 * rather than this module writing independently. */
function buildTransactionEvent(db, {
  transactionId, eventType, fromStatus, toStatus, actorUserId, actorRole, payload,
}) {
  const eventId = genId("fs_txevt");
  return {
    ref: db.collection("transactionEvents").doc(eventId),
    data: {
      transactionEventId: eventId,
      transactionId,
      eventType,
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
      actorUserId: actorUserId || null,
      actorRole: actorRole || null,
      eventPayload: payload || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
}

module.exports = { buildTransactionEvent };
