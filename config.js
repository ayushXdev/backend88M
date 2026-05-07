// config.js — central configuration loaded from .env
const path   = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, ".env") });

const toNum = (v, fallback) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };

module.exports = {
  matrix: {
    ip:          process.env.MATRIX_IP            || "192.168.1.37",
    port:        toNum(process.env.MATRIX_PORT,     23),
    reconnectMs: toNum(process.env.MATRIX_RECONNECT_MS, 3000),
    timeoutMs:   toNum(process.env.MATRIX_TIMEOUT_MS,   1000),
  },
  mongo: {
    uri: process.env.MONGODB_URI || "",
  },
  server: {
    port:           toNum(process.env.SERVER_PORT, "https://matrix88.onrender.com"),
    frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  },
  auth: {
    // Change JWT_SECRET in production via .env
    jwtSecret:    process.env.JWT_SECRET   || "matrix08_jwt_secret_CHANGE_IN_PROD",
    jwtExpiresIn: process.env.JWT_EXPIRES  || "8h",
  },
};
