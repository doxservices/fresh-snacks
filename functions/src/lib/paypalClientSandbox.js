/* The sandbox PayPal connection - used only by the standalone test page's
 * routes (../routes/paypal.js). Deliberately kept on its own credentials,
 * separate from paypalClientLive.js, so going live for real customers can
 * never silently turn this test page into a real-money page too.
 * Requires PAYPAL_SANDBOX_CLIENT_SECRET (set via `firebase functions:
 * secrets:set PAYPAL_SANDBOX_CLIENT_SECRET`). */
const { createPaypalClient } = require("./paypalClient");

module.exports = createPaypalClient({
  clientId: process.env.PAYPAL_SANDBOX_CLIENT_ID
    || "ATsbP8Pn9MQbCbxeB74E2j3UNj3rjzrVlTRsvD4nbw3D0I5HM4dCCcRE6LLqNE6yN3dnMbo7MTrLd37B",
  clientSecret: process.env.PAYPAL_SANDBOX_CLIENT_SECRET,
  apiBase: "https://api-m.sandbox.paypal.com",
  label: "sandbox demo",
});
