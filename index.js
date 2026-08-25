// Suppress noisy internal PDF.js font parsing warnings from third-party libraries (pdf-parse)
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;
const isFontWarning = (msg) =>
  typeof msg === "string" &&
  (msg.includes("Ran out of space in font private use area") ||
    msg.includes("TT: undefined function:") ||
    msg.includes("Unknown/unsupported coordinate math opcode"));

console.warn = function (...args) {
  if (args.length > 0 && isFontWarning(args[0])) return;
  originalConsoleWarn.apply(console, args);
};

console.log = function (...args) {
  if (args.length > 0 && isFontWarning(args[0])) return;
  originalConsoleLog.apply(console, args);
};

const dotenv = require("dotenv");
dotenv.config();

const app = require("./src/server");
const aiAgent = require("./src/services/aiService");
const { appSettings } = require("./src/config/settings");
const { driveApi } = require("./src/services/driveService");
const {
  processQueue,
  uploadJobs,
  addJobs,
  processedDriveFiles,
  saveJobs,
} = require("./src/services/jobQueueService");
const { DOWNLOADS_DIR } = require("./src/config/paths");
const path = require("path");
const fs = require("fs");
const { pipeline } = require("stream/promises");

const port = process.env.PORT || 3000;
let debug = false;
let testrun = false;

const args = process.argv.slice(2);
if (args.includes("--debug")) debug = true;
if (args.includes("--test")) testrun = true;

aiAgent.init(debug);

async function checkDriveForNewFiles() {
  if (!appSettings.MONITOR_DRIVE || !appSettings.FOLDER_ID) return;

  try {
    let folderId = driveApi.isValidGoogleDriveId(appSettings.FOLDER_ID)
      ? appSettings.FOLDER_ID
      : await driveApi.findFolderId(appSettings.FOLDER_ID);

    if (!folderId) return;

    const drive = await driveApi.getClient();
    const res = await drive.files.list({
      q: `mimeType != 'application/vnd.google-apps.folder' and trashed = false and '${folderId}' in parents`,
      fields: "files(id, name, mimeType, size, createdTime, appProperties)",
      pageSize: 50,
    });

    const files = res.data.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      if (processedDriveFiles.includes(file.id)) continue;

      const isKnown = Object.values(uploadJobs).some(
        (j) => j.rawDriveId === file.id || j.driveFileId === file.id
      );
      if (isKnown) {
        processedDriveFiles.push(file.id);
        continue;
      }

      console.log(`[DRIVE MONITOR] Neue Datei in Quell-Ordner entdeckt: ${file.name} (ID: ${file.id})`);
      const safeName = file.name.toLowerCase().endsWith(".pdf") ? file.name : `${file.name}.pdf`;
      const localPath = path.join(DOWNLOADS_DIR, `${Date.now()}-${safeName}`);
      const dest = fs.createWriteStream(localPath);
      const downloadRes = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "stream" });
      await pipeline(downloadRes.data, dest);

      const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
      const newJob = {
        id: jobId,
        originalName: file.name,
        status: "pending",
        source: "google_drive",
        rawDriveId: file.id,
        driveFileId: file.id,
        isPrivate: file.appProperties?.isPrivate === "true",
        inAiPipeline: true,
        filePath: localPath,
        uploadDate: new Date().toISOString(),
      };

      processedDriveFiles.push(file.id);
      addJobs([newJob]);
    }
  } catch (err) {
    if (debug) console.warn("[DRIVE MONITOR] Fehler beim Polling:", err.message);
  }
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Web UI läuft auf http://0.0.0.0:${port}`);
  processQueue();
  setInterval(checkDriveForNewFiles, 15 * 1000);
  setTimeout(checkDriveForNewFiles, 5000);

  if (testrun) {
    console.log("[SYSTEM] Testmodus aktiv.");
  }
});
