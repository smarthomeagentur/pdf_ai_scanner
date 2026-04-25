const { authenticate } = require("@google-cloud/local-auth");
const unzipper = require("unzipper");
const fs = require("fs");
const path = require("path");
const process = require("process");
const dotenv = require("dotenv");
var aiAgent = require("./app/aiAgent.js");
const { google } = require("googleapis");
const express = require("express");
const multer = require("multer");
const { exec } = require("child_process");
const { PDFDocument } = require("pdf-lib");

dotenv.config();

var debug = false;
var testrun = false;
var firststart = true;

const localDownloadFolder = path.join(__dirname, "downloads"); // Path to your "downloads" folder

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

app.use(express.static("public"));
app.use("/downloads", express.static(localDownloadFolder)); // Neu: Um Thumbnails der PDFs anzeigen zu können

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
  const algorithm = req.body.algorithm || "white_paper";
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
        if (err.code === "ECONNABORTED" || err.message === "Request aborted") {
          console.log(
            "[SCANNER] Client hat die Verbindung getrennt (ECONNABORTED). Hintergrund-Verarbeitung läuft weiter."
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
      if (isValidGoogleDriveId(FOLDER_ID)) {
        folderId = FOLDER_ID;
      } else {
        folderId = await findFolderId(drive, FOLDER_ID);
      }

      const aiStartTime = Date.now();
      var sortedName = await aiAgent.getPdfName(job.filePath);
      const aiEndTime = Date.now();
      const aiDurationMs = aiEndTime - aiStartTime;
      sortedName.duration = (aiDurationMs / 1000).toFixed(2); // save duration in seconds

      if (sortedName.success === false) {
        throw new Error("KI Verarbeitung fehlgeschlagen.");
      }

      let driveFile = null;
      if (FOLDER_ID_SORTED) {
        driveFile = await uploadFile(drive, job.filePath, FOLDER_ID_SORTED, sortedName.full);
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

//this needs a setup
const INTERVALL = 300; //Interval in seconds
const FILE_FOLDER_NAME = "Adobe Scan";
const ADOBE_USERNAME = process.env.ADOBE_USERNAME;
const ADOBE_PASSWORD = process.env.ADOBE_PASSWORD;
const CREDENTIALS_PATH = path.join(process.cwd(), "gdrive_secret.json");
const FOLDER_ID = process.env.DRIVE_FOLDER_ID; //ID of drive folder to sync to
const FOLDER_ID_SORTED = process.env.DRIVE_FOLDER_ID_SORTED; //ID to Upload renamed sorted files

//dont need setup here
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const COOKIES_FILE = "./cookies.json"; // Define path for where you will store the cookies
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;

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
    if (args.includes("--login")) {
      console.log("[START] Do Adobe Login Script");
      var isLoggedIn = await checkIfFileExists(COOKIES_FILE);
      if (isLoggedIn) {
        console.log("[START] Cookies already exist. Resetting them...");
        await fs.promises.unlink(COOKIES_FILE);
      }
      await adobeLogin();
      return true;
    }
    aiAgent.init(HUGGING_FACE_API_KEY, debug);
  }

  if (testrun) {
    return;
    for (var i = 1; i <= 10; i++) {
      var sortedName = await aiAgent.getPdfName(i + ".pdf");
      console.log(sortedName);
    }
    return;
  }

  var isLoggedIn = await checkIfFileExists(COOKIES_FILE);

  if (isLoggedIn) {
    var googleClient = await authorize();

    var driveData = await listNewestFiles(googleClient, FOLDER_ID, 50);
    const fileNamesDrive = driveData.map((file) => file.name);
    var filesDownloaded = await adobeDownloadFile(fileNamesDrive);

    if (filesDownloaded?.length > 0) {
      var success = await uploadFilesFromLocalFolder(googleClient, localDownloadFolder, FOLDER_ID);
      if (!success) {
        return sleep(INTERVALL * 1000).then(() => {
          init();
        });
      }
      await emptyFolder(localDownloadFolder);
    }

    console.log("next run in " + INTERVALL + " seconds");
    return sleep(INTERVALL * 1000).then(() => {
      init();
    });
  } else {
    console.log("No credentials found. Do Adobe login via --login parameter");
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

async function uploadFilesFromLocalFolder(authClient, localFolderPath, driveFolderIdentifier) {
  const drive = google.drive({ version: "v3", auth: authClient });
  let folderId;
  if (isValidGoogleDriveId(driveFolderIdentifier)) {
    folderId = driveFolderIdentifier;
  } else {
    const folderName = driveFolderIdentifier;
    folderId = await findFolderId(drive, folderName);
    if (!folderId) {
      console.log(`Folder "${folderName}" not found.`);
      return { success: false, message: `Folder "${folderName}" not found.` };
    }
  }

  try {
    const files = await fs.promises.readdir(localFolderPath);
    var uploadCount = 0;
    for (const file of files) {
      const filePath = path.join(localFolderPath, file);
      const fileStat = await fs.promises.stat(filePath);
      if (fileStat.isFile()) {
        if (FOLDER_ID_SORTED) {
          var sortedName = await aiAgent.getPdfName(filePath);
          console.log(sortedName);
          if (sortedName.success == false) return false;
          await uploadFile(drive, filePath, FOLDER_ID_SORTED, sortedName.full);
        }
        await uploadFile(drive, filePath, folderId);
        uploadCount++;
      } else if (fileStat.isDirectory()) {
        console.log(`Skipping folder ${file}`);
      }
    }
    console.log(
      `All (${uploadCount}) files from ${localFolderPath} uploaded to Google Drive folder with ID ${folderId}`
    );
    return true;
  } catch (error) {
    console.error(`Error reading local folder or uploading files:`, error);
    return false;
  }
}

async function listNewestFiles(authClient, folderIdentifier, limit = 20) {
  const drive = google.drive({ version: "v3", auth: authClient });
  let folderId;
  if (isValidGoogleDriveId(folderIdentifier)) {
    folderId = folderIdentifier;
  } else {
    const folderName = folderIdentifier;
    folderId = await findFolderId(drive, folderName);
    if (!folderId) {
      console.log(`Folder "${folderName}" not found.`);
      return [];
    }
  }

  let nextPageToken = null;
  let allFiles = [];

  do {
    const res = await drive.files.list({
      pageSize: 100, // Increased page size for efficiency
      fields: "nextPageToken, files(id, name, modifiedTime)",
      q: `'${folderId}' in parents`,
      orderBy: "modifiedTime desc",
      pageToken: nextPageToken,
    });

    if (res.data.files && res.data.files.length > 0) {
      allFiles = allFiles.concat(res.data.files);
    }

    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);

  allFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  const newestFiles = allFiles.slice(0, limit);

  return newestFiles;
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

async function emptyFolder(folderPath) {
  try {
    const folderExists = await fs.promises
      .access(folderPath)
      .then(() => true)
      .catch(() => false);
    if (!folderExists) {
      console.error("Folder does not exist:", folderPath);
      return;
    }

    // Read the contents of the folder
    const files = await fs.promises.readdir(folderPath);

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stat = await fs.promises.lstat(filePath);

      if (stat.isDirectory()) {
        // Recursively remove subdirectory contents
        await emptyFolder(filePath);
        // Remove the directory itself
        await fs.promises.rmdir(filePath);
      } else {
        // Delete the file
        await fs.promises.unlink(filePath);
      }
    }

    if (debug) console.log(`Emptied folder: ${folderPath}`);
  } catch (error) {
    console.error(`Error emptying folder: ${folderPath}`, error);
  }
}

async function checkIfFileExists(filePath) {
  try {
    await fs.promises.access(filePath); // Check if the file is accessible
    if (debug) console.log(`${filePath} exists.`);
    return true;
  } catch (error) {
    if (debug) console.log(`${filePath} does not exist.`);
    return false;
  }
}

async function waitLoad(page) {
  return new Promise(async (resolve) => {
    try {
      await page.waitForLoadState("domcontentloaded");
      //await page.waitForLoadState("networkidle");
      await sleep(1000);
      resolve(true);
    } catch (error) {
      console.warn("timeout error");
      resolve(false);
    }
  });
}

async function adobeLogin() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: false }); // Set to false to see the browser
  const context = await browser.newContext();
  const page = await context.newPage();
  let cookiesLoad = [];

  try {
    //const cookiesString = await fs.promises.readFile(COOKIES_FILE, "utf-8");
    //cookiesLoad = JSON.parse(cookiesString);
    //await context.addCookies(cookiesLoad);

    // Navigate to Adobe Sign-in
    await page.goto("https://account.adobe.com");
    await waitLoad(page);
    //await page.waitForSelector("#notificationIconOnEngine > svg", { timeout: 10000 }); // Wait for 10 seconds

    var checkUserLogin;
    try {
      // Wait for the specific element to be available on the page, if not found it will throw an exception.
      await page.waitForSelector("#notificationIconOnEngine > svg", { timeout: 20000 }); // Wait for 10 seconds
      checkUserLogin = await page.locator("#notificationIconOnEngine > svg").count();
    } catch (error) {
      console.warn("[LOGIN] Not logged in, continuing with login procedure");
    }

    if (checkUserLogin > 0) return { login: true, loadedLogin: true };

    // fill username
    await page.waitForSelector("#EmailPage-EmailField");
    await page.fill("#EmailPage-EmailField", ADOBE_USERNAME);
    await page.click('[data-id="EmailPage-ContinueButton"]');

    // fill password if asked
    var isPasswordPage = false;
    try {
      await page.waitForSelector("#PasswordPage-PasswordField", { timeout: 20000 });
      isPasswordPage = true;
    } catch (error) {
      isPasswordPage = false;
    }
    await sleep(5000);
    if (isPasswordPage) {
      console.log("[LOGIN] insert password no auth code");
      await page.fill("#PasswordPage-PasswordField", ADOBE_PASSWORD);
      await page.click('[data-id="PasswordPage-ContinueButton"]');
      waitLoad(page);
    } else {
      console.log("[LOGIN] No password page found, continuing without. Please fill email code");
      await page.click('[data-id="Page-PrimaryButton"]');
      waitLoad(page);
      await page.waitForSelector("#PasswordPage-PasswordField", { timeout: 60000 });
      console.log("[LOGIN] insert password auth code");
      await sleep(2000);
      await page.fill("#PasswordPage-PasswordField", ADOBE_PASSWORD);
      await page.click('[data-id="PasswordPage-ContinueButton"]');
    }
    await sleep(10000);
    const cookies = await context.cookies();
    await fs.promises.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`[LOGIN] Cookies saved to: ${COOKIES_FILE}`);
  } catch (error) {
    console.error("[LOGIN] An error occurred:", error);
  } finally {
    await browser.close();
  }
}
async function adobeDownloadFile(filesArrayDrive) {
  const { chromium } = require("playwright");
  var settings;
  if (debug) {
    settings = { headless: false };
  } else {
    settings = { headless: true };
  }
  const browser = await chromium.launch(settings); // Set to false to see the browser
  const context = await browser.newContext({
    viewport: { width: 1500, height: 800 }, // Specify the browser viewport size
  });
  const page = await context.newPage();
  let cookiesLoad = [];

  try {
    const cookiesString = await fs.promises.readFile(COOKIES_FILE, "utf-8");
    cookiesLoad = JSON.parse(cookiesString);
    await context.addCookies(cookiesLoad);

    console.log("update files from adobe cloud");

    // Navigate to Adobe Files and click Scan folder
    await page.goto("https://acrobat.adobe.com/link/documents/files");
    sleep(5000);

    await waitLoad(page);

    try {
      await page.waitForSelector("#onetrust-accept-btn-handler", { timeout: 5000 }); //check for cookie notification
      await page.click("#onetrust-accept-btn-handler");
    } catch (error) {
      if (debug) console.log("Skip Cookie notification");
    }

    try {
      await page.waitForSelector('div[data-test-id="' + FILE_FOLDER_NAME + '"]', { timeout: 20000 }); //search file folder
    } catch (error) {
      console.warn("Error loading page, skipping download procedure. This may cause issues");
      return;
    }

    await waitLoad(page);

    if (debug) console.log("adobe files loaded");
    const adobeScanFolder = page.locator('div[data-test-id="' + FILE_FOLDER_NAME + '"]').first();
    if ((await adobeScanFolder.count()) > 0) {
      if (debug) console.log(FILE_FOLDER_NAME + " folder found");
      //You can do something with this folder, for instance click the folder to navigate inside
      await adobeScanFolder.click();
    } else {
      console.warn(FILE_FOLDER_NAME + " folder not found.");
    }
    await waitLoad(page);

    // Load the Files list and get the newest files
    try {
      await page.waitForSelector(
        'div[data-scrollable="true"][role="rowgroup"] div[role="presentation"] div[role="presentation"]',
        {
          timeout: 20000,
        }
      );
    } catch (error) {
      console.warn("Error loading list of files in the folder, skipping download procedure. This may cause issues");
      return;
    }
    if (debug) console.log("Files List loaded");

    await page.evaluate(() => {
      document.body.style.transform = "scale(0.75)";
    });

    await waitLoad(page);
    await sleep(4000);

    const sortArrow = await page
      .locator(
        'div[data-test-id="table-view-wrapper"] div[role="row"] div[role="columnheader"][style*="display: flex;"][class*="spectrum-Table-headCell is-sortable"]:is([class*="is-sorted-asc"],[class*="is-sorted-desc"])'
      )
      .all();

    const classNames = await sortArrow[0].evaluate((el) => el.className);

    if (classNames.includes("is-sorted-asc")) {
      console.log("The files are sorted in ascending order. Changing it");
      //sortArrow.click();
      await page.click('div[role="columnheader"] div[data-test-id="modified-table-header"]');
      await waitLoad(page);
      await page.click('div[role="presentation"] div[role="menuitem"][data-test-id="modified"]');
      await waitLoad(page);
    } else {
      if (debug) console.log("The files are sorted in descending order. OK");
    }

    const items = await page.$$(
      'div[data-scrollable="true"][role="rowgroup"] div[role="presentation"] div[role="presentation"] div[data-test-id][role="link"]'
    );
    var filesArrayAdobe = [];
    for (const item of items.slice(0, 8)) {
      let downloadFile = false;
      const fileName = await item.getAttribute("data-test-id");

      var isUpload = filesArrayDrive.indexOf(fileName);
      if (isUpload < 0) downloadFile = true;

      filesArrayAdobe.push({ fileName, isDownloaded: downloadFile });
      if (debug) console.log(`File name: ${fileName} is download: ${downloadFile}`);
    }

    await waitLoad(page);

    const checkboxes = await page
      .locator(
        'div[data-scrollable="true"][role="rowgroup"] div[role="presentation"] div[role="presentation"] input[type="checkbox"][class="spectrum-Checkbox-input"]'
      )
      .all();

    const maxItemsToCheck = Math.min(checkboxes.length, filesArrayAdobe.length);
    if (debug) console.log("Files Count: " + maxItemsToCheck);

    //add logic to download the files

    var downloadedFilesArray = [];
    if (checkboxes.length > 0) {
      for (let index = 0; index < filesArrayAdobe.length; index++) {
        if (filesArrayAdobe[index].isDownloaded) {
          downloadedFilesArray.push(filesArrayAdobe[index].fileName);
          await checkboxes[index].click();
          if (debug) console.log("File " + index + " Selected");
          await waitLoad(page);
        }
      }
    } else {
      console.warn("Could not find the checkboxes");
    }

    if (downloadedFilesArray.length > 0) {
      console.log("Files to Download: " + downloadedFilesArray.length);
      await page.waitForSelector(
        'div[data-test-id="context-board-wrapper"] button[data-test-id="download-action-button"]',
        { timeout: 10000 }
      );
      await waitLoad(page);
      const downloadButton = await page
        .locator('div[data-test-id="context-board-wrapper"] button[data-test-id="download-action-button"]')
        .all();

      const [download] = await Promise.all([page.waitForEvent("download"), downloadButton[0].click()]);
      const suggestedFilename = download.suggestedFilename();
      const downloadPath = localDownloadFolder + `/${suggestedFilename}`;
      await download.saveAs(downloadPath);
      if (debug) console.log(`Downloaded: ${downloadPath}`);

      if (suggestedFilename.endsWith(".zip")) {
        if (debug) console.log("The filename ends with .zip. Doing a decompression first.");
        await decompressAndMove(downloadPath);
        fs.unlinkSync(downloadPath);
      }
    }
    await browser.close();
    return downloadedFilesArray;
  } catch (error) {
    console.error("An error occurred:", error);
    await browser.close();
  }
}

async function decompressFile(inputPath, outputPath) {
  return new Promise((resolve) => {
    fs.createReadStream(inputPath)
      .pipe(unzipper.Extract({ path: outputPath }))
      .on("close", () => {
        console.log("Files unzipped successfully");
        resolve(true);
      });
  });
}

async function decompressAndMove(inputPath) {
  // Get the directory where the .zip file is located
  const outputPath = path.dirname(inputPath);

  return new Promise((resolve, reject) => {
    fs.createReadStream(inputPath)
      .pipe(unzipper.Parse()) // Parse each entry in the zip file
      .on("entry", async (entry) => {
        const entryName = entry.path;
        const isInsideFolder = entryName.startsWith("Document Cloud/"); // Check if entry is inside "Document Cloud"

        if (entry.type === "File" && isInsideFolder) {
          const fileName = path.basename(entryName); // Extract file name
          const outputFilePath = path.join(outputPath, fileName);
          entry.pipe(fs.createWriteStream(outputFilePath));
        } else {
          entry.autodrain(); // Skip entries not in "Document Cloud"
        }
      })
      .on("close", () => {
        console.log("Files successfully extracted and moved.");
        resolve(true);
      })
      .on("error", (err) => {
        console.error("Error during extraction:", err);
        reject(err);
      });
  });
}

init();
