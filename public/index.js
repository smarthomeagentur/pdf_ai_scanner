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

      // Initialize Google Auth Implicit flow client
      authClientCode = window.google.accounts.oauth2.initCodeClient({
        client_id: googleClientId,
        scope: "https://www.googleapis.com/auth/drive",
        ux_mode: "popup",
        callback: async (response) => {
          if (response.code) {
            document.getElementById("auth-status").innerText = "Speichere Code am Server...";
            const authRes = await fetch("/api/auth/code", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: response.code }),
            });
            if (authRes.ok) {
              document.getElementById("auth-status").innerText = "Erfolgreich verbunden!";
              document.getElementById("auth-btn").style.display = "none";
              loadFolders();
            } else {
              document.getElementById("auth-status").innerText = "Fehler bei der Verbindung.";
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
        document.getElementById("lexoffice-key-thewire").value = window.currentSettings.LEXOFFICE_KEY_THEWIRE || "";
        document.getElementById("lexoffice-key-polyxo").value = window.currentSettings.LEXOFFICE_KEY_POLYXO || "";
        
        document.getElementById("clickup-settings-container").style.display = "block";
        document.getElementById("clickup-api-key").value = window.currentSettings.CLICKUP_API_KEY || "";
        document.getElementById("clickup-list-id").value = window.currentSettings.CLICKUP_LIST_ID || "901510878865";
        document.getElementById("clickup-auto-task").checked = window.currentSettings.CLICKUP_AUTO_TASK !== false;
        document.getElementById("clickup-filter-private").checked = window.currentSettings.CLICKUP_FILTER_PRIVATE !== false;

        document.getElementById("admin-backup-container").style.display = "block";

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
  const lexKeyThewire = document.getElementById("lexoffice-key-thewire").value.trim();
  const lexKeyPolyxo = document.getElementById("lexoffice-key-polyxo").value.trim();

  const clickupApiKey = document.getElementById("clickup-api-key").value.trim();
  const clickupListId = document.getElementById("clickup-list-id").value.trim();
  const clickupAutoTask = document.getElementById("clickup-auto-task").checked;
  const clickupFilterPrivate = document.getElementById("clickup-filter-private").checked;

  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      FOLDER_ID: rawFolderId,
      FOLDER_ID_SORTED: aiFolderId,
      AI_CATEGORIES: aiCategories,
      AI_COMPANY: aiCompany,
      MONITOR_DRIVE: monitorDriveState,
      LEXOFFICE_KEY_WIREWIRE: lexKeyWirewire,
      LEXOFFICE_KEY_THEWIRE: lexKeyThewire,
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
const triggerSyncDriveBtn = document.getElementById("trigger-sync-drive-btn");
const confirmClearModal = document.getElementById("confirm-clear-modal");
const confirmClearBtn = document.getElementById("confirm-clear-btn");
const cancelClearBtn = document.getElementById("cancel-clear-btn");

if (triggerSyncDriveBtn) {
  triggerSyncDriveBtn.addEventListener("click", async () => {
    triggerSyncDriveBtn.disabled = true;
    triggerSyncDriveBtn.innerText = "Wiederherstellen...";
    try {
      const res = await fetch("/api/drive/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        alert(`${data.restoredCount} Dokument(e) erfolgreich aus Google Drive wiederhergestellt!`);
        settingsModal.style.display = "none";
        startPolling();
        if (typeof loadRechnungenView === "function") loadRechnungenView();
      } else {
        alert("Fehler bei der Wiederherstellung: " + (data.error || "Unbekannter Fehler"));
      }
    } catch (e) {
      alert("Fehler bei der Wiederherstellung: " + e.message);
    } finally {
      triggerSyncDriveBtn.disabled = false;
      triggerSyncDriveBtn.innerText = "Dokumente aus Google Drive wiederherstellen";
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
        if (simJob.result.company) companyHtml = `<br>Unternehmen: ${simJob.result.company}`;
        if (simJob.result.category) categoryHtml = `<br>Kategorie: ${simJob.result.category}`;
        if (simJob.result.tags && Array.isArray(simJob.result.tags)) tagsHtml = `<br>Tags: ${simJob.result.tags.slice(0, 3).join(", ")}`;
        
        if (simJob.result.localThumbnail || simJob.result.thumbnailLink) {
          const imgSrc = simJob.result.localThumbnail || simJob.result.thumbnailLink;
          previewHtml = `
            <div style="margin-top: 10px; text-align: center;">
              <img src="${imgSrc}" style="height: 250px; aspect-ratio: 1 / 1.414; object-fit: fill; border-radius: 4px; border: 1px solid #ccc; background: #fff;" title="Vorschau" alt="Vorschau">
            </div>
          `;
        }
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

function renderJobs() {
  if (document.querySelector('.category-picker-box')) {
    // Ein Picker ist offen, wir überspringen das Neu-Zeichnen,
    // damit das Menü nicht durch den 5-Sekunden-Refresh geschlossen wird.
    return;
  }

  const countSpan = document.getElementById("active-job-count");
  if (countSpan) {
    const activeCount = activeJobs.filter((j) => j.status === "pending" || j.status === "processing").length;
    countSpan.innerHTML = activeCount > 0 ? `(${activeCount} in Arbeit)` : "";
  }

  // Offene Details-Boxen merken, damit sie beim Polling-Refresh nicht zuklappen
  const openStates = {};
  document.querySelectorAll("details.job-result").forEach((details) => {
    const id = details.getAttribute("data-job-id");
    if (id && details.open) openStates[id] = true;
  });

  jobList.innerHTML = "";
  if (activeJobs.length === 0) {
    return;
  }

  activeJobs.forEach((job) => {
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

    let duplicateBadgeHtml = '';
    if (job.suspectedDuplicate) {
        duplicateBadgeHtml = '<span style="background: #ff9800; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; vertical-align: middle;" title="Verdacht auf Duplikat">⚠️ DUPLIKAT VERDACHT</span>';
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

      const driveId = job.rawDriveId || job.id;
      const imgSrc = job.result.localThumbnail
        ? job.result.localThumbnail
        : (driveId ? `/api/thumbnail/${driveId}` : (job.result.thumbnailLink || ""));

      if (imgSrc) {
        previewHtml = `<a href="${
          job.result.webViewLink || "#"
        }" target="_blank" class="pdf-preview-container">
                        <img src="${imgSrc}" alt="PDF Vorschau" class="pdf-preview-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
                    </a>`;
      }

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

      resultHtml = `
                    <details class="job-result" data-job-id="${
                      job.id
                    }" style="margin-top: 10px; width: 100%; transition: all 0.3s;" ${openStates[job.id] ? "open" : ""}>
                        <summary style="cursor: pointer; color: var(--md-sys-color-primary, #1A1A1A); font-weight: 500; font-size: 14px; margin-bottom: 0px; width: fit-content; padding: 4px 12px; border-radius: 12px; background: var(--md-sys-color-surface-container-high, #E7E0EC); display: inline-flex; align-items: center; gap: 4px; user-select: none;">
                          <span class="material-symbols-outlined" style="font-size: 16px;">info</span> Details
                        </summary>
                        <div style="margin-top: 12px; padding: 14px; background: var(--md-sys-color-surface, #fff); border-radius: var(--md-sys-shape-corner-medium, 16px); border: 1px solid var(--md-sys-color-outline-variant, #CAC4D0); margin-right: -65px; font-size: 14px; color: var(--md-sys-color-on-surface, #1C1B1F); line-height: 1.6; box-shadow: var(--md-sys-elevation-1);">
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
                        </div>
                    </details>
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
                            <span style="word-break: break-word; line-height: 1.2; display: flex; align-items: center;">
                                ${job.originalName}
                                ${privateBadgeHtml}
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

pwaCloseBtn.addEventListener("click", () => {
  pwaBanner.classList.remove("show");
  localStorage.setItem("pwaPromptDismissed", "true");
});

window.addEventListener("appinstalled", () => {
  // Hide banner if shown and clear deferred prompt
  pwaBanner.classList.remove("show");
  deferredPrompt = null;
  console.log("PWA was installed");
});

// Drive Search Logic
const searchInput = document.getElementById("drive-search-input");
const searchBtn = document.getElementById("drive-search-btn");
const searchResultsContainer = document.getElementById("drive-search-results");
const searchResultsList = document.getElementById("search-results-list");
const closeSearchBtn = document.getElementById("close-search-btn");

const performSearch = async () => {
  const query = searchInput.value.trim();
  if (query.length < 2) return;

  searchResultsContainer.style.display = "block";
  searchResultsList.innerHTML = "<div class='text-center mt-3 mb-3'>Suche in Google Drive läuft...</div>";

  try {
    const res = await fetch("/api/drive/search?q=" + encodeURIComponent(query));
    const data = await res.json();

    if (!data.success) {
      searchResultsList.innerHTML = `<div class="text-danger mt-2">${data.error || "Suche fehlgeschlagen."}</div>`;
      return;
    }

    if (data.files.length === 0) {
      searchResultsList.innerHTML =
        "<div class='text-muted mt-2'>Keine Dokumente für diese Suchbegriffe gefunden.</div>";
      return;
    }

    let html = "";
    data.files.forEach((file) => {
      // Datum formatieren
      const date = new Date(file.createdTime).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const thumb = file.thumbnailLink
        ? `<img src="${file.thumbnailLink}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;" onerror="this.style.display='none'">`
        : `<div style="width: 40px; height: 40px; display:flex; align-items:center; justify-content:center; background:#e9ecef; border-radius:4px;"><span class="material-symbols-outlined text-secondary">description</span></div>`;

      html += `
        <div style="display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
          ${thumb}
          <div style="flex-grow: 1; min-width: 0;">
            <div style="font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${file.name}">${file.name}</div>
            <div style="font-size: 12px; color: #777;">${date}</div>
          </div>
          <a href="${file.webViewLink}" target="_blank" class="btn btn-sm btn-outline-primary" style="white-space: nowrap;">Öffnen</a>
        </div>
      `;
    });

    searchResultsList.innerHTML = html;
  } catch (e) {
    searchResultsList.innerHTML = `<div class="text-danger">Netzwerkfehler bei der Suche.</div>`;
  }
};

searchBtn.addEventListener("click", performSearch);
searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") performSearch();
});

closeSearchBtn.addEventListener("click", () => {
  searchResultsContainer.style.display = "none";
});

// Fetch settings globally on load so category options are available
async function loadGlobalSettings() {
  window.isAdmin = false;
  try {
    const adminRes = await fetch("/api/admin-check");
    window.isAdmin = adminRes.ok;
    renderJobs();
  } catch(e) {}

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
// --- Rechnungsverarbeitung & Lexoffice ---
// ==========================================

const navUploadTab = document.getElementById("nav-upload-tab");
const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
const viewUpload = document.getElementById("view-upload");
const viewRechnungen = document.getElementById("view-rechnungen");

if (navUploadTab && navRechnungenTab) {
  navUploadTab.addEventListener("click", () => {
    navUploadTab.classList.add("active");
    navRechnungenTab.classList.remove("active");
    viewUpload.style.display = "block";
    viewRechnungen.style.display = "none";
    startPolling();
  });

  navRechnungenTab.addEventListener("click", () => {
    if (!window.isAdmin) return;
    navRechnungenTab.classList.add("active");
    navUploadTab.classList.remove("active");
    viewUpload.style.display = "none";
    viewRechnungen.style.display = "block";
    loadRechnungenView();
  });
}

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
  const defaultTarget = job.targetCompany || detectDefaultTargetCompany(res.company);

  const card = document.createElement("div");
  card.className = "card shadow-sm border-0 mb-2";
  card.style.borderRadius = "10px";

  const driveId = job.rawDriveId || job.id;
  const thumbSrc = res.localThumbnail
    ? res.localThumbnail
    : (driveId ? `/api/thumbnail/${driveId}` : (res.thumbnailLink || ""));

  const thumbnailHtml = thumbSrc
    ? `<img src="${thumbSrc}" style="width: 60px; height: 80px; object-fit: cover; border-radius: 4px; border: 1px solid #ddd;" onerror="this.onerror=null; this.parentElement.innerHTML='<div style=\\'width:60px;height:80px;background:#eee;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#aaa;\\'><span class=\\'material-symbols-outlined\\'>description</span></div>';" />`
    : `<div style="width: 60px; height: 80px; background: #eee; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #aaa;"><span class="material-symbols-outlined">description</span></div>`;

  // Format amount
  let amountFormatted = "";
  if (res.invoiceAmmount && res.invoiceAmmount > 0) {
    amountFormatted = (res.invoiceAmmount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  // Lexoffice transfers status
  const lexTransfers = job.lexofficeTransfers || {};
  const isInvoiceBadge = res.isInvoice
    ? `<span class="badge bg-success-subtle text-success border border-success-subtle me-1">Rechnung</span>`
    : `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle me-1">Dokument</span>`;

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
          <div class="lexoffice-status-area mt-2 small"></div>
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
        <button class="btn btn-sm btn-outline-secondary rechnung-clickup-btn d-flex align-items-center gap-1" style="border-radius: 20px; padding: 4px 12px; font-size: 12px; border-color: #7b68ee; color: #7b68ee;">
          <span class="material-symbols-outlined" style="font-size: 15px;">cloud_upload</span>
          <span>${job.clickup && job.clickup.taskId ? "ClickUp aktualisieren" : "Zu ClickUp"}</span>
        </button>
      </div>

      <div class="border-top mt-2 pt-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="text-muted small" style="font-size: 12px; font-weight: 500;">Lexoffice Ziel-Firma:</div>
        <div class="d-flex align-items-center gap-2 ms-auto">
          <select class="form-select form-select-sm lexoffice-target-select" style="width: 140px; font-size: 13px;">
            <option value="" ${!defaultTarget ? "selected" : ""} disabled>Firma wählen...</option>
            <option value="wirewire" ${defaultTarget === "wirewire" ? "selected" : ""}>wirewire</option>
            <option value="thewire" ${defaultTarget === "thewire" ? "selected" : ""}>thewire</option>
            <option value="polyxo" ${defaultTarget === "polyxo" ? "selected" : ""}>polyxo</option>
          </select>
          <button class="btn btn-sm btn-primary d-flex align-items-center gap-1 lexoffice-transfer-btn" style="border-radius: 20px; padding: 5px 14px; font-weight: 500; font-size: 13px; white-space: nowrap;">
            <span class="material-symbols-outlined" style="font-size: 16px;">cloud_upload</span>
            <span>Zu Lexoffice</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const targetSelect = card.querySelector(".lexoffice-target-select");
  const transferBtn = card.querySelector(".lexoffice-transfer-btn");
  const statusArea = card.querySelector(".lexoffice-status-area");

  function updateCardStatusDisplay() {
    const selComp = targetSelect.value;
    if (!selComp) {
      statusArea.innerHTML = `
        <span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle d-inline-flex align-items-center gap-1 p-1 px-2">
          <span class="material-symbols-outlined" style="font-size: 14px;">warning</span>
          Firma manuell auswählen
        </span>
      `;
      return;
    }
    const transferInfo = lexTransfers[selComp];

    if (transferInfo) {
      const dateStr = new Date(transferInfo.transferredAt).toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      statusArea.innerHTML = `
        <span class="badge bg-success text-white d-inline-flex align-items-center gap-1 p-1 px-2" style="font-weight: 500;">
          <span class="material-symbols-outlined" style="font-size: 14px;">check_circle</span>
          Übertragen an ${selComp} am ${dateStr}
        </span>
      `;
    } else {
      statusArea.innerHTML = `
        <span class="badge bg-light text-secondary border d-inline-flex align-items-center gap-1 p-1 px-2">
          <span class="material-symbols-outlined" style="font-size: 14px;">info</span>
          Nicht an ${selComp} übertragen
        </span>
      `;
    }
  }

  targetSelect.addEventListener("change", async () => {
    job.targetCompany = targetSelect.value;
    updateCardStatusDisplay();
    try {
      await fetch(`/api/jobs/${job.id}/target-company`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCompany: targetSelect.value }),
      });
    } catch (e) {
      console.error("Fehler beim Speichern der Ziel-Firma:", e);
    }
  });

  updateCardStatusDisplay();

  transferBtn.addEventListener("click", async () => {
    const selComp = targetSelect.value;
    if (!selComp) {
      alert("Bitte wählen Sie zuerst eine Lexoffice Ziel-Firma aus.");
      return;
    }
    transferBtn.disabled = true;
    transferBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> Prüfe...`;

    try {
      // 1. Check if already transferred
      const checkRes = await fetch("/api/lexoffice/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, companyKey: selComp }),
      });
      const checkData = await checkRes.json();

      if (checkData.alreadyTransferred) {
        // Show modal confirmation for re-transfer
        pendingLexofficeTransferTarget = { jobId: job.id, companyKey: selComp, card, transferBtn };
        document.getElementById("confirm-lexoffice-text").innerText =
          `Dieses Dokument wurde am ${new Date(checkData.transferredInfo.transferredAt).toLocaleString("de-DE")} bereits zu Lexoffice (${selComp}) übertragen. Möchtest du es wirklich erneut übertragen?`;
        document.getElementById("confirm-lexoffice-modal").style.display = "flex";
        transferBtn.disabled = false;
        transferBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">cloud_upload</span> <span>Zu Lexoffice</span>`;
        return;
      }

      // 2. Perform transfer
      await executeLexofficeTransfer(job.id, selComp, false, card, transferBtn);
    } catch (err) {
      console.error(err);
      alert("Fehler bei der Prüfung / Übertragung zu Lexoffice: " + err.message);
      transferBtn.disabled = false;
      transferBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">cloud_upload</span> <span>Zu Lexoffice</span>`;
    }
  });

  return card;
}

async function executeLexofficeTransfer(jobId, companyKey, force, card, transferBtn) {
  transferBtn.disabled = true;
  transferBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> Übertrag...`;

  try {
    const res = await fetch("/api/lexoffice/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, companyKey, force }),
    });

    const data = await res.json();
    if (data.success) {
      // Find job in allRechnungenJobs and update lexofficeTransfers
      const targetJob = allRechnungenJobs.find((j) => j.id === jobId);
      if (targetJob) {
        if (!targetJob.lexofficeTransfers) targetJob.lexofficeTransfers = {};
        targetJob.lexofficeTransfers[companyKey] = {
          transferredAt: data.transferredAt,
          lexofficeFileId: data.lexofficeFileId,
          company: companyKey,
        };
      }
      renderRechnungenList();
    } else {
      alert("Übertragung fehlgeschlagen: " + (data.error || "Unbekannter Fehler"));
      transferBtn.disabled = false;
      transferBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">cloud_upload</span> <span>Zu Lexoffice</span>`;
    }
  } catch (e) {
    alert("Fehler bei der Übertragung: " + e.message);
    transferBtn.disabled = false;
    transferBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">cloud_upload</span> <span>Zu Lexoffice</span>`;
  }
}

// Modal handlers for Lexoffice re-transfer
const cancelLexBtn = document.getElementById("cancel-lexoffice-btn");
const confirmLexBtn = document.getElementById("confirm-lexoffice-btn");

if (cancelLexBtn) {
  cancelLexBtn.addEventListener("click", () => {
    document.getElementById("confirm-lexoffice-modal").style.display = "none";
    pendingLexofficeTransferTarget = null;
  });
}

if (confirmLexBtn) {
  confirmLexBtn.addEventListener("click", async () => {
    document.getElementById("confirm-lexoffice-modal").style.display = "none";
    if (pendingLexofficeTransferTarget) {
      const { jobId, companyKey, card, transferBtn } = pendingLexofficeTransferTarget;
      pendingLexofficeTransferTarget = null;
      await executeLexofficeTransfer(jobId, companyKey, true, card, transferBtn);
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

// Click listener delegation for manual transfer buttons
document.addEventListener("click", (e) => {
  const manualBtn = e.target.closest(".btn-manual-clickup-transfer") || e.target.closest(".rechnung-clickup-btn");
  if (manualBtn) {
    e.stopPropagation();
    e.preventDefault();
    const jobId = manualBtn.getAttribute("data-job-id") || manualBtn.closest("[data-job-id]")?.getAttribute("data-job-id") || (activeJobs.find(j => manualBtn.closest(".job-item") && manualBtn.closest(".job-item").innerHTML.includes(j.originalName))?.id);
    if (jobId) {
      executeClickupTransfer(jobId, false, manualBtn);
    }
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
  const { toCreate = [], toUpdate = [], toSkip = [] } = currentSyncPreviewData;

  countCreateSpan.innerText = toCreate.length;
  countUpdateSpan.innerText = toUpdate.length;
  countSkipSpan.innerText = toSkip.length;

  let itemsToRender = [];
  if (currentSyncFilter === "all" || currentSyncFilter === "create") {
    toCreate.forEach((item) => itemsToRender.push({ ...item, type: "create" }));
  }
  if (currentSyncFilter === "all" || currentSyncFilter === "update") {
    toUpdate.forEach((item) => itemsToRender.push({ ...item, type: "update" }));
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
["all", "create", "update", "skip"].forEach((tabKey) => {
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

