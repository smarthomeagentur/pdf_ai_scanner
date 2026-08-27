/**
 * Main Frontend Coordinator & Bootstrapping
 */
import { apiRequest } from "./api.js";
import { state } from "./state.js";
import { showToast, escapeHtml, formatDateDisplay, formatCurrency, formatFileSize } from "./utils.js";
import { initGooglePickerApi, openGooglePicker } from "./drivePicker.js";
import { initDeepSearch, updateAllFilterCounts } from "./deepSearch.js";
import { initGmailScannerEvents, requestGmailAccountAuth, loadInboxData } from "./gmailScanner.js";
import { openSettingsModal, openAdminLoginModal, saveAllSettings, initSettingsEvents } from "./settings.js";
import { openAccountingModal, loadRechnungenView, initRechnungenEvents, initAccountingEvents } from "./accounting.js";
import { transferJobToClickUp, initClickUpEvents, openClickUpSyncModal } from "./clickup.js";
import { openDriveSyncModal, initDriveSyncEvents } from "./driveSync.js";
import { renderJobsList, initJobEventDelegation, openDocPreview, closeDocPreview, ensureAdminAuth } from "./jobs.js";

// Expose globals for HTML event handlers
window.openGooglePicker = openGooglePicker;
window.openSettingsModal = openSettingsModal;
window.openAdminLoginModal = openAdminLoginModal;
window.saveAllSettings = saveAllSettings;
window.openAccountingModal = openAccountingModal;
window.transferJobToClickUp = transferJobToClickUp;
window.openDriveSyncModal = openDriveSyncModal;
window.openClickUpSyncModal = openClickUpSyncModal;
window.requestGmailAccountAuth = requestGmailAccountAuth;
window.loadInboxData = loadInboxData;
window.loadRechnungenView = loadRechnungenView;
window.openDocPreview = openDocPreview;
window.closeDocPreview = closeDocPreview;
window.renderJobsList = renderJobsList;
window.ensureAdminAuth = ensureAdminAuth;

window.retryJob = async (jobId) => {
  try {
    const job = state.jobs && state.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = "pending";
      job.error = null;
      job.inAiPipeline = true;
      renderJobsList(state.jobs, true);
    }

    const res = await apiRequest(`/api/jobs/${jobId}/retry`, { method: "POST" });
    if (res.success) {
      showToast("KI-Verarbeitung erneut gestartet!", "info");
      refreshStatus();
    } else {
      showToast(res.error || "Fehler beim erneuten Starten.", "error");
      refreshStatus();
    }
  } catch (err) {
    showToast("Fehler: " + err.message, "error");
    refreshStatus();
  }
};

window.toggleHideJob = async (jobId, isHidden) => {
  try {
    await apiRequest(`/api/jobs/${jobId}/hide`, {
      method: "POST",
      body: JSON.stringify({ isHidden }),
    });
    showToast(isHidden ? "Beleg ausgeblendet." : "Beleg eingeblendet.", "info");
    refreshStatus();
  } catch (e) {
    showToast("Fehler: " + e.message, "error");
  }
};

window.deleteJob = async (jobId) => {
  return window.toggleHideJob(jobId, true);
};

window.dismissDuplicate = async (jobId) => {
  try {
    await apiRequest(`/api/jobs/${jobId}/dismiss-duplicate`, { method: "POST" });
    showToast("Duplikat-Warnung aufgehoben.", "success");
    refreshStatus();
  } catch (e) {
    showToast("Fehler: " + e.message, "error");
  }
};

export function updateAdminUiState() {
  const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
  if (navRechnungenTab) {
    navRechnungenTab.style.display = state.isAdmin ? "inline-flex" : "none";
  }
}

async function refreshStatus(force = false) {
  try {
    const data = await apiRequest("/api/status?ids=all");
    if (typeof data.isAdmin === "boolean") {
      const prevAdmin = state.isAdmin;
      state.isAdmin = data.isAdmin;
      if (prevAdmin !== state.isAdmin) {
        updateAdminUiState();
        force = true;
      }
    }
    state.jobs = data.statuses || [];
    renderJobsList(state.jobs, force);
    updateAllFilterCounts();
  } catch (e) {}
}

function initUploadHandlers() {
  const fileInput = document.getElementById("file-input");
  const browseBtn = document.getElementById("browse-btn");
  const dropArea = document.getElementById("drop-area");

  if (browseBtn && fileInput) {
    browseBtn.addEventListener("click", () => fileInput.click());
  }

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) uploadFiles(files);
    });
  }

  if (dropArea) {
    let dragCounter = 0;

    ["dragenter", "dragover"].forEach((eventName) => {
      dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (eventName === "dragenter") dragCounter++;
        dropArea.classList.add("drag-over");
      });
    });

    dropArea.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropArea.classList.remove("drag-over");
      }
    });

    dropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropArea.classList.remove("drag-over");

      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) {
        // Trigger distinct drop-absorption animation
        dropArea.classList.remove("drop-absorbed");
        void dropArea.offsetWidth; // Force reflow
        dropArea.classList.add("drop-absorbed");
        setTimeout(() => {
          dropArea.classList.remove("drop-absorbed");
        }, 900);

        uploadFiles(files);
      }
    });
  }
}

async function uploadFiles(files) {
  const isPrivate = document.getElementById("private-upload-checkbox")?.checked || false;
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  formData.append("isPrivate", isPrivate ? "true" : "false");

  showToast(`${files.length} Datei(en) werden hochgeladen...`, "info");
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (data.jobs) {
      showToast(`${data.jobs.length} Dokument(e) zur KI-Verarbeitung eingereiht.`, "success");
      refreshStatus();
    } else {
      showToast(data.error || "Upload fehlgeschlagen", "error");
    }
  } catch (err) {
    showToast("Upload-Fehler: " + err.message, "error");
  }
}

function initTabSwitching() {
  const uploadTab = document.getElementById("nav-upload-tab") || document.getElementById("nav-main-tab");
  const rechnungenTab = document.getElementById("nav-rechnungen-tab");
  const inboxTab = document.getElementById("nav-inbox-tab");

  const viewUpload = document.getElementById("view-upload") || document.getElementById("view-main");
  const viewRechnungen = document.getElementById("view-rechnungen");
  const viewInbox = document.getElementById("view-inbox");

  const switchTab = (activeTab, activeView) => {
    [uploadTab, rechnungenTab, inboxTab].forEach((t) => t?.classList.remove("active"));
    [viewUpload, viewRechnungen, viewInbox].forEach((v) => {
      if (v) v.style.display = "none";
    });
    activeTab?.classList.add("active");
    if (activeView) activeView.style.display = "block";
  };

  uploadTab?.addEventListener("click", () => switchTab(uploadTab, viewUpload));
  rechnungenTab?.addEventListener("click", () => {
    ensureAdminAuth(() => {
      switchTab(rechnungenTab, viewRechnungen);
      loadRechnungenView();
    });
  });
  inboxTab?.addEventListener("click", () => {
    switchTab(inboxTab, viewInbox);
    loadInboxData();
  });
}

// Bootstrapping
async function initApp() {
  initSettingsEvents();
  initDriveSyncEvents();
  initJobEventDelegation();
  initGooglePickerApi();
  initDeepSearch();
  initGmailScannerEvents();
  initRechnungenEvents();
  initClickUpEvents();
  initAccountingEvents();
  initUploadHandlers();
  initTabSwitching();

  // Load config & verify session
  try {
    const [config, adminCheck] = await Promise.all([
      apiRequest("/api/config").catch(() => ({})),
      apiRequest("/api/admin-check").catch(() => ({})),
    ]);
    state.isAdmin = !!(config.isAdmin || adminCheck.isAdmin);
    updateAdminUiState();
  } catch (e) {}

  document.getElementById("openDriveSyncBtn")?.addEventListener("click", openDriveSyncModal);

  // Initial load & Polling (force render with verified admin state)
  await refreshStatus(true);
  setInterval(() => refreshStatus(false), 8000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
};
