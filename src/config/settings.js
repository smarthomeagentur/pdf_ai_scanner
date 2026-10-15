const fs = require("fs");
const { SETTINGS_FILE } = require("./paths");

const appSettings = {
  FOLDER_ID: process.env.DRIVE_FOLDER_ID,
  FOLDER_ID_SORTED: process.env.DRIVE_FOLDER_ID_SORTED,
  MONITOR_DRIVE: false,
  MONITOR_GMAIL: false,
  GMAIL_AUTO_ARCHIVE: true,
  GMAIL_SCAN_QUERY: "in:inbox filename:pdf",
  AI_COMPANY: "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel (Privat), Unbekannt",
  AI_CATEGORIES:
    "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige",
  CLICKUP_AUTO_TASK: true,
  CLICKUP_FILTER_PRIVATE: true,
  CLICKUP_CUSTOM_FIELD_COMPANY_ID: process.env.CLICKUP_CUSTOM_FIELD_COMPANY_ID || "",
  CLICKUP_STATUS_INVOICE: process.env.CLICKUP_STATUS_INVOICE || "rechnung",
  CLICKUP_STATUS_DEFAULT: process.env.CLICKUP_STATUS_DEFAULT || "offen",
};

// Third-party secrets live only in the browser and must never be stored on the server or in backups
const CLIENT_ONLY_KEYS = [
  "LEXOFFICE_KEY_WIREWIRE",
  "LEXOFFICE_KEY_THEWIRE",
  "LEXOFFICE_KEY_POLYXO",
  "BUTTLER_KEY_THEWIRE_CLIENT",
  "BUTTLER_KEY_THEWIRE_SECRET",
  "BUTTLER_KEY_THEWIRE_KEY",
  "CLICKUP_API_KEY",
  "CLICKUP_LIST_ID",
];

function withoutClientSecrets(settings) {
  const copy = { ...(settings || {}) };
  CLIENT_ONLY_KEYS.forEach((key) => delete copy[key]);
  return copy;
}

function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      // Strip third-party keys if present
      Object.assign(appSettings, withoutClientSecrets(loaded));
    } catch (e) {
      console.error("[SETTINGS] Fehler beim Laden von settings.json:", e);
    }
  }
}

function saveSettings() {
  // Tests must never touch the real store/settings.json (same rule as the SQLite file)
  if (process.env.NODE_ENV === "test") return;
  try {
    // Never persist client-only secrets to server disk
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(withoutClientSecrets(appSettings), null, 2), "utf8");
  } catch (e) {
    console.error("[SETTINGS] Fehler beim Speichern von settings.json:", e);
  }
}

// Initial load
loadSettings();

module.exports = {
  appSettings,
  loadSettings,
  saveSettings,
  withoutClientSecrets,
};
