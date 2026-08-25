const express = require("express");
const fs = require("fs");
const { checkIsAdmin } = require("../middleware/auth");
const { appSettings } = require("../config/settings");
const { driveApi } = require("../services/driveService");
const { getJobs } = require("../services/jobQueueService");
const {
  extractExactSnippet,
  getLocalPdfText,
  getDrivePdfText,
  normalizeDocName,
} = require("../services/deepSearchService");

const router = express.Router();

router.get("/api/documents/deep-search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 2) {
      return res.json({ success: true, query: q, results: [], total: 0 });
    }

    const qLower = q.toLowerCase();
    const results = [];
    const seenJobIds = new Set();
    const seenNames = new Set();
    const isAdmin = checkIsAdmin(req);

    // 1. Google Drive search (if drive is connected)
    try {
      const drive = await driveApi.getClient();
      const folderId = appSettings.FOLDER_ID_SORTED || appSettings.FOLDER_ID;
      if (folderId) {
        const driveRes = await drive.files.list({
          q: `mimeType != 'application/vnd.google-apps.folder' and trashed = false and fullText contains '${q.replace(/'/g, "\\'")}'`,
          fields: "files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink, appProperties, description)",
          pageSize: 40,
        });

        const files = driveRes.data.files || [];
        const driveSnippetPromises = files.slice(0, 8).map(async (file) => {
          try {
            const driveText = await Promise.race([
              getDrivePdfText(drive, file.id, file.modifiedTime),
              new Promise((resolve) => setTimeout(() => resolve(""), 1500)),
            ]);
            return extractExactSnippet(driveText, q);
          } catch (e) {
            return "";
          }
        });

        const snippets = await Promise.all(driveSnippetPromises);

        files.forEach((file, index) => {
          const snippet = snippets[index] || file.description || "Gefunden in Dokument-Volltext (Google Drive)";
          seenNames.add(normalizeDocName(file.name));

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
    } catch (driveErr) {}

    // 2. Search local jobs
    const localJobs = getJobs("all", isAdmin);
    for (const job of localJobs) {
      if (seenJobIds.has(job.id)) continue;
      const normJobName = normalizeDocName(job.result?.full || job.originalName);
      if (normJobName && seenNames.has(normJobName)) continue;

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
        if (normJobName) seenNames.add(normJobName);

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
