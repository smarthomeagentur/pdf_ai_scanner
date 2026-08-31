const jwt = require("jsonwebtoken");
const { AUTH_ENABLED, JWT_SECRET } = require("../config/secrets");

function verifyToken(req) {
  if (!AUTH_ENABLED) return { role: "admin" };
  const token = req.cookies?.auth_token;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function checkIsAdmin(req) {
  const user = verifyToken(req);
  return Boolean(user && user.role === "admin");
}

function requireAppAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: "Nicht authentifiziert. Bitte einloggen." });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const user = verifyToken(req);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Nur für Administratoren zugänglich." });
  }
  req.user = user;
  next();
}

module.exports = {
  verifyToken,
  checkIsAdmin,
  requireAppAuth,
  requireAdmin,
};
