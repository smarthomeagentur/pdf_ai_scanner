/**
 * Document Pipeline - Jobs List Rendering, Search & Action Management
 */
import { escapeHtml, formatFileSize, formatDateDisplay, formatCurrency, highlightQueryText, showToast, debugLog } from "./utils.js";
import { apiRequest } from "./api.js";
import { state } from "./state.js";
import { openAccountingModal } from "./accounting.js";
import { transferJobToClickUp } from "./clickup.js";

const START_PAGE_SIZE = 50;
let currentPage = 1;
const openDetailsStates = {};
let lastRenderSignature = "";

export function renderJobsList(jobs = state.jobs, force = false) {
  const jobList = document.getElementById("job-list");
  if (!jobList) return;

  // Don't re-render if user is currently interacting with an open category/company picker or typing notes
  if (
    document.querySelector(".category-picker-box") ||
    document.querySelector(".company-picker-box") ||
    document.activeElement?.classList.contains("job-notes-input")
  ) {
    return;
  }

  const filteredJobs = filterAndSortJobs(jobs);
  const totalFiltered = filteredJobs.length;
  const totalPages = Math.ceil(totalFiltered / START_PAGE_SIZE) || 1;

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  // Update counters
  const countSpan = document.getElementById("active-job-count");
  if (countSpan) {
    const activeCount = jobs.filter((j) => j.status === "pending" || j.status === "processing").length;
    let label = `(${totalFiltered} Belege)`;
    if (activeCount > 0) label += ` (${activeCount} in Arbeit)`;
    countSpan.innerText = label;
  }

  const hiddenCountSpan = document.getElementById("hidden-jobs-count");
  if (hiddenCountSpan) {
    const hiddenCount = jobs.filter((j) => j.isHidden).length;
    hiddenCountSpan.innerText = hiddenCount;
  }

  const startIndex = (currentPage - 1) * START_PAGE_SIZE;
  const endIndex = Math.min(startIndex + START_PAGE_SIZE, totalFiltered);
  const pageJobs = filteredJobs.slice(startIndex, endIndex);

  // Avoid visual flicker: check if page data or filters actually changed
  const currentSignature = JSON.stringify({
    page: currentPage,
    filter: state.activeFilter,
    search: state.searchQuery,
    comp: state.companyFilter,
    date: state.dateFilter,
    sort: state.sortOrder,
    cats: Array.from(state.selectedCategories || []).sort(),
    jobs: pageJobs.map((j) => [
      j.id,
      j.status,
      j.error,
      j.result?.full,
      j.result?.documentDate,
      j.result?.invoiceNumber,
      j.result?.invoiceAmmount,
      j.clickup?.taskId,
      j.clickup?.status,
      j.isHidden,
      j.isPrivate,
      j.suspectedDuplicate,
      Object.keys(j.lexofficeTransfers || {}).join(","),
    ]),
  });

  if (!force && currentSignature === lastRenderSignature) {
    return;
  }
  lastRenderSignature = currentSignature;

  jobList.innerHTML = "";

  if (totalFiltered === 0) {
    jobList.innerHTML = `
      <div class="text-center p-5 text-muted bg-white rounded shadow-sm border my-2">
        <span class="material-symbols-outlined mb-2" style="font-size: 40px; color: #cbd5e1;">search_off</span>
        <div class="fw-medium">${state.searchQuery ? `Keine Treffer für "${escapeHtml(state.searchQuery)}"` : "Keine Belege in dieser Ansicht vorhanden."}</div>
      </div>`;
    renderPagination(0, 1);
    return;
  }

  pageJobs.forEach((job) => {
    // Special handling for Drive-only results found in cloud OCR
    if (job.isDriveOnly) {
      const div = document.createElement("div");
      div.className = "job-item completed";
      div.style.borderLeft = "4px solid #0284c7";
      const docDateDisplay = formatDateDisplay(job.date || job.uploadDate);
      const highlightedTitle = highlightQueryText(job.originalName || job.name || "Google Drive Dokument", state.searchQuery);
      const snippet = job.snippet || (state.deepSearchSnippets && state.deepSearchSnippets.get(job.id));
      const highlightedSnippet = snippet ? highlightQueryText(snippet, state.searchQuery) : "";
      const rawDriveId = String(job.id).replace(/^gdrive_/, "");
      const webViewLink = job.webViewLink || `https://drive.google.com/file/d/${rawDriveId}/view`;
      const thumbUrl = job.thumbnailLink || `/api/thumbnail/${rawDriveId}`;

      div.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
          <div class="flex-grow-1" style="min-width: 0; display: flex; flex-direction: column;">
            <div class="job-title" style="display: flex; flex-direction: column; gap: 3px;">
              <div class="d-flex align-items-center gap-1 flex-wrap">
                <span class="badge bg-primary-subtle text-primary border border-primary-subtle d-inline-flex align-items-center gap-1" style="font-size: 12px; padding: 4px 9px; border-radius: 6px; font-weight: 600;">
                  <span class="material-symbols-outlined" style="font-size: 14px;">cloud</span> Google Drive
                </span>
                <span class="badge bg-light text-dark border d-inline-flex align-items-center gap-1" style="font-size: 12px; padding: 4px 8px; border-radius: 6px; font-weight: 500;">
                  <span class="material-symbols-outlined text-muted" style="font-size: 13px;">description</span> ${highlightedTitle}
                </span>
              </div>
              <div class="d-flex align-items-center gap-2 flex-wrap" style="font-size: 12.5px; color: #64748b; margin-top: 4px;">
                <span class="d-inline-flex align-items-center gap-1">
                  <span class="material-symbols-outlined" style="font-size: 15px; color: #64748b;">calendar_today</span>
                  <span><strong style="color: #475569; font-weight: 600;">Datum:</strong> <span style="color: #1e293b;">${escapeHtml(docDateDisplay)}</span></span>
                </span>
              </div>
            </div>
            ${highlightedSnippet ? `
              <div class="p-2 my-2 rounded border bg-light text-secondary" style="font-size: 12px; line-height: 1.4; border-left: 3px solid #0d6efd !important;">
                <div class="d-flex align-items-center gap-1 text-primary small fw-bold mb-1">
                  <span class="material-symbols-outlined" style="font-size: 14px;">manage_search</span>
                  <span>Textausschnitt / OCR-Fundstelle (Google Drive):</span>
                </div>
                <div class="font-monospace text-dark bg-white p-2 rounded border" style="font-size: 11.5px; line-height: 1.4; word-break: break-word;">${highlightedSnippet}</div>
              </div>` : ""}
          </div>
          <div class="flex-shrink-0">
            <a href="${webViewLink}" data-job-id="${job.id}" class="pdf-preview-container btn-open-doc-preview" title="Dokument in Google Drive öffnen">
              <img src="${thumbUrl}" loading="lazy" alt="Vorschau" class="pdf-preview-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
            </a>
          </div>
        </div>
        <div class="job-body-section" style="width: 100%;">
          <div class="job-action-bar d-flex align-items-center gap-2 flex-wrap">
            ${state.isAdmin ? `
              <button type="button" class="btn btn-sm btn-primary d-inline-flex align-items-center gap-1 btn-import-drive-file" data-drive-id="${rawDriveId}" data-file-name="${escapeHtml(job.originalName || job.name || '')}" style="border-radius: 8px; font-size: 12px; padding: 4px 12px; font-weight: 500;">
                <span class="material-symbols-outlined" style="font-size: 16px;">cloud_download</span>
                <span>Importieren & per KI verarbeiten</span>
              </button>
            ` : ""}
            <a href="${webViewLink}" target="_blank" class="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1" style="border-radius: 8px; font-size: 12px; padding: 4px 10px; text-decoration: none;">
              <span class="material-symbols-outlined" style="font-size: 15px;">open_in_new</span>
              <span>In Google Drive öffnen</span>
            </a>
          </div>
        </div>`;
      jobList.appendChild(div);
      return;
    }

    const isFailed = job.status === "error" || job.status === "failed" || !!job.error;
    const div = document.createElement("div");
    div.className = `job-item ${job.status || "completed"} ${isFailed ? "border-danger-subtle" : ""}`;
    if (job.isPrivate) {
      div.style.borderLeft = "4px solid #f44336";
      div.style.backgroundColor = "#fff8f8";
    }

    const res = job.result || {};
    const isInvoice = res.isInvoice === true || job.isInvoice === true;

    // 0. Error Header Banner (if failed/error)
    let errorHeaderHtml = "";
    if (isFailed) {
      const errMsg = job.error || "Fehler bei der KI-Verarbeitung (z.B. Ollama nicht erreichbar)";
      errorHeaderHtml = `
        <div class="job-error-header d-flex align-items-center justify-content-between p-2 px-3 mb-2 rounded border gap-2" style="background: #fff1f2; border: 1px solid #fecdd3 !important;">
          <div class="d-flex align-items-center gap-2 text-danger" style="min-width: 0; flex: 1 1 auto; overflow: hidden;">
            <span class="material-symbols-outlined flex-shrink-0" style="font-size: 18px; color: #e11d48;">error</span>
            <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #9f1239;" title="${escapeHtml(errMsg)}">
              <strong style="color: #881337;">Fehler:</strong> ${escapeHtml(errMsg)}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-danger btn-reprocess-ai d-inline-flex align-items-center gap-1 flex-shrink-0" data-job-id="${job.id}" style="background: #ffffff; border-color: #fca5a5; color: #dc2626; font-size: 11.5px; padding: 2px 9px; height: 26px; border-radius: 6px; white-space: nowrap;" title="Verarbeitung erneut starten">
            <span class="material-symbols-outlined" style="font-size: 14px;">replay</span>
            <span>Wiederholen</span>
          </button>
        </div>`;
    }

    // 1. Private Toggle Pill
    let privateBadgeHtml = "";
    if (state.isAdmin) {
      const bg = job.isPrivate ? "#fef2f2" : "#f1f5f9";
      const color = job.isPrivate ? "#dc2626" : "#475569";
      const border = job.isPrivate ? "#fecaca" : "#cbd5e1";
      const icon = job.isPrivate ? "lock" : "lock_open";
      const text = job.isPrivate ? "PRIVAT" : "ÖFFENTLICH";
      privateBadgeHtml = `
        <span class="toggle-private-pill" data-job-id="${job.id}" style="cursor: pointer; background: ${bg}; color: ${color}; border: 1px solid ${border}; padding: 2px 8px; border-radius: 12px; font-size: 10.5px; vertical-align: middle; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;" title="Klicken zum Umschalten (Privat/Öffentlich)">
          <span class="material-symbols-outlined" style="font-size: 12px;">${icon}</span> ${text}
        </span>`;
    } else if (job.isPrivate) {
      privateBadgeHtml = `<span style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 2px 7px; border-radius: 12px; font-size: 10.5px; vertical-align: middle; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;">🔒 PRIVAT</span>`;
    }

    // 2. Accounting status
    const lexTransfers = job.lexofficeTransfers || {};
    const transferredCompanies = Object.keys(lexTransfers);
    const isLexTransferred = transferredCompanies.length > 0;
    let lexofficeBadgeHtml = "";
    if (isLexTransferred) {
      const comp = transferredCompanies[0];
      const provider = lexTransfers[comp]?.provider === "buchhaltungsbutler" ? "BuchhaltungsButler" : "Lexoffice";
      lexofficeBadgeHtml = `<span style="background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; padding: 2px 7px; border-radius: 12px; font-size: 10.5px; vertical-align: middle; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;">✓ ${provider} (${comp})</span>`;
    }

    // 3. Duplicate status
    let duplicateBadgeHtml = "";
    if (job.suspectedDuplicate) {
      duplicateBadgeHtml = `<span class="badge-open-duplicate-compare" data-job-id="${job.id}" style="background: #fff7ed; color: #c2410c; border: 1px solid #ffedd5; padding: 2px 8px; border-radius: 12px; font-size: 10.5px; vertical-align: middle; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; font-weight: 600;"><span class="material-symbols-outlined" style="font-size: 12px;">warning</span> DUPLIKAT VERDACHT</span>`;
    }

    // 4. Status badge (Processing/Pending)
    let statusHtml = "";
    if (job.status === "pending") {
      statusHtml = `<div class="job-status mt-1"><span class="badge bg-warning-subtle text-dark border d-inline-flex align-items-center gap-1" style="font-size: 11px; padding: 3px 8px;"><span class="spinner-border spinner-border-sm text-warning" style="width: 10px; height: 10px;"></span> In Warteschlange...</span></div>`;
    } else if (job.status === "processing") {
      statusHtml = `<div class="job-status mt-1"><span class="badge bg-info-subtle text-primary border border-info-subtle d-inline-flex align-items-center gap-1" style="font-size: 11px; padding: 3px 8px;"><span class="spinner-border spinner-border-sm text-primary" style="width: 10px; height: 10px;"></span> In KI-Pipeline...</span></div>`;
    }

    // 5. Title Line: 3 Prominente Tags mit Suchhervorhebung
    const titleBadgesHtml = formatTitleBadgesHtml(job, state.searchQuery);

    // 6. Dates, Invoice details & Amounts
    const docDateDisplay = res.documentDate || formatDateDisplay(job.uploadDate);
    const uploadDateDisplay = formatDateDisplay(job.uploadDate);
    const invoiceNumber = (res.invoiceNumber || job.invoiceNumber) && (res.invoiceNumber || job.invoiceNumber) !== "none" ? (res.invoiceNumber || job.invoiceNumber) : null;
    const invoiceAmtRaw = res.invoiceAmmount !== undefined ? res.invoiceAmmount : job.invoiceAmmount;
    const invoiceAmtDisplay = (invoiceAmtRaw !== undefined && invoiceAmtRaw !== null && invoiceAmtRaw !== 0) ? formatCurrency(invoiceAmtRaw) : "";

    // 7. Preview Image
    const webViewLink = res.webViewLink || job.webViewLink || (job.filePath ? `/api/jobs/${job.id}/file` : "#");
    const thumbUrl = `/api/thumbnail/${job.id}?v=${job.aiPipelineCompletedAt || job.uploadDate || 1}`;
    const previewHtml = `
      <a href="${webViewLink}" data-job-id="${job.id}" class="pdf-preview-container" title="Beleg öffnen">
        <img src="${thumbUrl}" loading="lazy" alt="Vorschau" class="pdf-preview-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
      </a>`;

    // 8. OCR Deep Search Snippet box (if fulltext match)
    let snippetHtml = "";
    const snippet = job.snippet || (state.deepSearchSnippets && state.deepSearchSnippets.get(job.id));
    if (snippet && state.searchQuery) {
      const highlightedSnippet = highlightQueryText(snippet, state.searchQuery);
      snippetHtml = `
        <div class="p-2 my-2 rounded border bg-light text-secondary" style="font-size: 12px; line-height: 1.4; border-left: 3px solid #0d6efd !important;">
          <div class="d-flex align-items-center gap-1 text-primary small fw-bold mb-1">
            <span class="material-symbols-outlined" style="font-size: 14px;">manage_search</span>
            <span>Textausschnitt / OCR-Fundstelle:</span>
          </div>
          <div class="font-monospace text-dark bg-white p-2 rounded border" style="font-size: 11.5px; line-height: 1.4; word-break: break-word;">${highlightedSnippet}</div>
        </div>`;
    }

    // 9. Action Bar & Details
    const isClickupSynced = !!(job.clickup && job.clickup.taskId);
    const isDetailsOpen = openDetailsStates[job.id] === true;

    const safeCompany = escapeHtml(res.company || job.targetCompany || "Unbekannt");
    const safeCategory = escapeHtml(res.category || "-");

    div.innerHTML = `
      <!-- Top header section: info on left, thumbnail on right -->
      <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
        <div class="flex-grow-1" style="min-width: 0; display: flex; flex-direction: column;">
          ${errorHeaderHtml}
          <div class="job-title" style="display: flex; flex-direction: column; gap: 3px;">
            <!-- Zeile 1: Die 3 prominenten Tags -->
            <div>${titleBadgesHtml}</div>
            
            <!-- Zeile 2: Status-Pills -->
            ${(privateBadgeHtml || duplicateBadgeHtml || lexofficeBadgeHtml) ? `
              <div class="d-flex align-items-center gap-1 flex-wrap mt-1">
                ${privateBadgeHtml}
                ${duplicateBadgeHtml}
                ${lexofficeBadgeHtml}
              </div>` : ""}

            <!-- Zeile 3: Dokumentendatum & Rechnungs-Info (Datum, Rechnungs-Nr, Betrag linksbündig) -->
            <div class="d-flex align-items-center gap-2 flex-wrap" style="font-size: 12.5px; color: #64748b; margin-top: 4px;">
              <span class="d-inline-flex align-items-center gap-1">
                <span class="material-symbols-outlined" style="font-size: 15px; color: #64748b;">calendar_today</span>
                <span><strong style="color: #475569; font-weight: 600;">Datum:</strong> <span style="color: #1e293b;">${escapeHtml(docDateDisplay)}</span></span>
              </span>
              ${isInvoice && invoiceNumber ? `
                <span class="d-inline-flex align-items-center gap-1 border-start ps-2">
                  <span class="material-symbols-outlined" style="font-size: 15px; color: #64748b;">receipt_long</span>
                  <span><strong style="color: #475569; font-weight: 600;">Rechnungs-Nr:</strong> <span style="color: #1e293b;">${highlightQueryText(invoiceNumber, state.searchQuery)}</span></span>
                </span>` : ""}
              ${isInvoice && invoiceAmtDisplay ? `
                <span class="d-inline-flex align-items-center gap-1 border-start ps-2">
                  <span class="material-symbols-outlined text-success" style="font-size: 15px;">payments</span>
                  <span><strong style="color: #475569; font-weight: 600;">Betrag:</strong> <span class="fw-bold text-success font-monospace">${invoiceAmtDisplay}</span></span>
                </span>` : ""}
            </div>
          </div>
          ${statusHtml}
          ${snippetHtml}
        </div>
        <div class="flex-shrink-0">
          ${previewHtml}
        </div>
      </div>

      <!-- Action Bar & Details Section (Spans 100% full width of card) -->
      <div class="job-body-section" style="width: 100%;">
        <div class="job-action-bar d-flex align-items-center gap-2 flex-wrap">
          <button type="button" class="job-action-btn btn-toggle-details btn-details" data-job-id="${job.id}">
            <span class="material-symbols-outlined">${isDetailsOpen ? "expand_less" : "info"}</span>
            <span>Details</span>
          </button>
          ${state.isAdmin ? `
            <button type="button" class="job-action-btn btn-manual-clickup-transfer ${isClickupSynced ? "btn-clickup-synced" : "btn-clickup-pending"}" data-job-id="${job.id}">
              <span class="material-symbols-outlined">${isClickupSynced ? "check_circle" : "cloud_upload"}</span>
              <span>ClickUp</span>
            </button>
            <button type="button" class="job-action-btn btn-manual-lexoffice-sync ${isLexTransferred ? "btn-accounting-synced" : "btn-accounting-pending"}" data-job-id="${job.id}">
              <span class="material-symbols-outlined">${isLexTransferred ? "check_circle" : "sync"}</span>
              <span>Buchhalt.</span>
            </button>
          ` : ""}
        </div>

        <!-- Details Accordion (100% Full Width) -->
        <details class="job-result" data-job-id="${job.id}" style="width: 100%; transition: all 0.3s;" ${isDetailsOpen ? "open" : ""}>
          <summary style="display: none;"></summary>
          <div class="mt-2 p-3 bg-white rounded-3 border shadow-sm" style="font-size: 13px; line-height: 1.6; width: 100%;">
            <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom flex-wrap gap-2">
              <span class="fw-bold text-muted small" style="text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Dokumentendetails</span>
              <div class="d-flex align-items-center gap-2">
                <button type="button" class="job-action-btn btn-reprocess-ai" data-job-id="${job.id}" title="KI-Erkennung wiederholen">
                  <span class="material-symbols-outlined">psychology</span>
                  <span>KI wiederholen</span>
                </button>
                <button type="button" class="job-action-btn btn-hide-job ${job.isHidden ? "btn-hidden-active" : ""}" data-job-id="${job.id}" data-is-hidden="${!!job.isHidden}" title="${job.isHidden ? "Beleg einblenden" : "Beleg ausblenden"}">
                  <span class="material-symbols-outlined">${job.isHidden ? "visibility" : "visibility_off"}</span>
                  <span>${job.isHidden ? "Einblenden" : "Ausblenden"}</span>
                </button>
              </div>
            </div>

            ${isFailed ? `
              <div class="p-2 mb-2 rounded bg-danger-subtle text-danger border border-danger-subtle" style="font-size: 12px; line-height: 1.4;">
                <strong>Fehlerursache:</strong> ${escapeHtml(job.error || "Unbekannter Fehler bei der Analyse")}
              </div>` : ""}

            <div><strong style="color: #475569;">Originaler Dateiname:</strong> ${highlightQueryText(job.originalName || "-", state.searchQuery)}</div>
            <div><strong style="color: #475569;">Hochgeladen am:</strong> ${escapeHtml(uploadDateDisplay)}</div>
            <div><strong style="color: #475569;">Dokumentendatum:</strong> ${escapeHtml(docDateDisplay)}</div>
            
            <!-- Bearbeitbares Unternehmen -->
            <div class="my-1 d-flex align-items-center gap-2">
              <strong style="color: #475569;">Unternehmen:</strong> 
              <div style="position: relative; display: inline-block;">
                <span class="company-editable" data-job-id="${job.id}" data-current-comp="${safeCompany}" style="cursor: pointer; padding: 3px 10px; border-radius: 16px; background: #e0f2fe; color: #0369a1; font-size: 12.5px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;" title="Klicken zum Ändern">
                  ${highlightQueryText(safeCompany, state.searchQuery)} <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>
                </span>
              </div>
            </div>

            <!-- Bearbeitbare Kategorie -->
            <div class="my-1 d-flex align-items-center gap-2">
              <strong style="color: #475569;">Kategorie:</strong> 
              <div style="position: relative; display: inline-block;">
                <span class="category-editable" data-job-id="${job.id}" data-current-cat="${safeCategory}" style="cursor: pointer; padding: 3px 10px; border-radius: 16px; background: #f3e8ff; color: #6b21a8; font-size: 12.5px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;" title="Klicken zum Ändern">
                  ${highlightQueryText(safeCategory, state.searchQuery)} <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>
                </span>
              </div>
            </div>

            ${isInvoice ? `
              <div><strong style="color: #475569;">Rechnungs-Nr:</strong> ${highlightQueryText(invoiceNumber || "-", state.searchQuery)}</div>
              <div><strong style="color: #475569;">Rechnungsbetrag:</strong> ${invoiceAmtDisplay || "-"}</div>
            ` : ""}

            ${res.duration ? `<div><strong style="color: #475569;">Verarbeitungszeit:</strong> ${res.duration} s</div>` : ""}

            <div class="mt-2 pt-2 border-top">
              <label class="fw-semibold text-muted small d-flex align-items-center gap-1 mb-1">
                <span class="material-symbols-outlined" style="font-size: 15px;">edit_note</span> Notizen zu diesem Beleg:
              </label>
              <textarea class="form-control job-notes-input" data-job-id="${job.id}" rows="2" placeholder="Notizen hinterlegen..." style="font-size: 12.5px; border-radius: 8px;">${escapeHtml(job.notes || "")}</textarea>
            </div>
          </div>
        </details>
      </div>`;

    jobList.appendChild(div);
  });

  renderPagination(totalFiltered, totalPages);
}

function formatTitleBadgesHtml(job, searchQuery = "") {
  const res = job.result || {};
  if (job.status !== "completed" || !job.result) {
    return `<span class="fw-bold text-dark" style="font-size: 14px;">${highlightQueryText(job.originalName || "Dokument.pdf", searchQuery)}</span>`;
  }

  const category = (res.category && res.category !== "unknown") ? res.category : (res.isInvoice ? "Rechnungen" : "Dokumente");
  const company = (res.company && res.company !== "unknown") ? res.company : (job.targetCompany || "Unbekannt");

  let tagsArray = [];
  if (Array.isArray(res.tags)) {
    tagsArray = res.tags;
  } else if (typeof res.tags === "string" && res.tags.trim()) {
    tagsArray = res.tags.split(",").map((t) => t.trim());
  }

  const cleanTags = tagsArray
    .map((t) => String(t).trim().replace(/^[-_\s]+|[-_\s]+$/g, ""))
    .filter((t) => t.length > 0 && !["unknown", "none", "pdf", "scan"].includes(t.toLowerCase()))
    .slice(0, 3);

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
    </div>`;
}

function filterAndSortJobs(jobs) {
  let list = [...jobs];

  // 1. Hide/Unhide Filter
  if (state.activeFilter === "hidden") {
    list = list.filter((j) => j.isHidden);
  } else {
    list = list.filter((j) => !j.isHidden);
  }

  // 2. Search Query (Metadata Match OR OCR Deep Search Match)
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter((job) => {
      const res = job.result || {};
      const title = (res.full || job.originalName || "").toLowerCase();
      const comp = (res.company || "").toLowerCase();
      const targetComp = (job.targetCompany || "").toLowerCase();
      const invNum = (res.invoiceNumber || job.invoiceNumber || "").toLowerCase();
      const cat = (res.category || "").toLowerCase();
      const tags = (res.tags && Array.isArray(res.tags) ? res.tags.join(" ") : (typeof res.tags === "string" ? res.tags : "")).toLowerCase();
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

      const matchesOcr = state.deepSearchSnippets && state.deepSearchSnippets.has(job.id);

      return matchesMetadata || matchesOcr;
    });

    if (state.driveOnlySearchResults && state.driveOnlySearchResults.length > 0) {
      state.driveOnlySearchResults.forEach((d) => {
        if (!list.some((existing) => existing.id === d.id)) {
          list.push(d);
        }
      });
    }
  }

  // 3. Category Bubbles Filter
  if (state.selectedCategories.size > 0) {
    list = list.filter((job) => {
      const res = job.result || {};
      const jobCat = (res.category || "").toLowerCase();
      const isInvoice = res.isInvoice === true || jobCat.includes("rechnung");
      const isPrivat = job.isPrivate === true || jobCat.includes("privat");

      for (const selCat of state.selectedCategories) {
        if (selCat.includes("duplikat") && job.suspectedDuplicate) return true;
        if ((selCat === "rechnungen" || selCat === "rechnung") && isInvoice) return true;
        if ((selCat === "dokumente" || selCat === "dokument") && !isInvoice) return true;
        if (selCat === "privat" && isPrivat) return true;
        if (jobCat.includes(selCat)) return true;
      }
      return false;
    });
  }

  // 4. Company Filter
  if (state.companyFilter !== "alle") {
    list = list.filter((j) => {
      const comp = (j.result?.company || j.targetCompany || "").toLowerCase();
      if (state.companyFilter === "thewire") return comp.includes("the wire") || comp.includes("thewire");
      if (state.companyFilter === "wirewire") return comp.includes("wirewire");
      if (state.companyFilter === "polyxo") return comp.includes("polyxo");
      if (state.companyFilter === "daniel") return comp.includes("daniel");
      return !comp.includes("wirewire") && !comp.includes("the wire") && !comp.includes("polyxo") && !comp.includes("daniel");
    });
  }

  // 5. Date Filter
  if (state.dateFilter !== "alle") {
    list = list.filter((j) => {
      const dateVal = j.result?.documentDate ? new Date(j.result.documentDate) : (j.uploadDate ? new Date(j.uploadDate) : null);
      if (!dateVal || isNaN(dateVal.getTime())) return true;
      const now = new Date();
      const diffDays = (now - dateVal) / (1000 * 60 * 60 * 24);
      const year = dateVal.getFullYear();

      if (state.dateFilter === "7days") return diffDays <= 7 && diffDays >= -1;
      if (state.dateFilter === "30days") return diffDays <= 30 && diffDays >= -1;
      if (state.dateFilter === "month") return dateVal.getMonth() === now.getMonth() && dateVal.getFullYear() === now.getFullYear();
      if (state.dateFilter === "year2026") return year === 2026;
      if (state.dateFilter === "year2025") return year === 2025;
      if (state.dateFilter === "older") return year < 2025;
      return true;
    });
  }

  // 6. Sorting
  list.sort((a, b) => {
    const getDate = (j) => (j.result?.documentDate ? new Date(j.result.documentDate).getTime() : (j.uploadDate ? new Date(j.uploadDate).getTime() : 0));
    const getUploadDate = (j) => (j.uploadDate ? new Date(j.uploadDate).getTime() : 0);
    const getAmt = (j) => j.result?.invoiceAmmount || j.invoiceAmmount || 0;
    const getComp = (j) => (j.result?.company || j.targetCompany || "").toLowerCase();

    if (state.sortOrder === "docdate_asc") return getDate(a) - getDate(b);
    if (state.sortOrder === "uploaddate_desc") return getUploadDate(b) - getUploadDate(a);
    if (state.sortOrder === "company_asc") return getComp(a).localeCompare(getComp(b));
    if (state.sortOrder === "amount_desc") return getAmt(b) - getAmt(a);
    return getDate(b) - getDate(a); // Default: docdate_desc
  });

  return list;
}

function renderPagination(totalItems, totalPages) {
  const container = document.getElementById("start-pagination-container");
  const info = document.getElementById("start-page-info");
  const nav = document.getElementById("start-pagination-nav");
  if (!container || !info || !nav) return;

  if (totalItems <= START_PAGE_SIZE) {
    container.style.setProperty("display", "none", "important");
    return;
  }

  container.style.setProperty("display", "flex", "important");
  const startDisplay = (currentPage - 1) * START_PAGE_SIZE + 1;
  const endDisplay = Math.min(currentPage * START_PAGE_SIZE, totalItems);
  info.innerText = `Zeige ${startDisplay} - ${endDisplay} von ${totalItems} Belegen (Seite ${currentPage} von ${totalPages})`;

  nav.innerHTML = "";

  const prevLi = document.createElement("li");
  prevLi.className = `page-item ${currentPage === 1 ? "disabled" : ""}`;
  prevLi.innerHTML = `<a class="page-link" href="#">«</a>`;
  prevLi.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentPage > 1) {
      currentPage--;
      renderJobsList();
    }
  });
  nav.appendChild(prevLi);

  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= currentPage - 2 && p <= currentPage + 2)) {
      const pLi = document.createElement("li");
      pLi.className = `page-item ${p === currentPage ? "active" : ""}`;
      pLi.innerHTML = `<a class="page-link" href="#">${p}</a>`;
      pLi.addEventListener("click", (e) => {
        e.preventDefault();
        currentPage = p;
        renderJobsList();
      });
      nav.appendChild(pLi);
    }
  }

  const nextLi = document.createElement("li");
  nextLi.className = `page-item ${currentPage === totalPages ? "disabled" : ""}`;
  nextLi.innerHTML = `<a class="page-link" href="#">»</a>`;
  nextLi.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentPage < totalPages) {
      currentPage++;
      renderJobsList();
    }
  });
  nav.appendChild(nextLi);
}

export function openDocPreview(jobId) {
  const modal = document.getElementById("doc-preview-modal");
  const iframe = document.getElementById("doc-preview-iframe");
  const title = document.getElementById("doc-preview-title");
  const subtitle = document.getElementById("doc-preview-subtitle");
  const downloadBtn = document.getElementById("doc-preview-download-btn");
  const extBtn = document.getElementById("doc-preview-external-btn");
  const loading = document.getElementById("doc-preview-loading");

  if (!modal || !iframe) return;

  const job = (state.jobs && state.jobs.find((j) => String(j.id) === String(jobId)));
  if (!job) return;

  const res = job.result || {};
  const filename = res.full || job.originalName || job.name || "Dokument.pdf";
  const docDate = res.documentDate || formatDateDisplay(job.uploadDate || job.date);
  const company = res.company || job.targetCompany || "";
  const invoiceNum = res.invoiceNumber && res.invoiceNumber !== "none" ? ` • Rechnungs-Nr: ${res.invoiceNumber}` : "";
  const amountStr = res.invoiceAmmount ? ` • Betrag: ${formatCurrency(res.invoiceAmmount)}` : "";

  if (title) title.innerText = filename;
  if (subtitle) subtitle.innerText = `${docDate}${company ? ` • ${company}` : ""}${invoiceNum}${amountStr}`;

  const isDriveOnly = job.isDriveOnly;
  const rawDriveId = String(job.id).replace(/^gdrive_/, "");
  const fileUrl = `/api/jobs/${job.id}/file`;
  const downloadUrl = `/api/jobs/${job.id}/file?download=1`;
  const extUrl = res.webViewLink || job.webViewLink || (isDriveOnly ? `https://drive.google.com/file/d/${rawDriveId}/view` : fileUrl);

  if (downloadBtn) {
    downloadBtn.href = downloadUrl;
    downloadBtn.setAttribute("download", filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
  }
  if (extBtn) {
    extBtn.href = extUrl;
  }

  if (loading) loading.style.setProperty("display", "block", "important");
  modal.style.setProperty("display", "flex", "important");

  iframe.onload = () => {
    if (loading) loading.style.setProperty("display", "none", "important");
  };
  iframe.src = fileUrl;
}

export function closeDocPreview() {
  const modal = document.getElementById("doc-preview-modal");
  const iframe = document.getElementById("doc-preview-iframe");
  if (modal) modal.style.setProperty("display", "none", "important");
  if (iframe) iframe.src = "";
}

export function initJobEventDelegation() {
  document.addEventListener("click", async (e) => {
    // 0. Thumbnail Preview Click (Mobile & Desktop)
    const previewContainer = e.target.closest(".pdf-preview-container");
    if (previewContainer) {
      e.preventDefault();
      e.stopPropagation();
      const jobId = previewContainer.getAttribute("data-job-id");
      if (jobId) openDocPreview(jobId);
      return;
    }

    // 0b. Document Preview Modal Close Button or Overlay Click
    const docModalClose = e.target.closest("#doc-preview-close-btn");
    const docPreviewModal = document.getElementById("doc-preview-modal");
    if (docModalClose || e.target === docPreviewModal) {
      closeDocPreview();
      return;
    }

    // 0c. Import Drive File Button
    const importDriveBtn = e.target.closest(".btn-import-drive-file");
    if (importDriveBtn) {
      if (!state.isAdmin) {
        showToast("Importieren ist nur für Administratoren verfügbar.", "warning");
        return;
      }
      const driveId = importDriveBtn.getAttribute("data-drive-id");
      const fileName = importDriveBtn.getAttribute("data-file-name") || "";
      const originalHtml = importDriveBtn.innerHTML;
      importDriveBtn.disabled = true;
      importDriveBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" style="width: 13px; height: 13px;"></span> <span>Wird importiert...</span>`;

      try {
        const res = await apiRequest("/api/drive/import-file", {
          method: "POST",
          body: JSON.stringify({ driveFileId: driveId, name: fileName }),
        });
        if (res.success && res.job) {
          showToast(`✓ "${fileName || 'Dokument'}" wurde importiert und wird per KI verarbeitet!`, "success");
          if (state.jobs) {
            // Replace the drive-only entry with the newly created processing job
            const idx = state.jobs.findIndex((j) => String(j.id) === `gdrive_${driveId}` || String(j.id) === String(driveId));
            if (idx !== -1) {
              state.jobs[idx] = res.job;
            } else {
              state.jobs.unshift(res.job);
            }
          }
          renderJobsList();
        } else {
          showToast("Import fehlgeschlagen: " + (res.error || "Unbekannter Fehler"), "error");
          importDriveBtn.disabled = false;
          importDriveBtn.innerHTML = originalHtml;
        }
      } catch (err) {
        showToast("Fehler beim Import: " + err.message, "error");
        importDriveBtn.disabled = false;
        importDriveBtn.innerHTML = originalHtml;
      }
      return;
    }

    // 1. Toggle Details
    const toggleDetailsBtn = e.target.closest(".btn-toggle-details");
    if (toggleDetailsBtn) {
      const jobId = toggleDetailsBtn.getAttribute("data-job-id");
      const card = toggleDetailsBtn.closest(".job-item");
      const detailsEl = card ? card.querySelector(`details.job-result[data-job-id="${jobId}"]`) : null;
      if (detailsEl) {
        detailsEl.open = !detailsEl.open;
        openDetailsStates[jobId] = detailsEl.open;
        const icon = toggleDetailsBtn.querySelector(".material-symbols-outlined");
        if (icon) icon.innerText = detailsEl.open ? "expand_less" : "info";
      }
      return;
    }

    // 2. Private Toggle
    const privatePill = e.target.closest(".toggle-private-pill");
    if (privatePill) {
      if (!state.isAdmin) {
        showToast("Nur für Administratoren verfügbar.", "warning");
        return;
      }
      const jobId = privatePill.getAttribute("data-job-id");
      if (jobId) {
        try {
          const res = await apiRequest(`/api/jobs/${jobId}/private`, { method: "POST" });
          showToast(res.isPrivate ? "Beleg als PRIVAT markiert." : "Beleg als ÖFFENTLICH markiert.", "info");
          const job = state.jobs.find((j) => j.id === jobId);
          if (job) job.isPrivate = res.isPrivate;
          renderJobsList();
        } catch (err) {
          showToast("Fehler: " + err.message, "error");
        }
      }
      return;
    }

    // 3. Category Picker Opening
    const catTarget = e.target.closest(".category-editable");
    if (catTarget) {
      if (!state.isAdmin) {
        showToast("Kategorien können nur von Administratoren geändert werden.", "warning");
        return;
      }
      if (catTarget.parentElement.querySelector(".category-picker-box")) return;
      e.stopPropagation();
      e.preventDefault();
      document.querySelectorAll(".category-picker-box, .company-picker-box").forEach((b) => b.remove());

      const currentCat = catTarget.getAttribute("data-current-cat") || "";
      const jobId = catTarget.getAttribute("data-job-id");
      const categories = [
        "Rechnungen",
        "Dokumente",
        "Verträge",
        "Buchhaltung",
        "Administration",
        "Personal",
        "Projekte",
        "Marketing",
        "Förderung",
        "Dokumentation",
        "Vertrieb",
        "Privat",
        "Sonstige",
      ];

      const pillsHtml = categories
        .map((c) => {
          const isSelected = c.toLowerCase() === currentCat.toLowerCase();
          const bg = isSelected ? "#6750a4" : "#f3e8ff";
          const color = isSelected ? "#ffffff" : "#6b21a8";
          return `<span class="cat-option-pill" data-value="${c}" style="cursor: pointer; padding: 5px 12px; border-radius: 16px; background: ${bg}; color: ${color}; font-size: 12.5px; font-weight: 500; white-space: nowrap;">${c}</span>`;
        })
        .join("");

      const pickerBoxHtml = `
        <div class="category-picker-box" style="position: absolute; top: 100%; left: 0; margin-top: 6px; padding: 12px; background: #ffffff; border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.18); border: 1px solid #e0e0e0; z-index: 1000; width: 300px; display: flex; flex-wrap: wrap; gap: 6px;">
          <div style="width: 100%; font-size: 11.5px; color: #666; font-weight: 600; margin-bottom: 2px;">Kategorie auswählen:</div>
          ${pillsHtml}
        </div>`;
      catTarget.parentElement.insertAdjacentHTML("beforeend", pickerBoxHtml);
      return;
    }

    // 4. Category Option Selection
    const catOptionPill = e.target.closest(".cat-option-pill");
    if (catOptionPill) {
      if (!state.isAdmin) return;
      e.stopPropagation();
      e.preventDefault();
      const newCategory = catOptionPill.getAttribute("data-value");
      const pickerBox = catOptionPill.closest(".category-picker-box");
      const editableSpan = pickerBox.parentElement.querySelector(".category-editable");
      const jobId = editableSpan.getAttribute("data-job-id");
      pickerBox.remove();

      const job = state.jobs.find((j) => j.id === jobId);
      if (job) {
        if (!job.result) job.result = {};
        job.result.category = newCategory;
      }
      renderJobsList();
      try {
        await apiRequest(`/api/jobs/${jobId}/category`, {
          method: "POST",
          body: JSON.stringify({ category: newCategory }),
        });
        showToast(`Kategorie auf "${newCategory}" geändert.`, "success");
      } catch (err) {
        showToast("Fehler beim Speichern: " + err.message, "error");
      }
      return;
    }

    // 5. Company Picker Opening
    const compTarget = e.target.closest(".company-editable");
    if (compTarget) {
      if (!state.isAdmin) {
        showToast("Unternehmen können nur von Administratoren geändert werden.", "warning");
        return;
      }
      if (compTarget.parentElement.querySelector(".company-picker-box")) return;
      e.stopPropagation();
      e.preventDefault();
      document.querySelectorAll(".category-picker-box, .company-picker-box").forEach((b) => b.remove());

      const currentComp = compTarget.getAttribute("data-current-comp") || "";
      const jobId = compTarget.getAttribute("data-job-id");
      const companies = ["wirewire GmbH", "The Wire UG", "Polyxo Studios GmbH", "Daniel (Privat)", "Andere / Unbekannt"];

      const pillsHtml = companies
        .map((c) => {
          const isSelected = c.toLowerCase() === currentComp.toLowerCase();
          const bg = isSelected ? "#0284c7" : "#e0f2fe";
          const color = isSelected ? "#ffffff" : "#0369a1";
          return `<span class="comp-option-pill" data-value="${c}" style="cursor: pointer; padding: 5px 12px; border-radius: 16px; background: ${bg}; color: ${color}; font-size: 12.5px; font-weight: 500; white-space: nowrap;">${c}</span>`;
        })
        .join("");

      const pickerBoxHtml = `
        <div class="company-picker-box" style="position: absolute; top: 100%; left: 0; margin-top: 6px; padding: 12px; background: #ffffff; border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.18); border: 1px solid #e0e0e0; z-index: 1000; width: 300px; display: flex; flex-wrap: wrap; gap: 6px;">
          <div style="width: 100%; font-size: 11.5px; color: #666; font-weight: 600; margin-bottom: 2px;">Unternehmen auswählen:</div>
          ${pillsHtml}
        </div>`;
      compTarget.parentElement.insertAdjacentHTML("beforeend", pickerBoxHtml);
      return;
    }

    // 6. Company Option Selection
    const compOptionPill = e.target.closest(".comp-option-pill");
    if (compOptionPill) {
      if (!state.isAdmin) return;
      e.stopPropagation();
      e.preventDefault();
      const newCompany = compOptionPill.getAttribute("data-value");
      const pickerBox = compOptionPill.closest(".company-picker-box");
      const editableSpan = pickerBox.parentElement.querySelector(".company-editable");
      const jobId = editableSpan.getAttribute("data-job-id");
      pickerBox.remove();

      const job = state.jobs.find((j) => j.id === jobId);
      if (job) {
        if (!job.result) job.result = {};
        job.result.company = newCompany;
      }
      renderJobsList();
      try {
        await apiRequest(`/api/jobs/${jobId}/company`, {
          method: "POST",
          body: JSON.stringify({ company: newCompany }),
        });
        showToast(`Unternehmen auf "${newCompany}" geändert.`, "success");
      } catch (err) {
        showToast("Fehler beim Speichern: " + err.message, "error");
      }
      return;
    }

    // 7. Click outside pickers
    if (
      !e.target.closest(".category-picker-box") &&
      !e.target.closest(".category-editable") &&
      !e.target.closest(".company-picker-box") &&
      !e.target.closest(".company-editable")
    ) {
      document.querySelectorAll(".category-picker-box, .company-picker-box").forEach((b) => b.remove());
    }

    // 8. ClickUp Transfer Button (Admin Only)
    const clickupBtn = e.target.closest(".btn-manual-clickup-transfer");
    if (clickupBtn) {
      if (!state.isAdmin) {
        showToast("ClickUp-Synchronisation ist nur für Administratoren verfügbar.", "warning");
        return;
      }
      const jobId = clickupBtn.getAttribute("data-job-id");
      if (jobId) transferJobToClickUp(jobId);
      return;
    }

    // 9. Buchhaltung Sync Button (Admin Only)
    const lexofficeBtn = e.target.closest(".btn-manual-lexoffice-sync");
    if (lexofficeBtn) {
      if (!state.isAdmin) {
        showToast("Buchhaltungssynchronisation ist nur für Administratoren verfügbar.", "warning");
        return;
      }
      const jobId = lexofficeBtn.getAttribute("data-job-id");
      if (jobId) openAccountingModal(jobId);
      return;
    }

    // 10. Reprocess AI (Admin Only)
    const reprocessBtn = e.target.closest(".btn-reprocess-ai");
    if (reprocessBtn) {
      if (!state.isAdmin) {
        showToast("Nur für Administratoren verfügbar.", "warning");
        return;
      }
      const jobId = reprocessBtn.getAttribute("data-job-id");
      if (jobId && window.retryJob) window.retryJob(jobId);
      return;
    }

    // 11. Hide / Unhide (Admin Only)
    const hideBtn = e.target.closest(".btn-hide-job");
    if (hideBtn) {
      if (!state.isAdmin) {
        showToast("Nur für Administratoren verfügbar.", "warning");
        return;
      }
      const jobId = hideBtn.getAttribute("data-job-id");
      const isCurrentlyHidden = hideBtn.getAttribute("data-is-hidden") === "true";
      if (jobId && window.toggleHideJob) window.toggleHideJob(jobId, !isCurrentlyHidden);
      return;
    }

    // 12. Delete Job (Admin Only)
    const deleteBtn = e.target.closest(".btn-delete-job");
    if (deleteBtn) {
      if (!state.isAdmin) {
        showToast("Nur für Administratoren verfügbar.", "warning");
        return;
      }
      const jobId = deleteBtn.getAttribute("data-job-id");
      if (jobId && window.deleteJob) window.deleteJob(jobId);
      return;
    }

    // 13. Toggle Show Hidden Filter
    const toggleHiddenBtn = e.target.closest("#toggle-show-hidden-btn");
    if (toggleHiddenBtn) {
      state.activeFilter = state.activeFilter === "hidden" ? "all" : "hidden";
      toggleHiddenBtn.classList.toggle("active", state.activeFilter === "hidden");
      renderJobsList();
      return;
    }
  });

  // Close modal on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDocPreview();
    }
  });

  // Notes Auto-Save on Blur / Change (Admin Only)
  document.addEventListener("change", async (e) => {
    const textarea = e.target.closest(".job-notes-input");
    if (textarea) {
      if (!state.isAdmin) {
        showToast("Nur für Administratoren bearbeitbar.", "warning");
        return;
      }
      const jobId = textarea.getAttribute("data-job-id");
      const notes = textarea.value.trim();
      try {
        await apiRequest(`/api/jobs/${jobId}/notes`, {
          method: "POST",
          body: JSON.stringify({ notes }),
        });
        showToast("Notiz gespeichert.", "success");
      } catch (err) {
        showToast("Fehler beim Speichern der Notiz: " + err.message, "error");
      }
    }
  });
}
