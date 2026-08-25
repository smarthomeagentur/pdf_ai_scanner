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

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

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
