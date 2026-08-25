const express = require("express");
const fs = require("fs");
const { requireAdmin } = require("../middleware/auth");
const { appSettings } = require("../config/settings");
const { TOKEN_FILE } = require("../config/paths");
const {
  driveApi,
  getPickerToken,
  resolveFolder,
  createFolder,
  listFolders,
  getFolder,
} = require("../services/driveService");
const {
  findMatchingJobForDriveFile,
  checkJobNeedsEnrichment,
  getDriveSyncState,
  executeDriveSync,
  uploadJobs,
  hiddenDriveFiles,
  saveJobs,
} = require("../services/jobQueueService");

const router = express.Router();

router.get("/api/drive/picker-token", requireAdmin, async (req, res) => {
  try {
    const data = await getPickerToken();
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || "Fehler beim Laden des Picker-Tokens." });
  }
});

router.get("/api/drive/folders", requireAdmin, async (req, res) => {
  try {
    const parentId = req.query.parentId || "root";
    const folders = await listFolders(parentId);
    res.json({ success: true, folders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/api/drive/folders", requireAdmin, async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const folder = await createFolder(name, parentId);
    res.json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/drive/folders/:id", requireAdmin, async (req, res) => {
  try {
    const folder = await getFolder(req.params.id);
    res.json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/api/drive/sync-preview", requireAdmin, async (req, res) => {
  try {
    if (!fs.existsSync(TOKEN_FILE)) {
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

      const matchingJob = findMatchingJobForDriveFile(file, true);
      const isManuallyHidden = hiddenDriveFiles.includes(file.id) || (matchingJob && matchingJob.isHidden);
      if (isManuallyHidden) {
        if (!hiddenDriveFiles.includes(file.id)) {
          hiddenDriveFiles.push(file.id);
          saveJobs();
        }
        skipped.push({
          id: file.id,
          name: file.name,
          reason: "Manuell ausgeblendet",
          size: file.size,
          webViewLink: file.webViewLink,
        });
        continue;
      }

      const isDuplicate = matchingJob && (matchingJob.suspectedDuplicate || matchingJob.isDuplicate || matchingJob.duplicateOf || matchingJob.status === "duplicate");
      if (isDuplicate) {
        skipped.push({
          id: file.id,
          name: file.name,
          reason: "Als Duplikat markiert",
          size: file.size,
          webViewLink: file.webViewLink,
        });
        continue;
      }

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
      syncState: getDriveSyncState().syncState,
    });
  } catch (err) {
    console.error("[DRIVE SYNC PREVIEW] Fehler:", err);
    res.status(500).json({ success: false, error: err.message || "Fehler beim Laden der Drive-Vorschau." });
  }
});

router.post("/api/drive/ignore-file", requireAdmin, (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ success: false, error: "fileId erforderlich." });
  if (!hiddenDriveFiles.includes(fileId)) {
    hiddenDriveFiles.push(fileId);
    saveJobs();
  }
  res.json({ success: true, message: "Datei dauerhaft für Google Drive Sync ausgeblendet." });
});

router.post("/api/drive/unignore-file", requireAdmin, (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ success: false, error: "fileId erforderlich." });
  const idx = hiddenDriveFiles.indexOf(fileId);
  if (idx !== -1) {
    hiddenDriveFiles.splice(idx, 1);
    saveJobs();
  }
  res.json({ success: true, message: "Datei wird beim nächsten Sync wieder berücksichtigt." });
});

router.get("/api/drive/sync-status", requireAdmin, (req, res) => {
  res.json({
    success: true,
    ...getDriveSyncState(),
  });
});

router.post("/api/drive/sync-execute", requireAdmin, async (req, res) => {
  try {
    const { items } = req.body;
    const result = await executeDriveSync(items);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
