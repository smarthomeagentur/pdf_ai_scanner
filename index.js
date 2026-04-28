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
const multer = require("multer");
const { exec } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const aiAgent = require("./app/aiAgent.js");
const DriveAPI = require("./app/driveApi.js");

dotenv.config();

let debug = false;
let testrun = false;
let firststart = true;

const AUTH_ENABLED = process.env.AUTH_ENABLED === "true" || "true";
const APP_PASSWORD = process.env.APP_PASSWORD || "admin";
const JWT_SECRET = process.env.JWT_SECRET || "default_super_secret_key_123";

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
    } catch (e) {}
  }
});

const localDownloadFolder = path.join(__dirname, "downloads");
const SETTINGS_FILE = path.join(storeFolder, "settings.json");
const TOKEN_PATH = path.join(storeFolder, "token.json");
const JOBS_FILE = path.join(storeFolder, "jobs.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "gdrive_secret.json"); // Secret usually stays in root or via env

const driveApi = new DriveAPI(TOKEN_PATH, CREDENTIALS_PATH);

const appSettings = {
  FOLDER_ID: process.env.DRIVE_FOLDER_ID,
  FOLDER_ID_SORTED: process.env.DRIVE_FOLDER_ID_SORTED,
  MONITOR_DRIVE: false,
  AI_COMPANY: "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt",
  AI_CATEGORIES:
    "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige",
};

if (fs.existsSync(SETTINGS_FILE)) {
  try {
    Object.assign(appSettings, JSON.parse(fs.readFileSync(SETTINGS_FILE)));
  } catch (e) {}
}

const app = express();
const port = process.env.PORT || 3000;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(localDownloadFolder)) fs.mkdirSync(localDownloadFolder, { recursive: true });
    cb(null, localDownloadFolder);
  },
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

app.use(cookieParser());

// Auth
app.post("/api/login", express.json(), (req, res) => {
  if (req.body.password === APP_PASSWORD) {
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
  if (openRoutes.includes(req.path)) return next();
  const token = req.cookies.auth_token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return next();
    } catch (err) {}
  }
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  res.redirect("/login.html");
});

app.use(express.static("public"));
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

app.post("/api/settings", express.json(), async (req, res) => {
  ["FOLDER_ID", "FOLDER_ID_SORTED", "AI_COMPANY", "AI_CATEGORIES", "MONITOR_DRIVE"].forEach((key) => {
    if (req.body[key] !== undefined) appSettings[key] = req.body[key];
  });
  await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(appSettings, null, 2));
  res.json({ success: true });

  if (appSettings.MONITOR_DRIVE) {
    // Starte Überwachung asynchron sofort nach dem Speichern
    checkDriveForNewFiles().catch(console.error);
  }
});

// Drive Auth Workflow
app.post("/api/auth/code", express.json(), async (req, res) => {
  try {
    const keys = JSON.parse(await fs.promises.readFile(CREDENTIALS_PATH));
    const key = keys.installed || keys.web;
    const oauth2Client = new (require("googleapis").google.auth.OAuth2)(
      key.client_id,
      key.client_secret,
      "postmessage"
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
      q: `mimeType='application/vnd.google-apps.folder' and trashed=false and '${
        req.query.parentId || "root"
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
  } catch (e) {}
}
function saveJobs() {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify({ uploadJobs, uploadQueue, processedDriveFiles }));
  } catch (e) {}
}
loadJobs();

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

      const aiStartTime = Date.now();
      const sortedName = await aiAgent.getPdfName(job.filePath, appSettings);
      sortedName.duration = ((Date.now() - aiStartTime) / 1000).toFixed(2);

      if (sortedName.success === false) throw new Error("KI Verarbeitung fehlgeschlagen.");

      let defaultDriveFile = await driveApi.uploadFile(job.filePath, folderId, undefined, debug);
      let driveFile = appSettings.FOLDER_ID_SORTED
        ? await driveApi.uploadFile(job.filePath, appSettings.FOLDER_ID_SORTED, sortedName.full, debug)
        : null;

      if (defaultDriveFile) processedDriveFiles.push(defaultDriveFile.id);
      driveFile = driveFile || defaultDriveFile;

      if (driveFile) {
        sortedName.webViewLink = driveFile.webViewLink;
        sortedName.thumbnailLink = driveFile.thumbnailLink;
        sortedName.webContentLink = driveFile.webContentLink;
      }

      await fs.promises.unlink(job.filePath).catch(() => {});

      const jpgPath = job.filePath.replace(".pdf", ".jpg");
      let localThumbBase64 = null;
      if (fs.existsSync(jpgPath)) {
        try {
          localThumbBase64 = `data:image/jpeg;base64,${(await fs.promises.readFile(jpgPath)).toString("base64")}`;
        } catch (e) {}
        await fs.promises.unlink(jpgPath).catch(() => {});
      }

      job.status = "completed";
      sortedName.localThumbnail = localThumbBase64;
      job.result = sortedName;
      saveJobs();
      console.log(`[WEB] Job ${jobId} finished.`);
    } catch (error) {
      console.error(`[WEB] Error processing job ${jobId}:`, error);
      job.status = "error";
      job.error = error.message;
      saveJobs();
      try {
        if (fs.existsSync(job.filePath)) await fs.promises.unlink(job.filePath).catch(() => {});
        const jpgPath = job.filePath.replace(".pdf", ".jpg");
        if (fs.existsSync(jpgPath)) await fs.promises.unlink(jpgPath).catch(() => {});
      } catch (e) {}
    }
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

app.post("/api/upload-scan", express.json(), (req, res) => {
  if (!req.body.filenames?.length) return res.status(400).json({ error: "Keine Dateien ausgewählt." });

  const jobs = req.body.filenames
    .filter((f) => fs.existsSync(path.join(localDownloadFolder, f)))
    .map((filename) => {
      const job = {
        id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
        originalName: filename,
        status: "pending",
        result: null,
        error: null,
        filePath: path.join(localDownloadFolder, filename),
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

app.get("/api/status", (req, res) => {
  let statuses =
    req.query.ids === "all"
      ? Object.values(uploadJobs).sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate))
      : (req.query.ids ? req.query.ids.split(",") : []).map((id) => uploadJobs[id]).filter(Boolean);
  res.json({ success: true, statuses });
});

app.delete("/api/jobs", (req, res) => {
  uploadJobs = {};
  uploadQueue = [];
  saveJobs();
  res.json({ success: true });
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
        exec(
          `./venv/bin/python ./app/scanner.py "${inputPath}" "${tempPdfPath}" "${coordsStr}" "${algorithm}"`,
          (error, stdout, stderr) => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (error) {
              console.error(`[SCANNER]: ${error.message}`);
              reject(error);
            } else resolve(tempPdfPath);
          }
        );
      });

    for (let i = 0; i < req.files.length; i++) {
      tempPdfs.push(
        await runScannerTask(
          req.files[i].path,
          path.join(localDownloadFolder, `temp_${Date.now()}_${i}.pdf`),
          Array.isArray(coordsList) ? coordsList[i] || "" : i === 0 ? coordsList : ""
        )
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
      exec(
        `./venv/bin/python ./app/scanner.py "${inputPath}" "${outputJpgPath}" "${
          req.body.coords || "skip"
        }" "${algorithm}"`,
        (error, stdout) => {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (error) return reject(error);
          const match = stdout.match(/Auto-Detect: Nutze Filter '([^']+)'/);
          if (match) res.setHeader("X-Detected-Algorithm", match[1]);
          resolve(outputJpgPath);
        }
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

app.get("/api/scans", (req, res) => {
  if (!fs.existsSync(localDownloadFolder)) return res.json({ success: true, files: [] });
  const files = fs
    .readdirSync(localDownloadFolder)
    .filter((file) => file.startsWith("Scanned_") && file.endsWith(".pdf"))
    .map((file) => ({
      name: file,
      path: path.join(localDownloadFolder, file),
      date: fs.statSync(path.join(localDownloadFolder, file)).mtime,
      size: fs.statSync(path.join(localDownloadFolder, file)).size,
      hasThumbnail: fs.existsSync(path.join(localDownloadFolder, file.replace(".pdf", ".jpg"))),
    }))
    .sort((a, b) => b.date - a.date);
  res.json({ success: true, files });
});

app.delete("/api/scans/:filename", (req, res) => {
  const filename = req.params.filename;
  if (!filename.startsWith("Scanned_") || !filename.endsWith(".pdf"))
    return res.status(400).json({ error: "Ungültiger Dateiname" });
  try {
    const pdfPath = path.join(localDownloadFolder, filename);
    const jpgPath = path.join(localDownloadFolder, filename.replace(".pdf", ".jpg"));
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(jpgPath)) fs.unlinkSync(jpgPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Löschen" });
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
    setInterval(checkDriveForNewFiles, 5 * 60 * 1000);
    setTimeout(checkDriveForNewFiles, 10000);
  }
  if (testrun) {
    for (var i = 1; i <= 10; i++) console.log(await aiAgent.getPdfName(i + ".pdf", appSettings));
  }
}

init();
