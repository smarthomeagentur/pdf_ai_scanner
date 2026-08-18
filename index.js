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
const process = require("process");
const dotenv = require("dotenv");
const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { execFile } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const { exiftool } = require("exiftool-vendored");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const aiAgent = require("./app/aiAgent.js");
const DriveAPI = require("./app/driveApi.js");
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
const CREDENTIALS_PATH = path.join(process.cwd(), "gdrive_secret.json"); // Secret usually stays in root or via env
const thumbsFolder = path.join(storeFolder, "thumbs");
if (!fs.existsSync(thumbsFolder)) fs.mkdirSync(thumbsFolder, { recursive: true });

const driveApi = new DriveAPI(TOKEN_PATH, CREDENTIALS_PATH);

const appSettings = {
  FOLDER_ID: process.env.DRIVE_FOLDER_ID,
  FOLDER_ID_SORTED: process.env.DRIVE_FOLDER_ID_SORTED,
  MONITOR_DRIVE: false,
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

app.post("/api/admin-login", express.json(), loginLimiter, (req, res) => {
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

app.post("/api/admin/restore", requireAdmin, express.json({ limit: "50mb" }), async (req, res) => {
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

app.post("/api/login", express.json(), loginLimiter, (req, res) => {
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

app.post("/api/settings", requireAdmin, express.json(), async (req, res) => {
  [
    "FOLDER_ID",
    "FOLDER_ID_SORTED",
    "AI_COMPANY",
    "AI_CATEGORIES",
    "MONITOR_DRIVE",
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
});

// Drive Auth Workflow
app.post("/api/auth/code", requireAdmin, express.json(), async (req, res) => {
  try {
    const keys = JSON.parse(await fs.promises.readFile(CREDENTIALS_PATH));
    const key = keys.installed || keys.web;
    const oauth2Client = new (require("googleapis").google.auth.OAuth2)(
      key.client_id,
      key.client_secret,
      "postmessage",
    );
    const { tokens } = await oauth2Client.getToken(req.body.code);

    const payload = JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: tokens.refresh_token || undefined,
    });

    let existingToken = {};
    if (fs.existsSync(TOKEN_PATH)) existingToken = JSON.parse(await fs.promises.readFile(TOKEN_PATH));

    if (tokens.refresh_token || !existingToken.refresh_token) {
      await fs.promises.writeFile(TOKEN_PATH, payload);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});

// Drive Routes
app.get("/api/drive/folders", async (req, res) => {
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

app.get("/api/drive/folder/:id", async (req, res) => {
  try {
    const drive = await driveApi.getClient();
    const result = await drive.files.get({ fileId: req.params.id, fields: "id, name" });
    res.json({ success: true, folder: result.data });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

app.get("/api/drive/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ success: true, files: [] });

    const driveFolderId = driveApi.isValidGoogleDriveId(appSettings.FOLDER_ID_SORTED)
      ? appSettings.FOLDER_ID_SORTED
      : await driveApi.findFolderId(appSettings.FOLDER_ID_SORTED);

    if (!driveFolderId) {
      return res.status(400).json({ error: "Zielordner in Google Drive nicht gefunden." });
    }

    const drive = await driveApi.getClient();
    const safeQ = q.replace(/'/g, "\\'");
    let query = `trashed=false and '${driveFolderId}' in parents and (name contains '${safeQ}' or fullText contains '${safeQ}')`;

    if (!checkIsAdmin(req)) {
      query += ` and not appProperties has { key='isPrivate' and value='true' }`;
    }

    const result = await drive.files.list({
      q: query,
      fields: "files(id, name, webViewLink, thumbnailLink, createdTime)",
      pageSize: 30, // Max 30 Ergebnisse, Google sortiert bei fullText automatisch nach Relevanz
    });

    res.json({ success: true, files: result.data.files || [] });
  } catch (e) {
    console.error("[SEARCH] Fehler bei Google Drive Suche:", e);
    res.status(500).json({ error: e.toString() });
  }
});

app.get("/api/thumbnail/:fileId", async (req, res) => {
  const fileId = req.params.fileId;
  const thumbPath = path.join(thumbsFolder, `${fileId}.jpg`);

  if (fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  try {
    if (!fs.existsSync(TOKEN_PATH)) {
      return res.status(404).send("Not authenticated with Drive");
    }

    const drive = await driveApi.getClient();
    let imageBuffer = null;

    // 1. Try fetching thumbnailLink via backend
    try {
      const fileInfo = await drive.files.get({ fileId: fileId, fields: "thumbnailLink" });
      if (fileInfo.data && fileInfo.data.thumbnailLink) {
        const link = fileInfo.data.thumbnailLink.replace(/=s\d+$/, "=s220");
        const imgRes = await fetch(link);
        if (imgRes.ok) {
          imageBuffer = Buffer.from(await imgRes.arrayBuffer());
        }
      }
    } catch (e) {}

    // 2. Fallback: Render page 1 as JPEG using PyMuPDF if needed
    if (!imageBuffer) {
      const pdfTemp = path.join(localDownloadFolder, `thumb_temp_${fileId}.pdf`);
      try {
        const dest = fs.createWriteStream(pdfTemp);
        const downloadRes = await drive.files.get({ fileId: fileId, alt: "media" }, { responseType: "stream" });
        await new Promise((resolve, reject) => downloadRes.data.on("end", resolve).on("error", reject).pipe(dest));

        const jpgTemp = path.join(localDownloadFolder, `thumb_temp_${fileId}.jpg`);
        await new Promise((resolve, reject) => {
          execFile(
            getPythonPath(),
            [
              "-c",
              `import sys, fitz; doc=fitz.open(sys.argv[1]); pix=doc[0].get_pixmap(dpi=100); pix.save(sys.argv[2]); doc.close()`,
              pdfTemp,
              jpgTemp,
            ],
            (error) => (error ? reject(error) : resolve())
          );
        });

        if (fs.existsSync(jpgTemp)) {
          imageBuffer = await fs.promises.readFile(jpgTemp);
          await fs.promises.unlink(jpgTemp).catch(() => {});
        }
      } catch (e) {
      } finally {
        if (fs.existsSync(pdfTemp)) await fs.promises.unlink(pdfTemp).catch(() => {});
      }
    }

    if (imageBuffer) {
      await fs.promises.writeFile(thumbPath, imageBuffer);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=864000");
      return res.send(imageBuffer);
    }

    res.status(404).send("Thumbnail not found");
  } catch (err) {
    console.error("[THUMBNAIL] Error serving thumbnail:", err);
    res.status(500).send("Error generating thumbnail");
  }
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
async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (uploadQueue.length > 0) {
    const jobId = uploadQueue.shift();
    const job = uploadJobs[jobId];
    if (!job) continue;

    job.status = "processing";
    job.processingStartedAt = Date.now();
    saveJobs();

    try {
      console.log(`[WEB] Processing job ${jobId} for file ${job.originalName}...`);
      let folderId = driveApi.isValidGoogleDriveId(appSettings.FOLDER_ID)
        ? appSettings.FOLDER_ID
        : await driveApi.findFolderId(appSettings.FOLDER_ID);

      // Sofortiger Roh-Upload in Google Drive (Backup vor KI)
      let uploadOptions = job.isPrivate ? { appProperties: { isPrivate: 'true' } } : undefined;
      let defaultDriveFile = await driveApi.uploadFile(job.filePath, folderId, uploadOptions, debug);
      if (defaultDriveFile) {
        processedDriveFiles.push(defaultDriveFile.id);
        job.rawDriveId = defaultDriveFile.id;
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

        // Exiftool creates an _original backup file. We ensure to remove it.
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

      const jpgPath = job.filePath.replace(".pdf", ".jpg");
      let localThumbBase64 = null;
      if (fs.existsSync(jpgPath)) {
        try {
          localThumbBase64 = `data:image/jpeg;base64,${(await fs.promises.readFile(jpgPath)).toString("base64")}`;
        } catch (e) { }
        await fs.promises.unlink(jpgPath).catch(() => { });
      }

      // Fallback: Falls kein Thumbnail existiert (z.B. reiner Google Drive Upload)
      if (!localThumbBase64 && typeof aiAgent.generateThumbnail === "function") {
        try {
          localThumbBase64 = await aiAgent.generateThumbnail(job.filePath);
        } catch (e) {
          console.error("[WEB] Fehler beim Erstellen des Fallback-Thumbnails:", e);
        }
      }

      // Read PDF buffer for ClickUp attachment before unlinking
      let pdfBuffer = null;
      if (fs.existsSync(job.filePath)) {
        try {
          pdfBuffer = await fs.promises.readFile(job.filePath);
        } catch (e) {}
      }

      // ClickUp Integration: Auto-create task if enabled
      if (appSettings.CLICKUP_AUTO_TASK && appSettings.CLICKUP_API_KEY) {
        const isPrivateDoc =
          job.isPrivate ||
          (sortedName.company && sortedName.company.toLowerCase().includes("daniel")) ||
          (sortedName.category && sortedName.category.toLowerCase() === "privat");

        if (appSettings.CLICKUP_FILTER_PRIVATE && isPrivateDoc) {
          console.log(`[CLICKUP] Job ${jobId} als privat eingestuft. ClickUp-Upload wird übersprungen.`);
        } else {
          try {
            console.log(`[CLICKUP] Erstelle ClickUp-Task für Job ${jobId} (${sortedName.full})...`);
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
              console.log(`[CLICKUP] Task ${clickupResult.taskId} erfolgreich erstellt für Job ${jobId}`);
            }
          } catch (clickupErr) {
            console.error(`[CLICKUP] Fehler bei automatischer ClickUp-Verarbeitung für Job ${jobId}:`, clickupErr.message);
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
      sortedName.localThumbnail = localThumbBase64;
      job.result = sortedName;
      job.invoiceNumber = sortedName.invoiceNumber;
      job.invoiceAmmount = sortedName.invoiceAmmount;
      saveJobs();

      if (driveSyncState.running) {
        driveSyncState.processed++;
        driveSyncState.currentFileName = job.originalName || sortedName.full || "";
      }

      console.log(`[WEB] Job ${jobId} finished.`);
    } catch (error) {
      console.error(`[WEB] Error processing job ${jobId}:`, error);
      job.status = "error";
      job.inAiPipeline = false;
      job.error = error.message;
      saveJobs();

      if (driveSyncState.running) {
        driveSyncState.processed++;
        driveSyncState.errors.push({ jobId, fileName: job.originalName, error: error.message });
      }

      try {
        if (fs.existsSync(job.filePath)) await fs.promises.unlink(job.filePath).catch(() => { });
        const jpgPath = job.filePath.replace(".pdf", ".jpg");
        if (fs.existsSync(jpgPath)) await fs.promises.unlink(jpgPath).catch(() => { });
      } catch (e) { }
    }
  }

  isProcessingQueue = false;
  if (driveSyncState.running && uploadQueue.length === 0) {
    driveSyncState.running = false;
    driveSyncState.finishedAt = new Date().toISOString();
  }
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

          const localPath = path.join(localDownloadFolder, `${Date.now()}-${file.name}`);
          try {
            const dest = fs.createWriteStream(localPath);
            const downloadRes = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "stream" });
            await new Promise((resolve, reject) => downloadRes.data.on("end", resolve).on("error", reject).pipe(dest));

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
app.post("/api/upload", upload.array("files"), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Keine Dateien hochgeladen." });

  const jobs = req.files.map((file) => {
    const job = {
      id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
      originalName: file.originalname,
      status: "pending",
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

app.get("/api/drive/sync-status", (req, res) => {
  res.json({
    success: true,
    syncState: driveSyncState,
    queueLength: uploadQueue.length,
    isProcessing: isProcessingQueue,
  });
});

app.post("/api/drive/sync-execute", requireAdmin, express.json(), async (req, res) => {
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

    // Background processing loop
    (async () => {
      console.log(`[DRIVE SYNC] Starte Hintergrund-Synchronisation für ${items.length} Belege...`);
      for (const item of items) {
        try {
          driveSyncState.currentFileName = item.name;
          const localPath = path.join(localDownloadFolder, `${Date.now()}-${item.name}`);
          const dest = fs.createWriteStream(localPath);
          const downloadRes = await drive.files.get({ fileId: item.id, alt: "media" }, { responseType: "stream" });
          await new Promise((resolve, reject) => downloadRes.data.on("end", resolve).on("error", reject).pipe(dest));

          let jobId = item.existingJobId;
          if (!jobId || !uploadJobs[jobId]) {
            jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
            uploadJobs[jobId] = {
              id: jobId,
              originalName: item.name,
              status: "pending",
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
            uploadJobs[jobId].inAiPipeline = true;
            uploadJobs[jobId].aiPipelineStartedAt = new Date().toISOString();
            uploadJobs[jobId].filePath = localPath;
            uploadJobs[jobId].error = null;
            if (!uploadJobs[jobId].rawDriveId) uploadJobs[jobId].rawDriveId = item.id;
          }

          if (!processedDriveFiles.includes(item.id)) {
            processedDriveFiles.push(item.id);
          }

          uploadQueue.push(jobId);
          saveJobs();
        } catch (downloadErr) {
          console.error(`[DRIVE SYNC] Fehler beim Vorbereiten von ${item.name}:`, downloadErr);
          driveSyncState.errors.push({ id: item.id, name: item.name, error: downloadErr.message });
          driveSyncState.processed++;
        }
      }

      console.log(`[DRIVE SYNC] Alle ${items.length} Belege in Warteschlange gestellt. Starte AI-Verarbeitung...`);
      processQueue();
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

app.post("/api/jobs/:id/private", requireAdmin, express.json(), async (req, res) => {
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

app.post("/api/jobs/:id/category", express.json(), (req, res) => {
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

app.post("/api/jobs/:id/target-company", requireAdmin, express.json(), (req, res) => {
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

// Accounting Endpoints (Lexoffice & BuchhaltungsButler) - Admin only
app.post(["/api/accounting/check", "/api/lexoffice/check"], requireAdmin, express.json(), async (req, res) => {
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

app.post(["/api/accounting/transfer", "/api/lexoffice/transfer"], requireAdmin, express.json(), async (req, res) => {
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
app.post("/api/clickup/verify", requireAdmin, express.json(), async (req, res) => {
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

app.post("/api/clickup/transfer", requireAdmin, express.json(), async (req, res) => {
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
        toUpdate.push({
          jobId: job.id,
          fileName: job.result.full || job.originalName,
          company: job.result.company || "Unbekannt",
          category: job.result.category || "-",
          isInvoice: !!job.result.isInvoice,
          amount: job.result.invoiceAmmount ? clickupApi.formatAmount(job.result.invoiceAmmount) : "",
          existingTaskId: matchingTask.id,
          existingTaskName: matchingTask.name,
          existingTaskUrl: matchingTask.url || `https://app.clickup.com/t/${matchingTask.id}`,
        });
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
      toSkip,
    });
  } catch (err) {
    console.error("[CLICKUP] Fehler bei Sync-Vorschau:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler beim Erstellen der Sync-Vorschau." });
  }
});

app.post("/api/clickup/sync-all", requireAdmin, express.json(), async (req, res) => {
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
        console.error(`[CLICKUP] Fehler beim Synchronisieren von Job ${job.id}:`, err);
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
      totalProcessed: jobsList.length,
      errors,
    });
  } catch (err) {
    console.error("[CLICKUP] Fehler bei Sync All:", err);
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
          "./venv/bin/python",
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
        "./venv/bin/python",
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
  }
  if (testrun) {
    await aiAgent.getPdfName("./samples-scanner/1.pdf", appSettings);
    //for (var i = 1; i <= 10; i++) console.log(await aiAgent.getPdfName("./samples-scanner/" + i + ".pdf", appSettings));
  }
}

init();
