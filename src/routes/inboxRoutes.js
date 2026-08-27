const express = require("express");
const { requireAppAuth } = require("../middleware/auth");
const {
  getAllSkipped,
  addSkipped,
  removeSkipped,
  exchangeCodeForGmailAccount,
  refreshGmailAccountToken,
  removeGmailAccount,
} = require("../services/inboxService");

const router = express.Router();

router.get("/api/inbox/skipped", requireAppAuth, (req, res) => {
  res.json({ success: true, skipped: getAllSkipped() });
});

router.post("/api/inbox/skipped", requireAppAuth, (req, res) => {
  try {
    const { id, mail } = req.body;
    const skipped = addSkipped(id, mail);
    res.json({ success: true, skipped });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/api/inbox/skipped/:id", requireAppAuth, (req, res) => {
  try {
    const skipped = removeSkipped(req.params.id);
    res.json({ success: true, skipped });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Server-side OAuth2 with Refresh Tokens for zero-popup renewals
router.post("/api/inbox/auth/exchange", requireAppAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Code fehlt" });
    const result = await exchangeCodeForGmailAccount(code);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[GMAIL] Fehler beim Token-Austausch:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/inbox/auth/refresh", requireAppAuth, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "E-Mail fehlt" });
    const result = await refreshGmailAccountToken(email);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/inbox/auth/account/:email", requireAppAuth, (req, res) => {
  try {
    removeGmailAccount(req.params.email);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
