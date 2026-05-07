const { isMongoConnected } = require("../db/connect");
const AppSettings = require("../models/AppSettings");
const MatrixSnapshot = require("../models/MatrixSnapshot");

let snapshotTimer = null;

async function loadSettingsIntoMatrixConfig(matrixConfig) {
  if (!isMongoConnected()) return null;
  try {
    const doc = await AppSettings.findById("default").lean();
    if (!doc) return null;
    if (doc.matrixIp) matrixConfig.ip = doc.matrixIp;
    if (Number.isFinite(doc.matrixPort)) matrixConfig.port = doc.matrixPort;
    if (Number.isFinite(doc.reconnectMs)) matrixConfig.reconnectMs = doc.reconnectMs;
    if (Number.isFinite(doc.timeoutMs)) matrixConfig.timeoutMs = doc.timeoutMs;
    return doc;
  } catch (err) {
    console.error("MongoDB load settings:", err.message);
    return null;
  }
}

async function getSettingsForApi(defaults) {
  if (!isMongoConnected()) {
    return {
      matrixIp: defaults.ip,
      matrixPort: defaults.port,
      reconnectMs: defaults.reconnectMs,
      timeoutMs: defaults.timeoutMs ?? 1000,
      persisted: false,
    };
  }
  try {
    const doc = await AppSettings.findById("default").lean();
    if (!doc) {
      return {
        matrixIp: defaults.ip,
        matrixPort: defaults.port,
        reconnectMs: defaults.reconnectMs,
        timeoutMs: defaults.timeoutMs ?? 1000,
        persisted: false,
      };
    }
    return {
      matrixIp: doc.matrixIp || defaults.ip,
      matrixPort: doc.matrixPort ?? defaults.port,
      reconnectMs: doc.reconnectMs ?? defaults.reconnectMs,
      timeoutMs: doc.timeoutMs ?? defaults.timeoutMs ?? 1000,
      persisted: true,
      updatedAt: doc.updatedAt,
    };
  } catch (err) {
    console.error("MongoDB get settings:", err.message);
    return {
      matrixIp: defaults.ip,
      matrixPort: defaults.port,
      reconnectMs: defaults.reconnectMs,
      timeoutMs: defaults.timeoutMs ?? 1000,
      persisted: false,
    };
  }
}

async function saveSettings(body) {
  if (!isMongoConnected()) {
    return { ok: false, error: "MongoDB not connected" };
  }
  const update = {
    matrixIp: String(body.matrixIp || "").trim(),
    matrixPort: Number(body.matrixPort),
    reconnectMs: Number(body.reconnectMs),
    timeoutMs: Number(body.timeoutMs),
  };
  if (!update.matrixIp) {
    return { ok: false, error: "matrixIp required" };
  }
  if (!Number.isFinite(update.matrixPort)) {
    return { ok: false, error: "matrixPort invalid" };
  }
  await AppSettings.findByIdAndUpdate(
    "default",
    { $set: update },
    { upsert: true, new: true }
  );
  return { ok: true };
}

function scheduleSaveSnapshot(routes, lastTx, lastRx) {
  if (!isMongoConnected()) return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(async () => {
    snapshotTimer = null;
    try {
      await MatrixSnapshot.findByIdAndUpdate(
        "current",
        {
          $set: {
            routes: { ...routes },
            lastTx: lastTx || "",
            lastRx: lastRx || "",
          },
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      console.error("MongoDB snapshot:", err.message);
    }
  }, 800);
}

async function getLastSnapshot() {
  if (!isMongoConnected()) return null;
  try {
    return await MatrixSnapshot.findById("current").lean();
  } catch {
    return null;
  }
}

module.exports = {
  loadSettingsIntoMatrixConfig,
  getSettingsForApi,
  saveSettings,
  scheduleSaveSnapshot,
  getLastSnapshot,
};
