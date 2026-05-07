/**
 * models/User.js
 * Stores username (used as _id), bcrypt-hashed password, and role.
 * Roles: "admin" → full access | "user" → routing only
 */
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    _id:      { type: String },          // username is the primary key
    username: { type: String, required: true },
    password: { type: String, required: true }, // stored as bcrypt hash
    role:     { type: String, enum: ["admin", "user"], default: "user" },
  },
  { timestamps: true, collection: "users" }
);

// Auto-hash the password whenever it is set/changed
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Verify a plain-text password against the stored hash
userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
