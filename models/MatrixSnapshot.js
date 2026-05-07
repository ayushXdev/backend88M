const mongoose = require("mongoose");

const matrixSnapshotSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "current" },
    routes: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastTx: { type: String, default: "" },
    lastRx: { type: String, default: "" },
  },
  { timestamps: true, collection: "matrix_snapshots" }
);

module.exports =
  mongoose.models.MatrixSnapshot ||
  mongoose.model("MatrixSnapshot", matrixSnapshotSchema);
