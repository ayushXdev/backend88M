/**
 * routes/authRoutes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Public:
 *   POST /api/auth/login          — returns JWT + role
 *
 * Protected (requireAuth):
 *   POST /api/auth/change-password — admin can update own credentials
 *   GET  /api/auth/me              — returns current user info
 *
 * Protected (requireAdmin):
 *   GET    /api/auth/users         — list all users
 *   POST   /api/auth/users         — create/update a user
 *   DELETE /api/auth/users/:uname  — delete a user
 */
const express     = require("express");
const authService = require("../services/authService");

module.exports = ({ config, requireAuth, requireAdmin }) => {
  const router = express.Router();

  // ── POST /api/auth/login ─────────────────────────────────────────────────
  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const result = await authService.verifyCredentials(username, password);
      if (!result.ok) return res.status(401).json({ error: result.error });

      const token = authService.signToken(result.user, config);
      return res.status(200).json({
        ok:       true,
        token,
        username: result.user.username,
        role:     result.user.role,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  router.get("/me", requireAuth, (req, res) => {
    return res.status(200).json({ ok: true, username: req.user.username, role: req.user.role });
  });

  // ── POST /api/auth/change-password — admin changes own credentials ───────
  router.post("/change-password", requireAdmin, async (req, res) => {
    try {
      const { currentPassword, newUsername, newPassword } = req.body;
      if (!currentPassword) return res.status(400).json({ error: "currentPassword required" });
      if (newPassword && newPassword.length < 4)
        return res.status(400).json({ error: "New password must be ≥ 4 characters" });

      const result = await authService.updateCredentials({
        adminUsername:   req.user.username,
        currentPassword,
        newUsername,
        newPassword,
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      return res.status(200).json({ ok: true, username: result.username, message: "Credentials updated" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/auth/users — list users (admin only) ────────────────────────
  router.get("/users", requireAdmin, async (_req, res) => {
    try {
      const users = await authService.listUsers();
      return res.status(200).json({ ok: true, users });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/auth/users — upsert a user (admin only) ───────────────────
  router.post("/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, role } = req.body;
      const result = await authService.upsertUser({ username, password, role });
      if (!result.ok) return res.status(400).json({ error: result.error });
      return res.status(200).json({ ok: true, message: "User saved" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/auth/users/:uname — delete a user (admin only) ──────────
  router.delete("/users/:uname", requireAdmin, async (req, res) => {
    try {
      const result = await authService.deleteUser({
        username:           req.params.uname,
        requestorUsername:  req.user.username,
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      return res.status(200).json({ ok: true, message: "User deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
};
