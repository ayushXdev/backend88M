/**
 * Ensures default MongoDB documents exist. Run: node scripts/mongoInit.js
 * Requires MONGODB_URI in .env
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const AppSettings = require("../models/AppSettings");
const MatrixSnapshot = require("../models/MatrixSnapshot");

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI in backend/.env");
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri);
  await AppSettings.findByIdAndUpdate(
    "default",
    {
      $setOnInsert: {
        matrixIp: process.env.MATRIX_IP || "192.168.1.100",
        matrixPort: Number(process.env.MATRIX_PORT) || 23,
        reconnectMs: Number(process.env.MATRIX_RECONNECT_MS) || 3000,
        timeoutMs: Number(process.env.MATRIX_TIMEOUT_MS) || 1000,
      },
    },
    { upsert: true }
  );
  await MatrixSnapshot.findByIdAndUpdate(
    "current",
    { $setOnInsert: { routes: {}, lastTx: "", lastRx: "" } },
    { upsert: true }
  );
  console.log("MongoDB init: default app_settings + matrix_snapshots ready.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
