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

  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      FOLDER_ID: rawFolderId,
      FOLDER_ID_SORTED: aiFolderId,
      AI_CATEGORIES: aiCategories,
      AI_COMPANY: aiCompany,
      MONITOR_DRIVE: monitorDriveState,
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

async function uploadFiles(files) {
  let formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append("files", files[i]);
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
  if (pollingInterval) return;

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/status?ids=all`);
      const data = await res.json();

      if (data.success) {
        activeJobs = data.statuses || [];
        renderJobs();

        // Stop polling dynamically if no jobs are pending on server
        const hasPendingServerJobs = activeJobs.some((j) => j.status === "pending" || j.status === "processing");
        if (!hasPendingServerJobs && activeJobs.length === 0) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
      }
    } catch (err) {
      console.error("Polling error", err);
    }
  };

  fetchStatus();
  pollingInterval = setInterval(fetchStatus, 5000); // 5 Sekunden Polling
}

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

      if (job.result.localThumbnail || job.result.thumbnailLink) {
        const imgSrc = job.result.localThumbnail || job.result.thumbnailLink;
        previewHtml = `<a href="${
          job.result.webViewLink || "#"
        }" target="_blank" style="position: absolute; right: 15px; top: 17px; width: 60px; height: 84px; text-decoration: none;">
                        <img src="${imgSrc}" alt="PDF Vorschau" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); background: #fff; display: block; border: 1px solid #ddd;">
                    </a>`;
      }

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
${invoiceHtml}                            <br><strong style="color: var(--md-sys-color-primary, #1A1A1A);">Verarbeitungszeit:</strong> ${durationStr}
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
                            <span style="word-break: break-word; line-height: 1.2;">${job.originalName}</span>
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
