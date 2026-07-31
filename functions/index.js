const admin = require("firebase-admin");
admin.initializeApp();

const express = require("express");
const cors = require("cors");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");

// Bound to `api` below via the `secrets` option - that's what actually
// exposes it as process.env.PAYPAL_CLIENT_SECRET at runtime (see
// src/lib/paypalClient.js). Set the value with `firebase functions:
// secrets:set PAYPAL_CLIENT_SECRET` (prompts for it with hidden input -
// never put the actual value in code, chat, or a plain .env file that
// might get committed).
const paypalClientSecret = defineSecret("PAYPAL_CLIENT_SECRET");

const storeRoutes = require("./src/routes/store");
const adminRoutes = require("./src/routes/admin");
const paypalRoutes = require("./src/routes/paypal");
const paypalTabRoutes = require("./src/routes/paypalTab");
const { trackRequest } = require("./src/lib/stats");
const { refreshDailyRate } = require("./src/lib/paypalRate");
const { todayISO } = require("./src/lib/shared");

const app = express();

// The site lives on GitHub Pages, a different origin from this API, plus
// the local static server used for development - both need explicit CORS
// since there's no same-origin Hosting rewrite available here. Kept
// doxservices.github.io alongside the custom domain since GitHub Pages
// still serves that origin directly (it 301-redirects browsers, but a
// stale cached page or in-flight request could still originate from it).
const ALLOWED_ORIGINS = [
  "https://doxservices.github.io",
  "https://freshsnacksja.com",
  "https://www.freshsnacksja.com",
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/localhost(:\d+)?$/,
  // A page opened directly as a local file (no server) sends the literal
  // string "null" as its Origin - only real file:// pages can send this
  // (no ordinary web page can spoof it), so allowing it just enables
  // testing standalone demo pages (e.g. paypal-clear-tab-demo.html)
  // straight off disk without weakening the allow-list for anything else.
  "null",
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin))) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
}));
// 20mb to accommodate base64-encoded catalog image uploads (see
// src/routes/admin.js's /snacks/:id/image) - everything else is tiny.
app.use(express.json({ limit: "20mb" }));

// Rough usage tracking for the Stats page - see src/lib/stats.js for what
// this does and doesn't measure. Placed after CORS/json parsing so a
// preflight OPTIONS request (which `cors` already answers and ends above)
// is never double-counted here.
app.use((req, res, next) => {
  trackRequest(req.method);
  next();
});

app.use("/store", storeRoutes);
app.use("/admin", adminRoutes);
app.use("/paypal", paypalRoutes);
app.use("/paypal/tab", paypalTabRoutes);

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    error: err.message || "Internal error.",
    ...(err.code ? { code: err.code } : {}),
    ...(err.currentStatus ? { currentStatus: err.currentStatus } : {}),
  });
});

// CORS is handled by the `cors` middleware above (origin allow-list), not
// here - the v2 `cors` option would layer a second, less precise handler
// on top and risks duplicate/conflicting Access-Control-Allow-Origin headers.
// `secrets` is what makes PAYPAL_CLIENT_SECRET available to this function
// at all - without it, process.env.PAYPAL_CLIENT_SECRET is undefined here
// even after the secret has been set, since Cloud Functions only injects
// a secret into the specific functions that declare they need it.
exports.api = onRequest({ region: "us-central1", secrets: [paypalClientSecret] }, app);

// Generates and locks in the day's JMD->USD PayPal conversion rate once,
// server-side, before anyone's checkout can read it - see
// src/lib/paypalRate.js for why this exists instead of trusting a rate
// from the client. 00:05 America/Jamaica so it's ready before the first
// customer of the day, comfortably past midnight rollover.
exports.refreshPaypalRate = onSchedule(
  { schedule: "5 0 * * *", timeZone: "America/Jamaica", region: "us-central1" },
  async () => {
    await refreshDailyRate(todayISO());
  },
);
