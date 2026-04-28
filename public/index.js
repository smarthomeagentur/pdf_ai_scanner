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
const clearJobsBtn = document.getElementById("clear-jobs-btn");

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

clearJobsBtn.addEventListener("click", async () => {
  activeJobs = [];
  jobListContainer.style.display = "none";
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
        let updated = false;

        activeJobs = data.statuses || [];

        if (activeJobs.length > 0) {
          jobListContainer.style.display = "block";
        } else {
          jobListContainer.style.display = "none";
        }

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
    jobListContainer.style.display = "none";
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
      const tagsStr = job.result.tags && Array.isArray(job.result.tags) ? job.result.tags.join(", ") : "-";
      const isInvoiceStr = job.result.isInvoice ? "Ja" : "Nein";
      const durationStr = job.result.duration ? `${job.result.duration} Sekunden` : "-";

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
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Kategorie:</strong> ${
                              job.result.category || "-"
                            }<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Tags:</strong> ${tagsStr}<br>
                            <strong style="color: var(--md-sys-color-on-surface-variant, #49454F);">Rechnung:</strong> ${isInvoiceStr}<br>
                            <br><strong style="color: var(--md-sys-color-primary, #1A1A1A);">Verarbeitungszeit:</strong> ${durationStr}
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
