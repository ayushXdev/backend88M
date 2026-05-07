/**
 * middleware/auth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * requireAuth   — verifies JWT; attaches req.user = { username, role }
 * requireAdmin  — same as above + enforces role === "admin"
 *
 * The JWT is sent by the frontend in the Authorization header:
 *   Authorization: Bearer <token>
 */
const jwt = require("jsonwebtoken");

function extractToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

function makeAuthMiddleware(config) {
  /**
   * requireAuth — any logged-in user (admin or user role)
   */
  function requireAuth(req, res, next) {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Authentication required" });

    try {
      req.user = jwt.verify(token, config.auth.jwtSecret);
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  }

  /**
   * requireAdmin — only role === "admin"
   */
  function requireAdmin(req, res, next) {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Authentication required" });

    try {
      const decoded = jwt.verify(token, config.auth.jwtSecret);
      if (decoded.role !== "admin")
        return res.status(403).json({ error: "Admin access required" });
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  }

  return { requireAuth, requireAdmin };
}

module.exports = makeAuthMiddleware;
