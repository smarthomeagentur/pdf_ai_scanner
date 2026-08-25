const express = require("express");
const fs = require("fs");
const { appSettings, saveSettings } = require("../config/settings");
const { TOKEN_FILE, CREDENTIALS_FILE } = require("../config/paths");
const { requireAdmin } = require("../middleware/auth");
const { driveApi } = require("../services/driveService");

const router = express.Router();

router.get("/api/settings", requireAdmin, (req, res) => {
  const safeSettings = { ...appSettings };
  delete safeSettings.LEXOFFICE_KEY_WIREWIRE;
  delete safeSettings.LEXOFFICE_KEY_THEWIRE;
  delete safeSettings.LEXOFFICE_KEY_POLYXO;
  delete safeSettings.BUTTLER_KEY_THEWIRE_CLIENT;
  delete safeSettings.BUTTLER_KEY_THEWIRE_SECRET;
  delete safeSettings.BUTTLER_KEY_THEWIRE_KEY;
  delete safeSettings.CLICKUP_API_KEY;
  delete safeSettings.CLICKUP_LIST_ID;
  res.json(safeSettings);
});

router.post("/api/settings", requireAdmin, (req, res) => {
  const received = { ...req.body };
  delete received.LEXOFFICE_KEY_WIREWIRE;
  delete received.LEXOFFICE_KEY_THEWIRE;
  delete received.LEXOFFICE_KEY_POLYXO;
  delete received.BUTTLER_KEY_THEWIRE_CLIENT;
  delete received.BUTTLER_KEY_THEWIRE_SECRET;
  delete received.BUTTLER_KEY_THEWIRE_KEY;
  delete received.CLICKUP_API_KEY;
  delete received.CLICKUP_LIST_ID;

  Object.assign(appSettings, received);
  saveSettings();
  res.json({ success: true, settings: appSettings });
});

router.get("/api/auth/client-id", async (req, res) => {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) {
      return res.status(404).json({ success: false, error: "gdrive_secret.json nicht gefunden" });
    }
    const keys = JSON.parse(await fs.promises.readFile(CREDENTIALS_FILE, "utf8"));
    const key = keys.installed || keys.web;
    if (!key || !key.client_id) {
      return res.status(500).json({ success: false, error: "Keine client_id in gdrive_secret.json" });
    }
    res.json({ success: true, clientId: key.client_id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/api/auth/code", requireAdmin, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Code fehlt" });
    await driveApi.exchangeCodeForTokens(code);
    res.json({ success: true });
  } catch (err) {
    console.error("[AUTH] Fehler bei Token-Austausch:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/auth/disconnect", requireAdmin, async (req, res) => {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      await fs.promises.unlink(TOKEN_FILE);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/auth/token-status", (req, res) => {
  const isConnected = fs.existsSync(TOKEN_FILE);
  res.json({ isConnected });
});

module.exports = router;
