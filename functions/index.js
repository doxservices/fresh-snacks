const admin = require("firebase-admin");
admin.initializeApp();

const express = require("express");
const cors = require("cors");
const { onRequest } = require("firebase-functions/v2/https");

const storeRoutes = require("./src/routes/store");
const adminRoutes = require("./src/routes/admin");

const app = express();

// The site lives on GitHub Pages, a different origin from this API, plus
// the local static server used for development - both need explicit CORS
// since there's no same-origin Hosting rewrite available here.
const ALLOWED_ORIGINS = [
  "https://doxservices.github.io",
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/localhost(:\d+)?$/,
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

app.use("/store", storeRoutes);
app.use("/admin", adminRoutes);

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || "Internal error." });
});

// CORS is handled by the `cors` middleware above (origin allow-list), not
// here - the v2 `cors` option would layer a second, less precise handler
// on top and risks duplicate/conflicting Access-Control-Allow-Origin headers.
exports.api = onRequest({ region: "us-central1" }, app);
