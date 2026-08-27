const assert = require("node:assert/strict");
const { hasRealName, isPlaceholderDisplayName, splitDisplayName, accounting } = require("../src/lib/shared");

// A real first+last name, regardless of how it got there (self-entry, an
// invitee, or an admin typing it into accounting.html) counts.
assert.equal(hasRealName({ firstName: "Jordan", lastName: "Blake" }), true);
assert.equal(hasRealName({ firstName: "Jo", lastName: "Lee" }), false); // "Jo" is under the 3-char minimum
assert.equal(hasRealName({ firstName: "Anna" }), false); // no last name at all

// The Generate Invite placeholder and the anonymous-tab default never
// count, no matter how they're split.
assert.equal(hasRealName({ firstName: "VIP", lastName: "Customer" }), false);
assert.equal(hasRealName({ firstName: "Guest", lastName: "AB12" }), false);
assert.equal(hasRealName({}), false);
assert.equal(hasRealName(null), false);

// Legacy fallback: no split firstName/lastName, but a real combined
// displayName plus real contact info still counts.
assert.equal(hasRealName({ displayName: "Marcus Reid", email: "m@example.com", phone: "8765551234" }), true);
// Same legacy path, but the displayName is one of this app's own
// placeholders - contact info alone doesn't rescue it.
assert.equal(hasRealName({ displayName: "VIP Customer", email: "m@example.com", phone: "8765551234" }), false);
assert.equal(hasRealName({ displayName: "Guest AB12", email: "m@example.com", phone: "8765551234" }), false);

assert.equal(isPlaceholderDisplayName("VIP Customer"), true);
assert.equal(isPlaceholderDisplayName("Guest AB12"), true);
assert.equal(isPlaceholderDisplayName("New Guest"), true);
assert.equal(isPlaceholderDisplayName(""), true);
assert.equal(isPlaceholderDisplayName("Jordan Blake"), false);

assert.deepEqual(splitDisplayName("Jordan Blake"), { firstName: "Jordan", lastName: "Blake" });
assert.deepEqual(splitDisplayName("Mary Jane Watson"), { firstName: "Mary", lastName: "Jane Watson" });
assert.deepEqual(splitDisplayName(""), { firstName: "", lastName: "" });

// accounting(): a still-unnamed "vip" placeholder tab with zero activity
// stays off the main list (createdByAdmin doesn't rescue it - every
// admin-created tab has that set from the moment it's created, before
// anyone has been invited or named) - but the same tab reappears the
// instant it earns any real activity, and a real name (vipStatus "named")
// with zero activity still shows, same as before this change.
const pendingInvite = { userId: "u1", uid: "u1", displayName: "VIP Customer", vipStatus: "vip", createdByAdmin: "admin1" };
assert.equal(accounting([pendingInvite], [], [], [], []).length, 0);

const pendingInviteWithActivity = { userId: "u2", uid: "u2", displayName: "VIP Customer", vipStatus: "vip", createdByAdmin: "admin1" };
const rowsWithActivity = accounting(
  [pendingInviteWithActivity], [],
  [{ userId: "u2", total: 100, workflowStatus: "CONFIRMED_UNPAID", createdDate: "2026-08-01" }],
  [], [],
);
assert.equal(rowsWithActivity.length, 1);
assert.equal(rowsWithActivity[0].snackTotal, 100);

const namedNoActivity = { userId: "u3", uid: "u3", displayName: "Jordan Blake", vipStatus: "named", createdByAdmin: "admin1" };
assert.equal(accounting([namedNoActivity], [], [], [], []).length, 1);

console.log("name-completeness regression checks passed");
