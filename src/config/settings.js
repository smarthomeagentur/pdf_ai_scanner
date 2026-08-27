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

function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      // Strip third-party keys if present
      delete loaded.LEXOFFICE_KEY_WIREWIRE;
      delete loaded.LEXOFFICE_KEY_THEWIRE;
      delete loaded.LEXOFFICE_KEY_POLYXO;
      delete loaded.BUTTLER_KEY_THEWIRE_CLIENT;
      delete loaded.BUTTLER_KEY_THEWIRE_SECRET;
      delete loaded.BUTTLER_KEY_THEWIRE_KEY;
      delete loaded.CLICKUP_API_KEY;
      delete loaded.CLICKUP_LIST_ID;
      Object.assign(appSettings, loaded);
    } catch (e) {
      console.error("[SETTINGS] Fehler beim Laden von settings.json:", e);
    }
  }
}

function saveSettings() {
  try {
    const toSave = { ...appSettings };
    // Never persist client-only secrets to server disk
    delete toSave.LEXOFFICE_KEY_WIREWIRE;
    delete toSave.LEXOFFICE_KEY_THEWIRE;
    delete toSave.LEXOFFICE_KEY_POLYXO;
    delete toSave.BUTTLER_KEY_THEWIRE_CLIENT;
    delete toSave.BUTTLER_KEY_THEWIRE_SECRET;
    delete toSave.BUTTLER_KEY_THEWIRE_KEY;
    delete toSave.CLICKUP_API_KEY;
    delete toSave.CLICKUP_LIST_ID;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2), "utf8");
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
};
