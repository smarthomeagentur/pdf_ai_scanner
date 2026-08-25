const express = require("express");
const fs = require("fs");
const path = require("path");
const { requireAdmin, checkIsAdmin } = require("../middleware/auth");
const { isSafeSubpath } = require("../middleware/security");
const { upload } = require("../middleware/upload");
const { uploadLimiter } = require("../middleware/rateLimiters");
const { DOWNLOADS_DIR } = require("../config/paths");
const {
  uploadJobs,
  addJobs,
  getJobs,
  getJob,
  updateJob,
  deleteJob,
  clearAllJobs,
  hideJob,
  unhideJob,
  saveJobs,
  processQueue,
} = require("../services/jobQueueService");
const { getOrGenerateThumbnailPath, renderPdfToJpeg } = require("../services/fileRenderService");
const { normalizeAlphaNum } = require("../services/duplicateService");

const router = express.Router();

router.get("/api/status", (req, res) => {
  const isAdmin = checkIsAdmin(req);
  const statuses = getJobs(req.query.ids || "all", isAdmin);
  res.json({ success: true, statuses });
});

router.post("/api/upload", uploadLimiter, upload.array("files"), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Keine Dateien hochgeladen." });

  const jobs = req.files.map((file) => {
    const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
    const targetThumb = path.join(DOWNLOADS_DIR, `thumb_${jobId}.jpg`);
    renderPdfToJpeg(file.path, targetThumb).catch(() => {});

    return {
      id: jobId,
      originalName: file.originalname,
      status: "pending",
      source: req.body.source || "upload",
      gmailMessageId: req.body.gmailMessageId || null,
      isPrivate: req.body.isPrivate === "true" || req.body.isPrivate === true,
      inAiPipeline: true,
      aiPipelineStartedAt: new Date().toISOString(),
      result: null,
      error: null,
      filePath: file.path,
      uploadDate: new Date().toISOString(),
    };
  });

  addJobs(jobs);
  res.json({ success: true, jobs });
});

router.post("/share-target", upload.array("share_files", 50), (req, res) => {
  try {
    if (req.files && req.files.length > 0) {
      const jobs = req.files.map((file) => {
        return {
          id: Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9),
          originalName: file.originalname,
          status: "pending",
          source: "share_target",
          inAiPipeline: true,
          aiPipelineStartedAt: new Date().toISOString(),
          result: null,
          error: null,
          filePath: file.path,
          uploadDate: new Date().toISOString(),
        };
      });
      addJobs(jobs);
      return res.redirect(`/?shared=true&count=${jobs.length}`);
    }
  } catch (err) {
    console.error("[PWA SHARE] Fehler:", err);
  }
  res.redirect("/");
});

router.get("/share-target", (req, res) => {
  res.redirect("/");
});

router.get("/api/jobs/:id/file", (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(404).send("Datei nicht gefunden");
    }
    if (job.isPrivate && !checkIsAdmin(req)) {
      return res.status(403).send("Forbidden");
    }
    if (!isSafeSubpath(DOWNLOADS_DIR, job.filePath)) {
      return res.status(403).send("Invalid file path");
    }
    const filename = job.result?.full || job.originalName || "Dokument.pdf";
    const safeName = filename.replace(/[^a-zA-Z0-9äöüÄÖÜß._-]/g, "_");
    res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
    res.sendFile(job.filePath);
  } catch (err) {
    res.status(500).send("Fehler beim Laden der Datei: " + err.message);
  }
});

router.get("/api/jobs/:id/preview", async (req, res) => {
  try {
    const id = req.params.id;
    const thumbPath = await getOrGenerateThumbnailPath(id, getJob);
    if (thumbPath && fs.existsSync(thumbPath)) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      return res.sendFile(thumbPath);
    }
    res.status(404).send("Vorschau nicht gefunden");
  } catch (err) {
    res.status(500).send("Fehler bei der Vorschau: " + err.message);
  }
});

router.get(["/api/thumbnail/:id", "/api/jobs/:id/thumbnail"], async (req, res) => {
  try {
    const id = req.params.id;
    const thumbPath = await getOrGenerateThumbnailPath(id, getJob);
    if (thumbPath && fs.existsSync(thumbPath)) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(thumbPath);
    }
    res.status(404).send("Thumbnail nicht gefunden");
  } catch (err) {
    res.status(500).send("Fehler beim Thumbnail: " + err.message);
  }
});

router.post("/api/jobs/:id/notes", (req, res) => {
  const { notes } = req.body;
  const job = updateJob(req.params.id, { notes: (notes || "").trim() });
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  res.json({ success: true, notes: job.notes });
});

router.post("/api/jobs/:id/hide", (req, res) => {
  const isHidden = req.body.isHidden === true || req.body.isHidden === "true";
  const job = isHidden ? hideJob(req.params.id) : unhideJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  res.json({ success: true, isHidden });
});

router.post("/api/jobs/:id/private", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  const isPrivate = req.body.isPrivate !== undefined ? (req.body.isPrivate === true || req.body.isPrivate === "true") : !job.isPrivate;
  job.isPrivate = isPrivate;
  saveJobs();
  res.json({ success: true, isPrivate: job.isPrivate });
});

router.post("/api/jobs/:id/category", (req, res) => {
  const { category } = req.body;
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  if (!job.result) job.result = {};
  job.result.category = category;
  saveJobs();
  res.json({ success: true, category: job.result.category });
});

router.post("/api/jobs/:id/company", (req, res) => {
  const { company } = req.body;
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  if (!job.result) job.result = {};
  job.result.company = company;
  const compLower = (company || "").toLowerCase();
  if (compLower.includes("wirewire")) job.targetCompany = "wirewire";
  else if (compLower.includes("the wire") || compLower.includes("thewire")) job.targetCompany = "thewire";
  else if (compLower.includes("polyxo")) job.targetCompany = "polyxo";
  else if (compLower.includes("daniel")) job.targetCompany = "daniel";
  saveJobs();
  res.json({ success: true, company: job.result.company });
});

router.post("/api/jobs/:id/update-meta", (req, res) => {
  const { category, company } = req.body;
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  if (!job.result) job.result = {};
  if (category) job.result.category = category;
  if (company) job.result.company = company;
  saveJobs();
  res.json({ success: true, result: job.result });
});

router.post("/api/jobs/:id/retry", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  job.status = "pending";
  job.inAiPipeline = true;
  job.error = null;
  job.aiPipelineStartedAt = new Date().toISOString();
  saveJobs();
  processQueue();
  res.json({ success: true, message: "KI-Erkennung wird erneut durchgeführt." });
});

router.post("/api/jobs/:id/cancel", (req, res) => {
  const job = hideJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Auftrag nicht gefunden." });
  res.json({ success: true, message: "Auftrag ausgeblendet." });
});

router.delete("/api/jobs/:id", requireAdmin, (req, res) => {
  const job = hideJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  res.json({ success: true, message: "Dokument ausgeblendet." });
});

router.delete("/api/jobs", requireAdmin, (req, res) => {
  clearAllJobs();
  res.json({ success: true, message: "Alle Dokumente ausgeblendet." });
});

router.post("/api/jobs/:id/dismiss-duplicate", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });
  job.suspectedDuplicate = false;
  job.duplicateDismissed = true;
  saveJobs();
  res.json({ success: true });
});

router.get("/api/jobs/:id/duplicates", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });

  const duplicates = [];
  const curInv = job.result?.invoiceNumber && job.result?.invoiceNumber !== "none" ? normalizeAlphaNum(job.result.invoiceNumber) : null;
  const curAmount = job.result?.invoiceAmmount || null;
  const curDate = job.result?.documentDate || null;

  const all = getJobs("all", checkIsAdmin(req));
  for (const j of all) {
    if (j.id === job.id) continue;
    const jInv = j.result?.invoiceNumber && j.result?.invoiceNumber !== "none" ? normalizeAlphaNum(j.result.invoiceNumber) : null;
    const jAmount = j.result?.invoiceAmmount || null;
    const jDate = j.result?.documentDate || null;

    const reasons = [];
    let score = 0;
    if (curInv && jInv && curInv === jInv) {
      reasons.push(`Gleiche Rechnungsnummer (${j.result.invoiceNumber})`);
      score += 10;
    }
    if (curAmount && jAmount && curAmount === jAmount) {
      reasons.push(`Gleicher Betrag`);
      score += 5;
    }
    if (curDate && jDate && curDate === jDate) {
      reasons.push(`Gleiches Datum`);
      score += 3;
    }
    if (reasons.length > 0) {
      duplicates.push({ job: j, matchReasons: reasons, score });
    }
  }

  duplicates.sort((a, b) => b.score - a.score);
  res.json({ success: true, currentJob: job, duplicates });
});

module.exports = router;
