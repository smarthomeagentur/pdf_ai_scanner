const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config();

const { AUTH_ENABLED } = require("./config/secrets");
const { verifyToken, checkIsAdmin } = require("./middleware/auth");
const { ROOT_DIR, DOWNLOADS_DIR, THUMBS_DIR } = require("./config/paths");

// Route modules
const authRoutes = require("./routes/authRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const driveRoutes = require("./routes/driveRoutes");
const jobRoutes = require("./routes/jobRoutes");
const searchRoutes = require("./routes/searchRoutes");
const accountingRoutes = require("./routes/accountingRoutes");
const clickupRoutes = require("./routes/clickupRoutes");
const inboxRoutes = require("./routes/inboxRoutes");
const adminRoutes = require("./routes/adminRoutes");
const scannerRoutes = require("./routes/scannerRoutes");

const helmet = require("helmet");
const { uploadLimiter } = require("./middleware/rateLimiters");

const app = express();

// Enable reverse proxy support (Coolify / Traefik / Caddy)
app.set("trust proxy", 1);

// HTTP Security Headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "'wasm-unsafe-eval'",
          "https://accounts.google.com/gsi/client",
          "https://apis.google.com",
          "https://cdn.jsdelivr.net",
          "https://docs.opencv.org",
          "https://*.opencv.org",
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.jsdelivr.net",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
        connectSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://*.googleapis.com",
          "https://googleapis.com",
          "https://*.google.com",
          "https://accounts.google.com",
          "https://apis.google.com",
          "https://gmail.googleapis.com",
          "https://www.googleapis.com",
          "https://api.lexoffice.io",
          "https://api.buchhaltungsbutler.de",
          "https://api.clickup.com",
          "https://cdn.jsdelivr.net",
          "https://docs.opencv.org",
          "https://*.opencv.org",
        ],
        frameSrc: ["'self'", "blob:", "https://*.google.com", "https://accounts.google.com", "https://docs.google.com", "https://drive.google.com"],
        workerSrc: ["'self'", "blob:", "https://cdn.jsdelivr.net"],
        objectSrc: ["'self'", "blob:", "data:"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// Rate limit upload & scan endpoints
app.use(["/api/upload", "/api/scan"], uploadLimiter);

// Auth gate for HTML pages
app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next();
  const publicPaths = [
    "/login.html",
    "/login.js",
    "/login.css",
    "/api/login",
    "/api/admin-login",
    "/api/config",
    "/manifest.json",
    "/sw.js",
    "/icon.svg",
  ];

  if (publicPaths.includes(req.path) || req.path.startsWith("/vendor/") || req.path.startsWith("/models/")) {
    return next();
  }

  const user = verifyToken(req);
  if (!user && (req.path === "/" || req.path.endsWith(".html"))) {
    return res.redirect("/login.html");
  }
  next();
});

// Static hosting
app.use(express.static(path.join(ROOT_DIR, "public")));
app.use("/thumbs", express.static(THUMBS_DIR));

// Register API Routes
app.use(authRoutes);
app.use(settingsRoutes);
app.use(driveRoutes);
app.use(jobRoutes);
app.use(searchRoutes);
app.use(accountingRoutes);
app.use(clickupRoutes);
app.use(inboxRoutes);
app.use(adminRoutes);
app.use(scannerRoutes);

module.exports = app;
