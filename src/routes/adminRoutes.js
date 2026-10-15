const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const { createBackup, restoreBackup } = require("../services/backupService");
const { listBackups, restoreJobsFromBackup } = require("../services/jobQueueService");

const router = express.Router();

router.get("/api/admin/backup", requireAdmin, (req, res) => {
  try {
    const data = createBackup();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    res.setHeader("Content-Disposition", `attachment; filename="scanner-backup_${stamp}.json"`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Body: { backup, dryRun (default true), includeSettings }. Only adds missing data, never overwrites jobs.
router.post("/api/admin/restore", requireAdmin, (req, res) => {
  try {
    const { backup, dryRun, includeSettings } = req.body || {};
    const result = restoreBackup(backup, { dryRun: dryRun !== false, includeSettings: includeSettings === true });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Backup files found on the server (store/, downloads/, BACKUP_SCAN_DIRS)
router.get("/api/admin/backups", requireAdmin, async (req, res) => {
  try {
    const backups = (await listBackups())
      .filter((b) => b.type !== "wal")
      .map((b) => ({ file: b.fullPath, name: b.name, size: b.size, count: b.count, missing: b.missing, from: b.from, to: b.to }));
    res.json({ success: true, backups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Restores only missing jobs; dryRun (default) just reports what would happen
router.post("/api/admin/backups/restore", requireAdmin, async (req, res) => {
  try {
    const result = await restoreJobsFromBackup(req.body?.file, { dryRun: req.body?.dryRun !== false });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
