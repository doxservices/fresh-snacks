/* Admin permission model. Every sensitive transaction/payment action is
 * gated by one of these keys, checked against the calling admin's own
 * `admins/{uid}.permissions` map - never against a single all-or-nothing
 * `active` flag once a permissions map exists on that doc.
 *
 * Existing admin docs that predate this system have no `permissions` field
 * at all - hasPermission() treats a missing map as full access (grandfathered
 * in, same precedent as nameSet/workflowStatus elsewhere in this app), so
 * today's real admin accounts are not locked out by this shipping. Only
 * admins created through the new admin-management screen get an explicit
 * permissions map, and only what's explicitly `false` in it is denied. */

const PERMISSION = Object.freeze({
  EDIT_TRANSACTION: "editTransaction",
  RESET_TRANSACTION: "resetTransaction",
  CANCEL_TRANSACTION: "cancelTransaction",
  DELETE_TRANSACTION: "deleteTransaction",
  APPROVE_ITEM: "approveItem",
  MARK_PAID: "markPaid",
  CONFIRM_PAYMENT: "confirmPayment",
  REVIEW_PAYMENT: "reviewPayment",
  REJECT_PAYMENT_CLAIM: "rejectPaymentClaim",
  MANAGE_ADMINS: "manageAdmins",
});

const PERMISSION_LABELS = Object.freeze({
  [PERMISSION.EDIT_TRANSACTION]: "Change a listing (quantity/date)",
  [PERMISSION.RESET_TRANSACTION]: "Reset a listing back to Awaiting confirmation",
  [PERMISSION.CANCEL_TRANSACTION]: "Void/cancel a listing",
  [PERMISSION.DELETE_TRANSACTION]: "Permanently delete a listing",
  [PERMISSION.APPROVE_ITEM]: "Approve a disputed item",
  [PERMISSION.MARK_PAID]: "Mark a transaction paid directly",
  [PERMISSION.CONFIRM_PAYMENT]: "Confirm a customer-reported payment",
  [PERMISSION.REVIEW_PAYMENT]: "Put a reported payment under review",
  [PERMISSION.REJECT_PAYMENT_CLAIM]: "Reject a payment claim",
  [PERMISSION.MANAGE_ADMINS]: "Create and manage other admin accounts",
});

/* Role presets are starting points for the toggle table only - the admin
 * doc's own `permissions` map is what's actually enforced, so an operator
 * can always hand-adjust an individual toggle away from its preset. */
const ROLE_PRESETS = Object.freeze({
  admin: Object.freeze({
    [PERMISSION.EDIT_TRANSACTION]: true,
    [PERMISSION.RESET_TRANSACTION]: true,
    [PERMISSION.CANCEL_TRANSACTION]: true,
    [PERMISSION.DELETE_TRANSACTION]: true,
    [PERMISSION.APPROVE_ITEM]: true,
    [PERMISSION.MARK_PAID]: true,
    [PERMISSION.CONFIRM_PAYMENT]: true,
    [PERMISSION.REVIEW_PAYMENT]: true,
    [PERMISSION.REJECT_PAYMENT_CLAIM]: true,
    [PERMISSION.MANAGE_ADMINS]: true,
  }),
  // Full operational visibility - everything except the two most
  // destructive, hard-to-undo actions (delete, and granting others admin
  // access), per the explicit "cancel yes, delete no" split.
  accounting: Object.freeze({
    [PERMISSION.EDIT_TRANSACTION]: true,
    [PERMISSION.RESET_TRANSACTION]: true,
    [PERMISSION.CANCEL_TRANSACTION]: true,
    [PERMISSION.DELETE_TRANSACTION]: false,
    [PERMISSION.APPROVE_ITEM]: true,
    [PERMISSION.MARK_PAID]: true,
    [PERMISSION.CONFIRM_PAYMENT]: true,
    [PERMISSION.REVIEW_PAYMENT]: true,
    [PERMISSION.REJECT_PAYMENT_CLAIM]: true,
    [PERMISSION.MANAGE_ADMINS]: false,
  }),
  // Front-of-house: can take and confirm payment, nothing that edits,
  // disputes, cancels, or deletes a record.
  cashier: Object.freeze({
    [PERMISSION.EDIT_TRANSACTION]: false,
    [PERMISSION.RESET_TRANSACTION]: false,
    [PERMISSION.CANCEL_TRANSACTION]: false,
    [PERMISSION.DELETE_TRANSACTION]: false,
    [PERMISSION.APPROVE_ITEM]: false,
    [PERMISSION.MARK_PAID]: true,
    [PERMISSION.CONFIRM_PAYMENT]: true,
    [PERMISSION.REVIEW_PAYMENT]: false,
    [PERMISSION.REJECT_PAYMENT_CLAIM]: false,
    [PERMISSION.MANAGE_ADMINS]: false,
  }),
});

/* A missing `permissions` map = grandfathered full access (see file header).
 * Once a map exists, only an explicit `false` denies - an unrecognized key
 * defaults to allowed, so a permission added in a later release doesn't
 * retroactively lock out admins who were toggled before it existed. */
function hasPermission(adminDoc, key) {
  if (!adminDoc || !adminDoc.permissions) return true;
  return adminDoc.permissions[key] !== false;
}

module.exports = { PERMISSION, PERMISSION_LABELS, ROLE_PRESETS, hasPermission };
