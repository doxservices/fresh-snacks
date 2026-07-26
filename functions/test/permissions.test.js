const assert = require("node:assert/strict");
const { PERMISSION, ROLE_PRESETS, hasPermission } = require("../src/lib/permissions");

// A missing `permissions` map = grandfathered full access - today's real
// admin accounts predate this system and must not be locked out by it.
assert.equal(hasPermission({ active: true }, PERMISSION.DELETE_TRANSACTION), true);
assert.equal(hasPermission(null, PERMISSION.DELETE_TRANSACTION), true);

// Once a permissions map exists, only an explicit `false` denies.
assert.equal(hasPermission({ permissions: { deleteTransaction: false } }, PERMISSION.DELETE_TRANSACTION), false);
assert.equal(hasPermission({ permissions: { deleteTransaction: true } }, PERMISSION.DELETE_TRANSACTION), true);

// A key absent from an otherwise-present permissions map defaults to
// allowed, so a permission added later doesn't retroactively lock out
// admins who were toggled before it existed.
assert.equal(hasPermission({ permissions: { markPaid: true } }, PERMISSION.EDIT_TRANSACTION), true);

// Role presets match the explicit examples given when this was designed:
// admin has everything, accounting can cancel but not delete, cashier can
// mark paid but not cancel or delete.
assert.equal(ROLE_PRESETS.admin[PERMISSION.DELETE_TRANSACTION], true);
assert.equal(ROLE_PRESETS.accounting[PERMISSION.CANCEL_TRANSACTION], true);
assert.equal(ROLE_PRESETS.accounting[PERMISSION.DELETE_TRANSACTION], false);
assert.equal(ROLE_PRESETS.cashier[PERMISSION.CANCEL_TRANSACTION], false);
assert.equal(ROLE_PRESETS.cashier[PERMISSION.DELETE_TRANSACTION], false);
assert.equal(ROLE_PRESETS.cashier[PERMISSION.MARK_PAID], true);

// Every preset assigns every known permission key explicitly (no accidental
// gaps that would fall back to "allowed" for a preset that meant to deny).
for (const preset of Object.values(ROLE_PRESETS)) {
  for (const key of Object.values(PERMISSION)) {
    assert.equal(typeof preset[key], "boolean", `preset is missing an explicit value for ${key}`);
  }
}

console.log("permission model regression checks passed");
