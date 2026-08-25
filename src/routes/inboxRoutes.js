const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const {
  getAllSkipped,
  addSkipped,
  removeSkipped,
} = require("../services/inboxService");

const router = express.Router();

router.get("/api/inbox/skipped", requireAdmin, (req, res) => {
  res.json({ success: true, skipped: getAllSkipped() });
});

router.post("/api/inbox/skipped", requireAdmin, (req, res) => {
  try {
    const { id, mail } = req.body;
    const skipped = addSkipped(id, mail);
    res.json({ success: true, skipped });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/api/inbox/skipped/:id", requireAdmin, (req, res) => {
  try {
    const skipped = removeSkipped(req.params.id);
    res.json({ success: true, skipped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
