const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 Minute Fenster
  max: 5, // Maximal 5 Fehlversuche pro Minute
  skipSuccessfulRequests: true, // Erfolgreiche Logins zählen nicht als Fehlversuch
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.status(429).json({
      success: false,
      error: "Zu viele Fehlversuche. Bitte warte 1 Minute vor dem nächsten Versuch.",
      retryAfter,
    });
  },
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
