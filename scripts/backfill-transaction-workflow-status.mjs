/**
 * Backfills `workflowStatus`/`createdByRole`/`version` onto every existing
 * transaction that predates the tab_transaction_flow_implementation_spec.md
 * migration, using the exact same derivation the live API already falls
 * back to for un-migrated docs (deriveWorkflowStatus/deriveCreatedByRole in
 * functions/src/lib/transactionStatus.js). Running this isn't required for
 * correctness - every read path already tolerates a missing workflowStatus
 * - but it makes every doc self-describing going forward instead of
 * relying on the fallback derivation forever, and it's what actually lets
 * admin.js's transition endpoints (which read `record.workflowStatus`
 * through the same deriveWorkflowStatus() call) settle into the new field
 * as the one source of truth.
 *
 * Existing admin-created transactions are deliberately grandfathered into
 * CONFIRMED_UNPAID rather than retroactively gated into
 * PENDING_USER_CONFIRMATION - see deriveWorkflowStatus()'s own comment for
 * why. Only transactions created after this ships start out gated.
 *
 * Usage:
 *   node scripts/backfill-transaction-workflow-status.mjs
 *   node scripts/backfill-transaction-workflow-status.mjs --apply
 *
 * Application Default Credentials must have Firestore admin access.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { STATUS, ROLE, EVENT_TYPE, deriveWorkflowStatus, deriveCreatedByRole } from "../functions/src/lib/transactionStatus.js";
import { uid as genId } from "../functions/src/lib/shared.js";

const apply = process.argv.includes("--apply");
const projectId = "fresh-snacks-ee79f";

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const snapshot = await db.collection("transactions").get();
const docs = snapshot.docs.map((doc) => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
const pending = docs.filter((record) => !record.workflowStatus);

const planFor = (record) => {
  const workflowStatus = deriveWorkflowStatus(record);
  const createdByRole = deriveCreatedByRole(record);
  const fields = { workflowStatus, createdByRole, version: 1 };

  if (workflowStatus === STATUS.CONFIRMED_UNPAID && createdByRole === ROLE.USER) {
    fields.userConfirmedAt = record.createdAt || FieldValue.serverTimestamp();
    fields.userConfirmedBy = record.userId || record.uid || null;
  } else if (workflowStatus === STATUS.PAID_FINALIZED) {
    fields.finalizedAt = record.paidAt || record.approvedAt || record.createdAt || FieldValue.serverTimestamp();
    fields.paymentConfirmedAt = record.paidAt || fields.finalizedAt;
    fields.paymentConfirmedByAdminId = record.paidBy || null;
  } else if (workflowStatus === STATUS.ITEM_UNDER_REVIEW) {
    fields.itemReviewedAt = record.userStatusAt || record.createdAt || FieldValue.serverTimestamp();
    fields.itemReviewedBy = record.userId || record.uid || null;
    fields.itemReviewReason = "Migrated from a legacy dispute flag - no free-text reason was recorded.";
  } else if (workflowStatus === STATUS.CANCELLED) {
    fields.cancelledAt = record.voidedAt || record.createdAt || FieldValue.serverTimestamp();
    fields.cancelledBy = record.voidedBy || null;
  }

  const eventId = genId("fs_txevt");
  const event = {
    ref: db.collection("transactionEvents").doc(eventId),
    data: {
      transactionEventId: eventId,
      transactionId: record.transactionId || record.id,
      eventType: createdByRole === ROLE.ADMIN ? EVENT_TYPE.TRANSACTION_CREATED_BY_ADMIN : EVENT_TYPE.TRANSACTION_CREATED_BY_USER,
      fromStatus: null,
      toStatus: workflowStatus,
      actorUserId: null,
      actorRole: createdByRole,
      eventPayload: { migrated: true },
      createdAt: record.createdAt || FieldValue.serverTimestamp(),
    },
  };

  return { fields, event };
};

const summary = pending.reduce((counts, record) => {
  const { fields } = planFor(record);
  counts[fields.workflowStatus] = (counts[fields.workflowStatus] || 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  totalTransactions: docs.length,
  alreadyMigrated: docs.length - pending.length,
  toMigrate: pending.length,
  byResultingStatus: summary,
}, null, 2));

if (apply && pending.length) {
  for (let offset = 0; offset < pending.length; offset += 200) {
    const batch = db.batch();
    for (const record of pending.slice(offset, offset + 200)) {
      const { fields, event } = planFor(record);
      batch.update(record.ref, fields);
      batch.set(event.ref, event.data);
    }
    await batch.commit();
  }
  console.log(`Backfilled workflowStatus on ${pending.length} transaction(s).`);
}
