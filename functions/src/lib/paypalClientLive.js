/* The real PayPal connection - used only by the authenticated "clear tab"
 * routes (../routes/paypalTab.js) that charge a customer's actual balance.
 * Requires PAYPAL_CLIENT_SECRET (set via `firebase functions:secrets:set
 * PAYPAL_CLIENT_SECRET`) - the client-id alone (already public, embedded
 * in index.html) is not enough to call PayPal's REST API. */
const { createPaypalClient } = require("./paypalClient");

module.exports = createPaypalClient({
  clientId: process.env.PAYPAL_CLIENT_ID
    || "AbUfyOs_HCKQuvW5o1S5MdZ-EZy5eoUFY-j06jPcTVzJhSdVyVb_4N9t9ZCf43HVDfzE2GD6yKdLHz8G",
  clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  apiBase: process.env.PAYPAL_API_BASE || "https://api-m.paypal.com",
  label: "live",
});
