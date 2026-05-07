const mongoose = require("mongoose");

const appSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "default" },
    matrixIp: { type: String, default: "" },
    matrixPort: { type: Number, default: 23 },
    reconnectMs: { type: Number, default: 3000 },
    timeoutMs: { type: Number, default: 1000 },
  },
  { timestamps: true, collection: "app_settings" }
);

module.exports =
  mongoose.models.AppSettings || mongoose.model("AppSettings", appSettingsSchema);
