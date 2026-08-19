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

  // Fetch current settings from backend
  try {
    const setRes = await fetch("/api/settings");
    const setJson = await setRes.json();
    if (setJson.success) {
      // Populate if we already have it
      window.currentSettings = setJson.settings;
    }
  } catch (e) {}

  // Fetch client ID configuration
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (data.success && data.clientId) {
      googleClientId = data.clientId;
      document.getElementById("auth-status").innerText = "Bereit zur Authentifizierung";
      document.getElementById("auth-btn").style.display = "inline-block";

      // Initialize Google Auth client for Primary Account (Google Drive + Gmail)
      authClientCode = window.google.accounts.oauth2.initCodeClient({
        client_id: googleClientId,
        scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.modify",
        prompt: "consent",
        ux_mode: "popup",
        callback: async (response) => {
          if (response.code) {
            document.getElementById("auth-status").innerText = "Speichere Code am Server...";
            const authRes = await fetch("/api/auth/code", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: response.code, isSecondary: false }),
            });
            if (authRes.ok) {
              document.getElementById("auth-status").innerText = "Erfolgreich verbunden!";
              document.getElementById("auth-btn").style.display = "none";
              loadFolders();
              if (typeof loadInboxData === "function") {
                loadInboxData(false);
              }
            } else {
              document.getElementById("auth-status").innerText = "Fehler bei der Verbindung.";
            }
          }
        },
      });

      // Initialize Google Auth client for Secondary Gmail Accounts (ONLY Gmail scope, NO Drive!)
      secondaryGmailAuthClient = window.google.accounts.oauth2.initCodeClient({
        client_id: googleClientId,
        scope: "https://www.googleapis.com/auth/gmail.modify",
        prompt: "select_account consent",
        ux_mode: "popup",
        callback: async (response) => {
          if (response.code) {
            try {
              const authRes = await fetch("/api/auth/code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: response.code, isSecondary: true }),
              });
              const data = await authRes.json();
              if (data.success) {
                if (typeof showToast === "function") {
                  showToast(`Posteingang ${data.account?.email || ""} erfolgreich hinzugefügt!`, "success");
                }
                loadInboxData(false);
              } else {
                alert("Fehler beim Hinzufügen des Posteingangs: " + (data.error || "Unbekannter Fehler"));
              }
            } catch (err) {
              alert("Fehler bei der Autorisierung: " + err.message);
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

closeSettingsBtn.addEventListener("click", () => {
  settingsModal.style.display = "none";
});

document.getElementById("auth-btn").addEventListener("click", () => {
  if (authClientCode) authClientCode.requestCode();
});

async function loadFolders() {
  document.getElementById("folder-settings-container").style.display = "block";
  document.getElementById("ai-folder-settings-container").style.display = "block";

  try {
    const res = await fetch("/api/drive/folders?parentId=root");
    const data = await res.json();
    if (data.success) {
      document.getElementById("auth-status").innerText = "Google Drive verbunden";
      document.getElementById("auth-btn").innerText = "Neu Verbinden";
      document.getElementById("auth-btn").style.display = "inline-block";

      const rawBrowseBtn = document.getElementById("raw-folder-browse");
      const aiBrowseBtn = document.getElementById("ai-folder-browse");
      const rawDisplay = document.getElementById("raw-folder-display");
      const aiDisplay = document.getElementById("ai-folder-display");

      rawBrowseBtn.disabled = false;
      aiBrowseBtn.disabled = false;
      rawDisplay.placeholder = "Klicke auf Durchsuchen...";
      aiDisplay.placeholder = "Klicke auf Durchsuchen...";

      // Pre-fill existing settings correctly from backend API
      if (window.currentSettings) {
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

        if (window.currentSettings.FOLDER_ID) {
          fetchFolderName(window.currentSettings.FOLDER_ID, rawDisplay, document.getElementById("raw-folder-id"));
        }
        if (window.currentSettings.FOLDER_ID_SORTED) {
          fetchFolderName(window.currentSettings.FOLDER_ID_SORTED, aiDisplay, document.getElementById("ai-folder-id"));
        }

        document.getElementById("ai-categories-input").value =
          window.currentSettings.AI_CATEGORIES ||
          "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige";
        document.getElementById("ai-company-input").value =
          window.currentSettings.AI_COMPANY || "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt";
        document.getElementById("monitor-drive-checkbox").checked = window.currentSettings.MONITOR_DRIVE || false;

        document.getElementById("lexoffice-settings-container").style.display = "block";
        document.getElementById("lexoffice-key-wirewire").value = window.currentSettings.LEXOFFICE_KEY_WIREWIRE || "";
        document.getElementById("butler-key-thewire-client").value = window.currentSettings.BUTTLER_KEY_THEWIRE_CLIENT || "";
        document.getElementById("butler-key-thewire-secret").value = window.currentSettings.BUTTLER_KEY_THEWIRE_SECRET || "";
        document.getElementById("butler-key-thewire-key").value = window.currentSettings.BUTTLER_KEY_THEWIRE_KEY || "";
        document.getElementById("lexoffice-key-polyxo").value = window.currentSettings.LEXOFFICE_KEY_POLYXO || "";
        
        document.getElementById("clickup-settings-container").style.display = "block";
        document.getElementById("clickup-api-key").value = window.currentSettings.CLICKUP_API_KEY || "";
        document.getElementById("clickup-list-id").value = window.currentSettings.CLICKUP_LIST_ID || "";
        document.getElementById("clickup-auto-task").checked = window.currentSettings.CLICKUP_AUTO_TASK !== false;
        document.getElementById("clickup-filter-private").checked = window.currentSettings.CLICKUP_FILTER_PRIVATE !== false;

        document.getElementById("admin-backup-container").style.display = "block";
        const driveSyncContainer = document.getElementById("drive-sync-settings-container");
        if (driveSyncContainer) driveSyncContainer.style.display = "block";

        const gmailSettingsContainer = document.getElementById("gmail-settings-container");
        if (gmailSettingsContainer) {
          gmailSettingsContainer.style.display = "block";
          const autoArchCb = document.getElementById("gmail-auto-archive-checkbox");
          if (autoArchCb) autoArchCb.checked = window.currentSettings.GMAIL_AUTO_ARCHIVE !== false;
          const monGmailCb = document.getElementById("monitor-gmail-checkbox");
          if (monGmailCb) monGmailCb.checked = window.currentSettings.MONITOR_GMAIL === true;
          const queryInput = document.getElementById("gmail-scan-query-input");
          if (queryInput) queryInput.value = window.currentSettings.GMAIL_SCAN_QUERY || "in:inbox filename:pdf";
        }

        const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
        if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";
      }

      document.getElementById("ai-prompt-settings-container").style.display = "block";
      document.getElementById("saveSettingsBtn").style.display = "block";
    } else {
      document.getElementById("auth-status").innerText = "Nicht authentifiziert.";
    }
  } catch (e) {
    document.getElementById("auth-status").innerText = "Fehler beim Laden der Ordner.";
  }
}

// --- Folder Browser Logic begin ---
const fbModal = document.getElementById("folder-browser-modal");
const fbList = document.getElementById("fb-list");
const fbBreadcrumbs = document.getElementById("fb-breadcrumbs");
const fbSelectBtn = document.getElementById("fb-select-btn");
const fbCurrentSelection = document.getElementById("fb-current-selection");

document.getElementById("raw-folder-browse").addEventListener("click", () => openFolderBrowser("raw"));
document.getElementById("ai-folder-browse").addEventListener("click", () => openFolderBrowser("ai"));
document.getElementById("closeFolderBrowserBtn").addEventListener("click", () => (fbModal.style.display = "none"));

function openFolderBrowser(target) {
  currentBrowserTarget = target;
  currentParentId = "root";
  currentBreadcrumbs = [{ id: "root", name: "Meine Ablage" }];
  selectedFbId = null;
  selectedFbName = null;
  fbCurrentSelection.innerText = "Kein Ordner";
  fbSelectBtn.disabled = true;
  renderFolderBrowser();
  fbModal.style.display = "flex";
}

async function renderFolderBrowser() {
  fbList.innerHTML = '<div style="padding: 10px; color: #777;">Lade Ordner...</div>';
  fbBreadcrumbs.innerHTML = "";
  currentBreadcrumbs.forEach((bc, idx) => {
    const span = document.createElement("span");
    span.className = "fb-breadcrumb-item";
    span.innerText = bc.name;
    span.onclick = () => {
      // Navigate back
      currentBreadcrumbs = currentBreadcrumbs.slice(0, idx + 1);
      currentParentId = bc.id;
      renderFolderBrowser();
    };
    fbBreadcrumbs.appendChild(span);
    if (idx < currentBreadcrumbs.length - 1) {
      fbBreadcrumbs.appendChild(document.createTextNode(" > "));
    }
  });

  try {
    const res = await fetch("/api/drive/folders?parentId=" + currentParentId);
    const data = await res.json();
    fbList.innerHTML = "";

    let displayFolders = data.success && data.folders ? data.folders : [];

    if (displayFolders.length === 0) {
      fbList.innerHTML = '<div style="padding: 10px; color: #777;">Dieser Ordner ist leer.</div>';
    }

    displayFolders.forEach((folder) => {
      const div = document.createElement("div");
      div.className = "fb-item";
      div.style.justifyContent = "space-between";
      if (folder.id === selectedFbId) div.classList.add("active");

      const leftGroup = document.createElement("div");
      leftGroup.style.display = "flex";
      leftGroup.style.alignItems = "center";
      leftGroup.style.gap = "10px";
      leftGroup.style.flexGrow = "1";

      const icon = document.createElement("span");
      icon.innerText = "📁";
      const nameSpan = document.createElement("span");
      nameSpan.innerText = folder.name;

      leftGroup.appendChild(icon);
      leftGroup.appendChild(nameSpan);

      const rightGroup = document.createElement("button");
      rightGroup.innerText = "Öffnen";
      rightGroup.style.padding = "4px 8px";
      rightGroup.style.margin = "0";
      rightGroup.style.fontSize = "12px";
      rightGroup.style.backgroundColor = "#6c757d";

      div.appendChild(leftGroup);
      div.appendChild(rightGroup);

      // Click on row to select
      leftGroup.addEventListener("click", () => {
        document.querySelectorAll(".fb-item").forEach((el) => el.classList.remove("active"));
        div.classList.add("active");
        selectedFbId = folder.id;
        selectedFbName = folder.name;
        fbCurrentSelection.innerText = folder.name;
        fbSelectBtn.disabled = false;
      });

      // Click on "Öffnen" navs into folder
      rightGroup.addEventListener("click", (e) => {
        e.stopPropagation();
        currentParentId = folder.id;
        currentBreadcrumbs.push({ id: folder.id, name: folder.name });
        selectedFbId = null;
        selectedFbName = null;
        fbCurrentSelection.innerText = "Kein Ordner";
        fbSelectBtn.disabled = true;
        renderFolderBrowser();
      });

      // Keep double click for convenience
      div.addEventListener("dblclick", () => {
        rightGroup.click();
      });

      fbList.appendChild(div);
    });
  } catch (err) {
    fbList.innerHTML = '<div style="padding: 10px; color: red;">Fehler beim Laden.</div>';
  }
}

fbSelectBtn.addEventListener("click", () => {
  if (!selectedFbId) return;
  if (currentBrowserTarget === "raw") {
    document.getElementById("raw-folder-display").value = selectedFbName;
    document.getElementById("raw-folder-id").value = selectedFbId;
  } else if (currentBrowserTarget === "ai") {
    document.getElementById("ai-folder-display").value = selectedFbName;
    document.getElementById("ai-folder-id").value = selectedFbId;
  }
  fbModal.style.display = "none";
});
// --- Folder Browser Logic end ---

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

  const clickupApiKey = document.getElementById("clickup-api-key").value.trim();
  const clickupListId = document.getElementById("clickup-list-id").value.trim();
  const clickupAutoTask = document.getElementById("clickup-auto-task").checked;
  const clickupFilterPrivate = document.getElementById("clickup-filter-private").checked;

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
      LEXOFFICE_KEY_WIREWIRE: lexKeyWirewire,
      BUTTLER_KEY_THEWIRE_CLIENT: butlerKeyClient,
      BUTTLER_KEY_THEWIRE_SECRET: butlerKeySecret,
      BUTTLER_KEY_THEWIRE_KEY: butlerKeyKey,
      LEXOFFICE_KEY_POLYXO: lexKeyPolyxo,
      CLICKUP_API_KEY: clickupApiKey,
      CLICKUP_LIST_ID: clickupListId,
      CLICKUP_AUTO_TASK: clickupAutoTask,
      CLICKUP_FILTER_PRIVATE: clickupFilterPrivate,
    }),
  });

  if (res.ok) {
    alert("Einstellungen erfolgreich gespeichert!");
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
const confirmClearModal = document.getElementById("confirm-clear-modal");
const confirmClearBtn = document.getElementById("confirm-clear-btn");
const cancelClearBtn = document.getElementById("cancel-clear-btn");

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
        if (simJob.result.company) companyHtml = `<br>Unternehmen: ${simJob.result.company}`;
        if (simJob.result.category) categoryHtml = `<br>Kategorie: ${simJob.result.category}`;
        if (simJob.result.tags && Array.isArray(simJob.result.tags)) tagsHtml = `<br>Tags: ${simJob.result.tags.slice(0, 3).join(", ")}`;
        
        const imgSrc = `/api/jobs/${simJob.id}/thumbnail`;
        previewHtml = `
          <div style="margin-top: 10px; text-align: center;">
            <img src="${imgSrc}" loading="lazy" style="height: 250px; aspect-ratio: 1 / 1.414; object-fit: cover; border-radius: 4px; border: 1px solid #ccc; background: #fff;" title="Vorschau" alt="Vorschau" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
          </div>
        `;
      }
      
      detailsHtml = `
        <div style="text-align: left; background: #f8f9fa; padding: 10px; border-radius: 5px; margin-top: 15px; font-size: 13px; border: 1px solid #ddd; line-height: 1.5; overflow: hidden;">
          <strong style="color: #333;">Ähnliches Dokument gefunden:</strong><br>
          Original Name: ${simJob.originalName}<br>
          Datum: ${displayDate}<br>
          Status: ${statusText}${companyHtml}${categoryHtml}${tagsHtml}
          ${previewHtml}
        </div>
      `;
    }
    
    text.innerHTML = `Die Datei "<strong>${filename}</strong>" existiert bereits oder eine ähnliche Datei wurde bereits hochgeladen. Möchtest du die Verarbeitung fortsetzen oder abbrechen?${detailsHtml}`;
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

function startPolling() {
  const fetchStatus = async () => {
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
  };

  fetchStatus();
  if (!pollingInterval) {
    pollingInterval = setInterval(fetchStatus, 5000); // 5 Sekunden Polling
  }
}

// Initialisiere Polling / Laden aller Jobs beim Seitenstart
startPolling();

// Startseite Filter & Paginierung State
let startSearchQuery = "";
let startDateFilter = "alle";
let startCompanyFilter = "alle";
let startSelectedCategories = new Set();
let startCurrentPage = 1;
const START_PAGE_SIZE = 50;

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
    const res = job.result || {};
    const dateVal = res.documentDate && res.documentDate !== "unknown" ? new Date(res.documentDate) : (job.uploadDate ? new Date(job.uploadDate) : null);
    if (dateVal && !isNaN(dateVal.getTime())) {
      const diffDays = (now - dateVal) / (1000 * 60 * 60 * 24);
      const year = dateVal.getFullYear();
      if (diffDays <= 7) count7Days++;
      if (diffDays <= 30) count30Days++;
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
    btn.className = `btn btn-sm ${isSelected ? 'btn-primary text-white shadow-sm' : 'btn-outline-secondary'} start-cat-bubble`;
    btn.style.cssText = "border-radius: 16px; font-size: 12px; padding: 2px 10px; transition: all 0.15s ease;";
    btn.innerHTML = `${cat} <span class="badge ${isSelected ? 'bg-white text-primary' : 'bg-secondary-subtle text-secondary'} rounded-pill" style="font-size: 10px; font-weight: normal; margin-left: 2px;">(${count})</span>${isSelected ? ' <span class="material-symbols-outlined" style="font-size: 13px; vertical-align: -2px;">check</span>' : ''}`;
    
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

  const resetBtn = document.getElementById("start-reset-filters-btn");
  if (resetBtn) {
    const hasFilters = startSearchQuery || startDateFilter !== "alle" || startCompanyFilter !== "alle" || startSelectedCategories.size > 0;
    resetBtn.style.display = hasFilters ? "inline-block" : "none";
  }
}

function filterActiveJobs(jobs) {
  return jobs.filter((job) => {
    const res = job.result || {};

    // 1. Search Query
    if (startSearchQuery) {
      const q = startSearchQuery.toLowerCase();
      const title = (res.full || job.originalName || "").toLowerCase();
      const comp = (res.company || "").toLowerCase();
      const targetComp = (job.targetCompany || "").toLowerCase();
      const invNum = (res.invoiceNumber || job.invoiceNumber || "").toLowerCase();
      const cat = (res.category || "").toLowerCase();
      const tags = (res.tags && Array.isArray(res.tags) ? res.tags.join(" ") : "").toLowerCase();
      const amtStr = res.invoiceAmmount ? (res.invoiceAmmount / 100).toFixed(2).replace(".", ",") : "";

      const matches =
        title.includes(q) ||
        comp.includes(q) ||
        targetComp.includes(q) ||
        invNum.includes(q) ||
        cat.includes(q) ||
        tags.includes(q) ||
        amtStr.includes(q);

      if (!matches) return false;
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
      const dateVal = res.documentDate && res.documentDate !== "unknown" ? new Date(res.documentDate) : (job.uploadDate ? new Date(job.uploadDate) : null);
      if (dateVal && !isNaN(dateVal.getTime())) {
        const now = new Date();
        const diffDays = (now - dateVal) / (1000 * 60 * 60 * 24);
        const year = dateVal.getFullYear();

        if (startDateFilter === "7days" && diffDays > 7) return false;
        if (startDateFilter === "30days" && diffDays > 30) return false;
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
  if (document.querySelector('.category-picker-box')) {
    // Ein Picker ist offen, wir überspringen das Neu-Zeichnen,
    // damit das Menü nicht durch den 5-Sekunden-Refresh geschlossen wird.
    return;
  }

  renderStartCategoryBubbles();
  updateStartFilterDropdownCounts();

  const filteredJobs = filterActiveJobs(activeJobs);
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
    div.className = `job-item ${job.status}`;
    if (job.isPrivate) {
      div.style.borderLeft = "4px solid #f44336";
      div.style.backgroundColor = "#fff8f8";
    }

    let privateBadgeHtml = '';
    if (window.isAdmin) {
        const bg = job.isPrivate ? '#f44336' : '#e0e0e0';
        const color = job.isPrivate ? 'white' : '#666';
        const icon = job.isPrivate ? 'lock' : 'lock_open';
        const text = job.isPrivate ? 'PRIVAT' : 'ÖFFENTLICH';
        privateBadgeHtml = `<span class="toggle-private-pill" data-job-id="${job.id}" style="cursor: pointer; background: ${bg}; color: ${color}; padding: 2px 8px; border-radius: 12px; font-size: 10px; margin-left: 8px; vertical-align: middle; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s; user-select: none;" title="Klicken zum Ändern" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'">
            <span class="material-symbols-outlined" style="font-size: 12px;">${icon}</span> ${text}
        </span>`;
    } else if (job.isPrivate) {
        privateBadgeHtml = '<span style="background: #f44336; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; vertical-align: middle;">🔒 PRIVAT</span>';
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
        lexofficeBadgeHtml = `<span style="background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; vertical-align: middle;" title="An Buchhaltung übertragen">✓ ${providerLabel} (${activeCompany})</span>`;
    }

    let duplicateBadgeHtml = '';
    if (job.suspectedDuplicate) {
        duplicateBadgeHtml = `<span class="badge-open-duplicate-compare" data-job-id="${job.id}" style="background: #ff9800; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; margin-left: 6px; vertical-align: middle; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.2); font-weight: 500;" title="Klicken, um Beleg mit erkannten Duplikaten gegenüberzustellen">⚠️ DUPLIKAT VERDACHT</span>`;
    }

    let statusText =
      job.status === "pending"
        ? "In der Warteschlange..."
        : job.status === "processing"
        ? "Wird verarbeitet (KI)..."
        : job.status === "completed"
        ? "Erfolgreich abgeschlossen"
        : "Fehlergeschlagen";

    const displayDate = job.uploadDate ? new Date(job.uploadDate).toLocaleString("de-DE") : "-";

    let resultHtml = "";
    let previewHtml = "";

    if (job.status === "completed" && job.result) {
      const tagsStr = job.result.tags && Array.isArray(job.result.tags) ? job.result.tags.slice(0, 3).join(", ") : "-";
      const isInvoiceStr = job.result.isInvoice ? "Ja" : "Nein";
      const durationStr = job.result.duration ? `${job.result.duration} Sekunden` : "-";

      let invoiceHtml = "";
      if (job.result.isInvoice || job.isInvoice) {
        const invNum = (job.invoiceNumber || job.result.invoiceNumber) && (job.invoiceNumber || job.result.invoiceNumber) !== "none" ? (job.invoiceNumber || job.result.invoiceNumber) : "-";
        const invAmtRaw = (job.invoiceAmmount !== undefined ? job.invoiceAmmount : job.result.invoiceAmmount) || 0;
        const invAmtFormatted = (invAmtRaw / 100).toFixed(2).replace('.', ',');
        invoiceHtml = `
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Rechnungsnummer:</strong> ${invNum}<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Rechnungsbetrag:</strong> ${invAmtFormatted} €<br>`;
      }

      const imgSrc = `/api/jobs/${job.id}/thumbnail`;
      previewHtml = `<a href="${
        job.result.webViewLink || "#"
      }" target="_blank" class="pdf-preview-container">
                      <img src="${imgSrc}" loading="lazy" alt="PDF Vorschau" class="pdf-preview-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
                  </a>`;

      let clickupDetailsHtml = `
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--md-sys-color-outline-variant, #CAC4D0); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">ClickUp:</strong> 
            ${job.clickup && job.clickup.taskId
              ? `<a href="${job.clickup.taskUrl || `https://app.clickup.com/t/${job.clickup.taskId}`}" target="_blank" style="color: #7b68ee; font-weight: 500; text-decoration: none;">Task #${job.clickup.taskId} (${job.clickup.status || 'offen'})</a>`
              : `<span style="color: #888;">Nicht übertragen</span>`
            }
          </div>
          ${window.isAdmin ? `
            <button class="btn btn-sm btn-outline-primary btn-manual-clickup-transfer" data-job-id="${job.id}" style="border-radius: 12px; font-size: 12px; padding: 2px 10px; border-color: #7b68ee; color: #7b68ee; display: inline-flex; align-items: center; gap: 4px;">
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
                ? `<span style="color: #2e7d32; font-weight: 500;">✓ In ${providerLabel} (${activeCompany})</span>`
                : `<span style="color: #888;">Nicht übertragen</span>`
              }
            </div>
            <button class="btn btn-sm ${isLexTransferred ? 'btn-outline-success' : 'btn-outline-primary'} btn-manual-lexoffice-sync" data-job-id="${job.id}" style="border-radius: 12px; font-size: 12px; padding: 2px 10px; display: inline-flex; align-items: center; gap: 4px;">
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
          <button type="button" class="btn btn-sm btn-manual-clickup-transfer d-inline-flex align-items-center gap-1" data-job-id="${job.id}" 
            style="border-radius: 12px; font-size: 12px; padding: 3px 10px; font-weight: 500; transition: all 0.2s ease; cursor: pointer; ${
              isClickupSynced
                ? 'background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7;'
                : 'background: #ffffff; color: #7b68ee; border: 1px solid #7b68ee;'
            }" 
            title="${isClickupSynced ? `ClickUp Task #${clickupTaskId} (${clickupStatus}) - Klicken zum Aktualisieren` : 'Zu ClickUp übertragen'}">
            <span class="material-symbols-outlined" style="font-size: 15px; color: ${isClickupSynced ? '#2e7d32' : '#7b68ee'};">${isClickupSynced ? 'check_circle' : 'cloud_upload'}</span>
            <span>${isClickupSynced ? '✓ ClickUp' : 'ClickUp'}</span>
          </button>
        `;

        buchhaltungButtonHtml = `
          <button type="button" class="btn btn-sm btn-manual-lexoffice-sync d-inline-flex align-items-center gap-1" data-job-id="${job.id}" 
            style="border-radius: 12px; font-size: 12px; padding: 3px 10px; font-weight: 500; transition: all 0.2s ease; cursor: pointer; ${
              isLexTransferred
                ? 'background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7;'
                : 'background: #ffffff; color: #0d6efd; border: 1px solid #0d6efd;'
            }" 
            title="${isLexTransferred ? `Bereits in ${providerLabel} (${activeCompany}) synchronisiert - Klicken für Details / erneuten Abgleich` : `In Buchhaltung (${providerLabel}) übertragen`}">
            <span class="material-symbols-outlined" style="font-size: 15px; color: ${isLexTransferred ? '#2e7d32' : '#0d6efd'};">${isLexTransferred ? 'check_circle' : 'sync'}</span>
            <span>${isLexTransferred ? '✓ Buchhaltung' : 'Buchhaltung'}</span>
          </button>
        `;
      }

      resultHtml = `
                    <div style="margin-top: 10px; width: 100%;">
                      <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
                        <button type="button" class="btn-toggle-details btn btn-sm border-0 d-inline-flex align-items-center gap-1" data-job-id="${job.id}" style="color: var(--md-sys-color-primary, #1A1A1A); font-weight: 500; font-size: 13px; padding: 3px 10px; border-radius: 12px; background: var(--md-sys-color-surface-container-high, #E7E0EC); user-select: none; cursor: pointer;">
                          <span class="material-symbols-outlined" style="font-size: 16px;">info</span> Details
                        </button>
                        ${clickupButtonHtml}
                        ${buchhaltungButtonHtml}
                      </div>
                      <details class="job-result" data-job-id="${job.id}" style="transition: all 0.3s; width: 100%;" ${openStates[job.id] ? "open" : ""}>
                        <summary style="display: none;"></summary>
                        <div style="margin-top: 6px; padding: 14px; background: var(--md-sys-color-surface, #fff); border-radius: var(--md-sys-shape-corner-medium, 16px); border: 1px solid var(--md-sys-color-outline-variant, #CAC4D0); margin-right: -65px; font-size: 14px; color: var(--md-sys-color-on-surface, #1C1B1F); line-height: 1.6; box-shadow: var(--md-sys-elevation-1);">
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Dateiname:</strong> ${
                                job.result.full
                            }<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Dokumentendatum:</strong> ${
                                job.result.documentDate || "-"
                            }<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Unternehmen:</strong> ${
                                job.result.company || "-"
                            }<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Kategorie:</strong> 
                            <div style="position: relative; display: inline-block;">
                                <span class="category-editable" data-job-id="${job.id}" data-current-cat="${job.result.category || '-'}" style="cursor: pointer; padding: 4px 10px; border-radius: 16px; background: var(--md-sys-color-primary-container, #eaddff); color: var(--md-sys-color-on-primary-container, #21005d); font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; transition: filter 0.2s; margin-left: 4px; margin-bottom: 4px;" title="Klicken zum Ändern" onmouseover="this.style.filter='brightness(0.95)'" onmouseout="this.style.filter='none'">
                                    ${job.result.category || "-"} <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>
                                </span>
                            </div><br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Tags:</strong> ${tagsStr}<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Rechnung:</strong> ${isInvoiceStr}<br>
${invoiceHtml}                            <strong style="color: var(--md-sys-color-primary, #1A1A1A);">Verarbeitungszeit:</strong> ${durationStr}
${clickupDetailsHtml}
${lexofficeDetailsHtml}
                        </div>
                      </details>
                    </div>
                `;
    } else if (job.status === "error") {
      resultHtml = `<div class="job-result error">${job.error || "Unbekannter Fehler"}</div>`;
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

    div.innerHTML = `
                <div style="padding-right: 75px; min-height: 84px; display: flex; flex-direction: column; justify-content: flex-start;">
                    <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;">
                        <div class="job-title" style="display: flex; flex-direction: column; gap: 4px;">
                            <span style="word-break: break-word; line-height: 1.2; display: flex; align-items: center; flex-wrap: wrap;">
                                ${job.originalName}
                                ${privateBadgeHtml}
                                ${lexofficeBadgeHtml}
                                ${duplicateBadgeHtml}
                            </span>
                            <span style="font-size: 12px; font-weight: normal; color: #888;">Hochgeladen am: ${displayDate}</span>
                        </div>
                        <div class="job-status" style="margin-top: 4px;">${statusText}</div>
                    </div>
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
// --- Deep Document Content Search (OCR & Full-Text) ---
// ==========================================
const deepSearchInput = document.getElementById("deep-search-input");
const deepSearchBtn = document.getElementById("deep-search-btn");
const deepSearchResultsCard = document.getElementById("deep-search-results-card");
const deepSearchHeading = document.getElementById("deep-search-heading");
const deepSearchBadge = document.getElementById("deep-search-badge");
const deepSearchCloseBtn = document.getElementById("deep-search-close-btn");
const deepSearchLoading = document.getElementById("deep-search-loading");
const deepSearchResultsList = document.getElementById("deep-search-results-list");

function highlightQueryText(text, query) {
  if (!text || !query) return text || "";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  return text.replace(regex, `<mark class="bg-warning-subtle text-dark fw-bold px-1 rounded">$1</mark>`);
}

const performDeepSearch = async () => {
  if (!deepSearchInput) return;
  const query = deepSearchInput.value.trim();
  if (query.length < 2) {
    alert("Bitte mindestens 2 Zeichen für die Volltextsuche eingeben.");
    return;
  }

  if (deepSearchResultsCard) deepSearchResultsCard.style.display = "block";
  if (deepSearchLoading) deepSearchLoading.style.display = "block";
  if (deepSearchResultsList) deepSearchResultsList.innerHTML = "";
  if (deepSearchHeading) deepSearchHeading.innerText = `Volltextsuche: "${query}"`;
  if (deepSearchBadge) deepSearchBadge.innerText = "Suche läuft...";

  try {
    const res = await fetch("/api/documents/deep-search?q=" + encodeURIComponent(query));
    const data = await res.json();

    if (deepSearchLoading) deepSearchLoading.style.display = "none";

    if (!data.success) {
      if (deepSearchResultsList) {
        deepSearchResultsList.innerHTML = `<div class="text-danger p-3">${data.error || "Suche fehlgeschlagen."}</div>`;
      }
      if (deepSearchBadge) deepSearchBadge.innerText = "Fehler";
      return;
    }

    const results = data.results || [];
    if (deepSearchBadge) deepSearchBadge.innerText = `${results.length} Treffer`;

    if (results.length === 0) {
      if (deepSearchResultsList) {
        deepSearchResultsList.innerHTML = `
          <div class="text-center py-4 text-muted">
            <span class="material-symbols-outlined" style="font-size: 36px; color: #aaa;">search_off</span>
            <div class="mt-2 fw-medium">Keine Dokumente mit diesem Textinhalt gefunden.</div>
            <div class="small text-muted">Tipp: Probiere alternative Suchbegriffe (z. B. Teile der Rechnungsnummer, Firmenname oder Schlagwörter).</div>
          </div>
        `;
      }
      return;
    }

    let html = "";
    results.forEach((item) => {
      const dateFormatted = item.date
        ? new Date(item.date).toLocaleDateString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Unbekanntes Datum";

      const isDrive = item.type === "gdrive";
      const sourceBadge = isDrive
        ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle d-inline-flex align-items-center gap-1" style="font-size: 11px;"><span class="material-symbols-outlined" style="font-size: 12px;">cloud</span> Google Drive</span>`
        : `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle d-inline-flex align-items-center gap-1" style="font-size: 11px;"><span class="material-symbols-outlined" style="font-size: 12px;">upload_file</span> ${item.source}</span>`;

      const titleHighlighted = highlightQueryText(item.name, query);
      const snippetHighlighted = highlightQueryText(item.snippet, query);

      html += `
        <div class="card p-3 border shadow-sm" style="border-radius: 10px; background-color: #fdfdfd; transition: all 0.2s ease;">
          <div class="d-flex gap-3 align-items-start">
            <div class="flex-shrink-0 pt-1">
              ${
                item.thumbnailLink
                  ? `<img src="${item.thumbnailLink}" style="width: 44px; height: 44px; object-fit: cover; border-radius: 8px; border: 1px solid #dee2e6;" onerror="this.outerHTML='<span class=\\'material-symbols-outlined text-danger\\' style=\\'font-size: 36px;\\'>picture_as_pdf</span>';" />`
                  : `<span class="material-symbols-outlined text-danger" style="font-size: 36px;">picture_as_pdf</span>`
              }
            </div>
            <div class="flex-grow-1" style="min-width: 0;">
              <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-1">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                  <strong class="text-dark" style="font-size: 14px;">${titleHighlighted}</strong>
                  ${sourceBadge}
                </div>
                <span class="text-muted small" style="font-size: 12px;">${dateFormatted}</span>
              </div>

              <!-- Matching Content Snippet -->
              <div class="p-2 my-2 rounded border bg-light text-secondary" style="font-size: 12.5px; line-height: 1.4; border-left: 3px solid #0d6efd !important;">
                <span class="text-muted small fw-bold">Fundstelle im Text:</span>
                <div class="mt-1 font-monospace" style="font-size: 12px;">${snippetHighlighted}</div>
              </div>

              <!-- Action Buttons -->
              <div class="d-flex justify-content-end align-items-center gap-2 pt-1">
                ${
                  item.isLocal
                    ? `<a href="/api/jobs/${item.jobId}/file" target="_blank" class="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" style="border-radius: 6px; font-size: 12px; padding: 3px 10px;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">visibility</span>
                        <span>Dokument öffnen</span>
                      </a>`
                    : ""
                }
                ${
                  item.webViewLink
                    ? `<a href="${item.webViewLink}" target="_blank" class="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" style="border-radius: 6px; font-size: 12px; padding: 3px 10px;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">open_in_new</span>
                        <span>In Google Drive öffnen</span>
                      </a>`
                    : ""
                }
              </div>
            </div>
          </div>
        </div>
      `;
    });

    if (deepSearchResultsList) deepSearchResultsList.innerHTML = html;
  } catch (e) {
    if (deepSearchLoading) deepSearchLoading.style.display = "none";
    if (deepSearchResultsList) {
      deepSearchResultsList.innerHTML = `<div class="text-danger p-3">Netzwerkfehler bei der Volltextsuche: ${e.message}</div>`;
    }
  }
};

if (deepSearchBtn) deepSearchBtn.addEventListener("click", performDeepSearch);
if (deepSearchInput) {
  deepSearchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") performDeepSearch();
  });
}
if (deepSearchCloseBtn) {
  deepSearchCloseBtn.addEventListener("click", () => {
    if (deepSearchResultsCard) deepSearchResultsCard.style.display = "none";
  });
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
    
    // Optimistic UI update
    editableSpan.innerHTML = `${newCategory} <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>`;
    editableSpan.setAttribute('data-current-cat', newCategory);

    // Call API
    try {
        const res = await fetch(`/api/jobs/${jobId}/category`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: newCategory })
        });
        if (res.ok) {
          const job = activeJobs.find(j => j.id === jobId);
          if (job && job.result) {
            job.result.category = newCategory;
          }
        }
    } catch(err) {
        console.error("Fehler beim Ändern der Kategorie", err);
    }
    return;
  }

  // Handle click on the main editable pill
  const target = e.target.closest('.category-editable');
  if (target) {
    // Check if we already have a picker box open here
    if (target.parentElement.querySelector('.category-picker-box')) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    // Close other pickers
    document.querySelectorAll('.category-picker-box').forEach(box => box.remove());

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
  }
});


// Close picker when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.category-picker-box') && !e.target.closest('.category-editable')) {
        const boxes = document.querySelectorAll('.category-picker-box');
        if (boxes.length > 0) {
            boxes.forEach(box => box.remove());
            renderJobs();
        }
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
  let dateStr = null;
  if (job.result && job.result.documentDate && job.result.documentDate !== "unknown") {
    dateStr = job.result.documentDate; // Format DD.MM.YYYY
  }

  let year = null;
  let month = null;

  if (dateStr && dateStr.includes(".")) {
    const parts = dateStr.split(".");
    if (parts.length === 3) {
      month = parseInt(parts[1], 10);
      year = parts[2].trim();
      if (year.length === 2) year = "20" + year;
    }
  }

  if (!year || !month) {
    const d = new Date(job.uploadDate || Date.now());
    year = d.getFullYear().toString();
    month = d.getMonth() + 1;
  }

  let quarter = "Q1";
  if (month >= 1 && month <= 3) quarter = "Q1";
  else if (month >= 4 && month <= 6) quarter = "Q2";
  else if (month >= 7 && month <= 9) quarter = "Q3";
  else if (month >= 10 && month <= 12) quarter = "Q4";

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

    // 0. Live Text Search filter
    if (searchQuery) {
      const title = (res.full || job.originalName || "").toLowerCase();
      const comp = (res.company || "").toLowerCase();
      const targetComp = (job.targetCompany || "").toLowerCase();
      const invNum = (res.invoiceNumber || job.invoiceNumber || "").toLowerCase();
      const cat = (res.category || "").toLowerCase();
      const tags = (res.tags && Array.isArray(res.tags) ? res.tags.join(" ") : "").toLowerCase();
      const amtStr = res.invoiceAmmount ? (res.invoiceAmmount / 100).toFixed(2).replace(".", ",") : "";

      const matches =
        title.includes(searchQuery) ||
        comp.includes(searchQuery) ||
        targetComp.includes(searchQuery) ||
        invNum.includes(searchQuery) ||
        cat.includes(searchQuery) ||
        tags.includes(searchQuery) ||
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

  card.innerHTML = `
    <div class="card-body p-3">
      <div class="d-flex gap-3 align-items-start">
        <div class="flex-shrink-0">
          ${thumbnailHtml}
        </div>
        <div class="flex-grow-1" style="min-width: 0;">
          <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
            ${isInvoiceBadge}
            <span class="badge bg-primary-subtle text-primary border border-primary-subtle">${res.company || "Unbekannt"}</span>
            ${res.category ? `<span class="badge bg-light text-dark border">${res.category}</span>` : ""}
            ${res.documentDate && res.documentDate !== "unknown" ? `<span class="text-muted small"><span class="material-symbols-outlined align-text-top" style="font-size: 14px;">calendar_today</span> ${res.documentDate}</span>` : ""}
          </div>
          <h6 class="mb-1 fw-bold text-dark text-truncate" style="font-size: 14px;" title="${res.full || job.originalName}">${res.full || job.originalName}</h6>
          <div class="small text-muted d-flex gap-3 flex-wrap">
            ${res.invoiceNumber && res.invoiceNumber !== "none" ? `<span>Rechnungs-Nr: <strong>${res.invoiceNumber}</strong></span>` : ""}
            ${amountFormatted ? `<span class="text-success font-monospace">Betrag: <strong>${amountFormatted}</strong></span>` : ""}
          </div>
          ${lexStatusBadgeHtml ? `<div class="lexoffice-status-area mt-2 small">${lexStatusBadgeHtml}</div>` : ""}
        </div>
      </div>

      <div class="border-top mt-2 pt-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="d-flex align-items-center gap-2">
          <span class="text-muted small" style="font-size: 12px; font-weight: 500;">ClickUp:</span>
          ${job.clickup && job.clickup.taskId
            ? `<a href="${job.clickup.taskUrl || `https://app.clickup.com/t/${job.clickup.taskId}`}" target="_blank" class="badge text-decoration-none" style="background: #7b68ee; color: white;">#${job.clickup.taskId} (${job.clickup.status || 'offen'})</a>`
            : `<span class="badge bg-light text-secondary border">Nicht übertragen</span>`
          }
        </div>
        <button class="btn btn-sm btn-outline-secondary rechnung-clickup-btn d-flex align-items-center gap-1" data-job-id="${job.id}" style="border-radius: 20px; padding: 4px 12px; font-size: 12px; border-color: #7b68ee; color: #7b68ee;">
          <span class="material-symbols-outlined" style="font-size: 15px;">cloud_upload</span>
          <span>${job.clickup && job.clickup.taskId ? "ClickUp aktualisieren" : "Zu ClickUp"}</span>
        </button>
      </div>

      ${window.isAdmin ? `
        <div class="border-top mt-2 pt-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div class="d-flex align-items-center gap-2">
            <span class="text-muted small" style="font-size: 12px; font-weight: 500;">Buchhaltung:</span>
            ${activeTransfer
              ? `<span class="badge bg-success-subtle text-success border border-success-subtle">${providerLabel} (${activeCompany})</span>`
              : `<span class="badge bg-light text-secondary border">Offen</span>`
            }
          </div>
          <button class="btn btn-sm ${activeTransfer ? 'btn-outline-success' : 'btn-primary'} rechnung-lexoffice-btn d-flex align-items-center gap-1" data-job-id="${job.id}" style="border-radius: 20px; padding: 4px 14px; font-weight: 500; font-size: 12px; white-space: nowrap;">
            <span class="material-symbols-outlined" style="font-size: 16px;">${activeTransfer ? 'check_circle' : 'sync'}</span>
            <span>${activeTransfer ? '✓ Synchronisiert' : 'Buchhaltung Sync'}</span>
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

const lexSyncModal = document.getElementById("lexoffice-sync-modal");
const lexModalHeading = document.getElementById("lex-modal-heading");
const lexModalProviderBadge = document.getElementById("lex-modal-provider-badge");
const lexModalCloseBtn = document.getElementById("lex-modal-close-btn");
const lexModalCancelBtn = document.getElementById("lex-modal-cancel-btn");
const lexModalSubmitBtn = document.getElementById("lex-modal-submit-btn");
const lexModalSubmitText = document.getElementById("lex-modal-submit-text");
const lexModalCompanySelect = document.getElementById("lex-modal-company-select");
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
    lexDocDate.innerText = `📅 ${res.documentDate && res.documentDate !== "unknown" ? res.documentDate : (job.uploadDate ? new Date(job.uploadDate).toLocaleDateString("de-DE") : "-")}`;
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
  const defaultCompany = job.targetCompany || detectDefaultTargetCompany(res.company) || "thewire";
  if (lexModalCompanySelect) {
    lexModalCompanySelect.value = defaultCompany;
  }

  await checkLexofficeTarget(jobId, lexModalCompanySelect ? lexModalCompanySelect.value : "thewire");
}

if (lexModalCompanySelect) {
  lexModalCompanySelect.addEventListener("change", async () => {
    if (currentLexJobId) {
      await checkLexofficeTarget(currentLexJobId, lexModalCompanySelect.value);
    }
  });
}

async function checkLexofficeTarget(jobId, companyKey) {
  if (!lexModalSubmitBtn || !lexModalStatusContainer) return;

  const isButler = companyKey === "thewire";
  const expectedProvider = isButler ? "BuchhaltungsButler" : "Lexoffice";

  if (lexModalProviderBadge) {
    lexModalProviderBadge.innerText = expectedProvider;
    lexModalProviderBadge.className = isButler
      ? "badge bg-info-subtle text-info-emphasis border border-info-subtle small"
      : "badge bg-primary-subtle text-primary border border-primary-subtle small";
  }

  lexModalSubmitBtn.disabled = true;
  lexModalStatusContainer.innerHTML = `
    <div class="d-flex align-items-center gap-2 text-muted">
      <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
      <span>Validiere ${expectedProvider} API & prüfe Status für <strong>${companyKey}</strong>...</span>
    </div>
  `;

  try {
    const res = await fetch("/api/accounting/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, companyKey }),
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

    const providerName = data.providerName || expectedProvider;

    // Check API validity
    if (!data.apiValid) {
      lexModalStatusContainer.innerHTML = `
        <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-start gap-2">
          <span class="material-symbols-outlined flex-shrink-0" style="font-size: 20px;">warning</span>
          <div>
            <strong>API-Prüfung fehlgeschlagen:</strong><br>
            ${data.apiError || `Keine gültigen Zugangsdaten für ${providerName} (${companyKey}) hinterlegt.`}
            <div class="small mt-1 text-muted">Bitte hinterlege die Zugangsdaten in den Einstellungen.</div>
          </div>
        </div>
      `;
      lexModalSubmitBtn.disabled = true;
      lexModalSubmitBtn.className = "btn btn-secondary px-4 d-flex align-items-center gap-2";
      if (lexModalSubmitText) lexModalSubmitText.innerText = "API-Key erforderlich";
      return;
    }

    // 1. Check if Live Match found in accounting system (Lexoffice / BuchhaltungsButler)
    const hasLiveMatch = data.liveSearch && data.liveSearch.found && data.liveSearch.matches && data.liveSearch.matches.length > 0;
    
    let liveMatchHtml = "";
    if (hasLiveMatch) {
      const topMatch = data.liveSearch.matches[0];
      const matchBadge = `<span class="badge bg-warning text-dark border border-warning-subtle">${topMatch.matchReasons.length} Übereinstimmungen</span>`;
      
      const reasonsList = topMatch.matchReasons.map(r => `<li><span class="text-success fw-medium">✓</span> ${r}</li>`).join("");

      liveMatchHtml = `
        <div class="p-3 mb-2 rounded-3 border bg-warning-subtle text-dark" style="border-color: #ffc107 !important;">
          <div class="d-flex align-items-center justify-content-between flex-wrap gap-1 mb-2">
            <div class="d-flex align-items-center gap-1 fw-bold" style="font-size: 13.5px; color: #664d03;">
              <span class="material-symbols-outlined" style="font-size: 20px;">find_in_page</span>
              <span>Beleg bereits in ${providerName} gefunden!</span>
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
            <button type="button" class="btn btn-sm btn-outline-primary btn-open-compare-modal d-inline-flex align-items-center gap-1" data-job-id="${jobId}" data-company="${companyKey}" data-match-index="0" style="border-radius: 12px; font-size: 12px; padding: 4px 12px; font-weight: 500;">
              <span class="material-symbols-outlined" style="font-size: 16px;">compare</span>
              <span>Belege gegenüberstellen (Vorschau)</span>
            </button>
            <button type="button" class="btn btn-sm btn-success btn-mark-synced-direct d-inline-flex align-items-center gap-1" data-job-id="${jobId}" data-company="${companyKey}" data-file-id="${topMatch.id}" style="border-radius: 12px; font-size: 12px; padding: 4px 12px;">
              <span class="material-symbols-outlined" style="font-size: 16px;">check_circle</span>
              <span>Als synchronisiert markieren</span>
            </button>
          </div>
        </div>
      `;
    }

    // 2. Check if already marked as transferred locally or found via live search
    if (data.alreadyTransferred && data.transferredInfo) {
      const dateFormatted = new Date(data.transferredInfo.transferredAt).toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const fileId = data.transferredInfo.fileId || data.transferredInfo.lexofficeFileId || "-";
      lexModalStatusContainer.innerHTML = `
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
      lexModalStatusContainer.innerHTML = liveMatchHtml;
      lexModalSubmitBtn.disabled = false;
      lexModalSubmitBtn.className = "btn btn-outline-warning text-dark px-4 d-flex align-items-center gap-2";
      if (lexModalSubmitText) lexModalSubmitText.innerText = "Trotzdem übertragen (Duplikat)";
    } else {
      lexModalStatusContainer.innerHTML = `
        <div class="p-2 rounded bg-info-subtle text-info-emphasis border border-info-subtle d-flex align-items-start gap-2">
          <span class="material-symbols-outlined text-primary flex-shrink-0" style="font-size: 20px;">cloud_upload</span>
          <div style="font-size: 13px;">
            <strong>Bereit zum Upload:</strong><br>
            API verbunden mit <strong>${data.organizationName || providerName}</strong>.<br>
            <span class="text-success small fw-medium">✓ Kein übereinstimmender Beleg in ${providerName} gefunden.</span>
          </div>
        </div>
      `;
      lexModalSubmitBtn.disabled = false;
      lexModalSubmitBtn.className = "btn btn-primary px-4 d-flex align-items-center gap-2";
      if (lexModalSubmitText) lexModalSubmitText.innerText = "Upload starten";
    }
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
    if (!currentLexJobId || !lexModalCompanySelect) return;
    const jobId = currentLexJobId;
    const companyKey = lexModalCompanySelect.value;
    const isForce = currentLexCheckData && currentLexCheckData.alreadyTransferred;
    const providerName = currentLexCheckData?.providerName || (companyKey === "thewire" ? "BuchhaltungsButler" : "Lexoffice");

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
      const res = await fetch("/api/accounting/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, companyKey, force: isForce }),
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
      compareRemoteImg.src = `/api/accounting/voucher-preview?companyKey=${encodeURIComponent(companyKey)}&voucherId=${encodeURIComponent(match.id)}&_t=${Date.now()}`;
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
    const curDate = curRes.documentDate || curRes.date || (cur.uploadDate ? new Date(cur.uploadDate).toLocaleDateString("de-DE") : "-");
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
          <div class="card-footer bg-white border-top p-2 d-flex justify-content-between align-items-center flex-wrap gap-1">
            ${cur.result?.webViewLink ? `<a href="${cur.result.webViewLink}" target="_blank" class="btn btn-xs btn-outline-primary d-inline-flex align-items-center gap-1" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;"><span class="material-symbols-outlined" style="font-size: 14px;">open_in_new</span> <span>In Drive öffnen</span></a>` : `<span></span>`}
            <button class="btn btn-xs btn-outline-success btn-dismiss-dup-single d-inline-flex align-items-center gap-1" data-job-id="${cur.id}" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;">
              <span class="material-symbols-outlined" style="font-size: 14px;">check</span>
              <span>Als Original behalten</span>
            </button>
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
            <button class="btn btn-sm btn-outline-primary btn-dismiss-dup-single mx-auto" data-job-id="${cur.id}" style="border-radius: 8px;">
              Duplikat-Verdacht entfernen
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
        const dupDate = dupRes.documentDate || dupRes.date || (dupJob.uploadDate ? new Date(dupJob.uploadDate).toLocaleDateString("de-DE") : "-");
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
              <div class="card-footer bg-white border-top p-2 d-flex justify-content-between align-items-center flex-wrap gap-1">
                ${dupJob.result?.webViewLink ? `<a href="${dupJob.result.webViewLink}" target="_blank" class="btn btn-xs btn-outline-secondary d-inline-flex align-items-center gap-1" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;"><span class="material-symbols-outlined" style="font-size: 14px;">open_in_new</span> <span>In Drive öffnen</span></a>` : `<span></span>`}
                ${window.isAdmin ? `
                  <button class="btn btn-xs btn-outline-danger btn-delete-dup-single d-inline-flex align-items-center gap-1" data-job-id="${dupJob.id}" style="font-size: 11px; padding: 3px 8px; border-radius: 6px;">
                    <span class="material-symbols-outlined" style="font-size: 14px;">delete</span>
                    <span>Duplikat löschen</span>
                  </button>
                ` : ``}
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

if (dupModalDismissAllBtn) {
  dupModalDismissAllBtn.addEventListener("click", async () => {
    if (!currentDuplicateJobId) return;
    const jobId = currentDuplicateJobId;
    dupModalDismissAllBtn.disabled = true;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/dismiss-duplicate`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (typeof showToast === "function") showToast("✓ Duplikat-Verdacht verworfen.", "info");
        closeDuplicateCompareModal();
        startPolling();
      }
    } catch (e) {
      alert("Fehler: " + e.message);
    } finally {
      dupModalDismissAllBtn.disabled = false;
    }
  });
}

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
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> Sende...`;
  }

  try {
    const res = await fetch("/api/clickup/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, force }),
    });

    const data = await res.json();

    if (data.alreadyTransferred && !force) {
      pendingClickupTransferJobId = jobId;
      pendingClickupTransferBtn = btn;
      document.getElementById("confirm-clickup-text").innerText = data.error || "Dokument wurde bereits an ClickUp übertragen.";
      document.getElementById("confirm-clickup-modal").style.display = "flex";
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">cloud_upload</span> <span>Aktualisieren</span>`;
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
        btn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">cloud_upload</span> <span>Zu ClickUp</span>`;
      }
    }
  } catch (err) {
    alert("Fehler bei ClickUp-Übertragung: " + err.message);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">cloud_upload</span> <span>Zu ClickUp</span>`;
    }
  }
}

// Modal handlers for single ClickUp transfer
const cancelClickupBtn = document.getElementById("cancel-clickup-transfer-btn");
const confirmClickupBtn = document.getElementById("confirm-clickup-transfer-btn");

if (cancelClickupBtn) {
  cancelClickupBtn.addEventListener("click", () => {
    document.getElementById("confirm-clickup-modal").style.display = "none";
    pendingClickupTransferJobId = null;
    pendingClickupTransferBtn = null;
  });
}

if (confirmClickupBtn) {
  confirmClickupBtn.addEventListener("click", async () => {
    document.getElementById("confirm-clickup-modal").style.display = "none";
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

  const dismissDupBtn = e.target.closest(".btn-dismiss-dup-single");
  if (dismissDupBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = dismissDupBtn.getAttribute("data-job-id");
    if (jobId) {
      dismissDupBtn.disabled = true;
      fetch(`/api/jobs/${encodeURIComponent(jobId)}/dismiss-duplicate`, { method: "POST" })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            if (typeof showToast === "function") showToast("✓ Duplikat-Verdacht entfernt.", "info");
            closeDuplicateCompareModal();
            startPolling();
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

    if (item.type === "create") {
      badgeHtml = `<span style="background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">+ Neu anlegen</span>`;
      actionInfoHtml = `<span style="color: #666; font-size: 12px;">Vorgeschlagener Task: <strong>${item.suggestedTaskName || item.fileName}</strong></span>`;
    } else if (item.type === "update") {
      badgeHtml = `<span style="background: #e3f2fd; color: #1565c0; border: 1px solid #bbdefb; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">↻ Aktualisieren</span>`;
      actionInfoHtml = `<span style="color: #666; font-size: 12px;">Aktualisiert Task: <a href="${item.existingTaskUrl}" target="_blank" style="color: #1976d2; font-weight: 500;">#${item.existingTaskId} (${item.existingTaskName})</a></span>`;
    } else if (item.type === "uptodate") {
      badgeHtml = `<span style="background: #f3e5f5; color: #7b1fa2; border: 1px solid #e1bee7; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">✓ Bereits aktuell</span>`;
      actionInfoHtml = `<span style="color: #7b1fa2; font-size: 12px;">Task ist synchron: <a href="${item.existingTaskUrl}" target="_blank" style="color: #7b1fa2; font-weight: 500;">#${item.existingTaskId} (${item.existingTaskName})</a> <span style="color: #888;">[Status: ${item.existingTaskStatus || 'offen'}]</span></span>`;
    } else if (item.type === "skip") {
      badgeHtml = `<span style="background: #fff3e0; color: #e65100; border: 1px solid #ffe0b2; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">⊘ Überspringen</span>`;
      actionInfoHtml = `<span style="color: #e65100; font-size: 12px;">${item.reason || "Privat"}</span>`;
    }

    html += `
      <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px 12px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px; flex-wrap: wrap;">
            ${badgeHtml}
            <span style="font-weight: 600; font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.fileName}">${item.fileName}</span>
          </div>
          <div style="display: flex; gap: 12px; font-size: 12px; color: #777; flex-wrap: wrap; margin-top: 2px;">
            <span>🏢 ${item.company || 'Unbekannt'}</span>
            <span>📁 ${item.category || '-'}</span>
            ${item.amount ? `<span style="color: #2e7d32; font-weight: 500;">💰 ${item.amount}</span>` : ''}
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
      const res = await fetch("/api/clickup/sync-preview");
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

      const res = await fetch("/api/clickup/sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
const startFilterDate = document.getElementById("start-filter-date");
const startFilterCompany = document.getElementById("start-filter-company");
const startResetFiltersBtn = document.getElementById("start-reset-filters-btn");

if (startSearchInput) {
  startSearchInput.addEventListener("input", (e) => {
    startSearchQuery = e.target.value.trim();
    startCurrentPage = 1;
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
    startDateFilter = "alle";
    startCompanyFilter = "alle";
    startSelectedCategories.clear();
    startCurrentPage = 1;

    if (startSearchInput) startSearchInput.value = "";
    if (startFilterDate) startFilterDate.value = "alle";
    if (startFilterCompany) startFilterCompany.value = "alle";

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
  const { toImport = [], needsEnrichment = [], existingComplete = [] } = driveSyncData;
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
  }
  return items;
}

function renderDriveSyncModal() {
  if (!driveSyncData) return;
  const { toImport = [], needsEnrichment = [], existingComplete = [], totalDriveFiles = 0 } = driveSyncData;

  if (driveCountNew) driveCountNew.innerText = toImport.length;
  if (driveCountEnrich) driveCountEnrich.innerText = needsEnrichment.length;
  if (driveCountExisting) driveCountExisting.innerText = existingComplete.length;
  if (driveCountTotal) driveCountTotal.innerText = totalDriveFiles;

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
    if (item.categoryType === "new") {
      badgeHtml = `<span class="badge bg-success-subtle text-success border border-success-subtle">+ Neu (Fehlt in DB)</span>`;
      pipelineBadgeHtml = `<span class="badge text-white" style="background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 12px; font-size: 11px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 3px;" title="Wird nach Sync durch die KI-Pipeline analysiert & angereichert"><span class="material-symbols-outlined" style="font-size: 12px;">auto_awesome</span> In KI-Pipeline</span>`;
    } else if (item.categoryType === "enrich") {
      badgeHtml = `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">⚠️ Metadaten unvollständig</span>`;
      pipelineBadgeHtml = `<span class="badge text-white" style="background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 12px; font-size: 11px; padding: 2px 8px; display: inline-flex; align-items: center; gap: 3px;" title="Wird nach Sync durch die KI-Pipeline analysiert & angereichert"><span class="material-symbols-outlined" style="font-size: 12px;">auto_awesome</span> In KI-Pipeline</span>`;
    } else {
      badgeHtml = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle">✓ Vollständig</span>`;
    }

    const dateStr = item.createdTime ? new Date(item.createdTime).toLocaleDateString("de-DE") : "-";
    const sizeStr = item.size ? `${(parseInt(item.size, 10) / 1024).toFixed(0)} KB` : "";

    html += `
      <div class="d-flex align-items-center justify-content-between p-2 mb-1 bg-white rounded border gap-2 drive-sync-item-row" data-id="${item.id}" style="font-size: 13px; cursor: pointer;">
        <div class="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
          <input type="checkbox" class="form-check-input drive-item-checkbox m-0" data-id="${item.id}" ${isChecked ? 'checked' : ''} />
          <div class="text-truncate" style="max-width: 450px;">
            <div class="fw-bold text-dark text-truncate" title="${item.name}">${item.name}</div>
            <div class="text-muted small d-flex gap-2 flex-wrap">
              <span>📅 ${dateStr}</span>
              ${sizeStr ? `<span>💾 ${sizeStr}</span>` : ''}
              ${item.currentCompany ? `<span>🏢 ${item.currentCompany}</span>` : ''}
              ${item.currentCategory ? `<span>📁 ${item.currentCategory}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="d-flex align-items-center gap-1 flex-wrap justify-content-end">
          ${badgeHtml}
          ${pipelineBadgeHtml}
        </div>
      </div>
    `;
  });

  driveSyncList.innerHTML = html;

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
      if (e.target.tagName === "INPUT") return;
      const cb = row.querySelector(".drive-item-checkbox");
      if (cb) {
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

let currentPreviewMailIndex = -1;
let currentPreviewAttIndex = 0;

function openInboxPdfPreview(mailOrId, attIndex = 0) {
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

  const previewUrl = `/api/gmail/attachment/preview?messageId=${encodeURIComponent(mail.id)}&attachmentId=${encodeURIComponent(currentAtt.attachmentId)}&accountId=${encodeURIComponent(mail.accountId || "")}&filename=${encodeURIComponent(currentAtt.filename || "Anhang.pdf")}`;
  const downloadUrl = `${previewUrl}&download=true`;

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

  if (inboxPdfDownloadBtn) inboxPdfDownloadBtn.href = downloadUrl;
  if (inboxPdfExternalBtn) inboxPdfExternalBtn.href = previewUrl;

  if (inboxPdfLoading) inboxPdfLoading.style.setProperty("display", "block", "important");
  inboxPdfPreviewIframe.onload = () => {
    if (inboxPdfLoading) inboxPdfLoading.style.setProperty("display", "none", "important");
  };

  inboxPdfPreviewIframe.src = previewUrl;
  inboxPdfPreviewModal.style.setProperty("display", "flex", "important");
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

    const originalHtml = inboxPdfQuickProcessBtn.innerHTML;
    inboxPdfQuickProcessBtn.disabled = true;
    inboxPdfQuickProcessBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> <span>Verarbeite...</span>`;

    try {
      const shouldArchive = inboxArchiveToggle ? inboxArchiveToggle.checked : true;
      const res = await fetch("/api/gmail/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId: mail.id,
          accountId: mail.accountId,
          subject: mail.subject,
          fromName: mail.fromName,
          fromEmail: mail.fromEmail,
          date: mail.date,
          attachments: mail.attachments,
          archive: shouldArchive,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Fehler beim Verarbeiten.");

      // Aus lokaler Liste entfernen
      inboxActiveEmails = inboxActiveEmails.filter((m) => m.id !== mail.id);
      inboxSkippedEmails = inboxSkippedEmails.filter((m) => m.id !== mail.id);
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
      fetchStatus();

      if (typeof showToast === "function") {
        showToast(data.message || "Beleg erfolgreich verarbeitet!", "success");
      }

      // Zum nächsten Beleg wechseln oder schließen
      const updatedVisible = getVisibleInboxEmails();
      if (updatedVisible.length > 0) {
        const nextIdx = Math.min(currentPreviewMailIndex, updatedVisible.length - 1);
        openInboxPdfPreview(nextIdx, 0);
      } else {
        closeInboxPdfPreview();
      }
    } catch (err) {
      alert("Fehler beim Verarbeiten: " + err.message);
    } finally {
      inboxPdfQuickProcessBtn.disabled = false;
      inboxPdfQuickProcessBtn.innerHTML = originalHtml;
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
  inboxAddAccountBtn.addEventListener("click", () => {
    if (secondaryGmailAuthClient) {
      secondaryGmailAuthClient.requestCode();
    } else if (authClientCode) {
      authClientCode.requestCode();
    } else {
      alert("Google Authentifizierung wird initialisiert. Bitte kurz warten oder Einstellungen öffnen.");
    }
  });
}

const inboxGrantPermissionBtn = document.getElementById("inbox-grant-permission-btn");
if (inboxGrantPermissionBtn) {
  inboxGrantPermissionBtn.addEventListener("click", () => {
    if (authClientCode) {
      authClientCode.requestCode();
    } else {
      const settingsModalEl = document.getElementById("settings-modal");
      if (settingsModalEl) settingsModalEl.style.display = "flex";
    }
  });
}

const settingsAddGmailAccountBtn = document.getElementById("settings-add-gmail-account-btn");
if (settingsAddGmailAccountBtn) {
  settingsAddGmailAccountBtn.addEventListener("click", () => {
    if (secondaryGmailAuthClient) {
      secondaryGmailAuthClient.requestCode();
    } else if (authClientCode) {
      authClientCode.requestCode();
    } else {
      alert("Google Authentifizierung wird initialisiert. Bitte kurz warten.");
    }
  });
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
  const count = selectedInboxMessageIds.size;
  if (inboxSelectedCount) inboxSelectedCount.innerText = count;
  if (inboxBatchProcessBtn) {
    inboxBatchProcessBtn.disabled = count === 0 || isProcessingInboxBatch;
  }
  if (inboxSelectAllCb) {
    const visibleActive = getVisibleInboxEmails();
    inboxSelectAllCb.checked = visibleActive.length > 0 && visibleActive.every((m) => selectedInboxMessageIds.has(m.id));
  }
}

function matchDateFilter(dateStr, filterVal) {
  if (!filterVal || filterVal === "alle") return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (filterVal === "today") {
    return d >= today;
  }
  if (filterVal === "yesterday_today") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return d >= yesterday;
  }
  if (filterVal === "7days") {
    const past7 = new Date(today);
    past7.setDate(past7.getDate() - 7);
    return d >= past7;
  }
  if (filterVal === "30days") {
    const past30 = new Date(today);
    past30.setDate(past30.getDate() - 30);
    return d >= past30;
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
      const acc = (m.accountEmail || m.accountName || "").toLowerCase();
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
  inboxAccountSelect.innerHTML = `<option value="all">📥 Alle Posteingänge (${inboxAccounts.length || 1})</option>`;

  inboxAccounts.forEach((acc) => {
    const opt = document.createElement("option");
    opt.value = acc.id || acc.email;
    opt.innerText = `✉️ ${acc.email}${acc.isPrimary ? " (Hauptkonto)" : ""}`;
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
      accountsContainer.innerHTML = `<div class="text-muted small">Noch keine separaten Konten registriert (Standard-Konto aktiv).</div>`;
    } else {
      inboxAccounts.forEach((acc) => {
        const item = document.createElement("div");
        item.className = "d-flex justify-content-between align-items-center p-2 rounded border bg-white small";
        item.innerHTML = `
          <div class="d-flex align-items-center gap-2 text-truncate">
            <span class="material-symbols-outlined text-primary" style="font-size: 18px;">mail</span>
            <strong class="text-truncate">${acc.email}</strong>
            ${acc.isPrimary ? `<span class="badge bg-primary-subtle text-primary border border-primary-subtle" style="font-size: 10px;">Hauptkonto</span>` : ""}
          </div>
          ${
            !acc.isPrimary
              ? `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 remove-gmail-acc-btn" data-id="${acc.id}" style="font-size: 11px;">Trennen</button>`
              : ""
          }
        `;
        const removeBtn = item.querySelector(".remove-gmail-acc-btn");
        if (removeBtn) {
          removeBtn.addEventListener("click", async () => {
            if (confirm(`Möchtest du das Google-Konto "${acc.email}" wirklich trennen?`)) {
              try {
                const res = await fetch("/api/gmail/accounts/delete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ accountId: acc.id }),
                });
                const d = await res.json();
                if (d.success) {
                  updateAccountsDropdown(d.accounts);
                  loadInboxData(false);
                }
              } catch (e) {
                alert("Fehler beim Entfernen: " + e.message);
              }
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

  if (!silent) {
    if (inboxLoadingContainer) inboxLoadingContainer.style.setProperty("display", "block", "important");
    if (inboxEmailList) inboxEmailList.style.setProperty("display", "none", "important");
    if (inboxEmptyContainer) inboxEmptyContainer.style.setProperty("display", "none", "important");
    if (inboxErrorAlert) inboxErrorAlert.style.setProperty("display", "none", "important");
    if (inboxPermissionCard) inboxPermissionCard.style.setProperty("display", "none", "important");
  }

  try {
    const selectedAccountId = inboxAccountSelect ? inboxAccountSelect.value : "all";
    const [inboxRes, skippedRes] = await Promise.all([
      fetch(`/api/gmail/inbox?accountId=${encodeURIComponent(selectedAccountId)}`),
      fetch("/api/gmail/skipped"),
    ]);

    const inboxData = await inboxRes.json();
    const skippedData = await skippedRes.json();

    if (!inboxData.success) {
      throw new Error(inboxData.error || "Fehler beim Laden des Posteingangs.");
    }

    inboxActiveEmails = inboxData.emails || [];
    inboxSkippedEmails = skippedData.skippedEmails || [];

    if (inboxData.accounts) {
      updateAccountsDropdown(inboxData.accounts);
    }

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
    if (inboxPermissionCard) inboxPermissionCard.style.setProperty("display", "none", "important");
    renderInboxList();
  } catch (err) {
    console.error("[GMAIL] Fehler bei loadInboxData:", err);
    if (inboxLoadingContainer) inboxLoadingContainer.style.setProperty("display", "none", "important");

    const errStr = (err.message || "").toLowerCase();
    const isPermissionError =
      errStr.includes("insufficient permission") ||
      errStr.includes("insufficientpermissions") ||
      errStr.includes("nicht authentifiziert") ||
      errStr.includes("403");

    if (isPermissionError && inboxPermissionCard) {
      inboxPermissionCard.style.setProperty("display", "block", "important");
      if (inboxEmailList) inboxEmailList.style.setProperty("display", "none", "important");
      if (inboxEmptyContainer) inboxEmptyContainer.style.setProperty("display", "none", "important");
      if (inboxErrorAlert) inboxErrorAlert.style.setProperty("display", "none", "important");
    } else if (inboxErrorAlert) {
      inboxErrorAlert.style.setProperty("display", "block", "important");
      if (inboxErrorText) inboxErrorText.innerText = err.message || "Fehler beim Laden der E-Mails.";
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

    const card = document.createElement("div");
    card.className = "card p-3 shadow-sm border";
    card.style.cssText = `
      background-color: ${isSelected ? "#f8fbff" : "#ffffff"};
      border-radius: 14px;
      border-color: ${isSelected ? "#0d6efd" : "#e9ecef"} !important;
      transition: all 0.2s ease;
    `;

    // Attachments HTML (Clickable PDF Pills for live preview)
    const attachmentsHtml = attachments
      .map(
        (att) => `
        <button type="button" class="btn btn-sm btn-light border d-inline-flex align-items-center gap-1 p-1 px-2 rounded small inbox-pdf-pill" 
          data-message-id="${mail.id}"
          data-account-id="${mail.accountId || ''}"
          data-att-id="${att.attachmentId}"
          data-filename="${encodeURIComponent(att.filename || 'Anhang.pdf')}"
          data-size="${att.size || 0}"
          data-subject="${encodeURIComponent(mail.subject || '')}"
          style="font-size: 12px; transition: all 0.15s ease; cursor: pointer; text-align: left;"
          title="Klicken für PDF-Vorschau: ${att.filename}">
          <span class="material-symbols-outlined text-danger" style="font-size: 16px;">picture_as_pdf</span>
          <span class="text-truncate fw-medium" style="max-width: 220px;">${att.filename || "Anhang.pdf"}</span>
          <span class="text-muted" style="font-size: 11px;">(${formatFileSize(att.size)})</span>
          <span class="material-symbols-outlined text-primary ms-1" style="font-size: 14px;">visibility</span>
        </button>
      `
      )
      .join("");

    const isSkippedTab = currentInboxSubtab === "skipped";

    card.innerHTML = `
      <div class="d-flex gap-3 align-items-start">
        ${
          !isSkippedTab
            ? `
          <div class="pt-1">
            <input type="checkbox" class="form-check-input inbox-item-cb" data-id="${mail.id}" ${
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
              <strong class="text-dark" style="font-size: 14px;">${mail.fromName || mail.fromEmail || "Unbekannter Absender"}</strong>
              ${
                mail.fromName && mail.fromEmail && mail.fromEmail !== mail.fromName
                  ? `<span class="text-muted small text-truncate" style="font-size: 12px;">&lt;${mail.fromEmail}&gt;</span>`
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
                      ${mail.accountEmail}
                    </span>`
                  : ""
              }
            </div>
            <div class="text-muted small flex-shrink-0" style="font-size: 12px;">
              ${formatDateDisplay(mail.date)}
            </div>
          </div>

          <!-- Subject Line -->
          <div class="fw-bold text-dark mb-1" style="font-size: 15px;">
            ${mail.subject || "(Kein Betreff)"}
          </div>

          <!-- Snippet / Email Preview -->
          ${
            mail.snippet
              ? `
            <div class="text-muted small mb-2" style="font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${mail.snippet}
            </div>
          `
              : ""
          }

          <!-- PDF Attachments Pills -->
          <div class="d-flex flex-wrap gap-1 mb-3 pt-1">
            ${attachmentsHtml}
          </div>

          <!-- Action Buttons Row -->
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-2 border-top">
            <div class="small text-muted">
              ${attachments.length} ${attachments.length === 1 ? "PDF-Anhang" : "PDF-Anhänge"}
            </div>
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-sm btn-outline-dark d-flex align-items-center gap-1 inbox-preview-btn" data-id="${mail.id}" style="border-radius: 20px; font-size: 12px; padding: 4px 12px;" title="PDF-Vorschau öffnen">
                <span class="material-symbols-outlined" style="font-size: 16px;">visibility</span>
                <span>Vorschau</span>
              </button>
              ${
                !isSkippedTab
                  ? `
                <button type="button" class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1 inbox-skip-btn" data-id="${mail.id}" style="border-radius: 20px; font-size: 12px; padding: 4px 12px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">playlist_remove</span>
                  <span>Überspringen</span>
                </button>
                <button type="button" class="btn btn-sm btn-primary d-flex align-items-center gap-1 inbox-process-btn" data-id="${mail.id}" style="border-radius: 20px; font-size: 12px; padding: 4px 14px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
                  <span>Verarbeiten</span>
                </button>
              `
                  : `
                <button type="button" class="btn btn-sm btn-outline-primary d-flex align-items-center gap-1 inbox-unskip-btn" data-id="${mail.id}" style="border-radius: 20px; font-size: 12px; padding: 4px 12px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">undo</span>
                  <span>Wiederherstellen</span>
                </button>
                <button type="button" class="btn btn-sm btn-primary d-flex align-items-center gap-1 inbox-process-btn" data-id="${mail.id}" style="border-radius: 20px; font-size: 12px; padding: 4px 14px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">play_arrow</span>
                  <span>Trotzdem Verarbeiten</span>
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

    card.querySelectorAll(".inbox-pdf-pill").forEach((pill, idx) => {
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        openInboxPdfPreview(mail, idx);
      });
    });

    // Checkbox event
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
    const res = await fetch("/api/gmail/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: mail.id,
        accountId: mail.accountId,
        subject: mail.subject,
        fromName: mail.fromName,
        fromEmail: mail.fromEmail,
        date: mail.date,
        attachments: mail.attachments,
        archive: shouldArchive,
      }),
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || "Fehler bei der E-Mail-Verarbeitung.");
    }

    // Aus aktiver Liste entfernen
    inboxActiveEmails = inboxActiveEmails.filter((m) => m.id !== mail.id);
    inboxSkippedEmails = inboxSkippedEmails.filter((m) => m.id !== mail.id);
    selectedInboxMessageIds.delete(mail.id);

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
      showToast(data.message || "Belege erfolgreich zur KI-Pipeline hinzugefügt!", "success");
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

  if (
    !confirm(
      `${selectedEmails.length} ausgewählte E-Mail(s) jetzt verarbeiten${
        inboxArchiveToggle?.checked ? " und im Posteingang archivieren" : ""
      }?`
    )
  ) {
    return;
  }

  isProcessingInboxBatch = true;
  if (inboxBatchProcessBtn) {
    inboxBatchProcessBtn.disabled = true;
    inboxBatchProcessBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> <span>Verarbeite Stapel...</span>`;
  }

  try {
    const shouldArchive = inboxArchiveToggle ? inboxArchiveToggle.checked : true;
    const res = await fetch("/api/gmail/process-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: selectedEmails,
        archive: shouldArchive,
      }),
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || "Fehler bei der Stapelverarbeitung.");
    }

    selectedInboxMessageIds.clear();
    await loadInboxData(false);
    fetchStatus();

    alert(
      `Stapelverarbeitung abgeschlossen!\n` +
        `• Verarbeitet: ${data.processedCount} E-Mails (${data.totalJobs} PDF-Dokumente)\n` +
        `• Archiviert: ${data.archivedCount} E-Mails`
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

async function skipInboxEmail(mail) {
  try {
    const res = await fetch("/api/gmail/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: mail.id,
        accountId: mail.accountId,
        accountEmail: mail.accountEmail,
        subject: mail.subject,
        from: mail.fromRaw || mail.fromName || mail.fromEmail,
        fromName: mail.fromName,
        fromEmail: mail.fromEmail,
        date: mail.date,
        snippet: mail.snippet,
        attachments: mail.attachments,
        isDetected: !!mail.isDetected,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Fehler beim Überspringen.");

    inboxActiveEmails = inboxActiveEmails.filter((m) => m.id !== mail.id);
    inboxSkippedEmails.unshift(mail);
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
  } catch (err) {
    console.error("[GMAIL] Fehler beim Überspringen:", err);
    alert("Fehler beim Überspringen: " + err.message);
  }
}

async function unskipInboxEmail(messageId) {
  try {
    const res = await fetch("/api/gmail/unskip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Fehler beim Wiederherstellen.");

    await loadInboxData(false);
  } catch (err) {
    console.error("[GMAIL] Fehler beim Wiederherstellen:", err);
    alert("Fehler beim Wiederherstellen: " + err.message);
  }
}

// Initialer Abruf der offenen E-Mails im Hintergrund (für den Badge-Zähler)
setTimeout(() => {
  loadInboxData(true);
}, 3000);



