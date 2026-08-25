/**
 * Main Frontend Coordinator & Bootstrapping
 */
import { apiRequest } from "./api.js";
import { state } from "./state.js";
import { showToast, escapeHtml, formatDateDisplay, formatCurrency, formatFileSize } from "./utils.js";
import { initGooglePickerApi, openGooglePicker } from "./drivePicker.js";
import { initDeepSearch, updateAllFilterCounts } from "./deepSearch.js";
import { initGmailScannerEvents, requestGmailAccountAuth, loadInboxData } from "./gmailScanner.js";
import { openSettingsModal, saveAllSettings, initSettingsEvents } from "./settings.js";
import { openAccountingModal, loadRechnungenView, initRechnungenEvents, initAccountingEvents } from "./accounting.js";
import { transferJobToClickUp, initClickUpEvents, openClickUpSyncModal } from "./clickup.js";
import { openDriveSyncModal, initDriveSyncEvents } from "./driveSync.js";
import { renderJobsList, initJobEventDelegation } from "./jobs.js";

// Expose globals for HTML event handlers
window.openGooglePicker = openGooglePicker;
window.openSettingsModal = openSettingsModal;
window.saveAllSettings = saveAllSettings;
window.openAccountingModal = openAccountingModal;
window.transferJobToClickUp = transferJobToClickUp;
window.openDriveSyncModal = openDriveSyncModal;
window.openClickUpSyncModal = openClickUpSyncModal;
window.requestGmailAccountAuth = requestGmailAccountAuth;
window.loadInboxData = loadInboxData;
window.loadRechnungenView = loadRechnungenView;

window.retryJob = async (jobId) => {
  try {
    await apiRequest(`/api/jobs/${jobId}/retry`, { method: "POST" });
    showToast("KI-Erkennung wird erneut durchgeführt.", "info");
    refreshStatus();
  } catch (e) {
    showToast("Fehler: " + e.message, "error");
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

async function refreshStatus() {
  try {
    const data = await apiRequest("/api/status?ids=all");
    state.jobs = data.statuses || [];
    renderJobsList(state.jobs);
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
    ["dragenter", "dragover"].forEach((eventName) => {
      dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropArea.classList.add("highlight");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      dropArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropArea.classList.remove("highlight");
      });
    });
    dropArea.addEventListener("drop", (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) uploadFiles(files);
    });
  }
}

async function uploadFiles(files) {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  try {
    showToast(`${files.length} Datei(en) werden hochgeladen...`, "info");
    const data = await apiRequest("/api/upload", {
      method: "POST",
      body: formData,
    });
    if (data.success) {
      showToast(`${files.length} Datei(en) erfolgreich zur Pipeline hinzugefügt!`, "success");
      refreshStatus();
    }
  } catch (err) {
    showToast("Upload-Fehler: " + err.message, "error");
  }
}

function initTabSwitching() {
  const uploadTab = document.getElementById("nav-upload-tab");
  const rechnungenTab = document.getElementById("nav-rechnungen-tab");
  const inboxTab = document.getElementById("nav-inbox-tab");

  const viewUpload = document.getElementById("view-upload");
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
    switchTab(rechnungenTab, viewRechnungen);
    loadRechnungenView();
  });
  inboxTab?.addEventListener("click", () => {
    switchTab(inboxTab, viewInbox);
    loadInboxData();
  });
}

// Bootstrapping
window.addEventListener("DOMContentLoaded", async () => {
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

  // Load config & client ID for GIS
  try {
    const config = await apiRequest("/api/config");
    state.isAdmin = config.isAdmin;

    const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
    const navInboxTab = document.getElementById("nav-inbox-tab");
    if (state.isAdmin) {
      if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";
      if (navInboxTab) navInboxTab.style.display = "inline-flex";
    }
  } catch (e) {}

  document.getElementById("openDriveSyncBtn")?.addEventListener("click", openDriveSyncModal);

  // Initial load & Polling
  await refreshStatus();
  setInterval(refreshStatus, 8000);
});
