// Prevent pdf-lib font warnings
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  if (!args.join(" ").includes("Ran out of space in font private use area")) originalConsoleWarn(...args);
};
const originalConsoleLog = console.log;
console.log = (...args) => {
  if (!args.join(" ").includes("Ran out of space in font private use area")) originalConsoleLog(...args);
};

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const dotenv = require("dotenv");
const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { execFile } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const pdfParse = require("pdf-parse");
const { exiftool } = require("exiftool-vendored");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

process.on("unhandledRejection", (reason, promise) => {
  console.error("[SYSTEM] Unhandled Rejection abgefangen:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[SYSTEM] Uncaught Exception abgefangen:", error);
});

const aiAgent = require("./app/aiAgent.js");
const DriveAPI = require("./app/driveApi.js");
const GmailAPI = require("./app/gmailApi.js");
const ClickUpAPI = require("./app/clickupApi.js");
const butlerApi = require("./app/butlerApi.js");

dotenv.config();

let debug = false;
let testrun = false;
let firststart = true;

const AUTH_ENABLED = process.env.AUTH_ENABLED === "true" || "true";
const APP_PASSWORD = process.env.APP_PASSWORD || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "superadmin";
const JWT_SECRET = process.env.JWT_SECRET || "default_super_secret_key_123";

function getPythonPath() {
  const venvWin = path.join(__dirname, "venv", "Scripts", "python.exe");
  const venvUnix = path.join(__dirname, "venv", "bin", "python");
  if (fs.existsSync(venvWin)) return venvWin;
  if (fs.existsSync(venvUnix)) return venvUnix;
  return "python";
}

// Store paths
const storeFolder = path.join(process.cwd(), "store");
if (!fs.existsSync(storeFolder)) fs.mkdirSync(storeFolder, { recursive: true });

// Move old dynamic files to store/ if they exist in root
["settings.json", "jobs.json", "token.json"].forEach((f) => {
  const oldPath = path.join(process.cwd(), f);
  const newPath = path.join(storeFolder, f);
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    try {
      fs.renameSync(oldPath, newPath);
      console.log(`Moved ${f} to store/`);
    } catch (e) { }
  }
});

const localDownloadFolder = path.join(__dirname, "downloads");
if (!fs.existsSync(localDownloadFolder)) fs.mkdirSync(localDownloadFolder, { recursive: true });

const SETTINGS_FILE = path.join(storeFolder, "settings.json");
const TOKEN_PATH = path.join(storeFolder, "token.json");
const JOBS_FILE = path.join(storeFolder, "jobs.json");
const SKIPPED_EMAILS_FILE = path.join(storeFolder, "skipped_emails.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "gdrive_secret.json"); // Secret usually stays in root or via env
const thumbsFolder = path.join(storeFolder, "thumbs");
if (!fs.existsSync(thumbsFolder)) fs.mkdirSync(thumbsFolder, { recursive: true });

const driveApi = new DriveAPI(TOKEN_PATH, CREDENTIALS_PATH);
const gmailApi = new GmailAPI(TOKEN_PATH, CREDENTIALS_PATH);

let skippedEmails = {};
function loadSkippedEmails() {
  if (fs.existsSync(SKIPPED_EMAILS_FILE)) {
    try {
      skippedEmails = JSON.parse(fs.readFileSync(SKIPPED_EMAILS_FILE, "utf8"));
    } catch (e) {
      console.error("[GMAIL] Fehler beim Laden der skipped_emails.json:", e);
    }
  }
}
function saveSkippedEmails() {
  try {
    fs.promises.writeFile(SKIPPED_EMAILS_FILE, JSON.stringify(skippedEmails, null, 2)).catch((err) => {
      console.error("[GMAIL] Fehler beim Speichern von skipped_emails.json:", err);
    });
  } catch (e) { }
}
loadSkippedEmails();

const appSettings = {
  FOLDER_ID: process.env.DRIVE_FOLDER_ID,
  FOLDER_ID_SORTED: process.env.DRIVE_FOLDER_ID_SORTED,
  MONITOR_DRIVE: false,
  MONITOR_GMAIL: false,
  GMAIL_AUTO_ARCHIVE: true,
  GMAIL_SCAN_QUERY: "in:inbox filename:pdf",
  AI_COMPANY: "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt",
  AI_CATEGORIES:
    "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige",
  LEXOFFICE_KEY_WIREWIRE: process.env.LEXOFFICE_KEY_WIREWIRE || "",
  LEXOFFICE_KEY_THEWIRE: process.env.LEXOFFICE_KEY_THEWIRE || "",
  LEXOFFICE_KEY_POLYXO: process.env.LEXOFFICE_KEY_POLYXO || "",
  BUTTLER_KEY_THEWIRE_CLIENT: process.env.BUTTLER_KEY_THEWIRE_CLIENT || "",
  BUTTLER_KEY_THEWIRE_SECRET: process.env.BUTTLER_KEY_THEWIRE_SECRET || "",
  BUTTLER_KEY_THEWIRE_KEY: process.env.BUTTLER_KEY_THEWIRE_KEY || "",
  CLICKUP_API_KEY: process.env.CLICKUP_API_KEY || "",
  CLICKUP_LIST_ID: process.env.CLICKUP_LIST_ID || "",
  CLICKUP_AUTO_TASK: true,
  CLICKUP_FILTER_PRIVATE: true,
  CLICKUP_CUSTOM_FIELD_COMPANY_ID: process.env.CLICKUP_CUSTOM_FIELD_COMPANY_ID || "",
  CLICKUP_STATUS_INVOICE: process.env.CLICKUP_STATUS_INVOICE || "rechnung",
  CLICKUP_STATUS_DEFAULT: process.env.CLICKUP_STATUS_DEFAULT || "offen",
};

if (fs.existsSync(SETTINGS_FILE)) {
  try {
    Object.assign(appSettings, JSON.parse(fs.readFileSync(SETTINGS_FILE)));
  } catch (e) { }
}

const clickupApi = new ClickUpAPI(
  appSettings.CLICKUP_API_KEY || process.env.CLICKUP_API_KEY,
  appSettings.CLICKUP_LIST_ID || process.env.CLICKUP_LIST_ID,
  appSettings.CLICKUP_CUSTOM_FIELD_COMPANY_ID || process.env.CLICKUP_CUSTOM_FIELD_COMPANY_ID,
  appSettings.CLICKUP_STATUS_INVOICE || process.env.CLICKUP_STATUS_INVOICE,
  appSettings.CLICKUP_STATUS_DEFAULT || process.env.CLICKUP_STATUS_DEFAULT
);

const app = express();
app.set("trust proxy", 1); // Trust first proxy for express-rate-limit
const port = process.env.PORT || 3000;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(localDownloadFolder)) fs.mkdirSync(localDownloadFolder, { recursive: true });
    cb(null, localDownloadFolder);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + path.basename(file.originalname)),
});
const upload = multer({ storage });

app.use(cookieParser());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 5, // Limitiere jede IP auf 5 Login-Versuche pro `window`
  message: { success: false, error: "Zu viele Login-Versuche, bitte in 15 Minuten erneut probieren." },
});

const checkIsAdmin = (req) => {
  try {
    const token = req.cookies.admin_token;
    if (token && jwt.verify(token, JWT_SECRET).admin) return true;
  } catch (err) { }
  return false;
};

const requireAdmin = (req, res, next) => {
  if (checkIsAdmin(req)) return next();
  return res.status(403).json({ error: "Admin-Rechte erforderlich" });
};

app.post("/api/admin-login", loginLimiter, (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 Tage
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: "Falsches Admin-Passwort" });
  }
});

app.get("/api/admin-check", requireAdmin, (req, res) => {
  res.json({ success: true });
});

// Admin Backup & Restore Endpoints
app.get("/api/admin/backup", requireAdmin, (req, res) => {
  try {
    let settingsData = null;
    let jobsData = null;
    let tokenData = null;

    if (fs.existsSync(SETTINGS_FILE)) {
      try { settingsData = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch (e) {}
    }
    if (fs.existsSync(JOBS_FILE)) {
      try { jobsData = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")); } catch (e) {}
    }
    if (fs.existsSync(TOKEN_PATH)) {
      try { tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")); } catch (e) {}
    }

    const backupPayload = {
      version: "1.0",
      createdAt: new Date().toISOString(),
      settings: settingsData || appSettings,
      jobs: jobsData || { uploadJobs, uploadQueue, processedDriveFiles },
      skippedEmails: skippedEmails || {},
      token: tokenData || null,
    };

    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const filename = `backup-adobe-downloader-${dateStr}.json`;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backupPayload, null, 2));
  } catch (err) {
    console.error("[BACKUP] Fehler beim Erstellen des Backups:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler beim Erstellen des Backups" });
  }
});

app.post("/api/admin/restore", requireAdmin, async (req, res) => {
  try {
    const backup = req.body;
    if (!backup || typeof backup !== "object") {
      return res.status(400).json({ success: false, error: "Ungültiges Backup-Format." });
    }

    if (!backup.settings && !backup.jobs) {
      return res.status(400).json({ success: false, error: "Das angegebene Backup enthält weder Einstellungen noch Dokumente." });
    }

    let restoredItems = [];

    // Restore Settings
    if (backup.settings) {
      appSettings = { ...appSettings, ...backup.settings };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(appSettings, null, 2));
      restoredItems.push("Einstellungen");
    }

    // Restore Jobs
    if (backup.jobs) {
      if (backup.jobs.uploadJobs) uploadJobs = backup.jobs.uploadJobs;
      if (backup.jobs.uploadQueue) uploadQueue = backup.jobs.uploadQueue;
      if (backup.jobs.processedDriveFiles) processedDriveFiles = backup.jobs.processedDriveFiles;

      fs.writeFileSync(JOBS_FILE, JSON.stringify({ uploadJobs, uploadQueue, processedDriveFiles }, null, 2));
      restoredItems.push(`${Object.keys(uploadJobs).length} Dokumente`);
    }

    // Restore Token
    if (backup.token) {
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(backup.token, null, 2));
      restoredItems.push("Google Drive Tokens");
    }

    console.log(`[RESTORE] Backup erfolgreich wiederhergestellt: ${restoredItems.join(", ")}`);
    res.json({
      success: true,
      message: `Backup erfolgreich wiederhergestellt! Wiederhergestellt: ${restoredItems.join(", ")}`,
    });
  } catch (err) {
    console.error("[RESTORE] Fehler bei der Wiederherstellung:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler bei der Wiederherstellung" });
  }
});

app.post("/api/login", loginLimiter, (req, res) => {
  if (req.body.password === APP_PASSWORD) {
    const token = jwt.sign({ authenticated: true }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax", // 'Lax' erlaubt das Senden des Cookies, wenn die PWA vom Homescreen gestartet wird
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 Tage
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: "Falsches Passwort" });
  }
});

app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next();
  const openRoutes = [
    "/login.html",
    "/login.css",
    "/login.js",
    "/api/login",
    "/manifest.json",
    "/icon.svg",
    "/favicon.ico",
    "/robots.txt",
    "/sw.js",
  ];
  if (openRoutes.includes(req.path)) return next();
  const token = req.cookies.auth_token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return next();
    } catch (err) { }
  }
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  res.redirect("/login.html");
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    },
  }),
);
app.use("/downloads", express.static(localDownloadFolder));

// App Config & Settings
app.get("/api/config", async (req, res) => {
  try {
    const keys = JSON.parse(await fs.promises.readFile(CREDENTIALS_PATH));
    res.json({ clientId: (keys.installed || keys.web).client_id, success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get("/api/settings", (req, res) => res.json({ success: true, settings: appSettings }));

app.post("/api/settings", requireAdmin, async (req, res) => {
  [
    "FOLDER_ID",
    "FOLDER_ID_SORTED",
    "AI_COMPANY",
    "AI_CATEGORIES",
    "MONITOR_DRIVE",
    "MONITOR_GMAIL",
    "GMAIL_AUTO_ARCHIVE",
    "GMAIL_SCAN_QUERY",
    "LEXOFFICE_KEY_WIREWIRE",
    "LEXOFFICE_KEY_THEWIRE",
    "LEXOFFICE_KEY_POLYXO",
    "BUTTLER_KEY_THEWIRE_CLIENT",
    "BUTTLER_KEY_THEWIRE_SECRET",
    "BUTTLER_KEY_THEWIRE_KEY",
    "CLICKUP_API_KEY",
    "CLICKUP_LIST_ID",
    "CLICKUP_AUTO_TASK",
    "CLICKUP_FILTER_PRIVATE",
  ].forEach((key) => {
    if (req.body[key] !== undefined) appSettings[key] = req.body[key];
  });
  await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(appSettings, null, 2));

  clickupApi.setApiKey(appSettings.CLICKUP_API_KEY);
  clickupApi.setListId(appSettings.CLICKUP_LIST_ID);

  res.json({ success: true });

  if (appSettings.MONITOR_DRIVE) {
    // Starte Überwachung asynchron sofort nach dem Speichern
    checkDriveForNewFiles().catch(console.error);
  }
  if (appSettings.MONITOR_GMAIL) {
    checkGmailForNewFiles().catch(console.error);
  }
});

// Drive Auth Workflow
app.post("/api/auth/code", requireAdmin, async (req, res) => {
  try {
    const keys = JSON.parse(await fs.promises.readFile(CREDENTIALS_PATH));
    const key = keys.installed || keys.web;
    const oauth2Client = new (require("googleapis").google.auth.OAuth2)(
      key.client_id,
      key.client_secret,
      "postmessage",
    );
    const { tokens } = await oauth2Client.getToken(req.body.code);
    const isSecondary = req.body.isSecondary === true;

    let addedAccount = null;
    try {
      addedAccount = await gmailApi.addAccountFromTokens(tokens, keys, isSecondary);
      console.log(`[AUTH] Google-Konto ${addedAccount.email} (${isSecondary ? "Sekundärer Posteingang" : "Hauptkonto Drive+Gmail"}) verknüpft.`);
    } catch (accErr) {
      console.warn("[AUTH] Konto-Verknüpfung via Gmail API:", accErr.message);
    }

    // NUR wenn es das Hauptkonto ist, wird store/token.json (für Google Drive) geschrieben
    if (!isSecondary) {
      let existingToken = {};
      if (fs.existsSync(TOKEN_PATH)) {
        try {
          existingToken = JSON.parse(await fs.promises.readFile(TOKEN_PATH, "utf8"));
        } catch (e) {}
      }

      const refreshToken = tokens.refresh_token || existingToken.refresh_token;
      const payload = JSON.stringify({
        type: "authorized_user",
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: refreshToken,
      }, null, 2);

      await fs.promises.writeFile(TOKEN_PATH, payload);
      console.log("[AUTH] Google Drive Hauptkonto-Token (token.json) erfolgreich gespeichert.");
    } else {
      console.log("[AUTH] Sekundärer Gmail-Posteingang gespeichert. Google Drive Hauptkonto bleibt unberührt.");
    }

    res.json({ success: true, account: addedAccount, isSecondary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});

// Drive Routes
app.get("/api/drive/folders", requireAdmin, async (req, res) => {
  try {
    const drive = await driveApi.getClient();
    const result = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and trashed=false and '${req.query.parentId || "root"
        }' in parents`,
      fields: "files(id, name, parents)",
      orderBy: "name",
      pageSize: 1000,
    });
    res.json({ success: true, folders: result.data.files });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

app.get("/api/drive/folder/:id", requireAdmin, async (req, res) => {
  try {
    const drive = await driveApi.getClient();
    const result = await drive.files.get({ fileId: req.params.id, fields: "id, name" });
    res.json({ success: true, folder: result.data });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

// Local PDF Text Cache for Deep Search
const localPdfTextCache = new Map();

async function getLocalPdfText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    const stat = await fs.promises.stat(filePath);
    const cached = localPdfTextCache.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.text;
    }
    const dataBuffer = await fs.promises.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    const text = (data.text || "").replace(/\r?\n/g, " ");
    localPdfTextCache.set(filePath, { mtime: stat.mtimeMs, text });
    return text;
  } catch (e) {
    return "";
  }
}

// Deep Document Content Search (OCR & Full-Text)
app.get("/api/documents/deep-search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) {
      return res.json({ success: true, results: [], total: 0 });
    }

    const isAdmin = checkIsAdmin(req);
    const safeQ = q.replace(/'/g, "\\'");
    const qLower = q.toLowerCase();
    const results = [];
    const seenNames = new Set();

    // 1. Search Google Drive (Fulltext & OCR Search across sorted and target folders)
    if (fs.existsSync(TOKEN_PATH)) {
      try {
        const drive = await driveApi.getClient();
        let folderId = appSettings.FOLDER_ID_SORTED || appSettings.FOLDER_ID;
        if (folderId && !driveApi.isValidGoogleDriveId(folderId)) {
          folderId = await driveApi.findFolderId(folderId);
        }

        let driveQuery = `trashed=false and (fullText contains '${safeQ}' or name contains '${safeQ}')`;
        if (folderId) {
          driveQuery += ` and '${folderId}' in parents`;
        }
        if (!isAdmin) {
          driveQuery += ` and not appProperties has { key='isPrivate' and value='true' }`;
        }

        const driveRes = await drive.files.list({
          q: driveQuery,
          fields: "files(id, name, webViewLink, thumbnailLink, webContentLink, createdTime, size, mimeType)",
          pageSize: 30,
        });

        const driveFiles = driveRes.data.files || [];
        for (const file of driveFiles) {
          seenNames.add(file.name.toLowerCase());
          results.push({
            id: file.id,
            name: file.name,
            source: "Google Drive (Cloud)",
            type: "gdrive",
            date: file.createdTime,
            size: file.size ? parseInt(file.size, 10) : 0,
            webViewLink: file.webViewLink,
            downloadLink: file.webContentLink || `/api/drive/file/${file.id}/download`,
            thumbnailLink: file.thumbnailLink,
            snippet: `Treffer im Google Drive Dokumenteninhalt / Dateinamen`,
          });
        }
      } catch (driveErr) {
        console.warn("[DEEP SEARCH] Google Drive Suche Warnung:", driveErr.message);
      }
    }

    // 2. Search Local Upload / Processed Jobs (PDF Full-Text Parsing)
    const localJobs = Object.values(uploadJobs).filter((job) => !job.isPrivate || isAdmin);
    for (const job of localJobs) {
      if (!job.filePath || !fs.existsSync(job.filePath)) continue;

      const fullText = await getLocalPdfText(job.filePath);
      const resData = job.result || {};
      const metaText = `${job.originalName || ""} ${resData.full || ""} ${resData.company || ""} ${resData.invoiceNumber || ""} ${resData.category || ""} ${(resData.tags || []).join(" ")}`;

      const lowerFull = fullText.toLowerCase();
      const lowerMeta = metaText.toLowerCase();

      const matchInPdf = lowerFull.includes(qLower);
      const matchInMeta = lowerMeta.includes(qLower);

      if (matchInPdf || matchInMeta) {
        // Snippet mit Kontext um den Treffer generieren
        let snippet = "";
        if (matchInPdf) {
          const idx = lowerFull.indexOf(qLower);
          const start = Math.max(0, idx - 50);
          const end = Math.min(fullText.length, idx + q.length + 50);
          snippet = (start > 0 ? "..." : "") + fullText.substring(start, end).trim() + (end < fullText.length ? "..." : "");
        } else {
          snippet = `Gefunden in Metadaten: ${resData.company || ""} ${resData.category || ""}`;
        }

        if (!seenNames.has((job.originalName || "").toLowerCase())) {
          results.push({
            id: job.id,
            jobId: job.id,
            name: job.result?.full || job.originalName || "Dokument",
            source: job.source === "gmail" ? "E-Mail Inbox" : "Lokaler Upload / Scanner",
            type: "local",
            date: job.uploadDate,
            size: fs.statSync(job.filePath).size,
            filePath: job.filePath,
            thumbnailLink: `/api/thumbnail/${job.id}`,
            snippet: snippet,
            isLocal: true,
          });
        }
      }
    }

    res.json({ success: true, query: q, results, total: results.length });
  } catch (err) {
    console.error("[DEEP SEARCH] Fehler:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// File streaming for local jobs
app.get("/api/jobs/:id/file", async (req, res) => {
  try {
    const id = req.params.id;
    const job = uploadJobs[id];
    if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(404).send("Datei nicht gefunden");
    }
    if (job.isPrivate && !checkIsAdmin(req)) {
      return res.status(403).send("Forbidden");
    }
    const filename = job.result?.full || job.originalName || "Dokument.pdf";
    const safeName = filename.replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "_");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.sendFile(job.filePath);
  } catch (err) {
    res.status(500).send("Fehler beim Laden der Datei: " + err.message);
  }
});

async function renderPdfToJpeg(pdfPath, targetThumbPath) {
  if (!fs.existsSync(pdfPath)) return false;

  // 1. pdftoppm (Linux Poppler Utility - Standard in Docker & Linux)
  try {
    const util = require("util");
    const execFileAsync = util.promisify(execFile);
    const prefix = targetThumbPath.replace(/\.jpe?g$/i, "");
    await execFileAsync("pdftoppm", ["-jpeg", "-r", "120", "-f", "1", "-l", "1", "-singlefile", pdfPath, prefix]);
    if (fs.existsSync(targetThumbPath)) return true;
    if (fs.existsSync(`${prefix}.jpg`)) {
      if (`${prefix}.jpg` !== targetThumbPath) await fs.promises.rename(`${prefix}.jpg`, targetThumbPath).catch(() => {});
      return true;
    }
  } catch (e) {}

  // 2. PyMuPDF (fitz) - falls installiert
  try {
    const util = require("util");
    const execFileAsync = util.promisify(execFile);
    await execFileAsync(getPythonPath(), [
      "-c",
      "import sys, fitz; doc=fitz.open(sys.argv[1]); pix=doc[0].get_pixmap(dpi=120); pix.save(sys.argv[2]); doc.close()",
      pdfPath,
      targetThumbPath,
    ]);
    if (fs.existsSync(targetThumbPath)) return true;
  } catch (fitzErr) {}

  // 3. Fallback: pdf2pic
  try {
    const { fromPath } = require("pdf2pic");
    const dir = path.dirname(targetThumbPath);
    const baseName = path.basename(targetThumbPath, path.extname(targetThumbPath));
    const convert = fromPath(pdfPath, {
      density: 120,
      saveFilename: baseName,
      savePath: dir,
      format: "jpeg",
    });
    const res = await convert(1);
    const possible = [
      path.join(dir, `${baseName}.1.jpeg`),
      path.join(dir, `${baseName}.1.jpg`),
      res?.path,
    ];
    for (const p of possible) {
      if (p && fs.existsSync(p)) {
        if (p !== targetThumbPath) {
          await fs.promises.rename(p, targetThumbPath).catch(() => {});
        }
        return true;
      }
    }
  } catch (p2pErr) {}

  return false;
}

async function getOrGenerateThumbnailPath(identifier) {
  if (!identifier) return null;

  // 1. Direct match on disk (downloads/ or store/thumbs/)
  const candidatePaths = [
    path.join(localDownloadFolder, `thumb_${identifier}.jpg`),
    path.join(localDownloadFolder, `thumb_${identifier}.png`),
    path.join(thumbsFolder, `${identifier}.jpg`),
    path.join(thumbsFolder, `thumb_${identifier}.jpg`),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }

  // 2. Check if identifier corresponds to a job in uploadJobs
  const job = uploadJobs[identifier];
  const targetThumbPath = path.join(localDownloadFolder, `thumb_${identifier}.jpg`);

  // 2a. If local PDF file exists on disk, render directly
  if (job && job.filePath && fs.existsSync(job.filePath)) {
    const rendered = await renderPdfToJpeg(job.filePath, targetThumbPath);
    if (rendered && fs.existsSync(targetThumbPath)) return targetThumbPath;
  }

  // 3. Fallback: Google Drive Download
  let driveFileId = job?.rawDriveId || (job?.result?.webViewLink ? job.result.webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] : null);
  if (!driveFileId && typeof identifier === "string" && !identifier.includes("-") && identifier.length >= 10) {
    driveFileId = identifier;
  }

  if (driveFileId && fs.existsSync(TOKEN_PATH)) {
    try {
      const drive = await driveApi.getClient();

      // 3a. Try thumbnailLink from Google Drive (Zero CPU, instant)
      try {
        const fileInfo = await drive.files.get({ fileId: driveFileId, fields: "thumbnailLink" });
        if (fileInfo.data && fileInfo.data.thumbnailLink) {
          const link = fileInfo.data.thumbnailLink.replace(/=s\d+$/, "=s300");
          const imgRes = await fetch(link);
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            if (buf && buf.length > 100) {
              await fs.promises.writeFile(targetThumbPath, buf);
              return targetThumbPath;
            }
          }
        }
      } catch (e) {}

      // 3b. Download first page/file and render
      const pdfTemp = path.join(localDownloadFolder, `temp_thumb_${identifier}.pdf`);
      try {
        const dest = fs.createWriteStream(pdfTemp);
        const downloadRes = await drive.files.get({ fileId: driveFileId, alt: "media" }, { responseType: "stream" });
        await pipeline(downloadRes.data, dest);

        const rendered = await renderPdfToJpeg(pdfTemp, targetThumbPath);
        if (rendered && fs.existsSync(targetThumbPath)) return targetThumbPath;
      } catch (e) {
        console.error(`[THUMBNAIL] Fehler beim Rendern des Drive-PDFs für ${identifier}:`, e.message);
      } finally {
        if (fs.existsSync(pdfTemp)) await fs.promises.unlink(pdfTemp).catch(() => {});
      }
    } catch (driveErr) {
      console.error(`[THUMBNAIL] Google Drive Fehler für ${identifier}:`, driveErr.message);
    }
  }

  return null;
}

async function syncClickupStatusForJobs(targetJobs = null) {
  if (!appSettings.CLICKUP_API_KEY || !appSettings.CLICKUP_LIST_ID) {
    return { success: false, error: "Keine ClickUp Zugangsdaten konfiguriert." };
  }

  try {
    console.log("[CLICKUP] Lade Aufgaben aus ClickUp zur Statusprüfung...");
    const clickupTasks = await clickupApi.fetchListTasks(appSettings.CLICKUP_LIST_ID);
    const jobsToEvaluate = targetJobs || Object.values(uploadJobs);
    let matchedCount = 0;

    for (const job of jobsToEvaluate) {
      const match = clickupApi.findMatchingTask(job, clickupTasks);
      if (match) {
        job.clickup = {
          taskId: match.id,
          taskUrl: match.url || `https://app.clickup.com/t/${match.id}`,
          taskName: match.name,
          status: match.status?.status || "offen",
          transferredAt: job.clickup?.transferredAt || new Date().toISOString(),
        };
        matchedCount++;
      }
    }

    saveJobs();
    console.log(`[CLICKUP] Statusprüfung abgeschlossen: ${matchedCount} / ${jobsToEvaluate.length} Belege in ClickUp verknüpft.`);
    return { success: true, matchedCount, total: jobsToEvaluate.length, totalClickupTasks: clickupTasks.length };
  } catch (err) {
    console.error("[CLICKUP] Fehler bei ClickUp Statusprüfung:", err.message || err);
    return { success: false, error: err.message };
  }
}

app.get(["/api/thumbnail/:id", "/api/jobs/:id/thumbnail"], async (req, res) => {
  try {
    const id = req.params.id;
    const thumbPath = await getOrGenerateThumbnailPath(id);
    if (thumbPath && fs.existsSync(thumbPath)) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=864000"); // 10 Tage Browser-Cache
      return res.sendFile(thumbPath);
    }
    return res.status(404).send("Thumbnail not found");
  } catch (err) {
    console.error("[THUMBNAIL] Fehler beim Ausliefern des Thumbnails:", err);
    return res.status(500).send("Error generating thumbnail");
  }
});

app.post("/api/clickup/sync-status", requireAdmin, async (req, res) => {
  const result = await syncClickupStatusForJobs();
  res.json(result);
});

// Job Queue
let uploadJobs = {};
let uploadQueue = [];
let processedDriveFiles = [];
let isProcessingQueue = false;

function loadJobs() {
  if (!fs.existsSync(JOBS_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(JOBS_FILE));
    if (data.uploadJobs) uploadJobs = data.uploadJobs;
    if (data.uploadQueue) uploadQueue = data.uploadQueue;
    if (data.processedDriveFiles) processedDriveFiles = data.processedDriveFiles;

    // Entferne alte base64 localThumbnails aus jobs.json & bereinige Crash-Status
    let changed = false;
    for (const jobId in uploadJobs) {
      if (uploadJobs[jobId].result && uploadJobs[jobId].result.localThumbnail) {
        delete uploadJobs[jobId].result.localThumbnail;
        changed = true;
      }
      if (uploadJobs[jobId].localThumbnail) {
        delete uploadJobs[jobId].localThumbnail;
        changed = true;
      }
      if (uploadJobs[jobId].status === "processing" || uploadJobs[jobId].status === "pending") {
        uploadJobs[jobId].status = "error";
        uploadJobs[jobId].inAiPipeline = false;
        uploadJobs[jobId].error = uploadJobs[jobId].error || "Verarbeitung durch Server-Neustart unterbrochen.";
        changed = true;
      }
    }
    if (changed) saveJobs();
  } catch (e) { }
}
function saveJobs() {
  try {
    // 30 Tage altes Zeug säubern
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    let isModified = false;
    for (const jobId in uploadJobs) {
      const jobTime = new Date(uploadJobs[jobId].uploadDate).getTime();
      if (now - jobTime > thirtyDaysMs) {
        delete uploadJobs[jobId];
        isModified = true;
      }
    }

    fs.promises.writeFile(JOBS_FILE, JSON.stringify({ uploadJobs, uploadQueue, processedDriveFiles })).catch((err) => {
      console.error("[SYSTEM] Fehler beim asynchronen Speichern der Jobs:", err);
    });
  } catch (e) { }
}
loadJobs();

let driveSyncState = {
  running: false,
  total: 0,
  processed: 0,
  currentFileName: "",
  startedAt: null,
  finishedAt: null,
  errors: [],
};

function checkJobNeedsEnrichment(job) {
  if (!job || !job.result) return true;
  const res = job.result;
  const company = (res.company || "").toLowerCase();
  const isMissingCompany = !company || company === "unbekannt" || company === "unknown" || company === "-";
  const date = (res.documentDate || "").toLowerCase();
  const isMissingDate = !date || date === "unknown" || date === "-" || date === "none";
  const category = (res.category || "").toLowerCase();
  const isMissingCategory = !category || category === "sonstige" || category === "-" || category === "unknown";
  return isMissingCompany || isMissingDate || isMissingCategory;
}

// Process core queue
async function processSingleJob(jobId) {
  const job = uploadJobs[jobId];
  if (!job) return;

  job.status = "processing";
  job.processingStartedAt = Date.now();
  saveJobs();

  try {
    console.log(`[WEB] Processing job ${jobId} for file ${job.originalName}...`);
    let folderId = driveApi.isValidGoogleDriveId(appSettings.FOLDER_ID)
      ? appSettings.FOLDER_ID
      : await driveApi.findFolderId(appSettings.FOLDER_ID);

    // Sofortiger Roh-Upload in Google Drive (Backup vor KI) falls noch nicht vorhanden
    let defaultDriveFile = null;
    if (!job.rawDriveId) {
      let uploadOptions = job.isPrivate ? { appProperties: { isPrivate: 'true' } } : undefined;
      defaultDriveFile = await driveApi.uploadFile(job.filePath, folderId, uploadOptions, debug);
      if (defaultDriveFile) {
        processedDriveFiles.push(defaultDriveFile.id);
        job.rawDriveId = defaultDriveFile.id;
      }
    }

    const aiStartTime = Date.now();
    const sortedName = await aiAgent.getPdfName(job.filePath, appSettings);
    sortedName.duration = ((Date.now() - aiStartTime) / 1000).toFixed(2);

    if (sortedName.success === false) throw new Error("KI Verarbeitung fehlgeschlagen.");

    const tagsArr = Array.isArray(sortedName.tags) ? sortedName.tags : [];
    if (sortedName.isInvoice) tagsArr.push("Rechnung");
    if (sortedName.documentDate && sortedName.documentDate !== "unknown")
      tagsArr.push(`Datum:${sortedName.documentDate}`);
    if (sortedName.isInvoice !== undefined) tagsArr.push(`isInvoice:${sortedName.isInvoice}`);
    if (sortedName.invoiceNumber && sortedName.invoiceNumber !== "none") tagsArr.push(`invoiceNumber:${sortedName.invoiceNumber}`);
    if (sortedName.invoiceAmmount !== undefined) tagsArr.push(`invoiceAmmount:${sortedName.invoiceAmmount}`);

    try {
      await exiftool.write(job.filePath, {
        Title: sortedName.full || "Dokument",
        Author: sortedName.company || "Unbekannt",
        Subject: sortedName.category || "",
        Creator: "AI Document Scanner",
        Keywords: tagsArr,
      });

      if (fs.existsSync(job.filePath + "_original")) {
        await fs.promises.unlink(job.filePath + "_original");
      }
      if (debug) console.log(`[WEB] ExifTool Metadaten geschrieben für ${jobId}`);
    } catch (metaErr) {
      console.error(`[WEB] Fehler beim Schreiben der Metadaten mit ExifTool für ${jobId}:`, metaErr);
    }

    const searchDescription = [
      sortedName.company ? `Firma: ${sortedName.company}` : "",
      sortedName.category ? `Kategorie: ${sortedName.category}` : "",
      tagsArr.length > 0 ? `Tags: ${tagsArr.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    let driveFile = appSettings.FOLDER_ID_SORTED
      ? await driveApi.uploadFile(
        job.filePath,
        appSettings.FOLDER_ID_SORTED,
        {
          name: sortedName.full,
          description: searchDescription,
          appProperties: job.isPrivate ? { isPrivate: 'true' } : undefined,
        },
        debug,
      )
      : null;

    driveFile = driveFile || defaultDriveFile;

    if (driveFile) {
      sortedName.webViewLink = driveFile.webViewLink;
      sortedName.thumbnailLink = driveFile.thumbnailLink;
      sortedName.webContentLink = driveFile.webContentLink;
    }

    // Dynamisches Thumbnail direkt in downloads/thumb_${jobId}.jpg anlegen
    const targetThumb = path.join(localDownloadFolder, `thumb_${jobId}.jpg`);
    if (fs.existsSync(job.filePath) && !fs.existsSync(targetThumb)) {
      try {
        await new Promise((resolve) => {
          execFile(
            getPythonPath(),
            [
              "-c",
              "import sys, fitz; doc=fitz.open(sys.argv[1]); pix=doc[0].get_pixmap(dpi=120); pix.save(sys.argv[2]); doc.close()",
              job.filePath,
              targetThumb,
            ],
            () => resolve()
          );
        });
      } catch (thumbErr) {}
    }

    // Read PDF buffer for ClickUp attachment before unlinking
    let pdfBuffer = null;
    if (fs.existsSync(job.filePath)) {
      try {
        pdfBuffer = await fs.promises.readFile(job.filePath);
      } catch (e) {}
    }

    // ClickUp Integration
    const isDriveSyncJob = job.source === "drive_sync" || job.source === "google_drive" || !!job.rawDriveId;

    if (isDriveSyncJob) {
      // DRIVE SYNC: Nur lesend prüfen, ob Task in ClickUp bereits existiert (KEIN automatischer Upload!)
      if (appSettings.CLICKUP_API_KEY && appSettings.CLICKUP_LIST_ID) {
        try {
          const clickupTasks = await clickupApi.fetchListTasks(appSettings.CLICKUP_LIST_ID);
          const match = clickupApi.findMatchingTask(job, clickupTasks);
          if (match) {
            job.clickup = {
              taskId: match.id,
              taskUrl: match.url || `https://app.clickup.com/t/${match.id}`,
              taskName: match.name,
              status: match.status?.status || "offen",
              transferredAt: job.clickup?.transferredAt || new Date().toISOString(),
            };
            console.log(`[CLICKUP] Drive-Sync Beleg ${jobId} bereits in ClickUp gefunden: Task #${match.id}`);
          }
        } catch (cuErr) {
          console.error(`[CLICKUP] Fehler beim Prüfen von Task für Job ${jobId}:`, cuErr.message);
        }
      }
    } else if (appSettings.CLICKUP_AUTO_TASK && appSettings.CLICKUP_API_KEY) {
      // LIVE SCAN / UPLOAD: Neuer Scan darf automatisch zu ClickUp übertragen werden
      const isPrivateDoc =
        job.isPrivate ||
        (sortedName.company && sortedName.company.toLowerCase().includes("daniel")) ||
        (sortedName.category && sortedName.category.toLowerCase() === "privat");

      if (appSettings.CLICKUP_FILTER_PRIVATE && isPrivateDoc) {
        console.log(`[CLICKUP] Job ${jobId} als privat eingestuft. ClickUp-Upload wird übersprungen.`);
      } else {
        try {
          const fileName = sortedName.full
            ? (sortedName.full.endsWith(".pdf") ? sortedName.full : `${sortedName.full}.pdf`)
            : (job.originalName || "Dokument.pdf");

          const clickupResult = await clickupApi.createOrUpdateDocumentTask({
            fileBuffer: pdfBuffer,
            fileName: fileName,
            aiResult: sortedName,
            driveFile: driveFile,
            listId: appSettings.CLICKUP_LIST_ID,
            uploadAttachment: !!pdfBuffer,
          });

          if (clickupResult && clickupResult.success) {
            job.clickup = {
              taskId: clickupResult.taskId,
              taskUrl: clickupResult.taskUrl,
              taskName: clickupResult.taskName,
              status: clickupResult.status,
              transferredAt: new Date().toISOString(),
            };
          }
        } catch (clickupErr) {
          console.error(`[CLICKUP] Fehler bei ClickUp-Verarbeitung für Job ${jobId}:`, clickupErr.message);
        }
      }
    }

    await fs.promises.unlink(job.filePath).catch(() => { });

    const isDuplicate = Object.values(uploadJobs).some(j => 
      j.id !== jobId && 
      j.status === 'completed' &&
      (j.originalName === job.originalName || (j.result && j.result.full === sortedName.full))
    );
    job.suspectedDuplicate = isDuplicate;

    job.status = "completed";
    job.inAiPipeline = false;
    job.aiEnriched = true;
    job.aiPipelineCompletedAt = new Date().toISOString();
    job.result = sortedName;
    job.invoiceNumber = sortedName.invoiceNumber;
    job.invoiceAmmount = sortedName.invoiceAmmount;
    saveJobs();

    console.log(`[WEB] Job ${jobId} finished.`);
  } catch (error) {
    console.error(`[WEB] Error processing job ${jobId}:`, error);
    job.status = "error";
    job.inAiPipeline = false;
    job.error = error.message;
    saveJobs();

    try {
      if (fs.existsSync(job.filePath)) await fs.promises.unlink(job.filePath).catch(() => { });
      const jpgPath = job.filePath.replace(".pdf", ".jpg");
      if (fs.existsSync(jpgPath)) await fs.promises.unlink(jpgPath).catch(() => { });
    } catch (e) { }
  }
}

// Process core queue sequentially
async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (uploadQueue.length > 0) {
    const jobId = uploadQueue.shift();
    await processSingleJob(jobId);
  }

  isProcessingQueue = false;
}

// Check Drive Folder Loop
async function checkDriveForNewFiles() {
  if (!appSettings.MONITOR_DRIVE || !appSettings.FOLDER_ID || !fs.existsSync(TOKEN_PATH)) return;

  try {
    const drive = await driveApi.getClient();
    let folderId = driveApi.isValidGoogleDriveId(appSettings.FOLDER_ID)
      ? appSettings.FOLDER_ID
      : await driveApi.findFolderId(appSettings.FOLDER_ID);
    if (!folderId) return;

    let nextPageToken = null;
    let newFound = 0;

    do {
      const res = await drive.files.list({
        q: `mimeType != 'application/vnd.google-apps.folder' and trashed=false and '${folderId}' in parents`,
        fields: "nextPageToken, files(id, name)",
        pageToken: nextPageToken,
      });

      for (const file of res.data.files || []) {
        if (!processedDriveFiles.includes(file.id)) {
          processedDriveFiles.push(file.id);
          saveJobs();

          const safeName = file.name.toLowerCase().endsWith(".pdf") ? file.name : `${file.name}.pdf`;
          const localPath = path.join(localDownloadFolder, `${Date.now()}-${safeName}`);
          try {
            const dest = fs.createWriteStream(localPath);
            const downloadRes = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "stream" });
            await pipeline(downloadRes.data, dest);

            const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
            uploadJobs[jobId] = {
              id: jobId,
              originalName: file.name,
              status: "pending",
              inAiPipeline: true,
              aiPipelineStartedAt: new Date().toISOString(),
              result: null,
              error: null,
              filePath: localPath,
              uploadDate: new Date().toISOString(),
            };
            uploadQueue.push(jobId);
            newFound++;
            saveJobs();
          } catch (downloadErr) {
            console.error("[MONITOR] Fehler beim Download:", downloadErr);
          }
        }
      }
      nextPageToken = res.data.nextPageToken;
    } while (nextPageToken);

    if (newFound > 0) {
      console.log(`[MONITOR] ${newFound} neue Dateien in Pipeline gestellt.`);
      processQueue();
    }
  } catch (error) {
    if (debug) console.error("[MONITOR] Fehler bei Ordner-Überwachung:", error);
  }
}

// File routing
// PWA Web Share Target for Android "Share with" / "Open in"
app.post("/share-target", upload.array("files"), async (req, res) => {
  try {
    if (req.files && req.files.length > 0) {
      const jobs = req.files.map((file) => {
        const job = {
          id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
          originalName: file.originalname,
          status: "pending",
          source: "share_target",
          inAiPipeline: true,
          aiPipelineStartedAt: new Date().toISOString(),
          result: null,
          error: null,
          filePath: file.path,
          uploadDate: new Date().toISOString(),
        };
        uploadJobs[job.id] = job;
        uploadQueue.push(job.id);
        return job;
      });
      saveJobs();
      processQueue();
      console.log(`[PWA SHARE] ${jobs.length} geteilte Datei(en) über Android Share Target empfangen.`);
      return res.redirect(`/?shared=true&count=${jobs.length}`);
    }
  } catch (err) {
    console.error("[PWA SHARE] Fehler beim Empfang geteilter Dateien:", err);
  }
  res.redirect("/");
});

app.get("/share-target", (req, res) => {
  res.redirect("/");
});

app.post("/api/upload", upload.array("files"), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Keine Dateien hochgeladen." });

  const jobs = req.files.map((file) => {
    const job = {
      id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
      originalName: file.originalname,
      status: "pending",
      source: "upload",
      inAiPipeline: true,
      aiPipelineStartedAt: new Date().toISOString(),
      result: null,
      error: null,
      filePath: file.path,
      uploadDate: new Date().toISOString(),
    };
    uploadJobs[job.id] = job;
    uploadQueue.push(job.id);
    return job;
  });

  saveJobs();
  processQueue();
  res.json({ success: true, jobs });
});

app.get("/api/status", async (req, res) => {
  const isAdmin = checkIsAdmin(req);
  let statuses =
    req.query.ids === "all"
      ? Object.values(uploadJobs).sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate))
      : (req.query.ids ? req.query.ids.split(",") : []).map((id) => uploadJobs[id]).filter(Boolean);

  if (!isAdmin) {
    statuses = statuses.filter(job => !job.isPrivate);
  }

  res.json({ success: true, statuses });
});

app.delete("/api/jobs", requireAdmin, (req, res) => {
  uploadJobs = {};
  uploadQueue = [];
  saveJobs();
  res.json({ success: true });
});

// Google Drive Sync Endpoints
app.get("/api/drive/sync-preview", requireAdmin, async (req, res) => {
  try {
    if (!fs.existsSync(TOKEN_PATH)) {
      return res.status(400).json({ success: false, error: "Google Drive ist nicht authentifiziert." });
    }

    const drive = await driveApi.getClient();
    let folderId = appSettings.FOLDER_ID_SORTED || appSettings.FOLDER_ID;
    if (folderId && !driveApi.isValidGoogleDriveId(folderId)) {
      folderId = await driveApi.findFolderId(folderId);
    }

    if (!folderId) {
      return res.status(400).json({ success: false, error: "Kein Google Drive Ordner in den Einstellungen hinterlegt." });
    }

    const driveFiles = [];
    let nextPageToken = null;

    do {
      const listRes = await drive.files.list({
        q: `mimeType != 'application/vnd.google-apps.folder' and trashed = false and '${folderId}' in parents`,
        fields: "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink, appProperties, description)",
        pageSize: 1000,
        pageToken: nextPageToken,
      });

      if (listRes.data.files) {
        driveFiles.push(...listRes.data.files);
      }
      nextPageToken = listRes.data.nextPageToken;
    } while (nextPageToken);

    const toImport = [];
    const needsEnrichment = [];
    const existingComplete = [];
    const skipped = [];

    const existingJobsList = Object.values(uploadJobs);

    for (const file of driveFiles) {
      if (!file.name.toLowerCase().endsWith(".pdf") && file.mimeType !== "application/pdf") {
        skipped.push({
          id: file.id,
          name: file.name,
          reason: "Keine PDF-Datei",
          size: file.size,
        });
        continue;
      }

      // Check if matching job in database
      const matchingJob = existingJobsList.find((j) => {
        if (j.rawDriveId === file.id || j.driveFileId === file.id) return true;
        if (j.result && j.result.webViewLink && j.result.webViewLink.includes(file.id)) return true;
        if (j.originalName === file.name) return true;
        if (j.result && j.result.full && (j.result.full === file.name || j.result.full + ".pdf" === file.name)) return true;
        return false;
      });

      if (matchingJob) {
        if (checkJobNeedsEnrichment(matchingJob)) {
          needsEnrichment.push({
            id: file.id,
            name: file.name,
            size: file.size,
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime,
            webViewLink: file.webViewLink,
            thumbnailLink: file.thumbnailLink,
            existingJobId: matchingJob.id,
            reason: "Metadaten unvollständig (Firma/Datum/Kategorie)",
            currentCompany: matchingJob.result?.company || "Unbekannt",
            currentCategory: matchingJob.result?.category || "-",
            currentDate: matchingJob.result?.documentDate || "-",
          });
        } else {
          existingComplete.push({
            id: file.id,
            name: file.name,
            size: file.size,
            createdTime: file.createdTime,
            modifiedTime: file.modifiedTime,
            webViewLink: file.webViewLink,
            thumbnailLink: file.thumbnailLink,
            existingJobId: matchingJob.id,
            company: matchingJob.result?.company || "-",
            category: matchingJob.result?.category || "-",
            documentDate: matchingJob.result?.documentDate || "-",
          });
        }
      } else {
        // Not in DB -> Needs to be imported
        toImport.push({
          id: file.id,
          name: file.name,
          size: file.size,
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
          thumbnailLink: file.thumbnailLink,
          reason: "Nicht in lokaler Datenbank",
        });
      }
    }

    res.json({
      success: true,
      folderId,
      totalDriveFiles: driveFiles.length,
      toImport,
      needsEnrichment,
      existingComplete,
      skipped,
      syncState: driveSyncState,
    });
  } catch (err) {
    console.error("[DRIVE SYNC PREVIEW] Fehler:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler beim Laden der Drive-Vorschau." });
  }
});

app.get("/api/drive/sync-status", requireAdmin, (req, res) => {
  res.json({
    success: true,
    syncState: driveSyncState,
    queueLength: uploadQueue.length,
    isProcessing: isProcessingQueue,
  });
});

app.post("/api/drive/sync-execute", requireAdmin, async (req, res) => {
  if (driveSyncState.running) {
    return res.status(400).json({ success: false, error: "Synchronisation läuft bereits im Hintergrund." });
  }

  const { items } = req.body; // Array of { id, name, existingJobId }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: "Keine Belege zur Synchronisation ausgewählt." });
  }

  try {
    const drive = await driveApi.getClient();

    driveSyncState = {
      running: true,
      total: items.length,
      processed: 0,
      currentFileName: items[0]?.name || "",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errors: [],
    };

    res.json({ success: true, message: "Hintergrund-Synchronisation gestartet.", total: items.length });

    // Strictly sequential background processing loop for Drive Sync
    (async () => {
      console.log(`[DRIVE SYNC] Starte streng sequenzielle Synchronisation für ${items.length} Belege...`);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          driveSyncState.currentFileName = item.name;
          console.log(`[DRIVE SYNC] [${i + 1}/${items.length}] Lade herunter: ${item.name}`);

          const safeName = item.name.toLowerCase().endsWith(".pdf") ? item.name : `${item.name}.pdf`;
          const localPath = path.join(localDownloadFolder, `${Date.now()}-${safeName}`);
          const dest = fs.createWriteStream(localPath);
          const downloadRes = await drive.files.get({ fileId: item.id, alt: "media" }, { responseType: "stream" });
          await pipeline(downloadRes.data, dest);

          let jobId = item.existingJobId;
          if (!jobId || !uploadJobs[jobId]) {
            jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
            uploadJobs[jobId] = {
              id: jobId,
              originalName: item.name,
              status: "pending",
              source: "drive_sync",
              inAiPipeline: true,
              aiPipelineStartedAt: new Date().toISOString(),
              result: null,
              error: null,
              filePath: localPath,
              rawDriveId: item.id,
              uploadDate: new Date().toISOString(),
            };
          } else {
            uploadJobs[jobId].status = "pending";
            uploadJobs[jobId].source = "drive_sync";
            uploadJobs[jobId].inAiPipeline = true;
            uploadJobs[jobId].aiPipelineStartedAt = new Date().toISOString();
            uploadJobs[jobId].filePath = localPath;
            uploadJobs[jobId].error = null;
            if (!uploadJobs[jobId].rawDriveId) uploadJobs[jobId].rawDriveId = item.id;
          }

          if (!processedDriveFiles.includes(item.id)) {
            processedDriveFiles.push(item.id);
          }
          saveJobs();

          // Process this single job immediately and wait for its completion before downloading next
          console.log(`[DRIVE SYNC] [${i + 1}/${items.length}] Verarbeite mit KI: ${item.name}`);
          await processSingleJob(jobId);

          driveSyncState.processed++;
        } catch (itemErr) {
          console.error(`[DRIVE SYNC] Fehler bei ${item.name}:`, itemErr);
          driveSyncState.errors.push({ id: item.id, name: item.name, error: itemErr.message });
          driveSyncState.processed++;
        }
      }

      console.log(`[DRIVE SYNC] Alle ${items.length} Belege erfolgreich sequenziell verarbeitet.`);
      driveSyncState.running = false;
      driveSyncState.finishedAt = new Date().toISOString();

      // Prüfe direkt den ClickUp-Status für alle Belege
      try {
        console.log("[DRIVE SYNC] Führe automatische ClickUp-Statusprüfung durch...");
        await syncClickupStatusForJobs();
      } catch (cuErr) {
        console.error("[DRIVE SYNC] Fehler bei ClickUp-Statusprüfung:", cuErr.message);
      }
    })().catch((err) => {
      console.error("[DRIVE SYNC] Unerwarteter Fehler im Hintergrund:", err);
      driveSyncState.running = false;
      driveSyncState.finishedAt = new Date().toISOString();
    });
  } catch (err) {
    console.error("[DRIVE SYNC EXECUTE] Fehler:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler beim Starten der Synchronisation." });
  }
});

// ==========================================
// --- Google Mail (Workmail) Endpoints ---
// ==========================================

// 0. Accounts Endpoints
app.get("/api/gmail/accounts", requireAdmin, async (req, res) => {
  try {
    const accounts = await gmailApi.getAccountsList();
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/gmail/accounts/delete", requireAdmin, async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ success: false, error: "accountId erforderlich" });
    const deleted = await gmailApi.removeAccount(accountId);
    const accounts = await gmailApi.getAccountsList();
    res.json({ success: deleted, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 0.1 Attachment Preview Endpoint
app.get("/api/gmail/attachment/preview", requireAdmin, async (req, res) => {
  try {
    const { messageId, attachmentId, accountId, filename, download } = req.query;
    if (!messageId || !attachmentId) {
      return res.status(400).send("messageId und attachmentId erforderlich");
    }

    const buffer = await gmailApi.downloadAttachment(messageId, attachmentId, accountId);
    const safeName = (filename || "Anhang.pdf").replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "_");

    res.setHeader("Content-Type", "application/pdf");
    if (download === "true") {
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    } else {
      res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    }
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error("[GMAIL PREVIEW] Fehler:", err);
    res.status(500).send("Fehler beim Laden des PDF-Anhangs: " + err.message);
  }
});

// 1. GET /api/gmail/inbox
app.get("/api/gmail/inbox", requireAdmin, async (req, res) => {
  try {
    if (!fs.existsSync(TOKEN_PATH)) {
      return res.status(400).json({ success: false, error: "Google Konto ist nicht authentifiziert." });
    }

    const query = req.query.query || appSettings.GMAIL_SCAN_QUERY || "in:inbox filename:pdf";
    const accountId = req.query.accountId || "all";
    const allEmails = await gmailApi.listInboxEmailsWithPdfs({ query, accountId });
    const accountsList = await gmailApi.getAccountsList();

    // Filtere übersprungene Mails heraus
    const activeEmails = [];
    let detectedCount = 0;

    for (const email of allEmails) {
      if (skippedEmails[email.id]) {
        continue;
      }
      if (email.isDetected) {
        detectedCount++;
      }
      activeEmails.push(email);
    }

    res.json({
      success: true,
      emails: activeEmails,
      accounts: accountsList,
      totalFound: allEmails.length,
      detectedCount: detectedCount,
      skippedCount: Object.keys(skippedEmails).length,
    });
  } catch (err) {
    console.error("[GMAIL] Fehler bei /api/gmail/inbox:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler beim Abrufen der Posteingangs-Mails." });
  }
});

// 2. GET /api/gmail/skipped
app.get("/api/gmail/skipped", requireAdmin, (req, res) => {
  try {
    const list = Object.values(skippedEmails).sort(
      (a, b) => new Date(b.skippedAt || b.date) - new Date(a.skippedAt || a.date)
    );
    res.json({ success: true, skippedEmails: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/gmail/skip
app.post("/api/gmail/skip", requireAdmin, (req, res) => {
  try {
    const { messageId, accountId, accountEmail, subject, from, fromName, fromEmail, date, snippet, attachments, isDetected } = req.body;
    if (!messageId) {
      return res.status(400).json({ success: false, error: "messageId erforderlich" });
    }

    skippedEmails[messageId] = {
      id: messageId,
      accountId: accountId || "",
      accountEmail: accountEmail || "",
      subject: subject || "(Kein Betreff)",
      from: from || fromName || fromEmail || "Unbekannt",
      fromName: fromName || "",
      fromEmail: fromEmail || "",
      date: date || new Date().toISOString(),
      snippet: snippet || "",
      attachments: attachments || [],
      isDetected: !!isDetected,
      skippedAt: new Date().toISOString(),
    };
    saveSkippedEmails();

    console.log(`[GMAIL] E-Mail ${messageId} zu übersprungenen Mails hinzugefügt.`);
    res.json({ success: true, skippedCount: Object.keys(skippedEmails).length });
  } catch (err) {
    console.error("[GMAIL] Fehler bei /api/gmail/skip:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/gmail/unskip
app.post("/api/gmail/unskip", requireAdmin, (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId) {
      return res.status(400).json({ success: false, error: "messageId erforderlich" });
    }

    if (skippedEmails[messageId]) {
      delete skippedEmails[messageId];
      saveSkippedEmails();
      console.log(`[GMAIL] E-Mail ${messageId} aus übersprungenen Mails entfernt.`);
    }

    res.json({ success: true, skippedCount: Object.keys(skippedEmails).length });
  } catch (err) {
    console.error("[GMAIL] Fehler bei /api/gmail/unskip:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST /api/gmail/process
app.post("/api/gmail/process", requireAdmin, async (req, res) => {
  try {
    const { messageId, accountId, subject, fromName, fromEmail, date, attachmentIds, archive } = req.body;
    if (!messageId) {
      return res.status(400).json({ success: false, error: "messageId erforderlich" });
    }

    const shouldArchive = archive !== undefined ? !!archive : appSettings.GMAIL_AUTO_ARCHIVE !== false;

    // Falls attachmentIds nicht explizit übergeben wurden, Anhänge aus Mail laden
    let attachmentsToProcess = [];
    if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
      attachmentsToProcess = attachmentIds;
    } else {
      const gmail = await gmailApi.getClient(accountId);
      const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
      const foundAttachments = [];
      gmailApi.extractPdfParts(msg.data.payload?.parts || [], foundAttachments);
      attachmentsToProcess = foundAttachments;
    }

    if (attachmentsToProcess.length === 0) {
      return res.status(400).json({ success: false, error: "Keine PDF-Anhänge in dieser E-Mail gefunden." });
    }

    const createdJobs = [];

    for (const att of attachmentsToProcess) {
      const attId = typeof att === "string" ? att : att.attachmentId;
      const attName = typeof att === "object" && att.filename ? att.filename : `Email_Anhang_${Date.now()}.pdf`;

      // Dateinamen bereinigen
      const safeFilename = attName.replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "_");
      const localFilePath = path.join(localDownloadFolder, `${Date.now()}-${safeFilename}`);

      // Buffer herunterladen & speichern
      const buffer = await gmailApi.downloadAttachment(messageId, attId, accountId);
      await fs.promises.writeFile(localFilePath, buffer);

      const job = {
        id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
        originalName: attName,
        status: "pending",
        source: "gmail",
        gmailMessageId: messageId,
        gmailAccountId: accountId || "",
        emailSubject: subject || "",
        emailSender: fromName ? `${fromName} <${fromEmail}>` : fromEmail || "",
        emailDate: date || new Date().toISOString(),
        inAiPipeline: true,
        aiPipelineStartedAt: new Date().toISOString(),
        result: null,
        error: null,
        filePath: localFilePath,
        uploadDate: new Date().toISOString(),
      };

      uploadJobs[job.id] = job;
      uploadQueue.push(job.id);
      createdJobs.push(job);
    }

    saveJobs();
    processQueue();

    // Falls vorher übersprungen, aus der Liste entfernen
    if (skippedEmails[messageId]) {
      delete skippedEmails[messageId];
      saveSkippedEmails();
    }

    // Optional: Archivieren
    let archived = false;
    if (shouldArchive) {
      try {
        await gmailApi.archiveEmail(messageId, accountId);
        archived = true;
      } catch (archErr) {
        console.error(`[GMAIL] Archivieren für Mail ${messageId} (${accountId}):`, archErr.message);
      }
    }

    res.json({
      success: true,
      jobs: createdJobs,
      archived: archived,
      message: `${createdJobs.length} Beleg(e) in Pipeline gestellt.${archived ? " E-Mail wurde archiviert." : ""}`,
    });
  } catch (err) {
    console.error("[GMAIL] Fehler bei /api/gmail/process:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler bei der E-Mail-Verarbeitung." });
  }
});

// 6. POST /api/gmail/process-batch
app.post("/api/gmail/process-batch", requireAdmin, async (req, res) => {
  try {
    const { items, archive } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Keine E-Mails zum Verarbeiten übergeben." });
    }

    const shouldArchive = archive !== undefined ? !!archive : appSettings.GMAIL_AUTO_ARCHIVE !== false;
    const createdJobs = [];
    const errors = [];
    let archivedCount = 0;

    for (const item of items) {
      const messageId = item.messageId || item.id;
      const accountId = item.accountId || "";
      if (!messageId) continue;

      try {
        let attachments = item.attachments || [];
        if (attachments.length === 0) {
          const gmail = await gmailApi.getClient(accountId);
          const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
          const found = [];
          gmailApi.extractPdfParts(msg.data.payload?.parts || [], found);
          attachments = found;
        }

        for (const att of attachments) {
          const attId = att.attachmentId;
          const attName = att.filename || "Anhang.pdf";
          const safeFilename = attName.replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "_");
          const localFilePath = path.join(localDownloadFolder, `${Date.now()}-${safeFilename}`);

          const buffer = await gmailApi.downloadAttachment(messageId, attId, accountId);
          await fs.promises.writeFile(localFilePath, buffer);

          const job = {
            id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
            originalName: attName,
            status: "pending",
            source: "gmail",
            gmailMessageId: messageId,
            gmailAccountId: accountId,
            emailSubject: item.subject || "",
            emailSender: item.fromName ? `${item.fromName} <${item.fromEmail}>` : item.from || item.fromEmail || "",
            emailDate: item.date || new Date().toISOString(),
            inAiPipeline: true,
            aiPipelineStartedAt: new Date().toISOString(),
            result: null,
            error: null,
            filePath: localFilePath,
            uploadDate: new Date().toISOString(),
          };

          uploadJobs[job.id] = job;
          uploadQueue.push(job.id);
          createdJobs.push(job);
        }

        if (skippedEmails[messageId]) {
          delete skippedEmails[messageId];
        }

        if (shouldArchive) {
          try {
            await gmailApi.archiveEmail(messageId, accountId);
            archivedCount++;
          } catch (archErr) {
            console.error(`[GMAIL BATCH] Archivieren für Mail ${messageId}:`, archErr.message);
          }
        }
      } catch (itemErr) {
        console.error(`[GMAIL BATCH] Fehler bei Mail ${messageId}:`, itemErr);
        errors.push({ messageId, error: itemErr.message });
      }
    }

    saveJobs();
    saveSkippedEmails();
    processQueue();

    res.json({
      success: true,
      processedCount: items.length - errors.length,
      totalJobs: createdJobs.length,
      archivedCount: archivedCount,
      errors: errors,
    });
  } catch (err) {
    console.error("[GMAIL] Fehler bei /api/gmail/process-batch:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler beim Verarbeiten der E-Mails." });
  }
});

// Prepared background monitoring function
async function checkGmailForNewFiles() {
  if (!appSettings.MONITOR_GMAIL || !fs.existsSync(TOKEN_PATH)) return;

  try {
    const unarchivedEmails = await gmailApi.listInboxEmailsWithPdfs({ query: appSettings.GMAIL_SCAN_QUERY });
    if (!unarchivedEmails || unarchivedEmails.length === 0) return;

    let newCount = 0;
    for (const email of unarchivedEmails) {
      if (skippedEmails[email.id]) continue;

      // Check if already processed
      const alreadyProcessed = Object.values(uploadJobs).some(
        (j) => j.source === "gmail" && j.gmailMessageId === email.id
      );
      if (alreadyProcessed) continue;

      for (const att of email.attachments) {
        const safeFilename = att.filename.replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "_");
        const localFilePath = path.join(localDownloadFolder, `${Date.now()}-${safeFilename}`);
        const buffer = await gmailApi.downloadAttachment(email.id, att.attachmentId);
        await fs.promises.writeFile(localFilePath, buffer);

        const job = {
          id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
          originalName: att.filename,
          status: "pending",
          source: "gmail",
          gmailMessageId: email.id,
          emailSubject: email.subject || "",
          emailSender: email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail || "",
          emailDate: email.date || new Date().toISOString(),
          inAiPipeline: true,
          aiPipelineStartedAt: new Date().toISOString(),
          result: null,
          error: null,
          filePath: localFilePath,
          uploadDate: new Date().toISOString(),
        };

        uploadJobs[job.id] = job;
        uploadQueue.push(job.id);
        newCount++;
      }

      if (appSettings.GMAIL_AUTO_ARCHIVE !== false) {
        try {
          await gmailApi.archiveEmail(email.id);
        } catch (e) { }
      }
    }

    if (newCount > 0) {
      saveJobs();
      processQueue();
      console.log(`[GMAIL MONITOR] ${newCount} neue Anhänge aus Posteingang in Pipeline gestellt.`);
    }
  } catch (err) {
    if (debug) console.error("[GMAIL MONITOR] Fehler:", err.message);
  }
}


app.post("/api/jobs/:id/private", requireAdmin, async (req, res) => {
  const jobId = req.params.id;
  const isPrivate = req.body.isPrivate;
  const job = uploadJobs[jobId];
  if (job) {
    job.isPrivate = isPrivate;
    saveJobs();

    const appProps = isPrivate ? { isPrivate: 'true' } : { isPrivate: null };
    const promises = [];

    // Extract sorted file ID from webViewLink
    if (job.result && job.result.webViewLink) {
      const match = job.result.webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match) promises.push(driveApi.updateFileProperties(match[1], appProps));
    }

    // Also update raw backup file if it exists
    if (job.rawDriveId) {
      promises.push(driveApi.updateFileProperties(job.rawDriveId, appProps));
    }

    try {
      await Promise.all(promises);
    } catch (e) {
      console.error("Error updating drive file properties:", e);
    }

    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

app.post("/api/jobs/:id/category", requireAdmin, (req, res) => {
  const jobId = req.params.id;
  const newCategory = req.body.category;
  if (uploadJobs[jobId] && uploadJobs[jobId].result) {
    uploadJobs[jobId].result.category = newCategory;
    saveJobs();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

app.post("/api/jobs/:id/target-company", requireAdmin, (req, res) => {
  const jobId = req.params.id;
  const targetCompany = req.body.targetCompany;
  if (uploadJobs[jobId]) {
    uploadJobs[jobId].targetCompany = targetCompany;
    saveJobs();
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: "Job not found" });
  }
});

async function searchLexofficeVouchers(apiKey, { invoiceNumber, fileName, amountInCents, documentDate, company }) {
  if (!apiKey) return { found: false, matches: [] };

  try {
    const cleanInvNum = invoiceNumber && invoiceNumber !== "none" && invoiceNumber !== "-" ? invoiceNumber.trim() : null;
    const targetAmountEuro = amountInCents !== undefined && amountInCents !== null ? amountInCents / 100 : null;
    const cleanFileName = fileName ? fileName.trim().toLowerCase() : null;
    const cleanCompany = company && company !== "-" ? company.trim().toLowerCase() : null;

    let url = "https://api.lexoffice.io/v1/voucherlist?voucherType=purchaseinvoice,purchasecreditnote,salesinvoice,salescreditnote&page=0&size=100";
    if (cleanInvNum) {
      url = `https://api.lexoffice.io/v1/voucherlist?voucherNumber=${encodeURIComponent(cleanInvNum)}`;
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      if (cleanInvNum) {
        const fbRes = await fetch("https://api.lexoffice.io/v1/voucherlist?voucherType=purchaseinvoice,purchasecreditnote,salesinvoice,salescreditnote&page=0&size=100", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!fbRes.ok) return { found: false, matches: [], error: `Lexoffice API Status ${res.status}` };
        const fbData = await fbRes.json();
        return matchLexofficeList(fbData.content || [], { cleanInvNum, targetAmountEuro, cleanFileName, documentDate, cleanCompany });
      }
      return { found: false, matches: [], error: `Lexoffice API Status ${res.status}` };
    }

    const data = await res.json();
    return matchLexofficeList(data.content || [], { cleanInvNum, targetAmountEuro, cleanFileName, documentDate, cleanCompany });
  } catch (err) {
    return { found: false, matches: [], error: err.message };
  }
}

function matchLexofficeList(vouchers, { cleanInvNum, targetAmountEuro, cleanFileName, documentDate, cleanCompany }) {
  const matches = [];

  for (const v of vouchers) {
    const matchReasons = [];
    const vNum = (v.voucherNumber || "").toLowerCase();
    const vDate = v.voucherDate || "";
    const vAmount = parseFloat(v.totalAmount || "0");
    const vContact = (v.contactName || "").toLowerCase();
    const vStatus = v.voucherStatus || "offen";

    // 1. Invoice Number Match
    if (cleanInvNum && vNum && (vNum.includes(cleanInvNum.toLowerCase()) || cleanInvNum.toLowerCase().includes(vNum))) {
      matchReasons.push(`Rechnungsnummer stimmt überein (${v.voucherNumber})`);
    }

    // 2. Amount Match
    if (targetAmountEuro !== null && vAmount > 0 && Math.abs(vAmount - targetAmountEuro) < 0.02) {
      matchReasons.push(`Betrag stimmt überein (${vAmount.toFixed(2).replace(".", ",")} €)`);
    }

    // 3. Date Match
    if (documentDate && documentDate !== "-" && documentDate !== "unknown" && vDate.startsWith(documentDate)) {
      matchReasons.push(`Belegdatum stimmt überein (${documentDate})`);
    }

    // 4. Contact / Company Match
    if (cleanCompany && vContact && (vContact.includes(cleanCompany) || cleanCompany.includes(vContact))) {
      matchReasons.push(`Lieferant / Kontakt stimmt überein (${v.contactName})`);
    }

    if (matchReasons.length > 0) {
      matches.push({
        id: v.id,
        voucherNumber: v.voucherNumber || "-",
        voucherDate: v.voucherDate || "-",
        voucherStatus: vStatus,
        totalAmount: vAmount > 0 ? `${vAmount.toFixed(2).replace(".", ",")} €` : "-",
        contactName: v.contactName || "-",
        voucherType: v.voucherType || "Rechnung",
        matchReasons,
        score: matchReasons.length,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return { found: matches.length > 0, matches };
}

// Accounting Endpoints (Lexoffice & BuchhaltungsButler) - Admin only
app.post(["/api/accounting/check", "/api/lexoffice/check"], requireAdmin, async (req, res) => {
  const { jobId, companyKey } = req.body;
  const job = uploadJobs[jobId];
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden" });

  const validCompanies = ["wirewire", "thewire", "polyxo"];
  const configuredCompanies = {
    wirewire: !!(appSettings.LEXOFFICE_KEY_WIREWIRE && appSettings.LEXOFFICE_KEY_WIREWIRE.trim()),
    thewire: !!(
      appSettings.BUTTLER_KEY_THEWIRE_CLIENT &&
      appSettings.BUTTLER_KEY_THEWIRE_SECRET &&
      appSettings.BUTTLER_KEY_THEWIRE_KEY &&
      appSettings.BUTTLER_KEY_THEWIRE_CLIENT.trim() &&
      appSettings.BUTTLER_KEY_THEWIRE_SECRET.trim() &&
      appSettings.BUTTLER_KEY_THEWIRE_KEY.trim()
    ),
    polyxo: !!(appSettings.LEXOFFICE_KEY_POLYXO && appSettings.LEXOFFICE_KEY_POLYXO.trim()),
  };

  // Determine suggested company
  let suggestedCompany = job.targetCompany;
  if (!suggestedCompany && job.result && job.result.company) {
    const c = job.result.company.toLowerCase();
    if (c.includes("wirewire")) suggestedCompany = "wirewire";
    else if (c.includes("the wire") || c.includes("thewire")) suggestedCompany = "thewire";
    else if (c.includes("polyxo")) suggestedCompany = "polyxo";
  }
  if (!suggestedCompany || !validCompanies.includes(suggestedCompany)) {
    suggestedCompany = "wirewire";
  }

  const targetComp = companyKey && validCompanies.includes(companyKey) ? companyKey : suggestedCompany;

  let provider = "lexoffice";
  let providerName = "Lexoffice";
  let apiValid = false;
  let apiError = null;
  let organizationName = null;
  let liveSearch = { performed: false, found: false, matches: [] };

  const invNum = job.result?.invoiceNumber || job.invoiceNumber || "";
  const docDate = job.result?.documentDate || "";
  const invAmt = job.result?.invoiceAmmount !== undefined ? job.result.invoiceAmmount : (job.invoiceAmmount || 0);
  const compName = job.result?.company || "";
  const fileName = job.result?.full || job.originalName || "";

  if (targetComp === "thewire") {
    provider = "buchhaltungsbutler";
    providerName = "BuchhaltungsButler";
    const client = (appSettings.BUTTLER_KEY_THEWIRE_CLIENT || "").trim();
    const secret = (appSettings.BUTTLER_KEY_THEWIRE_SECRET || "").trim();
    const key = (appSettings.BUTTLER_KEY_THEWIRE_KEY || "").trim();

    if (client && secret && key) {
      const verifyRes = await butlerApi.verifyConnection({ client, secret, key });
      apiValid = verifyRes.valid;
      apiError = verifyRes.error || null;
      organizationName = verifyRes.organizationName || "The Wire UG";

      if (apiValid) {
        // Live search for matching vouchers in BuchhaltungsButler
        const searchRes = await butlerApi.searchReceipts({
          client,
          secret,
          key,
          invoiceNumber: invNum,
          fileName,
          amountInCents: invAmt,
          documentDate: docDate,
          company: compName,
        });
        liveSearch = {
          performed: true,
          found: searchRes.found,
          matches: searchRes.matches || [],
          error: searchRes.error,
        };
      }
    } else {
      apiValid = false;
      apiError = "BuchhaltungsButler Zugangsdaten (Client, Secret, Key) für The Wire fehlen in den Einstellungen.";
    }
  } else {
    // wirewire or polyxo -> Lexoffice
    provider = "lexoffice";
    providerName = "Lexoffice";
    const apiKeySettingName = `LEXOFFICE_KEY_${targetComp.toUpperCase()}`;
    const apiKey = (appSettings[apiKeySettingName] || "").trim();

    if (apiKey) {
      try {
        const apiRes = await fetch("https://api.lexoffice.io/v1/profile", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (apiRes.ok) {
          apiValid = true;
          const profData = await apiRes.json().catch(() => ({}));
          organizationName = profData.companyName || profData.name || null;

          // Live search for matching vouchers in Lexoffice
          const searchRes = await searchLexofficeVouchers(apiKey, {
            invoiceNumber: invNum,
            fileName,
            amountInCents: invAmt,
            documentDate: docDate,
            company: compName,
          });
          liveSearch = {
            performed: true,
            found: searchRes.found,
            matches: searchRes.matches || [],
            error: searchRes.error,
          };
        } else {
          apiValid = false;
          apiError = `Lexoffice API Fehler (${apiRes.status}): Ungültiger API-Key oder keine Berechtigung.`;
        }
      } catch (err) {
        apiValid = false;
        apiError = `Verbindungsfehler zu Lexoffice: ${err.message}`;
      }
    } else {
      apiError = `Kein API-Key für Lexoffice (${targetComp}) in den Einstellungen hinterlegt.`;
    }
  }

  const alreadyTransferred = !!(job.lexofficeTransfers && job.lexofficeTransfers[targetComp]);
  const transferredInfo = alreadyTransferred ? job.lexofficeTransfers[targetComp] : null;

  res.json({
    success: true,
    jobId: job.id,
    provider,
    providerName,
    selectedCompany: targetComp,
    suggestedCompany,
    configuredCompanies,
    apiValid,
    apiError,
    organizationName,
    alreadyTransferred,
    transferredInfo,
    liveSearch,
    allTransfers: job.lexofficeTransfers || {},
    documentDetails: {
      title: job.result?.full || job.originalName,
      documentDate: job.result?.documentDate || "-",
      invoiceNumber: job.result?.invoiceNumber || job.invoiceNumber || "none",
      invoiceAmmount: job.result?.invoiceAmmount !== undefined ? job.result.invoiceAmmount : (job.invoiceAmmount || 0),
      company: job.result?.company || "-",
      category: job.result?.category || "-",
      localThumbnail: job.result?.localThumbnail,
      thumbnailLink: job.result?.thumbnailLink,
      webViewLink: job.result?.webViewLink,
      rawDriveId: job.rawDriveId,
    },
  });
});

app.post("/api/accounting/mark-synced", requireAdmin, async (req, res) => {
  const { jobId, companyKey, fileId } = req.body;
  const job = uploadJobs[jobId];
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden" });

  if (!job.lexofficeTransfers) job.lexofficeTransfers = {};
  const provider = companyKey === "thewire" ? "buchhaltungsbutler" : "lexoffice";
  job.lexofficeTransfers[companyKey] = {
    provider,
    fileId: fileId || `manual_${Date.now()}`,
    transferredAt: new Date().toISOString(),
    manuallyMatched: true,
  };
  saveJobs();
  res.json({ success: true, allTransfers: job.lexofficeTransfers });
});

app.post(["/api/accounting/transfer", "/api/lexoffice/transfer"], requireAdmin, async (req, res) => {
  const { jobId, companyKey, force } = req.body;
  const validCompanies = ["wirewire", "thewire", "polyxo"];
  if (!validCompanies.includes(companyKey)) {
    return res.status(400).json({ success: false, error: "Ungültige Zielfirma." });
  }

  const job = uploadJobs[jobId];
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });

  if (job.lexofficeTransfers && job.lexofficeTransfers[companyKey] && !force) {
    const existing = job.lexofficeTransfers[companyKey];
    const pName = existing.provider === "buchhaltungsbutler" ? "BuchhaltungsButler" : "Lexoffice";
    return res.json({
      success: false,
      alreadyTransferred: true,
      transferredInfo: existing,
      error: `Dokument wurde bereits am ${new Date(existing.transferredAt).toLocaleString("de-DE")} zu ${pName} (${companyKey}) übertragen.`,
    });
  }

  try {
    let fileBuffer = await getJobPdfBuffer(job);
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "Datei ist nicht mehr auf dem Server oder Google Drive vorhanden." });
    }

    let fileName = (job.result && job.result.full ? job.result.full : job.originalName) || "Dokument.pdf";
    if (!fileName.toLowerCase().endsWith(".pdf")) fileName += ".pdf";

    // Auto-compress if file size exceeds 3.5 MB
    const MAX_BYTES = 3.5 * 1024 * 1024;
    if (fileBuffer && fileBuffer.length > MAX_BYTES) {
      console.log(`[ACCOUNTING] Datei-Größe (${(fileBuffer.length / (1024*1024)).toFixed(2)} MB) übersteigt 3.5 MB Schwelle. Komprimiere PDF...`);
      const tempIn = path.join(localDownloadFolder, `compress_in_${Date.now()}.pdf`);
      const tempOut = path.join(localDownloadFolder, `compress_out_${Date.now()}.pdf`);
      try {
        await fs.promises.writeFile(tempIn, fileBuffer);
        await new Promise((resolve, reject) => {
          execFile(
            getPythonPath(),
            [path.join(__dirname, "app", "compress_pdf.py"), tempIn, tempOut],
            (error, stdout, stderr) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });
        if (fs.existsSync(tempOut)) {
          fileBuffer = await fs.promises.readFile(tempOut);
          console.log(`[ACCOUNTING] Datei erfolgreich auf ${(fileBuffer.length / (1024*1024)).toFixed(2)} MB komprimiert.`);
        }
      } catch (compressErr) {
        console.error("[ACCOUNTING] Komprimierungs-Warnung:", compressErr);
      } finally {
        if (fs.existsSync(tempIn)) fs.promises.unlink(tempIn).catch(() => {});
        if (fs.existsSync(tempOut)) fs.promises.unlink(tempOut).catch(() => {});
      }
    }

    if (companyKey === "thewire") {
      // Transfer to BuchhaltungsButler
      const client = (appSettings.BUTTLER_KEY_THEWIRE_CLIENT || "").trim();
      const secret = (appSettings.BUTTLER_KEY_THEWIRE_SECRET || "").trim();
      const key = (appSettings.BUTTLER_KEY_THEWIRE_KEY || "").trim();

      if (!client || !secret || !key) {
        return res.status(400).json({
          success: false,
          error: "BuchhaltungsButler Zugangsdaten für The Wire fehlen in den Einstellungen.",
        });
      }

      const butlerRes = await butlerApi.uploadReceipt({
        fileBuffer,
        fileName,
        client,
        secret,
        key,
        type: "expense", // Immer Ausgabe
      });

      if (!butlerRes.success) {
        return res.status(500).json({
          success: false,
          error: butlerRes.error || "Fehler beim Upload zu BuchhaltungsButler.",
        });
      }

      if (!job.lexofficeTransfers) job.lexofficeTransfers = {};
      job.lexofficeTransfers[companyKey] = {
        provider: "buchhaltungsbutler",
        transferredAt: butlerRes.transferredAt,
        fileId: butlerRes.fileId,
        lexofficeFileId: butlerRes.fileId, // Backwards compatibility
        company: companyKey,
      };
      job.targetCompany = companyKey;
      saveJobs();

      console.log(`[BUTLER] Job ${jobId} erfolgreich zu BuchhaltungsButler (${companyKey}) übertragen (ID: ${butlerRes.fileId})`);
      return res.json({
        success: true,
        provider: "buchhaltungsbutler",
        providerName: "BuchhaltungsButler",
        fileId: butlerRes.fileId,
        lexofficeFileId: butlerRes.fileId,
        transferredAt: butlerRes.transferredAt,
        company: companyKey,
      });
    } else {
      // Transfer to Lexoffice (wirewire or polyxo)
      const apiKeySettingName = `LEXOFFICE_KEY_${companyKey.toUpperCase()}`;
      const apiKey = appSettings[apiKeySettingName];
      if (!apiKey || !apiKey.trim()) {
        return res.status(400).json({
          success: false,
          error: `Kein API-Key für Lexoffice (${companyKey}) in den Einstellungen hinterlegt.`,
        });
      }

      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: "application/pdf" });
      formData.append("file", blob, fileName);
      formData.append("type", "voucher");

      const lexResponse = await fetch("https://api.lexoffice.io/v1/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: formData,
      });

      if (!lexResponse.ok) {
        const errText = await lexResponse.text();
        console.error("[LEXOFFICE] Upload Fehler:", lexResponse.status, errText);
        return res.status(lexResponse.status).json({
          success: false,
          error: `Lexoffice API Fehler (${lexResponse.status}): ${errText}`,
        });
      }

      const lexData = await lexResponse.json();
      if (!job.lexofficeTransfers) job.lexofficeTransfers = {};
      job.lexofficeTransfers[companyKey] = {
        provider: "lexoffice",
        transferredAt: new Date().toISOString(),
        fileId: lexData.id,
        lexofficeFileId: lexData.id,
        company: companyKey,
      };
      job.targetCompany = companyKey;
      saveJobs();

      console.log(`[LEXOFFICE] Job ${jobId} erfolgreich zu Lexoffice (${companyKey}) übertragen (ID: ${lexData.id})`);
      return res.json({
        success: true,
        provider: "lexoffice",
        providerName: "Lexoffice",
        fileId: lexData.id,
        lexofficeFileId: lexData.id,
        transferredAt: job.lexofficeTransfers[companyKey].transferredAt,
        company: companyKey,
      });
    }
  } catch (err) {
    console.error("[ACCOUNTING] Fehler bei Übertragung:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler bei der Übertragung." });
  }
});

// Helper: Get PDF Buffer for a job (from local disk or Google Drive)
async function getJobPdfBuffer(job) {
  if (job.filePath && fs.existsSync(job.filePath)) {
    return await fs.promises.readFile(job.filePath);
  }

  let driveFileId = job.rawDriveId;
  if (!driveFileId && job.result && job.result.webViewLink) {
    const match = job.result.webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) driveFileId = match[1];
  }

  if (!driveFileId) return null;

  try {
    const drive = await driveApi.getClient();
    const driveRes = await drive.files.get({ fileId: driveFileId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(driveRes.data);
  } catch (e) {
    console.error(`[PDF BUFFER] Fehler beim Laden der Datei aus Google Drive (ID ${driveFileId}):`, e);
    return null;
  }
}

// ClickUp Endpoints (Admin only)
app.post("/api/clickup/verify", requireAdmin, async (req, res) => {
  try {
    const apiKey = (req.body.apiKey !== undefined ? req.body.apiKey : appSettings.CLICKUP_API_KEY) || process.env.CLICKUP_API_KEY;
    const listId = (req.body.listId !== undefined ? req.body.listId : appSettings.CLICKUP_LIST_ID) || process.env.CLICKUP_LIST_ID || "";
    const testApi = new ClickUpAPI(apiKey, listId);
    const result = await testApi.verifyConnection(listId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/clickup/transfer", requireAdmin, async (req, res) => {
  const { jobId, force } = req.body;
  const job = uploadJobs[jobId];
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });

  if (job.clickup && job.clickup.taskId && !force) {
    return res.json({
      success: false,
      alreadyTransferred: true,
      clickup: job.clickup,
      error: `Dokument wurde bereits am ${new Date(job.clickup.transferredAt).toLocaleString("de-DE")} zu ClickUp übertragen (Task #${job.clickup.taskId}).`,
    });
  }

  try {
    const fileBuffer = await getJobPdfBuffer(job);
    const fileName = (job.result && job.result.full ? job.result.full : job.originalName) || "Dokument.pdf";
    const safeFileName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;

    const clickupRes = await clickupApi.createOrUpdateDocumentTask({
      fileBuffer: fileBuffer,
      fileName: safeFileName,
      aiResult: job.result || {},
      existingTaskId: force && job.clickup ? job.clickup.taskId : null,
      listId: appSettings.CLICKUP_LIST_ID,
      uploadAttachment: !!fileBuffer,
    });

    job.clickup = {
      taskId: clickupRes.taskId,
      taskUrl: clickupRes.taskUrl,
      taskName: clickupRes.taskName,
      status: clickupRes.status,
      transferredAt: new Date().toISOString(),
    };
    saveJobs();
          console.log(`[CLICKUP] Job ${jobId} manuell zu ClickUp übertragen (Task ${clickupRes.taskId})`);
    res.json({ success: true, clickup: job.clickup, isUpdated: clickupRes.isUpdated });
  } catch (err) {
    console.error("[CLICKUP] Fehler bei manueller Übertragung:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler bei der Übertragung zu ClickUp." });
  }
});

app.get("/api/clickup/sync-preview", requireAdmin, async (req, res) => {
  try {
    if (!appSettings.CLICKUP_API_KEY) {
      return res.status(400).json({ success: false, error: "Kein ClickUp API-Key hinterlegt." });
    }

    const clickupTasks = await clickupApi.fetchListTasks(appSettings.CLICKUP_LIST_ID);
    const jobsList = Object.values(uploadJobs).filter((j) => j.status === "completed" && j.result);

    const toCreate = [];
    const toUpdate = [];
    const upToDate = [];
    const toSkip = [];

    for (const job of jobsList) {
      const isPrivate =
        job.isPrivate ||
        (job.result.company && job.result.company.toLowerCase().includes("daniel")) ||
        (job.result.category && job.result.category.toLowerCase() === "privat");

      if (appSettings.CLICKUP_FILTER_PRIVATE && isPrivate) {
        toSkip.push({
          jobId: job.id,
          fileName: job.result.full || job.originalName,
          company: job.result.company || "Unbekannt",
          category: job.result.category || "-",
          reason: "Privates Dokument (Filter aktiv)",
        });
        continue;
      }

      const matchingTask = clickupApi.findMatchingTask(job, clickupTasks);
      if (matchingTask) {
        const isCurrent = clickupApi.isTaskUpToDate(job, matchingTask);
        const itemInfo = {
          jobId: job.id,
          fileName: job.result.full || job.originalName,
          company: job.result.company || "Unbekannt",
          category: job.result.category || "-",
          isInvoice: !!job.result.isInvoice,
          amount: job.result.invoiceAmmount ? clickupApi.formatAmount(job.result.invoiceAmmount) : "",
          existingTaskId: matchingTask.id,
          existingTaskName: matchingTask.name,
          existingTaskStatus: matchingTask.status?.status || "offen",
          existingTaskUrl: matchingTask.url || `https://app.clickup.com/t/${matchingTask.id}`,
        };

        if (isCurrent) {
          upToDate.push(itemInfo);
        } else {
          toUpdate.push(itemInfo);
        }
      } else {
        toCreate.push({
          jobId: job.id,
          fileName: job.result.full || job.originalName,
          company: job.result.company || "Unbekannt",
          category: job.result.category || "-",
          isInvoice: !!job.result.isInvoice,
          amount: job.result.invoiceAmmount ? clickupApi.formatAmount(job.result.invoiceAmmount) : "",
          suggestedTaskName: clickupApi.generateTaskName(job.result),
        });
      }
    }

    res.json({
      success: true,
      totalJobs: jobsList.length,
      totalClickupTasks: clickupTasks.length,
      toCreate,
      toUpdate,
      upToDate,
      toSkip,
    });
  } catch (err) {
    console.error("[CLICKUP] Fehler bei Sync-Vorschau:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler beim Erstellen der Sync-Vorschau." });
  }
});

app.post("/api/clickup/sync-all", requireAdmin, async (req, res) => {
  try {
    if (!appSettings.CLICKUP_API_KEY) {
      return res.status(400).json({ success: false, error: "Kein ClickUp API-Key hinterlegt." });
    }

    const { selectedJobIds } = req.body;
    const clickupTasks = await clickupApi.fetchListTasks(appSettings.CLICKUP_LIST_ID);
    const jobsList = Object.values(uploadJobs).filter((j) => {
      if (j.status !== "completed" || !j.result) return false;
      if (selectedJobIds && Array.isArray(selectedJobIds)) {
        return selectedJobIds.includes(j.id);
      }
      return true;
    });

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const job of jobsList) {
      const isPrivate =
        job.isPrivate ||
        (job.result.company && job.result.company.toLowerCase().includes("daniel")) ||
        (job.result.category && job.result.category.toLowerCase() === "privat");

      if (appSettings.CLICKUP_FILTER_PRIVATE && isPrivate) {
        skippedCount++;
        continue;
      }

      try {
        const matchingTask = clickupApi.findMatchingTask(job, clickupTasks);

        // Wenn keine spezifische Auswahl vorliegt und Task bereits aktuell ist, überspringen
        if (!selectedJobIds && matchingTask && clickupApi.isTaskUpToDate(job, matchingTask)) {
          if (!job.clickup || !job.clickup.taskId) {
            job.clickup = {
              taskId: matchingTask.id,
              taskUrl: matchingTask.url || `https://app.clickup.com/t/${matchingTask.id}`,
              taskName: matchingTask.name,
              status: matchingTask.status?.status || "offen",
              transferredAt: new Date().toISOString(),
            };
          }
          skippedCount++;
          continue;
        }

        const fileBuffer = await getJobPdfBuffer(job);
        const fileName = (job.result && job.result.full ? job.result.full : job.originalName) || "Dokument.pdf";
        const safeFileName = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;

        const clickupRes = await clickupApi.createOrUpdateDocumentTask({
          fileBuffer: fileBuffer,
          fileName: safeFileName,
          aiResult: job.result || {},
          existingTaskId: matchingTask ? matchingTask.id : null,
          listId: appSettings.CLICKUP_LIST_ID,
          uploadAttachment: !!fileBuffer && !matchingTask,
        });

        job.clickup = {
          taskId: clickupRes.taskId,
          taskUrl: clickupRes.taskUrl,
          taskName: clickupRes.taskName,
          status: clickupRes.status,
          transferredAt: new Date().toISOString(),
        };

        if (clickupRes.isUpdated) {
          updatedCount++;
        } else {
          createdCount++;
        }
      } catch (err) {
        console.error(`[CLICKUP] Fehler bei Sync für Job ${job.id}:`, err);
        errors.push({ jobId: job.id, error: err.message });
      }
    }

    saveJobs();

    console.log(`[CLICKUP] Sync All abgeschlossen: ${createdCount} erstellt, ${updatedCount} aktualisiert, ${skippedCount} übersprungen.`);
    res.json({
      success: true,
      createdCount,
      updatedCount,
      skippedCount,
      errors,
    });
  } catch (err) {
    console.error("[CLICKUP] Fehler bei Gesamtsynchronisation:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler bei der Gesamtsynchronisation." });
  }
});

app.post("/api/scan", upload.array("images", 50), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Keine Bilder hochgeladen." });

  const outputPdfPath = path.join(localDownloadFolder, `Scanned_${Date.now()}.pdf`);
  const coordsList = req.body.coords || [];
  const algorithm = req.body.algorithm || "color_enhanced";
  const autoQueue = req.body.autoQueue === "true";

  console.log(`[SCANNER] Starte Verarbeitung für ${req.files.length} Seite(n) mit Modus ${algorithm}`);

  try {
    const tempPdfs = [];
    const runScannerTask = (inputPath, tempPdfPath, coordsStr) =>
      new Promise((resolve, reject) => {
        execFile(
          process.platform === "win32" ? ".\\venv\\Scripts\\python.exe" : "./venv/bin/python",
          ["./app/scanner.py", inputPath, tempPdfPath, coordsStr, algorithm],
          (error, stdout, stderr) => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (error) {
              console.error(`[SCANNER]: ${error.message}`);
              reject(error);
            } else resolve(tempPdfPath);
          },
        );
      });

    for (let i = 0; i < req.files.length; i++) {
      tempPdfs.push(
        await runScannerTask(
          req.files[i].path,
          path.join(localDownloadFolder, `temp_${Date.now()}_${i}.pdf`),
          Array.isArray(coordsList) ? coordsList[i] || "" : i === 0 ? coordsList : "",
        ),
      );
    }

    if (tempPdfs.length === 1) {
      fs.renameSync(tempPdfs[0], outputPdfPath);
      const tempJpg = tempPdfs[0].replace(".pdf", ".jpg");
      if (fs.existsSync(tempJpg)) fs.renameSync(tempJpg, outputPdfPath.replace(".pdf", ".jpg"));
    } else {
      const mergedPdf = await PDFDocument.create();
      for (const pdfPath of tempPdfs) {
        const pdf = await PDFDocument.load(fs.readFileSync(pdfPath));
        (await mergedPdf.copyPages(pdf, pdf.getPageIndices())).forEach((page) => mergedPdf.addPage(page));
      }
      fs.writeFileSync(outputPdfPath, await mergedPdf.save());

      tempPdfs.forEach((p, i) => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        const jpg = p.replace(".pdf", ".jpg");
        if (fs.existsSync(jpg))
          i === 0 ? fs.renameSync(jpg, outputPdfPath.replace(".pdf", ".jpg")) : fs.unlinkSync(jpg);
      });
    }

    let createdJob = null;
    if (autoQueue) {
      const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
      createdJob = uploadJobs[jobId] = {
        id: jobId,
        originalName: path.basename(outputPdfPath),
        status: "pending",
        result: null,
        error: null,
        filePath: outputPdfPath,
        uploadDate: new Date().toISOString(),
      };
      uploadQueue.push(jobId);
      saveJobs();
      processQueue();
    }

    res.set("X-File-Name", path.basename(outputPdfPath));
    res.set("Access-Control-Expose-Headers", "X-File-Name, X-Auto-Job");
    if (createdJob) res.set("X-Auto-Job", JSON.stringify(createdJob));

    res.download(outputPdfPath, "Scanned_Document.pdf", (err) => {
      if (err && !["ECONNABORTED", "EPIPE"].includes(err.code)) console.error("[SCANNER] Fehler beim Senden:", err);
      // Wenn NICHT der KI-Warteschlange hinzugefügt (= reiner lokaler Download), dann Datei nach dem Senden direkt löschen
      if (!autoQueue && fs.existsSync(outputPdfPath)) {
        fs.promises.unlink(outputPdfPath).catch(() => { });
        const jpgPath = outputPdfPath.replace(".pdf", ".jpg");
        if (fs.existsSync(jpgPath)) fs.promises.unlink(jpgPath).catch(() => { });
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler beim Scannen des Dokuments." });
  }
});

app.post("/api/preview", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Kein Bild hochgeladen." });

  const inputPath = req.file.path;
  const outputJpgPath = path.join(localDownloadFolder, `Preview_${Date.now()}.jpg`);
  const algorithm = req.body.algorithm || "color_enhanced";

  try {
    await new Promise((resolve, reject) => {
      execFile(
        process.platform === "win32" ? ".\\venv\\Scripts\\python.exe" : "./venv/bin/python",
        ["./app/scanner.py", inputPath, outputJpgPath, req.body.coords || "skip", algorithm],
        (error, stdout, stderr) => {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (error) return reject(error);
          const match = stdout.match(/Auto-Detect: Nutze Filter '([^']+)'/);
          if (match) res.setHeader("X-Detected-Algorithm", match[1]);
          resolve(outputJpgPath);
        },
      );
    });

    res.download(outputJpgPath, "Preview.jpg", (err) => {
      if (fs.existsSync(outputJpgPath))
        setTimeout(() => fs.existsSync(outputJpgPath) && fs.unlinkSync(outputJpgPath), 10000);
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler bei der Vorschaugenerierung." });
  }
});

// Start
async function init() {
  if (firststart) {
    firststart = false;
    app.listen(port, "0.0.0.0", () => console.log(`Web UI läuft auf http://0.0.0.0:${port}`));
    const args = process.argv.slice(2);
    if (args.includes("--debug")) debug = true;
    if (args.includes("--test")) testrun = true;

    aiAgent.init(debug);
    setInterval(checkDriveForNewFiles, 15 * 1000); // 15 Sekunden Intervall für schnellen Upload-Sync
    setTimeout(checkDriveForNewFiles, 10000);
    setInterval(checkGmailForNewFiles, 60 * 1000); // 60 Sekunden Intervall für vorbereiteten Gmail-Monitor
    setTimeout(checkGmailForNewFiles, 15000);
  }
  if (testrun) {
    await aiAgent.getPdfName("./samples-scanner/1.pdf", appSettings);
    //for (var i = 1; i <= 10; i++) console.log(await aiAgent.getPdfName("./samples-scanner/" + i + ".pdf", appSettings));
  }
}

init();
