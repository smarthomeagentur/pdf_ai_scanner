const express = require("express");
const jwt = require("jsonwebtoken");
const { AUTH_ENABLED, JWT_SECRET, ADMIN_PASSWORD, APP_PASSWORD } = require("../config/secrets");
const { checkIsAdmin } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimiters");

const router = express.Router();

router.get("/api/config", (req, res) => {
  res.json({
    authEnabled: AUTH_ENABLED,
    hasAppPassword: !!APP_PASSWORD,
    hasAdminPassword: !!ADMIN_PASSWORD,
    isAdmin: checkIsAdmin(req),
  });
});

router.post("/api/admin-login", loginLimiter, (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({ success: true, message: "Auth ist deaktiviert." });
  }
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: "Falsches Admin-Passwort." });
  }

  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({ success: true, message: "Admin-Login erfolgreich." });
});

router.post("/api/login", loginLimiter, (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({ success: true, message: "Auth ist deaktiviert." });
  }
  const { password } = req.body;
  if (!password || (password !== APP_PASSWORD && password !== ADMIN_PASSWORD)) {
    return res.status(401).json({ success: false, error: "Falsches Passwort." });
  }

  const role = password === ADMIN_PASSWORD ? "admin" : "user";
  const token = jwt.sign({ role }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({ success: true, role });
});

router.post("/api/logout", (req, res) => {
  res.clearCookie("auth_token");
  res.json({ success: true });
});

router.get("/api/admin-check", (req, res) => {
  res.json({ isAdmin: checkIsAdmin(req) });
});

module.exports = router;
