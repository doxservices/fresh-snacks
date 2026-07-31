/* Server-side PayPal REST client - order creation and capture both happen
 * here, never in the browser. The client-side page only ever renders
 * PayPal's Buttons and asks this server "give me an order for my current
 * balance" / "capture this approved order" - it never constructs the
 * order object or the charge amount itself, so there's nothing about the
 * amount a tampered front end could change.
 *
 * Requires PAYPAL_CLIENT_SECRET (set via `firebase functions:secrets:set
 * PAYPAL_CLIENT_SECRET`, or PAYPAL_CLIENT_SECRET in a local .env for the
 * emulator) - the client-id alone (already public, embedded in the page)
 * is not enough to call PayPal's REST API; the secret is what makes this
 * a genuine server-to-server call PayPal can trust. */
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID
  || "ATsbP8Pn9MQbCbxeB74E2j3UNj3rjzrVlTRsvD4nbw3D0I5HM4dCCcRE6LLqNE6yN3dnMbo7MTrLd37B";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
// Test mode by default, matching the credentials currently set - flip
// PAYPAL_API_BASE to https://api-m.paypal.com (with the matching live
// client-id/secret) once ready to accept real payments.
const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

function requireConfigured() {
  if (!PAYPAL_CLIENT_SECRET) {
    throw Object.assign(
      new Error("PayPal is not configured on the server yet (PAYPAL_CLIENT_SECRET is missing)."),
      { status: 500 },
    );
  }
}

async function getAccessToken() {
  requireConfigured();
  const basicAuth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal OAuth token request failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function createOrder(usdAmount, description) {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        amount: { currency_code: "USD", value: usdAmount.toFixed(2) },
        description,
      }],
    }),
  });
  if (!res.ok) throw new Error(`PayPal create-order failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`PayPal capture failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = { createOrder, captureOrder, PAYPAL_CLIENT_ID };
