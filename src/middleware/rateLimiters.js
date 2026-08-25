const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Zu viele Login-Versuche. Bitte versuche es in 15 Minuten erneut." },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  message: { error: "Zu viele Uploads auf einmal. Bitte kurz warten." },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginLimiter,
  uploadLimiter,
};
