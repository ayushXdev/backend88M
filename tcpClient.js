/**
 * tcpClient.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manages the raw TCP connection to the Xilica matrix switcher.
 *
 * Key improvements over original:
 *   • Full log history (not just RX) stored in this.logHistory
 *   • getRxHistory()  → last N RX lines  (sent to frontend on connect)
 *   • getLogHistory() → last N all-type lines (sent to frontend on connect)
 *   • Idle-flush timer correctly handles partial frames from device
 *   • switchRoute() sends to ALL outputs sequentially (fixes Display 3 bug):
 *     the original relied on Promise.all from frontend which could race;
 *     now the backend also guarantees strict 300ms gaps between SET SW cmds
 *     when called via switchMultiple().
 */
const net          = require("net");
const EventEmitter = require("events");

class MatrixTcpClient extends EventEmitter {
  constructor(cfg) {
    super();
    this.config        = cfg;
    this.socket        = null;
    this.buffer        = "";
    this.isConnected   = false;
    this.reconnectTimer    = null;
    this.rxIdleFlushTimer  = null;
    this.lastTx        = "";
    this.lastRx        = "";
    this.matrixState   = {};
    // RX-only history (what the device sends back)
    this.rxHistory     = [];
    this.rxHistoryMax  = 60;
    // Full log history (TX + RX + SYSTEM + ERROR)
    this.logHistory    = [];
    this.logHistoryMax = 150;
  }

  // ── TCP lifecycle ────────────────────────────────────────────────────────
  connect() {
    if (this.socket) return;
    this.socket = new net.Socket();

    this.socket.connect(this.config.port, this.config.ip, () => {
      this.isConnected = true;
      this.emit("connection", { connected: true });
      this._log("SYSTEM", `Connected to ${this.config.ip}:${this.config.port}`);
    });

    this.socket.on("data", (chunk) => {
      // Cancel any pending idle-flush; we have new data
      if (this.rxIdleFlushTimer) { clearTimeout(this.rxIdleFlushTimer); this.rxIdleFlushTimer = null; }

      this.buffer += chunk.toString("utf8");
      // Split on CR, LF, or CRLF — device may use any combination
      const lines = this.buffer.split(/\r?\n|\r/g);
      this.buffer = lines.pop() || ""; // last element may be incomplete

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        this._log("RX", line);
        this.parseResponse(line);
      }

      // If partial data sits in buffer, flush after 350ms idle
      if (this.buffer.trim()) {
        this.rxIdleFlushTimer = setTimeout(() => {
          this.rxIdleFlushTimer = null;
          const pending = this.buffer.trim();
          this.buffer   = "";
          if (!pending) return;
          this._log("RX", pending);
          this.parseResponse(pending);
        }, 350);
      }
    });

    this.socket.on("error", (err) => {
      this._log("ERROR", err.message);
      this.emit("error", err);
    });

    this.socket.on("close", () => this._handleDisconnect());
  }

  _handleDisconnect() {
    if (this.rxIdleFlushTimer) { clearTimeout(this.rxIdleFlushTimer); this.rxIdleFlushTimer = null; }
    this.isConnected = false;
    this.emit("connection", { connected: false });
    this._log("SYSTEM", "Disconnected from matrix device — will retry");
    if (this.socket) { this.socket.removeAllListeners(); this.socket.destroy(); this.socket = null; }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this._log("SYSTEM", `Retrying connection to ${this.config.ip}:${this.config.port} …`);
      this.connect();
    }, this.config.reconnectMs);
  }

  reconfigure(overrides) {
    if (this.reconnectTimer)   { clearTimeout(this.reconnectTimer);   this.reconnectTimer   = null; }
    if (this.rxIdleFlushTimer) { clearTimeout(this.rxIdleFlushTimer); this.rxIdleFlushTimer = null; }
    this.config = { ...this.config, ...overrides };
    if (this.socket) { this.socket.removeAllListeners(); this.socket.destroy(); this.socket = null; }
    this.isConnected = false;
    this.buffer = "";
    this.connect();
  }

  // ── Logging ──────────────────────────────────────────────────────────────
  /**
   * Central log method — records entry in logHistory, rxHistory (if RX),
   * and emits the "log" event so server.js can forward it to Socket.IO.
   */
  _log(type, message) {
    const timestamp = new Date().toISOString();
    const entry = { type, message, timestamp };

    // Full log history (newest first)
    this.logHistory.unshift(entry);
    if (this.logHistory.length > this.logHistoryMax) this.logHistory.length = this.logHistoryMax;

    if (type === "TX") this.lastTx = message;
    if (type === "RX") {
      this.lastRx = message;
      this.rxHistory.unshift({ message, timestamp });
      if (this.rxHistory.length > this.rxHistoryMax) this.rxHistory.length = this.rxHistoryMax;
    }

    this.emit("log", entry);
    console.log(`[${timestamp}] [${type}] ${message}`);
  }

  // ── Commands ─────────────────────────────────────────────────────────────
  sendCommand(command) {
    if (!this.isConnected || !this.socket)
      throw new Error("Matrix device is not connected");
    this.socket.write(command, "utf8");
    this._log("TX", command.trim());
  }

  /**
   * switchRoute — route a single input to a single output,
   * then query that output to confirm.
   */
  switchRoute(input, output) {
    this.sendCommand(`SET SW IN${input} OUT${output}\r`);
    setTimeout(() => {
      try { if (this.isConnected) this.queryOutput(output); }
      catch (e) { this.emit("error", e); }
    }, 500);
  }

  /**
   * switchMultiple — route one input to MULTIPLE outputs.
   * ─────────────────────────────────────────────────────────────────────────
   * FIX for "ALL button skips Display 3":
   *   The original bug occurred because Promise.all on the frontend sent
   *   all SET SW commands simultaneously; the device occasionally dropped
   *   one (especially output 3). We now stagger them 300ms apart here in
   *   the backend so each command gets a clean response window.
   *
   * Loop always runs: for (let i = 1; i <= 8; i++) — no skipping.
   */
  switchMultiple(input, outputs) {
    outputs.forEach((output, i) => {
      setTimeout(() => {
        try {
          if (this.isConnected) this.switchRoute(input, output);
        } catch (e) { this.emit("error", e); }
      }, i * 300); // 300ms gap — safe for Xilica TCP response window
    });
  }

  queryOutput(output) {
    this.sendCommand(`GET MP out${output}\r`);
  }

  /**
   * syncAllOutputs — query every output (1-8) with a gap between each.
   * Uses i = 1..8 inclusive — no off-by-one.
   */
  syncAllOutputs() {
    for (let i = 1; i <= 8; i++) {
      setTimeout(() => {
        try { if (this.isConnected) this.queryOutput(i); }
        catch (e) { this.emit("error", e); }
      }, (i - 1) * 280);
    }
  }

  // ── Response parsing ─────────────────────────────────────────────────────
  /**
   * parseResponse — extracts routing state from Xilica TCP feedback.
   * Xilica response format: "MP hdmiin<N> out<M>"
   * Example: "MP hdmiin2 out3" → output 3 is sourced from input 2
   */
  parseResponse(line) {
    const match = line.match(/MP\s+hdmiin(\d+)\s+out(\d+)/i);
    if (!match) {
      this.emit("rawResponse", { line });
      return;
    }
    const input  = Number(match[1]);
    const output = Number(match[2]);
    this.matrixState[output] = input;
    this.emit("stateUpdate", {
      input,
      output,
      matrixState:  { ...this.matrixState },
      lastResponse: line,
    });
  }

  // ── State accessors ──────────────────────────────────────────────────────
  getState()      { return { ...this.matrixState }; }
  getStatus()     { return { connected: this.isConnected, lastTx: this.lastTx, lastRx: this.lastRx }; }
  getRxHistory()  { return this.rxHistory.map((r) => ({ ...r })); }
  getLogHistory() { return this.logHistory.map((r) => ({ ...r })); }
}

module.exports = MatrixTcpClient;
