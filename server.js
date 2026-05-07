/**
 * server.js — main entry point
 * ─────────────────────────────────────────────────────────────────────────────
 * Wires together:
 *   • Express HTTP server
 *   • Socket.IO for real-time matrix state
 *   • MatrixTcpClient (Xilica TCP interface)
 *   • JWT authentication middleware
 *   • authRoutes  — login, credential management, user CRUD
 *   • matrixRoutes — switch, sync, state, settings
 */
const express         = require("express");
const http            = require("http");
const cors            = require("cors");
const { Server }      = require("socket.io");
const config          = require("./config");
const MatrixTcpClient = require("./tcpClient");
const { connectMongo, isMongoConnected } = require("./db/connect");
const persistence     = require("./services/persistence");
const authService     = require("./services/authService");
const makeAuthMw      = require("./middleware/auth");
const createAuthRoutes   = require("./routes/authRoutes");
const createMatrixRoutes = require("./routes/matrixRoutes");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: config.server.frontendOrigin, methods: ["GET", "POST"] },
});

// ── Auth middleware (shared by both route files) ──────────────────────────────
const { requireAuth, requireAdmin } = makeAuthMw(config);

let tcpClient;

// ── Express middleware ────────────────────────────────────────────────────────
app.use(cors({ origin: config.server.frontendOrigin }));
app.use(express.json());

// ── Health check (public) ─────────────────────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "hdmi-matrix-backend", mongo: isMongoConnected() })
);

// ── Mount routes ──────────────────────────────────────────────────────────────
app.use("/api/auth",
  createAuthRoutes({ config, requireAuth, requireAdmin })
);
app.use("/api",
  createMatrixRoutes({ getTcpClient: () => tcpClient, persistence, config, requireAuth, requireAdmin })
);

// ── Wire TCP → Socket.IO ──────────────────────────────────────────────────────
function wireTcpSignals() {
  tcpClient.on("stateUpdate", (payload) => {
    io.emit("matrix:update", payload);
    const s = tcpClient.getStatus();
    persistence.scheduleSaveSnapshot(tcpClient.getState(), s.lastTx, s.lastRx);
  });
  tcpClient.on("connection", (payload) => io.emit("matrix:connection", payload));
  tcpClient.on("log",        (payload) => io.emit("matrix:log", payload));
  tcpClient.on("error",      (err)     => io.emit("matrix:error", { message: err.message }));
}

// ── Send full initial state to each newly connected socket ────────────────────
io.on("connection", (socket) => {
  socket.emit("matrix:init", {
    routes:     tcpClient.getState(),
    ...tcpClient.getStatus(),
    recentRx:   tcpClient.getRxHistory(),
    recentLogs: tcpClient.getLogHistory(),
  });
});

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function start() {
  try {
    await connectMongo(config.mongo.uri);
  } catch (err) {
    console.warn("MongoDB unavailable — running without persistence:", err.message);
  }

  // Seed default users (admin/user) if not already in storage
  await authService.init();

  // Load saved TCP settings from DB (if available)
  await persistence.loadSettingsIntoMatrixConfig(config.matrix);

  // Start TCP client
  tcpClient = new MatrixTcpClient(config.matrix);
  wireTcpSignals();
  tcpClient.connect();

  server.listen(config.server.port, () => {
    console.log(`Backend running → http://localhost:${config.server.port}`);
    console.log(`Auth: POST /api/auth/login  (admin/admin123  |  user/user123)`);
  });
}

start().catch((err) => { console.error("Fatal startup error:", err); process.exit(1); });
