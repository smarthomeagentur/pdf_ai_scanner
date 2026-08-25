// ==========================================
// --- Security & HTML Sanitization Helpers ---
// ==========================================
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function highlightQueryText(text, query) {
  if (!text) return "";
  const escapedText = escapeHtml(text);
  if (!query || !query.trim()) return escapedText;
  const qEscaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${qEscaped})`, "gi");
  return escapedText.replace(regex, '<mark style="background-color: #fef08a; color: #854d0e; padding: 0 2px; border-radius: 2px;">$1</mark>');
}

// ==========================================
// --- Zero-Server-Storage API Key Helpers ---
// ==========================================
const ACCOUNTING_CLIENT_KEYS_KEY = "scanner_client_accounting_keys";
const CLICKUP_CLIENT_CONFIG_KEY = "scanner_client_clickup_config";

function getClientAccountingKeys() {
  try {
    const raw = localStorage.getItem(ACCOUNTING_CLIENT_KEYS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveClientAccountingKeys(keys) {
  try {
    localStorage.setItem(ACCOUNTING_CLIENT_KEYS_KEY, JSON.stringify(keys || {}));
  } catch (e) {}
}

function getClientClickUpConfig() {
  try {
    const raw = localStorage.getItem(CLICKUP_CLIENT_CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveClientClickUpConfig(cfg) {
  try {
    localStorage.setItem(CLICKUP_CLIENT_CONFIG_KEY, JSON.stringify(cfg || {}));
  } catch (e) {}
}

const settingsModal = document.getElementById("settings-modal");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
let googleClientId = null;
let authClientCode = null;

// Folder Browser state
let allFolders = [];
let currentBrowserTarget = null;
let currentParentId = "root";
let currentBreadcrumbs = [{ id: "root", name: "Meine Ablage" }];
let selectedFbId = null;
let selectedFbName = null;

openSettingsBtn.addEventListener("click", async () => {
  // Verify Admin Access First
  try {
    const adminCheckRes = await fetch("/api/admin-check");
    if (!adminCheckRes.ok) {
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
      window.isAdmin = true;
      const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
      const navInboxTab = document.getElementById("nav-inbox-tab");
      if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";
      if (navInboxTab) navInboxTab.style.display = "inline-flex";
      renderJobs();
    } else {
      window.isAdmin = true;
    }
  } catch (e) {
    console.error("Admin Check Error", e);
  }

  settingsModal.style.display = "flex";

  // Always make all admin setting sections visible immediately
  document.getElementById("lexoffice-settings-container").style.display = "block";
  document.getElementById("clickup-settings-container").style.display = "block";
  document.getElementById("ai-prompt-settings-container").style.display = "block";
  document.getElementById("admin-backup-container").style.display = "block";
  document.getElementById("saveSettingsBtn").style.display = "block";
  const gmailSettingsContainer = document.getElementById("gmail-settings-container");
  if (gmailSettingsContainer) gmailSettingsContainer.style.display = "block";

  // Fetch current settings from backend
  try {
    const setRes = await fetch("/api/settings");
    const setJson = await setRes.json();
    if (setJson.success) {
      window.currentSettings = setJson.settings;
    }
  } catch (e) {}

  populateSettingsForm();

  // Fetch client ID configuration
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (data.success && data.clientId) {
      googleClientId = data.clientId;
      document.getElementById("auth-status").innerText = "Bereit zur Authentifizierung";
      document.getElementById("auth-btn").style.display = "inline-block";

      // Initialize Google Auth client for Server-Side Google Drive ONLY (Restricted strictly to drive.file)
      authClientCode = window.google.accounts.oauth2.initCodeClient({
        client_id: googleClientId,
        scope: "https://www.googleapis.com/auth/drive.file",
        include_granted_scopes: false,
        prompt: "consent",
        ux_mode: "popup",
        callback: async (response) => {
          if (response.code) {
            document.getElementById("auth-status").innerText = "Speichere Drive-Token am Server...";
            const authRes = await fetch("/api/auth/code", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: response.code, isSecondary: false }),
            });
            if (authRes.ok) {
              document.getElementById("auth-status").innerText = "Google Drive erfolgreich verbunden!";
              document.getElementById("auth-btn").style.display = "none";
              loadFolders();
            } else {
              document.getElementById("auth-status").innerText = "Fehler bei der Drive-Verbindung.";
            }
          }
        },
      });

      loadFolders(); // Try loading folders (if already authenticated)
    } else {
      document.getElementById("auth-status").innerText = "Fehler: Keine Google API Config auf dem Server gefunden.";
    }
  } catch (err) {
    document.getElementById("auth-status").innerText = "Fehler beim Laden der Konfiguration.";
  }
});

function populateSettingsForm() {
  if (window.currentSettings) {
    if (window.currentSettings.FOLDER_ID) {
      const rawIdEl = document.getElementById("raw-folder-id");
      const rawDispEl = document.getElementById("raw-folder-display");
      if (rawIdEl) rawIdEl.value = window.currentSettings.FOLDER_ID;
      if (rawDispEl) rawDispEl.value = window.currentSettings.FOLDER_ID;
    }
    if (window.currentSettings.FOLDER_ID_SORTED) {
      const aiIdEl = document.getElementById("ai-folder-id");
      const aiDispEl = document.getElementById("ai-folder-display");
      if (aiIdEl) aiIdEl.value = window.currentSettings.FOLDER_ID_SORTED;
      if (aiDispEl) aiDispEl.value = window.currentSettings.FOLDER_ID_SORTED;
    }

    document.getElementById("ai-categories-input").value =
      window.currentSettings.AI_CATEGORIES ||
      "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige";
    document.getElementById("ai-company-input").value =
      window.currentSettings.AI_COMPANY || "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt";
    document.getElementById("monitor-drive-checkbox").checked = window.currentSettings.MONITOR_DRIVE || false;

    const autoArchCb = document.getElementById("gmail-auto-archive-checkbox");
    if (autoArchCb) autoArchCb.checked = window.currentSettings.GMAIL_AUTO_ARCHIVE !== false;
    const monGmailCb = document.getElementById("monitor-gmail-checkbox");
    if (monGmailCb) monGmailCb.checked = window.currentSettings.MONITOR_GMAIL === true;
    const queryInput = document.getElementById("gmail-scan-query-input");
    if (queryInput) queryInput.value = window.currentSettings.GMAIL_SCAN_QUERY || "in:inbox filename:pdf";
  }

  // Always populate client-side stored keys
  const clientAccKeys = getClientAccountingKeys();
  document.getElementById("lexoffice-key-wirewire").value = clientAccKeys.lexKeyWirewire || "";
  document.getElementById("butler-key-thewire-client").value = clientAccKeys.butlerClient || "";
  document.getElementById("butler-key-thewire-secret").value = clientAccKeys.butlerSecret || "";
  document.getElementById("butler-key-thewire-key").value = clientAccKeys.butlerKey || "";
  document.getElementById("lexoffice-key-polyxo").value = clientAccKeys.lexKeyPolyxo || "";
  
  const clientClickupCfg = getClientClickUpConfig();
  document.getElementById("clickup-api-key").value = clientClickupCfg.apiKey || "";
  document.getElementById("clickup-list-id").value = clientClickupCfg.listId || "";
  document.getElementById("clickup-auto-task").checked = clientClickupCfg.autoTask !== undefined ? clientClickupCfg.autoTask : (window.currentSettings?.CLICKUP_AUTO_TASK !== false);
  document.getElementById("clickup-filter-private").checked = clientClickupCfg.filterPrivate !== undefined ? clientClickupCfg.filterPrivate : (window.currentSettings?.CLICKUP_FILTER_PRIVATE !== false);
}

closeSettingsBtn.addEventListener("click", () => {
  settingsModal.style.display = "none";
});

document.getElementById("auth-btn").addEventListener("click", () => {
  if (authClientCode) authClientCode.requestCode();
});

const authDisconnectBtn = document.getElementById("auth-disconnect-btn");
if (authDisconnectBtn) {
  authDisconnectBtn.addEventListener("click", async () => {
    if (!confirm("Möchtest du Google Drive wirklich trennen und das Token restlos vom Server löschen?")) return;
    try {
      const res = await fetch("/api/auth/disconnect", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        document.getElementById("auth-status").innerText = "Nicht verbunden (Token gelöscht)";
        document.getElementById("auth-btn").innerText = "Mit Google Anmelden";
        document.getElementById("auth-btn").style.display = "inline-block";
        authDisconnectBtn.style.display = "none";
        document.getElementById("raw-folder-browse").disabled = true;
        document.getElementById("ai-folder-browse").disabled = true;
        alert(data.message || "Google Drive erfolgreich getrennt.");
      }
    } catch (e) {
      alert("Fehler beim Trennen von Google Drive.");
    }
  });
}

async function loadFolders() {
  document.getElementById("folder-settings-container").style.display = "block";
  document.getElementById("ai-folder-settings-container").style.display = "block";

  try {
    const res = await fetch("/api/drive/folders?parentId=root");
    const data = await res.json();
    if (data.success) {
      document.getElementById("auth-status").innerText = "Google Drive verbunden (drive.file)";
      document.getElementById("auth-btn").innerText = "Neu Verbinden";
      document.getElementById("auth-btn").style.display = "inline-block";
      if (authDisconnectBtn) authDisconnectBtn.style.display = "inline-block";

      const rawBrowseBtn = document.getElementById("raw-folder-browse");
      const aiBrowseBtn = document.getElementById("ai-folder-browse");
      const rawDisplay = document.getElementById("raw-folder-display");
      const aiDisplay = document.getElementById("ai-folder-display");

      rawBrowseBtn.disabled = false;
      aiBrowseBtn.disabled = false;
      rawDisplay.placeholder = "Klicke auf Durchsuchen...";
      aiDisplay.placeholder = "Klicke auf Durchsuchen...";

      async function fetchFolderName(id, displayEl, idEl) {
        try {
          const nRes = await fetch("/api/drive/folder/" + id);
          if (nRes.ok) {
            const nData = await nRes.json();
            if (nData.success) {
              displayEl.value = nData.folder.name;
              idEl.value = nData.folder.id;
              return;
            }
          }
        } catch (e) {}
        displayEl.value = "Ordner via ID: " + id;
        idEl.value = id;
      }

      if (window.currentSettings?.FOLDER_ID) {
        fetchFolderName(window.currentSettings.FOLDER_ID, rawDisplay, document.getElementById("raw-folder-id"));
      }
      if (window.currentSettings?.FOLDER_ID_SORTED) {
        fetchFolderName(window.currentSettings.FOLDER_ID_SORTED, aiDisplay, document.getElementById("ai-folder-id"));
      }

      const driveSyncContainer = document.getElementById("drive-sync-settings-container");
      if (driveSyncContainer) driveSyncContainer.style.display = "block";
      const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
      if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";
    } else {
      document.getElementById("auth-status").innerText = "Nicht authentifiziert (Google Drive).";
      if (authDisconnectBtn) authDisconnectBtn.style.display = "none";
    }
  } catch (e) {
    document.getElementById("auth-status").innerText = "Fehler beim Laden der Ordner.";
    if (authDisconnectBtn) authDisconnectBtn.style.display = "none";
  }
}

// --- Google Drive Folder Selection (Google Drive Picker API) ---
document.getElementById("raw-folder-browse").addEventListener("click", () => openGooglePicker("raw"));
document.getElementById("ai-folder-browse").addEventListener("click", () => openGooglePicker("ai"));

async function openGooglePicker(target) {
  try {
    const tokenRes = await fetch("/api/drive/picker-token");
    const tokenData = await tokenRes.json();
    if (!tokenData.success || !tokenData.token) {
      alert(tokenData.error || "Fehler beim Laden des Picker-Tokens. Bitte Google Drive Verbindung prüfen.");
      return;
    }

    function createAndShowPicker() {
      try {
        const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes("application/vnd.google-apps.folder");

        let builder = new google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(tokenData.token);

        if (tokenData.clientId || googleClientId) {
          builder = builder.setAppId(tokenData.clientId || googleClientId);
        }

        const picker = builder
          .setCallback((data) => {
            if (data[google.picker.Response.ACTION] === google.picker.Action.PICKED) {
              const doc = data[google.picker.Response.DOCUMENTS][0];
              const folderId = doc[google.picker.Document.ID];
              const folderName = doc[google.picker.Document.NAME];
              if (target === "raw") {
                document.getElementById("raw-folder-display").value = `${folderName} (${folderId})`;
                document.getElementById("raw-folder-id").value = folderId;
              } else if (target === "ai") {
                document.getElementById("ai-folder-display").value = `${folderName} (${folderId})`;
                document.getElementById("ai-folder-id").value = folderId;
              }
            }
          })
          .build();
        picker.setVisible(true);
      } catch (pickerErr) {
        console.error("PickerBuilder error:", pickerErr);
        alert("Google Picker Dialog konnte nicht initialisiert werden: " + pickerErr.message);
      }
    }

    if (window.google && window.google.picker) {
      createAndShowPicker();
    } else if (window.gapi && window.gapi.load) {
      window.gapi.load("picker", { callback: createAndShowPicker });
    } else {
      alert("Google API-Bibliothek wird geladen. Bitte in wenigen Sekunden erneut versuchen.");
    }
  } catch (err) {
    console.error("Google Picker Error", err);
    alert("Fehler beim Öffnen des Google Drive Pickers: " + err.message);
  }
}
// --- Folder Selection Logic end ---

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const rawFolderId = document.getElementById("raw-folder-id").value;
  const aiFolderId = document.getElementById("ai-folder-id").value;
  const aiCategories = document.getElementById("ai-categories-input").value.trim();
  const aiCompany = document.getElementById("ai-company-input").value.trim();
  const monitorDriveState = document.getElementById("monitor-drive-checkbox").checked;

  // Validierung für kommagetrennte Listen (keine leeren Einträge wie "A,,B" oder "A,")
  const isValidCommaList = (str) => !str || str.split(",").every((s) => s.trim().length > 0);

  if (!isValidCommaList(aiCategories)) {
    alert("Bitte prüfen Sie die Kategorien: Liste muss kommagetrennt sein und darf keine leeren Elemente aufweisen!");
    return;
  }

  if (!isValidCommaList(aiCompany)) {
    alert("Bitte prüfen Sie die Firmen: Liste muss kommagetrennt sein und darf keine leeren Elemente aufweisen!");
    return;
  }

  const lexKeyWirewire = document.getElementById("lexoffice-key-wirewire").value.trim();
  const butlerKeyClient = document.getElementById("butler-key-thewire-client").value.trim();
  const butlerKeySecret = document.getElementById("butler-key-thewire-secret").value.trim();
  const butlerKeyKey = document.getElementById("butler-key-thewire-key").value.trim();
  const lexKeyPolyxo = document.getElementById("lexoffice-key-polyxo").value.trim();

  saveClientAccountingKeys({
    lexKeyWirewire,
    butlerClient: butlerKeyClient,
    butlerSecret: butlerKeySecret,
    butlerKey: butlerKeyKey,
    lexKeyPolyxo,
  });

  const clickupApiKey = document.getElementById("clickup-api-key").value.trim();
  const clickupListId = document.getElementById("clickup-list-id").value.trim();
  const clickupAutoTask = document.getElementById("clickup-auto-task").checked;
  const clickupFilterPrivate = document.getElementById("clickup-filter-private").checked;

  saveClientClickUpConfig({
    apiKey: clickupApiKey,
    listId: clickupListId,
    autoTask: clickupAutoTask,
    filterPrivate: clickupFilterPrivate,
  });

  const gmailAutoArchive = document.getElementById("gmail-auto-archive-checkbox")?.checked;
  const monitorGmailState = document.getElementById("monitor-gmail-checkbox")?.checked;
  const gmailScanQuery = document.getElementById("gmail-scan-query-input")?.value?.trim() || "in:inbox filename:pdf";

  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      FOLDER_ID: rawFolderId,
      FOLDER_ID_SORTED: aiFolderId,
      AI_CATEGORIES: aiCategories,
      AI_COMPANY: aiCompany,
      MONITOR_DRIVE: monitorDriveState,
      MONITOR_GMAIL: monitorGmailState || false,
      GMAIL_AUTO_ARCHIVE: gmailAutoArchive !== undefined ? gmailAutoArchive : true,
      GMAIL_SCAN_QUERY: gmailScanQuery,
      CLICKUP_AUTO_TASK: clickupAutoTask,
      CLICKUP_FILTER_PRIVATE: clickupFilterPrivate,
    }),
  });

  if (res.ok) {
    alert("Einstellungen erfolgreich gespeichert! (API-Keys sicher lokal im Browser hinterlegt)");
    settingsModal.style.display = "none";
  } else {
    alert("Fehler beim Speichern der Einstellungen.");
  }
});

const dropArea = document.getElementById("drop-area");
const fileInput = document.getElementById("file-input");
const browseBtn = document.getElementById("browse-btn");
const statusDiv = document.getElementById("status");
const jobListContainer = document.getElementById("job-list-container");
const jobList = document.getElementById("job-list");

const triggerClearJobsBtn = document.getElementById("trigger-clear-jobs-btn");
const triggerRescanDuplicatesBtn = document.getElementById("trigger-rescan-duplicates-btn");
const confirmClearModal = document.getElementById("confirm-clear-modal");
const confirmClearBtn = document.getElementById("confirm-clear-btn");
const cancelClearBtn = document.getElementById("cancel-clear-btn");

if (triggerRescanDuplicatesBtn) {
  triggerRescanDuplicatesBtn.addEventListener("click", async () => {
    triggerRescanDuplicatesBtn.disabled = true;
    triggerRescanDuplicatesBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">hourglass_empty</span> Scanne...';
    try {
      const res = await fetch("/api/jobs/rescan-duplicates", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (typeof showToast === "function") {
          showToast(`✅ Duplikat-Scan abgeschlossen: ${data.markedCount} neue Duplikate in ${data.scanned} Belegen gefunden.`, "success");
        } else {
          alert(`Duplikat-Scan abgeschlossen: ${data.markedCount} neue Duplikate in ${data.scanned} Belegen gefunden.`);
        }
        renderJobs();
      } else {
        alert("Fehler beim Duplikat-Scan: " + (data.error || "Unbekannter Fehler"));
      }
    } catch (err) {
      alert("Netzwerkfehler beim Duplikat-Scan: " + err.message);
    } finally {
      triggerRescanDuplicatesBtn.disabled = false;
      triggerRescanDuplicatesBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 18px;">content_copy</span> Duplikate neu scannen';
    }
  });
}

const downloadBackupBtn = document.getElementById("download-backup-btn");
const triggerRestoreBtn = document.getElementById("trigger-restore-btn");
const restoreFileInput = document.getElementById("restore-file-input");

if (downloadBackupBtn) {
  downloadBackupBtn.addEventListener("click", () => {
    window.location.href = "/api/admin/backup";
  });
}

if (triggerRestoreBtn && restoreFileInput) {
  triggerRestoreBtn.addEventListener("click", () => {
    restoreFileInput.click();
  });

  restoreFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm(`Möchtest du das Backup "${file.name}" wirklich einspielen? Bestehende Einstellungen und Dokumenten-Indizes werden überschrieben.`)) {
      restoreFileInput.value = "";
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        alert(data.message || "Backup erfolgreich wiederhergestellt!");
        location.reload();
      } else {
        alert("Fehler bei der Wiederherstellung: " + (data.error || "Unbekannter Fehler"));
      }
    } catch (err) {
      alert("Ungültiges Backup-Dateiformat: " + err.message);
    } finally {
      restoreFileInput.value = "";
    }
  });
}

let activeJobs = [];
let pollingInterval = null;

// We don't rely on localStorage anymore, we'll fetch state from server.
// Start polling immediately to get current global active jobs
startPolling();

// Drag & Drop Events
["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
  dropArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

["dragenter", "dragover"].forEach((eventName) => {
  dropArea.addEventListener(eventName, () => dropArea.classList.add("hover"), false);
});

["dragleave", "drop"].forEach((eventName) => {
  dropArea.addEventListener(eventName, () => dropArea.classList.remove("hover"), false);
});

dropArea.addEventListener("drop", handleDrop, false);

function handleDrop(e) {
  let dt = e.dataTransfer;
  let files = dt.files;
  if (files.length > 0) uploadFiles(files);
}

browseBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", function () {
  if (this.files.length > 0) uploadFiles(this.files);
});

triggerClearJobsBtn.addEventListener("click", () => {
  confirmClearModal.style.display = "flex";
  document.getElementById("settings-modal").style.display = "none";
});

cancelClearBtn.addEventListener("click", () => {
  confirmClearModal.style.display = "none";
  document.getElementById("settings-modal").style.display = "flex";
});

confirmClearBtn.addEventListener("click", async () => {
  confirmClearModal.style.display = "none";

  activeJobs = [];
  statusDiv.innerHTML = "";
  try {
    await fetch("/api/jobs", { method: "DELETE" });
  } catch (e) {}
  renderJobs();
});

function showDuplicateDialog(filename, simJob) {
  return new Promise((resolve) => {
    const modal = document.getElementById("duplicate-check-modal");
    const text = document.getElementById("duplicate-check-text");
    
    let detailsHtml = "";
    if (simJob) {
      const displayDate = simJob.uploadDate ? new Date(simJob.uploadDate).toLocaleString("de-DE") : "-";
      let statusText = simJob.status === "completed" ? "Abgeschlossen" : (simJob.status === "processing" ? "In Verarbeitung" : "Warteschlange");
      let companyHtml = "";
      let categoryHtml = "";
      let tagsHtml = "";
      let previewHtml = "";
      if (simJob.result) {
        if (simJob.result.company) companyHtml = `<br>Unternehmen: ${escapeHtml(simJob.result.company)}`;
        if (simJob.result.category) categoryHtml = `<br>Kategorie: ${escapeHtml(simJob.result.category)}`;
        if (simJob.result.tags && Array.isArray(simJob.result.tags)) tagsHtml = `<br>Tags: ${escapeHtml(simJob.result.tags.slice(0, 3).join(", "))}`;
        
        const imgSrc = `/api/jobs/${encodeURIComponent(simJob.id)}/thumbnail`;
        previewHtml = `
          <div style="margin-top: 10px; text-align: center;">
            <img src="${imgSrc}" loading="lazy" style="height: 250px; aspect-ratio: 1 / 1.414; object-fit: cover; border-radius: 4px; border: 1px solid #ccc; background: #fff;" title="Vorschau" alt="Vorschau" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
          </div>
        `;
      }
      
      detailsHtml = `
        <div style="text-align: left; background: #f8f9fa; padding: 10px; border-radius: 5px; margin-top: 15px; font-size: 13px; border: 1px solid #ddd; line-height: 1.5; overflow: hidden;">
          <strong style="color: #333;">Ähnliches Dokument gefunden:</strong><br>
          Original Name: ${escapeHtml(simJob.originalName || "-")}<br>
          Datum: ${escapeHtml(displayDate)}<br>
          Status: ${escapeHtml(statusText)}${companyHtml}${categoryHtml}${tagsHtml}
          ${previewHtml}
        </div>
      `;
    }
    
    text.innerHTML = `Die Datei "<strong>${escapeHtml(filename)}</strong>" existiert bereits oder eine ähnliche Datei wurde bereits hochgeladen. Möchtest du die Verarbeitung fortsetzen oder abbrechen?${detailsHtml}`;
    modal.style.display = "flex";
    
    const skipBtn = document.getElementById("btn-skip-duplicate");
    const uploadBtn = document.getElementById("btn-upload-duplicate");
    
    const cleanup = () => {
      skipBtn.removeEventListener("click", onSkip);
      uploadBtn.removeEventListener("click", onUpload);
      modal.style.display = "none";
    };
    
    const onSkip = () => { cleanup(); resolve(false); };
    const onUpload = () => { cleanup(); resolve(true); };
    
    skipBtn.addEventListener("click", onSkip);
    uploadBtn.addEventListener("click", onUpload);
  });
}

async function uploadFiles(files) {
  let filesToUpload = Array.from(files);

  for (let i = 0; i < filesToUpload.length; i++) {
    const file = filesToUpload[i];
    const fileBase = file.name.replace(/\.[^/.]+$/, "").toLowerCase().trim();
    let foundSimJob = null;
    activeJobs.some(j => {
      const jBase = j.originalName.replace(/\.[^/.]+$/, "").toLowerCase().trim();
      if (jBase === fileBase) { foundSimJob = j; return true; }
      const jClean = jBase.replace(/[0-9\-_()\s]/g, "");
      const fClean = fileBase.replace(/[0-9\-_()\s]/g, "");
      if (jClean.length > 5 && fClean.length > 5 && (jClean === fClean || jClean.includes(fClean) || fClean.includes(jClean))) { foundSimJob = j; return true; }
      return false;
    });

    if (foundSimJob) {
      const shouldUpload = await showDuplicateDialog(file.name, foundSimJob);
      if (!shouldUpload) {
        filesToUpload[i] = null;
      }
    }
  }

  filesToUpload = filesToUpload.filter(f => f !== null);
  if (filesToUpload.length === 0) {
    fileInput.value = "";
    return;
  }

  let formData = new FormData();
  for (let i = 0; i < filesToUpload.length; i++) {
    formData.append("files", filesToUpload[i]);
  }

  statusDiv.innerHTML = "Lade Dateien hoch... Bitte warten.";
  statusDiv.className = "loading";

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (data.success) {
      statusDiv.innerHTML = "Dateien hochgeladen & in der Warteschlange!";
      statusDiv.className = "success";

      // Add new jobs to active jobs
      const newJobs = data.jobs.map((job) => ({
        id: job.id,
        originalName: job.originalName,
        status: job.status,
        result: job.result,
        error: job.error,
        uploadDate: job.uploadDate,
      }));

      jobListContainer.style.display = "block";
      startPolling();

      setTimeout(() => {
        if (statusDiv.className === "success") {
          statusDiv.innerHTML = "";
        }
      }, 3000);
    } else {
      statusDiv.innerHTML = "Fehler: " + (data.error || "Unbekannter Fehler");
      statusDiv.className = "error";
    }
  } catch (error) {
    statusDiv.innerHTML = "Verbindungsfehler beim Hochladen aufgetreten.";
    statusDiv.className = "error";
  }

  // Reset file input
  fileInput.value = "";
}

async function fetchStatus() {
  try {
    const res = await fetch(`/api/status?ids=all`);
    const data = await res.json();

    if (data.success) {
      activeJobs = data.statuses || [];
      renderJobs();

      // Stop polling dynamically if no jobs are pending/processing on server
      const hasPendingServerJobs = activeJobs.some((j) => j.status === "pending" || j.status === "processing");
      if (!hasPendingServerJobs && pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
    }
  } catch (err) {
    console.error("Polling error", err);
  }
}

function updateStatus() {
  return fetchStatus();
}

function startPolling() {
  fetchStatus();
  if (!pollingInterval) {
    pollingInterval = setInterval(fetchStatus, 5000); // 5 Sekunden Polling
  }
}

// Initialisiere Polling / Laden aller Jobs beim Seitenstart
startPolling();

// Startseite Filter & Paginierung State
let startSearchQuery = "";
let startSortOrder = "docdate_desc";
let startDateFilter = "alle";
let startCompanyFilter = "alle";
let startSelectedCategories = new Set();
let startCurrentPage = 1;
const START_PAGE_SIZE = 50;

function parseDocumentDate(dateStr) {
  if (!dateStr || dateStr === "unknown" || dateStr === "none" || dateStr === "-") return null;
  const str = String(dateStr).trim();
  // Match DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  const deMatch = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (deMatch) {
    return new Date(parseInt(deMatch[3], 10), parseInt(deMatch[2], 10) - 1, parseInt(deMatch[1], 10));
  }
  // Match YYYY-MM-DD or YYYY.MM.DD
  const isoMatch = str.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
  }
  // Match YYMMDD (6 digits from filename prefix, e.g. 260215 -> 2026-02-15)
  const prefixMatch = str.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (prefixMatch) {
    return new Date(2000 + parseInt(prefixMatch[1], 10), parseInt(prefixMatch[2], 10) - 1, parseInt(prefixMatch[3], 10));
  }
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function getValidatedJobDocumentDate(job) {
  if (!job) return { dateObj: null, display: "-", rawDocDate: "-", isInvalidFuture: false };

  const uploadDateObj = job.uploadDate ? new Date(job.uploadDate) : new Date();
  const maxAllowedTime = new Date(
    uploadDateObj.getFullYear(),
    uploadDateObj.getMonth(),
    uploadDateObj.getDate(),
    23, 59, 59, 999
  ).getTime();

  const res = job.result || {};
  let rawDocDate = res.documentDate || job.documentDate;
  let parsed = null;

  if (rawDocDate && rawDocDate !== "unknown" && rawDocDate !== "none" && rawDocDate !== "-") {
    if (typeof rawDocDate === "string" && rawDocDate.includes("(Dokumentendatum ungültig)")) {
      return {
        dateObj: uploadDateObj,
        display: rawDocDate,
        rawDocDate: rawDocDate,
        isInvalidFuture: true
      };
    }
    parsed = parseDocumentDate(rawDocDate);
  }
  if (!parsed) {
    const full = res.full || job.originalName || "";
    const nameDateMatch = full.match(/\b(20\d{2}[.-]\d{2}[.-]\d{2}|\d{6}|\d{2}\.\d{2}\.\d{4})\b/);
    if (nameDateMatch) {
      rawDocDate = nameDateMatch[1];
      parsed = parseDocumentDate(nameDateMatch[1]);
    }
  }

  // Prüfe immer, dass das erfasste Dokumentendatum nicht neuer als das Upload-Datum ist
  if (parsed && !isNaN(parsed.getTime())) {
    if (parsed.getTime() > maxAllowedTime) {
      const uploadFormatted = uploadDateObj.toLocaleDateString("de-DE");
      return {
        dateObj: uploadDateObj,
        display: `${uploadFormatted} (Dokumentendatum ungültig)`,
        rawDocDate: rawDocDate || "-",
        isInvalidFuture: true
      };
    }
    return {
      dateObj: parsed,
      display: rawDocDate && rawDocDate !== "unknown" ? rawDocDate : parsed.toLocaleDateString("de-DE"),
      rawDocDate: rawDocDate || "-",
      isInvalidFuture: false
    };
  }

  if (job.uploadDate) {
    return {
      dateObj: uploadDateObj,
      display: uploadDateObj.toLocaleDateString("de-DE"),
      rawDocDate: "unknown",
      isInvalidFuture: false
    };
  }

  return { dateObj: null, display: "-", rawDocDate: "-", isInvalidFuture: false };
}

function getJobDocumentDate(job) {
  const validated = getValidatedJobDocumentDate(job);
  return validated.dateObj;
}

function sortJobs(jobs, sortOrder) {
  return [...jobs].sort((a, b) => {
    if (sortOrder === "docdate_desc") {
      const dateA = getJobDocumentDate(a);
      const dateB = getJobDocumentDate(b);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB.getTime() - dateA.getTime();
    }
    if (sortOrder === "docdate_asc") {
      const dateA = getJobDocumentDate(a);
      const dateB = getJobDocumentDate(b);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.getTime() - dateB.getTime();
    }
    if (sortOrder === "uploaddate_desc") {
      const dateA = a.uploadDate ? new Date(a.uploadDate).getTime() : 0;
      const dateB = b.uploadDate ? new Date(b.uploadDate).getTime() : 0;
      return dateB - dateA;
    }
    if (sortOrder === "company_asc") {
      const compA = (a.result?.company || a.targetCompany || "").toLowerCase();
      const compB = (b.result?.company || b.targetCompany || "").toLowerCase();
      return compA.localeCompare(compB);
    }
    if (sortOrder === "amount_desc") {
      const amtA = (a.invoiceAmmount !== undefined ? a.invoiceAmmount : a.result?.invoiceAmmount) || 0;
      const amtB = (b.invoiceAmmount !== undefined ? b.invoiceAmmount : b.result?.invoiceAmmount) || 0;
      return amtB - amtA;
    }
    return 0;
  });
}

function getCleanJobTags(tagsRaw, fallbackText = "") {
  let tags = [];
  if (Array.isArray(tagsRaw)) {
    tags = tagsRaw
      .map((t) => (t !== null && t !== undefined ? String(t).trim() : ""))
      .filter((t) => {
        if (!t || t.toLowerCase() === "none" || t.toLowerCase() === "unknown") return false;
        const lower = t.toLowerCase();
        if (
          lower.startsWith("isinvoice:") ||
          lower.startsWith("invoiceammount:") ||
          lower.startsWith("invoicenumber:") ||
          lower.startsWith("datum:") ||
          lower === "isinvoice" ||
          lower === "invoiceammount"
        ) {
          return false;
        }
        return true;
      });
  }

  // If no tags from AI array, try extracting meaningful tags from description/filename
  if (tags.length === 0 && fallbackText) {
    const descMatch = fallbackText.match(/-\s*([^()]+?)\s*(?:\(|$)/);
    if (descMatch) {
      const parts = descMatch[1]
        .split(/[\s,]+/)
        .filter((w) => w.length > 2 && w.toLowerCase() !== "unbekannt");
      if (parts.length > 0) {
        tags = parts.slice(0, 3);
      }
    }
  }

  return tags.slice(0, 3);
}

function formatGeneratedFileNameHtml(job, searchQuery = "") {
  const res = job.result || {};

  // If the job is still pending or processing without AI result
  if (job.status !== "completed" || !job.result) {
    return `<span class="fw-bold text-dark" style="font-size: 14px; word-break: break-word;">${highlightQueryText(job.originalName || "Dokument", searchQuery)}</span>`;
  }

  const category = (res.category && res.category !== "unknown") ? res.category : (res.isInvoice ? "Rechnungen" : "Dokumente");
  const company = (res.company && res.company !== "unknown") ? res.company : (job.targetCompany || "Unbekannt");
  const cleanTags = getCleanJobTags(res.tags, res.full || job.originalName || "");

  const categoryBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle d-inline-flex align-items-center gap-1" style="font-size: 12px; padding: 4px 9px; border-radius: 6px; font-weight: 600;" title="Kategorie"><span class="material-symbols-outlined" style="font-size: 14px;">folder</span> ${highlightQueryText(category, searchQuery)}</span>`;

  const companyBadge = `<span class="badge bg-secondary-subtle text-dark border d-inline-flex align-items-center gap-1" style="font-size: 12px; padding: 4px 9px; border-radius: 6px; font-weight: 600;" title="Unternehmen"><span class="material-symbols-outlined" style="font-size: 14px;">domain</span> ${highlightQueryText(company, searchQuery)}</span>`;

  let tagsBadges = "";
  if (cleanTags.length > 0) {
    tagsBadges = cleanTags
      .map(
        (t) =>
          `<span class="badge bg-light text-dark border d-inline-flex align-items-center gap-1" style="font-size: 12px; padding: 4px 8px; border-radius: 6px; font-weight: 500;" title="Tag / Inhalt"><span class="material-symbols-outlined text-muted" style="font-size: 13px;">label</span> ${highlightQueryText(t, searchQuery)}</span>`
      )
      .join(" ");
  }

  return `
    <div class="d-flex align-items-center gap-1 flex-wrap" style="line-height: 1.4;">
      ${categoryBadge}
      ${tagsBadges}
      ${companyBadge}
    </div>
  `;
}

function updateStartFilterDropdownCounts() {
  const dateSelect = document.getElementById("start-filter-date");
  const compSelect = document.getElementById("start-filter-company");
  if (!activeJobs || activeJobs.length === 0) return;

  const totalJobs = activeJobs.length;
  const now = new Date();

  // 1. Calculate Date Counts
  let count7Days = 0;
  let count30Days = 0;
  let countMonth = 0;
  let countYear2026 = 0;
  let countYear2025 = 0;
  let countOlder = 0;

  activeJobs.forEach((job) => {
    const dateVal = getJobDocumentDate(job);
    if (dateVal && !isNaN(dateVal.getTime())) {
      const diffDays = (now - dateVal) / (1000 * 60 * 60 * 24);
      const year = dateVal.getFullYear();
      if (diffDays <= 7 && diffDays >= -1) count7Days++;
      if (diffDays <= 30 && diffDays >= -1) count30Days++;
      if (dateVal.getMonth() === now.getMonth() && dateVal.getFullYear() === now.getFullYear()) countMonth++;
      if (year === 2026) countYear2026++;
      if (year === 2025) countYear2025++;
      if (year < 2025) countOlder++;
    }
  });

  if (dateSelect) {
    const dateLabels = {
      alle: `📅 Alle Zeiträume (${totalJobs})`,
      "7days": `Letzte 7 Tage (${count7Days})`,
      "30days": `Letzte 30 Tage (${count30Days})`,
      month: `Dieser Monat (${countMonth})`,
      year2026: `Jahr 2026 (${countYear2026})`,
      year2025: `Jahr 2025 (${countYear2025})`,
      older: `Älter als 2025 (${countOlder})`,
    };
    Array.from(dateSelect.options).forEach((opt) => {
      if (dateLabels[opt.value]) {
        opt.text = dateLabels[opt.value];
      }
    });
  }

  // 2. Calculate Company Counts
  let countWirewire = 0;
  let countThewire = 0;
  let countPolyxo = 0;
  let countDaniel = 0;
  let countAndere = 0;

  activeJobs.forEach((job) => {
    const res = job.result || {};
    const compName = (res.company || "").toLowerCase();
    const targetComp = (job.targetCompany || "").toLowerCase();
    const isWirewire = compName.includes("wirewire") || targetComp === "wirewire";
    const isThewire = compName.includes("the wire") || compName.includes("thewire") || targetComp === "thewire";
    const isPolyxo = compName.includes("polyxo") || targetComp === "polyxo";
    const isDaniel = compName.includes("daniel") || targetComp === "daniel";

    if (isWirewire) countWirewire++;
    if (isThewire) countThewire++;
    if (isPolyxo) countPolyxo++;
    if (isDaniel) countDaniel++;
    if (!isWirewire && !isThewire && !isPolyxo && !isDaniel) countAndere++;
  });

  if (compSelect) {
    const compLabels = {
      alle: `🏢 Alle Unternehmen (${totalJobs})`,
      thewire: `The Wire UG (${countThewire})`,
      wirewire: `wirewire GmbH (${countWirewire})`,
      polyxo: `Polyxo Studios GmbH (${countPolyxo})`,
      daniel: `Daniel (Privat) (${countDaniel})`,
      andere: `Andere / Unbekannt (${countAndere})`,
    };
    Array.from(compSelect.options).forEach((opt) => {
      if (compLabels[opt.value]) {
        opt.text = compLabels[opt.value];
      }
    });
  }
}

function renderStartCategoryBubbles() {
  const container = document.getElementById("start-filter-category-bubbles");
  if (!container) return;

  const defaultCats = [
    "Rechnungen", "Dokumente", "Administration", "Personal",
    "Projekte", "Verträge", "Marketing", "Förderung",
    "Buchhaltung", "Vertrieb", "Privat", "Sonstige",
    "Duplikat-Verdacht"
  ];

  const dynamicCatsStr = window.currentSettings?.AI_CATEGORIES;
  let allCats = [...defaultCats];
  if (dynamicCatsStr) {
    dynamicCatsStr.split(",").forEach(c => {
      const trimmed = c.trim();
      if (trimmed && !allCats.some(ac => ac.toLowerCase() === trimmed.toLowerCase())) {
        allCats.splice(allCats.length - 1, 0, trimmed);
      }
    });
  }

  container.innerHTML = "";
  allCats.forEach(cat => {
    const isSelected = startSelectedCategories.has(cat.toLowerCase());
    const catLower = cat.toLowerCase();

    // Count available documents for this category
    const count = (activeJobs || []).filter((job) => {
      const res = job.result || {};
      const jobCat = (res.category || "").toLowerCase();
      const isInvoice = res.isInvoice === true || jobCat.includes("rechnung");
      const isPrivat = job.isPrivate === true || jobCat.includes("privat");

      if (catLower.includes("duplikat")) return job.suspectedDuplicate === true;
      if (catLower === "rechnungen" || catLower === "rechnung") return isInvoice;
      if (catLower === "dokumente" || catLower === "dokument") return !isInvoice;
      if (catLower === "privat") return isPrivat;
      return jobCat.includes(catLower);
    }).length;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `start-cat-bubble ${isSelected ? 'active' : ''}`;
    btn.innerHTML = `<span>${cat}</span> <span class="bubble-count">(${count})</span>${isSelected ? ' <span class="material-symbols-outlined" style="font-size: 14px; margin-left: 2px;">check</span>' : ''}`;
    
    btn.addEventListener("click", () => {
      const key = cat.toLowerCase();
      if (startSelectedCategories.has(key)) {
        startSelectedCategories.delete(key);
      } else {
        startSelectedCategories.add(key);
      }
      startCurrentPage = 1;
      renderStartCategoryBubbles();
      renderJobs();
    });

    container.appendChild(btn);
  });

  updateStartResetButtonVisibility();
}

function updateStartResetButtonVisibility() {
  const container = document.getElementById("start-reset-filters-container");
  const summaryEl = document.getElementById("start-active-filters-summary");
  if (!container) return;

  const hasSearch = !!startSearchQuery;
  const hasDate = startDateFilter !== "alle";
  const hasComp = startCompanyFilter !== "alle";
  const hasCats = startSelectedCategories.size > 0;
  const hasCustomSort = startSortOrder !== "docdate_desc";

  const isFiltered = hasSearch || hasDate || hasComp || hasCats || hasCustomSort;

  if (isFiltered) {
    container.style.setProperty("display", "flex", "important");
    if (summaryEl) {
      const activeFilters = [];
      if (hasSearch) activeFilters.push(`Suche: "${startSearchQuery}"`);
      if (hasDate) {
        const dateOpt = document.querySelector(`#start-filter-date option[value="${startDateFilter}"]`);
        activeFilters.push(dateOpt ? dateOpt.text.split("(")[0].trim() : "Zeitraum");
      }
      if (hasComp) {
        const compOpt = document.querySelector(`#start-filter-company option[value="${startCompanyFilter}"]`);
        activeFilters.push(compOpt ? compOpt.text.split("(")[0].trim() : "Unternehmen");
      }
      if (hasCats) {
        activeFilters.push(`${startSelectedCategories.size} Kategorie(n)`);
      }
      if (hasCustomSort) {
        const sortOpt = document.querySelector(`#start-sort-select option[value="${startSortOrder}"]`);
        activeFilters.push(sortOpt ? sortOpt.text : "Sortierung");
      }

      summaryEl.innerHTML = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle me-1"><span class="material-symbols-outlined" style="font-size: 13px; vertical-align: -2px;">filter_alt</span> ${activeFilters.length} Filter aktiv:</span> <span class="text-secondary">${activeFilters.join(" • ")}</span>`;
    }
  } else {
    container.style.setProperty("display", "none", "important");
  }
}

function filterActiveJobs(jobs) {
  const matchedJobs = jobs.filter((job) => {
    const res = job.result || {};

    // 0. Exclude duplicates and hidden documents from search
    const isDuplicate = !!(job.suspectedDuplicate || job.isDuplicate || job.duplicateOf || job.status === "duplicate");
    const isHidden = !!job.isHidden;

    if (startSearchQuery) {
      // In search mode: strictly exclude both duplicates and hidden documents
      if (isDuplicate || isHidden) return false;
    } else {
      // Normal list view: hide unless admin is showing hidden items
      if (isHidden && !window.showHiddenJobs) return false;
    }

    // 1. Search Query (Metadata Match OR OCR / Deep Search Match)
    if (startSearchQuery) {
      const q = startSearchQuery.toLowerCase();
      const title = (res.full || job.originalName || "").toLowerCase();
      const comp = (res.company || "").toLowerCase();
      const targetComp = (job.targetCompany || "").toLowerCase();
      const invNum = (res.invoiceNumber || job.invoiceNumber || "").toLowerCase();
      const cat = (res.category || "").toLowerCase();
      const tags = (res.tags && Array.isArray(res.tags) ? res.tags.join(" ") : "").toLowerCase();
      const notes = (job.notes || "").toLowerCase();
      const amtStr = res.invoiceAmmount ? (res.invoiceAmmount / 100).toFixed(2).replace(".", ",") : "";

      const matchesMetadata =
        title.includes(q) ||
        comp.includes(q) ||
        targetComp.includes(q) ||
        invNum.includes(q) ||
        cat.includes(q) ||
        tags.includes(q) ||
        notes.includes(q) ||
        amtStr.includes(q);

      const matchesOcr = typeof deepSearchSnippetsMap !== "undefined" && deepSearchSnippetsMap.has(job.id);

      if (!matchesMetadata && !matchesOcr) return false;
    }

    // 2. Company Filter
    if (startCompanyFilter !== "alle") {
      const compName = (res.company || "").toLowerCase();
      const targetComp = (job.targetCompany || "").toLowerCase();
      const isWirewire = compName.includes("wirewire") || targetComp === "wirewire";
      const isThewire = compName.includes("the wire") || compName.includes("thewire") || targetComp === "thewire";
      const isPolyxo = compName.includes("polyxo") || targetComp === "polyxo";
      const isDaniel = compName.includes("daniel") || targetComp === "daniel";

      if (startCompanyFilter === "wirewire" && !isWirewire) return false;
      if (startCompanyFilter === "thewire" && !isThewire) return false;
      if (startCompanyFilter === "polyxo" && !isPolyxo) return false;
      if (startCompanyFilter === "daniel" && !isDaniel) return false;
      if (startCompanyFilter === "andere" && (isWirewire || isThewire || isPolyxo || isDaniel)) return false;
    }

    // 3. Date Filter
    if (startDateFilter !== "alle") {
      const dateVal = getJobDocumentDate(job);
      if (dateVal && !isNaN(dateVal.getTime())) {
        const now = new Date();
        const diffDays = (now - dateVal) / (1000 * 60 * 60 * 24);
        const year = dateVal.getFullYear();

        if (startDateFilter === "7days" && (diffDays > 7 || diffDays < -1)) return false;
        if (startDateFilter === "30days" && (diffDays > 30 || diffDays < -1)) return false;
        if (startDateFilter === "month" && (dateVal.getMonth() !== now.getMonth() || dateVal.getFullYear() !== now.getFullYear())) return false;
        if (startDateFilter === "year2026" && year !== 2026) return false;
        if (startDateFilter === "year2025" && year !== 2025) return false;
        if (startDateFilter === "older" && year >= 2025) return false;
      }
    }

    // 4. Multi-Select Category Bubbles
    if (startSelectedCategories.size > 0) {
      const jobCat = (res.category || "").toLowerCase();
      const isInvoice = res.isInvoice === true || jobCat.includes("rechnung");
      const isPrivat = job.isPrivate === true || jobCat.includes("privat");

      let catMatch = false;
      for (const selCat of startSelectedCategories) {
        if (selCat.includes("duplikat")) {
          if (job.suspectedDuplicate === true) { catMatch = true; break; }
        } else if (selCat === "rechnungen" || selCat === "rechnung") {
          if (isInvoice) { catMatch = true; break; }
        } else if (selCat === "dokumente" || selCat === "dokument") {
          if (!isInvoice) { catMatch = true; break; }
        } else if (selCat === "privat") {
          if (isPrivat) { catMatch = true; break; }
        } else if (jobCat.includes(selCat)) {
          catMatch = true;
          break;
        }
      }
      if (!catMatch) return false;
    }

    return true;
  });

  return matchedJobs;
}

function renderStartPagination(totalItems, totalPages) {
  const container = document.getElementById("start-pagination-container");
  const info = document.getElementById("start-page-info");
  const nav = document.getElementById("start-pagination-nav");
  if (!container || !info || !nav) return;

  if (totalItems <= START_PAGE_SIZE) {
    container.style.setProperty("display", "none", "important");
    return;
  }

  container.style.setProperty("display", "flex", "important");
  const startDisplay = (startCurrentPage - 1) * START_PAGE_SIZE + 1;
  const endDisplay = Math.min(startCurrentPage * START_PAGE_SIZE, totalItems);
  info.innerText = `Zeige ${startDisplay} - ${endDisplay} von ${totalItems} Belegen (Seite ${startCurrentPage} von ${totalPages})`;

  nav.innerHTML = "";

  // Previous
  const prevLi = document.createElement("li");
  prevLi.className = `page-item ${startCurrentPage === 1 ? 'disabled' : ''}`;
  prevLi.innerHTML = `<a class="page-link" href="#" aria-label="Vorherige">«</a>`;
  prevLi.addEventListener("click", (e) => {
    e.preventDefault();
    if (startCurrentPage > 1) {
      startCurrentPage--;
      renderJobs();
      const listEl = document.getElementById("job-list-container");
      if (listEl) window.scrollTo({ top: listEl.offsetTop - 80, behavior: "smooth" });
    }
  });
  nav.appendChild(prevLi);

  // Page numbers (smart window around current page)
  let startP = Math.max(1, startCurrentPage - 2);
  let endP = Math.min(totalPages, startCurrentPage + 2);
  if (startP > 1) {
    const p1 = document.createElement("li");
    p1.className = "page-item";
    p1.innerHTML = `<a class="page-link" href="#">1</a>`;
    p1.addEventListener("click", (e) => {
      e.preventDefault();
      startCurrentPage = 1;
      renderJobs();
    });
    nav.appendChild(p1);
    if (startP > 2) {
      const dots = document.createElement("li");
      dots.className = "page-item disabled";
      dots.innerHTML = `<span class="page-link">...</span>`;
      nav.appendChild(dots);
    }
  }

  for (let p = startP; p <= endP; p++) {
    const pLi = document.createElement("li");
    pLi.className = `page-item ${p === startCurrentPage ? 'active' : ''}`;
    pLi.innerHTML = `<a class="page-link" href="#">${p}</a>`;
    const targetP = p;
    pLi.addEventListener("click", (e) => {
      e.preventDefault();
      startCurrentPage = targetP;
      renderJobs();
      const listEl = document.getElementById("job-list-container");
      if (listEl) window.scrollTo({ top: listEl.offsetTop - 80, behavior: "smooth" });
    });
    nav.appendChild(pLi);
  }

  if (endP < totalPages) {
    if (endP < totalPages - 1) {
      const dots = document.createElement("li");
      dots.className = "page-item disabled";
      dots.innerHTML = `<span class="page-link">...</span>`;
      nav.appendChild(dots);
    }
    const pLast = document.createElement("li");
    pLast.className = "page-item";
    pLast.innerHTML = `<a class="page-link" href="#">${totalPages}</a>`;
    pLast.addEventListener("click", (e) => {
      e.preventDefault();
      startCurrentPage = totalPages;
      renderJobs();
    });
    nav.appendChild(pLast);
  }

  // Next
  const nextLi = document.createElement("li");
  nextLi.className = `page-item ${startCurrentPage === totalPages ? 'disabled' : ''}`;
  nextLi.innerHTML = `<a class="page-link" href="#" aria-label="Nächste">»</a>`;
  nextLi.addEventListener("click", (e) => {
    e.preventDefault();
    if (startCurrentPage < totalPages) {
      startCurrentPage++;
      renderJobs();
      const listEl = document.getElementById("job-list-container");
      if (listEl) window.scrollTo({ top: listEl.offsetTop - 80, behavior: "smooth" });
    }
  });
  nav.appendChild(nextLi);
}

function renderJobs() {
  if (document.querySelector('.category-picker-box') || document.querySelector('.company-picker-box') || document.activeElement?.classList.contains('job-notes-input')) {
    // Ein Picker ist offen oder Nutzer tippt in Notizen, Neu-Zeichnen überspringen
    return;
  }

  renderStartCategoryBubbles();
  updateStartFilterDropdownCounts();
  updateStartResetButtonVisibility();

  const filteredJobs = sortJobs(filterActiveJobs(activeJobs), startSortOrder);
  const totalFiltered = filteredJobs.length;
  const totalPages = Math.ceil(totalFiltered / START_PAGE_SIZE) || 1;
  if (startCurrentPage > totalPages) startCurrentPage = totalPages;
  if (startCurrentPage < 1) startCurrentPage = 1;

  const countSpan = document.getElementById("active-job-count");
  if (countSpan) {
    const activeCount = activeJobs.filter((j) => j.status === "pending" || j.status === "processing").length;
    let label = `${totalFiltered} Belege`;
    if (activeCount > 0) label += ` (${activeCount} in Arbeit)`;
    countSpan.innerText = label;
  }
  if (typeof updateHiddenJobsCounter === "function") {
    updateHiddenJobsCounter();
  }

  // Offene Details-Boxen merken, damit sie beim Polling-Refresh nicht zuklappen
  const openStates = {};
  document.querySelectorAll("details.job-result").forEach((details) => {
    const id = details.getAttribute("data-job-id");
    if (id && details.open) openStates[id] = true;
  });

  jobList.innerHTML = "";
  if (filteredJobs.length === 0) {
    jobList.innerHTML = `
      <div class="text-center p-4 text-muted bg-white rounded shadow-sm border">
        <span class="material-symbols-outlined mb-2" style="font-size: 40px; color: #ccc;">search_off</span>
        <div>Keine Belege entsprechen den gewählten Filtern.</div>
      </div>
    `;
    renderStartPagination(0, 1);
    return;
  }

  const startIndex = (startCurrentPage - 1) * START_PAGE_SIZE;
  const endIndex = Math.min(startIndex + START_PAGE_SIZE, totalFiltered);
  const pageJobs = filteredJobs.slice(startIndex, endIndex);

  pageJobs.forEach((job) => {
    const div = document.createElement("div");
    div.className = `job-item ${job.status || "completed"}`;
    if (job.isPrivate) {
      div.style.borderLeft = "4px solid #f44336";
      div.style.backgroundColor = "#fff8f8";
    }

    // Special handling for Drive-only results (unlinked cloud files found via OCR / deep search)
    if (job.isDriveOnly) {
      const docDateObj = getJobDocumentDate(job);
      const docDateStr = docDateObj ? docDateObj.toLocaleDateString("de-DE") : (job.uploadDate ? new Date(job.uploadDate).toLocaleDateString("de-DE") : "-");
      const snippet = job.snippet || "";
      const highlightedSnippet = highlightQueryText(snippet, startSearchQuery);
      const highlightedTitle = highlightQueryText(job.originalName || "Google Drive Dokument", startSearchQuery);
      const rawDriveId = (job.id && job.id.startsWith("gdrive_")) ? job.id.replace("gdrive_", "") : (job.id || "");
      const imgSrc = `/api/thumbnail/${rawDriveId}`;

      div.innerHTML = `
        <div style="padding-right: 94px; min-height: 100px; display: flex; flex-direction: column; justify-content: flex-start;">
          <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;">
            <div class="job-title" style="display: flex; flex-direction: column; gap: 3px;">
              <div class="d-flex align-items-center gap-1 flex-wrap">
                <span class="badge bg-primary-subtle text-primary border border-primary-subtle d-inline-flex align-items-center gap-1" style="font-size: 12px; padding: 4px 9px; border-radius: 6px; font-weight: 600;">
                  <span class="material-symbols-outlined" style="font-size: 14px;">cloud</span> Google Drive
                </span>
              </div>
              <div style="font-size: 12.5px; color: #64748b; display: flex; align-items: center; gap: 5px; margin-top: 3px; word-break: break-all;">
                <span class="material-symbols-outlined" style="font-size: 15px; color: #64748b;">description</span>
                <span><strong style="color: #475569; font-weight: 600;">Dateiname Upload:</strong> <span style="color: #1e293b; font-weight: 400;">${highlightedTitle}</span></span>
              </div>
              <div style="font-size: 12.5px; color: #64748b; display: flex; align-items: center; gap: 5px; margin-top: 2px;">
                <span class="material-symbols-outlined" style="font-size: 15px; color: #64748b;">calendar_today</span>
                <span><strong style="color: #475569; font-weight: 600;">Dokumentendatum:</strong> <span style="color: #1e293b; font-weight: 400;">${docDateStr}</span></span>
              </div>
            </div>
          </div>
          ${
            snippet ? `
              <div class="p-2 my-2 rounded border bg-light text-secondary" style="font-size: 12.5px; line-height: 1.4; border-left: 3px solid #0d6efd !important;">
                <div class="d-flex align-items-center gap-1 text-primary small fw-bold mb-1">
                  <span class="material-symbols-outlined" style="font-size: 15px;">manage_search</span>
                  <span>Textausschnitt / OCR-Fundstelle:</span>
                </div>
                <div class="font-monospace text-dark bg-white p-2 rounded border" style="font-size: 12px; line-height: 1.5; word-break: break-word;">${highlightedSnippet}</div>
              </div>
            ` : ""
          }
          <div class="d-flex align-items-center gap-2 pt-1 flex-wrap">
            ${job.webViewLink ? `<a href="${job.webViewLink}" target="_blank" class="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" style="border-radius: 12px; font-size: 12px; padding: 2px 10px;"><span class="material-symbols-outlined" style="font-size: 14px;">open_in_new</span> In Google Drive öffnen</a>` : ""}
            ${job.downloadLink ? `<a href="${job.downloadLink}" class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" style="border-radius: 12px; font-size: 12px; padding: 2px 10px;"><span class="material-symbols-outlined" style="font-size: 14px;">download</span> Herunterladen</a>` : ""}
          </div>
        </div>
        <a href="${job.webViewLink || '#'}" target="_blank" class="pdf-preview-container" title="Beleg in Google Drive öffnen">
          <img src="${imgSrc}" loading="lazy" alt="Beleg Vorschau" class="pdf-preview-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
        </a>
      `;
      jobList.appendChild(div);
      return;
    }

    let privateBadgeHtml = '';
    if (window.isAdmin) {
        const bg = job.isPrivate ? '#fef2f2' : '#f1f5f9';
        const color = job.isPrivate ? '#dc2626' : '#475569';
        const border = job.isPrivate ? '#fecaca' : '#cbd5e1';
        const icon = job.isPrivate ? 'lock' : 'lock_open';
        const text = job.isPrivate ? 'PRIVAT' : 'ÖFFENTLICH';
        privateBadgeHtml = `<span class="toggle-private-pill" data-job-id="${job.id}" style="cursor: pointer; background: ${bg}; color: ${color}; border: 1px solid ${border}; padding: 2px 8px; border-radius: 12px; font-size: 10.5px; vertical-align: middle; display: inline-flex; align-items: center; gap: 3px; transition: all 0.2s; user-select: none; font-weight: 600;" title="Klicken zum Umschalten (Privat/Öffentlich)">
            <span class="material-symbols-outlined" style="font-size: 12px;">${icon}</span> ${text}
        </span>`;
    } else if (job.isPrivate) {
        privateBadgeHtml = '<span style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 2px 7px; border-radius: 12px; font-size: 10.5px; vertical-align: middle; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;">🔒 PRIVAT</span>';
    }

    const lexTransfers = job.lexofficeTransfers || {};
    const transferredCompanies = Object.keys(lexTransfers);
    const isLexTransferred = transferredCompanies.length > 0;
    const defaultTargetComp = job.targetCompany || detectDefaultTargetCompany(job.result?.company) || "thewire";
    const activeCompany = isLexTransferred ? (lexTransfers[defaultTargetComp] ? defaultTargetComp : transferredCompanies[0]) : defaultTargetComp;
    const activeTransfer = isLexTransferred ? lexTransfers[activeCompany] : null;
    const providerLabel = activeTransfer && activeTransfer.provider === "buchhaltungsbutler"
      ? "BuchhaltungsButler"
      : (activeCompany === "thewire" ? "BuchhaltungsButler" : "Lexoffice");

    let lexofficeBadgeHtml = '';
    if (window.isAdmin && isLexTransferred) {
        lexofficeBadgeHtml = `<span style="background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; padding: 2px 7px; border-radius: 12px; font-size: 10.5px; vertical-align: middle; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;" title="An Buchhaltung übertragen">✓ ${providerLabel} (${activeCompany})</span>`;
    }

    let duplicateBadgeHtml = '';
    if (job.suspectedDuplicate) {
        duplicateBadgeHtml = `<span class="badge-open-duplicate-compare" data-job-id="${job.id}" style="background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5; padding: 2px 8px; border-radius: 12px; font-size: 10.5px; vertical-align: middle; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;" title="Klicken, um Beleg mit erkannten Duplikaten gegenüberzustellen"><span class="material-symbols-outlined" style="font-size: 12px;">warning</span> DUPLIKAT VERDACHT</span>`;
    }

    let cancelJobButtonHtml = "";
    if (job.status === "pending" || job.status === "processing") {
      cancelJobButtonHtml = `
        <button class="btn btn-sm btn-outline-danger cancel-job-btn py-0 px-2 d-inline-flex align-items-center gap-1" data-job-id="${job.id}" style="font-size: 11px; height: 22px; border-radius: 6px; margin-left: 8px;" title="Aus Warteschlange abbrechen & löschen">
          <span class="material-symbols-outlined" style="font-size: 13px;">close</span> Abbrechen
        </button>
      `;
    }

    let statusHtml = "";
    if (job.status === "pending") {
      statusHtml = `
        <div class="job-status" style="margin-top: 5px; display: flex; align-items: center; flex-wrap: wrap;">
          <span class="badge bg-warning-subtle text-dark border d-inline-flex align-items-center gap-1" style="font-size: 11.5px; padding: 3px 8px;">
            <span class="spinner-border spinner-border-sm text-warning" style="width: 11px; height: 11px;" role="status"></span> In der Warteschlange...
          </span>
          ${cancelJobButtonHtml}
        </div>
      `;
    } else if (job.status === "processing") {
      statusHtml = `
        <div class="job-status" style="margin-top: 5px; display: flex; align-items: center; flex-wrap: wrap;">
          <span class="badge bg-info-subtle text-primary border border-info-subtle d-inline-flex align-items-center gap-1" style="font-size: 11.5px; padding: 3px 8px;">
            <span class="spinner-border spinner-border-sm text-primary" style="width: 11px; height: 11px;" role="status"></span> Wird verarbeitet (KI)...
          </span>
          ${cancelJobButtonHtml}
        </div>
      `;
    } else if (job.status === "error") {
      statusHtml = `
        <div class="job-status" style="margin-top: 5px; display: flex; align-items: center; flex-wrap: wrap;">
          <span class="badge bg-danger-subtle text-danger border border-danger-subtle d-inline-flex align-items-center gap-1" style="font-size: 11.5px; padding: 3px 8px;">
            <span class="material-symbols-outlined" style="font-size: 13px;">error</span> Fehlergeschlagen
          </span>
        </div>
      `;
    }

    const displayDate = job.uploadDate ? new Date(job.uploadDate).toLocaleString("de-DE") : "-";
    const docDateInfo = getValidatedJobDocumentDate(job);
    const docDateDisplay = docDateInfo.display;

    const webViewLink = job.result?.webViewLink || job.webViewLink || "#";
    const imgSrc = job.id ? `/api/jobs/${job.id}/thumbnail` : `/api/thumbnail/${job.rawDriveId || ''}`;
    let previewHtml = `<a href="${webViewLink}" target="_blank" class="pdf-preview-container" title="Beleg öffnen">
                    <img src="${imgSrc}" loading="lazy" alt="PDF Vorschau" class="pdf-preview-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
                </a>`;

    if (job.status === "completed" && job.result) {
      const cleanDetailsTags = getCleanJobTags(job.result.tags);
      const tagsStr = cleanDetailsTags.length > 0 ? cleanDetailsTags.join(", ") : "-";
      const isInvoiceStr = job.result.isInvoice ? "Ja" : "Nein";
      const durationStr = job.result.duration ? `${job.result.duration} Sekunden` : "-";

      const safeFull = escapeHtml(job.result.full || "-");
      const safeOriginalName = escapeHtml(job.originalName || "-");
      const safeCompany = escapeHtml(job.result.company || "-");
      const safeCategory = escapeHtml(job.result.category || "-");
      const safeTags = escapeHtml(tagsStr);
      const safeNotes = escapeHtml(job.notes || "");
      const safeDuration = escapeHtml(durationStr);

      let invoiceHtml = "";
      if (job.result.isInvoice || job.isInvoice) {
        const invNum = (job.invoiceNumber || job.result.invoiceNumber) && (job.invoiceNumber || job.result.invoiceNumber) !== "none" ? (job.invoiceNumber || job.result.invoiceNumber) : "-";
        const invAmtRaw = (job.invoiceAmmount !== undefined ? job.invoiceAmmount : job.result.invoiceAmmount) || 0;
        const invAmtFormatted = (invAmtRaw / 100).toFixed(2).replace('.', ',');
        invoiceHtml = `
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Rechnungsnummer:</strong> ${escapeHtml(invNum)}<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Rechnungsbetrag:</strong> ${invAmtFormatted} €<br>`;
      }

      let clickupDetailsHtml = `
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--md-sys-color-outline-variant, #CAC4D0); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">ClickUp:</strong> 
            ${job.clickup && job.clickup.taskId
              ? `<a href="${job.clickup.taskUrl || `https://app.clickup.com/t/${encodeURIComponent(job.clickup.taskId)}`}" target="_blank" style="color: #7b68ee; font-weight: 500; text-decoration: none;">Task #${escapeHtml(job.clickup.taskId)} (${escapeHtml(job.clickup.status || 'offen')})</a>`
              : `<span style="color: #888;">Nicht übertragen</span>`
            }
          </div>
          ${window.isAdmin ? `
            <button class="btn btn-sm btn-outline-primary btn-manual-clickup-transfer" data-job-id="${encodeURIComponent(job.id)}" style="border-radius: 12px; font-size: 12px; padding: 2px 10px; border-color: #7b68ee; color: #7b68ee; display: inline-flex; align-items: center; gap: 4px;">
              <span class="material-symbols-outlined" style="font-size: 14px;">cloud_upload</span>
              <span>${job.clickup && job.clickup.taskId ? 'Aktualisieren' : 'Zu ClickUp'}</span>
            </button>
          ` : ''}
        </div>
      `;

      let lexofficeDetailsHtml = "";
      if (window.isAdmin) {
        lexofficeDetailsHtml = `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--md-sys-color-outline-variant, #CAC4D0); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div>
              <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Buchhaltung:</strong> 
              ${isLexTransferred
                ? `<span style="color: #2e7d32; font-weight: 500;">✓ In ${escapeHtml(providerLabel)} (${escapeHtml(activeCompany)})</span>`
                : `<span style="color: #888;">Nicht übertragen</span>`
              }
            </div>
            <button class="btn btn-sm ${isLexTransferred ? 'btn-outline-success' : 'btn-outline-primary'} btn-manual-lexoffice-sync" data-job-id="${encodeURIComponent(job.id)}" style="border-radius: 12px; font-size: 12px; padding: 2px 10px; display: inline-flex; align-items: center; gap: 4px;">
              <span class="material-symbols-outlined" style="font-size: 14px;">${isLexTransferred ? 'check_circle' : 'sync'}</span>
              <span>${isLexTransferred ? '✓ Synchronisiert' : 'Buchhaltung Sync'}</span>
            </button>
          </div>
        `;
      }

      // Quick Sync Buttons for ClickUp & Buchhaltung next to Details
      const isClickupSynced = !!(job.clickup && job.clickup.taskId);
      const clickupTaskId = job.clickup?.taskId || "";
      const clickupStatus = job.clickup?.status || "offen";

      let clickupButtonHtml = "";
      let buchhaltungButtonHtml = "";

      if (window.isAdmin) {
        clickupButtonHtml = `
          <button type="button" class="job-action-btn btn-manual-clickup-transfer ${isClickupSynced ? 'btn-clickup-synced' : 'btn-clickup-pending'}" data-job-id="${encodeURIComponent(job.id)}" 
            title="${isClickupSynced ? `ClickUp Task #${escapeHtml(clickupTaskId)} (${escapeHtml(clickupStatus)}) - Klicken zum Aktualisieren` : 'Zu ClickUp übertragen'}">
            <span class="material-symbols-outlined">${isClickupSynced ? 'check_circle' : 'cloud_upload'}</span>
            <span>ClickUp</span>
          </button>
        `;

        buchhaltungButtonHtml = `
          <button type="button" class="job-action-btn btn-manual-lexoffice-sync ${isLexTransferred ? 'btn-accounting-synced' : 'btn-accounting-pending'}" data-job-id="${encodeURIComponent(job.id)}" 
            title="${isLexTransferred ? `Bereits in ${escapeHtml(providerLabel)} (${escapeHtml(activeCompany)}) synchronisiert - Klicken für Details / erneuten Abgleich` : `In Buchhaltung (${escapeHtml(providerLabel)}) übertragen`}">
            <span class="material-symbols-outlined">${isLexTransferred ? 'check_circle' : 'sync'}</span>
            <span>Buchhalt.</span>
          </button>
        `;
      }

      // Re-run AI analysis button
      const reprocessButtonHtml = `
        <button type="button" class="job-action-btn btn-reprocess-ai" data-job-id="${encodeURIComponent(job.id)}"
          title="KI-Erkennung wiederholen (Dokument erneut analysieren, umbenennen & Tags aktualisieren)">
          <span class="material-symbols-outlined" style="font-size: 16px;">psychology</span>
          <span>KI wiederholen</span>
        </button>
      `;

      // Hide / unhide button (available in Details and Action Bar)
      const isHidden = job.isHidden === true;
      const hideButtonHtml = `
        <button type="button" class="job-action-btn btn-hide-job ${isHidden ? 'btn-hidden-active' : ''}" data-job-id="${encodeURIComponent(job.id)}" data-is-hidden="${isHidden}"
          style="${isHidden ? 'background: #fff3e0; color: #e65100; border-color: #ffcc80;' : ''}"
          title="${isHidden ? 'Datei wieder einblenden' : 'Datei ausblenden (wird bei Drive-Sync nicht erneut importiert und nicht auf Drive gelöscht)'}">
          <span class="material-symbols-outlined" style="font-size: 16px; color: ${isHidden ? '#e65100' : 'inherit'};">${isHidden ? 'visibility' : 'visibility_off'}</span>
          <span>${isHidden ? 'Einblenden' : 'Ausblenden'}</span>
        </button>
      `;

      resultHtml = `
                    <div style="margin-top: 6px; width: 100%;">
                      <div class="job-action-bar d-flex align-items-center gap-2 flex-wrap">
                        <button type="button" class="job-action-btn btn-toggle-details btn-details" data-job-id="${encodeURIComponent(job.id)}" title="Details anzeigen / ausblenden">
                          <span class="material-symbols-outlined">info</span>
                          <span>Details</span>
                        </button>
                        ${clickupButtonHtml}
                        ${buchhaltungButtonHtml}
                      </div>
                      <details class="job-result" data-job-id="${encodeURIComponent(job.id)}" style="transition: all 0.3s; width: 100%;" ${openStates[job.id] ? "open" : ""}>
                        <summary style="display: none;"></summary>
                        <div style="position: relative; margin-top: 6px; padding: 14px; background: var(--md-sys-color-surface, #fff); border-radius: var(--md-sys-shape-corner-medium, 16px); border: 1px solid var(--md-sys-color-outline-variant, #CAC4D0); margin-right: -65px; font-size: 14px; color: var(--md-sys-color-on-surface, #1C1B1F); line-height: 1.6; box-shadow: var(--md-sys-elevation-1);">
                            <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom flex-wrap gap-2">
                              <span class="fw-bold text-muted small" style="text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Dokumentendetails</span>
                              <div class="d-flex align-items-center gap-2">
                                ${reprocessButtonHtml}
                                ${hideButtonHtml}
                              </div>
                            </div>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Generierter Dateiname:</strong> ${safeFull}<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Originaler Dateiname:</strong> ${safeOriginalName}<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Dokumentendatum:</strong> ${
                                docDateInfo.isInvalidFuture
                                  ? `<span style="color: #d32f2f; font-weight: 500;">${escapeHtml(docDateInfo.display)}</span> <span class="text-muted small" title="Erfasstes Datum war: ${escapeHtml(docDateInfo.rawDocDate)}">(Erfasst: ${escapeHtml(docDateInfo.rawDocDate)})</span>`
                                  : escapeHtml(docDateInfo.display)
                            }<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Hochgeladen am:</strong> ${escapeHtml(displayDate)}<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Unternehmen:</strong> 
                            <div style="position: relative; display: inline-block;">
                                <span class="company-editable" data-job-id="${encodeURIComponent(job.id)}" data-current-comp="${safeCompany}" style="cursor: pointer; padding: 4px 10px; border-radius: 16px; background: #e0f2fe; color: #0369a1; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; transition: filter 0.2s; margin-left: 4px; margin-bottom: 4px;" title="Klicken zum Ändern" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'">
                                    ${safeCompany} <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>
                                </span>
                            </div><br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Kategorie:</strong> 
                            <div style="position: relative; display: inline-block;">
                                <span class="category-editable" data-job-id="${encodeURIComponent(job.id)}" data-current-cat="${safeCategory}" style="cursor: pointer; padding: 4px 10px; border-radius: 16px; background: var(--md-sys-color-primary-container, #eaddff); color: var(--md-sys-color-on-primary-container, #21005d); font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; transition: filter 0.2s; margin-left: 4px; margin-bottom: 4px;" title="Klicken zum Ändern" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'">
                                    ${safeCategory} <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>
                                </span>
                            </div><br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Tags:</strong> ${safeTags}<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Rechnung:</strong> ${isInvoiceStr}<br>
${invoiceHtml}                            <strong style="color: var(--md-sys-color-primary, #1A1A1A);">Verarbeitungszeit:</strong> ${safeDuration}
                            <div class="job-notes-section mt-2 pt-2 border-top" style="border-color: var(--md-sys-color-outline-variant, #CAC4D0) !important;">
                                <div class="d-flex align-items-center justify-content-between mb-1">
                                    <strong style="color: var(--md-sys-color-on-surface-variant, #49454F); font-size: 13px; display: inline-flex; align-items: center; gap: 4px;">
                                        <span class="material-symbols-outlined" style="font-size: 16px; color: #64748b;">edit_note</span> Notizen:
                                    </strong>
                                    <span class="notes-save-indicator text-success small" style="font-size: 11px; display: none;">✓ Gespeichert</span>
                                </div>
                                <textarea class="form-control job-notes-input" data-job-id="${encodeURIComponent(job.id)}" placeholder="Notiz oder Stichworte zu diesem Beleg hinterlegen (durchsuchbar)..." rows="2" style="font-size: 13px; border-radius: 8px; resize: vertical; background: #fafafa; border-color: #cbd5e1; line-height: 1.4;">${safeNotes}</textarea>
                            </div>
${clickupDetailsHtml}
${lexofficeDetailsHtml}
                        </div>
                      </details>
                    </div>
                `;
    } else if (job.status === "error") {
      resultHtml = `
        <div class="job-result error d-flex align-items-center justify-content-between gap-2" style="flex-wrap: wrap;">
          <span style="word-break: break-word;">${escapeHtml(job.error || "Unbekannter Fehler")}</span>
          <button class="btn btn-sm btn-outline-danger retry-job-btn py-0 px-2 d-flex align-items-center gap-1" data-job-id="${encodeURIComponent(job.id)}" style="font-size: 11px; height: 26px; border-radius: 6px; white-space: nowrap; flex-shrink: 0;" title="Verarbeitung erneut starten">
            <span class="material-symbols-outlined" style="font-size: 14px;">replay</span> Wiederholen
          </button>
        </div>`;
    } else if (job.status === "processing") {
      let progressStyles = "";
      if (job.processingStartedAt) {
        const elapsedSec = (Date.now() - job.processingStartedAt) / 1000;
        // 0 to 100% over 200 seconds, max out at 99% while processing
        const progress = Math.min((elapsedSec / 200) * 100, 99);
        progressStyles = `width: ${progress}%;`;
      }
      resultHtml = `
                    <div class="progress-container">
                        <div class="progress-bar" data-job-id="${job.id}" style="${progressStyles}"></div>
                    </div>
                `;
    }

    let snippetHtml = "";
    const currentSnippet = job.snippet || (typeof deepSearchSnippetsMap !== "undefined" ? deepSearchSnippetsMap.get(job.id) : null);
    if (currentSnippet) {
      const highlightedSnippet = highlightQueryText(currentSnippet, startSearchQuery);
      snippetHtml = `
        <div class="p-2 my-2 rounded border bg-light text-secondary" style="font-size: 12.5px; line-height: 1.4; border-left: 3px solid #0d6efd !important; max-width: 100%;">
          <div class="d-flex align-items-center gap-1 text-primary small fw-bold mb-1">
            <span class="material-symbols-outlined" style="font-size: 15px;">manage_search</span>
            <span>Textausschnitt / OCR-Fundstelle:</span>
          </div>
          <div class="font-monospace text-dark bg-white p-2 rounded border" style="font-size: 12px; line-height: 1.5; word-break: break-word;">${highlightedSnippet}</div>
        </div>
      `;
    }

    const titleHtml = formatGeneratedFileNameHtml(job, startSearchQuery);

    div.innerHTML = `
                <div style="padding-right: 94px; min-height: 100px; display: flex; flex-direction: column; justify-content: flex-start;">
                    <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;">
                        <div class="job-title" style="display: flex; flex-direction: column; gap: 3px;">
                            <!-- Zeile 1: Kategorie, Tags, Unternehmen -->
                            <div>
                                ${titleHtml}
                            </div>
                            <!-- Zeile 2: Status-Badges (Öffentlich/Privat, Duplikat-Verdacht, Buchhaltung) -->
                            ${(privateBadgeHtml || duplicateBadgeHtml || lexofficeBadgeHtml) ? `
                              <div class="d-flex align-items-center gap-1 flex-wrap mt-1">
                                ${privateBadgeHtml}
                                ${duplicateBadgeHtml}
                                ${lexofficeBadgeHtml}
                              </div>
                            ` : ''}
                            <!-- Zeile 3: Dateiname Upload (oben) -->
                            <div style="font-size: 12.5px; color: #64748b; display: flex; align-items: center; gap: 5px; margin-top: 3px; word-break: break-all;">
                                <span class="material-symbols-outlined" style="font-size: 15px; color: #64748b;">description</span>
                                <span><strong style="color: #475569; font-weight: 600;">Dateiname Upload:</strong> <span style="color: #1e293b; font-weight: 400;">${highlightQueryText(job.originalName || "-", startSearchQuery)}</span></span>
                            </div>
                            <!-- Zeile 4: Dokumentendatum (darunter) -->
                            <div style="font-size: 12.5px; color: #64748b; display: flex; align-items: center; gap: 5px; margin-top: 2px;">
                                <span class="material-symbols-outlined" style="font-size: 15px; color: #64748b;">calendar_today</span>
                                <span><strong style="color: #475569; font-weight: 600;">Dokumentendatum:</strong> <span style="color: #1e293b; font-weight: 400;">${docDateDisplay}</span></span>
                            </div>
                        </div>
                        ${statusHtml}
                    </div>
                    ${snippetHtml}
                    ${resultHtml}
                </div>
                ${previewHtml}
            `;
    jobList.appendChild(div);
  });

  renderStartPagination(totalFiltered, totalPages);
}

// Update progress bars periodically based on time elapsed
setInterval(() => {
  const bars = document.querySelectorAll(".progress-bar");
  bars.forEach((bar) => {
    const jobId = bar.getAttribute("data-job-id");
    const job = activeJobs.find((j) => j.id === jobId);

    if (job && job.processingStartedAt && job.status === "processing") {
      const elapsedSec = (Date.now() - job.processingStartedAt) / 1000;
      // 0 to 100% over 200 seconds, max out at 99% while processing
      const progressProgress = Math.min((elapsedSec / 200) * 100, 99);
      bar.style.width = progressProgress + "%";
    }
  });
}, 500);

// Register Service Worker for PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => console.log("ServiceWorker registration successful"))
      .catch((err) => console.log("ServiceWorker registration failed: ", err));
  });
}

// PWA Install Prompt Logic
let deferredPrompt;
const pwaBanner = document.getElementById("pwa-install-banner");
const pwaInstallBtn = document.getElementById("pwa-install-btn");
const pwaCloseBtn = document.getElementById("pwa-close-btn");

// Check if dismissed before
const isPwaDismissed = localStorage.getItem("pwaPromptDismissed") === "true";

// Check if app is already running in standalone mode (installed)
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;

window.addEventListener("beforeinstallprompt", (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();

  // Stash the event so it can be triggered later.
  deferredPrompt = e;

  // Notify the user they can add to home screen if not dismissed
  if (!isPwaDismissed && !isStandalone) {
    pwaBanner.classList.add("show");
  }
});

if (pwaInstallBtn) {
  pwaInstallBtn.addEventListener("click", async () => {
    // Hide the banner
    pwaBanner.classList.remove("show");
    localStorage.setItem("pwaPromptDismissed", "true");

    if (deferredPrompt) {
      // Show the install prompt
      deferredPrompt.prompt();
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      // We've used the prompt, and can't use it again, throw it away
      deferredPrompt = null;
    }
  });
}

if (pwaCloseBtn) {
  pwaCloseBtn.addEventListener("click", () => {
    if (pwaBanner) pwaBanner.classList.remove("show");
    localStorage.setItem("pwaPromptDismissed", "true");
  });
}

window.addEventListener("appinstalled", () => {
  // Hide banner if shown and clear deferred prompt
  if (pwaBanner) pwaBanner.classList.remove("show");
  deferredPrompt = null;
  console.log("PWA was installed");
});

// PWA Web Share Target & File Handling Receiver
(function handlePwaSharedFiles() {
  // 1. Check if opened via /share-target redirect
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("shared") === "true") {
    const count = parseInt(urlParams.get("count") || "1", 10);
    setTimeout(() => {
      if (typeof showToast === "function") {
        showToast(`📥 ${count} geteilte(s) Dokument(e) empfangen und in die KI-Pipeline gestellt!`, "success");
      }
      startPolling();
    }, 500);
    // URL sauber bereinigen
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  // 2. File Handling API (LaunchQueue for Android/Desktop PWA "Open With")
  if ("launchQueue" in window && window.LaunchParams && "files" in window.LaunchParams.prototype) {
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams.files || launchParams.files.length === 0) return;
      try {
        const formData = new FormData();
        for (const fileHandle of launchParams.files) {
          const file = await fileHandle.getFile();
          formData.append("files", file);
        }
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
          if (typeof showToast === "function") {
            showToast(`📥 ${data.jobs.length} geöffnete Datei(en) in die KI-Pipeline gestellt!`, "success");
          }
          startPolling();
        }
      } catch (err) {
        console.error("[PWA FILE HANDLER] Fehler:", err);
      }
    });
  }
})();

// ==========================================
// --- Unified Deep Document Content & OCR Search ---
// ==========================================
let deepSearchSnippetsMap = new Map();
let driveOnlySearchResults = [];
let deepSearchDebounceTimer = null;
let currentDeepSearchQuery = "";

function highlightQueryText(text, query) {
  if (!text || !query) return text || "";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  return text.replace(regex, `<mark class="bg-warning-subtle text-dark fw-bold px-1 rounded">$1</mark>`);
}

function setSearchIconSpinning(isSpinning) {
  const icon = document.getElementById("search-icon-symbol");
  if (!icon) return;
  if (isSpinning) {
    icon.innerText = "sync";
    icon.classList.add("spin-animation");
  } else {
    icon.innerText = "search";
    icon.classList.remove("spin-animation");
  }
}

async function runDeepSearch(query) {
  if (!query || query.length < 2) {
    deepSearchSnippetsMap.clear();
    currentDeepSearchQuery = "";
    setSearchIconSpinning(false);
    renderJobs();
    return;
  }

  currentDeepSearchQuery = query;
  setSearchIconSpinning(true);

  try {
    const res = await fetch("/api/documents/deep-search?q=" + encodeURIComponent(query));
    const data = await res.json();

    // Verify query is still current
    if (startSearchQuery.toLowerCase() !== query.toLowerCase()) {
      return;
    }

    deepSearchSnippetsMap.clear();

    if (data.success && Array.isArray(data.results)) {
      data.results.forEach((item) => {
        const targetId = item.jobId || item.id;
        if (targetId && item.snippet) {
          deepSearchSnippetsMap.set(targetId, item.snippet);
        }
      });
    }

    setSearchIconSpinning(false);
    renderJobs();
  } catch (err) {
    console.error("[DEEP SEARCH] Fehler:", err);
    setSearchIconSpinning(false);
  }
}

// Fetch settings globally on load so category options are available
async function loadGlobalSettings() {
  window.isAdmin = false;
  try {
    const adminRes = await fetch("/api/admin-check");
    window.isAdmin = adminRes.ok;
  } catch(e) {
    window.isAdmin = false;
  }

  const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
  const navInboxTab = document.getElementById("nav-inbox-tab");

  if (window.isAdmin) {
    if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";
    if (navInboxTab) navInboxTab.style.display = "inline-flex";
  } else {
    if (navRechnungenTab) navRechnungenTab.style.display = "none";
    if (navInboxTab) navInboxTab.style.display = "none";
    if ((viewRechnungen && viewRechnungen.style.display === "block") || (viewInbox && viewInbox.style.display === "block")) {
      switchMainTab("upload");
    }
  }

  renderJobs();

  try {
    const res = await fetch("/api/settings");
    const json = await res.json();
    if (json.success) {
      window.currentSettings = json.settings;
    }
  } catch(e) {}
}
loadGlobalSettings();

// Category click to edit (modern pill design)
jobList.addEventListener('click', async (e) => {
  // Handle click on toggle private pill
  const togglePill = e.target.closest('.toggle-private-pill');
  if (togglePill) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = togglePill.getAttribute('data-job-id');
    const job = activeJobs.find(j => j.id === jobId);
    if (!job) return;
    
    const newIsPrivate = !job.isPrivate;
    job.isPrivate = newIsPrivate;
    renderJobs(); // optimistic update
    
    try {
        const res = await fetch(`/api/jobs/${jobId}/private`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isPrivate: newIsPrivate })
        });
        if (!res.ok) {
            alert("Fehler beim Speichern des Privat-Status.");
            job.isPrivate = !newIsPrivate;
            renderJobs();
        }
    } catch(err) {
        console.error("Failed to toggle private status", err);
        job.isPrivate = !newIsPrivate;
        renderJobs();
    }
    return;
  }

  // Handle click on "KI-Erkennung wiederholen" button
  const reprocessBtn = e.target.closest('.btn-reprocess-ai');
  if (reprocessBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = reprocessBtn.getAttribute('data-job-id');
    const job = (activeJobs && activeJobs.find(j => j.id === jobId)) || (uploadJobs && uploadJobs[jobId]);
    if (!job) return;

    const fileName = job.result?.full || job.originalName || "Dokument";
    const confirmed = confirm(
      `KI-Erkennung für „${fileName}“ wiederholen?\n\nDas Dokument wird erneut durch die Erkennungspipeline geschickt, analysiert, ggf. umbenannt und die Tags/Metadaten aktualisiert.`
    );
    if (!confirmed) return;

    job.status = "pending";
    job.inAiPipeline = true;
    job.error = null;
    renderJobs();

    if (typeof showToast === "function") {
      showToast(`🤖 KI-Erkennung für „${fileName}“ neu gestartet...`, "info");
    }

    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Fehler beim Starten der KI-Erkennung.");
      }
      fetchStatus();
    } catch (err) {
      console.error("[KI RETRY] Fehler:", err);
      alert("Fehler: " + err.message);
      fetchStatus();
    }
    return;
  }

  // Handle click on "Ausblenden / Einblenden" hide button
  const hideBtn = e.target.closest('.btn-hide-job');
  if (hideBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = hideBtn.getAttribute('data-job-id');
    const job = activeJobs.find(j => j.id === jobId);
    if (!job) return;

    const newIsHidden = !job.isHidden;

    // Confirm before hiding to avoid accidental clicks
    if (newIsHidden) {
      const confirmed = confirm(
        `Datei „${job.result?.full || job.originalName}" ausblenden?\n\nDie Datei bleibt in Google Drive erhalten und wird nicht gelöscht. Sie wird auch beim nächsten Drive-Sync nicht erneut importiert.`
      );
      if (!confirmed) return;
    }

    job.isHidden = newIsHidden;
    renderJobs(); // optimistic update

    try {
      const res = await fetch(`/api/jobs/${jobId}/hide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isHidden: newIsHidden })
      });
      if (!res.ok) {
        alert('Fehler beim Speichern des Ausblenden-Status.');
        job.isHidden = !newIsHidden;
        renderJobs();
      } else if (typeof showToast === 'function') {
        showToast(newIsHidden
          ? `📂 Datei ausgeblendet. Sie bleibt in Google Drive und wird nicht erneut importiert.`
          : `👁️ Datei wieder eingeblendet.`,
          newIsHidden ? 'info' : 'success'
        );
      }
    } catch (err) {
      console.error('Failed to toggle hidden status', err);
      job.isHidden = !newIsHidden;
      renderJobs();
    }
    return;
  }

  // Handle click on a category option pill
  const optionPill = e.target.closest('.cat-option-pill');
  if (optionPill) {
    e.stopPropagation();
    e.preventDefault();
    const newCategory = optionPill.getAttribute('data-value');
    const pickerBox = optionPill.closest('.category-picker-box');
    const editableSpan = pickerBox.parentElement.querySelector('.category-editable');
    const jobId = editableSpan.getAttribute('data-job-id');

    // Remove picker
    pickerBox.remove();
    
    // 1. Instant local state update for all lists
    const job = activeJobs.find(j => j.id === jobId);
    if (job) {
      if (!job.result) job.result = {};
      job.result.category = newCategory;
    }
    if (typeof allRechnungenJobs !== "undefined" && Array.isArray(allRechnungenJobs)) {
      const rJob = allRechnungenJobs.find(j => j.id === jobId);
      if (rJob) {
        if (!rJob.result) rJob.result = {};
        rJob.result.category = newCategory;
      }
    }

    // 2. Immediately re-render so overview card badges and filter bubbles update right away!
    renderJobs();
    if (typeof renderRechnungenList === "function") renderRechnungenList();

    // 3. Background API call
    try {
        fetch(`/api/jobs/${jobId}/category`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: newCategory })
        }).catch(err => console.error("Fehler beim Speichern der Kategorie", err));
    } catch(err) {
        console.error("Fehler beim Ändern der Kategorie", err);
    }
    return;
  }

  // Handle click on a company option pill
  const compOptionPill = e.target.closest('.comp-option-pill');
  if (compOptionPill) {
    e.stopPropagation();
    e.preventDefault();
    const newCompany = compOptionPill.getAttribute('data-value');
    const pickerBox = compOptionPill.closest('.company-picker-box');
    const editableSpan = pickerBox.parentElement.querySelector('.company-editable');
    const jobId = editableSpan.getAttribute('data-job-id');

    // Remove picker
    pickerBox.remove();

    // 1. Instant local state update for all lists
    const job = activeJobs.find(j => j.id === jobId);
    if (job) {
      if (!job.result) job.result = {};
      job.result.company = newCompany;
      const compLower = (newCompany || "").toLowerCase();
      if (compLower.includes("wirewire")) job.targetCompany = "wirewire";
      else if (compLower.includes("the wire") || compLower.includes("thewire")) job.targetCompany = "thewire";
      else if (compLower.includes("polyxo")) job.targetCompany = "polyxo";
      else if (compLower.includes("daniel")) job.targetCompany = "daniel";
    }
    if (typeof allRechnungenJobs !== "undefined" && Array.isArray(allRechnungenJobs)) {
      const rJob = allRechnungenJobs.find(j => j.id === jobId);
      if (rJob) {
        if (!rJob.result) rJob.result = {};
        rJob.result.company = newCompany;
      }
    }

    // 2. Immediately re-render so overview card badges and dropdown counts update right away!
    renderJobs();
    if (typeof renderRechnungenList === "function") renderRechnungenList();

    // 3. Background API call
    try {
      fetch(`/api/jobs/${jobId}/company`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: newCompany })
      }).catch(err => console.error("Fehler beim Speichern des Unternehmens", err));
    } catch(err) {
      console.error("Fehler beim Ändern des Unternehmens", err);
    }
    return;
  }

  // Handle click on the main category editable pill
  const target = e.target.closest('.category-editable');
  if (target) {
    // Check if we already have a picker box open here
    if (target.parentElement.querySelector('.category-picker-box')) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    // Close other pickers
    document.querySelectorAll('.category-picker-box, .company-picker-box').forEach(box => box.remove());

    const currentCat = target.getAttribute('data-current-cat');
    const jobId = target.getAttribute('data-job-id');
    
    const categoriesStr = window.currentSettings?.AI_CATEGORIES || "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige";
    const categories = categoriesStr.split(',').map(c => c.trim()).filter(c => c);
    
    if (!categories.includes(currentCat) && currentCat !== "-") {
      categories.push(currentCat);
    }

    let pillsHtml = categories.map(c => {
        const isSelected = c === currentCat;
        const bg = isSelected ? 'var(--md-sys-color-primary, #6750a4)' : 'var(--md-sys-color-surface-variant, #e7e0ec)';
        const color = isSelected ? '#ffffff' : 'var(--md-sys-color-on-surface-variant, #49454f)';
        return `<span class="cat-option-pill" data-value="${c}" style="cursor: pointer; padding: 6px 12px; border-radius: 16px; background: ${bg}; color: ${color}; font-size: 13px; font-weight: 500; white-space: nowrap; transition: filter 0.2s;" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'">${c}</span>`;
    }).join('');

    const pickerBoxHtml = `
      <div class="category-picker-box" style="position: absolute; top: 100%; left: 0; margin-top: 6px; padding: 12px; background: #ffffff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); border: 1px solid #e0e0e0; z-index: 1000; width: 320px; display: flex; flex-wrap: wrap; gap: 8px; cursor: default;">
        <div style="width: 100%; font-size: 12px; color: #777; margin-bottom: 4px; font-weight: 600;">Kategorie auswählen:</div>
        ${pillsHtml}
      </div>
    `;
    
    target.parentElement.insertAdjacentHTML('beforeend', pickerBoxHtml);
    return;
  }

  // Handle click on the main company editable pill
  const compTarget = e.target.closest('.company-editable');
  if (compTarget) {
    if (compTarget.parentElement.querySelector('.company-picker-box')) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    document.querySelectorAll('.category-picker-box, .company-picker-box').forEach(box => box.remove());

    const currentComp = compTarget.getAttribute('data-current-comp');
    const jobId = compTarget.getAttribute('data-job-id');
    
    const companies = [
      "The Wire UG",
      "wirewire GmbH",
      "Polyxo Studios GmbH",
      "Daniel (Privat)",
      "Andere / Unbekannt"
    ];
    
    if (currentComp && currentComp !== "-" && currentComp !== "Unbekannt" && !companies.some(c => c.toLowerCase() === currentComp.toLowerCase())) {
      companies.unshift(currentComp);
    }

    let pillsHtml = companies.map(c => {
        const isSelected = c.toLowerCase() === (currentComp || "").toLowerCase();
        const bg = isSelected ? '#0284c7' : '#f0f9ff';
        const color = isSelected ? '#ffffff' : '#0369a1';
        const border = isSelected ? '#0284c7' : '#bae6fd';
        return `<span class="comp-option-pill" data-value="${c}" style="cursor: pointer; padding: 6px 12px; border-radius: 16px; background: ${bg}; color: ${color}; border: 1px solid ${border}; font-size: 13px; font-weight: 500; white-space: nowrap; transition: filter 0.2s;" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'">${c}</span>`;
    }).join('');

    const pickerBoxHtml = `
      <div class="company-picker-box" style="position: absolute; top: 100%; left: 0; margin-top: 6px; padding: 12px; background: #ffffff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); border: 1px solid #e0e0e0; z-index: 1000; width: 320px; display: flex; flex-wrap: wrap; gap: 8px; cursor: default;">
        <div style="width: 100%; font-size: 12px; color: #777; margin-bottom: 4px; font-weight: 600;">Unternehmen auswählen:</div>
        ${pillsHtml}
      </div>
    `;
    
    compTarget.parentElement.insertAdjacentHTML('beforeend', pickerBoxHtml);
    return;
  }
});


// Close picker when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.category-picker-box') && !e.target.closest('.category-editable') &&
        !e.target.closest('.company-picker-box') && !e.target.closest('.company-editable')) {
        const boxes = document.querySelectorAll('.category-picker-box, .company-picker-box');
        if (boxes.length > 0) {
            boxes.forEach(box => box.remove());
            renderJobs();
        }
    }
});

// Auto-save job notes with debounce & on input/blur
const notesDebounceTimers = new Map();

document.addEventListener("input", (e) => {
  const notesInput = e.target.closest(".job-notes-input");
  if (notesInput) {
    const jobId = notesInput.getAttribute("data-job-id");
    const val = notesInput.value;
    const indicator = notesInput.parentElement.querySelector(".notes-save-indicator");

    // 1. Immediately update memory state for instant search without reload
    const job = (activeJobs && activeJobs.find(j => j.id === jobId));
    if (job) job.notes = val;
    if (typeof allRechnungenJobs !== "undefined" && Array.isArray(allRechnungenJobs)) {
      const rJob = allRechnungenJobs.find(j => j.id === jobId);
      if (rJob) rJob.notes = val;
    }

    if (notesDebounceTimers.has(jobId)) {
      clearTimeout(notesDebounceTimers.get(jobId));
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: val }),
        });
        if (res.ok && indicator) {
          indicator.style.display = "inline-block";
          setTimeout(() => {
            indicator.style.display = "none";
          }, 2000);
        }
      } catch (err) {
        console.error("Fehler beim Speichern der Notiz:", err);
      }
    }, 500);

    notesDebounceTimers.set(jobId, timer);
  }
});

// ==========================================
// --- Navigation & View Switching ---
// ==========================================

const navUploadTab = document.getElementById("nav-upload-tab");
const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
const navInboxTab = document.getElementById("nav-inbox-tab");
const viewUpload = document.getElementById("view-upload");
const viewRechnungen = document.getElementById("view-rechnungen");
const viewInbox = document.getElementById("view-inbox");

function switchMainTab(tab) {
  if ((tab === "rechnungen" || tab === "inbox") && !window.isAdmin) {
    tab = "upload";
  }

  if (navUploadTab) navUploadTab.classList.toggle("active", tab === "upload");
  if (navRechnungenTab) navRechnungenTab.classList.toggle("active", tab === "rechnungen");
  if (navInboxTab) navInboxTab.classList.toggle("active", tab === "inbox");

  if (viewUpload) viewUpload.style.display = tab === "upload" ? "block" : "none";
  if (viewRechnungen) viewRechnungen.style.display = tab === "rechnungen" ? "block" : "none";
  if (viewInbox) viewInbox.style.display = tab === "inbox" ? "block" : "none";

  if (tab === "upload") startPolling();
  if (tab === "rechnungen") loadRechnungenView();
  if (tab === "inbox") loadInboxData();
}

if (navUploadTab) navUploadTab.addEventListener("click", () => switchMainTab("upload"));
if (navRechnungenTab) navRechnungenTab.addEventListener("click", () => {
  if (!window.isAdmin) return;
  switchMainTab("rechnungen");
});
if (navInboxTab) navInboxTab.addEventListener("click", () => {
  if (!window.isAdmin) return;
  switchMainTab("inbox");
});

// ==========================================
// --- Rechnungsverarbeitung & Lexoffice ---
// ==========================================

let allRechnungenJobs = [];
let pendingLexofficeTransferTarget = null; // { jobId, companyKey, card, transferBtn }

const filterRechnungenSearch = document.getElementById("filter-rechnungen-search");
const filterOnlyInvoices = document.getElementById("filter-only-invoices");
const filterCompany = document.getElementById("filter-company");
const filterStatus = document.getElementById("filter-status");
const filterYear = document.getElementById("filter-year");
const filterQuarter = document.getElementById("filter-quarter");
const rechnungenList = document.getElementById("rechnungen-list");
const rechnungenCountBadge = document.getElementById("rechnungen-count-badge");

if (filterRechnungenSearch) filterRechnungenSearch.addEventListener("input", renderRechnungenList);
if (filterOnlyInvoices) filterOnlyInvoices.addEventListener("change", renderRechnungenList);
if (filterCompany) filterCompany.addEventListener("change", renderRechnungenList);
if (filterStatus) filterStatus.addEventListener("change", renderRechnungenList);
if (filterYear) filterYear.addEventListener("change", renderRechnungenList);
if (filterQuarter) filterQuarter.addEventListener("change", renderRechnungenList);

async function loadRechnungenView() {
  if (!rechnungenList) return;
  rechnungenList.innerHTML = `
    <div class="text-center p-5 text-muted">
      <div class="spinner-border text-primary mb-3" role="status"></div>
      <div>Lade Dokumente...</div>
    </div>
  `;
  try {
    const res = await fetch("/api/status?ids=all");
    const data = await res.json();
    if (data.success) {
      allRechnungenJobs = (data.statuses || []).filter((j) => j.status === "completed" && j.result);
      populateYearFilter(allRechnungenJobs);
      renderRechnungenList();
    } else {
      rechnungenList.innerHTML = `<div class="alert alert-danger">Fehler beim Laden der Dokumente.</div>`;
    }
  } catch (err) {
    console.error("Error loading rechnungen:", err);
    rechnungenList.innerHTML = `<div class="alert alert-danger">Fehler beim Laden der Dokumente.</div>`;
  }
}

function getDocumentYearAndQuarter(job) {
  const d = getJobDocumentDate(job) || (job.uploadDate ? new Date(job.uploadDate) : new Date());
  const year = d.getFullYear().toString();
  const month = d.getMonth() + 1;

  let quarter = "Q1";
  if (month >= 1 && month <= 3) quarter = "Q1";
  else if (month >= 4 && month <= 6) quarter = "Q2";
  else if (month >= 7 && month <= 9) quarter = "Q3";
  else quarter = "Q4";

  const dateStr = getValidatedJobDocumentDate(job).display;
  return { year, quarter, dateStr };
}

function populateYearFilter(jobs) {
  if (!filterYear) return;
  const years = new Set();
  jobs.forEach((j) => {
    const { year } = getDocumentYearAndQuarter(j);
    if (year) years.add(year);
  });

  const sortedYears = Array.from(years).sort((a, b) => b.localeCompare(a));
  const currentSelected = filterYear.value;

  filterYear.innerHTML = `<option value="alle">Alle Jahre</option>`;
  sortedYears.forEach((y) => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.innerText = y;
    filterYear.appendChild(opt);
  });

  if (sortedYears.includes(currentSelected)) {
    filterYear.value = currentSelected;
  }
}

function detectDefaultTargetCompany(companyNameStr) {
  const comp = (companyNameStr || "").toLowerCase();
  if (comp.includes("wirewire")) return "wirewire";
  if (comp.includes("the wire") || comp.includes("thewire")) return "thewire";
  if (comp.includes("polyxo")) return "polyxo";
  return "";
}

function renderRechnungenList() {
  if (!rechnungenList) return;
  if (!allRechnungenJobs || allRechnungenJobs.length === 0) {
    rechnungenList.innerHTML = `<div class="text-center p-5 text-muted">Keine Dokumente vorhanden.</div>`;
    if (rechnungenCountBadge) rechnungenCountBadge.innerText = "0 Dokumente";
    return;
  }

  const searchQuery = filterRechnungenSearch ? filterRechnungenSearch.value.trim().toLowerCase() : "";
  const onlyInvoices = filterOnlyInvoices ? filterOnlyInvoices.checked : true;
  const selectedCompany = filterCompany ? filterCompany.value : "alle";
  const selectedStatus = filterStatus ? filterStatus.value : "alle";
  const selectedYear = filterYear ? filterYear.value : "alle";
  const selectedQuarter = filterQuarter ? filterQuarter.value : "alle";

  const filteredJobs = allRechnungenJobs.filter((job) => {
    const res = job.result;
    if (!res) return false;

    // Exclude hidden documents
    if (job.isHidden) return false;

    // 0. Live Text Search filter (excludes duplicates when searching)
    if (searchQuery) {
      const isDuplicate = !!(job.suspectedDuplicate || job.isDuplicate || job.duplicateOf || job.status === "duplicate");
      if (isDuplicate) return false;

      const title = (res.full || job.originalName || "").toLowerCase();
      const comp = (res.company || "").toLowerCase();
      const targetComp = (job.targetCompany || "").toLowerCase();
      const invNum = (res.invoiceNumber || job.invoiceNumber || "").toLowerCase();
      const cat = (res.category || "").toLowerCase();
      const tags = (res.tags && Array.isArray(res.tags) ? res.tags.join(" ") : "").toLowerCase();
      const notes = (job.notes || "").toLowerCase();
      const amtStr = res.invoiceAmmount ? (res.invoiceAmmount / 100).toFixed(2).replace(".", ",") : "";

      const matches =
        title.includes(searchQuery) ||
        comp.includes(searchQuery) ||
        targetComp.includes(searchQuery) ||
        invNum.includes(searchQuery) ||
        cat.includes(searchQuery) ||
        tags.includes(searchQuery) ||
        notes.includes(searchQuery) ||
        amtStr.includes(searchQuery);

      if (!matches) return false;
    }

    // 1. Invoices filter
    if (onlyInvoices) {
      const isInvoice = res.isInvoice === true || (res.category && res.category.toLowerCase().includes("rechnung"));
      if (!isInvoice) return false;
    }

    // 2. Company filter
    const compName = (res.company || "").toLowerCase();
    const targetComp = (job.targetCompany || "").toLowerCase();
    const isWirewire = compName.includes("wirewire") || targetComp === "wirewire";
    const isThewire = compName.includes("the wire") || compName.includes("thewire") || targetComp === "thewire";
    const isPolyxo = compName.includes("polyxo") || targetComp === "polyxo";

    if (selectedCompany === "wirewire") {
      if (!isWirewire) return false;
    } else if (selectedCompany === "thewire") {
      if (!isThewire) return false;
    } else if (selectedCompany === "polyxo") {
      if (!isPolyxo) return false;
    } else if (selectedCompany === "andere") {
      if (isWirewire || isThewire || isPolyxo) return false;
    }

    // 3. Status filter (Lexoffice transfer status)
    if (selectedStatus !== "alle") {
      const lexTransfers = job.lexofficeTransfers || {};
      let isTransferred = false;
      if (selectedCompany === "wirewire" || selectedCompany === "thewire" || selectedCompany === "polyxo") {
        isTransferred = !!lexTransfers[selectedCompany];
      } else {
        isTransferred = Object.keys(lexTransfers).length > 0;
      }

      if (selectedStatus === "uebertragen" && !isTransferred) return false;
      if (selectedStatus === "nicht_uebertragen" && isTransferred) return false;
      if (selectedStatus === "duplikat" && !job.suspectedDuplicate) return false;
    }

    // 4. Year & Quarter filter
    const { year, quarter } = getDocumentYearAndQuarter(job);
    if (selectedYear !== "alle" && year !== selectedYear) return false;
    if (selectedQuarter !== "alle" && quarter !== selectedQuarter) return false;

    return true;
  });

  if (rechnungenCountBadge) {
    rechnungenCountBadge.innerText = `${filteredJobs.length} Dokument(e) gefunden`;
  }

  if (filteredJobs.length === 0) {
    rechnungenList.innerHTML = `
      <div class="text-center p-5 text-muted bg-white rounded shadow-sm">
        <span class="material-symbols-outlined mb-2" style="font-size: 48px; color: #ccc;">find_in_page</span>
        <div>Keine Dokumente entsprechen den gewählten Filtern.</div>
      </div>
    `;
    return;
  }

  rechnungenList.innerHTML = "";
  filteredJobs.forEach((job) => {
    const card = createRechnungCard(job);
    rechnungenList.appendChild(card);
  });
}

function createRechnungCard(job) {
  const res = job.result || {};
  const defaultTarget = job.targetCompany || detectDefaultTargetCompany(res.company) || "thewire";

  const card = document.createElement("div");
  card.className = "card shadow-sm border-0 mb-2";
  card.style.borderRadius = "10px";

  const thumbSrc = `/api/jobs/${job.id}/thumbnail`;
  const thumbnailHtml = `<img src="${thumbSrc}" loading="lazy" style="width: 60px; height: 80px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd;" onerror="this.onerror=null; this.parentElement.innerHTML='<div style=\\'width:60px;height:80px;background:#eee;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#aaa;\\'><span class=\\'material-symbols-outlined\\'>description</span></div>';" />`;

  // Format amount
  let amountFormatted = "";
  if (res.invoiceAmmount && res.invoiceAmmount > 0) {
    amountFormatted = (res.invoiceAmmount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  // Accounting transfers status (Lexoffice / BuchhaltungsButler)
  const lexTransfers = job.lexofficeTransfers || {};
  const transferredCompanies = Object.keys(lexTransfers);
  const isLexTransferred = transferredCompanies.length > 0;
  const targetTransferred = lexTransfers[defaultTarget];
  const activeTransfer = targetTransferred || (isLexTransferred ? lexTransfers[transferredCompanies[0]] : null);
  const activeCompany = activeTransfer ? activeTransfer.company : defaultTarget;
  const providerLabel = activeTransfer && activeTransfer.provider === "buchhaltungsbutler"
    ? "BuchhaltungsButler"
    : (activeCompany === "thewire" ? "BuchhaltungsButler" : "Lexoffice");

  const isInvoiceBadge = res.isInvoice
    ? `<span class="badge bg-success-subtle text-success border border-success-subtle me-1">Rechnung</span>`
    : `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle me-1">Dokument</span>`;

  let lexStatusBadgeHtml = "";
  if (activeTransfer) {
    const dateStr = new Date(activeTransfer.transferredAt).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    lexStatusBadgeHtml = `
      <span class="badge bg-success text-white d-inline-flex align-items-center gap-1 p-1 px-2" style="font-weight: 500;">
        <span class="material-symbols-outlined" style="font-size: 14px;">check_circle</span>
        Übertragen an ${providerLabel} (${activeCompany}) am ${dateStr}
      </span>
    `;
  }

    const safeCompany = escapeHtml(res.company || "Unbekannt");
    const safeCategory = res.category ? escapeHtml(res.category) : "";
    const safeDocTitle = escapeHtml(res.full || job.originalName || "Dokument");
    const safeDocDate = escapeHtml(getValidatedJobDocumentDate(job).display);
    const safeInvNum = res.invoiceNumber && res.invoiceNumber !== "none" ? escapeHtml(res.invoiceNumber) : "";
    const safeAmt = amountFormatted ? escapeHtml(amountFormatted) : "";

    card.innerHTML = `
    <div class="card-body p-3">
      <div class="d-flex gap-3 align-items-start">
        <div class="flex-shrink-0">
          ${thumbnailHtml}
        </div>
        <div class="flex-grow-1" style="min-width: 0;">
          <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
            ${isInvoiceBadge}
            <span class="badge bg-primary-subtle text-primary border border-primary-subtle">${safeCompany}</span>
            ${safeCategory ? `<span class="badge bg-light text-dark border">${safeCategory}</span>` : ""}
            <span class="text-muted small"><span class="material-symbols-outlined align-text-top" style="font-size: 14px;">calendar_today</span> ${safeDocDate}</span>
          </div>
          <h6 class="mb-1 fw-bold text-dark text-truncate" style="font-size: 14px;" title="${safeDocTitle}">${safeDocTitle}</h6>
          <div class="small text-muted d-flex gap-3 flex-wrap">
            ${safeInvNum ? `<span>Rechnungs-Nr: <strong>${safeInvNum}</strong></span>` : ""}
            ${safeAmt ? `<span class="text-success font-monospace">Betrag: <strong>${safeAmt}</strong></span>` : ""}
          </div>
          ${lexStatusBadgeHtml ? `<div class="lexoffice-status-area mt-2 small">${lexStatusBadgeHtml}</div>` : ""}
        </div>
      </div>

      <div class="border-top mt-2 pt-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="d-flex align-items-center gap-2">
          <span class="text-muted small" style="font-size: 12px; font-weight: 500;">ClickUp:</span>
          ${job.clickup && job.clickup.taskId
            ? `<a href="${job.clickup.taskUrl || `https://app.clickup.com/t/${encodeURIComponent(job.clickup.taskId)}`}" target="_blank" class="badge text-decoration-none" style="background: #7b68ee; color: white;">#${escapeHtml(job.clickup.taskId)} (${escapeHtml(job.clickup.status || 'offen')})</a>`
            : `<span class="badge bg-light text-secondary border">Nicht übertragen</span>`
          }
        </div>
        <button class="btn btn-sm btn-outline-secondary rechnung-clickup-btn d-flex align-items-center gap-1" data-job-id="${encodeURIComponent(job.id)}" style="border-radius: 20px; padding: 4px 12px; font-size: 12px; border-color: #7b68ee; color: #7b68ee;">
          <span class="material-symbols-outlined" style="font-size: 15px;">cloud_upload</span>
          <span>${job.clickup && job.clickup.taskId ? "ClickUp aktualisieren" : "Zu ClickUp"}</span>
        </button>
      </div>

      ${window.isAdmin ? `
        <div class="border-top mt-2 pt-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div class="d-flex align-items-center gap-2">
            <span class="text-muted small" style="font-size: 12px; font-weight: 500;">Buchhaltung:</span>
            ${activeTransfer
              ? `<span class="badge bg-success-subtle text-success border border-success-subtle d-inline-flex align-items-center gap-1"><span class="material-symbols-outlined" style="font-size: 13px;">check_circle</span> <span>✓ Übertragen am ${new Date(activeTransfer.transferredAt).toLocaleDateString("de-DE")}</span></span>`
              : `<span class="badge bg-light text-secondary border">Nicht übertragen</span>`
            }
          </div>
          <button class="btn btn-sm ${activeTransfer ? 'btn-outline-success' : 'btn-outline-primary'} rechnung-lex-btn d-flex align-items-center gap-1" data-job-id="${job.id}" style="border-radius: 20px; padding: 4px 12px; font-size: 12px;">
            <span class="material-symbols-outlined" style="font-size: 15px;">${activeTransfer ? 'check_circle' : 'sync'}</span>
            <span>${activeTransfer ? '✓ Synchronisiert' : 'In Buchhaltung'}</span>
          </button>
        </div>
      ` : ''}
    </div>
  `;

  return card;
}

// ==========================================
// --- Accounting Sync Modal & Handler ---
// ==========================================

let currentLexJobId = null;
let currentLexCheckData = null;
let currentSelectedLexCompany = "thewire";

const lexSyncModal = document.getElementById("lexoffice-sync-modal");
const lexModalHeading = document.getElementById("lex-modal-heading");
const lexModalProviderBadge = document.getElementById("lex-modal-provider-badge");
const lexModalCloseBtn = document.getElementById("lex-modal-close-btn");
const lexModalCancelBtn = document.getElementById("lex-modal-cancel-btn");
const lexModalSubmitBtn = document.getElementById("lex-modal-submit-btn");
const lexModalSubmitText = document.getElementById("lex-modal-submit-text");
const lexModalCompanyBadgesContainer = document.getElementById("lex-modal-company-badges");
const lexModalStatusContainer = document.getElementById("lex-modal-status-container");

const lexDocThumbContainer = document.getElementById("lex-doc-thumb-container");
const lexDocTitle = document.getElementById("lex-doc-title");
const lexDocDate = document.getElementById("lex-doc-date");
const lexDocCompany = document.getElementById("lex-doc-company");
const lexDocInvNumber = document.getElementById("lex-doc-inv-number");
const lexDocAmount = document.getElementById("lex-doc-amount");

function closeLexofficeModal() {
  if (lexSyncModal) lexSyncModal.style.display = "none";
  currentLexJobId = null;
  currentLexCheckData = null;
  currentSelectedLexCompany = "thewire";
}

if (lexModalCloseBtn) lexModalCloseBtn.addEventListener("click", closeLexofficeModal);
if (lexModalCancelBtn) lexModalCancelBtn.addEventListener("click", closeLexofficeModal);

async function openLexofficeSyncModal(jobId) {
  if (!window.isAdmin) {
    alert("Diese Funktion erfordert Administrator-Rechte.");
    return;
  }
  const job = (activeJobs && activeJobs.find((j) => j.id === jobId)) || (allRechnungenJobs && allRechnungenJobs.find((j) => j.id === jobId));
  if (!job) {
    alert("Dokument nicht gefunden.");
    return;
  }

  currentLexJobId = jobId;
  const res = job.result || {};
  if (lexSyncModal) lexSyncModal.style.display = "flex";

  // Pre-fill Document preview info
  const thumbSrc = `/api/jobs/${job.id}/thumbnail`;

  if (lexDocThumbContainer) {
    lexDocThumbContainer.innerHTML = `<img src="${thumbSrc}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'material-symbols-outlined text-muted\\'>description</span>';" />`;
  }

  if (lexDocTitle) {
    lexDocTitle.innerText = res.full || job.originalName || "Dokument.pdf";
    lexDocTitle.title = res.full || job.originalName || "";
  }
  if (lexDocDate) {
    lexDocDate.innerText = `📅 ${getValidatedJobDocumentDate(job).display}`;
  }
  if (lexDocCompany) {
    lexDocCompany.innerText = `🏢 ${res.company || "Unbekannt"}`;
  }

  const invNum = res.invoiceNumber && res.invoiceNumber !== "none" ? res.invoiceNumber : (job.invoiceNumber && job.invoiceNumber !== "none" ? job.invoiceNumber : "-");
  if (lexDocInvNumber) {
    lexDocInvNumber.innerText = `Rechnung: ${invNum}`;
  }

  let amountStr = "-";
  const invAmt = res.invoiceAmmount !== undefined ? res.invoiceAmmount : job.invoiceAmmount;
  if (invAmt && invAmt > 0) {
    amountStr = (invAmt / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }
  if (lexDocAmount) {
    lexDocAmount.innerText = `Betrag: ${amountStr}`;
  }

  // Default target company
  currentSelectedLexCompany = job.targetCompany || detectDefaultTargetCompany(res.company) || "thewire";

  await checkLexofficeTarget(jobId, currentSelectedLexCompany);
}

function renderAccountingModalContent() {
  if (!currentLexCheckData || !currentLexJobId) return;

  const data = currentLexCheckData;
  const companyKey = currentSelectedLexCompany || "thewire";
  const allCompanyChecks = data.allCompanyChecks || {};
  const selectedData = allCompanyChecks[companyKey] || {
    companyKey,
    companyDisplayName: companyKey === "thewire" ? "The Wire UG" : (companyKey === "wirewire" ? "wirewire GmbH" : "Polyxo Studios GmbH"),
    provider: companyKey === "thewire" ? "buchhaltungsbutler" : "lexoffice",
    providerName: companyKey === "thewire" ? "BuchhaltungsButler" : "Lexoffice",
    apiValid: false,
    alreadyTransferred: false,
    liveSearch: { found: false, matches: [] },
  };

  const isButler = companyKey === "thewire";
  const providerName = selectedData.providerName || (isButler ? "BuchhaltungsButler" : "Lexoffice");

  if (lexModalProviderBadge) {
    lexModalProviderBadge.innerText = providerName;
    lexModalProviderBadge.className = isButler
      ? "badge bg-info-subtle text-info-emphasis border border-info-subtle small"
      : "badge bg-primary-subtle text-primary border border-primary-subtle small";
  }

  const companyKeys = ["thewire", "wirewire", "polyxo"];

  // 1. Interactive Company Badges (Target Selection)
  const badgesContainer = document.getElementById("lex-modal-company-badges");
  const companyBadgesHtml = companyKeys
    .map((ck) => {
      const cInfo = allCompanyChecks[ck];
      if (!cInfo) return "";
      const isSelected = ck === companyKey;
      const shortName = ck === "thewire" ? "The Wire UG" : (ck === "wirewire" ? "wirewire GmbH" : "Polyxo Studios");
      const providerLabel = ck === "thewire" ? "BuchhaltungsButler" : "Lexoffice";

      let badgeClass = "bg-light text-muted border";
      let statusIcon = "radio_button_unchecked";
      let statusText = "Kein Beleg";

      if (cInfo.alreadyTransferred) {
        badgeClass = "bg-success text-white";
        statusIcon = "check_circle";
        statusText = "Übertragen";
      } else if (cInfo.liveSearch && cInfo.liveSearch.found && cInfo.liveSearch.matches && cInfo.liveSearch.matches.length > 0) {
        badgeClass = "bg-warning text-dark border-warning";
        statusIcon = "find_in_page";
        statusText = "Treffer";
      } else if (!cInfo.apiValid) {
        badgeClass = "bg-secondary-subtle text-secondary";
        statusIcon = "block";
        statusText = "Nicht eingerichtet";
      }

      const cardStyle = isSelected
        ? "border: 2px solid #0d6efd !important; background: #eef4ff; box-shadow: 0 0 0 1px #0d6efd;"
        : "border: 1px solid #dee2e6; background: #ffffff; cursor: pointer;";

      return `
        <div class="company-select-badge p-2 px-3 rounded-3 d-flex flex-column gap-1 flex-grow-1" 
             style="${cardStyle} min-width: 140px; transition: all 0.15s ease;"
             data-company="${ck}"
             title="${shortName} (${providerLabel}): ${statusText} (Klicken zum Auswählen)">
          <div class="d-flex align-items-center justify-content-between gap-2">
            <div class="d-flex align-items-center gap-1">
              <span class="material-symbols-outlined" style="font-size: 16px; color: ${isSelected ? '#0d6efd' : '#666'};">
                ${isSelected ? 'radio_button_checked' : 'radio_button_unchecked'}
              </span>
              <strong style="font-size: 13px; color: ${isSelected ? '#0d6efd' : '#222'};">${shortName}</strong>
            </div>
            <span class="badge ${badgeClass} d-inline-flex align-items-center gap-1" style="font-size: 10px; padding: 2px 6px;">
              <span class="material-symbols-outlined" style="font-size: 11px;">${statusIcon}</span> ${statusText}
            </span>
          </div>
          <div class="text-muted" style="font-size: 11px; padding-left: 20px;">
            ${providerLabel}
          </div>
        </div>
      `;
    })
    .join("");

  if (badgesContainer) {
    badgesContainer.innerHTML = companyBadgesHtml;
    badgesContainer.querySelectorAll(".company-select-badge").forEach((badge) => {
      badge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetComp = badge.getAttribute("data-company");
        if (targetComp && targetComp !== currentSelectedLexCompany) {
          currentSelectedLexCompany = targetComp;
          renderAccountingModalContent();
        }
      });
    });
  }

  // 2. Cross-Company Warning Alerts for Other Companies
  let otherCompanyAlertsHtml = "";
  companyKeys.forEach((ck) => {
    if (ck === companyKey) return;
    const otherInfo = allCompanyChecks[ck];
    if (!otherInfo) return;

    if (otherInfo.alreadyTransferred) {
      const dateFormatted = otherInfo.transferredInfo?.transferredAt
        ? new Date(otherInfo.transferredInfo.transferredAt).toLocaleString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "-";
      otherCompanyAlertsHtml += `
        <div class="p-2 mb-2 rounded-3 border bg-success-subtle text-success-emphasis d-flex align-items-center justify-content-between flex-wrap gap-2" style="border-color: #a5d6a7 !important;">
          <div class="d-flex align-items-center gap-2">
            <span class="material-symbols-outlined text-success" style="font-size: 20px;">task_alt</span>
            <div style="font-size: 12.5px;">
              <strong>Bereits übertragen:</strong> Beleg existiert schon in <strong>${otherInfo.companyDisplayName}</strong> (${otherInfo.providerName}, übertragen am ${dateFormatted} Uhr).
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-success btn-switch-modal-company py-1 px-2 d-inline-flex align-items-center gap-1" data-company="${ck}" style="border-radius: 6px; font-size: 11.5px; font-weight: 500;">
            <span class="material-symbols-outlined" style="font-size: 14px;">swap_horiz</span>
            <span>Zu ${otherInfo.companyDisplayName} wechseln</span>
          </button>
        </div>
      `;
    } else if (otherInfo.liveSearch && otherInfo.liveSearch.found && otherInfo.liveSearch.matches && otherInfo.liveSearch.matches.length > 0) {
      const topMatch = otherInfo.liveSearch.matches[0];
      otherCompanyAlertsHtml += `
        <div class="p-2 mb-2 rounded-3 border bg-warning-subtle text-dark d-flex align-items-center justify-content-between flex-wrap gap-2" style="border-color: #ffc107 !important;">
          <div class="d-flex align-items-center gap-2">
            <span class="material-symbols-outlined text-warning-emphasis" style="font-size: 20px;">find_in_page</span>
            <div style="font-size: 12.5px;">
              <strong>Gefunden in anderem Unternehmen:</strong> In <strong>${otherInfo.companyDisplayName}</strong> (${otherInfo.providerName}) existiert bereits ein übereinstimmender Beleg (${topMatch.invoiceNumber !== '-' ? topMatch.invoiceNumber : (topMatch.amount || topMatch.totalAmount || '')}).
            </div>
          </div>
          <div class="d-flex align-items-center gap-1">
            <button type="button" class="btn btn-sm btn-outline-primary btn-open-compare-modal py-1 px-2 d-inline-flex align-items-center gap-1" data-job-id="${currentLexJobId}" data-company="${ck}" data-match-index="0" style="border-radius: 6px; font-size: 11.5px;">
              <span class="material-symbols-outlined" style="font-size: 14px;">compare</span>
              <span>Vorschau</span>
            </button>
            <button type="button" class="btn btn-sm btn-outline-dark btn-switch-modal-company py-1 px-2 d-inline-flex align-items-center gap-1" data-company="${ck}" style="border-radius: 6px; font-size: 11.5px; font-weight: 500;">
              <span class="material-symbols-outlined" style="font-size: 14px;">swap_horiz</span>
              <span>Zu ${otherInfo.companyDisplayName} wechseln</span>
            </button>
          </div>
        </div>
      `;
    }
  });

  // Check API validity of selected company
  if (!selectedData.apiValid) {
    lexModalStatusContainer.innerHTML = `
      ${otherCompanyAlertsHtml}
      <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-start gap-2">
        <span class="material-symbols-outlined flex-shrink-0" style="font-size: 20px;">warning</span>
        <div>
          <strong>API-Prüfung fehlgeschlagen:</strong><br>
          ${selectedData.apiError || `Keine gültigen Zugangsdaten für ${providerName} (${companyKey}) hinterlegt.`}
          <div class="small mt-1 text-muted">Bitte hinterlege die Zugangsdaten in den Einstellungen.</div>
        </div>
      </div>
    `;
    lexModalSubmitBtn.disabled = true;
    lexModalSubmitBtn.className = "btn btn-secondary px-4 d-flex align-items-center gap-2";
    if (lexModalSubmitText) lexModalSubmitText.innerText = "API-Key erforderlich";
    wireModalInternalButtons();
    return;
  }

  // 3. Live Match in Selected Company
  const hasLiveMatch = selectedData.liveSearch && selectedData.liveSearch.found && selectedData.liveSearch.matches && selectedData.liveSearch.matches.length > 0;
  let liveMatchHtml = "";
  if (hasLiveMatch) {
    const topMatch = selectedData.liveSearch.matches[0];
    const matchBadge = `<span class="badge bg-warning text-dark border border-warning-subtle">${topMatch.matchReasons.length} Übereinstimmungen</span>`;
    const reasonsList = topMatch.matchReasons.map(r => `<li><span class="text-success fw-medium">✓</span> ${r}</li>`).join("");

    liveMatchHtml = `
      <div class="p-3 mb-2 rounded-3 border bg-warning-subtle text-dark" style="border-color: #ffc107 !important;">
        <div class="d-flex align-items-center justify-content-between flex-wrap gap-1 mb-2">
          <div class="d-flex align-items-center gap-1 fw-bold" style="font-size: 13.5px; color: #664d03;">
            <span class="material-symbols-outlined" style="font-size: 20px;">find_in_page</span>
            <span>Beleg bereits in ${providerName} (${companyKey}) gefunden!</span>
          </div>
          ${matchBadge}
        </div>
        
        <div class="p-2 rounded bg-white border mb-2" style="font-size: 12.5px; line-height: 1.5;">
          <div class="d-flex justify-content-between flex-wrap gap-2">
            <div><strong>Gefundener Beleg:</strong> ${topMatch.invoiceNumber !== '-' ? topMatch.invoiceNumber : topMatch.fileName}</div>
            <div><strong>Betrag:</strong> <span class="font-monospace text-success fw-bold">${topMatch.amount || topMatch.totalAmount}</span></div>
          </div>
          <div class="text-muted small mt-1">
            <span>Datum: <strong>${topMatch.date || topMatch.voucherDate}</strong></span>
            ${topMatch.partner || topMatch.contactName ? ` | <span>Partner: <strong>${topMatch.partner || topMatch.contactName}</strong></span>` : ''}
            ${topMatch.voucherStatus ? ` | Status: <span class="badge bg-light text-dark border">${topMatch.voucherStatus}</span>` : ''}
          </div>
          <div class="mt-2 pt-2 border-top">
            <span class="text-muted fw-bold small" style="font-size: 11px;">Abgeglichene Datenpunkte:</span>
            <ul class="mb-0 ps-0 mt-1 small" style="font-size: 12px; list-style-type: none;">
              ${reasonsList}
            </ul>
          </div>
        </div>

        <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 pt-1">
          <button type="button" class="btn btn-sm btn-outline-primary btn-open-compare-modal d-inline-flex align-items-center gap-1" data-job-id="${currentLexJobId}" data-company="${companyKey}" data-match-index="0" style="border-radius: 12px; font-size: 12px; padding: 4px 12px; font-weight: 500;">
            <span class="material-symbols-outlined" style="font-size: 16px;">compare</span>
            <span>Belege gegenüberstellen (Vorschau)</span>
          </button>
          <button type="button" class="btn btn-sm btn-success btn-mark-synced-direct d-inline-flex align-items-center gap-1" data-job-id="${currentLexJobId}" data-company="${companyKey}" data-file-id="${topMatch.id}" style="border-radius: 12px; font-size: 12px; padding: 4px 12px;">
            <span class="material-symbols-outlined" style="font-size: 16px;">check_circle</span>
            <span>Als synchronisiert markieren</span>
          </button>
        </div>
      </div>
    `;
  }

  // 4. Overall status in Selected Company
  if (selectedData.alreadyTransferred && selectedData.transferredInfo) {
    const dateFormatted = new Date(selectedData.transferredInfo.transferredAt).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const fileId = selectedData.transferredInfo.fileId || selectedData.transferredInfo.lexofficeFileId || "-";
    lexModalStatusContainer.innerHTML = `
      ${otherCompanyAlertsHtml}
      ${liveMatchHtml}
      <div class="p-2 rounded bg-success-subtle text-success-emphasis border border-success-subtle d-flex align-items-start gap-2">
        <span class="material-symbols-outlined text-success flex-shrink-0" style="font-size: 20px;">check_circle</span>
        <div style="font-size: 13px;">
          <strong>Bereits bei ${providerName} vorhanden:</strong><br>
          Übertragen an <strong>${companyKey}</strong> am <strong>${dateFormatted} Uhr</strong>.<br>
          <span class="small text-muted font-monospace">Beleg-ID: ${fileId}</span>
        </div>
      </div>
    `;
    lexModalSubmitBtn.disabled = false;
    lexModalSubmitBtn.className = "btn btn-outline-primary px-4 d-flex align-items-center gap-2";
    if (lexModalSubmitText) lexModalSubmitText.innerText = "Trotzdem erneut übertragen";
  } else if (hasLiveMatch) {
    lexModalStatusContainer.innerHTML = `
      ${otherCompanyAlertsHtml}
      ${liveMatchHtml}
    `;
    lexModalSubmitBtn.disabled = false;
    lexModalSubmitBtn.className = "btn btn-outline-warning text-dark px-4 d-flex align-items-center gap-2";
    if (lexModalSubmitText) lexModalSubmitText.innerText = "Trotzdem übertragen (Duplikat)";
  } else {
    lexModalStatusContainer.innerHTML = `
      ${otherCompanyAlertsHtml}
      <div class="p-2 rounded bg-info-subtle text-info-emphasis border border-info-subtle d-flex align-items-start gap-2">
        <span class="material-symbols-outlined text-primary flex-shrink-0" style="font-size: 20px;">cloud_upload</span>
        <div style="font-size: 13px;">
          <strong>Bereit zum Upload:</strong><br>
          API verbunden mit <strong>${selectedData.organizationName || providerName}</strong>.<br>
          <span class="text-success small fw-medium">✓ Kein übereinstimmender Beleg in ${providerName} (${companyKey}) gefunden.</span>
        </div>
      </div>
    `;
    lexModalSubmitBtn.disabled = false;
    lexModalSubmitBtn.className = "btn btn-primary px-4 d-flex align-items-center gap-2";
    if (lexModalSubmitText) lexModalSubmitText.innerText = "Upload starten";
  }

  wireModalInternalButtons();
}

function wireModalInternalButtons() {
  if (!lexModalStatusContainer) return;
  lexModalStatusContainer.querySelectorAll(".btn-switch-modal-company").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetComp = btn.getAttribute("data-company");
      if (targetComp && targetComp !== currentSelectedLexCompany) {
        currentSelectedLexCompany = targetComp;
        renderAccountingModalContent();
      }
    });
  });
}

async function checkLexofficeTarget(jobId, companyKey) {
  if (!lexModalSubmitBtn || !lexModalStatusContainer) return;

  currentSelectedLexCompany = companyKey || currentSelectedLexCompany || "thewire";

  lexModalSubmitBtn.disabled = true;
  lexModalStatusContainer.innerHTML = `
    <div class="d-flex align-items-center gap-2 text-muted py-2">
      <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
      <span>Prüfe alle angebundenen Unternehmen & Buchhaltungssysteme auf Belege...</span>
    </div>
  `;

  try {
    const accountingKeys = getClientAccountingKeys();
    const res = await fetch("/api/accounting/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        companyKey: currentSelectedLexCompany,
        credentials: {
          wirewireApiKey: accountingKeys.lexKeyWirewire || "",
          polyxoApiKey: accountingKeys.lexKeyPolyxo || "",
          thewireClient: accountingKeys.butlerClient || "",
          thewireSecret: accountingKeys.butlerSecret || "",
          thewireKey: accountingKeys.butlerKey || "",
        },
      }),
    });

    const data = await res.json();
    currentLexCheckData = data;

    if (!data.success) {
      lexModalStatusContainer.innerHTML = `
        <div class="text-danger d-flex align-items-center gap-2">
          <span class="material-symbols-outlined">error</span>
          <span>Fehler bei der Prüfung: ${data.error || "Unbekannt"}</span>
        </div>
      `;
      lexModalSubmitBtn.disabled = true;
      return;
    }

    renderAccountingModalContent();
  } catch (err) {
    lexModalStatusContainer.innerHTML = `
      <div class="text-danger d-flex align-items-center gap-2">
        <span class="material-symbols-outlined">wifi_off</span>
        <span>Verbindungsfehler: ${err.message}</span>
      </div>
    `;
    lexModalSubmitBtn.disabled = true;
  }
}

if (lexModalSubmitBtn) {
  lexModalSubmitBtn.addEventListener("click", async () => {
    if (!currentLexJobId) return;
    const jobId = currentLexJobId;
    const companyKey = currentSelectedLexCompany || "thewire";
    const isForce = currentLexCheckData && currentLexCheckData.allCompanyChecks && currentLexCheckData.allCompanyChecks[companyKey]?.alreadyTransferred;
    const providerName = (currentLexCheckData?.allCompanyChecks && currentLexCheckData.allCompanyChecks[companyKey]?.providerName) || (companyKey === "thewire" ? "BuchhaltungsButler" : "Lexoffice");

    lexModalSubmitBtn.disabled = true;
    if (lexModalCancelBtn) lexModalCancelBtn.disabled = true;
    lexModalSubmitBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> <span>Wird übertragen...</span>`;
    lexModalStatusContainer.innerHTML = `
      <div class="d-flex align-items-center gap-2 text-primary">
        <div class="spinner-border spinner-border-sm" role="status"></div>
        <span>Lade Beleg zu ${providerName} (<strong>${companyKey}</strong>) hoch...</span>
      </div>
    `;

    try {
      const accountingKeys = getClientAccountingKeys();
      const res = await fetch("/api/accounting/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          companyKey,
          force: isForce,
          apiKey: companyKey === "polyxo" ? accountingKeys.lexKeyPolyxo : accountingKeys.lexKeyWirewire,
          client: accountingKeys.butlerClient,
          secret: accountingKeys.butlerSecret,
          key: accountingKeys.butlerKey,
        }),
      });

      const data = await res.json();
      if (data.success) {
        // Update local jobs
        const updateJobInList = (list) => {
          if (!list) return;
          const target = list.find((j) => j.id === jobId);
          if (target) {
            if (!target.lexofficeTransfers) target.lexofficeTransfers = {};
            target.lexofficeTransfers[companyKey] = {
              provider: data.provider || (companyKey === "thewire" ? "buchhaltungsbutler" : "lexoffice"),
              transferredAt: data.transferredAt,
              fileId: data.fileId || data.lexofficeFileId,
              lexofficeFileId: data.lexofficeFileId || data.fileId,
              company: companyKey,
            };
            target.targetCompany = companyKey;
          }
        };

        updateJobInList(activeJobs);
        updateJobInList(allRechnungenJobs);

        const targetFileId = data.fileId || data.lexofficeFileId;
        lexModalStatusContainer.innerHTML = `
          <div class="p-2 rounded bg-success text-white d-flex align-items-center gap-2">
            <span class="material-symbols-outlined" style="font-size: 22px;">task_alt</span>
            <div><strong>Erfolgreich übertragen!</strong> ${providerName} Beleg-ID: ${targetFileId}</div>
          </div>
        `;
        lexModalSubmitBtn.innerHTML = `<span class="material-symbols-outlined">check</span> <span>Erledigt</span>`;

        renderJobs();
        if (typeof renderRechnungenList === "function") {
          renderRechnungenList();
        }

        setTimeout(() => {
          closeLexofficeModal();
        }, 1500);
      } else {
        lexModalStatusContainer.innerHTML = `
          <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-center gap-2">
            <span class="material-symbols-outlined">error</span>
            <div><strong>Übertragung fehlgeschlagen:</strong> ${data.error || "Unbekannter Fehler"}</div>
          </div>
        `;
        lexModalSubmitBtn.disabled = false;
        if (lexModalCancelBtn) lexModalCancelBtn.disabled = false;
        lexModalSubmitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">cloud_upload</span> <span>Erneut versuchen</span>`;
      }
    } catch (err) {
      lexModalStatusContainer.innerHTML = `
        <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-center gap-2">
          <span class="material-symbols-outlined">wifi_off</span>
          <div><strong>Netzwerkfehler:</strong> ${err.message}</div>
        </div>
      `;
      lexModalSubmitBtn.disabled = false;
      if (lexModalCancelBtn) lexModalCancelBtn.disabled = false;
      lexModalSubmitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">cloud_upload</span> <span>Erneut versuchen</span>`;
    }
  });
}

// --- Accounting Side-by-Side Compare Modal Logic ---
const accountingCompareModal = document.getElementById("accounting-compare-modal");
const compareModalCloseBtn = document.getElementById("compare-modal-close-btn");
const compareModalBackBtn = document.getElementById("compare-modal-back-btn");
const compareModalMarkBtn = document.getElementById("compare-modal-mark-btn");
const compareModalUploadBtn = document.getElementById("compare-modal-upload-btn");

const compareLocalImg = document.getElementById("compare-local-img");
const compareLocalLoading = document.getElementById("compare-local-loading");
const compareRemoteImg = document.getElementById("compare-remote-img");
const compareRemoteLoading = document.getElementById("compare-remote-loading");

const compareLocalInv = document.getElementById("compare-local-inv");
const compareLocalAmt = document.getElementById("compare-local-amt");
const compareLocalDate = document.getElementById("compare-local-date");
const compareLocalComp = document.getElementById("compare-local-comp");

const compareRemoteHeader = document.getElementById("compare-remote-header");
const compareRemoteStatusBadge = document.getElementById("compare-remote-status-badge");
const compareRemoteInv = document.getElementById("compare-remote-inv");
const compareRemoteAmt = document.getElementById("compare-remote-amt");
const compareRemoteDate = document.getElementById("compare-remote-date");
const compareRemoteContact = document.getElementById("compare-remote-contact");

let currentCompareJobId = null;
let currentCompareCompany = null;
let currentCompareMatch = null;

function closeAccountingCompareModal() {
  if (accountingCompareModal) accountingCompareModal.style.display = "none";
  if (compareLocalImg) {
    compareLocalImg.src = "";
    compareLocalImg.style.display = "none";
  }
  if (compareRemoteImg) {
    compareRemoteImg.src = "";
    compareRemoteImg.style.display = "none";
  }
  currentCompareJobId = null;
  currentCompareCompany = null;
  currentCompareMatch = null;
}

function openAccountingCompareModal(jobId, companyKey, matchIndex = 0) {
  if (!currentLexCheckData || !currentLexCheckData.liveSearch || !currentLexCheckData.liveSearch.matches) return;
  const match = currentLexCheckData.liveSearch.matches[matchIndex] || currentLexCheckData.liveSearch.matches[0];
  if (!match) return;

  const doc = currentLexCheckData.documentDetails || {};
  currentCompareJobId = jobId;
  currentCompareCompany = companyKey;
  currentCompareMatch = match;

  // 1. Populate Local Upload Info
  if (compareLocalInv) compareLocalInv.innerHTML = `Rechnung: <strong>${doc.invoiceNumber && doc.invoiceNumber !== 'none' ? doc.invoiceNumber : '-'}</strong>`;
  let amtStr = "-";
  if (doc.invoiceAmmount && doc.invoiceAmmount > 0) {
    amtStr = (doc.invoiceAmmount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }
  if (compareLocalAmt) compareLocalAmt.innerText = `Betrag: ${amtStr}`;
  if (compareLocalDate) compareLocalDate.innerText = `Datum: ${doc.documentDate || '-'}`;
  if (compareLocalComp) compareLocalComp.innerText = `Firma: ${doc.company || '-'}`;

  if (compareLocalLoading) compareLocalLoading.style.display = "flex";
  if (compareLocalImg) {
    compareLocalImg.style.display = "none";
    compareLocalImg.onload = () => {
      if (compareLocalLoading) compareLocalLoading.style.display = "none";
      compareLocalImg.style.display = "block";
    };
    compareLocalImg.onerror = () => {
      // Fallback to thumbnail or Drive link
      if (!compareLocalImg.src.includes("/thumbnail")) {
        compareLocalImg.src = `/api/jobs/${jobId}/thumbnail`;
      } else {
        if (compareLocalLoading) {
          compareLocalLoading.innerHTML = '<span class="material-symbols-outlined text-muted" style="font-size: 40px;">description</span><div class="small mt-2 text-muted">Keine Bildvorschau verfügbar</div>';
        }
      }
    };
    compareLocalImg.src = `/api/jobs/${jobId}/preview?_t=${Date.now()}`;
  }

  // 2. Populate Remote Portal Voucher Info
  const isButler = companyKey === "thewire";
  const providerName = isButler ? "BuchhaltungsButler" : "Lexoffice";

  if (compareRemoteHeader) compareRemoteHeader.innerText = `Beleg in ${providerName} (${companyKey})`;
  if (compareRemoteStatusBadge) {
    compareRemoteStatusBadge.innerText = match.voucherStatus || "vorhanden";
    compareRemoteStatusBadge.className = match.voucherStatus === "paid"
      ? "badge bg-success text-white small"
      : "badge bg-warning text-dark border border-warning-subtle small";
  }

  if (compareRemoteInv) compareRemoteInv.innerHTML = `Beleg-Nr: <strong>${match.voucherNumber && match.voucherNumber !== '-' ? match.voucherNumber : (match.invoiceNumber || match.fileName)}</strong>`;
  if (compareRemoteAmt) compareRemoteAmt.innerText = `Betrag: ${match.totalAmount || match.amount || '-'}`;
  if (compareRemoteDate) compareRemoteDate.innerText = `Datum: ${match.voucherDate || match.date || '-'}`;
  if (compareRemoteContact) compareRemoteContact.innerText = `Kontakt: ${match.contactName || match.partner || '-'}`;

  if (compareRemoteLoading) {
    compareRemoteLoading.style.display = "flex";
    compareRemoteLoading.innerHTML = '<div class="spinner-border spinner-border-sm text-light mb-2" role="status"></div><div class="small">Lade Beleg Seite 1 aus ' + providerName + '...</div>';
  }
  if (compareRemoteImg) {
    compareRemoteImg.style.display = "none";
    if (isButler) {
      if (compareRemoteLoading) {
        compareRemoteLoading.innerHTML = `
          <span class="material-symbols-outlined" style="font-size: 48px; color: #17a2b8;">description</span>
          <h6 class="mt-2 text-white">BuchhaltungsButler Beleg</h6>
          <div class="small text-white-50">Beleg <strong>${match.invoiceNumber || match.fileName}</strong> liegt im Portal vor.</div>
        `;
      }
    } else {
      compareRemoteImg.onload = () => {
        if (compareRemoteLoading) compareRemoteLoading.style.display = "none";
        compareRemoteImg.style.display = "block";
      };
      compareRemoteImg.onerror = () => {
        if (compareRemoteLoading) {
          compareRemoteLoading.innerHTML = '<span class="material-symbols-outlined text-warning" style="font-size: 40px;">warning</span><div class="small mt-2 text-white-50">Vorschau konnte aus Lexoffice nicht gerendert werden</div>';
        }
      };
      const accountingKeys = getClientAccountingKeys();
      const apiKey = companyKey === "polyxo" ? (accountingKeys.lexKeyPolyxo || "") : (accountingKeys.lexKeyWirewire || "");
      compareRemoteImg.src = `/api/accounting/voucher-preview?companyKey=${encodeURIComponent(companyKey)}&voucherId=${encodeURIComponent(match.id)}&apiKey=${encodeURIComponent(apiKey)}&_t=${Date.now()}`;
    }
  }

  if (lexSyncModal) lexSyncModal.style.display = "none";
  if (accountingCompareModal) accountingCompareModal.style.display = "flex";
}

if (compareModalCloseBtn) {
  compareModalCloseBtn.addEventListener("click", closeAccountingCompareModal);
}

if (compareModalBackBtn) {
  compareModalBackBtn.addEventListener("click", () => {
    closeAccountingCompareModal();
    if (lexSyncModal) lexSyncModal.style.display = "flex";
  });
}

if (compareModalMarkBtn) {
  compareModalMarkBtn.addEventListener("click", async () => {
    if (!currentCompareJobId || !currentCompareCompany || !currentCompareMatch) return;
    const jobId = currentCompareJobId;
    const companyKey = currentCompareCompany;
    const fileId = currentCompareMatch.id;

    compareModalMarkBtn.disabled = true;
    compareModalMarkBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> <span>Speichere...</span>`;

    try {
      const res = await fetch("/api/accounting/mark-synced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, companyKey, fileId }),
      });
      const data = await res.json();
      if (data.success) {
        if (typeof showToast === "function") {
          showToast("✓ Beleg erfolgreich als synchronisiert markiert!", "success");
        }
        closeAccountingCompareModal();
        closeLexofficeModal();
        startPolling();
      } else {
        alert("Fehler beim Speichern: " + (data.error || "Unbekannt"));
        compareModalMarkBtn.disabled = false;
      }
    } catch (err) {
      alert("Netzwerkfehler: " + err.message);
      compareModalMarkBtn.disabled = false;
    }
  });
}

if (compareModalUploadBtn) {
  compareModalUploadBtn.addEventListener("click", async () => {
    if (!currentCompareJobId || !currentCompareCompany) return;
    const jobId = currentCompareJobId;
    const companyKey = currentCompareCompany;
    closeAccountingCompareModal();
    if (lexSyncModal) lexSyncModal.style.display = "flex";
    if (lexModalSubmitBtn) {
      lexModalSubmitBtn.click();
    }
  });
}

// --- Duplicate Compare Modal Logic ---
const duplicateCompareModal = document.getElementById("duplicate-compare-modal");
const dupModalCloseBtn = document.getElementById("dup-modal-close-btn");
const dupModalCancelBtn = document.getElementById("dup-modal-cancel-btn");
const dupModalDismissAllBtn = document.getElementById("dup-modal-dismiss-all-btn");
const dupCompareLoading = document.getElementById("dup-compare-loading");
const dupCompareContainer = document.getElementById("dup-compare-container");

let currentDuplicateJobId = null;

function closeDuplicateCompareModal() {
  if (duplicateCompareModal) duplicateCompareModal.style.display = "none";
  if (dupCompareContainer) dupCompareContainer.innerHTML = "";
  currentDuplicateJobId = null;
}

async function openDuplicateCompareModal(jobId) {
  if (!duplicateCompareModal || !dupCompareContainer) return;
  currentDuplicateJobId = jobId;
  duplicateCompareModal.style.display = "flex";
  if (dupCompareLoading) dupCompareLoading.style.display = "block";
  dupCompareContainer.innerHTML = "";

  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/duplicates`);
    const data = await res.json();
    if (dupCompareLoading) dupCompareLoading.style.display = "none";

    if (!data.success || !data.currentJob) {
      dupCompareContainer.innerHTML = `
        <div class="col-12 text-center py-5 text-muted">
          <span class="material-symbols-outlined text-warning" style="font-size: 40px;">warning</span>
          <div class="mt-2">Dokument konnte nicht geladen werden.</div>
        </div>
      `;
      return;
    }

    const cur = data.currentJob;
    const dups = data.duplicates || [];

    const curRes = cur.result || {};
    const curInvNum = curRes.invoiceNumber && curRes.invoiceNumber !== "none" ? curRes.invoiceNumber : (cur.invoiceNumber || "-");
    let curAmtStr = "-";
    if (curRes.invoiceAmmount || cur.invoiceAmmount) {
      curAmtStr = (((curRes.invoiceAmmount || cur.invoiceAmmount) / 100).toFixed(2)).replace(".", ",") + " €";
    }
    const curDate = getValidatedJobDocumentDate(cur).display;
    const curComp = curRes.company || cur.targetCompany || "-";

    const colClass = dups.length === 1 ? "col-12 col-md-6" : (dups.length === 2 ? "col-12 col-md-4" : "col-12 col-md-4");

    let html = `
      <!-- Left: Current Document -->
      <div class="${colClass} d-flex flex-column">
        <div class="card h-100 border shadow-sm" style="border-radius: 12px; background: #fafafa; border-color: #2196f3 !important;">
          <div class="card-header bg-white border-bottom py-2 px-3 d-flex justify-content-between align-items-center">
            <span class="fw-bold text-primary small d-flex align-items-center gap-1">
              <span class="material-symbols-outlined" style="font-size: 18px;">upload_file</span>
              <span>Aktuelles Dokument</span>
            </span>
            <span class="badge bg-primary text-white small">Aktueller Upload</span>
          </div>
          <div class="p-2 px-3 border-bottom bg-light" style="font-size: 12px; line-height: 1.4;">
            <div class="d-flex justify-content-between flex-wrap gap-1">
              <span>Rechnung: <strong>${curInvNum}</strong></span>
              <span class="text-success fw-bold font-monospace">Betrag: ${curAmtStr}</span>
            </div>
            <div class="d-flex justify-content-between flex-wrap gap-1 text-muted mt-1">
              <span>Datum: ${curDate}</span>
              <span>Firma: ${curComp}</span>
            </div>
            <div class="text-truncate text-muted mt-1" style="font-size: 11px;" title="${curRes.full || cur.originalName || '-'}">
              Datei: <em>${curRes.full || cur.originalName || '-'}</em>
            </div>
          </div>
          <div class="card-body p-2 flex-grow-1 d-flex align-items-center justify-content-center" style="min-height: 440px; background: #2b2b2b; overflow: auto; position: relative;">
            <img src="/api/jobs/${encodeURIComponent(cur.id)}/preview?_t=${Date.now()}" alt="Vorschau Aktuelles Dokument" style="height: 480px !important; max-height: 480px !important; width: auto !important; max-width: 100% !important; object-fit: contain !important; align-self: center !important; margin: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.6); border-radius: 4px; background: white;" />
          </div>
          <div class="card-footer bg-white border-top px-2 py-1 d-flex justify-content-between align-items-center flex-wrap gap-1">
            ${cur.result?.webViewLink ? `<a href="${cur.result.webViewLink}" target="_blank" class="btn btn-xs d-inline-flex align-items-center gap-1" style="background: #f8f9fa; color: #495057; border: 1px solid #ced4da; font-size: 10px; padding: 2px 7px; border-radius: 6px; font-weight: 500; text-decoration: none;"><span class="material-symbols-outlined" style="font-size: 13px;">open_in_new</span> <span>In Drive öffnen</span></a>` : `<span></span>`}
            <div class="d-flex align-items-center gap-1">
              <button class="btn btn-xs btn-keep-dup-single d-inline-flex align-items-center gap-1" data-job-id="${cur.id}" style="background: #f8f9fa; color: #2e7d32; border: 1px solid #a5d6a7; font-size: 10px; padding: 2px 7px; border-radius: 6px; font-weight: 500;" title="Beleg behalten & Duplikat-Verdacht entfernen">
                <span class="material-symbols-outlined" style="font-size: 13px;">check</span>
                <span>Behalten</span>
              </button>
              ${window.isAdmin ? `
                <button class="btn btn-xs btn-delete-dup-single d-inline-flex align-items-center gap-1" data-job-id="${cur.id}" style="background: #f8f9fa; color: #c62828; border: 1px solid #ef9a9a; font-size: 10px; padding: 2px 7px; border-radius: 6px; font-weight: 500;" title="Beleg aus der Historie löschen">
                  <span class="material-symbols-outlined" style="font-size: 13px;">delete</span>
                  <span>Löschen</span>
                </button>
              ` : ``}
            </div>
          </div>
        </div>
      </div>
    `;

    if (dups.length === 0) {
      html += `
        <div class="col-12 col-md-6 d-flex flex-column justify-content-center align-items-center py-5">
          <div class="card p-4 text-center border-0 shadow-sm" style="border-radius: 12px; background: #f8f9fa;">
            <span class="material-symbols-outlined text-success mb-2" style="font-size: 48px;">check_circle</span>
            <h6 class="fw-bold">Kein direktes Duplikat mehr im System</h6>
            <p class="text-muted small mb-3">Möglicherweise wurde das frühere Duplikat bereits gelöscht oder archiviert.</p>
            <button class="btn btn-sm btn-keep-dup-single mx-auto d-inline-flex align-items-center gap-1" data-job-id="${cur.id}" style="background: #f8f9fa; color: #2e7d32; border: 1px solid #a5d6a7; font-size: 11px; padding: 4px 10px; border-radius: 6px; font-weight: 500;">
              <span class="material-symbols-outlined" style="font-size: 15px;">check</span>
              <span>Behalten</span>
            </button>
          </div>
        </div>
      `;
    } else {
      dups.forEach((d, idx) => {
        const dupJob = d.job;
        const dupRes = dupJob.result || {};
        const dupInvNum = dupRes.invoiceNumber && dupRes.invoiceNumber !== "none" ? dupRes.invoiceNumber : (dupJob.invoiceNumber || "-");
        let dupAmtStr = "-";
        if (dupRes.invoiceAmmount || dupJob.invoiceAmmount) {
          dupAmtStr = (((dupRes.invoiceAmmount || dupJob.invoiceAmmount) / 100).toFixed(2)).replace(".", ",") + " €";
        }
        const dupDate = getValidatedJobDocumentDate(dupJob).display;
        const dupComp = dupRes.company || dupJob.targetCompany || "-";
        const reasonsHtml = (d.matchReasons || []).map(r => `<span class="badge bg-warning-subtle text-dark border border-warning-subtle small me-1 mb-1">✓ ${r}</span>`).join(" ");

        html += `
          <!-- Duplicate ${idx + 1} -->
          <div class="${colClass} d-flex flex-column">
            <div class="card h-100 border shadow-sm" style="border-radius: 12px; background: #fafafa; border-color: #ff9800 !important;">
              <div class="card-header bg-white border-bottom py-2 px-3 d-flex justify-content-between align-items-center">
                <span class="fw-bold text-warning small d-flex align-items-center gap-1">
                  <span class="material-symbols-outlined text-warning" style="font-size: 18px;">content_copy</span>
                  <span>Mögliches Duplikat ${dups.length > 1 ? '#' + (idx + 1) : ''}</span>
                </span>
                <span class="badge bg-warning text-dark small">Gefunden (${new Date(dupJob.uploadDate || Date.now()).toLocaleDateString("de-DE")})</span>
              </div>
              <div class="p-2 px-3 border-bottom bg-light" style="font-size: 12px; line-height: 1.4;">
                <div class="d-flex justify-content-between flex-wrap gap-1">
                  <span>Rechnung: <strong>${dupInvNum}</strong></span>
                  <span class="text-success fw-bold font-monospace">Betrag: ${dupAmtStr}</span>
                </div>
                <div class="d-flex justify-content-between flex-wrap gap-1 text-muted mt-1">
                  <span>Datum: ${dupDate}</span>
                  <span>Firma: ${dupComp}</span>
                </div>
                <div class="text-truncate text-muted mt-1" style="font-size: 11px;" title="${dupRes.full || dupJob.originalName || '-'}">
                  Datei: <em>${dupRes.full || dupJob.originalName || '-'}</em>
                </div>
                <div class="mt-2 pt-1 border-top" style="font-size: 11px;">
                  <strong class="text-dark">Übereinstimmung:</strong><br>
                  ${reasonsHtml}
                </div>
              </div>
              <div class="card-body p-2 flex-grow-1 d-flex align-items-center justify-content-center" style="min-height: 440px; background: #2b2b2b; overflow: auto; position: relative;">
                <img src="/api/jobs/${encodeURIComponent(dupJob.id)}/preview?_t=${Date.now()}" alt="Vorschau Duplikat" style="height: 480px !important; max-height: 480px !important; width: auto !important; max-width: 100% !important; object-fit: contain !important; align-self: center !important; margin: auto; box-shadow: 0 4px 16px rgba(0,0,0,0.6); border-radius: 4px; background: white;" />
              </div>
              <div class="card-footer bg-white border-top px-2 py-1 d-flex justify-content-between align-items-center flex-wrap gap-1">
                ${dupJob.result?.webViewLink ? `<a href="${dupJob.result.webViewLink}" target="_blank" class="btn btn-xs d-inline-flex align-items-center gap-1" style="background: #f8f9fa; color: #495057; border: 1px solid #ced4da; font-size: 10px; padding: 2px 7px; border-radius: 6px; font-weight: 500; text-decoration: none;"><span class="material-symbols-outlined" style="font-size: 13px;">open_in_new</span> <span>In Drive öffnen</span></a>` : `<span></span>`}
                <div class="d-flex align-items-center gap-1">
                  <button class="btn btn-xs btn-keep-dup-single d-inline-flex align-items-center gap-1" data-job-id="${dupJob.id}" style="background: #f8f9fa; color: #2e7d32; border: 1px solid #a5d6a7; font-size: 10px; padding: 2px 7px; border-radius: 6px; font-weight: 500;" title="Beleg behalten & Duplikat-Verdacht entfernen">
                    <span class="material-symbols-outlined" style="font-size: 13px;">check</span>
                    <span>Behalten</span>
                  </button>
                  ${window.isAdmin ? `
                    <button class="btn btn-xs btn-delete-dup-single d-inline-flex align-items-center gap-1" data-job-id="${dupJob.id}" style="background: #f8f9fa; color: #c62828; border: 1px solid #ef9a9a; font-size: 10px; padding: 2px 7px; border-radius: 6px; font-weight: 500;" title="Beleg aus der Historie löschen">
                      <span class="material-symbols-outlined" style="font-size: 13px;">delete</span>
                      <span>Löschen</span>
                    </button>
                  ` : ``}
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }

    dupCompareContainer.innerHTML = html;
  } catch (err) {
    console.error("[DUP COMPARE] Fehler:", err);
    if (dupCompareLoading) dupCompareLoading.style.display = "none";
    dupCompareContainer.innerHTML = `
      <div class="col-12 text-center py-5 text-danger">
        <span class="material-symbols-outlined" style="font-size: 40px;">error</span>
        <div class="mt-2">Fehler beim Laden der Duplikate: ${err.message}</div>
      </div>
    `;
  }
}

if (dupModalCloseBtn) dupModalCloseBtn.addEventListener("click", closeDuplicateCompareModal);
if (dupModalCancelBtn) dupModalCancelBtn.addEventListener("click", closeDuplicateCompareModal);

// ==========================================
// --- ClickUp Integration & Sync All UI ---
// ==========================================

const testClickUpBtn = document.getElementById("clickup-test-connection-btn");
const clickupTestStatus = document.getElementById("clickup-test-status");

if (testClickUpBtn) {
  testClickUpBtn.addEventListener("click", async () => {
    const apiKey = document.getElementById("clickup-api-key").value.trim();
    const listId = document.getElementById("clickup-list-id").value.trim();

    if (!apiKey) {
      clickupTestStatus.innerHTML = '<span style="color: #dc3545;">⚠️ Bitte geben Sie zuerst einen API-Key ein.</span>';
      return;
    }

    testClickUpBtn.disabled = true;
    testClickUpBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> Prüfe...`;
    clickupTestStatus.innerHTML = '<span style="color: #666;">Verbindung zu ClickUp wird getestet...</span>';

    try {
      const res = await fetch("/api/clickup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, listId }),
      });
      const data = await res.json();

      if (data.success) {
        clickupTestStatus.innerHTML = `
          <span style="color: #198754; font-weight: 500;">
            ✓ Erfolgreich verbunden! Liste: <strong>${data.listName}</strong> (Space: ${data.spaceName || '-'})
          </span>
        `;
      } else {
        clickupTestStatus.innerHTML = `
          <span style="color: #dc3545;">
            ✗ Verbindung fehlgeschlagen: ${data.error || "Unbekannter Fehler"}
          </span>
        `;
      }
    } catch (e) {
      clickupTestStatus.innerHTML = `<span style="color: #dc3545;">✗ Netzwerkfehler: ${e.message}</span>`;
    } finally {
      testClickUpBtn.disabled = false;
      testClickUpBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">sync_alt</span> Verbindung prüfen`;
    }
  });
}

// Single ClickUp Transfer
let pendingClickupTransferJobId = null;
let pendingClickupTransferBtn = null;

async function executeClickupTransfer(jobId, force = false, btn = null) {
  const originalBtnHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" style="width: 12px; height: 12px;"></span> <span>Sende...</span>`;
  }

  try {
    const clickupConfig = getClientClickUpConfig();
    const res = await fetch("/api/clickup/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        force,
        apiKey: clickupConfig.apiKey || "",
        listId: clickupConfig.listId || "",
      }),
    });

    const data = await res.json();

    if (data.alreadyTransferred && !force) {
      pendingClickupTransferJobId = jobId;
      pendingClickupTransferBtn = btn;
      const targetJob = activeJobs.find((j) => j.id === jobId) || (allRechnungenJobs && allRechnungenJobs.find((j) => j.id === jobId));
      const cu = data.clickup || targetJob?.clickup;
      const taskId = cu?.taskId;
      const taskUrl = cu?.taskUrl || (taskId ? `https://app.clickup.com/t/${taskId}` : "");

      const textEl = document.getElementById("confirm-clickup-text");
      if (textEl) {
        textEl.innerText = data.error || "Dieses Dokument wurde bereits an ClickUp übertragen. Möchtest du es aktualisieren?";
      }

      const linkContainer = document.getElementById("confirm-clickup-link-container");
      const taskLink = document.getElementById("confirm-clickup-task-link");
      const taskIdBadge = document.getElementById("confirm-clickup-task-id-badge");

      if (linkContainer && taskLink) {
        if (taskId || taskUrl) {
          linkContainer.style.display = "block";
          taskLink.href = taskUrl || `https://app.clickup.com/t/${taskId}`;
          if (taskIdBadge) taskIdBadge.innerText = `#${taskId || ""}`;
        } else {
          linkContainer.style.display = "none";
        }
      }

      document.getElementById("confirm-clickup-modal").style.display = "flex";
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
      }
      return;
    }

    if (data.success) {
      // Update local job state
      const targetJob = activeJobs.find((j) => j.id === jobId) || (allRechnungenJobs && allRechnungenJobs.find((j) => j.id === jobId));
      if (targetJob) {
        targetJob.clickup = data.clickup;
      }
      renderJobs();
      if (typeof renderRechnungenList === "function") renderRechnungenList();
    } else {
      alert("ClickUp Übertragung fehlgeschlagen: " + (data.error || "Unbekannter Fehler"));
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
      }
    }
  } catch (err) {
    alert("Fehler bei ClickUp-Übertragung: " + err.message);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnHtml;
    }
  }
}

// Modal handlers for single ClickUp transfer
const cancelClickupBtn = document.getElementById("cancel-clickup-transfer-btn");
const closeClickupXBtn = document.getElementById("close-clickup-modal-x");
const confirmClickupBtn = document.getElementById("confirm-clickup-transfer-btn");
const confirmClickupModal = document.getElementById("confirm-clickup-modal");

const hideClickupConfirmModal = () => {
  if (confirmClickupModal) confirmClickupModal.style.display = "none";
  if (pendingClickupTransferBtn) {
    pendingClickupTransferBtn.disabled = false;
    renderJobs();
    if (typeof renderRechnungenList === "function") renderRechnungenList();
  }
  pendingClickupTransferJobId = null;
  pendingClickupTransferBtn = null;
};

if (cancelClickupBtn) cancelClickupBtn.addEventListener("click", hideClickupConfirmModal);
if (closeClickupXBtn) closeClickupXBtn.addEventListener("click", hideClickupConfirmModal);
if (confirmClickupModal) {
  confirmClickupModal.addEventListener("click", (e) => {
    if (e.target === confirmClickupModal) hideClickupConfirmModal();
  });
}

if (confirmClickupBtn) {
  confirmClickupBtn.addEventListener("click", async () => {
    hideClickupConfirmModal();
    if (pendingClickupTransferJobId) {
      const jobId = pendingClickupTransferJobId;
      const btn = pendingClickupTransferBtn;
      pendingClickupTransferJobId = null;
      pendingClickupTransferBtn = null;
      await executeClickupTransfer(jobId, true, btn);
    }
  });
}

// Click listener delegation for manual transfer buttons (ClickUp & Lexoffice) & details toggle
document.addEventListener("click", (e) => {
  const toggleDetailsBtn = e.target.closest(".btn-toggle-details");
  if (toggleDetailsBtn) {
    const jobId = toggleDetailsBtn.getAttribute("data-job-id");
    const container = toggleDetailsBtn.closest("div")?.parentElement;
    const detailsEl = container ? container.querySelector(`details.job-result[data-job-id="${jobId}"]`) : null;
    if (detailsEl) {
      detailsEl.open = !detailsEl.open;
      openStates[jobId] = detailsEl.open;
    }
    return;
  }

  const clickupBtn = e.target.closest(".btn-manual-clickup-transfer") || e.target.closest(".rechnung-clickup-btn");
  if (clickupBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = clickupBtn.getAttribute("data-job-id") || clickupBtn.closest("[data-job-id]")?.getAttribute("data-job-id") || (activeJobs.find(j => clickupBtn.closest(".job-item") && clickupBtn.closest(".job-item").innerHTML.includes(j.originalName))?.id);
    if (jobId) {
      executeClickupTransfer(jobId, false, clickupBtn);
    }
    return;
  }

  const lexofficeBtn = e.target.closest(".btn-manual-lexoffice-sync") || e.target.closest(".rechnung-lexoffice-btn");
  if (lexofficeBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = lexofficeBtn.getAttribute("data-job-id") || lexofficeBtn.closest("[data-job-id]")?.getAttribute("data-job-id") || (activeJobs.find(j => lexofficeBtn.closest(".job-item") && lexofficeBtn.closest(".job-item").innerHTML.includes(j.originalName))?.id);
    if (jobId) {
      openLexofficeSyncModal(jobId);
    }
    return;
  }

  const compareBtn = e.target.closest(".btn-open-compare-modal");
  if (compareBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = compareBtn.getAttribute("data-job-id");
    const companyKey = compareBtn.getAttribute("data-company");
    const matchIdx = parseInt(compareBtn.getAttribute("data-match-index") || "0", 10);
    openAccountingCompareModal(jobId, companyKey, matchIdx);
    return;
  }

  const switchCompBtn = e.target.closest(".btn-switch-modal-company") || e.target.closest(".company-select-badge") || e.target.closest(".company-check-badge");
  if (switchCompBtn) {
    e.stopPropagation();
    e.preventDefault();
    const targetComp = switchCompBtn.getAttribute("data-company");
    if (targetComp && targetComp !== currentSelectedLexCompany) {
      currentSelectedLexCompany = targetComp;
      if (currentLexCheckData) {
        renderAccountingModalContent();
      } else if (currentLexJobId) {
        checkLexofficeTarget(currentLexJobId, targetComp);
      }
    }
    return;
  }

  const markSyncedBtn = e.target.closest(".btn-mark-synced-direct");
  if (markSyncedBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = markSyncedBtn.getAttribute("data-job-id");
    const companyKey = markSyncedBtn.getAttribute("data-company");
    const fileId = markSyncedBtn.getAttribute("data-file-id");

    markSyncedBtn.disabled = true;
    markSyncedBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> <span>Speichere...</span>`;

    fetch("/api/accounting/mark-synced", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, companyKey, fileId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          if (typeof showToast === "function") {
            showToast("✓ Beleg erfolgreich als synchronisiert markiert!", "success");
          }
          closeLexofficeModal();
          startPolling();
        } else {
          alert("Fehler beim Speichern: " + (data.error || "Unbekannt"));
          markSyncedBtn.disabled = false;
        }
      })
      .catch((err) => {
        alert("Netzwerkfehler: " + err.message);
        markSyncedBtn.disabled = false;
      });
    return;
  }

  const dupBadge = e.target.closest(".badge-open-duplicate-compare");
  if (dupBadge) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = dupBadge.getAttribute("data-job-id");
    if (jobId) {
      openDuplicateCompareModal(jobId);
    }
    return;
  }

  const keepDupBtn = e.target.closest(".btn-keep-dup-single");
  if (keepDupBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = keepDupBtn.getAttribute("data-job-id");
    if (jobId) {
      keepDupBtn.disabled = true;
      // Duplikat-Verdacht aufheben & Entscheidung merken (Datei bleibt in der Hauptliste sichtbar!)
      fetch(`/api/jobs/${encodeURIComponent(jobId)}/dismiss-duplicate`, { method: "POST" })
        .then((r) => r.json())
        .then(async (data) => {
          if (typeof showToast === "function") showToast("✓ Beleg behalten & Duplikat-Verdacht entfernt.", "success");

          // Frischen Status aller Jobs vom Server holen, damit Gegen-Jobs mit aktualisiert werden
          try {
            const statusRes = await fetch("/api/status?ids=all");
            const statusJson = await statusRes.json();
            if (statusJson.success && statusJson.statuses) {
              activeJobs = statusJson.statuses;
            }
          } catch (e) {}

          renderJobs();

          if (jobId === currentDuplicateJobId) {
            closeDuplicateCompareModal();
          } else if (currentDuplicateJobId) {
            openDuplicateCompareModal(currentDuplicateJobId);
          } else {
            closeDuplicateCompareModal();
          }
        })
        .catch((err) => alert("Fehler: " + err.message));
    }
    return;
  }

  const deleteDupBtn = e.target.closest(".btn-delete-dup-single");
  if (deleteDupBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = deleteDupBtn.getAttribute("data-job-id");
    if (jobId) {
      if (confirm("Möchten Sie dieses Duplikat wirklich aus der Historie löschen?")) {
        deleteDupBtn.disabled = true;
        fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" })
          .then((r) => r.json())
          .then((data) => {
            if (data.success) {
              if (typeof showToast === "function") showToast("✓ Duplikat erfolgreich gelöscht.", "success");
              if (currentDuplicateJobId) {
                openDuplicateCompareModal(currentDuplicateJobId);
              } else {
                closeDuplicateCompareModal();
              }
              startPolling();
            } else {
              alert("Fehler beim Löschen: " + (data.error || "Unbekannt"));
              deleteDupBtn.disabled = false;
            }
          })
          .catch((err) => {
            alert("Netzwerkfehler: " + err.message);
            deleteDupBtn.disabled = false;
          });
      }
    }
    return;
  }

  const retryBtn = e.target.closest(".retry-job-btn");
  if (retryBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = retryBtn.getAttribute("data-job-id");
    if (jobId) {
      retryBtn.disabled = true;
      retryBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" style="width: 12px; height: 12px;"></span>`;
      fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            if (typeof showToast === "function") showToast("✓ Job wird erneut verarbeitet.", "info");
            updateStatus();
          } else {
            alert("Fehler beim Wiederholen: " + (data.error || "Unbekannt"));
            retryBtn.disabled = false;
            retryBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">replay</span> Wiederholen`;
          }
        })
        .catch((err) => {
          alert("Netzwerkfehler: " + err.message);
          retryBtn.disabled = false;
          retryBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">replay</span> Wiederholen`;
        });
    }
    return;
  }

  const cancelJobBtn = e.target.closest(".cancel-job-btn");
  if (cancelJobBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = cancelJobBtn.getAttribute("data-job-id");
    if (jobId) {
      if (confirm("Möchten Sie diesen Auftrag wirklich aus der Warteschlange abbrechen und löschen?")) {
        cancelJobBtn.disabled = true;
        cancelJobBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" style="width: 12px; height: 12px;"></span>`;
        fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" })
          .then((r) => r.json())
          .then((data) => {
            if (data.success) {
              if (typeof showToast === "function") showToast("✓ Auftrag aus Warteschlange gelöscht.", "info");
              fetchStatus();
            } else {
              alert("Fehler beim Abbrechen: " + (data.error || "Unbekannt"));
              cancelJobBtn.disabled = false;
              cancelJobBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 13px;">close</span> Abbrechen`;
            }
          })
          .catch((err) => {
            alert("Netzwerkfehler: " + err.message);
            cancelJobBtn.disabled = false;
            cancelJobBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 13px;">close</span> Abbrechen`;
          });
      }
    }
    return;
  }
});

// --- ClickUp Sync All Review Modal Logic ---
const triggerSyncModalBtn = document.getElementById("clickup-trigger-sync-btn");
const clickupSyncModal = document.getElementById("clickup-sync-modal");
const closeSyncModalBtn = document.getElementById("close-clickup-sync-btn");
const cancelSyncModalBtn = document.getElementById("cancel-clickup-sync-btn");
const confirmSyncModalBtn = document.getElementById("confirm-clickup-sync-btn");

const countCreateSpan = document.getElementById("clickup-count-create");
const countUpdateSpan = document.getElementById("clickup-count-update");
const countUptodateSpan = document.getElementById("clickup-count-uptodate");
const countSkipSpan = document.getElementById("clickup-count-skip");
const syncItemsList = document.getElementById("clickup-sync-items-list");
const syncProgressContainer = document.getElementById("clickup-sync-progress-container");
const syncProgressBar = document.getElementById("clickup-sync-progress-bar");
const syncProgressText = document.getElementById("clickup-sync-progress-text");
const syncProgressPercent = document.getElementById("clickup-sync-progress-percent");

let currentSyncPreviewData = null;
let currentSyncFilter = "all";

function renderSyncPreviewItems() {
  if (!currentSyncPreviewData) return;
  const { toCreate = [], toUpdate = [], upToDate = [], toSkip = [] } = currentSyncPreviewData;

  if (countCreateSpan) countCreateSpan.innerText = toCreate.length;
  if (countUpdateSpan) countUpdateSpan.innerText = toUpdate.length;
  if (countUptodateSpan) countUptodateSpan.innerText = upToDate.length;
  if (countSkipSpan) countSkipSpan.innerText = toSkip.length;

  let itemsToRender = [];
  if (currentSyncFilter === "all" || currentSyncFilter === "create") {
    toCreate.forEach((item) => itemsToRender.push({ ...item, type: "create" }));
  }
  if (currentSyncFilter === "all" || currentSyncFilter === "update") {
    toUpdate.forEach((item) => itemsToRender.push({ ...item, type: "update" }));
  }
  if (currentSyncFilter === "all" || currentSyncFilter === "uptodate") {
    upToDate.forEach((item) => itemsToRender.push({ ...item, type: "uptodate" }));
  }
  if (currentSyncFilter === "all" || currentSyncFilter === "skip") {
    toSkip.forEach((item) => itemsToRender.push({ ...item, type: "skip" }));
  }

  if (itemsToRender.length === 0) {
    syncItemsList.innerHTML = '<div style="text-align: center; color: #888; padding: 30px;">Keine Dokumente für diesen Filter gefunden.</div>';
    return;
  }

  let html = "";
  itemsToRender.forEach((item) => {
    let badgeHtml = "";
    let actionInfoHtml = "";

    const safeFileName = escapeHtml(item.fileName || "-");
    const safeCompany = escapeHtml(item.company || "Unbekannt");
    const safeCategory = escapeHtml(item.category || "-");
    const safeAmount = item.amount ? escapeHtml(item.amount) : "";
    const safeTaskName = escapeHtml(item.suggestedTaskName || item.fileName || "-");
    const safeExistingTaskId = escapeHtml(item.existingTaskId || "");
    const safeExistingTaskName = escapeHtml(item.existingTaskName || "");
    const safeExistingTaskUrl = item.existingTaskUrl ? encodeURI(item.existingTaskUrl) : "#";
    const safeStatus = escapeHtml(item.existingTaskStatus || "offen");
    const safeReason = escapeHtml(item.reason || "Privat");

    if (item.type === "create") {
      badgeHtml = `<span style="background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">+ Neu anlegen</span>`;
      actionInfoHtml = `<span style="color: #666; font-size: 12px;">Vorgeschlagener Task: <strong>${safeTaskName}</strong></span>`;
    } else if (item.type === "update") {
      badgeHtml = `<span style="background: #e3f2fd; color: #1565c0; border: 1px solid #bbdefb; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">↻ Aktualisieren</span>`;
      actionInfoHtml = `<span style="color: #666; font-size: 12px;">Aktualisiert Task: <a href="${safeExistingTaskUrl}" target="_blank" style="color: #1976d2; font-weight: 500;">#${safeExistingTaskId} (${safeExistingTaskName})</a></span>`;
    } else if (item.type === "uptodate") {
      badgeHtml = `<span style="background: #f3e5f5; color: #7b1fa2; border: 1px solid #e1bee7; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">✓ Bereits aktuell</span>`;
      actionInfoHtml = `<span style="color: #7b1fa2; font-size: 12px;">Task ist synchron: <a href="${safeExistingTaskUrl}" target="_blank" style="color: #7b1fa2; font-weight: 500;">#${safeExistingTaskId} (${safeExistingTaskName})</a> <span style="color: #888;">[Status: ${safeStatus}]</span></span>`;
    } else if (item.type === "skip") {
      badgeHtml = `<span style="background: #fff3e0; color: #e65100; border: 1px solid #ffe0b2; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">⊘ Überspringen</span>`;
      actionInfoHtml = `<span style="color: #e65100; font-size: 12px;">${safeReason}</span>`;
    }

    html += `
      <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px 12px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px; flex-wrap: wrap;">
            ${badgeHtml}
            <span style="font-weight: 600; font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeFileName}">${safeFileName}</span>
          </div>
          <div style="display: flex; gap: 12px; font-size: 12px; color: #777; flex-wrap: wrap; margin-top: 2px;">
            <span>🏢 ${safeCompany}</span>
            <span>📁 ${safeCategory}</span>
            ${safeAmount ? `<span style="color: #2e7d32; font-weight: 500;">💰 ${safeAmount}</span>` : ''}
          </div>
          <div style="margin-top: 4px;">
            ${actionInfoHtml}
          </div>
        </div>
      </div>
    `;
  });

  syncItemsList.innerHTML = html;
}

if (triggerSyncModalBtn) {
  triggerSyncModalBtn.addEventListener("click", async () => {
    clickupSyncModal.style.display = "flex";
    syncItemsList.innerHTML = '<div style="text-align: center; color: #888; padding: 30px;"><div class="spinner-border spinner-border-sm text-primary mb-2" role="status"></div><br>Lade Sync-Vorschau aus ClickUp...</div>';
    confirmSyncModalBtn.disabled = true;
    syncProgressContainer.style.display = "none";

    try {
      const clickupConfig = getClientClickUpConfig();
      if (!clickupConfig.apiKey) {
        syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Kein ClickUp API-Key hinterlegt. Bitte hinterlegen Sie Ihren API-Key in den Einstellungen.</div>`;
        return;
      }

      const res = await fetch("/api/clickup/sync-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: clickupConfig.apiKey || "",
          listId: clickupConfig.listId || "",
          filterPrivate: clickupConfig.filterPrivate !== undefined ? clickupConfig.filterPrivate : true,
        }),
      });
      const data = await res.json();

      if (data.success) {
        currentSyncPreviewData = data;
        currentSyncFilter = "all";
        renderSyncPreviewItems();
        confirmSyncModalBtn.disabled = (data.toCreate.length === 0 && data.toUpdate.length === 0);
      } else {
        syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Fehler beim Laden der Vorschau: ${data.error || "Unbekannt"}</div>`;
      }
    } catch (e) {
      syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Netzwerkfehler: ${e.message}</div>`;
    }
  });
}

// Modal tab listeners
["all", "create", "update", "uptodate", "skip"].forEach((tabKey) => {
  const tabBtn = document.getElementById(`clickup-tab-${tabKey}`);
  if (tabBtn) {
    tabBtn.addEventListener("click", () => {
      document.querySelectorAll("[id^='clickup-tab-']").forEach((b) => b.classList.remove("active"));
      tabBtn.classList.add("active");
      currentSyncFilter = tabKey;
      renderSyncPreviewItems();
    });
  }
});

// Close modal handlers
const closeSyncModal = () => {
  clickupSyncModal.style.display = "none";
  currentSyncPreviewData = null;
};

if (closeSyncModalBtn) closeSyncModalBtn.addEventListener("click", closeSyncModal);
if (cancelSyncModalBtn) cancelSyncModalBtn.addEventListener("click", closeSyncModal);

// Start batch synchronization
if (confirmSyncModalBtn) {
  confirmSyncModalBtn.addEventListener("click", async () => {
    if (!currentSyncPreviewData) return;

    confirmSyncModalBtn.disabled = true;
    cancelSyncModalBtn.disabled = true;
    syncProgressContainer.style.display = "block";
    syncProgressBar.style.width = "15%";
    syncProgressPercent.innerText = "15%";
    syncProgressText.innerText = "Synchronisiere Dokumente mit ClickUp...";

    try {
      // Simulate progress progression for smooth UX
      const progressTimer = setInterval(() => {
        const currentW = parseInt(syncProgressBar.style.width, 10) || 15;
        if (currentW < 90) {
          syncProgressBar.style.width = `${currentW + 5}%`;
          syncProgressPercent.innerText = `${currentW + 5}%`;
        }
      }, 500);

      const clickupConfig = getClientClickUpConfig();
      const res = await fetch("/api/clickup/sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: clickupConfig.apiKey || "",
          listId: clickupConfig.listId || "",
          filterPrivate: clickupConfig.filterPrivate !== undefined ? clickupConfig.filterPrivate : true,
        }),
      });

      clearInterval(progressTimer);
      syncProgressBar.style.width = "100%";
      syncProgressPercent.innerText = "100%";

      const data = await res.json();

      if (data.success) {
        syncProgressText.innerText = "Synchronisation erfolgreich abgeschlossen!";
        setTimeout(() => {
          alert(`ClickUp Synchronisation erfolgreich abgeschlossen!\n\n• ${data.createdCount} neu angelegt\n• ${data.updatedCount} aktualisiert\n• ${data.skippedCount} übersprungen`);
          closeSyncModal();
          startPolling();
          if (typeof renderRechnungenList === "function") renderRechnungenList();
        }, 500);
      } else {
        alert("Synchronisation fehlgeschlagen: " + (data.error || "Unbekannter Fehler"));
        confirmSyncModalBtn.disabled = false;
        cancelSyncModalBtn.disabled = false;
      }
    } catch (e) {
      alert("Fehler bei der Synchronisation: " + e.message);
      confirmSyncModalBtn.disabled = false;
      cancelSyncModalBtn.disabled = false;
    }
  });
}

// ==========================================
// --- Startseite Filter Event Listeners ---
// ==========================================

const startSearchInput = document.getElementById("start-search-input");
const searchClearBtn = document.getElementById("search-clear-btn");
const startSortSelect = document.getElementById("start-sort-select");
const startFilterDate = document.getElementById("start-filter-date");
const startFilterCompany = document.getElementById("start-filter-company");
const startResetFiltersBtn = document.getElementById("start-reset-filters-btn");
const toggleShowHiddenBtn = document.getElementById("toggle-show-hidden-btn");
const hiddenJobsCountEl = document.getElementById("hidden-jobs-count");

function updateHiddenJobsCounter() {
  const hiddenCount = (activeJobs || []).filter((j) => j.isHidden === true).length;
  if (hiddenJobsCountEl) hiddenJobsCountEl.innerText = hiddenCount;
  if (toggleShowHiddenBtn) {
    if (window.showHiddenJobs) {
      toggleShowHiddenBtn.classList.add("btn-primary");
      toggleShowHiddenBtn.classList.remove("btn-outline-secondary");
      toggleShowHiddenBtn.innerHTML = `
        <span class="material-symbols-outlined" style="font-size: 15px;">visibility</span>
        <span>Ausgeblendete (${hiddenCount})</span>
      `;
    } else {
      toggleShowHiddenBtn.classList.remove("btn-primary");
      toggleShowHiddenBtn.classList.add("btn-outline-secondary");
      toggleShowHiddenBtn.innerHTML = `
        <span class="material-symbols-outlined" style="font-size: 15px;">visibility_off</span>
        <span>Ausgeblendete (${hiddenCount})</span>
      `;
    }
  }
}

if (toggleShowHiddenBtn) {
  toggleShowHiddenBtn.addEventListener("click", () => {
    window.showHiddenJobs = !window.showHiddenJobs;
    startCurrentPage = 1;
    updateHiddenJobsCounter();
    renderJobs();
  });
}

if (startSortSelect) {
  startSortSelect.addEventListener("change", (e) => {
    startSortOrder = e.target.value;
    startCurrentPage = 1;
    renderJobs();
  });
}

if (startSearchInput) {
  startSearchInput.addEventListener("input", (e) => {
    startSearchQuery = e.target.value.trim();
    startCurrentPage = 1;
    if (searchClearBtn) {
      searchClearBtn.style.display = startSearchQuery ? "inline-flex" : "none";
    }

    // 1. Instant local filter
    renderJobs();

    // 2. Debounced deep OCR / fulltext search
    clearTimeout(deepSearchDebounceTimer);
    if (startSearchQuery.length >= 2) {
      setSearchIconSpinning(true);
      deepSearchDebounceTimer = setTimeout(() => {
        runDeepSearch(startSearchQuery);
      }, 350);
    } else {
      deepSearchSnippetsMap.clear();
      driveOnlySearchResults = [];
      setSearchIconSpinning(false);
      renderJobs();
    }
  });

  startSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(deepSearchDebounceTimer);
      if (startSearchQuery.length >= 2) {
        runDeepSearch(startSearchQuery);
      }
    }
  });
}

if (searchClearBtn) {
  searchClearBtn.addEventListener("click", () => {
    if (startSearchInput) startSearchInput.value = "";
    startSearchQuery = "";
    startCurrentPage = 1;
    deepSearchSnippetsMap.clear();
    driveOnlySearchResults = [];
    searchClearBtn.style.display = "none";
    setSearchIconSpinning(false);
    renderJobs();
  });
}

if (startFilterDate) {
  startFilterDate.addEventListener("change", (e) => {
    startDateFilter = e.target.value;
    startCurrentPage = 1;
    renderJobs();
  });
}

if (startFilterCompany) {
  startFilterCompany.addEventListener("change", (e) => {
    startCompanyFilter = e.target.value;
    startCurrentPage = 1;
    renderJobs();
  });
}

if (startResetFiltersBtn) {
  startResetFiltersBtn.addEventListener("click", () => {
    startSearchQuery = "";
    startSortOrder = "docdate_desc";
    startDateFilter = "alle";
    startCompanyFilter = "alle";
    startSelectedCategories.clear();
    startCurrentPage = 1;
    deepSearchSnippetsMap.clear();
    driveOnlySearchResults = [];

    if (startSearchInput) startSearchInput.value = "";
    if (searchClearBtn) searchClearBtn.style.display = "none";
    if (startSortSelect) startSortSelect.value = "docdate_desc";
    if (startFilterDate) startFilterDate.value = "alle";
    if (startFilterCompany) startFilterCompany.value = "alle";

    setSearchIconSpinning(false);
    renderStartCategoryBubbles();
    renderJobs();
  });
}

// ==========================================
// --- Google Drive Sync Review Modal ---
// ==========================================

const openDriveSyncBtn = document.getElementById("openDriveSyncBtn");
const driveSyncModal = document.getElementById("drive-sync-modal");
const driveSyncCloseXBtn = document.getElementById("drive-sync-close-x-btn");
const driveSyncCloseBtn = document.getElementById("drive-sync-close-btn");
const driveSyncSubmitBtn = document.getElementById("drive-sync-submit-btn");
const driveSyncSubmitText = document.getElementById("drive-sync-submit-text");
const driveSyncSelectAll = document.getElementById("drive-sync-select-all");

const driveCountNew = document.getElementById("drive-count-new");
const driveCountEnrich = document.getElementById("drive-count-enrich");
const driveCountExisting = document.getElementById("drive-count-existing");
const driveCountTotal = document.getElementById("drive-count-total");
const driveSyncList = document.getElementById("drive-sync-list");
const driveSyncLoading = document.getElementById("drive-sync-loading");

const driveSyncProgressBox = document.getElementById("drive-sync-progress-box");
const driveSyncProgressBar = document.getElementById("drive-sync-progress-bar");
const driveSyncProgressStatus = document.getElementById("drive-sync-progress-status");
const driveSyncProgressCounter = document.getElementById("drive-sync-progress-counter");

let driveSyncData = null;
let currentDriveFilter = "all";
let driveSelectedIds = new Set();
let driveBackgroundPoller = null;

function closeDriveSyncModal() {
  console.log("[DRIVE SYNC] closeDriveSyncModal called");
  if (driveSyncModal) driveSyncModal.style.display = "none";
}

if (openDriveSyncBtn) {
  openDriveSyncBtn.addEventListener("click", () => {
    console.log("[DRIVE SYNC] Button 'openDriveSyncBtn' clicked!");
    openDriveSyncModal();
  });
} else {
  console.warn("[DRIVE SYNC] openDriveSyncBtn element NOT found in DOM!");
}

if (driveSyncCloseXBtn) driveSyncCloseXBtn.addEventListener("click", closeDriveSyncModal);
if (driveSyncCloseBtn) driveSyncCloseBtn.addEventListener("click", closeDriveSyncModal);

async function openDriveSyncModal() {
  console.log("[DRIVE SYNC] openDriveSyncModal() invoked. Modal element:", driveSyncModal);
  if (!driveSyncModal) {
    alert("Fehler: drive-sync-modal wurde im DOM nicht gefunden.");
    return;
  }

  // Schließe Einstellungen-Modal, falls geöffnet
  const settingsModalEl = document.getElementById("settings-modal");
  if (settingsModalEl) settingsModalEl.style.display = "none";

  driveSyncModal.style.setProperty("display", "flex", "important");
  driveSyncModal.style.setProperty("z-index", "2500", "important");

  if (driveSyncLoading) driveSyncLoading.style.display = "block";
  if (driveSyncList) driveSyncList.style.display = "none";
  if (driveSyncProgressBox) driveSyncProgressBox.style.display = "none";
  if (driveSyncSubmitBtn) driveSyncSubmitBtn.disabled = true;

  try {
    console.log("[DRIVE SYNC] Fetching /api/drive/sync-preview ...");
    const res = await fetch("/api/drive/sync-preview");
    console.log("[DRIVE SYNC] Preview fetch status:", res.status);
    const data = await res.json();
    console.log("[DRIVE SYNC] Preview data received:", data);

    if (!data.success) {
      alert("Fehler bei Drive-Vorschau: " + (data.error || "Unbekannter Fehler"));
      closeDriveSyncModal();
      return;
    }

    driveSyncData = data;
    currentDriveFilter = "all";

    // Auto-select all new & needsEnrichment by default
    driveSelectedIds = new Set([
      ...(data.toImport || []).map(i => i.id),
      ...(data.needsEnrichment || []).map(i => i.id)
    ]);

    console.log(`[DRIVE SYNC] Rendering modal with ${driveSelectedIds.size} pre-selected items.`);
    renderDriveSyncModal();
  } catch (err) {
    console.error("[DRIVE SYNC] Error in openDriveSyncModal:", err);
    alert("Fehler beim Laden der Google Drive Daten: " + err.message);
    closeDriveSyncModal();
  }
}

function getVisibleDriveItems() {
  if (!driveSyncData) return [];
  const { toImport = [], needsEnrichment = [], existingComplete = [], skipped = [] } = driveSyncData;
  let items = [];
  if (currentDriveFilter === "all") {
    toImport.forEach(i => items.push({ ...i, categoryType: "new" }));
    needsEnrichment.forEach(i => items.push({ ...i, categoryType: "enrich" }));
    existingComplete.forEach(i => items.push({ ...i, categoryType: "complete" }));
  } else if (currentDriveFilter === "new") {
    toImport.forEach(i => items.push({ ...i, categoryType: "new" }));
  } else if (currentDriveFilter === "enrich") {
    needsEnrichment.forEach(i => items.push({ ...i, categoryType: "enrich" }));
  } else if (currentDriveFilter === "complete") {
    existingComplete.forEach(i => items.push({ ...i, categoryType: "complete" }));
  } else if (currentDriveFilter === "skipped") {
    skipped.forEach(i => items.push({ ...i, categoryType: "skipped" }));
  }
  return items;
}

function renderDriveSyncModal() {
  if (!driveSyncData) return;
  const { toImport = [], needsEnrichment = [], existingComplete = [], skipped = [], totalDriveFiles = 0 } = driveSyncData;

  if (driveCountNew) driveCountNew.innerText = toImport.length;
  if (driveCountEnrich) driveCountEnrich.innerText = needsEnrichment.length;
  if (driveCountExisting) driveCountExisting.innerText = existingComplete.length;
  if (driveCountTotal) driveCountTotal.innerText = totalDriveFiles;
  const driveCountSkippedEl = document.getElementById("drive-count-skipped");
  if (driveCountSkippedEl) driveCountSkippedEl.innerText = skipped.length;

  if (driveSyncLoading) driveSyncLoading.style.display = "none";
  if (driveSyncList) driveSyncList.style.display = "block";

  const items = getVisibleDriveItems();

  // Update Select All Checkbox state for visible items
  if (driveSyncSelectAll) {
    const visibleSelectedCount = items.filter(i => driveSelectedIds.has(i.id)).length;
    driveSyncSelectAll.checked = items.length > 0 && visibleSelectedCount === items.length;
    driveSyncSelectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < items.length;
  }

  if (items.length === 0) {
    driveSyncList.innerHTML = '<div class="text-center text-muted py-4">Keine Dateien in dieser Ansicht.</div>';
    updateDriveSubmitButton();
    return;
  }

  let html = "";
  items.forEach(item => {
    const isChecked = driveSelectedIds.has(item.id);
    let badgeHtml = "";
    let pipelineBadgeHtml = "";
    let actionBtnHtml = "";

    if (item.categoryType === "new") {
      badgeHtml = `<span class="badge bg-success-subtle text-success border border-success-subtle">+ Neu (Fehlt in DB)</span>`;
      pipelineBadgeHtml = `<span class="badge text-white" style="background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 12px; font-size: 11px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 3px;" title="Wird nach Sync durch die KI-Pipeline analysiert & angereichert"><span class="material-symbols-outlined" style="font-size: 12px;">auto_awesome</span> In KI-Pipeline</span>`;
      actionBtnHtml = `
        <button type="button" class="btn btn-xs btn-outline-secondary d-inline-flex align-items-center gap-1 btn-drive-ignore" data-id="${item.id}" style="font-size: 11px; padding: 2px 8px; border-radius: 6px;" title="Diese Datei dauerhaft vom Sync ausschließen">
          <span class="material-symbols-outlined" style="font-size: 13px;">visibility_off</span>
          <span>Ausblenden</span>
        </button>
      `;
    } else if (item.categoryType === "enrich") {
      badgeHtml = `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">⚠️ Metadaten unvollständig</span>`;
      pipelineBadgeHtml = `<span class="badge text-white" style="background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 12px; font-size: 11px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 3px;" title="Wird nach Sync durch die KI-Pipeline analysiert & angereichert"><span class="material-symbols-outlined" style="font-size: 12px;">auto_awesome</span> In KI-Pipeline</span>`;
      actionBtnHtml = `
        <button type="button" class="btn btn-xs btn-outline-secondary d-inline-flex align-items-center gap-1 btn-drive-ignore" data-id="${item.id}" style="font-size: 11px; padding: 2px 8px; border-radius: 6px;" title="Diese Datei dauerhaft vom Sync ausschließen">
          <span class="material-symbols-outlined" style="font-size: 13px;">visibility_off</span>
          <span>Ausblenden</span>
        </button>
      `;
    } else if (item.categoryType === "skipped") {
      badgeHtml = `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle">🚫 Ausgeblendet</span>`;
      actionBtnHtml = `
        <button type="button" class="btn btn-xs btn-outline-primary d-inline-flex align-items-center gap-1 btn-drive-unignore" data-id="${item.id}" style="font-size: 11px; padding: 2px 8px; border-radius: 6px;" title="Wieder beim Sync berücksichtigen">
          <span class="material-symbols-outlined" style="font-size: 13px;">visibility</span>
          <span>Einblenden</span>
        </button>
      `;
    } else {
      badgeHtml = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle">✓ Vollständig</span>`;
    }

    const dateStr = item.createdTime ? new Date(item.createdTime).toLocaleDateString("de-DE") : "-";
    const sizeStr = item.size ? `${(parseInt(item.size, 10) / 1024).toFixed(0)} KB` : "";

    const safeId = encodeURIComponent(item.id);
    const safeName = escapeHtml(item.name || "-");
    const safeCompany = item.currentCompany ? escapeHtml(item.currentCompany) : "";
    const safeCategory = item.currentCategory ? escapeHtml(item.currentCategory) : "";
    const safeReason = item.reason ? escapeHtml(item.reason) : "";

    html += `
      <div class="d-flex align-items-center justify-content-between p-2 mb-1 bg-white rounded border gap-2 drive-sync-item-row" data-id="${safeId}" style="font-size: 13px; cursor: pointer;">
        <div class="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
          <input type="checkbox" class="form-check-input drive-item-checkbox m-0" data-id="${safeId}" ${isChecked ? 'checked' : ''} ${item.categoryType === 'skipped' ? 'disabled' : ''} />
          <div class="text-truncate" style="max-width: 450px;">
            <div class="fw-bold text-dark text-truncate" title="${safeName}">${safeName}</div>
            <div class="text-muted small d-flex gap-2 flex-wrap">
              <span>📅 ${escapeHtml(dateStr)}</span>
              ${sizeStr ? `<span>💾 ${escapeHtml(sizeStr)}</span>` : ''}
              ${safeCompany ? `<span>🏢 ${safeCompany}</span>` : ''}
              ${safeCategory ? `<span>📁 ${safeCategory}</span>` : ''}
              ${safeReason ? `<span class="text-secondary fst-italic">(${safeReason})</span>` : ''}
            </div>
          </div>
        </div>
        <div class="d-flex align-items-center gap-1 flex-wrap justify-content-end">
          ${badgeHtml}
          ${pipelineBadgeHtml}
          ${actionBtnHtml}
        </div>
      </div>
    `;
  });

  driveSyncList.innerHTML = html;

  // Action buttons: Ignore / Unignore
  driveSyncList.querySelectorAll(".btn-drive-ignore").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      try {
        btn.disabled = true;
        const res = await fetch("/api/drive/ignore-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: id }),
        });
        const d = await res.json();
        if (d.success) {
          driveSelectedIds.delete(id);
          // Move from toImport/needsEnrichment to skipped locally
          const foundNew = driveSyncData.toImport?.find(i => i.id === id);
          const foundEnrich = driveSyncData.needsEnrichment?.find(i => i.id === id);
          const item = foundNew || foundEnrich;
          if (foundNew) driveSyncData.toImport = driveSyncData.toImport.filter(i => i.id !== id);
          if (foundEnrich) driveSyncData.needsEnrichment = driveSyncData.needsEnrichment.filter(i => i.id !== id);
          if (item) {
            if (!driveSyncData.skipped) driveSyncData.skipped = [];
            driveSyncData.skipped.push({ ...item, reason: "Manuell ausgeblendet" });
          }
          renderDriveSyncModal();
        }
      } catch (err) {
        console.error("Fehler beim Ausblenden:", err);
      }
    });
  });

  driveSyncList.querySelectorAll(".btn-drive-unignore").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      try {
        btn.disabled = true;
        const res = await fetch("/api/drive/unignore-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: id }),
        });
        const d = await res.json();
        if (d.success) {
          // Re-fetch sync preview to place item back accurately
          openDriveSyncModal();
        }
      } catch (err) {
        console.error("Fehler beim Wieder-Einblenden:", err);
      }
    });
  });

  // Checkbox listeners
  driveSyncList.querySelectorAll(".drive-item-checkbox").forEach(cb => {
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      const id = cb.getAttribute("data-id");
      if (cb.checked) {
        driveSelectedIds.add(id);
      } else {
        driveSelectedIds.delete(id);
      }
      // Re-evaluate select all state
      const visibleItems = getVisibleDriveItems();
      const visibleSelectedCount = visibleItems.filter(i => driveSelectedIds.has(i.id)).length;
      if (driveSyncSelectAll) {
        driveSyncSelectAll.checked = visibleItems.length > 0 && visibleSelectedCount === visibleItems.length;
        driveSyncSelectAll.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleItems.length;
      }
      updateDriveSubmitButton();
    });
  });

  // Row click listener to toggle checkbox
  driveSyncList.querySelectorAll(".drive-sync-item-row").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.tagName === "INPUT" || e.target.closest("button")) return;
      const cb = row.querySelector(".drive-item-checkbox");
      if (cb && !cb.disabled) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      }
    });
  });

  updateDriveSubmitButton();
}

function updateDriveSubmitButton() {
  if (!driveSyncSubmitBtn) return;
  const items = getVisibleDriveItems();
  const visibleSelectedCount = items.filter(i => driveSelectedIds.has(i.id)).length;
  const totalSelectedCount = driveSelectedIds.size;

  const count = currentDriveFilter === "all" ? totalSelectedCount : visibleSelectedCount;
  driveSyncSubmitBtn.disabled = count === 0;

  if (driveSyncSubmitText) {
    if (count === 0) {
      driveSyncSubmitText.innerText = "Keine Belege ausgewählt";
    } else if (currentDriveFilter === "new") {
      driveSyncSubmitText.innerText = `${count} neue Belege nachladen`;
    } else if (currentDriveFilter === "enrich") {
      driveSyncSubmitText.innerText = `${count} Belege mit KI anreichern`;
    } else if (currentDriveFilter === "complete") {
      driveSyncSubmitText.innerText = `${count} Belege neu synchronisieren`;
    } else {
      driveSyncSubmitText.innerText = `${count} Belege synchronisieren & anreichern`;
    }
  }
}

// Drive Sync Tabs Listener
document.querySelectorAll(".drive-filter-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".drive-filter-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentDriveFilter = tab.getAttribute("data-filter") || "all";
    renderDriveSyncModal();
  });
});

if (driveSyncSelectAll) {
  driveSyncSelectAll.addEventListener("change", () => {
    const isChecked = driveSyncSelectAll.checked;
    const visibleItems = getVisibleDriveItems();
    visibleItems.forEach(item => {
      if (isChecked) {
        driveSelectedIds.add(item.id);
      } else {
        driveSelectedIds.delete(item.id);
      }
    });
    driveSyncList.querySelectorAll(".drive-item-checkbox").forEach(cb => {
      cb.checked = isChecked;
    });
    driveSyncSelectAll.indeterminate = false;
    updateDriveSubmitButton();
  });
}

// Drive Sync Execute
if (driveSyncSubmitBtn) {
  driveSyncSubmitBtn.addEventListener("click", async () => {
    if (!driveSyncData) return;

    const allItems = [...(driveSyncData.toImport || []), ...(driveSyncData.needsEnrichment || []), ...(driveSyncData.existingComplete || [])];
    const visibleItems = getVisibleDriveItems();
    // Use visible pool if a specific filter tab is active, or allItems if "all"
    const targetPool = currentDriveFilter === "all" ? allItems : visibleItems;
    const selectedItems = targetPool.filter(i => driveSelectedIds.has(i.id));

    if (selectedItems.length === 0) {
      alert("Bitte wähle mindestens einen Beleg zur Synchronisation aus.");
      return;
    }

    driveSyncSubmitBtn.disabled = true;
    if (driveSyncCloseBtn) driveSyncCloseBtn.disabled = true;
    if (driveSyncProgressBox) driveSyncProgressBox.style.display = "block";
    if (driveSyncProgressStatus) driveSyncProgressStatus.innerText = "Initialisiere synchrone Hintergrund-Verarbeitung...";

    try {
      const res = await fetch("/api/drive/sync-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: selectedItems }),
      });

      const data = await res.json();
      if (data.success) {
        startDriveBackgroundPoller();
        setTimeout(() => {
          closeDriveSyncModal();
        }, 1000);
      } else {
        alert("Fehler beim Starten: " + (data.error || "Unbekannt"));
        driveSyncSubmitBtn.disabled = false;
        if (driveSyncCloseBtn) driveSyncCloseBtn.disabled = false;
      }
    } catch (err) {
      alert("Netzwerkfehler: " + err.message);
      driveSyncSubmitBtn.disabled = false;
      if (driveSyncCloseBtn) driveSyncCloseBtn.disabled = false;
    }
  });
}

// Background poller for Drive Sync State
function startDriveBackgroundPoller() {
  if (driveBackgroundPoller) return;
  driveBackgroundPoller = setInterval(checkDriveSyncStatus, 2500);
  checkDriveSyncStatus();
}

async function checkDriveSyncStatus() {
  try {
    const res = await fetch("/api/drive/sync-status");
    const data = await res.json();
    if (!data.success) return;

    const syncState = data.syncState;
    const banner = document.getElementById("drive-background-sync-banner");
    const bannerTitle = document.getElementById("drive-banner-title");
    const bannerSub = document.getElementById("drive-banner-sub");
    const bannerProgress = document.getElementById("drive-banner-progress-bar");

    if (syncState && syncState.running) {
      if (banner) banner.style.setProperty("display", "flex", "important");
      const percent = syncState.total > 0 ? Math.round((syncState.processed / syncState.total) * 100) : 0;
      if (bannerTitle) bannerTitle.innerText = `Google Drive Sync: ${syncState.processed} / ${syncState.total} Belege`;
      if (bannerSub) bannerSub.innerText = syncState.currentFileName ? `Verarbeite: ${syncState.currentFileName}` : "KI-Analyse läuft...";
      if (bannerProgress) bannerProgress.style.width = `${percent}%`;

      // Update modal if open
      if (driveSyncProgressBox && driveSyncProgressBox.style.display !== "none") {
        if (driveSyncProgressStatus) driveSyncProgressStatus.innerText = syncState.currentFileName || "Verarbeite...";
        if (driveSyncProgressCounter) driveSyncProgressCounter.innerText = `${syncState.processed} / ${syncState.total}`;
        if (driveSyncProgressBar) driveSyncProgressBar.style.width = `${percent}%`;
      }
    } else {
      if (banner) banner.style.setProperty("display", "none", "important");
      if (driveBackgroundPoller) {
        clearInterval(driveBackgroundPoller);
        driveBackgroundPoller = null;
      }
      fetchStatus();
    }
  } catch (e) {}
}

// Check background status on initial load
startDriveBackgroundPoller();

// ==========================================
// --- Google Mail (Workmail) Inbox Scanner ---
// ==========================================

let inboxActiveEmails = [];
let inboxSkippedEmails = [];
let inboxAccounts = [];
let currentInboxSubtab = "detected"; // "detected" | "active" | "skipped"
let selectedInboxMessageIds = new Set();
let selectedInboxAttachments = {};
let isProcessingInboxBatch = false;

const inboxRefreshBtn = document.getElementById("inbox-refresh-btn");
const inboxTabDetected = document.getElementById("inbox-tab-detected");
const inboxTabActive = document.getElementById("inbox-tab-active");
const inboxTabSkipped = document.getElementById("inbox-tab-skipped");
const inboxAccountSelect = document.getElementById("inbox-account-select");
const inboxAddAccountBtn = document.getElementById("inbox-add-account-btn");
const inboxFilterDate = document.getElementById("inbox-filter-date");
const inboxArchiveToggle = document.getElementById("inbox-archive-toggle");
const inboxSearchInput = document.getElementById("inbox-search-input");
const inboxSelectAllCb = document.getElementById("inbox-select-all-cb");
const inboxBatchProcessBtn = document.getElementById("inbox-batch-process-btn");
const inboxSelectedCount = document.getElementById("inbox-selected-count");
const inboxLoadingContainer = document.getElementById("inbox-loading-container");
const inboxErrorAlert = document.getElementById("inbox-error-alert");
const inboxErrorText = document.getElementById("inbox-error-text");
const inboxEmptyContainer = document.getElementById("inbox-empty-container");
const inboxEmailList = document.getElementById("inbox-email-list");
const navInboxBadge = document.getElementById("nav-inbox-badge");
const inboxCountDetected = document.getElementById("inbox-count-detected");
const inboxCountActive = document.getElementById("inbox-count-active");
const inboxCountSkipped = document.getElementById("inbox-count-skipped");
const inboxSelectionControls = document.getElementById("inbox-selection-controls");
const inboxScanQueryInput = document.getElementById("gmail-scan-query-input");
const inboxPermissionCard = document.getElementById("inbox-permission-card");

// PDF Attachment Preview Modal Elements & State
const inboxPdfPreviewModal = document.getElementById("inbox-pdf-preview-modal");
const inboxPdfPreviewTitle = document.getElementById("inbox-pdf-preview-title");
const inboxPdfPreviewSubtitle = document.getElementById("inbox-pdf-preview-subtitle");
const inboxPdfPreviewCounter = document.getElementById("inbox-pdf-preview-counter");
const inboxPdfPrevBtn = document.getElementById("inbox-pdf-prev-btn");
const inboxPdfNextBtn = document.getElementById("inbox-pdf-next-btn");
const inboxPdfQuickProcessBtn = document.getElementById("inbox-pdf-quick-process-btn");
const inboxPdfDownloadBtn = document.getElementById("inbox-pdf-download-btn");
const inboxPdfExternalBtn = document.getElementById("inbox-pdf-external-btn");
const inboxPdfPreviewClose = document.getElementById("inbox-pdf-preview-close");
const inboxPdfPreviewIframe = document.getElementById("inbox-pdf-preview-iframe");
const inboxPdfLoading = document.getElementById("inbox-pdf-loading");

// ==========================================
// --- Client-Side Gmail Scanner (LocalStorage Token Storage) ---
// ==========================================

const GMAIL_CLIENT_ACCOUNTS_KEY = "scanner_client_gmail_accounts";
const GMAIL_CLIENT_SKIPPED_KEY = "scanner_client_gmail_skipped";
const GMAIL_CLIENT_SETTINGS_KEY = "scanner_client_gmail_settings";

let currentPreviewMailIndex = -1;
let currentPreviewAttIndex = 0;
let currentBlobPreviewUrl = null;

function getClientGmailAccounts() {
  try {
    const raw = localStorage.getItem(GMAIL_CLIENT_ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveClientGmailAccounts(accounts) {
  try {
    localStorage.setItem(GMAIL_CLIENT_ACCOUNTS_KEY, JSON.stringify(accounts || []));
  } catch (e) {}
}

function getClientGmailSkipped() {
  try {
    const raw = localStorage.getItem(GMAIL_CLIENT_SKIPPED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveClientGmailSkipped(skipped) {
  try {
    localStorage.setItem(GMAIL_CLIENT_SKIPPED_KEY, JSON.stringify(skipped || {}));
  } catch (e) {}
}

function getClientGmailSettings() {
  try {
    const raw = localStorage.getItem(GMAIL_CLIENT_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { autoArchive: true, scanQuery: "in:inbox filename:pdf" };
  } catch (e) {
    return { autoArchive: true, scanQuery: "in:inbox filename:pdf" };
  }
}

function saveClientGmailSettings(settings) {
  try {
    localStorage.setItem(GMAIL_CLIENT_SETTINGS_KEY, JSON.stringify(settings || {}));
  } catch (e) {}
}

function base64UrlToUint8Array(base64Url) {
  let base64 = String(base64Url).replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function extractPdfPartsFromPayload(parts, found = []) {
  if (!parts || !Array.isArray(parts)) return found;
  for (const part of parts) {
    const filename = part.filename || "";
    const mimeType = (part.mimeType || "").toLowerCase();
    const isPdf = mimeType === "application/pdf" || mimeType === "application/x-pdf" || filename.toLowerCase().endsWith(".pdf");
    if (isPdf && part.body) {
      found.push({
        filename: filename || "Anhang.pdf",
        mimeType: mimeType || "application/pdf",
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId || null,
        data: part.body.data || null,
      });
    }
    if (part.parts && Array.isArray(part.parts)) {
      extractPdfPartsFromPayload(part.parts, found);
    }
  }
  return found;
}

async function requestGmailAccountAuth(accountHint = null) {
  try {
    const res = await fetch("/api/auth/client-id");
    const data = await res.json();
    if (!data.success || !data.clientId) {
      alert("Fehler: Google Client-ID konnte nicht geladen werden (gdrive_secret.json prüfen).");
      return;
    }

    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      alert("Google Identity Services lädt noch... Bitte kurz warten und erneut versuchen.");
      return;
    }

    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: data.clientId,
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
      include_granted_scopes: false,
      hint: accountHint || undefined,
      callback: async (tokenResponse) => {
        if (tokenResponse.error) {
          console.error("[GMAIL GIS] Fehler beim Login:", tokenResponse);
          if (tokenResponse.error !== "popup_closed_by_user") {
            alert("Google-Anmeldung fehlgeschlagen: " + (tokenResponse.error_description || tokenResponse.error));
          }
          return;
        }

        const accessToken = tokenResponse.access_token;
        const expiresIn = parseInt(tokenResponse.expires_in, 10) || 3599;
        const expiresAt = Date.now() + (expiresIn - 60) * 1000;

        try {
          // Profil direkt von Google im Browser abrufen
          const profRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const prof = await profRes.json();
          if (!prof || !prof.emailAddress) {
            throw new Error("Konnte E-Mail-Adresse nicht ermitteln.");
          }

          const accounts = getClientGmailAccounts();
          const existingIdx = accounts.findIndex((a) => a.email.toLowerCase() === prof.emailAddress.toLowerCase());
          const accObj = {
            id: prof.emailAddress,
            email: prof.emailAddress,
            name: prof.emailAddress,
            accessToken: accessToken,
            expiresAt: expiresAt,
            connectedAt: new Date().toISOString(),
          };

          if (existingIdx >= 0) {
            accounts[existingIdx] = accObj;
          } else {
            accounts.push(accObj);
          }

          saveClientGmailAccounts(accounts);
          updateAccountsDropdown(accounts);

          if (typeof showToast === "function") {
            showToast(`Gmail-Konto ${prof.emailAddress} sicher im Browser verbunden!`, "success");
          }

          await loadInboxData(false);
        } catch (profErr) {
          console.error("[GMAIL] Profil-Fehler:", profErr);
          alert("Fehler beim Abrufen des Gmail-Profils: " + profErr.message);
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: accountHint ? "" : "select_account" });
  } catch (err) {
    console.error("[GMAIL AUTH] Fehler:", err);
    alert("Fehler bei der Gmail-Authentifizierung: " + err.message);
  }
}

async function fetchAccountEmailsDirect(account, query) {
  if (Date.now() > (account.expiresAt || 0)) {
    return { expired: true, account, emails: [] };
  }

  const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=30`;
  const res = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
  });

  if (res.status === 401) {
    return { expired: true, account, emails: [] };
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail API Fehler (${res.status}): ${errText}`);
  }

  const listData = await res.json();
  const messages = listData.messages || [];
  if (messages.length === 0) return { expired: false, account, emails: [] };

  const detailPromises = messages.map(async (item) => {
    try {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      if (!msgRes.ok) return null;
      const msg = await msgRes.json();

      const headers = msg.payload?.headers || [];
      const getHeader = (name) => {
        const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
        return h ? h.value : "";
      };

      const subject = getHeader("Subject") || "(Kein Betreff)";
      const fromRaw = getHeader("From") || "Unbekannt";
      let fromName = fromRaw;
      let fromEmail = fromRaw;
      const emailMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/);
      if (emailMatch) {
        fromName = emailMatch[1].replace(/^["']|["']$/g, "").trim() || emailMatch[2];
        fromEmail = emailMatch[2];
      }

      const dateHeader = getHeader("Date");
      let dateIso = new Date().toISOString();
      if (dateHeader) {
        const parsedDate = new Date(dateHeader);
        if (!isNaN(parsedDate.getTime())) dateIso = parsedDate.toISOString();
      } else if (msg.internalDate) {
        dateIso = new Date(parseInt(msg.internalDate, 10)).toISOString();
      }

      const allFoundPdfs = [];
      extractPdfPartsFromPayload(msg.payload?.parts || [], allFoundPdfs);

      if (allFoundPdfs.length === 0) return null;

      const checkText = `${subject} ${fromName} ${fromEmail} ${msg.snippet || ""} ${allFoundPdfs.map((a) => a.filename).join(" ")}`.toLowerCase();
      const detectedKeywords = [
        "rechnung", "invoice", "beleg", "abrechnung", "gutschrift",
        "quittung", "honorarrechnung", "payment", "zahlungsbeleg", "auftragsbestätigung"
      ];
      const isDetected = detectedKeywords.some((kw) => checkText.includes(kw));

      return {
        id: msg.id,
        accountId: account.id,
        accountEmail: account.email,
        subject,
        fromRaw,
        fromName,
        fromEmail,
        date: dateIso,
        snippet: msg.snippet || "",
        attachments: allFoundPdfs,
        isDetected,
      };
    } catch (e) {
      console.warn(`[GMAIL] Fehler bei Nachricht ${item.id}:`, e.message);
      return null;
    }
  });

  const resolved = await Promise.all(detailPromises);
  return {
    expired: false,
    account,
    emails: resolved.filter(Boolean),
  };
}

async function getGmailAttachmentBlob(account, messageId, attachment) {
  if (attachment.data) {
    const bytes = base64UrlToUint8Array(attachment.data);
    return new Blob([bytes], { type: attachment.mimeType || "application/pdf" });
  }

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachment.attachmentId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Fehler beim Herunterladen des Anhangs (${res.status})`);
  }

  const data = await res.json();
  const bytes = base64UrlToUint8Array(data.data);
  return new Blob([bytes], { type: attachment.mimeType || "application/pdf" });
}

async function openInboxPdfPreview(mailOrId, attIndex = 0) {
  if (!inboxPdfPreviewModal || !inboxPdfPreviewIframe) return;

  const visibleEmails = getVisibleInboxEmails();
  let mail = null;

  if (typeof mailOrId === "object" && mailOrId !== null) {
    mail = mailOrId;
    currentPreviewMailIndex = visibleEmails.findIndex((m) => m.id === mail.id);
  } else if (typeof mailOrId === "number") {
    currentPreviewMailIndex = mailOrId;
    mail = visibleEmails[currentPreviewMailIndex];
  } else if (typeof mailOrId === "string") {
    currentPreviewMailIndex = visibleEmails.findIndex((m) => m.id === mailOrId);
    mail = visibleEmails[currentPreviewMailIndex] || inboxActiveEmails.find((m) => m.id === mailOrId) || inboxSkippedEmails.find((m) => m.id === mailOrId);
  }

  if (!mail) return;

  const attachments = mail.attachments || [];
  if (attachments.length === 0) return;

  currentPreviewAttIndex = Math.max(0, Math.min(attIndex, attachments.length - 1));
  const currentAtt = attachments[currentPreviewAttIndex];
  const totalCount = visibleEmails.length;

  if (inboxPdfPreviewTitle) {
    inboxPdfPreviewTitle.innerText = currentAtt.filename || "Dokumentenvorschau";
  }
  if (inboxPdfPreviewSubtitle) {
    const sender = mail.fromName || mail.fromEmail || "Absender";
    const dateFormatted = formatDateDisplay(mail.date);
    inboxPdfPreviewSubtitle.innerText = `${mail.subject || "(Kein Betreff)"} • Von: ${sender} • ${dateFormatted} • ${formatFileSize(currentAtt.size)}`;
  }

  if (inboxPdfPreviewCounter) {
    if (currentPreviewMailIndex >= 0 && totalCount > 0) {
      inboxPdfPreviewCounter.innerText = `${currentPreviewMailIndex + 1} von ${totalCount}`;
      inboxPdfPreviewCounter.style.display = "inline-block";
    } else {
      inboxPdfPreviewCounter.style.display = "none";
    }
  }

  if (inboxPdfPrevBtn) {
    inboxPdfPrevBtn.disabled = currentPreviewMailIndex <= 0;
  }
  if (inboxPdfNextBtn) {
    inboxPdfNextBtn.disabled = currentPreviewMailIndex < 0 || currentPreviewMailIndex >= totalCount - 1;
  }

  if (inboxPdfLoading) inboxPdfLoading.style.setProperty("display", "block", "important");
  inboxPdfPreviewModal.style.setProperty("display", "flex", "important");

  try {
    const accounts = getClientGmailAccounts();
    const account = accounts.find((a) => a.id === mail.accountId || a.email === mail.accountEmail) || accounts[0];
    if (!account) throw new Error("Kein verknüpftes Google-Konto im Browser gefunden.");

    const blob = await getGmailAttachmentBlob(account, mail.id, currentAtt);
    if (currentBlobPreviewUrl) URL.revokeObjectURL(currentBlobPreviewUrl);
    currentBlobPreviewUrl = URL.createObjectURL(blob);

    if (inboxPdfDownloadBtn) {
      inboxPdfDownloadBtn.href = currentBlobPreviewUrl;
      inboxPdfDownloadBtn.setAttribute("download", currentAtt.filename || "Dokument.pdf");
    }
    if (inboxPdfExternalBtn) {
      inboxPdfExternalBtn.href = currentBlobPreviewUrl;
    }

    inboxPdfPreviewIframe.onload = () => {
      if (inboxPdfLoading) inboxPdfLoading.style.setProperty("display", "none", "important");
    };
    inboxPdfPreviewIframe.src = currentBlobPreviewUrl;
  } catch (err) {
    console.error("[PREVIEW] Fehler:", err);
    if (inboxPdfLoading) inboxPdfLoading.style.setProperty("display", "none", "important");
    alert("Fehler beim Laden des PDF-Anhangs: " + err.message);
  }
}

function navigateInboxPdfPreview(direction) {
  const visibleEmails = getVisibleInboxEmails();
  if (visibleEmails.length === 0) return;

  const newIndex = currentPreviewMailIndex + direction;
  if (newIndex >= 0 && newIndex < visibleEmails.length) {
    openInboxPdfPreview(newIndex, 0);
  }
}

function closeInboxPdfPreview() {
  if (!inboxPdfPreviewModal) return;
  inboxPdfPreviewModal.style.setProperty("display", "none", "important");
  if (inboxPdfPreviewIframe) inboxPdfPreviewIframe.src = "";
  if (currentBlobPreviewUrl) {
    URL.revokeObjectURL(currentBlobPreviewUrl);
    currentBlobPreviewUrl = null;
  }
  currentPreviewMailIndex = -1;
}

if (inboxPdfPrevBtn) {
  inboxPdfPrevBtn.addEventListener("click", () => navigateInboxPdfPreview(-1));
}
if (inboxPdfNextBtn) {
  inboxPdfNextBtn.addEventListener("click", () => navigateInboxPdfPreview(1));
}

if (inboxPdfQuickProcessBtn) {
  inboxPdfQuickProcessBtn.addEventListener("click", async () => {
    const visibleEmails = getVisibleInboxEmails();
    if (currentPreviewMailIndex < 0 || currentPreviewMailIndex >= visibleEmails.length) return;
    const mail = visibleEmails[currentPreviewMailIndex];
    await processSingleInboxEmail(mail, inboxPdfQuickProcessBtn);
    const updatedVisible = getVisibleInboxEmails();
    if (updatedVisible.length > 0) {
      const nextIdx = Math.min(currentPreviewMailIndex, updatedVisible.length - 1);
      openInboxPdfPreview(nextIdx, 0);
    } else {
      closeInboxPdfPreview();
    }
  });
}

if (inboxPdfPreviewClose) {
  inboxPdfPreviewClose.addEventListener("click", closeInboxPdfPreview);
}

if (inboxPdfPreviewModal) {
  inboxPdfPreviewModal.addEventListener("click", (e) => {
    if (e.target === inboxPdfPreviewModal) {
      closeInboxPdfPreview();
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (inboxPdfPreviewModal && inboxPdfPreviewModal.style.display !== "none") {
    if (e.key === "Escape") {
      closeInboxPdfPreview();
    } else if (e.key === "ArrowLeft") {
      navigateInboxPdfPreview(-1);
    } else if (e.key === "ArrowRight") {
      navigateInboxPdfPreview(1);
    }
  }
});

function setInboxSubtab(tabName) {
  currentInboxSubtab = tabName;

  const tabs = [
    { name: "detected", btn: inboxTabDetected },
    { name: "active", btn: inboxTabActive },
    { name: "skipped", btn: inboxTabSkipped },
  ];

  tabs.forEach((t) => {
    if (!t.btn) return;
    if (t.name === tabName) {
      t.btn.classList.add("btn-primary", "active");
      t.btn.classList.remove("btn-outline-secondary");
    } else {
      t.btn.classList.remove("btn-primary", "active");
      t.btn.classList.add("btn-outline-secondary");
    }
  });

  if (tabName === "skipped") {
    if (inboxSelectionControls) inboxSelectionControls.style.display = "none";
    if (inboxBatchProcessBtn) inboxBatchProcessBtn.style.display = "none";
  } else {
    if (inboxSelectionControls) inboxSelectionControls.style.display = "flex";
    if (inboxBatchProcessBtn) inboxBatchProcessBtn.style.display = "inline-flex";
  }

  // Bei Wechsel auf "Erkannt" automatisch alle erkannten Rechnungen vorselektieren
  if (tabName === "detected") {
    const visible = getVisibleInboxEmails();
    selectedInboxMessageIds.clear();
    visible.forEach((m) => selectedInboxMessageIds.add(m.id));
  }

  updateInboxBatchButton();
  renderInboxList();
}

if (inboxTabDetected) {
  inboxTabDetected.addEventListener("click", () => setInboxSubtab("detected"));
}
if (inboxTabActive) {
  inboxTabActive.addEventListener("click", () => setInboxSubtab("active"));
}
if (inboxTabSkipped) {
  inboxTabSkipped.addEventListener("click", () => setInboxSubtab("skipped"));
}

if (inboxFilterDate) {
  inboxFilterDate.addEventListener("change", () => {
    if (currentInboxSubtab === "detected") {
      const visible = getVisibleInboxEmails();
      selectedInboxMessageIds.clear();
      visible.forEach((m) => selectedInboxMessageIds.add(m.id));
    }
    updateInboxBatchButton();
    renderInboxList();
  });
}

if (inboxAccountSelect) {
  inboxAccountSelect.addEventListener("change", () => {
    loadInboxData(false);
  });
}

if (inboxAddAccountBtn) {
  inboxAddAccountBtn.addEventListener("click", () => requestGmailAccountAuth());
}

const inboxGrantPermissionBtn = document.getElementById("inbox-grant-permission-btn");
if (inboxGrantPermissionBtn) {
  inboxGrantPermissionBtn.addEventListener("click", () => requestGmailAccountAuth());
}

const settingsAddGmailAccountBtn = document.getElementById("settings-add-gmail-account-btn");
if (settingsAddGmailAccountBtn) {
  settingsAddGmailAccountBtn.addEventListener("click", () => requestGmailAccountAuth());
}

if (inboxRefreshBtn) {
  inboxRefreshBtn.addEventListener("click", () => loadInboxData(false));
}

if (inboxSearchInput) {
  inboxSearchInput.addEventListener("input", renderInboxList);
}

if (inboxSelectAllCb) {
  inboxSelectAllCb.addEventListener("change", () => {
    const visibleActive = getVisibleInboxEmails();
    if (inboxSelectAllCb.checked) {
      visibleActive.forEach((m) => selectedInboxMessageIds.add(m.id));
    } else {
      selectedInboxMessageIds.clear();
    }
    updateInboxBatchButton();
    renderInboxList();
  });
}

if (inboxBatchProcessBtn) {
  inboxBatchProcessBtn.addEventListener("click", processBatchSelectedEmails);
}

function updateInboxBatchButton() {
  if (!inboxBatchProcessBtn) return;
  const count = selectedInboxMessageIds.size;
  if (inboxSelectedCount) inboxSelectedCount.innerText = count;
  inboxBatchProcessBtn.disabled = count === 0 || isProcessingInboxBatch;
}

function matchDateFilter(dateStr, filterVal) {
  if (!dateStr || filterVal === "alle") return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (filterVal === "today") {
    return itemDay.getTime() === today.getTime();
  }
  if (filterVal === "yesterday_today") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return itemDay.getTime() >= yesterday.getTime();
  }
  if (filterVal === "7days") {
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return itemDay.getTime() >= sevenDaysAgo.getTime();
  }
  if (filterVal === "30days") {
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return itemDay.getTime() >= thirtyDaysAgo.getTime();
  }
  if (filterVal === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  if (filterVal === "last_month") {
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === lastMonthDate.getFullYear() && d.getMonth() === lastMonthDate.getMonth();
  }
  if (filterVal === "year2026") {
    return d.getFullYear() === 2026;
  }
  if (filterVal === "year2025") {
    return d.getFullYear() === 2025;
  }
  if (filterVal === "older") {
    return d.getFullYear() < 2025;
  }
  return true;
}

function getVisibleInboxEmails() {
  let sourceList = [];
  if (currentInboxSubtab === "detected") {
    sourceList = inboxActiveEmails.filter((m) => m.isDetected);
  } else if (currentInboxSubtab === "active") {
    sourceList = inboxActiveEmails;
  } else if (currentInboxSubtab === "skipped") {
    sourceList = inboxSkippedEmails;
  }

  const q = inboxSearchInput ? inboxSearchInput.value.trim().toLowerCase() : "";
  const dateFilter = inboxFilterDate ? inboxFilterDate.value : "alle";

  return sourceList.filter((m) => {
    if (!matchDateFilter(m.date, dateFilter)) return false;

    if (q) {
      const subject = (m.subject || "").toLowerCase();
      const fromName = (m.fromName || "").toLowerCase();
      const fromEmail = (m.fromEmail || "").toLowerCase();
      const snippet = (m.snippet || "").toLowerCase();
      const attNames = (m.attachments || []).map((a) => (a.filename || "").toLowerCase()).join(" ");
      const acc = (m.accountEmail || m.accountId || "").toLowerCase();
      if (
        !subject.includes(q) &&
        !fromName.includes(q) &&
        !fromEmail.includes(q) &&
        !snippet.includes(q) &&
        !attNames.includes(q) &&
        !acc.includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

function updateAccountsDropdown(accounts) {
  inboxAccounts = accounts || [];
  if (!inboxAccountSelect) return;

  const currentVal = inboxAccountSelect.value || "all";
  inboxAccountSelect.innerHTML = `<option value="all">📥 Alle Posteingänge (${inboxAccounts.length || 0})</option>`;

  inboxAccounts.forEach((acc) => {
    const opt = document.createElement("option");
    opt.value = acc.id || acc.email;
    opt.innerText = `✉️ ${acc.email}`;
    inboxAccountSelect.appendChild(opt);
  });

  if (Array.from(inboxAccountSelect.options).some((o) => o.value === currentVal)) {
    inboxAccountSelect.value = currentVal;
  }

  // Update Settings Modal accounts container
  const accountsContainer = document.getElementById("gmail-accounts-container");
  if (accountsContainer) {
    accountsContainer.innerHTML = "";
    if (inboxAccounts.length === 0) {
      accountsContainer.innerHTML = `<div class="text-muted small">Noch keine Gmail-Konten im Browser verknüpft.</div>`;
    } else {
      inboxAccounts.forEach((acc) => {
        const item = document.createElement("div");
        item.className = "d-flex justify-content-between align-items-center p-2 rounded border bg-white small";
        item.innerHTML = `
          <div class="d-flex align-items-center gap-2 text-truncate">
            <span class="material-symbols-outlined text-primary" style="font-size: 18px;">mail</span>
            <strong class="text-truncate">${acc.email}</strong>
            <span class="badge bg-success-subtle text-success border border-success-subtle" style="font-size: 10px;">LocalStorage</span>
          </div>
          <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 remove-gmail-acc-btn" data-id="${acc.id}" style="font-size: 11px;">Trennen</button>
        `;
        const removeBtn = item.querySelector(".remove-gmail-acc-btn");
        if (removeBtn) {
          removeBtn.addEventListener("click", () => {
            if (confirm(`Möchtest du das Google-Konto "${acc.email}" aus dem lokalen Browser-Speicher trennen?`)) {
              let updated = getClientGmailAccounts().filter((a) => a.id !== acc.id && a.email !== acc.email);
              saveClientGmailAccounts(updated);
              updateAccountsDropdown(updated);
              loadInboxData(false);
            }
          });
        }
        accountsContainer.appendChild(item);
      });
    }
  }
}

async function loadInboxData(silent = false) {
  if (!window.isAdmin) return;
  const inboxPermissionCard = document.getElementById("inbox-permission-card");

  const accounts = getClientGmailAccounts();
  const skippedMap = getClientGmailSkipped();
  inboxSkippedEmails = Object.values(skippedMap).sort(
    (a, b) => new Date(b.skippedAt || b.date) - new Date(a.skippedAt || a.date)
  );

  updateAccountsDropdown(accounts);

  if (!silent) {
    if (inboxLoadingContainer) inboxLoadingContainer.style.setProperty("display", "none", "important");
    if (inboxEmailList) inboxEmailList.style.setProperty("display", "none", "important");
    if (inboxEmptyContainer) inboxEmptyContainer.style.setProperty("display", "none", "important");
    if (inboxErrorAlert) inboxErrorAlert.style.setProperty("display", "none", "important");
    if (inboxPermissionCard) inboxPermissionCard.style.setProperty("display", "none", "important");
  }

  if (accounts.length === 0) {
    if (inboxPermissionCard) inboxPermissionCard.style.setProperty("display", "block", "important");
    if (inboxCountDetected) inboxCountDetected.innerText = "0";
    if (inboxCountActive) inboxCountActive.innerText = "0";
    if (inboxCountSkipped) inboxCountSkipped.innerText = inboxSkippedEmails.length;
    if (navInboxBadge) navInboxBadge.style.display = "none";
    return;
  }

  if (!silent && inboxLoadingContainer) {
    inboxLoadingContainer.style.setProperty("display", "block", "important");
  }

  try {
    const selectedAccountId = inboxAccountSelect ? inboxAccountSelect.value : "all";
    const accountsToQuery = selectedAccountId === "all"
      ? accounts
      : accounts.filter((a) => a.id === selectedAccountId || a.email === selectedAccountId);

    const gmailSettings = getClientGmailSettings();
    const query = (inboxScanQueryInput && inboxScanQueryInput.value.trim()) || gmailSettings.scanQuery || "in:inbox filename:pdf";

    let allFetchedEmails = [];
    let hasExpiredAccount = false;
    let expiredAccountEmail = "";

    for (const acc of accountsToQuery) {
      const res = await fetchAccountEmailsDirect(acc, query);
      if (res.expired) {
        hasExpiredAccount = true;
        expiredAccountEmail = acc.email;
      } else {
        allFetchedEmails = allFetchedEmails.concat(res.emails);
      }
    }

    if (hasExpiredAccount && inboxPermissionCard) {
      inboxPermissionCard.style.setProperty("display", "block", "important");
      const permText = inboxPermissionCard.querySelector("p");
      if (permText) {
        permText.innerHTML = `Die Sitzung für <strong>${expiredAccountEmail}</strong> ist abgelaufen. Klicke auf den Button, um den Zugriff im Browser zu erneuern (Tokens verbleiben ausschließlich im LocalStorage).`;
      }
    }

    // Filtere bereits verarbeitete Mails heraus
    const processedGmailMessageIds = new Set(
      (activeJobs || []).filter((j) => j.source === "gmail" && j.gmailMessageId).map((j) => j.gmailMessageId)
    );

    inboxActiveEmails = allFetchedEmails.filter((m) => !skippedMap[m.id] && !processedGmailMessageIds.has(m.id));

    // Badges & Counters aktualisieren
    const detectedEmails = inboxActiveEmails.filter((m) => m.isDetected);
    const detectedCount = detectedEmails.length;
    const activeCount = inboxActiveEmails.length;
    const skippedCount = inboxSkippedEmails.length;

    if (inboxCountDetected) inboxCountDetected.innerText = detectedCount;
    if (inboxCountActive) inboxCountActive.innerText = activeCount;
    if (inboxCountSkipped) inboxCountSkipped.innerText = skippedCount;

    if (navInboxBadge) {
      navInboxBadge.innerText = detectedCount > 0 ? detectedCount : activeCount;
      navInboxBadge.style.display = activeCount > 0 ? "inline-block" : "none";
    }

    // Wenn "Erkannt" ausgewählt ist, alle erkannten E-Mails vorselektieren
    if (currentInboxSubtab === "detected") {
      selectedInboxMessageIds.clear();
      const visible = getVisibleInboxEmails();
      visible.forEach((m) => selectedInboxMessageIds.add(m.id));
    } else {
      const validIds = new Set(inboxActiveEmails.map((m) => m.id));
      for (const id of selectedInboxMessageIds) {
        if (!validIds.has(id)) selectedInboxMessageIds.delete(id);
      }
    }

    updateInboxBatchButton();

    if (inboxLoadingContainer) inboxLoadingContainer.style.setProperty("display", "none", "important");
    renderInboxList();
  } catch (err) {
    console.error("[GMAIL] Fehler bei loadInboxData:", err);
    if (!silent) {
      if (inboxLoadingContainer) inboxLoadingContainer.style.setProperty("display", "none", "important");
      if (inboxErrorAlert) {
        inboxErrorAlert.style.setProperty("display", "block", "important");
        const errText = document.getElementById("inbox-error-text");
        if (errText) errText.innerText = err.message || "Fehler beim Laden der E-Mails.";
      }
    }
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDateDisplay(isoString) {
  if (!isoString) return "-";
  try {
    const d = new Date(isoString);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return `Heute, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
    }
    return d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return isoString;
  }
}

function renderInboxList() {
  if (!inboxEmailList) return;

  // Alte Karten IMMER zuerst aus dem DOM löschen!
  inboxEmailList.innerHTML = "";

  const visibleEmails = getVisibleInboxEmails();

  if (visibleEmails.length === 0) {
    inboxEmailList.style.setProperty("display", "none", "important");
    if (inboxEmptyContainer) inboxEmptyContainer.style.setProperty("display", "block", "important");
    if (inboxSelectAllCb) inboxSelectAllCb.checked = false;
    updateInboxBatchButton();
    return;
  }

  if (inboxEmptyContainer) inboxEmptyContainer.style.setProperty("display", "none", "important");
  inboxEmailList.style.setProperty("display", "flex", "important");

  visibleEmails.forEach((mail) => {
    const isSelected = selectedInboxMessageIds.has(mail.id);
    const attachments = mail.attachments || [];

    // Initialisiere ausgewählte Anhänge für diese Mail (standardmäßig alle Indizes)
    if (!selectedInboxAttachments[mail.id]) {
      selectedInboxAttachments[mail.id] = new Set(attachments.map((_, idx) => idx));
    }
    const currentSelectedAtts = selectedInboxAttachments[mail.id];
    const initialActiveCount = currentSelectedAtts.size;
    const initialTotalCount = attachments.length;
    const initialBtnSuffix = initialActiveCount < initialTotalCount || initialActiveCount === 0 ? ` (${initialActiveCount})` : "";

    const card = document.createElement("div");
    card.className = "card p-3 shadow-sm border";
    card.style.cssText = `
      background-color: ${isSelected ? "#f8fbff" : "#ffffff"};
      border-radius: 14px;
      border-color: ${isSelected ? "#0d6efd" : "#e9ecef"} !important;
      transition: all 0.2s ease;
    `;

    // Attachments HTML (Selektierbare PDF-Pills mit Checkbox & Vorschau-Button)
    const attachmentsHtml = attachments
      .map((att, idx) => {
        const isAttChecked = currentSelectedAtts.has(idx);
        const safeFilename = escapeHtml(att.filename || "Anhang.pdf");
        return `
        <div class="inbox-attachment-item d-inline-flex align-items-center gap-1 border rounded p-1 px-2 small" 
          style="background-color: ${isAttChecked ? '#f0f7ff' : '#f8f9fa'}; border-color: ${isAttChecked ? '#b6d4fe' : '#dee2e6'} !important; transition: all 0.15s ease;">
          <input type="checkbox" class="form-check-input m-0 inbox-att-cb" 
            data-message-id="${encodeURIComponent(mail.id)}"
            data-att-idx="${idx}"
            ${isAttChecked ? "checked" : ""}
            style="cursor: pointer; width: 15px; height: 15px;" 
            title="Diesen Anhang für die Verarbeitung auswählen/abwählen" />
          <span class="material-symbols-outlined text-danger" style="font-size: 16px;">picture_as_pdf</span>
          <span class="text-truncate fw-medium inbox-pdf-pill" 
            data-message-id="${encodeURIComponent(mail.id)}"
            data-att-idx="${idx}"
            style="max-width: 200px; cursor: pointer;" 
            title="Klicken für PDF-Vorschau: ${safeFilename}">${safeFilename}</span>
          <span class="text-muted" style="font-size: 11px;">(${formatFileSize(att.size)})</span>
          <button type="button" class="btn btn-sm p-0 border-0 text-primary inbox-pdf-pill d-inline-flex align-items-center" 
            data-message-id="${encodeURIComponent(mail.id)}"
            data-att-idx="${idx}"
            title="Vorschau öffnen">
            <span class="material-symbols-outlined" style="font-size: 14px;">visibility</span>
          </button>
        </div>
      `;
      })
      .join("");

    const isSkippedTab = currentInboxSubtab === "skipped";
    const safeSenderName = escapeHtml(mail.fromName || mail.fromEmail || "Unbekannter Absender");
    const safeSenderEmail = escapeHtml(mail.fromEmail || "");
    const safeAccountEmail = escapeHtml(mail.accountEmail || "");
    const safeSubject = escapeHtml(mail.subject || "(Kein Betreff)");
    const safeSnippet = escapeHtml(mail.snippet || "");

    card.innerHTML = `
      <div class="d-flex gap-3 align-items-start">
        ${
          !isSkippedTab
            ? `
          <div class="pt-1">
            <input type="checkbox" class="form-check-input inbox-item-cb" data-id="${encodeURIComponent(mail.id)}" ${
                isSelected ? "checked" : ""
              } style="cursor: pointer; width: 18px; height: 18px;" />
          </div>
        `
            : ""
        }
        <div class="flex-grow-1" style="min-width: 0;">
          <!-- Top Row: Badges, Sender & Date -->
          <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-1">
            <div class="d-flex align-items-center gap-2 text-truncate flex-wrap">
              <span class="material-symbols-outlined text-secondary" style="font-size: 20px;">account_circle</span>
              <strong class="text-dark" style="font-size: 14px;">${safeSenderName}</strong>
              ${
                mail.fromName && mail.fromEmail && mail.fromEmail !== mail.fromName
                  ? `<span class="text-muted small text-truncate" style="font-size: 12px;">&lt;${safeSenderEmail}&gt;</span>`
                  : ""
              }
              ${
                mail.isDetected
                  ? `<span class="badge bg-success-subtle text-success border border-success-subtle d-inline-flex align-items-center gap-1" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;">
                      <span class="material-symbols-outlined" style="font-size: 13px;">auto_fix_high</span>
                      <span>Rechnung / Beleg erkannt</span>
                    </span>`
                  : ""
              }
              ${
                mail.accountEmail && inboxAccounts.length > 1
                  ? `<span class="badge bg-light text-secondary border" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;">
                      <span class="material-symbols-outlined" style="font-size: 12px; vertical-align: middle;">mail</span>
                      ${safeAccountEmail}
                    </span>`
                  : ""
              }
            </div>
            <div class="text-muted small flex-shrink-0" style="font-size: 12px;">
              ${escapeHtml(formatDateDisplay(mail.date))}
            </div>
          </div>

          <!-- Subject Line -->
          <div class="fw-bold text-dark mb-1" style="font-size: 15px;">
            ${safeSubject}
          </div>

          <!-- Snippet / Email Preview -->
          ${
            safeSnippet
              ? `
            <div class="text-muted small mb-2" style="font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${safeSnippet}
            </div>
          `
              : ""
          }

          <!-- PDF Attachments Pills -->
          <div class="d-flex flex-wrap gap-2 mb-3 pt-1">
            ${attachmentsHtml}
          </div>

          <!-- Action Buttons Row -->
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-2 border-top">
            <div class="small text-muted">
              ${attachments.length} ${attachments.length === 1 ? "PDF-Anhang" : "PDF-Anhänge"}
            </div>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-sm btn-outline-dark d-flex align-items-center gap-1 inbox-preview-btn" data-id="${encodeURIComponent(mail.id)}" style="border-radius: 20px; font-size: 12px; padding: 4px 12px;" title="PDF-Vorschau öffnen">
                <span class="material-symbols-outlined" style="font-size: 16px;">visibility</span>
                <span>Vorschau</span>
              </button>
              ${
                !isSkippedTab
                  ? `
                <button type="button" class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1 inbox-skip-btn" data-id="${encodeURIComponent(mail.id)}" style="border-radius: 20px; font-size: 12px; padding: 4px 12px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">playlist_remove</span>
                  <span>Überspringen</span>
                </button>
                <button type="button" class="btn btn-sm btn-primary d-flex align-items-center gap-1 inbox-process-btn" data-id="${encodeURIComponent(mail.id)}" ${initialActiveCount === 0 ? "disabled" : ""} style="border-radius: 20px; font-size: 12px; padding: 4px 14px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
                  <span>Verarbeiten${initialBtnSuffix}</span>
                </button>
              `
                  : `
                <button type="button" class="btn btn-sm btn-outline-primary d-flex align-items-center gap-1 inbox-unskip-btn" data-id="${encodeURIComponent(mail.id)}" style="border-radius: 20px; font-size: 12px; padding: 4px 12px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">undo</span>
                  <span>Wiederherstellen</span>
                </button>
                <button type="button" class="btn btn-sm btn-primary d-flex align-items-center gap-1 inbox-process-btn" data-id="${encodeURIComponent(mail.id)}" ${initialActiveCount === 0 ? "disabled" : ""} style="border-radius: 20px; font-size: 12px; padding: 4px 14px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
                  <span>Trotzdem Verarbeiten${initialBtnSuffix}</span>
                </button>
              `
              }
            </div>
          </div>
        </div>
      </div>
    `;

    // PDF Preview Click Handler for button and pills
    const previewBtn = card.querySelector(".inbox-preview-btn");
    if (previewBtn) {
      previewBtn.addEventListener("click", () => openInboxPdfPreview(mail, 0));
    }

    card.querySelectorAll(".inbox-pdf-pill").forEach((pill) => {
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(pill.getAttribute("data-att-idx"), 10) || 0;
        openInboxPdfPreview(mail, idx);
      });
    });

    // Checkbox event für E-Mail Selektion
    const cb = card.querySelector(".inbox-item-cb");
    if (cb) {
      cb.addEventListener("change", (e) => {
        if (e.target.checked) {
          selectedInboxMessageIds.add(mail.id);
        } else {
          selectedInboxMessageIds.delete(mail.id);
        }
        updateInboxBatchButton();
        card.style.borderColor = e.target.checked ? "#0d6efd" : "#e9ecef";
        card.style.backgroundColor = e.target.checked ? "#f8fbff" : "#ffffff";
      });
    }

    // Checkbox event für Anhang-Selektion
    card.querySelectorAll(".inbox-att-cb").forEach((attCb) => {
      attCb.addEventListener("change", (e) => {
        e.stopPropagation();
        const mId = attCb.getAttribute("data-message-id");
        const idx = parseInt(attCb.getAttribute("data-att-idx"), 10);
        if (!selectedInboxAttachments[mId]) {
          selectedInboxAttachments[mId] = new Set((mail.attachments || []).map((_, i) => i));
        }
        if (e.target.checked) {
          selectedInboxAttachments[mId].add(idx);
        } else {
          selectedInboxAttachments[mId].delete(idx);
        }

        const parentItem = attCb.closest(".inbox-attachment-item");
        if (parentItem) {
          parentItem.style.backgroundColor = e.target.checked ? "#f0f7ff" : "#f8f9fa";
          parentItem.style.borderColor = e.target.checked ? "#b6d4fe" : "#dee2e6";
        }

        const totalCount = (mail.attachments || []).length;
        const activeCount = selectedInboxAttachments[mId].size;
        const procBtn = card.querySelector(".inbox-process-btn");
        if (procBtn) {
          procBtn.disabled = activeCount === 0;
          const isSkipped = currentInboxSubtab === "skipped";
          const labelPrefix = isSkipped ? "Trotzdem Verarbeiten" : "Verarbeiten";
          const countSuffix = activeCount < totalCount || activeCount === 0 ? ` (${activeCount})` : "";
          procBtn.innerHTML = `
            <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
            <span>${labelPrefix}${countSuffix}</span>
          `;
        }
      });
    });

    // Process button
    const procBtn = card.querySelector(".inbox-process-btn");
    if (procBtn) {
      procBtn.addEventListener("click", () => processSingleInboxEmail(mail, procBtn));
    }

    // Skip button
    const skipBtn = card.querySelector(".inbox-skip-btn");
    if (skipBtn) {
      skipBtn.addEventListener("click", () => skipInboxEmail(mail));
    }

    // Unskip button
    const unskipBtn = card.querySelector(".inbox-unskip-btn");
    if (unskipBtn) {
      unskipBtn.addEventListener("click", () => unskipInboxEmail(mail.id));
    }

    inboxEmailList.appendChild(card);
  });
}

async function processSingleInboxEmail(mail, btnEl) {
  const originalHtml = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> <span>Verarbeite...</span>`;

  const shouldArchive = inboxArchiveToggle ? inboxArchiveToggle.checked : true;

  try {
    const selectedIndices = selectedInboxAttachments[mail.id]
      ? Array.from(selectedInboxAttachments[mail.id])
      : (mail.attachments || []).map((_, i) => i);
    const selectedAttachments = (mail.attachments || []).filter((_, idx) => selectedIndices.includes(idx));

    if (selectedAttachments.length === 0) {
      alert("Bitte wählen Sie mindestens einen PDF-Anhang zum Verarbeiten aus.");
      btnEl.disabled = false;
      btnEl.innerHTML = originalHtml;
      return;
    }

    const accounts = getClientGmailAccounts();
    const account = accounts.find((a) => a.id === mail.accountId || a.email === mail.accountEmail) || accounts[0];
    if (!account) throw new Error("Kein verknüpftes Google-Konto im Browser gefunden.");

    // Upload each selected attachment to server via POST /api/upload
    for (const att of selectedAttachments) {
      const blob = await getGmailAttachmentBlob(account, mail.id, att);
      const file = new File([blob], att.filename || "Anhang.pdf", { type: "application/pdf" });
      const formData = new FormData();
      formData.append("files", file);
      formData.append("source", "gmail");
      formData.append("gmailMessageId", mail.id);
      formData.append("isPrivate", "false");

      const upRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!upRes.ok) {
        const errText = await upRes.text();
        throw new Error("Upload-Fehler: " + errText);
      }
    }

    // Archive on Gmail directly if enabled
    if (shouldArchive && account.accessToken) {
      try {
        await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${mail.id}/modify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
        });
      } catch (archErr) {
        console.warn("[GMAIL ARCHIVE] Warnung:", archErr);
      }
    }

    // Aus lokaler Ansicht entfernen
    inboxActiveEmails = inboxActiveEmails.filter((m) => m.id !== mail.id);
    inboxSkippedEmails = inboxSkippedEmails.filter((m) => m.id !== mail.id);
    selectedInboxMessageIds.delete(mail.id);
    delete selectedInboxAttachments[mail.id];

    // Update Counter & Badge
    const detectedEmails = inboxActiveEmails.filter((m) => m.isDetected);
    if (inboxCountDetected) inboxCountDetected.innerText = detectedEmails.length;
    if (inboxCountActive) inboxCountActive.innerText = inboxActiveEmails.length;
    if (inboxCountSkipped) inboxCountSkipped.innerText = inboxSkippedEmails.length;
    if (navInboxBadge) {
      const bCount = detectedEmails.length > 0 ? detectedEmails.length : inboxActiveEmails.length;
      navInboxBadge.innerText = bCount;
      navInboxBadge.style.display = inboxActiveEmails.length > 0 ? "inline-block" : "none";
    }

    updateInboxBatchButton();
    renderInboxList();
    fetchStatus();

    if (typeof showToast === "function") {
      showToast(`Belege aus „${mail.subject || mail.fromName}“ erfolgreich zur KI-Pipeline hinzugefügt!`, "success");
    }
  } catch (err) {
    console.error("[GMAIL] Fehler beim Verarbeiten der E-Mail:", err);
    alert("Fehler beim Verarbeiten: " + err.message);
    btnEl.disabled = false;
    btnEl.innerHTML = originalHtml;
  }
}

async function processBatchSelectedEmails() {
  const visibleActive = getVisibleInboxEmails();
  const selectedEmails = visibleActive.filter((m) => selectedInboxMessageIds.has(m.id));

  if (selectedEmails.length === 0) {
    alert("Keine E-Mails ausgewählt.");
    return;
  }

  if (!confirm(`${selectedEmails.length} ausgewählte E-Mail(s) jetzt verarbeiten?`)) return;

  isProcessingInboxBatch = true;
  if (inboxBatchProcessBtn) {
    inboxBatchProcessBtn.disabled = true;
    inboxBatchProcessBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> <span>Verarbeite Stapel...</span>`;
  }

  let totalUploaded = 0;
  let archivedCount = 0;
  const shouldArchive = inboxArchiveToggle ? inboxArchiveToggle.checked : true;
  const accounts = getClientGmailAccounts();

  try {
    for (const mail of selectedEmails) {
      const account = accounts.find((a) => a.id === mail.accountId || a.email === mail.accountEmail) || accounts[0];
      if (!account) continue;

      const selectedIndices = selectedInboxAttachments[mail.id]
        ? Array.from(selectedInboxAttachments[mail.id])
        : (mail.attachments || []).map((_, i) => i);
      const selectedAttachments = (mail.attachments || []).filter((_, idx) => selectedIndices.includes(idx));

      for (const att of selectedAttachments) {
        const blob = await getGmailAttachmentBlob(account, mail.id, att);
        const file = new File([blob], att.filename || "Anhang.pdf", { type: "application/pdf" });
        const formData = new FormData();
        formData.append("files", file);
        formData.append("source", "gmail");
        formData.append("gmailMessageId", mail.id);
        formData.append("isPrivate", "false");

        await fetch("/api/upload", { method: "POST", body: formData });
        totalUploaded++;
      }

      if (shouldArchive && account.accessToken) {
        try {
          await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${mail.id}/modify`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${account.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
          });
          archivedCount++;
        } catch (e) {}
      }

      inboxActiveEmails = inboxActiveEmails.filter((m) => m.id !== mail.id);
      inboxSkippedEmails = inboxSkippedEmails.filter((m) => m.id !== mail.id);
      selectedInboxMessageIds.delete(mail.id);
      delete selectedInboxAttachments[mail.id];
    }

    updateInboxBatchButton();
    renderInboxList();
    fetchStatus();

    alert(
      `Stapelverarbeitung abgeschlossen!\n` +
        `• Verarbeitet: ${selectedEmails.length} E-Mails (${totalUploaded} PDF-Dokumente)\n` +
        `• Archiviert: ${archivedCount} E-Mails`
    );
  } catch (err) {
    console.error("[GMAIL BATCH] Fehler:", err);
    alert("Fehler bei Stapelverarbeitung: " + err.message);
  } finally {
    isProcessingInboxBatch = false;
    updateInboxBatchButton();
    if (inboxBatchProcessBtn) {
      inboxBatchProcessBtn.innerHTML = `
        <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
        <span>Ausgewählte verarbeiten (<span id="inbox-selected-count">0</span>)</span>
      `;
    }
  }
}

function skipInboxEmail(mail) {
  const skipped = getClientGmailSkipped();
  skipped[mail.id] = {
    ...mail,
    skippedAt: new Date().toISOString(),
  };
  saveClientGmailSkipped(skipped);

  inboxActiveEmails = inboxActiveEmails.filter((m) => m.id !== mail.id);
  inboxSkippedEmails = Object.values(skipped).sort(
    (a, b) => new Date(b.skippedAt || b.date) - new Date(a.skippedAt || a.date)
  );
  selectedInboxMessageIds.delete(mail.id);

  const detectedEmails = inboxActiveEmails.filter((m) => m.isDetected);
  if (inboxCountDetected) inboxCountDetected.innerText = detectedEmails.length;
  if (inboxCountActive) inboxCountActive.innerText = inboxActiveEmails.length;
  if (inboxCountSkipped) inboxCountSkipped.innerText = inboxSkippedEmails.length;
  if (navInboxBadge) {
    const bCount = detectedEmails.length > 0 ? detectedEmails.length : inboxActiveEmails.length;
    navInboxBadge.innerText = bCount;
    navInboxBadge.style.display = inboxActiveEmails.length > 0 ? "inline-block" : "none";
  }

  updateInboxBatchButton();
  renderInboxList();
}

function unskipInboxEmail(messageId) {
  const skipped = getClientGmailSkipped();
  if (skipped[messageId]) {
    delete skipped[messageId];
    saveClientGmailSkipped(skipped);
  }
  loadInboxData(false);
}

// Initialer Abruf der offenen E-Mails im Hintergrund (für den Badge-Zähler)
setTimeout(() => {
  loadInboxData(true);
}, 3000);



