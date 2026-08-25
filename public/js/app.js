/**
 * Main Frontend Coordinator & Bootstrapping
 */
import { apiRequest } from "./api.js";
import { state } from "./state.js";
import { showToast, escapeHtml, formatDateDisplay, formatCurrency, formatFileSize } from "./utils.js";
import { initGooglePickerApi, openGooglePicker } from "./drivePicker.js";
import { initDeepSearch } from "./deepSearch.js";
import { initGmailGIS, requestGmailAuth, loadInboxData } from "./gmailScanner.js";
import { openSettingsModal, saveAllSettings, initSettingsEvents } from "./settings.js";
import { openAccountingModal } from "./accounting.js";
import { transferJobToClickUp } from "./clickup.js";
import { openDriveSyncModal, initDriveSyncEvents } from "./driveSync.js";

// Expose globals for HTML event handlers
window.openGooglePicker = openGooglePicker;
window.openSettingsModal = openSettingsModal;
window.saveAllSettings = saveAllSettings;
window.openAccountingModal = openAccountingModal;
window.transferJobToClickUp = transferJobToClickUp;
window.openDriveSyncModal = openDriveSyncModal;
window.requestGmailAuth = requestGmailAuth;
window.loadInboxData = loadInboxData;

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
  if (!confirm("Diesen Beleg wirklich löschen?")) return;
  try {
    await apiRequest(`/api/jobs/${jobId}`, { method: "DELETE" });
    showToast("Beleg gelöscht.", "info");
    refreshStatus();
  } catch (e) {
    showToast("Fehler: " + e.message, "error");
  }
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

function renderJobList(jobs = state.jobs) {
  const container = document.getElementById("job-list") || document.getElementById("jobs-container");
  if (!container) return;

  const countEl = document.getElementById("active-job-count");
  if (countEl) countEl.innerText = `(${jobs.length} Dokumente)`;

  if (jobs.length === 0) {
    container.innerHTML = `<div class="p-5 text-center text-muted">Noch keine Belege vorhanden. Lade oben Dokumente hoch oder starte die Google Drive Synchronisation.</div>`;
    return;
  }

  container.innerHTML = jobs
    .map((job) => {
      const res = job.result || {};
      const title = res.full || job.originalName || "Dokument.pdf";
      const company = res.company || "Unbekannt";
      const category = res.category || "-";
      const amount = res.invoiceAmmount ? formatCurrency(res.invoiceAmmount) : "-";
      const date = res.documentDate || formatDateDisplay(job.uploadDate);

      const statusBadge =
        job.status === "pending" || job.status === "processing"
          ? `<span class="badge bg-warning text-dark"><span class="spinner-border spinner-border-sm me-1"></span>In Pipeline</span>`
          : job.status === "failed"
          ? `<span class="badge bg-danger">Fehler</span>`
          : `<span class="badge bg-success">Erkannt</span>`;

      const duplicateBadge = job.suspectedDuplicate
        ? `<span class="badge bg-danger-subtle text-danger border border-danger-subtle ms-1">Duplikat?</span>`
        : "";

      return `
      <div class="card mb-2 p-3 shadow-sm border ${job.suspectedDuplicate ? "border-danger" : ""}" id="job-card-${job.id}">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div class="d-flex align-items-center gap-3" style="min-width: 250px;">
            <div style="width: 48px; height: 48px; background: #f1f5f9; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
              <span class="material-symbols-outlined text-secondary" style="font-size: 26px;">description</span>
            </div>
            <div>
              <h6 class="mb-0 fw-bold text-dark text-truncate" style="max-width: 450px;" title="${escapeHtml(title)}">${escapeHtml(title)}</h6>
              <div class="small text-muted">
                <strong class="text-dark">${escapeHtml(company)}</strong> &bull; ${escapeHtml(category)} &bull; ${escapeHtml(date)}
              </div>
            </div>
          </div>
          <div class="d-flex align-items-center gap-3">
            <div class="text-end">
              <div class="fw-bold text-dark">${escapeHtml(amount)}</div>
              <div>${statusBadge} ${duplicateBadge}</div>
            </div>
            <div class="btn-group btn-group-sm">
              <a href="/api/jobs/${job.id}/file" target="_blank" class="btn btn-outline-secondary" title="Vorschau"><span class="material-symbols-outlined" style="font-size: 16px;">visibility</span></a>
              ${res.webViewLink ? `<a href="${res.webViewLink}" target="_blank" class="btn btn-outline-secondary" title="In Drive öffnen"><span class="material-symbols-outlined" style="font-size: 16px;">open_in_new</span></a>` : ""}
              <button class="btn btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown"></button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="javascript:void(0)" onclick="window.retryJob('${job.id}')"><span class="material-symbols-outlined me-1" style="font-size: 16px;">refresh</span> Neu analysieren</a></li>
                <li><a class="dropdown-item" href="javascript:void(0)" onclick="window.toggleHideJob('${job.id}', ${!job.isHidden})"><span class="material-symbols-outlined me-1" style="font-size: 16px;">visibility_off</span> ${job.isHidden ? "Einblenden" : "Ausblenden"}</a></li>
                ${job.suspectedDuplicate ? `<li><a class="dropdown-item text-success" href="javascript:void(0)" onclick="window.dismissDuplicate('${job.id}')"><span class="material-symbols-outlined me-1" style="font-size: 16px;">check</span> Kein Duplikat</a></li>` : ""}
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-danger" href="javascript:void(0)" onclick="window.deleteJob('${job.id}')"><span class="material-symbols-outlined me-1" style="font-size: 16px;">delete</span> Löschen</a></li>
              </ul>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

async function refreshStatus() {
  try {
    const data = await apiRequest("/api/status?ids=all");
    state.jobs = data.statuses || [];
    renderJobList(state.jobs);
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
  rechnungenTab?.addEventListener("click", () => switchTab(rechnungenTab, viewRechnungen));
  inboxTab?.addEventListener("click", () => {
    switchTab(inboxTab, viewInbox);
    loadInboxData();
  });
}

// Bootstrapping
window.addEventListener("DOMContentLoaded", async () => {
  initSettingsEvents();
  initDriveSyncEvents();
  initGooglePickerApi();
  initDeepSearch();
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

    const authData = await apiRequest("/api/auth/client-id").catch(() => null);
    if (authData?.clientId) {
      initGmailGIS(authData.clientId);
    }
  } catch (e) {}

  document.getElementById("openDriveSyncBtn")?.addEventListener("click", openDriveSyncModal);

  // Initial load & Polling
  await refreshStatus();
  setInterval(refreshStatus, 8000);
});
