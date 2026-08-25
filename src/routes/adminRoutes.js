const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const { createBackup, restoreBackup } = require("../services/backupService");

const router = express.Router();

router.get("/api/admin/backup", requireAdmin, (req, res) => {
  try {
    const data = createBackup();
    res.setHeader("Content-Disposition", `attachment; filename="backup_${Date.now()}.json"`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/api/admin/restore", requireAdmin, (req, res) => {
  try {
    const success = restoreBackup(req.body);
    res.json({ success });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
