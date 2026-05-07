/**
 * routes/matrixRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes here are protected by requireAuth (any logged-in user can read
 * state and switch routes). Writes that affect device config are admin-only.
 *
 * Routes:
 *   GET  /api/state        (auth)        — full matrix state + log history
 *   GET  /api/settings     (admin)       — TCP config
 *   POST /api/settings     (admin)       — save TCP config + reconnect
 *   POST /api/switch       (auth)        — switch ONE input → ONE output
 *   POST /api/switch-multi (auth)        — switch ONE input → MULTIPLE outputs (ALL fix)
 *   POST /api/sync-all     (auth)        — query all 8 outputs for state
 *   POST /api/feedback     (auth)        — query a single output
 */
const express = require("express");
const { isMongoConnected } = require("../db/connect");

const isValidPort = (v) => Number.isInteger(v) && v >= 1 && v <= 8;

module.exports = ({ getTcpClient, persistence, config, requireAuth, requireAdmin }) => {
  const router = express.Router();

  // ── GET /api/state ───────────────────────────────────────────────────────
  router.get("/state", requireAuth, (_req, res) => {
    const client = getTcpClient();
    const status = client.getStatus();
    return res.status(200).json({
      connected:  status.connected,
      routes:     client.getState(),
      lastTx:     status.lastTx,
      lastRx:     status.lastRx,
      recentRx:   client.getRxHistory(),   // RX-only history
      recentLogs: client.getLogHistory(),  // full log history
    });
  });

  // ── GET /api/settings (admin only) ───────────────────────────────────────
  router.get("/settings", requireAdmin, async (_req, res) => {
    const data = await persistence.getSettingsForApi(config.matrix);
    return res.status(200).json({
      ok: true, mongoConnected: isMongoConnected(), mongo: data.persisted !== false, ...data,
    });
  });

  // ── POST /api/settings (admin only) ──────────────────────────────────────
  router.post("/settings", requireAdmin, async (req, res) => {
    const saved = await persistence.saveSettings(req.body);
    if (!saved.ok) return res.status(503).json(saved);

    const ip          = String(req.body.matrixIp || "").trim();
    const port        = Number(req.body.matrixPort);
    const reconnectMs = Number(req.body.reconnectMs);
    const timeoutMs   = Number(req.body.timeoutMs);

    Object.assign(config.matrix, {
      ip,
      port:        Number.isFinite(port)        ? port        : config.matrix.port,
      reconnectMs: Number.isFinite(reconnectMs) ? reconnectMs : config.matrix.reconnectMs,
      timeoutMs:   Number.isFinite(timeoutMs)   ? timeoutMs   : config.matrix.timeoutMs,
    });

    getTcpClient().reconfigure({ ip: config.matrix.ip, port: config.matrix.port, reconnectMs: config.matrix.reconnectMs });
    return res.status(200).json({ ok: true, message: "Settings saved; reconnecting TCP." });
  });

  // ── POST /api/switch (any logged-in user) ────────────────────────────────
  router.post("/switch", requireAuth, (req, res) => {
    try {
      const input  = Number(req.body.input);
      const output = Number(req.body.output);
      if (!isValidPort(input) || !isValidPort(output))
        return res.status(400).json({ error: "input and output must be 1–8" });

      getTcpClient().switchRoute(input, output);
      return res.status(200).json({ ok: true, message: `Switch queued: IN${input} → OUT${output}` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/switch-multi — route one input to MULTIPLE outputs.
   * ─────────────────────────────────────────────────────────────────────────
   * FIX: instead of firing N parallel /switch requests from the frontend
   * (which caused the device to drop commands — specifically display 3),
   * we now send a single request with all outputs and stagger the TCP
   * commands here at 300ms intervals. This guarantees all 8 outputs are
   * reached without any being dropped.
   *
   * Body: { input: 2, outputs: [1,2,3,4,5,6,7,8] }
   */
  router.post("/switch-multi", requireAuth, (req, res) => {
    try {
      const input   = Number(req.body.input);
      const outputs = Array.isArray(req.body.outputs) ? req.body.outputs.map(Number) : [];

      if (!isValidPort(input))
        return res.status(400).json({ error: "input must be 1–8" });
      if (!outputs.length || outputs.some((o) => !isValidPort(o)))
        return res.status(400).json({ error: "outputs must be an array of values 1–8" });

      // Staggered switching — fixes Display 3 drop bug
      getTcpClient().switchMultiple(input, outputs);
      return res.status(200).json({
        ok:      true,
        message: `Switch queued: IN${input} → OUT[${outputs.join(",")}]`,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/sync-all ───────────────────────────────────────────────────
  router.post("/sync-all", requireAuth, (_req, res) => {
    try {
      const client = getTcpClient();
      if (!client.isConnected) return res.status(503).json({ error: "Matrix device not connected" });
      client.syncAllOutputs();
      return res.status(200).json({ ok: true, message: "Sync queued: GET MP for OUT1–OUT8" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/feedback ───────────────────────────────────────────────────
  router.post("/feedback", requireAuth, (req, res) => {
    try {
      const output = Number(req.body.output);
      if (!isValidPort(output)) return res.status(400).json({ error: "output must be 1–8" });
      getTcpClient().queryOutput(output);
      return res.status(200).json({ ok: true, message: `GET MP queued for OUT${output}` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
};
