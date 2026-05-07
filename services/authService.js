/**
 * services/authService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles credentials with two storage backends:
 *   • MongoDB (when connected) — via the User model with bcrypt pre-save hook
 *   • JSON file fallback       — data/users.json (bcrypt hashes inline)
 *
 * Default accounts seeded on first start:
 *   admin / admin123  (role: admin)
 *   user  / user123   (role: user)
 */
const fs     = require("fs");
const path   = require("path");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const { isMongoConnected } = require("../db/connect");

const DATA_FILE   = path.join(__dirname, "../data/users.json");
const SALT_ROUNDS = 12;

// ─── Default seed data (plain passwords; hashed before storage) ──────────────
const DEFAULTS = [
  { username: "admin", password: "admin123", role: "admin" },
  { username: "user",  password: "user123",  role: "user"  },
];

// ──────────────────────────────────────────────────────────────────────────────
// FILE-BASED HELPERS
// ──────────────────────────────────────────────────────────────────────────────
function ensureDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function readFile() {
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return null; }
}
function writeFile(users) {
  ensureDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf8");
}
async function seedFile() {
  const hashed = await Promise.all(
    DEFAULTS.map(async (u) => ({
      username:     u.username,
      passwordHash: await bcrypt.hash(u.password, SALT_ROUNDS),
      role:         u.role,
    }))
  );
  writeFile(hashed);
  return hashed;
}
async function getFileUsers() {
  const users = readFile();
  return users || (await seedFile());
}

// ──────────────────────────────────────────────────────────────────────────────
// MONGODB HELPERS  (lazy-require to avoid import errors when Mongo is off)
// ──────────────────────────────────────────────────────────────────────────────
let _UserModel = null;
function UserModel() {
  if (!_UserModel) _UserModel = require("../models/User");
  return _UserModel;
}

async function seedMongo() {
  const M = UserModel();
  for (const u of DEFAULTS) {
    if (!(await M.findById(u.username))) {
      await new M({ _id: u.username, username: u.username, password: u.password, role: u.role }).save();
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────────────────────────────────────

/** Call once at server startup to seed default users */
async function init() {
  if (isMongoConnected()) {
    await seedMongo();
    console.log("[Auth] MongoDB user store initialised");
  } else {
    await getFileUsers();
    console.log("[Auth] File-based user store initialised (data/users.json)");
  }
}

/**
 * Verify credentials.
 * Returns: { ok: true, user: { username, role } } | { ok: false, error }
 */
async function verifyCredentials(username, password) {
  if (!username || !password) return { ok: false, error: "Username and password required" };
  const u = username.trim();

  if (isMongoConnected()) {
    const doc = await UserModel().findById(u);
    if (!doc) return { ok: false, error: "Invalid credentials" };
    const ok = await doc.verifyPassword(password);
    if (!ok)  return { ok: false, error: "Invalid credentials" };
    return { ok: true, user: { username: doc.username, role: doc.role } };
  }

  const users = await getFileUsers();
  const found = users.find((x) => x.username === u);
  if (!found) return { ok: false, error: "Invalid credentials" };
  const ok = await bcrypt.compare(password, found.passwordHash);
  if (!ok)    return { ok: false, error: "Invalid credentials" };
  return { ok: true, user: { username: found.username, role: found.role } };
}

/**
 * Update the calling admin's own username / password.
 * currentPassword must be verified first.
 */
async function updateCredentials({ adminUsername, currentPassword, newUsername, newPassword }) {
  const check = await verifyCredentials(adminUsername, currentPassword);
  if (!check.ok)             return { ok: false, error: check.error };
  if (check.user.role !== "admin") return { ok: false, error: "Admin access required" };

  const target = (newUsername || "").trim() || adminUsername;
  if (!target) return { ok: false, error: "Username cannot be empty" };

  if (isMongoConnected()) {
    const M    = UserModel();
    const user = await M.findById(adminUsername);
    if (!user) return { ok: false, error: "User not found" };

    if (target !== adminUsername) {
      if (await M.findById(target)) return { ok: false, error: "Username already taken" };
      const nd = new M({ _id: target, username: target,
                         password: newPassword || currentPassword, role: user.role });
      await nd.save();
      await M.deleteOne({ _id: adminUsername });
    } else if (newPassword) {
      user.password = newPassword;
      await user.save();
    }
    return { ok: true, username: target };
  }

  // File fallback
  const users = await getFileUsers();
  const idx   = users.findIndex((x) => x.username === adminUsername);
  if (idx === -1) return { ok: false, error: "User not found" };
  if (target !== adminUsername && users.some((x) => x.username === target))
    return { ok: false, error: "Username already taken" };

  users[idx].username     = target;
  users[idx].passwordHash = newPassword
    ? await bcrypt.hash(newPassword, SALT_ROUNDS)
    : users[idx].passwordHash;
  writeFile(users);
  return { ok: true, username: target };
}

/** List all users (no hashes) — admin only */
async function listUsers() {
  if (isMongoConnected()) {
    const docs = await UserModel().find({}).lean();
    return docs.map((d) => ({ username: d.username, role: d.role }));
  }
  const users = await getFileUsers();
  return users.map((u) => ({ username: u.username, role: u.role }));
}

/** Create or update a user (admin operation) */
async function upsertUser({ username, password, role }) {
  const u = (username || "").trim();
  if (!u) return { ok: false, error: "Username required" };
  if (!["admin", "user"].includes(role)) return { ok: false, error: "Invalid role" };

  if (isMongoConnected()) {
    const M    = UserModel();
    const doc  = await M.findById(u);
    if (doc) {
      if (password) { doc.password = password; await doc.save(); }
      doc.role = role; await doc.save();
    } else {
      await new M({ _id: u, username: u, password: password || "changeme", role }).save();
    }
    return { ok: true };
  }

  const users = await getFileUsers();
  const idx   = users.findIndex((x) => x.username === u);
  const hash  = password
    ? await bcrypt.hash(password, SALT_ROUNDS)
    : (idx >= 0 ? users[idx].passwordHash : await bcrypt.hash("changeme", SALT_ROUNDS));

  if (idx >= 0) users[idx] = { username: u, passwordHash: hash, role };
  else          users.push ({ username: u, passwordHash: hash, role });
  writeFile(users);
  return { ok: true };
}

/** Delete a user (admin only — cannot delete yourself) */
async function deleteUser({ username, requestorUsername }) {
  if (username === requestorUsername) return { ok: false, error: "Cannot delete yourself" };
  if (isMongoConnected()) {
    await UserModel().deleteOne({ _id: username });
    return { ok: true };
  }
  const users = await getFileUsers();
  writeFile(users.filter((u) => u.username !== username));
  return { ok: true };
}

/** Sign a JWT for an authenticated user */
function signToken(user, config) {
  return jwt.sign(
    { username: user.username, role: user.role },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
}

module.exports = { init, verifyCredentials, updateCredentials, listUsers, upsertUser, deleteUser, signToken };
