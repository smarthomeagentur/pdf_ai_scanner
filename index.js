// Unterdrücke lästige PUA (Private Use Area) Font-Warnungen von pdf-lib VOR jedem Require!
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  const msg = args.join(" ");
  if (msg.includes("Ran out of space in font private use area")) return;
  originalConsoleWarn(...args);
};
const originalConsoleLog = console.log;
console.log = (...args) => {
  const msg = args.join(" ");
  if (msg.includes("Ran out of space in font private use area")) return;
  originalConsoleLog(...args);
};

const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const process = require("process");
const dotenv = require("dotenv");
var aiAgent = require("./app/aiAgent.js");
const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

dotenv.config();

var debug = false;
var testrun = false;
var firststart = true;

const AUTH_ENABLED = process.env.AUTH_ENABLED === "true" || "true";
const APP_PASSWORD = process.env.APP_PASSWORD || "admin";
const JWT_SECRET = process.env.JWT_SECRET || "default_super_secret_key_123";

const localDownloadFolder = path.join(__dirname, "downloads"); // Path to your "downloads" folder

const appSettings = {
  FOLDER_ID: process.env.DRIVE_FOLDER_ID,
  FOLDER_ID_SORTED: process.env.DRIVE_FOLDER_ID_SORTED,
  AI_COMPANY: "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt",
  AI_CATEGORIES:
    "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige",
};
const SETTINGS_FILE = path.join(process.cwd(), "settings.json");
if (fs.existsSync(SETTINGS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE));
    if (saved.FOLDER_ID) appSettings.FOLDER_ID = saved.FOLDER_ID;
    if (saved.FOLDER_ID_SORTED) appSettings.FOLDER_ID_SORTED = saved.FOLDER_ID_SORTED;
    if (saved.AI_COMPANY) appSettings.AI_COMPANY = saved.AI_COMPANY;
    if (saved.AI_CATEGORIES) appSettings.AI_CATEGORIES = saved.AI_CATEGORIES;
  } catch (e) {}
}

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "gdrive_secret.json");

// Webserver setup
const app = express();
const port = process.env.PORT || 3000;

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(localDownloadFolder)) {
      fs.mkdirSync(localDownloadFolder, { recursive: true });
    }
    cb(null, localDownloadFolder);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

app.use(cookieParser());

app.post("/api/login", express.json(), (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    const token = jwt.sign({ authenticated: true }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie("auth_token", token, { httpOnly: true, secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: "Falsches Passwort" });
  }
});

app.use((req, res, next) => {
  if (!AUTH_ENABLED) return next();

  const openRoutes = ["/login.html", "/api/login", "/manifest.json", "/icon.svg", "/favicon.ico", "/robots.txt"];
  if (openRoutes.includes(req.path)) {
    return next();
  }

  const token = req.cookies.auth_token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return next(); // Auth OK
    } catch (err) {}
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.redirect("/login.html");
});

app.use(express.static("public"));
app.use("/downloads", express.static(localDownloadFolder)); // Neu: Um Thumbnails der PDFs anzeigen zu können

app.get("/api/config", async (req, res) => {
  try {
    const content = await fs.promises.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    res.json({ clientId: key.client_id, success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.get("/api/settings", (req, res) => {
  res.json({ success: true, settings: appSettings });
});

app.post("/api/settings", express.json(), async (req, res) => {
  if (req.body.FOLDER_ID !== undefined) appSettings.FOLDER_ID = req.body.FOLDER_ID;
  if (req.body.FOLDER_ID_SORTED !== undefined) appSettings.FOLDER_ID_SORTED = req.body.FOLDER_ID_SORTED;
  if (req.body.AI_COMPANY !== undefined) appSettings.AI_COMPANY = req.body.AI_COMPANY;
  if (req.body.AI_CATEGORIES !== undefined) appSettings.AI_CATEGORIES = req.body.AI_CATEGORIES;
  await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(appSettings, null, 2));
  res.json({ success: true });
});

app.post("/api/auth/code", express.json(), async (req, res) => {
  try {
    const { code } = req.body;
    const content = await fs.promises.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;

    // Use postmessage for Google Identity Services code implicit exchange
    const oauth2Client = new google.auth.OAuth2(key.client_id, key.client_secret, "postmessage");
    const { tokens } = await oauth2Client.getToken(code);

    const payload = JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: tokens.refresh_token || undefined,
    });

    // We only overwrite or merge if refresh exists. If not, it means user re-auth'd without revoking access.
    let existingToken = {};
    if (fs.existsSync(TOKEN_PATH)) {
      existingToken = JSON.parse(await fs.promises.readFile(TOKEN_PATH));
    }
    if (tokens.refresh_token) {
      await fs.promises.writeFile(TOKEN_PATH, payload);
    } else if (existingToken.refresh_token) {
      // Just keep the old refresh token
    } else {
      // Save anyway, but might have short-lived access
      await fs.promises.writeFile(TOKEN_PATH, payload);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});

app.get("/api/drive/folders", async (req, res) => {
  try {
    const parentId = req.query.parentId || "root";
    const authClient = await authorize();
    const drive = google.drive({ version: "v3", auth: authClient });
    const result = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`,
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
    const authClient = await authorize();
    const drive = google.drive({ version: "v3", auth: authClient });
    const result = await drive.files.get({
      fileId: req.params.id,
      fields: "id, name",
    });
    res.json({ success: true, folder: result.data });
  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

const uploadJobs = {};
const uploadQueue = [];
let isProcessingQueue = false;

app.post("/api/upload", upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Es wurden keine Dateien hochgeladen." });
  }

  const jobs = [];
  for (const file of req.files) {
    const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
    const job = {
      id: jobId,
      originalName: file.originalname,
      status: "pending",
      result: null,
      error: null,
      filePath: file.path,
      uploadDate: new Date().toISOString(),
    };
    console.log("[WEB] Add new upload job for " + file.originalname + " with ID " + jobId);

    uploadJobs[jobId] = job;
    uploadQueue.push(jobId);
    jobs.push(job);
  }

  // Start processing if not already
  processQueue();

  res.json({ success: true, jobs: jobs });
});

app.get("/api/status", (req, res) => {
  let statuses = [];
  if (req.query.ids === "all") {
    // Sort so newest is first
    statuses = Object.values(uploadJobs).sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
  } else {
    const ids = req.query.ids ? req.query.ids.split(",") : [];
    statuses = ids.map((id) => uploadJobs[id]).filter(Boolean);
  }
  res.json({ success: true, statuses: statuses });
});

// Neu: Clears the in-memory jobs from backend
app.delete("/api/jobs", (req, res) => {
  for (const key in uploadJobs) {
    delete uploadJobs[key];
  }
  res.json({ success: true });
});

app.post("/api/scan", upload.array("images", 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Keine Bilder hochgeladen." });
  }

  const outputPdfPath = path.join(localDownloadFolder, `Scanned_${Date.now()}.pdf`);
  const coordsList = req.body.coords || []; // Coordinates might be single string or array
  const algorithm = req.body.algorithm || "color_enhanced";
  const autoQueue = req.body.autoQueue === "true";

  console.log(`[SCANNER] Starte Verarbeitung für ${req.files.length} Seite(n) mit Modus ${algorithm}`);

  try {
    const tempPdfs = [];

    // Helper functions for running the Python scanner sync-ish via Promisification
    const runScannerTask = (inputPath, tempPdfPath, coordsStr) => {
      return new Promise((resolve, reject) => {
        exec(
          `./venv/bin/python ./app/scanner.py "${inputPath}" "${tempPdfPath}" "${coordsStr}" "${algorithm}"`,
          (error, stdout, stderr) => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (error) {
              console.error(`[SCANNER ERROR]: ${error.message} | ${stderr}`);
              reject(error);
            } else {
              resolve(tempPdfPath);
            }
          }
        );
      });
    };

    // Verarbeite jede Seite mit Tesseract einzeln
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const inputPath = file.path;
      const tempPdfPath = path.join(localDownloadFolder, `temp_${Date.now()}_${i}.pdf`);
      let coordsStr = Array.isArray(coordsList) ? coordsList[i] || "" : i === 0 ? coordsList : "";

      await runScannerTask(inputPath, tempPdfPath, coordsStr);
      tempPdfs.push(tempPdfPath);
    }

    // Wenn mehrere Dateien, dann per pdf-lib mergen, ansonsten einfach umbenennen
    if (tempPdfs.length === 1) {
      fs.renameSync(tempPdfs[0], outputPdfPath);
      let tempJpg = tempPdfs[0].replace(".pdf", ".jpg");
      if (fs.existsSync(tempJpg)) {
        fs.renameSync(tempJpg, outputPdfPath.replace(".pdf", ".jpg"));
      }
    } else {
      const mergedPdf = await PDFDocument.create();
      for (const pdfPath of tempPdfs) {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBytes = await mergedPdf.save();
      fs.writeFileSync(outputPdfPath, mergedPdfBytes);

      // Temporäre PDFs + Vorschau-Jpgs löschen, behalte das neue Output JPG von Seite 1
      for (let i = 0; i < tempPdfs.length; i++) {
        if (fs.existsSync(tempPdfs[i])) fs.unlinkSync(tempPdfs[i]);
        let tempJpg = tempPdfs[i].replace(".pdf", ".jpg");
        if (fs.existsSync(tempJpg)) {
          if (i === 0) fs.renameSync(tempJpg, outputPdfPath.replace(".pdf", ".jpg")); // 1. JPG Preview behalten
          else fs.unlinkSync(tempJpg);
        }
      }
    }

    let createdJob = null;
    if (autoQueue) {
      const filename = path.basename(outputPdfPath);
      const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
      const job = {
        id: jobId,
        originalName: filename,
        status: "pending",
        result: null,
        error: null,
        filePath: outputPdfPath,
        uploadDate: new Date().toISOString(),
      };
      console.log("[SCANNER] Auto-queuing job for " + filename);
      uploadJobs[jobId] = job;
      uploadQueue.push(jobId);
      createdJob = job;
      processQueue();
    }

    console.log(`[SCANNER] Erfolgreich verarbeitet: ${outputPdfPath}`);
    res.set("X-File-Name", path.basename(outputPdfPath));
    res.set("Access-Control-Expose-Headers", "X-File-Name, X-Auto-Job");
    if (createdJob) {
      res.set("X-Auto-Job", JSON.stringify(createdJob));
    }

    res.download(outputPdfPath, "Scanned_Document.pdf", (err) => {
      if (err) {
        if (err.code === "ECONNABORTED" || err.message === "Request aborted" || err.code === "EPIPE") {
          console.log(
            "[SCANNER] Client hat die Verbindung getrennt (Verbindung vorzeitig beendet). Hintergrund-Verarbeitung läuft weiter."
          );
        } else {
          console.error("[SCANNER] Fehler beim Senden der Datei:", err);
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler beim Scannen des Dokuments." });
  }
});

// Neu: Vorschau generieren ohne OCR (Sehr schnell)
app.post("/api/preview", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Kein Bild hochgeladen." });
  }

  const inputPath = req.file.path;
  const outputJpgPath = path.join(localDownloadFolder, `Preview_${Date.now()}.jpg`);
  const algorithm = req.body.algorithm || "color_enhanced";
  const coords = req.body.coords || "skip"; // Now receiving crop coordinates from frontend!

  try {
    await new Promise((resolve, reject) => {
      exec(
        `./venv/bin/python ./app/scanner.py "${inputPath}" "${outputJpgPath}" "${coords}" "${algorithm}"`,
        (error, stdout, stderr) => {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); // Original löschen

          if (error) {
            console.error(`[PREVIEW ERROR]: ${error.message} | ${stderr}`);
            reject(error);
          } else {
            // Versuche den Auto-Detect Filter aus dem stdout zu lesen
            let detectedAlgorithm = algorithm;
            const match = stdout.match(/Auto-Detect: Nutze Filter '([^']+)'/);
            if (match && match[1]) {
              detectedAlgorithm = match[1];
              res.setHeader("X-Detected-Algorithm", detectedAlgorithm);
            }
            resolve(outputJpgPath);
          }
        }
      );
    });

    res.download(outputJpgPath, "Preview.jpg", (err) => {
      if (fs.existsSync(outputJpgPath)) {
        setTimeout(() => {
          if (fs.existsSync(outputJpgPath)) fs.unlinkSync(outputJpgPath);
        }, 10000); // 10s Cleanup delay
      }
      if (err && err.code !== "ECONNABORTED" && err.code !== "EPIPE") {
        console.error("[PREVIEW] Fehler beim Senden:", err);
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler bei der Vorschaugenerierung." });
  }
});

// Neu: Liste aller lokal gescannten Dateien abrufen
app.get("/api/scans", (req, res) => {
  if (!fs.existsSync(localDownloadFolder)) {
    return res.json({ success: true, files: [] });
  }

  const files = fs
    .readdirSync(localDownloadFolder)
    .filter((file) => file.startsWith("Scanned_") && file.endsWith(".pdf"))
    .map((file) => {
      const stats = fs.statSync(path.join(localDownloadFolder, file));
      const hasThumbnail = fs.existsSync(path.join(localDownloadFolder, file.replace(".pdf", ".jpg")));
      return {
        name: file,
        path: path.join(localDownloadFolder, file),
        date: stats.mtime,
        size: stats.size,
        hasThumbnail: hasThumbnail,
      };
    })
    .sort((a, b) => b.date - a.date); // Neueste zuerst

  res.json({ success: true, files: files });
});

// Neu: Datei löschen
app.delete("/api/scans/:filename", (req, res) => {
  const filename = req.params.filename;
  if (!filename.startsWith("Scanned_") || !filename.endsWith(".pdf")) {
    return res.status(400).json({ error: "Ungültiger Dateiname" });
  }

  const pdfPath = path.join(localDownloadFolder, filename);
  const jpgPath = path.join(localDownloadFolder, filename.replace(".pdf", ".jpg"));

  try {
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(jpgPath)) fs.unlinkSync(jpgPath);
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting scan:", err);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// Neu: Bereits existierende gescannte Datei in die KI-Pipeline werfen
app.post("/api/upload-scan", express.json(), (req, res) => {
  const filenames = req.body.filenames;
  if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
    return res.status(400).json({ error: "Keine Dateien ausgewählt." });
  }

  const jobs = [];
  for (const filename of filenames) {
    const filePath = path.join(localDownloadFolder, filename);
    if (!fs.existsSync(filePath)) continue;

    const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
    const job = {
      id: jobId,
      originalName: filename,
      status: "pending",
      result: null,
      error: null,
      // Datei bleibt am originalen Ort, wird nach erfolgreichem Upload gelöscht
      filePath: filePath,
      uploadDate: new Date().toISOString(),
    };

    console.log("[WEB] Add local scan to upload job: " + filename);
    uploadJobs[jobId] = job;
    uploadQueue.push(jobId);
    jobs.push(job);
  }

  processQueue();
  res.json({ success: true, jobs: jobs });
});

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (uploadQueue.length > 0) {
    const jobId = uploadQueue.shift();
    const job = uploadJobs[jobId];
    if (!job) continue;

    job.status = "processing";
    job.processingStartedAt = Date.now();

    try {
      console.log(`[WEB] Processing job ${jobId} for file ${job.originalName}...`);
      const authClient = await authorize();
      const drive = google.drive({ version: "v3", auth: authClient });

      let folderId;
      if (isValidGoogleDriveId(appSettings.FOLDER_ID)) {
        folderId = appSettings.FOLDER_ID;
      } else {
        folderId = await findFolderId(appSettings.FOLDER_ID);
      }

      const aiStartTime = Date.now();
      var sortedName = await aiAgent.getPdfName(job.filePath, appSettings);
      const aiEndTime = Date.now();
      const aiDurationMs = aiEndTime - aiStartTime;
      sortedName.duration = (aiDurationMs / 1000).toFixed(2); // save duration in seconds

      if (sortedName.success === false) {
        throw new Error("KI Verarbeitung fehlgeschlagen.");
      }

      let driveFile = null;
      if (appSettings.FOLDER_ID_SORTED) {
        driveFile = await uploadFile(drive, job.filePath, appSettings.FOLDER_ID_SORTED, sortedName.full);
      }
      let defaultDriveFile = await uploadFile(drive, job.filePath, folderId);

      if (!driveFile) {
        driveFile = defaultDriveFile;
      }

      if (driveFile) {
        sortedName.webViewLink = driveFile.webViewLink;
        sortedName.thumbnailLink = driveFile.thumbnailLink;
        sortedName.webContentLink = driveFile.webContentLink;
      }

      console.log(`[WEB] Job ${jobId} finished. File uploaded to Drive:`);
      console.log(sortedName);

      // Delete file after upload
      await fs.promises.unlink(job.filePath);

      // Read thumbnail for frontend dashboard preview before deleting it
      const jpgPath = job.filePath.replace(".pdf", ".jpg");
      let localThumbBase64 = null;
      if (fs.existsSync(jpgPath)) {
        try {
          const imgBuf = await fs.promises.readFile(jpgPath);
          localThumbBase64 = `data:image/jpeg;base64,${imgBuf.toString("base64")}`;
        } catch (e) {}
        await fs.promises.unlink(jpgPath);
      }

      job.status = "completed";
      sortedName.localThumbnail = localThumbBase64;
      job.result = sortedName;
    } catch (error) {
      console.error(`[WEB] Error processing job ${jobId}:`, error);
      job.status = "error";
      job.error = error.message;
      // Try to clean up file on error
      try {
        if (fs.existsSync(job.filePath)) {
          await fs.promises.unlink(job.filePath);
        }
        const jpgPath = job.filePath.replace(".pdf", ".jpg");
        if (fs.existsSync(jpgPath)) await fs.promises.unlink(jpgPath);
      } catch (e) {}
    }
  }

  isProcessingQueue = false;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function init() {
  console.log("starting script");

  if (firststart) {
    firststart = false;
    app.listen(port, "0.0.0.0", () => {
      console.log(`Web UI läuft auf http://0.0.0.0:${port}`);
    });
    const args = process.argv.slice(2);
    console.log(args);
    if (args.includes("--debug")) {
      debug = true;
      console.log("[START] Debug mode enabled");
    }
    if (args.includes("--test")) {
      testrun = true;
      console.log("[START] Test mode enabled");
    }
    aiAgent.init(debug);
  }

  if (testrun) {
    return;
    for (var i = 1; i <= 10; i++) {
      var sortedName = await aiAgent.getPdfName(i + ".pdf", appSettings);
      console.log(sortedName);
    }
    return;
  }
} //

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.promises.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.promises.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.promises.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

async function uploadFile(drive, filePath, folderId, name = undefined) {
  try {
    let filename = name || path.basename(filePath);
    const fileMetadata = {
      name: filename,
      parents: [folderId],
    };
    const media = {
      mimeType: null,
      body: fs.createReadStream(filePath), // Create a readable stream from the file path
    };
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id, webViewLink, thumbnailLink, webContentLink",
    });
    if (debug) console.log(`[DRIVE] Uploaded ${filename} (ID: ${file.data.id})`);
    return file.data;
  } catch (error) {
    console.error(`Error uploading file ${filePath}:`, error);
    return null;
  }
}

async function findFolderId(drive, folderName) {
  let nextPageToken = null;
  do {
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}'`,
      fields: "nextPageToken, files(id, name)",
      pageToken: nextPageToken,
    });
    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }
    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);
  return null;
}

function isValidGoogleDriveId(str) {
  // A Google Drive ID is a string of alphanumeric characters and some special symbols
  return typeof str === "string" && /^[a-zA-Z0-9_-]+$/.test(str) && str.length > 10;
}

init();
