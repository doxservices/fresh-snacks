/* Authoritative transaction workflow state machine (tab_transaction_flow_
 * implementation_spec.md). This is the ONE place that decides what status
 * follows what, and which role may trigger it - every route just calls
 * applyTransition()/assertTransition() instead of hand-rolling status
 * checks, so the rules can never drift between endpoints.
 *
 * The workflow status below is deliberately a separate field from the
 * transaction's existing `status` ("active"/"void" soft-delete marker,
 * queried with `.where("status", "==", "active")` all over the codebase).
 * Naming it `status` too would silently break every one of those queries,
 * so it lives in `workflowStatus` instead. CANCELLED also sets the legacy
 * `status: "void"` so every existing active/void query keeps excluding it
 * with no changes needed there. */

const STATUS = Object.freeze({
  PENDING_USER_CONFIRMATION: "PENDING_USER_CONFIRMATION",
  ITEM_UNDER_REVIEW: "ITEM_UNDER_REVIEW",
  CONFIRMED_UNPAID: "CONFIRMED_UNPAID",
  PAYMENT_PENDING_ADMIN_CONFIRMATION: "PAYMENT_PENDING_ADMIN_CONFIRMATION",
  PAYMENT_UNDER_REVIEW: "PAYMENT_UNDER_REVIEW",
  PAID_FINALIZED: "PAID_FINALIZED",
  CANCELLED: "CANCELLED",
});

const ROLE = Object.freeze({ USER: "USER", ADMIN: "ADMIN" });

const ACTION = Object.freeze({
  CONFIRM_ITEM: "CONFIRM_ITEM",
  REVIEW_ITEM: "REVIEW_ITEM",
  EDIT: "EDIT",
  EDIT_AND_RESEND: "EDIT_AND_RESEND",
  APPROVE_ITEM: "APPROVE_ITEM",
  MARK_AS_PAID: "MARK_AS_PAID",
  CONFIRM_PAYMENT: "CONFIRM_PAYMENT",
  REVIEW_PAYMENT: "REVIEW_PAYMENT",
  REJECT_PAYMENT_CLAIM: "REJECT_PAYMENT_CLAIM",
  CANCEL: "CANCEL",
  RESET: "RESET",
  VIEW_DETAILS: "VIEW_DETAILS",
});

const FINAL_STATUSES = new Set([STATUS.PAID_FINALIZED, STATUS.CANCELLED]);

/* Spec section 11 - the append-only audit trail's event types. */
const EVENT_TYPE = Object.freeze({
  TRANSACTION_CREATED_BY_USER: "TRANSACTION_CREATED_BY_USER",
  TRANSACTION_CREATED_BY_ADMIN: "TRANSACTION_CREATED_BY_ADMIN",
  ITEM_CONFIRMED_BY_USER: "ITEM_CONFIRMED_BY_USER",
  ITEM_REVIEW_REQUESTED_BY_USER: "ITEM_REVIEW_REQUESTED_BY_USER",
  ITEM_EDITED_BY_ADMIN: "ITEM_EDITED_BY_ADMIN",
  ITEM_APPROVED_BY_ADMIN: "ITEM_APPROVED_BY_ADMIN",
  ITEM_CANCELLED: "ITEM_CANCELLED",
  PAYMENT_MARKED_BY_USER: "PAYMENT_MARKED_BY_USER",
  PAYMENT_MARKED_BY_ADMIN: "PAYMENT_MARKED_BY_ADMIN",
  PAYMENT_CONFIRMED_BY_ADMIN: "PAYMENT_CONFIRMED_BY_ADMIN",
  PAYMENT_REVIEW_REQUESTED_BY_ADMIN: "PAYMENT_REVIEW_REQUESTED_BY_ADMIN",
  PAYMENT_CLAIM_REJECTED_BY_ADMIN: "PAYMENT_CLAIM_REJECTED_BY_ADMIN",
  TRANSACTION_FINALIZED: "TRANSACTION_FINALIZED",
  TRANSACTION_RESET_BY_ADMIN: "TRANSACTION_RESET_BY_ADMIN",
});

/* current status -> role -> action -> next status. Only entries present
 * here are ever valid; anything else is rejected by assertTransition(). */
const TRANSITIONS = {
  [STATUS.PENDING_USER_CONFIRMATION]: {
    [ROLE.USER]: {
      [ACTION.CONFIRM_ITEM]: STATUS.CONFIRMED_UNPAID,
      [ACTION.REVIEW_ITEM]: STATUS.ITEM_UNDER_REVIEW,
    },
    [ROLE.ADMIN]: {
      [ACTION.EDIT]: STATUS.PENDING_USER_CONFIRMATION,
      [ACTION.CANCEL]: STATUS.CANCELLED,
    },
  },
  [STATUS.ITEM_UNDER_REVIEW]: {
    [ROLE.ADMIN]: {
      [ACTION.EDIT_AND_RESEND]: STATUS.PENDING_USER_CONFIRMATION,
      [ACTION.APPROVE_ITEM]: STATUS.CONFIRMED_UNPAID,
      [ACTION.CANCEL]: STATUS.CANCELLED,
      // Undoes the dispute itself with no content change - the item goes
      // back to awaiting the user's first confirmation, same destination
      // as Edit and Resend, just without touching quantity/date/price.
      [ACTION.RESET]: STATUS.PENDING_USER_CONFIRMATION,
    },
  },
  [STATUS.CONFIRMED_UNPAID]: {
    [ROLE.USER]: {
      [ACTION.MARK_AS_PAID]: STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION,
    },
    [ROLE.ADMIN]: {
      // Any admin content edit after the user has already confirmed must be
      // re-confirmed against the new values - it is never applied silently.
      [ACTION.EDIT]: STATUS.PENDING_USER_CONFIRMATION,
      [ACTION.MARK_AS_PAID]: STATUS.PAID_FINALIZED,
      [ACTION.CANCEL]: STATUS.CANCELLED,
      // "Do nothing to the record, just put it back in the user's hands to
      // confirm" - an explicit undo distinct from Edit, which also touches
      // quantity/date/price. Reset never does.
      [ACTION.RESET]: STATUS.PENDING_USER_CONFIRMATION,
    },
  },
  [STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION]: {
    [ROLE.ADMIN]: {
      [ACTION.CONFIRM_PAYMENT]: STATUS.PAID_FINALIZED,
      [ACTION.REVIEW_PAYMENT]: STATUS.PAYMENT_UNDER_REVIEW,
      // Editing content while a payment claim is pending isn't gated behind
      // Review Payment first - it's the same "content changed, start the
      // confirmation over" rule CONFIRMED_UNPAID's EDIT already follows.
      [ACTION.EDIT]: STATUS.PENDING_USER_CONFIRMATION,
      [ACTION.RESET]: STATUS.PENDING_USER_CONFIRMATION,
    },
  },
  [STATUS.PAYMENT_UNDER_REVIEW]: {
    [ROLE.ADMIN]: {
      [ACTION.CONFIRM_PAYMENT]: STATUS.PAID_FINALIZED,
      [ACTION.REJECT_PAYMENT_CLAIM]: STATUS.CONFIRMED_UNPAID,
      [ACTION.EDIT]: STATUS.PENDING_USER_CONFIRMATION,
      [ACTION.RESET]: STATUS.PENDING_USER_CONFIRMATION,
    },
  },
  [STATUS.PAID_FINALIZED]: {},
  [STATUS.CANCELLED]: {},
};

/* Section 15 action resolvers - what the actor should be offered to click,
 * purely a function of (status, role). createdByRole never enters into
 * this: a user-created transaction simply never visits
 * PENDING_USER_CONFIRMATION/ITEM_UNDER_REVIEW, so CONFIRM_ITEM/REVIEW_ITEM
 * naturally never appear for it without any extra branching here. */
function availableActions(workflowStatus, role) {
  if (role === ROLE.USER) {
    switch (workflowStatus) {
      case STATUS.PENDING_USER_CONFIRMATION:
        return [ACTION.CONFIRM_ITEM, ACTION.REVIEW_ITEM, ACTION.VIEW_DETAILS];
      case STATUS.CONFIRMED_UNPAID:
        return [ACTION.MARK_AS_PAID, ACTION.VIEW_DETAILS];
      default:
        return [ACTION.VIEW_DETAILS];
    }
  }
  if (role === ROLE.ADMIN) {
    switch (workflowStatus) {
      case STATUS.PENDING_USER_CONFIRMATION:
        return [ACTION.EDIT, ACTION.CANCEL, ACTION.VIEW_DETAILS];
      case STATUS.ITEM_UNDER_REVIEW:
        return [ACTION.EDIT_AND_RESEND, ACTION.APPROVE_ITEM, ACTION.RESET, ACTION.CANCEL, ACTION.VIEW_DETAILS];
      case STATUS.CONFIRMED_UNPAID:
        return [ACTION.EDIT, ACTION.MARK_AS_PAID, ACTION.RESET, ACTION.CANCEL, ACTION.VIEW_DETAILS];
      case STATUS.PAYMENT_PENDING_ADMIN_CONFIRMATION:
        return [ACTION.CONFIRM_PAYMENT, ACTION.REVIEW_PAYMENT, ACTION.EDIT, ACTION.RESET, ACTION.VIEW_DETAILS];
      case STATUS.PAYMENT_UNDER_REVIEW:
        return [ACTION.CONFIRM_PAYMENT, ACTION.REJECT_PAYMENT_CLAIM, ACTION.EDIT, ACTION.RESET, ACTION.VIEW_DETAILS];
      default:
        return [ACTION.VIEW_DETAILS];
    }
  }
  return [ACTION.VIEW_DETAILS];
}

/* Returns the next status for (current, role, action), or null if that
 * transition isn't defined. Callers that need to reject invalid attempts
 * with a 409 should use assertTransition() instead. */
function nextStatusFor(workflowStatus, role, action) {
  return TRANSITIONS[workflowStatus]?.[role]?.[action] ?? null;
}

/* Throws a 409 TRANSACTION_STATE_CHANGED-shaped error (spec section 22) when
 * the requested action isn't valid from the transaction's current status
 * for that role - the same error shape whether the status simply doesn't
 * allow it or a concurrent request already moved it on. */
function assertTransition(workflowStatus, role, action) {
  const next = nextStatusFor(workflowStatus, role, action);
  if (!next) {
    throw Object.assign(new Error("This transaction was updated by another action and no longer allows that step."), {
      status: 409,
      code: "TRANSACTION_STATE_CHANGED",
      currentStatus: workflowStatus,
    });
  }
  return next;
}

function isFinal(workflowStatus) {
  return FINAL_STATUSES.has(workflowStatus);
}

/* Section 16: the status (and creator role) a brand-new transaction starts
 * at, purely a function of who created it. */
function initialStatus(createdByRole) {
  return createdByRole === ROLE.ADMIN ? STATUS.PENDING_USER_CONFIRMATION : STATUS.CONFIRMED_UNPAID;
}

/* Section 23 migration mapping, for any record written before this field
 * existed (and as a defensive fallback if the one-off backfill script
 * hasn't reached a given doc yet). Existing admin-created transactions are
 * deliberately grandfathered into CONFIRMED_UNPAID rather than retroactively
 * gated into PENDING_USER_CONFIRMATION - the business never asked those
 * customers to confirm them, so surfacing a sudden backlog of "needs your
 * confirmation" prompts for old history would be a surprising regression,
 * not a fix. Only transactions created after this ships start out gated. */
function deriveWorkflowStatus(record) {
  if (record.workflowStatus) return record.workflowStatus;
  if (record.status === "void") return STATUS.CANCELLED;
  if (record.reviewStatus === "paid") return STATUS.PAID_FINALIZED;
  if (record.userStatus === "disputed") return STATUS.ITEM_UNDER_REVIEW;
  return STATUS.CONFIRMED_UNPAID;
}

function deriveCreatedByRole(record) {
  return record.createdByRole || (record.source === "admin" ? ROLE.ADMIN : ROLE.USER);
}

module.exports = {
  STATUS, ROLE, ACTION, EVENT_TYPE, availableActions, nextStatusFor, assertTransition, isFinal, initialStatus,
  deriveWorkflowStatus, deriveCreatedByRole,
};
