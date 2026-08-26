const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { pipeline } = require("stream/promises");
const aiAgent = require("./aiService");
const { DOWNLOADS_DIR, getPythonPath } = require("../config/paths");
const { appSettings } = require("../config/settings");
const { driveApi } = require("./driveService");
const { findDuplicatesForJob } = require("./duplicateService");
const { renderPdfToJpeg } = require("./fileRenderService");
const { ClickUpAPI } = require("./clickupService");
const dbWrapper = require("../db/database");

let uploadJobs = {};
let uploadQueue = [];
let processedDriveFiles = [];
let hiddenDriveFiles = [];
let isProcessingQueue = false;

let driveSyncState = {
  running: false,
  total: 0,
  processed: 0,
  currentFileName: "",
  startedAt: null,
  finishedAt: null,
  errors: [],
};

function persistJob(job) {
  if (!job || !job.id) return;
  try {
    dbWrapper.insertOrReplaceJob(job);
  } catch (err) {
    console.error(`[SQLITE] Fehler beim Speichern von Job ${job.id}:`, err);
  }
}

function persistAppState() {
  try {
    dbWrapper.setAppState("upload_queue", JSON.stringify(uploadQueue));
    dbWrapper.setAppState("processed_drive_files", JSON.stringify(processedDriveFiles));
    dbWrapper.setAppState("hidden_drive_files", JSON.stringify(hiddenDriveFiles));
  } catch (err) {
    console.error("[SQLITE] Fehler beim Speichern des App-Status:", err);
  }
}

async function loadJobs() {
  try {
    await dbWrapper.initDatabase();

    // 1. App-State laden
    const qStr = dbWrapper.getAppState("upload_queue");
    if (qStr) {
      try { uploadQueue = JSON.parse(qStr); } catch (e) {}
    }

    const pStr = dbWrapper.getAppState("processed_drive_files");
    if (pStr) {
      try { processedDriveFiles = JSON.parse(pStr); } catch (e) {}
    }

    const hStr = dbWrapper.getAppState("hidden_drive_files");
    if (hStr) {
      try { hiddenDriveFiles = JSON.parse(hStr); } catch (e) {}
    }

    // 2. Jobs aus SQLite laden
    const allJobs = dbWrapper.getAllJobs();
    uploadJobs = {};

    let recoveredCount = 0;
    for (const job of allJobs) {
      if (!job || !job.id) continue;

      if (job.isHidden) {
        if (job.rawDriveId && !hiddenDriveFiles.includes(job.rawDriveId)) {
          hiddenDriveFiles.push(job.rawDriveId);
        }
        if (job.driveFileId && !hiddenDriveFiles.includes(job.driveFileId)) {
          hiddenDriveFiles.push(job.driveFileId);
        }
        const sortedId = job.result?.webViewLink?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
        if (sortedId && !hiddenDriveFiles.includes(sortedId)) {
          hiddenDriveFiles.push(sortedId);
        }
      }

      if (job.result && job.result.localThumbnail) {
        delete job.result.localThumbnail;
      }
      if (job.localThumbnail) {
        delete job.localThumbnail;
      }

      const wasInterrupted =
        job.status === "processing" ||
        job.status === "pending" ||
        job.error === "Verarbeitung durch Server-Neustart unterbrochen.";
      if (wasInterrupted) {
        job.status = "pending";
        job.error = null;
        job.inAiPipeline = true;
        if (!uploadQueue.includes(job.id)) {
          uploadQueue.push(job.id);
        }
        recoveredCount++;
      }

      if (job.result && job.result.documentDate) {
        const dateCheck = validateDocumentDate(job.result.documentDate, job.uploadDate);
        if (dateCheck.isInvalidFuture) {
          job.result.documentDate = dateCheck.validDateStr;
          job.result.rawDocumentDate = dateCheck.rawDateStr;
          job.documentDate = dateCheck.validDateStr;
        }
      }

      uploadJobs[job.id] = job;
      dbWrapper.insertOrReplaceJob(job);
    }

    uploadQueue = [...new Set(uploadQueue)].filter(
      (id) => uploadJobs[id] && uploadJobs[id].status === "pending"
    );

    if (recoveredCount > 0) {
      console.log(
        `[SQLITE] ${recoveredCount} durch Server-Neustart unterbrochene Jobs automatisch wieder in die Queue aufgenommen.`
      );
    }

    persistAppState();
    console.log(
      `[SQLITE] Verbunden mit store/database.sqlite (${Object.keys(uploadJobs).length} Belege geladen)`
    );
  } catch (e) {
    console.error("[SQLITE] Fehler beim Laden der Datenbank:", e);
  }
}

function saveJobs() {
  try {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    // 30 Tage Cleanup
    dbWrapper.cleanupOldJobs(now - thirtyDaysMs);

    for (const jobId in uploadJobs) {
      const jobTime = new Date(uploadJobs[jobId].uploadDate).getTime();
      if (now - jobTime > thirtyDaysMs) {
        delete uploadJobs[jobId];
        dbWrapper.deleteJobById(jobId);
      } else {
        persistJob(uploadJobs[jobId]);
      }
    }

    persistAppState();
  } catch (e) {
    console.error("[SQLITE] Fehler beim Speichern:", e);
  }
}

// Initialer Boot
loadJobs();

function validateDocumentDate(docDateStr, uploadDateStr) {
  if (!docDateStr || docDateStr === "unknown" || docDateStr === "none" || docDateStr === "-") {
    return { validDateStr: "unknown", isInvalidFuture: false };
  }
  const uploadDate = uploadDateStr ? new Date(uploadDateStr) : new Date();
  const maxAllowed = new Date(
    uploadDate.getFullYear(),
    uploadDate.getMonth(),
    uploadDate.getDate(),
    23,
    59,
    59,
    999
  ).getTime();

  let parsed = null;
  const cleanStr = String(docDateStr).replace(/\(.*?\)/g, "").trim();
  const deMatch = cleanStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (deMatch) {
    parsed = new Date(
      parseInt(deMatch[3], 10),
      parseInt(deMatch[2], 10) - 1,
      parseInt(deMatch[1], 10)
    );
  } else {
    const isoMatch = cleanStr.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (isoMatch) {
      parsed = new Date(
        parseInt(isoMatch[1], 10),
        parseInt(isoMatch[2], 10) - 1,
        parseInt(isoMatch[3], 10)
      );
    }
  }

  if (parsed && !isNaN(parsed.getTime())) {
    if (parsed.getTime() > maxAllowed) {
      const day = String(uploadDate.getDate()).padStart(2, "0");
      const month = String(uploadDate.getMonth() + 1).padStart(2, "0");
      const year = uploadDate.getFullYear();
      const fallbackFormatted = `${day}.${month}.${year}`;
      return {
        validDateStr: fallbackFormatted,
        rawDateStr: docDateStr,
        isInvalidFuture: true,
      };
    }
  }
  return { validDateStr: docDateStr, isInvalidFuture: false };
}

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

function findMatchingJobForDriveFile(file, isAdmin = true) {
  if (!file) return null;
  const fName = (file.name || "").toLowerCase().replace(/\.pdf$/i, "").trim();
  const fId = file.id;

  const jobs = Object.values(uploadJobs);
  for (const job of jobs) {
    if (job.isPrivate && !isAdmin) continue;
    if (job.driveFileId && job.driveFileId === fId) return job;
    if (job.rawDriveId && (job.rawDriveId === fId || job.rawDriveId === fId.replace("gdrive_", ""))) return job;
    if (job.id && (job.id === fId || job.id === `gdrive_${fId}`)) return job;
    if (job.result?.webViewLink && job.result.webViewLink.includes(fId)) return job;
    if (file.webViewLink && job.result?.webViewLink && job.result.webViewLink === file.webViewLink) return job;
  }

  for (const job of jobs) {
    if (job.isPrivate && !isAdmin) continue;
    const normFull = (job.result?.full || "").toLowerCase().replace(/\.pdf$/i, "").trim();
    const normOrig = (job.originalName || "").toLowerCase().replace(/\.pdf$/i, "").trim();
    if (fName && (fName === normFull || fName === normOrig)) {
      if (!job.driveFileId && fId) {
        job.driveFileId = fId;
        persistJob(job);
      }
      return job;
    }
  }

  return null;
}

async function processSingleJob(jobId) {
  const job = uploadJobs[jobId];
  if (!job) return;

  job.status = "processing";
  job.processingStartedAt = Date.now();
  persistJob(job);

  try {
    console.log(`[WEB] Processing job ${jobId} for file ${job.originalName}...`);
    let folderId = driveApi.isValidGoogleDriveId(appSettings.FOLDER_ID)
      ? appSettings.FOLDER_ID
      : await driveApi.findFolderId(appSettings.FOLDER_ID);

    let defaultDriveFile = null;
    if (!job.rawDriveId) {
      let uploadOptions = job.isPrivate ? { appProperties: { isPrivate: "true" } } : undefined;
      defaultDriveFile = await driveApi.uploadFile(job.filePath, folderId, uploadOptions);
      if (defaultDriveFile) {
        processedDriveFiles.push(defaultDriveFile.id);
        job.rawDriveId = defaultDriveFile.id;
        persistAppState();
      }
    }

    const aiStartTime = Date.now();
    const sortedName = await aiAgent.getPdfName(job.filePath, appSettings);
    sortedName.duration = ((Date.now() - aiStartTime) / 1000).toFixed(2);

    if (sortedName.success === false) {
      throw new Error(sortedName.error || "KI-Verarbeitung fehlgeschlagen.");
    }

    if (sortedName.documentDate && sortedName.documentDate !== "unknown") {
      const dateCheck = validateDocumentDate(sortedName.documentDate, job.uploadDate);
      if (dateCheck.isInvalidFuture) {
        sortedName.documentDate = dateCheck.validDateStr;
        sortedName.rawDocumentDate = dateCheck.rawDateStr;
      }
    }

    const tagsArr = Array.isArray(sortedName.tags) ? sortedName.tags : [];
    if (sortedName.isInvoice) tagsArr.push("Rechnung");
    if (sortedName.documentDate && sortedName.documentDate !== "unknown")
      tagsArr.push(`Datum:${sortedName.documentDate}`);
    if (sortedName.isInvoice !== undefined) tagsArr.push(`isInvoice:${sortedName.isInvoice}`);
    if (sortedName.invoiceNumber && sortedName.invoiceNumber !== "none")
      tagsArr.push(`invoiceNumber:${sortedName.invoiceNumber}`);
    if (sortedName.invoiceAmmount !== undefined)
      tagsArr.push(`invoiceAmmount:${sortedName.invoiceAmmount}`);

    try {
      const { exiftool } = require("exiftool-vendored");
      await exiftool.write(job.filePath, {
        Title: sortedName.full || "Dokument",
        Author: sortedName.company || "Unbekannt",
        Subject: sortedName.category || "",
        Creator: "AI Document Scanner",
        Keywords: tagsArr,
      });
      if (fs.existsSync(job.filePath + "_original")) {
        await fs.promises.unlink(job.filePath + "_original").catch(() => {});
      }
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
            appProperties: job.isPrivate ? { isPrivate: "true" } : undefined,
          }
        )
      : null;

    driveFile = driveFile || defaultDriveFile;

    if (driveFile) {
      job.driveFileId = driveFile.id;
      if (driveFile.id && !processedDriveFiles.includes(driveFile.id)) {
        processedDriveFiles.push(driveFile.id);
        persistAppState();
      }
      sortedName.webViewLink = driveFile.webViewLink;
      sortedName.thumbnailLink = driveFile.thumbnailLink;
      sortedName.webContentLink = driveFile.webContentLink;
    }

    const targetThumb = path.join(DOWNLOADS_DIR, `thumb_${jobId}.jpg`);
    if (fs.existsSync(job.filePath) && !fs.existsSync(targetThumb)) {
      try {
        await renderPdfToJpeg(job.filePath, targetThumb);
      } catch (thumbErr) {}
    }

    await fs.promises.unlink(job.filePath).catch(() => {});

    // Duplicate detection
    job.result = sortedName;
    const dups = findDuplicatesForJob(job, uploadJobs);
    if (dups.length > 0) {
      job.suspectedDuplicate = true;
      job.duplicateOf = dups[0].job.id;
      job.duplicateReason = dups[0].reason;
      job.duplicateDocName = dups[0].job.result?.full || dups[0].job.originalName;
      console.log(`[DUPLICATE] Job ${jobId} als Duplikat von Job ${dups[0].job.id} erkannt (${dups[0].reason}).`);
    }

    job.status = "completed";
    job.error = null;
    job.inAiPipeline = false;
  } catch (err) {
    console.error(`[WEB] Error processing job ${jobId}:`, err);
    job.status = "failed";
    job.error = err.message || "Unbekannter Fehler bei der Verarbeitung";
    job.inAiPipeline = false;
  } finally {
    persistJob(job);
    persistAppState();
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  while (uploadQueue.length > 0) {
    const jobId = uploadQueue.shift();
    if (jobId && uploadJobs[jobId] && uploadJobs[jobId].status === "pending") {
      persistAppState();
      await processSingleJob(jobId);
    }
  }
  persistAppState();
  isProcessingQueue = false;
}

function addJobs(newJobs) {
  for (const job of newJobs) {
    uploadJobs[job.id] = job;
    uploadQueue.push(job.id);
    persistJob(job);
  }
  persistAppState();
  processQueue();
}

function getJobs(ids = "all", isAdmin = true) {
  if (typeof ids === "boolean") {
    isAdmin = ids;
    ids = "all";
  }
  let list =
    ids === "all" || !ids
      ? Object.values(uploadJobs).sort(
          (a, b) => new Date(b.uploadDate) - new Date(a.uploadDate)
        )
      : (typeof ids === "string" ? ids.split(",") : Array.isArray(ids) ? ids : []).map((id) => uploadJobs[id]).filter(Boolean);

  if (!isAdmin) {
    list = list.filter((j) => !j.isPrivate);
  }
  return list;
}

function getJob(id) {
  return uploadJobs[id] || null;
}

function updateJob(id, updates) {
  if (!uploadJobs[id]) return null;
  Object.assign(uploadJobs[id], updates);
  persistJob(uploadJobs[id]);
  return uploadJobs[id];
}

function deleteJob(id) {
  return hideJob(id) !== null;
}

function clearAllJobs() {
  Object.keys(uploadJobs).forEach((id) => hideJob(id));
  persistAppState();
}

function hideJob(jobId) {
  const job = uploadJobs[jobId];
  if (!job) return null;
  job.isHidden = true;
  if (job.rawDriveId && !hiddenDriveFiles.includes(job.rawDriveId)) hiddenDriveFiles.push(job.rawDriveId);
  if (job.driveFileId && !hiddenDriveFiles.includes(job.driveFileId)) hiddenDriveFiles.push(job.driveFileId);
  const sortedId = job.result?.webViewLink?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (sortedId && !hiddenDriveFiles.includes(sortedId)) hiddenDriveFiles.push(sortedId);
  persistJob(job);
  persistAppState();
  return job;
}

function unhideJob(jobId) {
  const job = uploadJobs[jobId];
  if (!job) return null;
  job.isHidden = false;
  if (job.rawDriveId) hiddenDriveFiles = hiddenDriveFiles.filter((id) => id !== job.rawDriveId);
  if (job.driveFileId) hiddenDriveFiles = hiddenDriveFiles.filter((id) => id !== job.driveFileId);
  const sortedId = job.result?.webViewLink?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (sortedId) hiddenDriveFiles = hiddenDriveFiles.filter((id) => id !== sortedId);
  persistJob(job);
  persistAppState();
  return job;
}

function getDriveSyncState() {
  return {
    syncState: driveSyncState,
    queueLength: uploadQueue.length,
    isProcessing: isProcessingQueue,
  };
}

async function executeDriveSync(items) {
  if (driveSyncState.running) {
    throw new Error("Synchronisation läuft bereits im Hintergrund.");
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("Keine Belege zur Synchronisation ausgewählt.");
  }

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

  (async () => {
    console.log(`[DRIVE SYNC] Starte Synchronisation für ${items.length} Belege...`);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        driveSyncState.currentFileName = item.name;
        const safeName = item.name.toLowerCase().endsWith(".pdf") ? item.name : `${item.name}.pdf`;
        const localPath = path.join(DOWNLOADS_DIR, `${Date.now()}-${safeName}`);
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
            rawDriveId: item.id,
            driveFileId: item.id,
            inAiPipeline: true,
            filePath: localPath,
            uploadDate: new Date().toISOString(),
          };
        } else {
          uploadJobs[jobId].filePath = localPath;
          uploadJobs[jobId].status = "pending";
          uploadJobs[jobId].inAiPipeline = true;
          uploadJobs[jobId].rawDriveId = item.id;
        }

        persistJob(uploadJobs[jobId]);
        persistAppState();
        await processSingleJob(jobId);
        driveSyncState.processed = i + 1;
      } catch (err) {
        console.error(`[DRIVE SYNC] Fehler bei Beleg ${item.name}:`, err);
        driveSyncState.errors.push({ name: item.name, error: err.message });
      }
    }
    driveSyncState.running = false;
    driveSyncState.finishedAt = new Date().toISOString();
    console.log(`[DRIVE SYNC] Synchronisation abgeschlossen: ${driveSyncState.processed}/${items.length} verarbeitet.`);
  })();

  return { success: true, total: items.length };
}

async function importDriveFile(driveFileId, name = null) {
  const cleanId = String(driveFileId).replace(/^gdrive_/, "");
  const drive = await driveApi.getClient();

  let fileName = name;
  let webViewLink = null;
  if (!fileName) {
    const fileMeta = await drive.files.get({
      fileId: cleanId,
      fields: "id, name, webViewLink",
    });
    fileName = fileMeta.data.name;
    webViewLink = fileMeta.data.webViewLink;
  }

  const safeName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  const localPath = path.join(DOWNLOADS_DIR, `${Date.now()}-${safeName}`);
  const dest = fs.createWriteStream(localPath);
  const downloadRes = await drive.files.get({ fileId: cleanId, alt: "media" }, { responseType: "stream" });
  await pipeline(downloadRes.data, dest);

  const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
  const targetThumb = path.join(DOWNLOADS_DIR, `thumb_${jobId}.jpg`);
  renderPdfToJpeg(localPath, targetThumb).catch(() => {});

  const newJob = {
    id: jobId,
    originalName: fileName,
    status: "pending",
    source: "drive_import",
    rawDriveId: cleanId,
    driveFileId: cleanId,
    webViewLink: webViewLink || `https://drive.google.com/file/d/${cleanId}/view`,
    inAiPipeline: true,
    aiPipelineStartedAt: new Date().toISOString(),
    result: null,
    error: null,
    filePath: localPath,
    uploadDate: new Date().toISOString(),
  };

  uploadJobs[jobId] = newJob;
  uploadQueue.push(jobId);
  persistJob(newJob);
  persistAppState();
  processQueue();

  return newJob;
}

function retryJob(jobId) {
  const job = uploadJobs[jobId];
  if (!job) return null;
  job.status = "pending";
  job.inAiPipeline = true;
  job.error = null;
  job.aiPipelineStartedAt = new Date().toISOString();
  if (!uploadQueue.includes(jobId)) {
    uploadQueue.push(jobId);
  }
  persistJob(job);
  persistAppState();
  processQueue();
  return job;
}

module.exports = {
  loadJobs,
  saveJobs,
  addJobs,
  getJobs,
  getJob,
  updateJob,
  deleteJob,
  clearAllJobs,
  hideJob,
  unhideJob,
  retryJob,
  processQueue,
  processSingleJob,
  findMatchingJobForDriveFile,
  checkJobNeedsEnrichment,
  validateDocumentDate,
  getDriveSyncState,
  executeDriveSync,
  importDriveFile,
  get uploadJobs() {
    return uploadJobs;
  },
  get hiddenDriveFiles() {
    return hiddenDriveFiles;
  },
};
