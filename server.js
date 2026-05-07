// /**
//  * server.js — main entry point
//  * ─────────────────────────────────────────────────────────────────────────────
//  * Wires together:
//  *   • Express HTTP server
//  *   • Socket.IO for real-time matrix state
//  *   • MatrixTcpClient (Xilica TCP interface)
//  *   • JWT authentication middleware
//  *   • authRoutes  — login, credential management, user CRUD
//  *   • matrixRoutes — switch, sync, state, settings
//  */
// const express         = require("express");
// const http            = require("http");
// const cors            = require("cors");
// const { Server }      = require("socket.io");
// const config          = require("./config");
// const MatrixTcpClient = require("./tcpClient");
// const { connectMongo, isMongoConnected } = require("./db/connect");
// const persistence     = require("./services/persistence");
// const authService     = require("./services/authService");
// const makeAuthMw      = require("./middleware/auth");
// const createAuthRoutes   = require("./routes/authRoutes");
// const createMatrixRoutes = require("./routes/matrixRoutes");

// const app    = express();
// const server = http.createServer(app);
// const io     = new Server(server, {
//   cors: { origin: config.server.frontendOrigin, methods: ["GET", "POST"] },
// });

// // ── Auth middleware (shared by both route files) ──────────────────────────────
// const { requireAuth, requireAdmin } = makeAuthMw(config);

// let tcpClient;

// // ── Express middleware ────────────────────────────────────────────────────────
// app.use(cors({ origin: config.server.frontendOrigin }));
// app.use(express.json());

// // ── Health check (public) ─────────────────────────────────────────────────────
// app.get("/health", (_req, res) =>
//   res.json({ ok: true, service: "hdmi-matrix-backend", mongo: isMongoConnected() })
// );

// // ── Mount routes ──────────────────────────────────────────────────────────────
// app.use("/api/auth",
//   createAuthRoutes({ config, requireAuth, requireAdmin })
// );
// app.use("/api",
//   createMatrixRoutes({ getTcpClient: () => tcpClient, persistence, config, requireAuth, requireAdmin })
// );

// // ── Wire TCP → Socket.IO ──────────────────────────────────────────────────────
// function wireTcpSignals() {
//   tcpClient.on("stateUpdate", (payload) => {
//     io.emit("matrix:update", payload);
//     const s = tcpClient.getStatus();
//     persistence.scheduleSaveSnapshot(tcpClient.getState(), s.lastTx, s.lastRx);
//   });
//   tcpClient.on("connection", (payload) => io.emit("matrix:connection", payload));
//   tcpClient.on("log",        (payload) => io.emit("matrix:log", payload));
//   tcpClient.on("error",      (err)     => io.emit("matrix:error", { message: err.message }));
// }

// // ── Send full initial state to each newly connected socket ────────────────────
// io.on("connection", (socket) => {
//   socket.emit("matrix:init", {
//     routes:     tcpClient.getState(),
//     ...tcpClient.getStatus(),
//     recentRx:   tcpClient.getRxHistory(),
//     recentLogs: tcpClient.getLogHistory(),
//   });
// });

// // ── Boot sequence ─────────────────────────────────────────────────────────────
// async function start() {
//   try {
//     await connectMongo(config.mongo.uri);
//   } catch (err) {
//     console.warn("MongoDB unavailable — running without persistence:", err.message);
//   }

//   // Seed default users (admin/user) if not already in storage
//   await authService.init();

//   // Load saved TCP settings from DB (if available)
//   await persistence.loadSettingsIntoMatrixConfig(config.matrix);

//   // Start TCP client
//   tcpClient = new MatrixTcpClient(config.matrix);
//   wireTcpSignals();
//   tcpClient.connect();

//   server.listen(config.server.port, () => {
//     console.log(`Backend running → http://localhost:${config.server.port}`);
//     console.log(`Auth: POST /api/auth/login  (admin/admin123  |  user/user123)`);
//   });
// }

// start().catch((err) => { console.error("Fatal startup error:", err); process.exit(1); });
// //


// ------------------------------------------------------------------------------------------------


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
 *
 * FIX SUMMARY:
 *   1. Added root GET "/" route  →  fixes "Cannot GET /"
 *   2. Added proper health-check at GET "/health"  →  required by Render
 *   3. PORT now reads from process.env.PORT (Render injects this)
 *   4. CORS now accepts both localhost dev and the real frontend origin
 *   5. Global 404 handler for unknown routes
 *   6. Global error handler to avoid unhandled crash on API errors
 */

require("dotenv").config(); // Load .env before anything else

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

// ── PORT: Render injects process.env.PORT automatically ──────────────────────
// ALWAYS use process.env.PORT in production — never hardcode.
const PORT = process.env.PORT || "https://matrix88.onrender.com";

// ── CORS: allow both local dev and production frontend ───────────────────────
// Add your actual Render/Vercel/Netlify frontend URL here.
const allowedOrigins = [
  "http://localhost:5173",          // Vite dev server
  "http://localhost:3000",          // CRA dev server
  process.env.FRONTEND_ORIGIN,     // e.g. https://your-app.vercel.app
].filter(Boolean); // Remove undefined entries

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (Postman, curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: origin ${origin} not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ── Auth middleware (shared by both route files) ──────────────────────────────
const { requireAuth, requireAdmin } = makeAuthMw(config);

let tcpClient;

// ── Express middleware ────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── FIX #1: Root route "GET /" ────────────────────────────────────────────────
// This is what was MISSING — the browser opens this URL first.
// Without it, Express returns "Cannot GET /" even though all other APIs work.
app.get("/", (_req, res) => {
  res.json({
    service: "hdmi-matrix-backend",
    version: "2.0.0",
    status: "running",
    mongo: isMongoConnected(),
    message: "Backend is up! Use /api/* endpoints.",
    endpoints: {
      health:    "GET  /health",
      login:     "POST /api/auth/login",
      matrixState: "GET /api/state",
    },
  });
});

// ── FIX #2: Proper health-check route ────────────────────────────────────────
// Render uses this to decide if your service is healthy.
// Configure in Render dashboard: Health Check Path = /health
app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "hdmi-matrix-backend",
    mongo: isMongoConnected(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── Mount routes ──────────────────────────────────────────────────────────────
app.use("/api/auth",
  createAuthRoutes({ config, requireAuth, requireAdmin })
);
app.use("/api",
  createMatrixRoutes({ getTcpClient: () => tcpClient, persistence, config, requireAuth, requireAdmin })
);

// ── 404 handler — catches any unknown route ───────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Global error handler — prevents unhandled crashes ────────────────────────
// Must have exactly 4 parameters for Express to treat it as error middleware.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);

  // CORS errors
  if (err.message && err.message.startsWith("CORS blocked")) {
    return res.status(403).json({ error: err.message });
  }

  res.status(500).json({ error: "Internal server error" });
});

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

  // FIX #3: Use PORT variable (reads process.env.PORT for Render)
  server.listen(PORT, () => {
    console.log(`Backend running → ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`Auth: POST /api/auth/login  (admin/admin123  |  user/user123)`);
  });
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
