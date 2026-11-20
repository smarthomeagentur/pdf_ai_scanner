const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { requireAppAuth, requireAdmin } = require("../middleware/auth");
const { detectAccountFromText } = require("../services/accountingService");
const {
  getAllSkipped,
  addSkipped,
  removeSkipped,
  exchangeCodeForGmailAccount,
  refreshGmailAccountToken,
  removeGmailAccount,
} = require("../services/inboxService");

const router = express.Router();
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

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

// Fast in-memory PDF text quick-check to pre-detect the target accounting company (no AI, no disk write)
router.post("/api/inbox/quick-detect", requireAdmin, memoryUpload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
      return res.status(400).json({ success: false, error: "Keine PDF-Datei erhalten." });
    }

    let accounts = [];
    if (typeof req.body?.accounts === "string" && req.body.accounts.trim()) {
      try {
        const parsed = JSON.parse(req.body.accounts);
        if (Array.isArray(parsed)) {
          accounts = parsed
            .filter((a) => a && a.id && a.name)
            .map((a) => ({ id: String(a.id), name: String(a.name), provider: a.provider }));
        }
      } catch (e) {}
    }

    if (accounts.length === 0) {
      return res.json({ success: true, accountId: null });
    }

    let extractedText = "";
    try {
      const pdfData = await pdfParse(req.file.buffer, { max: 2 });
      extractedText = pdfData && typeof pdfData.text === "string" ? pdfData.text : "";
    } catch (parseErr) {
      return res.json({ success: true, accountId: null, textExtracted: false });
    }

    if (!extractedText.trim()) {
      return res.json({ success: true, accountId: null, textExtracted: false });
    }

    const match = detectAccountFromText(extractedText, accounts);
    if (!match) {
      return res.json({ success: true, accountId: null, textExtracted: true });
    }

    return res.json({
      success: true,
      accountId: match.accountId,
      accountName: match.accountName,
      matchedText: match.matchedText,
      reason: "PDF-Inhalt",
      textExtracted: true,
    });
  } catch (err) {
    console.error("[INBOX QUICK-DETECT] Fehler:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
