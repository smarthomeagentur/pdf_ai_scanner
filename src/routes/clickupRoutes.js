const express = require("express");
const fs = require("fs");
const { requireAdmin } = require("../middleware/auth");
const { appSettings } = require("../config/settings");
const { getJob, saveJobs, uploadJobs, getJobs } = require("../services/jobQueueService");
const { driveApi } = require("../services/driveService");
const { getClickUpClient } = require("../services/clickupService");

const router = express.Router();

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
    return null;
  }
}

router.post("/api/clickup/verify", requireAdmin, async (req, res) => {
  try {
    const apiKey = (req.body.apiKey || req.headers["x-clickup-api-key"] || appSettings.CLICKUP_API_KEY || process.env.CLICKUP_API_KEY || "").trim();
    const listId = (req.body.listId || req.headers["x-clickup-list-id"] || appSettings.CLICKUP_LIST_ID || process.env.CLICKUP_LIST_ID || "").trim();
    if (!apiKey) return res.status(400).json({ success: false, error: "Kein ClickUp API-Key übergeben." });
    const client = getClickUpClient(apiKey, listId);
    const result = await client.verifyConnection(listId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/api/clickup/transfer", requireAdmin, async (req, res) => {
  const { jobId, force, apiKey: reqApiKey, listId: reqListId } = req.body;
  const apiKey = (reqApiKey || req.headers["x-clickup-api-key"] || appSettings.CLICKUP_API_KEY || process.env.CLICKUP_API_KEY || "").trim();
  const listId = (reqListId || req.headers["x-clickup-list-id"] || appSettings.CLICKUP_LIST_ID || process.env.CLICKUP_LIST_ID || "").trim();

  if (!apiKey) {
    return res.status(400).json({ success: false, error: "Kein ClickUp API-Key übergeben." });
  }

  const job = getJob(jobId);
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

    const client = getClickUpClient(apiKey, listId);
    const clickupRes = await client.createOrUpdateDocumentTask({
      fileBuffer,
      fileName: safeFileName,
      aiResult: job.result || {},
      existingTaskId: job.clickup?.taskId || null,
      listId: listId || undefined,
      uploadAttachment: !!fileBuffer && !job.clickup?.taskId,
    });

    job.clickup = {
      taskId: clickupRes.taskId,
      taskUrl: clickupRes.taskUrl,
      taskName: clickupRes.taskName,
      status: clickupRes.status,
      transferredAt: new Date().toISOString(),
    };
    saveJobs();

    res.json({ success: true, clickup: job.clickup });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || "Fehler beim ClickUp-Transfer." });
  }
});

router.get("/api/clickup/sync-preview", requireAdmin, async (req, res) => {
  try {
    const apiKey = (req.query.apiKey || req.headers["x-clickup-api-key"] || appSettings.CLICKUP_API_KEY || process.env.CLICKUP_API_KEY || "").trim();
    const listId = (req.query.listId || req.headers["x-clickup-list-id"] || appSettings.CLICKUP_LIST_ID || process.env.CLICKUP_LIST_ID || "").trim();
    const filterPrivate = req.query.filterPrivate !== undefined ? req.query.filterPrivate === "true" : appSettings.CLICKUP_FILTER_PRIVATE;

    if (!apiKey) {
      return res.status(400).json({ success: false, error: "Kein ClickUp API-Key übergeben." });
    }

    const client = getClickUpClient(apiKey, listId);
    const clickupTasks = await client.fetchListTasks(listId);
    const jobsList = getJobs("all", true).filter((j) => j.status === "completed" && j.result);

    const toCreate = [];
    const toUpdate = [];
    const upToDate = [];
    const toSkip = [];

    for (const job of jobsList) {
      const isPrivate =
        job.isPrivate ||
        (job.result.company && job.result.company.toLowerCase().includes("daniel")) ||
        (job.result.category && job.result.category.toLowerCase() === "privat");

      if (filterPrivate && isPrivate) {
        toSkip.push({
          jobId: job.id,
          fileName: job.result.full || job.originalName,
          company: job.result.company || "Unbekannt",
          category: job.result.category || "-",
          reason: "Privates Dokument (Filter aktiv)",
        });
        continue;
      }

      const matchingTask = client.findMatchingTask(job, clickupTasks);
      if (matchingTask) {
        const isCurrent = client.isTaskUpToDate(job, matchingTask);
        const itemInfo = {
          jobId: job.id,
          fileName: job.result.full || job.originalName,
          company: job.result.company || "Unbekannt",
          category: job.result.category || "-",
          isInvoice: !!job.result.isInvoice,
          amount: job.result.invoiceAmmount ? client.formatAmount(job.result.invoiceAmmount) : "",
          existingTaskId: matchingTask.id,
          existingTaskName: matchingTask.name,
          existingTaskStatus: matchingTask.status?.status || "offen",
          existingTaskUrl: matchingTask.url || `https://app.clickup.com/t/${matchingTask.id}`,
        };

        if (isCurrent) upToDate.push(itemInfo);
        else toUpdate.push(itemInfo);
      } else {
        toCreate.push({
          jobId: job.id,
          fileName: job.result.full || job.originalName,
          company: job.result.company || "Unbekannt",
          category: job.result.category || "-",
          isInvoice: !!job.result.isInvoice,
          amount: job.result.invoiceAmmount ? client.formatAmount(job.result.invoiceAmmount) : "",
          suggestedTaskName: client.generateTaskName(job.result),
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
    res.status(500).json({ success: false, error: err.message || "Fehler beim Erstellen der Sync-Vorschau." });
  }
});

router.post("/api/clickup/sync-all", requireAdmin, async (req, res) => {
  try {
    const { selectedJobIds, apiKey: reqApiKey, listId: reqListId, filterPrivate: reqFilterPrivate } = req.body;
    const apiKey = (reqApiKey || req.headers["x-clickup-api-key"] || appSettings.CLICKUP_API_KEY || process.env.CLICKUP_API_KEY || "").trim();
    const listId = (reqListId || req.headers["x-clickup-list-id"] || appSettings.CLICKUP_LIST_ID || process.env.CLICKUP_LIST_ID || "").trim();
    const filterPrivate = reqFilterPrivate !== undefined ? !!reqFilterPrivate : appSettings.CLICKUP_FILTER_PRIVATE;

    if (!apiKey) {
      return res.status(400).json({ success: false, error: "Kein ClickUp API-Key übergeben." });
    }

    const client = getClickUpClient(apiKey, listId);
    const clickupTasks = await client.fetchListTasks(listId);
    const jobsList = getJobs("all", true).filter((j) => {
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

      if (filterPrivate && isPrivate) {
        skippedCount++;
        continue;
      }

      try {
        const matchingTask = client.findMatchingTask(job, clickupTasks);
        if (!selectedJobIds && matchingTask && client.isTaskUpToDate(job, matchingTask)) {
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

        const clickupRes = await client.createOrUpdateDocumentTask({
          fileBuffer,
          fileName: safeFileName,
          aiResult: job.result || {},
          existingTaskId: matchingTask ? matchingTask.id : null,
          listId: listId || undefined,
          uploadAttachment: !!fileBuffer && !matchingTask,
        });

        job.clickup = {
          taskId: clickupRes.taskId,
          taskUrl: clickupRes.taskUrl,
          taskName: clickupRes.taskName,
          status: clickupRes.status,
          transferredAt: new Date().toISOString(),
        };

        if (clickupRes.isUpdated) updatedCount++;
        else createdCount++;
      } catch (err) {
        errors.push({ jobId: job.id, error: err.message });
      }
    }

    saveJobs();
    res.json({
      success: true,
      createdCount,
      updatedCount,
      skippedCount,
      errors,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
