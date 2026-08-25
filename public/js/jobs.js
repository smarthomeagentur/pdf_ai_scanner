/**
 * Jobs Grid Rendering & Document Actions
 */
import { escapeHtml, formatFileSize, formatDateDisplay, formatCurrency, showToast } from "./utils.js";
import { apiRequest } from "./api.js";
import { state } from "./state.js";

export function renderJobsList(jobs = state.jobs) {
  const container = document.getElementById("jobs-container");
  if (!container) return;

  const filtered = filterJobs(jobs, state.activeFilter);
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center py-5 text-muted">
        <i class="bi bi-inbox fs-1 d-block mb-3"></i>
        Keine Belege in dieser Ansicht vorhanden.
      </div>`;
    return;
  }

  container.innerHTML = filtered
    .map((job) => {
      const isCompleted = job.status === "completed";
      const isPending = job.status === "pending" || job.status === "processing";
      const res = job.result || {};

      const title = res.full || job.originalName || "Dokument.pdf";
      const company = res.company || "Unbekannt";
      const category = res.category || "-";
      const amount = res.invoiceAmmount ? formatCurrency(res.invoiceAmmount) : "-";
      const date = res.documentDate || formatDateDisplay(job.uploadDate);

      const statusBadge = isPending
        ? `<span class="badge bg-warning text-dark"><span class="spinner-border spinner-border-sm me-1"></span>In Pipeline</span>`
        : job.status === "failed"
        ? `<span class="badge bg-danger">Fehler</span>`
        : `<span class="badge bg-success">Erkannt</span>`;

      const duplicateBadge = job.suspectedDuplicate
        ? `<span class="badge bg-danger-subtle text-danger border border-danger-subtle ms-1"><i class="bi bi-exclamation-triangle me-1"></i>Duplikat?</span>`
        : "";

      const thumbUrl = `/api/thumbnail/${job.id}?t=${Date.now()}`;

      return `
      <div class="col-12 col-md-6 col-lg-4 mb-4" id="job-card-${job.id}">
        <div class="card h-100 shadow-sm border-0 job-card ${job.suspectedDuplicate ? "border-danger" : ""}">
          <div class="position-relative bg-light text-center py-2 preview-box" style="height: 180px; overflow: hidden; cursor: pointer;" onclick="window.openJobDetails('${job.id}')">
            <img src="${thumbUrl}" class="img-fluid h-100 rounded" style="object-fit: contain;" alt="Vorschau" onerror="this.src='/icon.svg'; this.style.opacity='0.3';">
            <div class="position-absolute top-0 end-0 m-2 d-flex gap-1">
              ${statusBadge}
              ${duplicateBadge}
            </div>
          </div>
          <div class="card-body p-3 d-flex flex-column justify-content-between">
            <div>
              <h6 class="card-title text-truncate fw-bold mb-1" title="${escapeHtml(title)}">${escapeHtml(title)}</h6>
              <div class="small text-muted mb-2">
                <span class="fw-semibold text-dark">${escapeHtml(company)}</span> &bull; ${escapeHtml(category)}
              </div>
              <div class="d-flex justify-content-between align-items-center small text-secondary">
                <span>${escapeHtml(date)}</span>
                <span class="fw-bold text-dark">${escapeHtml(amount)}</span>
              </div>
            </div>
            <div class="d-flex justify-content-between align-items-center mt-3 pt-2 border-top">
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-secondary" onclick="window.openJobDetails('${job.id}')"><i class="bi bi-eye"></i> Details</button>
                ${res.webViewLink ? `<a href="${res.webViewLink}" target="_blank" class="btn btn-outline-secondary" title="In Google Drive öffnen"><i class="bi bi-google"></i></a>` : ""}
              </div>
              <div class="dropdown">
                <button class="btn btn-sm btn-light dropdown-toggle" type="button" data-bs-toggle="dropdown"></button>
                <ul class="dropdown-menu dropdown-menu-end">
                  <li><a class="dropdown-menu-item text-primary" href="javascript:void(0)" onclick="window.retryJob('${job.id}')"><i class="bi bi-arrow-repeat me-2"></i>Neu analysieren</a></li>
                  <li><a class="dropdown-menu-item" href="javascript:void(0)" onclick="window.toggleHideJob('${job.id}', ${!job.isHidden})"><i class="bi ${job.isHidden ? "bi-eye" : "bi-eye-slash"} me-2"></i>${job.isHidden ? "Einblenden" : "Ausblenden"}</a></li>
                  ${job.suspectedDuplicate ? `<li><a class="dropdown-menu-item text-success" href="javascript:void(0)" onclick="window.dismissDuplicate('${job.id}')"><i class="bi bi-check-circle me-2"></i>Kein Duplikat</a></li>` : ""}
                  <li><hr class="dropdown-divider"></li>
                  <li><a class="dropdown-menu-item text-danger" href="javascript:void(0)" onclick="window.deleteJob('${job.id}')"><i class="bi bi-trash me-2"></i>Löschen</a></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function filterJobs(jobs, filter) {
  switch (filter) {
    case "open":
      return jobs.filter((j) => (j.status === "pending" || j.status === "processing") && !j.isHidden);
    case "invoices":
      return jobs.filter((j) => j.result?.isInvoice && !j.isHidden);
    case "duplicates":
      return jobs.filter((j) => j.suspectedDuplicate && !j.isHidden);
    case "hidden":
      return jobs.filter((j) => j.isHidden);
    case "all":
    default:
      return jobs.filter((j) => !j.isHidden);
  }
}
