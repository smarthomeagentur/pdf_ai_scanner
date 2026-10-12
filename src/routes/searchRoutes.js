const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const { checkIsAdmin } = require("../middleware/auth");
const { appSettings } = require("../config/settings");
const { driveApi } = require("../services/driveService");
const jobQueue = require("../services/jobQueueService");
const { getJobs } = jobQueue;
const {
  extractExactSnippet,
  getLocalPdfText,
  getDrivePdfText,
  normalizeDocKey,
} = require("../services/deepSearchService");

const router = express.Router();

// Identical PDF text => same document (scan without text layer yields no fingerprint)
function getTextFingerprint(text) {
  const normalized = (text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length < 80) return null;
  return `txt:${crypto.createHash("sha1").update(normalized).digest("hex")}`;
}

router.get("/api/documents/deep-search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) {
      return res.json({ success: true, query: q, results: [], total: 0 });
    }

    const qLower = q.toLowerCase();
    const results = [];
    const seenJobIds = new Set();
    const seenDriveKeys = new Set();
    const isAdmin = checkIsAdmin(req);
    const localJobs = getJobs("all", isAdmin);

    // Every processed scan exists twice on Drive (raw file in the scan folder via rawDriveId,
    // renamed copy in the sorted folder via driveFileId) plus the local job. Map all of them to the job.
    const jobByDriveId = new Map();
    const jobByNameKey = new Map();
    for (const job of localJobs) {
      const sortedId = job.result?.webViewLink?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
      for (const id of [job.rawDriveId, job.driveFileId, sortedId]) {
        if (id) jobByDriveId.set(String(id).replace(/^gdrive_/, ""), job);
      }
      for (const name of [job.result?.full, job.originalName]) {
        const key = normalizeDocKey(name);
        if (key && !jobByNameKey.has(key)) jobByNameKey.set(key, job);
      }
    }
    const hiddenDriveIds = new Set(jobQueue.hiddenDriveFiles || []);

    // 1. Google Drive search (if drive is connected and user is admin)
    if (isAdmin) {
      try {
        const drive = await driveApi.getClient();
        // Only search the "verarbeitet" (sorted) folder; raw scans would just duplicate processed documents
        const rawFld = appSettings.FOLDER_ID_SORTED || "";
        const parenMatch = rawFld.match(/\(([a-zA-Z0-9_-]{10,})\)$/);
        let folderId = parenMatch ? parenMatch[1] : rawFld.trim();
        if (folderId && !driveApi.isValidGoogleDriveId(folderId)) {
          folderId = await driveApi.findFolderId(folderId);
        }
        if (folderId) {
          const driveRes = await drive.files.list({
            q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false and fullText contains '${q.replace(/'/g, "\\'")}'`,
            fields: "files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink, appProperties, description, md5Checksum)",
            pageSize: 40,
          });

          const files = (driveRes.data.files || []).filter((file) => !hiddenDriveIds.has(file.id));
          const driveTexts = await Promise.all(
            files.map((file) =>
              Promise.race([
                getDrivePdfText(drive, file.id, file.modifiedTime),
                new Promise((resolve) => setTimeout(() => resolve(""), 3500)),
              ]).catch(() => "")
            )
          );
          const textKeys = driveTexts.map(getTextFingerprint);

          // Re-processing a job used to leave older sorted copies (different AI name, different md5)
          // on Drive. Their PDF text is identical, so files sharing a text fingerprint with a
          // job-linked file belong to that job as well.
          const directJobs = files.map(
            (file) =>
              jobByDriveId.get(file.id) ||
              (file.appProperties?.jobId && localJobs.find((j) => j.id === file.appProperties.jobId)) ||
              jobByNameKey.get(normalizeDocKey(file.name)) ||
              null
          );
          const jobByTextKey = new Map();
          directJobs.forEach((job, index) => {
            if (job && textKeys[index] && !jobByTextKey.has(textKeys[index])) jobByTextKey.set(textKeys[index], job);
          });

          files.forEach((file, index) => {
            let snippet = extractExactSnippet(driveTexts[index], q, 80);
            if (!snippet && file.description) {
              snippet = extractExactSnippet(file.description, q, 80) || file.description;
            }
            if (!snippet) {
              snippet = "Gefunden in Dokument-Volltext (Google Drive)";
            }

            const textKey = textKeys[index];
            const job = directJobs[index] || (textKey && jobByTextKey.get(textKey));
            if (job) {
              if (seenJobIds.has(job.id)) return;
              seenJobIds.add(job.id);
              results.push({
                id: job.id,
                jobId: job.id,
                name: job.result?.full || job.originalName || file.name,
                source: "Google Drive",
                type: "local",
                isLocal: true,
                isLinked: true,
                date: job.uploadDate,
                webViewLink: job.result?.webViewLink || file.webViewLink,
                thumbnailLink: `/api/thumbnail/${job.id}`,
                snippet,
              });
              return;
            }

            const nameKey = normalizeDocKey(file.name);
            const contentKey = file.md5Checksum ? `md5:${file.md5Checksum}` : null;
            const dedupeKeys = [nameKey, contentKey, textKey].filter(Boolean);
            if (dedupeKeys.some((key) => seenDriveKeys.has(key))) return;
            dedupeKeys.forEach((key) => seenDriveKeys.add(key));

            results.push({
              id: `gdrive_${file.id}`,
              jobId: `gdrive_${file.id}`,
              name: file.name,
              originalName: file.name,
              source: "Google Drive",
              type: "drive",
              isLocal: false,
              isDriveOnly: true,
              isLinked: true,
              date: file.createdTime,
              uploadDate: file.createdTime,
              size: file.size,
              webViewLink: file.webViewLink,
              thumbnailLink: file.thumbnailLink || `/api/thumbnail/${file.id}`,
              snippet,
            });
          });
        }
      } catch (driveErr) {
        console.error("[SEARCH] Google Drive Volltextsuche Fehler:", driveErr.message || driveErr);
      }
    }

    // 2. Search local jobs
    for (const job of localJobs) {
      if (seenJobIds.has(job.id)) continue;

      if (!job.filePath || !fs.existsSync(job.filePath)) continue;

      const fullText = await getLocalPdfText(job.filePath);
      const resData = job.result || {};
      const metaText = `${job.originalName || ""} ${resData.full || ""} ${resData.company || ""} ${resData.invoiceNumber || ""} ${resData.category || ""} ${(resData.tags || []).join(" ")} ${job.notes || ""}`;

      const lowerFull = fullText.toLowerCase();
      const lowerMeta = metaText.toLowerCase();

      if (lowerFull.includes(qLower) || lowerMeta.includes(qLower)) {
        let snippet = "";
        if (lowerFull.includes(qLower)) {
          snippet = extractExactSnippet(fullText, q);
        } else {
          const matchingFields = [];
          if (resData.company && resData.company.toLowerCase().includes(qLower)) matchingFields.push(`Firma: ${resData.company}`);
          if (resData.invoiceNumber && resData.invoiceNumber.toLowerCase().includes(qLower)) matchingFields.push(`Rechnungs-Nr: ${resData.invoiceNumber}`);
          if (resData.category && resData.category.toLowerCase().includes(qLower)) matchingFields.push(`Kategorie: ${resData.category}`);
          snippet = matchingFields.length > 0 ? matchingFields.join(" | ") : `Gefunden in Metadaten: ${resData.company || ""}`.trim();
        }

        seenJobIds.add(job.id);

        results.push({
          id: job.id,
          jobId: job.id,
          name: job.result?.full || job.originalName || "Dokument",
          source: job.source === "gmail" ? "E-Mail Inbox" : "Lokaler Upload / Scanner",
          type: "local",
          isLocal: true,
          isLinked: false,
          date: job.uploadDate,
          size: fs.statSync(job.filePath).size,
          filePath: job.filePath,
          thumbnailLink: `/api/thumbnail/${job.id}`,
          snippet,
        });
      }
    }

    res.json({ success: true, query: q, results, total: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
