/**
 * Main Frontend Coordinator & Bootstrapping
 */
import { apiRequest } from "./api.js?v=20260826_v66";
import { state } from "./state.js?v=20260826_v66";
import { showToast, escapeHtml, formatDateDisplay, formatCurrency, formatFileSize } from "./utils.js?v=20260826_v66";
import { initGooglePickerApi, openGooglePicker } from "./drivePicker.js?v=20260826_v66";
import { initDeepSearch, updateAllFilterCounts } from "./deepSearch.js?v=20260826_v66";
import { initGmailScannerEvents, requestGmailAccountAuth, loadInboxData } from "./gmailScanner.js?v=20260826_v66";
import { openSettingsModal, openAdminLoginModal, saveAllSettings, initSettingsEvents } from "./settings.js?v=20260826_v66";
import { openAccountingModal, loadRechnungenView, initRechnungenEvents, initAccountingEvents } from "./accounting.js?v=20260826_v66";
import { transferJobToClickUp, initClickUpEvents, openClickUpSyncModal } from "./clickup.js?v=20260826_v66";
import { openDriveSyncModal, initDriveSyncEvents } from "./driveSync.js?v=20260826_v66";
import { renderJobsList, initJobEventDelegation, openDocPreview, closeDocPreview, ensureAdminAuth } from "./jobs.js?v=20260826_v66";

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

  // Load config & verify session
  try {
    const [config, adminCheck] = await Promise.all([
      apiRequest("/api/config").catch(() => ({})),
      apiRequest("/api/admin-check").catch(() => ({})),
    ]);
    state.isAdmin = !!(config.isAdmin || adminCheck.isAdmin);

    const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
    const navInboxTab = document.getElementById("nav-inbox-tab");
    if (navRechnungenTab) {
      navRechnungenTab.style.display = state.isAdmin ? "inline-flex" : "none";
    }
    if (navInboxTab) {
      navInboxTab.style.display = "inline-flex";
    }
  } catch (e) {}

  document.getElementById("openDriveSyncBtn")?.addEventListener("click", openDriveSyncModal);

  // Initial load & Polling
  await refreshStatus();
  setInterval(refreshStatus, 8000);
});
