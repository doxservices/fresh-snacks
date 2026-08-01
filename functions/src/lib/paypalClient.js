/* Server-side PayPal REST client factory - order creation and capture both
 * happen here, never in the browser. The client-side page only ever renders
 * PayPal's Buttons and asks this server "give me an order for my current
 * balance" / "capture this approved order" - it never constructs the
 * order object or the charge amount itself, so there's nothing about the
 * amount a tampered front end could change.
 *
 * Two separate instances are built from this (see paypalClientLive.js /
 * paypalClientSandbox.js) so the real customer-facing feature and the
 * standalone test page can never share credentials - going live on one
 * must not silently turn the other into a real-money page too. */
function createPaypalClient({ clientId, clientSecret, apiBase, label }) {
  function requireConfigured() {
    if (!clientSecret) {
      throw Object.assign(
        new Error(`PayPal (${label}) is not configured on the server yet - its secret is missing.`),
        { status: 500 },
      );
    }
  }

  async function getAccessToken() {
    requireConfigured();
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal (${label}) OAuth token request failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.access_token;
  }

  async function createOrder(usdAmount, description) {
    const token = await getAccessToken();
    const res = await fetch(`${apiBase}/v2/checkout/orders`, {
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
    if (!res.ok) throw new Error(`PayPal (${label}) create-order failed: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  }

  async function captureOrder(orderId) {
    const token = await getAccessToken();
    const res = await fetch(`${apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`PayPal (${label}) capture failed: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  }

  return { createOrder, captureOrder, clientId };
}

module.exports = { createPaypalClient };
