/**
 * Settings Modal & Zero-Trust Secrets Management with Debug Logging
 */
import { showToast, debugLog, extractCleanFolderId, isDebugEnabled, setDebugEnabled } from "./utils.js";
import { apiRequest } from "./api.js";
import { STORAGE_KEYS, getClientSecret, setClientSecret, state } from "./state.js";
import { openGooglePicker } from "./drivePicker.js";

let googleClientId = null;
let authClientCode = null;

export async function openSettingsModal() {
  debugLog("SETTINGS", "Opening Settings Modal...");
  const modalEl = document.getElementById("settings-modal");
  if (!modalEl) return;

  // 1. Verify Admin Access
  try {
    const adminCheckRes = await fetch("/api/admin-check");
    const checkData = await adminCheckRes.json().catch(() => ({}));
    if (!checkData.isAdmin) {
      const pw = prompt("Bitte Admin-Passwort eingeben, um die Einstellungen zu öffnen:");
      if (!pw) return;
      const loginRes = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const loginData = await loginRes.json();
      if (!loginData.success) {
        alert("Falsches Admin-Passwort.");
        return;
      }
      state.isAdmin = true;
      const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
      const navInboxTab = document.getElementById("nav-inbox-tab");
      if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";
      if (navInboxTab) navInboxTab.style.display = "inline-flex";
    } else {
      state.isAdmin = true;
    }
  } catch (e) {
    console.error("Admin Check Error", e);
  }

  modalEl.style.display = "flex";

  // Show all admin setting sections
  const showSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "block";
  };

  showSection("folder-settings-container");
  showSection("ai-folder-settings-container");
  showSection("drive-sync-settings-container");
  showSection("lexoffice-settings-container");
  showSection("clickup-settings-container");
  showSection("ai-prompt-settings-container");
  showSection("admin-backup-container");
  showSection("gmail-settings-container");
  showSection("saveSettingsBtn");

  // Fetch current settings from backend
  try {
    const serverSettings = await apiRequest("/api/settings");
    debugLog("SETTINGS", "Server settings loaded:", serverSettings);
    populateSettingsForm(serverSettings);
  } catch (err) {
    console.warn("Could not fetch server settings:", err.message);
    populateSettingsForm({});
  }

  // Setup Drive auth status & GIS code client
  await initDriveAuthSection();
}

function populateSettingsForm(settings = {}) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  };

  // Folder IDs
  const rawId = settings.FOLDER_ID || "";
  setVal("raw-folder-id", rawId);
  setVal("raw-folder-display", rawId);

  const aiId = settings.FOLDER_ID_SORTED || "";
  setVal("ai-folder-id", aiId);
  setVal("ai-folder-display", aiId);

  setVal(
    "ai-categories-input",
    settings.AI_CATEGORIES ||
      "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige"
  );
  setVal(
    "ai-company-input",
    settings.AI_COMPANY || "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt"
  );

  const monDriveCb = document.getElementById("monitor-drive-checkbox");
  if (monDriveCb) monDriveCb.checked = settings.MONITOR_DRIVE === true;

  const autoArchCb = document.getElementById("gmail-auto-archive-checkbox");
  if (autoArchCb) autoArchCb.checked = settings.GMAIL_AUTO_ARCHIVE !== false;

  const queryInput = document.getElementById("gmail-scan-query-input");
  if (queryInput) queryInput.value = settings.GMAIL_SCAN_QUERY || "in:inbox filename:pdf";

  // Client-only localStorage keys
  setVal("lexoffice-key-wirewire", getClientSecret(STORAGE_KEYS.LEXOFFICE_WIREWIRE));
  setVal("lexoffice-key-polyxo", getClientSecret(STORAGE_KEYS.LEXOFFICE_POLYXO));
  setVal("butler-key-thewire-client", getClientSecret(STORAGE_KEYS.BUTTLER_CLIENT));
  setVal("butler-key-thewire-secret", getClientSecret(STORAGE_KEYS.BUTTLER_SECRET));
  setVal("butler-key-thewire-key", getClientSecret(STORAGE_KEYS.BUTTLER_KEY));
  setVal("clickup-api-key", getClientSecret(STORAGE_KEYS.CLICKUP_API_KEY));
  setVal("clickup-list-id", getClientSecret(STORAGE_KEYS.CLICKUP_LIST_ID));

  const autoTaskCb = document.getElementById("clickup-auto-task");
  if (autoTaskCb) autoTaskCb.checked = settings.CLICKUP_AUTO_TASK !== false;

  const filterPrivCb = document.getElementById("clickup-filter-private");
  if (filterPrivCb) filterPrivCb.checked = settings.CLICKUP_FILTER_PRIVATE !== false;

  const debugCb = document.getElementById("debug-logs-checkbox");
  if (debugCb) debugCb.checked = isDebugEnabled();
}

export async function saveAllSettings() {
  try {
    const getVal = (id) => document.getElementById(id)?.value?.trim() || "";

    const rawFolder = extractCleanFolderId(getVal("raw-folder-id") || getVal("raw-folder-display"));
    const aiFolder = extractCleanFolderId(getVal("ai-folder-id") || getVal("ai-folder-display"));
    const categories = getVal("ai-categories-input");
    const company = getVal("ai-company-input");
    const monitorDrive = document.getElementById("monitor-drive-checkbox")?.checked || false;
    const autoArchive = document.getElementById("gmail-auto-archive-checkbox")?.checked !== false;
    const scanQuery = getVal("gmail-scan-query-input") || "in:inbox filename:pdf";
    const autoTask = document.getElementById("clickup-auto-task")?.checked !== false;
    const filterPrivate = document.getElementById("clickup-filter-private")?.checked !== false;
    const debugEnabled = document.getElementById("debug-logs-checkbox")?.checked !== false;

    debugLog("SETTINGS", "Saving settings to server...", {
      rawFolder,
      aiFolder,
      company,
      categories,
      monitorDrive,
      autoArchive,
      scanQuery,
      debugEnabled,
    });

    // 1. Save server settings
    await apiRequest("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        FOLDER_ID: rawFolder,
        FOLDER_ID_SORTED: aiFolder,
        AI_COMPANY: company,
        AI_CATEGORIES: categories,
        MONITOR_DRIVE: monitorDrive,
        GMAIL_AUTO_ARCHIVE: autoArchive,
        GMAIL_SCAN_QUERY: scanQuery,
        CLICKUP_AUTO_TASK: autoTask,
        CLICKUP_FILTER_PRIVATE: filterPrivate,
      }),
    });

    // 2. Save client secrets & debug state in localStorage
    setClientSecret(STORAGE_KEYS.LEXOFFICE_WIREWIRE, getVal("lexoffice-key-wirewire"));
    setClientSecret(STORAGE_KEYS.LEXOFFICE_POLYXO, getVal("lexoffice-key-polyxo"));
    setClientSecret(STORAGE_KEYS.BUTTLER_CLIENT, getVal("butler-key-thewire-client"));
    setClientSecret(STORAGE_KEYS.BUTTLER_SECRET, getVal("butler-key-thewire-secret"));
    setClientSecret(STORAGE_KEYS.BUTTLER_KEY, getVal("butler-key-thewire-key"));
    setClientSecret(STORAGE_KEYS.CLICKUP_API_KEY, getVal("clickup-api-key"));
    setClientSecret(STORAGE_KEYS.CLICKUP_LIST_ID, getVal("clickup-list-id"));
    setDebugEnabled(debugEnabled);

    showToast("Einstellungen erfolgreich gespeichert!", "success");
    const modal = document.getElementById("settings-modal");
    if (modal) modal.style.display = "none";
  } catch (err) {
    debugLog("SETTINGS", "Failed to save settings:", err);
    showToast(`Fehler beim Speichern: ${err.message}`, "error");
  }
}

async function initDriveAuthSection() {
  const statusEl = document.getElementById("auth-status");
  const authBtn = document.getElementById("auth-btn");
  const disconnectBtn = document.getElementById("auth-disconnect-btn");
  const rawBrowseBtn = document.getElementById("raw-folder-browse");
  const aiBrowseBtn = document.getElementById("ai-folder-browse");

  try {
    const authStatus = await apiRequest("/api/auth/token-status");
    debugLog("SETTINGS", "Drive auth token status:", authStatus);
    if (authStatus.isConnected) {
      if (statusEl) statusEl.innerText = "Verbunden";
      if (authBtn) authBtn.style.display = "none";
      if (disconnectBtn) disconnectBtn.style.display = "inline-block";
      if (rawBrowseBtn) rawBrowseBtn.disabled = false;
      if (aiBrowseBtn) aiBrowseBtn.disabled = false;
    } else {
      if (statusEl) statusEl.innerText = "Nicht verbunden";
      if (authBtn) authBtn.style.display = "inline-block";
      if (disconnectBtn) disconnectBtn.style.display = "none";
      if (rawBrowseBtn) rawBrowseBtn.disabled = true;
      if (aiBrowseBtn) aiBrowseBtn.disabled = true;
    }
  } catch (e) {}

  try {
    const authData = await apiRequest("/api/auth/client-id");
    if (authData?.clientId) {
      googleClientId = authData.clientId;
      if (window.google?.accounts?.oauth2) {
        authClientCode = window.google.accounts.oauth2.initCodeClient({
          client_id: googleClientId,
          scope: "https://www.googleapis.com/auth/drive.file",
          include_granted_scopes: false,
          prompt: "consent",
          ux_mode: "popup",
          callback: async (response) => {
            if (response.code) {
              if (statusEl) statusEl.innerText = "Speichere Drive-Token...";
              try {
                await apiRequest("/api/auth/code", {
                  method: "POST",
                  body: JSON.stringify({ code: response.code }),
                });
                showToast("Google Drive erfolgreich verbunden!", "success");
                initDriveAuthSection();
              } catch (err) {
                showToast("Fehler bei Drive-Verbindung: " + err.message, "error");
              }
            }
          },
        });
      }
    }
  } catch (e) {}
}

export function initSettingsEvents() {
  document.getElementById("openSettingsBtn")?.addEventListener("click", openSettingsModal);

  document.getElementById("closeSettingsBtn")?.addEventListener("click", () => {
    const modal = document.getElementById("settings-modal");
    if (modal) modal.style.display = "none";
  });

  document.getElementById("saveSettingsBtn")?.addEventListener("click", saveAllSettings);

  document.getElementById("raw-folder-browse")?.addEventListener("click", (e) => {
    e.preventDefault();
    openGooglePicker("raw");
  });

  document.getElementById("ai-folder-browse")?.addEventListener("click", (e) => {
    e.preventDefault();
    openGooglePicker("ai");
  });

  document.getElementById("auth-btn")?.addEventListener("click", () => {
    if (authClientCode) authClientCode.requestCode();
  });

  document.getElementById("auth-disconnect-btn")?.addEventListener("click", async () => {
    if (!confirm("Möchtest du Google Drive wirklich trennen?")) return;
    try {
      await apiRequest("/api/auth/disconnect", { method: "POST" });
      showToast("Google Drive getrennt.", "info");
      initDriveAuthSection();
    } catch (e) {
      showToast("Fehler beim Trennen: " + e.message, "error");
    }
  });

  document.getElementById("download-backup-btn")?.addEventListener("click", () => {
    window.location.href = "/api/admin/backup";
  });

  document.getElementById("trigger-restore-btn")?.addEventListener("click", () => {
    document.getElementById("restore-file-input")?.click();
  });

  document.getElementById("restore-file-input")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await apiRequest("/api/admin/restore", {
        method: "POST",
        body: JSON.stringify(json),
      });
      showToast("Backup erfolgreich wiederhergestellt!", "success");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      showToast("Fehler beim Wiederherstellen: " + err.message, "error");
    }
  });

  document.getElementById("trigger-clear-jobs-btn")?.addEventListener("click", async () => {
    if (!confirm("Warteschlange und Belegliste wirklich leeren?")) return;
    try {
      await apiRequest("/api/jobs", { method: "DELETE" });
      showToast("Liste geleert.", "info");
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      showToast("Fehler beim Leeren: " + err.message, "error");
    }
  });
}
