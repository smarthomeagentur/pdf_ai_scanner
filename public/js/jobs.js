/**
 * Document Pipeline - Jobs List Rendering, Search & Action Management
 */
import { escapeHtml, formatFileSize, formatDateDisplay, formatCurrency, highlightQueryText, showToast, debugLog } from "./utils.js";
import { apiRequest } from "./api.js";
import { state } from "./state.js";
import { openAccountingModal } from "./accounting.js";
import { transferJobToClickUp } from "./clickup.js";
import { openAdminLoginModal } from "./settings.js";

const START_PAGE_SIZE = 50;
let currentPage = 1;
const openDetailsStates = {};
let lastRenderSignature = "";

export function renderJobsList(jobs = state.jobs, force = false) {
  const jobList = document.getElementById("job-list");
  if (!jobList) return;

  // Don't re-render if user is currently interacting with an open category/company/tags picker or typing notes
  if (
    document.querySelector(".category-picker-box") ||
    document.querySelector(".company-picker-box") ||
    document.querySelector(".tags-picker-box") ||
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
    isAdmin: state.isAdmin,
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
      j.result?.company,
      j.result?.category,
      (j.result?.tags || []).join(","),
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
        <div class="d-flex justify-content-between align-items-stretch gap-3">
          <div class="flex-grow-1 d-flex flex-column justify-content-between" style="min-width: 0;">
            <div>
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
            <!-- Action buttons inside left column, shortened to left -->
            <div class="job-action-bar d-flex align-items-center gap-2 flex-wrap mt-2 pt-1">
              ${state.isAdmin ? `
                <button type="button" class="job-action-btn btn-import-drive btn-import-drive-file" data-drive-id="${rawDriveId}" data-file-name="${escapeHtml(job.originalName || job.name || '')}" title="In System importieren und per KI analysieren">
                  <span class="material-symbols-outlined">cloud_download</span>
                  <span>Importieren & analysieren</span>
                </button>
              ` : ""}
              <a href="${webViewLink}" target="_blank" class="job-action-btn btn-open-gdrive" title="Dokument in Google Drive öffnen">
                <span class="material-symbols-outlined">open_in_new</span>
                <span>In Google Drive</span>
              </a>
            </div>
          </div>
          <div class="flex-shrink-0 d-flex align-items-stretch">
            <a href="${webViewLink}" data-job-id="${job.id}" class="pdf-preview-container btn-open-doc-preview" title="Dokument in Google Drive öffnen">
              <img src="${thumbUrl}" loading="lazy" alt="Vorschau" class="pdf-preview-img" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'80\\' viewBox=\\'0 0 60 80\\'><rect width=\\'60\\' height=\\'80\\' fill=\\'%23eee\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' fill=\\'%23aaa\\' font-size=\\'12\\'>PDF</text></svg>';">
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

    // 4. Status badge & AI Processing Progress Bar
    let statusHtml = "";
    if (job.status === "pending") {
      statusHtml = `
        <div class="ai-processing-box mt-2 p-2 rounded-2 border" style="background: #f8fafc; border-color: #e2e8f0 !important;">
          <div class="d-flex align-items-center justify-content-between mb-1" style="font-size: 11px;">
            <span class="d-flex align-items-center gap-1 text-warning-emphasis fw-semibold">
              <span class="spinner-border spinner-border-sm text-warning" style="width: 10px; height: 10px;"></span>
              <span>In Warteschlange...</span>
            </span>
            <span class="text-muted" style="font-size: 10.5px;">Warten auf KI</span>
          </div>
          <div class="progress" style="height: 6px; border-radius: 9999px; background: #e2e8f0; overflow: hidden;">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-warning" style="width: 12%;"></div>
          </div>
        </div>`;
    } else if (job.status === "processing") {
      const startTime = job.processingStartedAt
        ? new Date(job.processingStartedAt).getTime()
        : (job.uploadDate ? new Date(job.uploadDate).getTime() : Date.now());
      const elapsedSec = Math.max(0, (Date.now() - startTime) / 1000);
      // Linearer Fortschritt: Nach exakt 3 Minuten (180s) 99% erreichen und warten
      const progressPercent = Math.min(99, Math.max(0, Math.round((elapsedSec / 180) * 99)));

      statusHtml = `
        <div class="ai-processing-box mt-2 p-2 rounded-2 border" style="background: #eff6ff; border-color: #bfdbfe !important;">
          <div class="d-flex align-items-center justify-content-between mb-1" style="font-size: 11.5px;">
            <span class="d-flex align-items-center gap-1 text-primary fw-semibold">
              <span class="spinner-border spinner-border-sm text-primary" style="width: 11px; height: 11px;"></span>
              <span>KI-Analyse & Extraktion läuft...</span>
            </span>
            <span class="ai-progress-percent text-primary fw-bold font-monospace" style="font-size: 11.5px;">${progressPercent}%</span>
          </div>
          <div class="progress" style="height: 6px; border-radius: 9999px; background: #dbeafe; overflow: hidden;">
            <div class="progress-bar progress-bar-striped progress-bar-animated bg-primary ai-progress-bar" data-job-id="${job.id}" data-start-time="${startTime}" style="width: ${progressPercent}%; transition: width 0.5s ease;"></div>
          </div>
        </div>`;
    }

    // 5. Title Line: 3 Prominente Tags mit Suchhervorhebung
    const titleBadgesHtml = formatTitleBadgesHtml(job, state.searchQuery);

    // 6. Dates, Invoice details & Amounts
    const rawDocDate = res.documentDate || job.documentDate;
    const docDateDisplay = (rawDocDate && rawDocDate !== "unknown" && rawDocDate !== "none" && rawDocDate !== "-")
      ? rawDocDate
      : formatDateDisplay(job.uploadDate);
    const uploadDateDisplay = formatDateDisplay(job.uploadDate);
    const invoiceNumber = (res.invoiceNumber || job.invoiceNumber) && (res.invoiceNumber || job.invoiceNumber) !== "none" ? (res.invoiceNumber || job.invoiceNumber) : null;
    const invoiceAmtRaw = res.invoiceAmmount !== undefined ? res.invoiceAmmount : job.invoiceAmmount;
    const invoiceAmtDisplay = (invoiceAmtRaw !== undefined && invoiceAmtRaw !== null && invoiceAmtRaw !== 0) ? formatCurrency(invoiceAmtRaw) : "";

    // 7. Preview Image
    const webViewLink = res.webViewLink || job.webViewLink || (job.filePath ? `/api/jobs/${job.id}/file` : "#");
    const thumbUrl = `/api/thumbnail/${job.id}?v=${job.aiPipelineCompletedAt || job.uploadDate || 1}`;
    const previewHtml = `
      <a href="javascript:void(0)" onclick="openDocPreview('${job.id}'); return false;" data-job-id="${job.id}" class="pdf-preview-container" title="Beleg öffnen">
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

    // Tags for Details section
    let detailTags = [];
    if (Array.isArray(res.tags)) {
      detailTags = res.tags;
    } else if (typeof res.tags === "string" && res.tags.trim()) {
      detailTags = res.tags.split(",").map((t) => t.trim());
    }
    detailTags = detailTags
      .map((t) => String(t).trim().replace(/^[-_\s]+|[-_\s]+$/g, ""))
      .filter((t) => {
        const lower = t.toLowerCase();
        return (
          t.length >= 2 &&
          !["unknown", "unbekannt", "none", "null", "pdf", "scan", "dokument", "document", "rechnung", "invoice"].includes(lower) &&
          !/^(isinvoice|datum|date|invoicenumber|invoiceammount|betrag|firma|company|kategorie|category):/i.test(t)
        );
      });

    const tagsPillsHtml = detailTags.length > 0
      ? detailTags.map((t) => `<span class="badge bg-light text-dark border d-inline-flex align-items-center gap-1" style="font-size: 12px; padding: 3px 8px; border-radius: 12px; font-weight: 500;"><span class="material-symbols-outlined text-muted" style="font-size: 13px;">label</span> ${escapeHtml(t)}</span>`).join(" ")
      : `<span class="text-muted small fst-italic">Keine Tags</span>`;

    div.innerHTML = `
      <!-- Main Row: Left content + Right receipt image spanning full height -->
      <div class="d-flex justify-content-between align-items-stretch gap-3">
        <div class="flex-grow-1 d-flex flex-column justify-content-between" style="min-width: 0;">
          <div>
            ${errorHeaderHtml}
            <div class="job-title text-start" style="display: flex; flex-direction: column; gap: 3px; text-align: left !important; align-items: flex-start !important;">
              <!-- Zeile 1: Die 3 prominenten Tags -->
              <div class="job-title-badges text-start" style="text-align: left !important; width: 100%;">${titleBadgesHtml}</div>
              
              <!-- Zeile 2: Status-Pills -->
              <div class="job-status-pills d-flex align-items-center justify-content-start gap-1 flex-wrap mt-1 text-start" style="text-align: left !important; ${!(privateBadgeHtml || duplicateBadgeHtml || lexofficeBadgeHtml) ? 'display: none !important;' : ''}">
                ${privateBadgeHtml}
                ${duplicateBadgeHtml}
                ${lexofficeBadgeHtml}
              </div>

              <!-- Zeile 3: Dokumentendatum & Rechnungs-Info (Datum, Rechnungs-Nr, Betrag linksbündig) -->
              <div class="d-flex align-items-center justify-content-start gap-2 flex-wrap text-start" style="font-size: 12.5px; color: #64748b; margin-top: 4px; text-align: left !important;">
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

          <!-- Action Bar (Shortened to left, inside left column) -->
          <div class="job-action-bar d-flex align-items-center gap-2 flex-wrap mt-2 pt-1">
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
        </div>

        <!-- Right Column: Receipt Image maintaining document shape -->
        <div class="flex-shrink-0 d-flex align-items-center justify-content-center">
          ${previewHtml}
        </div>
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

            <!-- Bearbeitbare Tags -->
            <div class="my-1 d-flex align-items-center gap-2 flex-wrap">
              <strong style="color: #475569;">Tags:</strong> 
              <div class="tags-editable-container" style="position: relative; display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                <span class="tags-display-area d-inline-flex align-items-center gap-1 flex-wrap">${tagsPillsHtml}</span>
                <span class="tags-editable" data-job-id="${job.id}" data-current-tags="${escapeHtml(detailTags.join(', '))}" style="cursor: pointer; padding: 2px 8px; border-radius: 12px; background: #f1f5f9; color: #475569; font-size: 11.5px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px; border: 1px solid #e2e8f0;" title="Tags bearbeiten">
                  <span class="material-symbols-outlined" style="font-size: 13px;">edit</span> <span>Tags bearbeiten</span>
                </span>
              </div>
            </div>

            ${isInvoice ? `
              <div><strong style="color: #475569;">Rechnungs-Nr:</strong> ${highlightQueryText(invoiceNumber || "-", state.searchQuery)}</div>
              <div><strong style="color: #475569;">Rechnungsbetrag:</strong> ${invoiceAmtDisplay || "-"}</div>
            ` : ""}

            ${res.duration ? `<div><strong style="color: #475569;">Verarbeitungszeit:</strong> ${res.duration} s</div>` : ""}

            <div class="mt-2 pt-2 border-top">
              <label class="fw-semibold text-muted small d-flex align-items-center justify-content-between mb-1">
                <span class="d-flex align-items-center gap-1">
                  <span class="material-symbols-outlined" style="font-size: 15px;">edit_note</span> Notizen zu diesem Beleg:
                </span>
                <span class="notes-save-indicator text-success small" style="display: none; font-size: 11px; font-weight: 500;">
                  <span class="material-symbols-outlined" style="font-size: 13px; vertical-align: middle;">check_circle</span> Gespeichert
                </span>
              </label>
              <textarea class="form-control job-notes-input" data-job-id="${job.id}" rows="2" placeholder="Notizen hinterlegen (speichert automatisch)..." style="font-size: 12.5px; border-radius: 8px; resize: vertical; line-height: 1.4;">${escapeHtml(job.notes || "")}</textarea>
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

  const category = (res.category && res.category !== "unknown" && res.category !== "Unbekannt") ? res.category : (res.isInvoice ? "Rechnungen" : "Dokumente");
  const company = (res.company && res.company !== "unknown") ? res.company : (job.targetCompany || "Unbekannt");

  let tagsArray = [];
  if (Array.isArray(res.tags)) {
    tagsArray = res.tags;
  } else if (typeof res.tags === "string" && res.tags.trim()) {
    tagsArray = res.tags.split(",").map((t) => t.trim());
  }

  const cleanTags = tagsArray
    .map((t) => String(t).trim().replace(/^[-_\s]+|[-_\s]+$/g, ""))
    .filter((t) => {
      const lower = t.toLowerCase();
      if (!t || t.length < 2) return false;
      if (["unknown", "unbekannt", "none", "null", "pdf", "scan", "dokument", "document", "rechnung", "invoice"].includes(lower)) return false;
      if (/^(isinvoice|datum|date|invoicenumber|invoiceammount|betrag|firma|company|kategorie|category):/i.test(t)) return false;
      if (lower === category.toLowerCase() || lower === company.toLowerCase()) return false;
      return true;
    })
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
    <div class="d-flex align-items-center justify-content-start gap-1 flex-wrap text-start" style="line-height: 1.4; text-align: left !important;">
      ${categoryBadge}
      ${tagsBadges ? `${tagsBadges}` : ""}
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

function parseDocTimestamp(dateStr, maxUploadDateStr) {
  if (!dateStr || dateStr === "unknown" || dateStr === "none" || dateStr === "-") {
    return maxUploadDateStr ? new Date(maxUploadDateStr).getTime() : null;
  }
  const clean = String(dateStr).replace(/\(.*?\)/g, "").trim();
  let d = null;
  const deMatch = clean.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (deMatch) {
    d = new Date(parseInt(deMatch[3], 10), parseInt(deMatch[2], 10) - 1, parseInt(deMatch[1], 10));
  } else {
    const isoMatch = clean.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    if (isoMatch) {
      d = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    }
  }
  if (!d || isNaN(d.getTime())) return null;

  // Document date must never exceed uploadDate (or now)
  const maxMs = maxUploadDateStr ? new Date(maxUploadDateStr).getTime() : Date.now();
  const endOfDayMax = maxMs + (24 * 60 * 60 * 1000);
  if (d.getTime() > endOfDayMax) {
    return maxMs;
  }
  return d.getTime();
}

  // 5. Date Filter
  if (state.dateFilter !== "alle") {
    list = list.filter((j) => {
      const ts = parseDocTimestamp(j.result?.documentDate, j.uploadDate) || (j.uploadDate ? new Date(j.uploadDate).getTime() : null);
      if (!ts) return true;
      const dateVal = new Date(ts);
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
    const getDate = (j) => parseDocTimestamp(j.result?.documentDate, j.uploadDate) || (j.uploadDate ? new Date(j.uploadDate).getTime() : 0);
    const getUploadDate = (j) => (j.uploadDate ? new Date(j.uploadDate).getTime() : (j.aiPipelineStartedAt ? new Date(j.aiPipelineStartedAt).getTime() : (j.id && !isNaN(parseInt(j.id)) ? parseInt(j.id) : 0)));
    const getAmt = (j) => j.result?.invoiceAmmount || j.invoiceAmmount || 0;
    const getComp = (j) => (j.result?.company || j.targetCompany || "").toLowerCase();

    if (state.sortOrder === "docdate_desc") return getDate(b) - getDate(a);
    if (state.sortOrder === "docdate_asc") return getDate(a) - getDate(b);
    if (state.sortOrder === "uploaddate_desc") return getUploadDate(b) - getUploadDate(a);
    if (state.sortOrder === "company_asc") return getComp(a).localeCompare(getComp(b));
    if (state.sortOrder === "amount_desc") return getAmt(b) - getAmt(a);
    return getUploadDate(b) - getUploadDate(a); // Default: uploaddate_desc
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

let currentPdfDoc = null;
let currentPdfPageNum = 1;
let currentPdfScale = 1.0;
let isRenderingPdf = false;
let renderPendingPage = null;

async function renderPdfPage(num) {
  if (!currentPdfDoc) return;
  isRenderingPdf = true;
  const canvas = document.getElementById("doc-preview-canvas");
  const pageInfo = document.getElementById("doc-preview-page-info");
  const zoomLevel = document.getElementById("doc-preview-zoom-level");
  if (!canvas) return;

  try {
    const page = await currentPdfDoc.getPage(num);
    const container = document.getElementById("doc-preview-canvas-container");
    const containerWidth = container ? Math.max(280, container.clientWidth - 24) : 600;

    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const fitScale = (containerWidth / unscaledViewport.width) * currentPdfScale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const viewport = page.getViewport({ scale: fitScale * dpr });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    canvas.style.display = "block";

    const ctx = canvas.getContext("2d");
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };
    await page.render(renderContext).promise;

    if (pageInfo) {
      pageInfo.innerText = `Seite ${num} / ${currentPdfDoc.numPages}`;
    }
    if (zoomLevel) {
      zoomLevel.innerText = `${Math.round(currentPdfScale * 100)}%`;
    }

    const prevBtn = document.getElementById("doc-preview-prev-page");
    const nextBtn = document.getElementById("doc-preview-next-page");
    if (prevBtn) prevBtn.disabled = num <= 1;
    if (nextBtn) nextBtn.disabled = num >= currentPdfDoc.numPages;
  } catch (err) {
    console.warn("[PDF.js] Render Error:", err);
  } finally {
    isRenderingPdf = false;
    if (renderPendingPage !== null) {
      const p = renderPendingPage;
      renderPendingPage = null;
      renderPdfPage(p);
    }
  }
}

function queueRenderPage(num) {
  if (isRenderingPdf) {
    renderPendingPage = num;
  } else {
    renderPdfPage(num);
  }
}

export async function openDocPreview(jobId) {
  debugLog("PREVIEW", "openDocPreview called for jobId:", jobId);
  const modal = document.getElementById("doc-preview-modal");
  const canvas = document.getElementById("doc-preview-canvas");
  const fallbackImg = document.getElementById("doc-preview-fallback-img");
  const iframe = document.getElementById("doc-preview-iframe");
  const toolbar = document.getElementById("doc-preview-toolbar");
  const title = document.getElementById("doc-preview-title");
  const subtitle = document.getElementById("doc-preview-subtitle");
  const downloadBtn = document.getElementById("doc-preview-download-btn");
  const extBtn = document.getElementById("doc-preview-external-btn");
  const loading = document.getElementById("doc-preview-loading");

  if (!modal) return;

  let job = state.jobs && state.jobs.find((j) => String(j.id) === String(jobId) || String(j.rawDriveId) === String(jobId) || String(j.driveFileId) === String(jobId));
  if (!job && state.driveOnlySearchResults) {
    job = state.driveOnlySearchResults.find((j) => String(j.id) === String(jobId) || String(j.rawDriveId) === String(jobId));
  }

  const res = job?.result || {};
  const filename = res.full || job?.originalName || job?.name || "Dokument.pdf";
  const rawDocDate = res.documentDate || job?.documentDate;
  const docDate = (rawDocDate && rawDocDate !== "unknown" && rawDocDate !== "none" && rawDocDate !== "-")
    ? rawDocDate
    : (job?.uploadDate ? formatDateDisplay(job.uploadDate) : "");
  const company = res.company || job?.targetCompany || "";
  const invoiceNum = res.invoiceNumber && res.invoiceNumber !== "none" ? ` • Rechnungs-Nr: ${res.invoiceNumber}` : "";
  const amountStr = res.invoiceAmmount ? ` • Betrag: ${formatCurrency(res.invoiceAmmount)}` : "";

  if (title) title.innerText = filename;
  if (subtitle) subtitle.innerText = `${docDate}${company ? ` • ${company}` : ""}${invoiceNum}${amountStr}`;

  const isDriveOnly = job?.isDriveOnly || String(jobId).startsWith("gdrive_");
  const rawDriveId = String(job?.rawDriveId || jobId).replace(/^gdrive_/, "");
  const fileUrl = `/api/jobs/${jobId}/file`;
  const downloadUrl = `/api/jobs/${jobId}/file?download=1`;
  const extUrl = res.webViewLink || job?.webViewLink || (isDriveOnly ? `https://drive.google.com/file/d/${rawDriveId}/view` : fileUrl);

  if (downloadBtn) {
    downloadBtn.href = downloadUrl;
    downloadBtn.setAttribute("download", filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
  }
  if (extBtn) {
    extBtn.href = extUrl;
  }

  modal.style.setProperty("display", "flex", "important");
  if (loading) loading.style.setProperty("display", "block", "important");
  if (canvas) canvas.style.display = "none";
  if (fallbackImg) fallbackImg.style.display = "none";
  if (iframe) iframe.style.display = "none";
  if (toolbar) toolbar.style.setProperty("display", "none", "important");

  // Method 1: Attempt PDF.js rendering (Works flawlessly on iOS Safari, Android Chrome & Desktop)
  if (window.pdfjsLib) {
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
      const loadingTask = window.pdfjsLib.getDocument({
        url: fileUrl,
        withCredentials: true,
      });

      const pdf = await loadingTask.promise;
      currentPdfDoc = pdf;
      currentPdfPageNum = 1;
      currentPdfScale = 1.0;

      if (loading) loading.style.setProperty("display", "none", "important");
      if (toolbar) toolbar.style.setProperty("display", "flex", "important");
      await renderPdfPage(1);
      return;
    } catch (pdfErr) {
      console.warn("[PREVIEW] PDF.js render failed, trying thumbnail fallback:", pdfErr);
    }
  }

  // Method 2: High-Resolution Server Thumbnail Fallback
  try {
    const thumbUrl = `/api/thumbnail/${jobId}?v=${Date.now()}`;
    if (fallbackImg) {
      fallbackImg.onload = () => {
        if (loading) loading.style.setProperty("display", "none", "important");
        fallbackImg.style.display = "block";
      };
      fallbackImg.onerror = () => {
        // Method 3: Iframe Fallback
        if (loading) loading.style.setProperty("display", "none", "important");
        if (iframe) {
          iframe.style.display = "block";
          iframe.src = isDriveOnly ? `https://drive.google.com/file/d/${rawDriveId}/preview` : fileUrl;
        }
      };
      fallbackImg.src = thumbUrl;
    }
  } catch (e) {
    if (loading) loading.style.setProperty("display", "none", "important");
    if (iframe) {
      iframe.style.display = "block";
      iframe.src = fileUrl;
    }
  }
}

export function closeDocPreview() {
  const modal = document.getElementById("doc-preview-modal");
  const iframe = document.getElementById("doc-preview-iframe");
  const canvas = document.getElementById("doc-preview-canvas");
  const fallbackImg = document.getElementById("doc-preview-fallback-img");
  const toolbar = document.getElementById("doc-preview-toolbar");

  if (modal) modal.style.setProperty("display", "none", "important");
  if (iframe) iframe.src = "";
  if (canvas) canvas.style.display = "none";
  if (fallbackImg) {
    fallbackImg.src = "";
    fallbackImg.style.display = "none";
  }
  if (toolbar) toolbar.style.setProperty("display", "none", "important");
  currentPdfDoc = null;
}

export async function ensureAdminAuth(actionCallback) {
  if (state.isAdmin) {
    if (typeof actionCallback === "function") actionCallback();
    return true;
  }
  // Try server check in case cookie is already present
  try {
    const res = await apiRequest("/api/admin-check");
    if (res && res.isAdmin) {
      state.isAdmin = true;
      const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
      if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";
      renderJobsList(state.jobs, true);
      if (typeof actionCallback === "function") actionCallback();
      return true;
    }
  } catch (e) {}

  // If not authenticated, open login modal
  openAdminLoginModal(() => {
    if (typeof actionCallback === "function") actionCallback();
  });
  return false;
}

export function initJobEventDelegation() {
  document.addEventListener("click", async (e) => {
    // 0. Thumbnail Preview Click (Mobile & Desktop)
    const previewContainer = e.target.closest(".pdf-preview-container, .pdf-preview-img, .btn-open-doc-preview");
    if (previewContainer) {
      e.preventDefault();
      e.stopPropagation();
      const jobId = previewContainer.getAttribute("data-job-id") || previewContainer.closest("[data-job-id]")?.getAttribute("data-job-id");
      if (jobId) {
        openDocPreview(jobId);
        return;
      }
    }

    // 0b. Document Preview Modal Controls (Close, Prev/Next Page, Zoom In/Out)
    const docModalClose = e.target.closest("#doc-preview-close-btn");
    const docPreviewModal = document.getElementById("doc-preview-modal");
    if (docModalClose || e.target === docPreviewModal) {
      closeDocPreview();
      return;
    }

    const prevPageBtn = e.target.closest("#doc-preview-prev-page");
    if (prevPageBtn) {
      if (currentPdfDoc && currentPdfPageNum > 1) {
        currentPdfPageNum--;
        queueRenderPage(currentPdfPageNum);
      }
      return;
    }

    const nextPageBtn = e.target.closest("#doc-preview-next-page");
    if (nextPageBtn) {
      if (currentPdfDoc && currentPdfPageNum < currentPdfDoc.numPages) {
        currentPdfPageNum++;
        queueRenderPage(currentPdfPageNum);
      }
      return;
    }

    const zoomInBtn = e.target.closest("#doc-preview-zoom-in");
    if (zoomInBtn) {
      currentPdfScale = Math.min(currentPdfScale + 0.25, 3.0);
      queueRenderPage(currentPdfPageNum);
      return;
    }

    const zoomOutBtn = e.target.closest("#doc-preview-zoom-out");
    if (zoomOutBtn) {
      currentPdfScale = Math.max(currentPdfScale - 0.25, 0.5);
      queueRenderPage(currentPdfPageNum);
      return;
    }

    // 0c. Import Drive File Button
    const importDriveBtn = e.target.closest(".btn-import-drive-file");
    if (importDriveBtn) {
      if (!state.isAdmin) {
        ensureAdminAuth(() => importDriveBtn.click());
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
        ensureAdminAuth(() => privatePill.click());
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
        ensureAdminAuth(() => catTarget.click());
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
          const color = isSelected ? "#ffffff" : "#49454f";
          return `<span class="cat-option-pill" data-value="${c}" style="cursor: pointer; padding: 4px 10px; border-radius: 16px; background: ${bg}; color: ${color}; font-size: 12px; font-weight: 500; white-space: nowrap;">${c}</span>`;
        })
        .join("");

      const pickerBoxHtml = `
        <div class="category-picker-box" style="position: absolute; top: 100%; left: 0; margin-top: 6px; padding: 12px; background: #ffffff; border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.18); border: 1px solid #e0e0e0; z-index: 1000; width: 320px; display: flex; flex-wrap: wrap; gap: 6px;">
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
      const editableSpan = pickerBox?.parentElement?.querySelector(".category-editable");
      const jobId = editableSpan?.getAttribute("data-job-id");
      if (pickerBox) pickerBox.remove();
      if (!jobId) return;

      const job = (state.jobs || []).find((j) => String(j.id) === String(jobId)) || (window.allRechnungenJobs || []).find((j) => String(j.id) === String(jobId));
      if (job) {
        if (!job.result) job.result = {};
        job.result.category = newCategory;
      }

      // Real-time DOM update
      const card = editableSpan ? editableSpan.closest(".job-item") : document.querySelector(`.category-editable[data-job-id="${jobId}"]`)?.closest(".job-item");
      if (card && job) {
        if (editableSpan) {
          editableSpan.setAttribute("data-current-cat", newCategory);
          editableSpan.innerHTML = `${highlightQueryText(newCategory, state.searchQuery)} <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>`;
        }
        const titleBadgesEl = card.querySelector(".job-title-badges");
        if (titleBadgesEl) {
          titleBadgesEl.innerHTML = formatTitleBadgesHtml(job, state.searchQuery);
        }
      }

      renderJobsList(state.jobs, true);
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
        ensureAdminAuth(() => compTarget.click());
        return;
      }
      if (compTarget.parentElement.querySelector(".company-picker-box")) return;
      e.stopPropagation();
      e.preventDefault();
      document.querySelectorAll(".category-picker-box, .company-picker-box, .tags-picker-box").forEach((b) => b.remove());

      const currentComp = compTarget.getAttribute("data-current-comp") || "";
      const jobId = compTarget.getAttribute("data-job-id");

      let configuredCompanies = [];
      if (state.settings && state.settings.AI_COMPANY) {
        configuredCompanies = state.settings.AI_COMPANY.split(",").map((c) => c.trim()).filter(Boolean);
      }
      const companies = configuredCompanies.length > 0
        ? [...new Set([...configuredCompanies, "Andere / Unbekannt"])]
        : ["wirewire GmbH", "The Wire UG", "Polyxo Studios GmbH", "Daniel (Privat)", "Andere / Unbekannt"];

      const pillsHtml = companies
        .map((c) => {
          const isSelected = c.toLowerCase() === currentComp.toLowerCase();
          const isPrivat = c.toLowerCase().includes("privat");
          const bg = isSelected ? "#0284c7" : isPrivat ? "#fef2f2" : "#e0f2fe";
          const color = isSelected ? "#ffffff" : isPrivat ? "#991b1b" : "#0369a1";
          const lockIcon = isPrivat ? `<span class="material-symbols-outlined" style="font-size: 13px; vertical-align: -2px;">lock</span> ` : "";
          return `<span class="comp-option-pill" data-value="${escapeHtml(c)}" style="cursor: pointer; padding: 5px 12px; border-radius: 16px; background: ${bg}; color: ${color}; font-size: 12.5px; font-weight: 500; white-space: nowrap;">${lockIcon}${escapeHtml(c)}</span>`;
        })
        .join("");

      const pickerBoxHtml = `
        <div class="company-picker-box" style="position: absolute; top: 100%; left: 0; margin-top: 6px; padding: 12px; background: #ffffff; border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.18); border: 1px solid #e0e0e0; z-index: 1000; width: 310px; display: flex; flex-wrap: wrap; gap: 6px;">
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
      const editableSpan = pickerBox?.parentElement?.querySelector(".company-editable");
      const jobId = editableSpan?.getAttribute("data-job-id");
      if (pickerBox) pickerBox.remove();
      if (!jobId) return;

      const isCompPrivat = newCompany.toLowerCase().includes("privat");
      const job = (state.jobs || []).find((j) => String(j.id) === String(jobId)) || (window.allRechnungenJobs || []).find((j) => String(j.id) === String(jobId));
      if (job) {
        if (!job.result) job.result = {};
        job.result.company = newCompany;
        if (isCompPrivat) {
          job.isPrivate = true;
        }
      }

      // Real-time DOM updates
      const card = editableSpan ? editableSpan.closest(".job-item") : document.querySelector(`.company-editable[data-job-id="${jobId}"]`)?.closest(".job-item");
      if (card && job) {
        if (editableSpan) {
          editableSpan.setAttribute("data-current-comp", newCompany);
          editableSpan.innerHTML = `${highlightQueryText(newCompany, state.searchQuery)} <span class="material-symbols-outlined" style="font-size: 14px;">edit</span>`;
        }
        const titleBadgesEl = card.querySelector(".job-title-badges");
        if (titleBadgesEl) {
          titleBadgesEl.innerHTML = formatTitleBadgesHtml(job, state.searchQuery);
        }
        if (isCompPrivat) {
          let statusPillsRow = card.querySelector(".job-status-pills");
          if (statusPillsRow) {
            statusPillsRow.style.removeProperty("display");
            if (!statusPillsRow.querySelector(".badge-private-doc")) {
              const privBadge = document.createElement("span");
              privBadge.className = "badge bg-danger-subtle text-danger border border-danger-subtle d-inline-flex align-items-center gap-1 badge-private-doc";
              privBadge.style.cssText = "font-size: 11px; padding: 2px 7px; border-radius: 6px; font-weight: 600;";
              privBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size: 12px;">lock</span> PRIVAT`;
              statusPillsRow.prepend(privBadge);
            }
          }
        }
      }

      renderJobsList(state.jobs, true);
      try {
        await apiRequest(`/api/jobs/${jobId}/company`, {
          method: "POST",
          body: JSON.stringify({ company: newCompany }),
        });
        showToast(`Unternehmen auf "${newCompany}" geändert${isCompPrivat ? " (automatisch als privat markiert)" : ""}.`, "success");
      } catch (err) {
        showToast("Fehler beim Speichern: " + err.message, "error");
      }
      return;
    }

    // 6b. Tags Picker Opening
    const tagsTarget = e.target.closest(".tags-editable");
    if (tagsTarget) {
      if (!state.isAdmin) {
        ensureAdminAuth(() => tagsTarget.click());
        return;
      }
      if (tagsTarget.parentElement.querySelector(".tags-picker-box")) return;
      e.stopPropagation();
      e.preventDefault();
      document.querySelectorAll(".category-picker-box, .company-picker-box, .tags-picker-box").forEach((b) => b.remove());

      const currentTagsStr = tagsTarget.getAttribute("data-current-tags") || "";
      const jobId = tagsTarget.getAttribute("data-job-id");

      const pickerBoxHtml = `
        <div class="tags-picker-box" style="position: absolute; top: 100%; left: 0; margin-top: 6px; padding: 12px; background: #ffffff; border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.18); border: 1px solid #e0e0e0; z-index: 1000; width: 320px;">
          <div style="font-size: 11.5px; color: #475569; font-weight: 600; margin-bottom: 6px;">Tags bearbeiten (Komma-getrennt):</div>
          <input type="text" class="form-control form-control-sm tags-input-field mb-2" value="${escapeHtml(currentTagsStr)}" placeholder="z.B. Software, Lizenz, Adobe..." style="font-size: 12.5px; border-radius: 8px;" />
          <div class="d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-sm btn-light py-1 px-2 btn-cancel-tags" style="font-size: 12px; border-radius: 6px;">Abbrechen</button>
            <button type="button" class="btn btn-sm btn-primary py-1 px-3 btn-save-tags" data-job-id="${jobId}" style="font-size: 12px; border-radius: 6px; font-weight: 500;">Speichern</button>
          </div>
        </div>`;
      tagsTarget.parentElement.insertAdjacentHTML("beforeend", pickerBoxHtml);
      const input = tagsTarget.parentElement.querySelector(".tags-input-field");
      if (input) input.focus();
      return;
    }

    // 6c. Tags Picker Cancel Button
    const cancelTagsBtn = e.target.closest(".btn-cancel-tags");
    if (cancelTagsBtn) {
      e.stopPropagation();
      e.preventDefault();
      cancelTagsBtn.closest(".tags-picker-box")?.remove();
      return;
    }

    // 6d. Tags Picker Save Button
    const saveTagsBtn = e.target.closest(".btn-save-tags");
    if (saveTagsBtn) {
      if (!state.isAdmin) return;
      e.stopPropagation();
      e.preventDefault();
      const pickerBox = saveTagsBtn.closest(".tags-picker-box");
      const input = pickerBox?.querySelector(".tags-input-field");
      const jobId = saveTagsBtn.getAttribute("data-job-id");
      const rawTagsStr = input?.value || "";
      const newTags = rawTagsStr
        .split(",")
        .map((t) => t.trim().replace(/^[-_\s]+|[-_\s]+$/g, ""))
        .filter((t) => t.length > 0);

      if (pickerBox) pickerBox.remove();
      if (!jobId) return;

      const job = (state.jobs || []).find((j) => String(j.id) === String(jobId)) || (window.allRechnungenJobs || []).find((j) => String(j.id) === String(jobId));
      if (job) {
        if (!job.result) job.result = {};
        job.result.tags = newTags;
      }

      // Real-time DOM updates
      const card = saveTagsBtn.closest(".job-item") || document.querySelector(`.tags-editable[data-job-id="${jobId}"]`)?.closest(".job-item");
      if (card && job) {
        // Title badges in real-time
        const titleBadgesEl = card.querySelector(".job-title-badges");
        if (titleBadgesEl) {
          titleBadgesEl.innerHTML = formatTitleBadgesHtml(job, state.searchQuery);
        }
        // Tags bubble in details in real-time
        const tagsArea = card.querySelector(".tags-display-area");
        if (tagsArea) {
          tagsArea.innerHTML = newTags.length > 0
            ? newTags.map((t) => `<span class="badge bg-light text-dark border d-inline-flex align-items-center gap-1" style="font-size: 12px; padding: 3px 8px; border-radius: 12px; font-weight: 500;"><span class="material-symbols-outlined text-muted" style="font-size: 13px;">label</span> ${escapeHtml(t)}</span>`).join(" ")
            : `<span class="text-muted small fst-italic">Keine Tags</span>`;
        }
        const tagsTargetSpan = card.querySelector(".tags-editable");
        if (tagsTargetSpan) {
          tagsTargetSpan.setAttribute("data-current-tags", newTags.join(", "));
        }
      }

      renderJobsList(state.jobs, true);

      try {
        await apiRequest(`/api/jobs/${jobId}/tags`, {
          method: "POST",
          body: JSON.stringify({ tags: newTags }),
        });
        showToast("Tags erfolgreich aktualisiert.", "success");
      } catch (err) {
        showToast("Fehler beim Speichern der Tags: " + err.message, "error");
      }
      return;
    }

    // 7. Click outside pickers
    if (
      !e.target.closest(".category-picker-box") &&
      !e.target.closest(".category-editable") &&
      !e.target.closest(".company-picker-box") &&
      !e.target.closest(".company-editable") &&
      !e.target.closest(".tags-picker-box") &&
      !e.target.closest(".tags-editable")
    ) {
      document.querySelectorAll(".category-picker-box, .company-picker-box, .tags-picker-box").forEach((b) => b.remove());
    }

    // 8. ClickUp Transfer Button (Admin Only)
    const clickupBtn = e.target.closest(".btn-manual-clickup-transfer");
    if (clickupBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (!state.isAdmin) {
        ensureAdminAuth(() => clickupBtn.click());
        return;
      }
      const jobId = clickupBtn.getAttribute("data-job-id");
      if (jobId) transferJobToClickUp(jobId);
      return;
    }

    // 9. Buchhaltung Sync Button (Admin Only)
    const lexofficeBtn = e.target.closest(".btn-manual-lexoffice-sync");
    if (lexofficeBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (!state.isAdmin) {
        ensureAdminAuth(() => lexofficeBtn.click());
        return;
      }
      const jobId = lexofficeBtn.getAttribute("data-job-id");
      if (jobId) openAccountingModal(jobId);
      return;
    }

    // 10. Reprocess AI (Admin Only)
    const reprocessBtn = e.target.closest(".btn-reprocess-ai");
    if (reprocessBtn) {
      e.preventDefault();
      e.stopPropagation();
      const jobId = reprocessBtn.getAttribute("data-job-id");
      if (!state.isAdmin) {
        ensureAdminAuth(() => {
          if (jobId && window.retryJob) window.retryJob(jobId);
        });
        return;
      }
      if (jobId && window.retryJob) window.retryJob(jobId);
      return;
    }

    // 11. Hide / Unhide (Admin Only)
    const hideBtn = e.target.closest(".btn-hide-job");
    if (hideBtn) {
      e.preventDefault();
      e.stopPropagation();
      const jobId = hideBtn.getAttribute("data-job-id");
      const isCurrentlyHidden = hideBtn.getAttribute("data-is-hidden") === "true";
      if (!state.isAdmin) {
        ensureAdminAuth(() => {
          if (jobId && window.toggleHideJob) window.toggleHideJob(jobId, !isCurrentlyHidden);
        });
        return;
      }
      if (jobId && window.toggleHideJob) window.toggleHideJob(jobId, !isCurrentlyHidden);
      return;
    }

    // 12. Delete Job (Admin Only)
    const deleteBtn = e.target.closest(".btn-delete-job");
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      const jobId = deleteBtn.getAttribute("data-job-id");
      if (!state.isAdmin) {
        ensureAdminAuth(() => {
          if (jobId && window.deleteJob) window.deleteJob(jobId);
        });
        return;
      }
      if (jobId && window.deleteJob) window.deleteJob(jobId);
      return;
    }

    // 13. Toggle Show Hidden Filter
    const toggleHiddenBtn = e.target.closest("#toggle-show-hidden-btn");
    if (toggleHiddenBtn) {
      e.preventDefault();
      e.stopPropagation();
      state.activeFilter = state.activeFilter === "hidden" ? "all" : "hidden";
      toggleHiddenBtn.classList.toggle("active", state.activeFilter === "hidden");
      renderJobsList();
      return;
    }
  });

  // Close modal on Escape & handle tags input
  document.addEventListener("keydown", (e) => {
    if (e.target?.classList?.contains("tags-input-field")) {
      if (e.key === "Enter") {
        e.preventDefault();
        const saveBtn = e.target.closest(".tags-picker-box")?.querySelector(".btn-save-tags");
        if (saveBtn) saveBtn.click();
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        const cancelBtn = e.target.closest(".tags-picker-box")?.querySelector(".btn-cancel-tags");
        if (cancelBtn) cancelBtn.click();
        return;
      }
    }
    if (e.key === "Escape") {
      closeDocPreview();
      document.querySelectorAll(".category-picker-box, .company-picker-box, .tags-picker-box").forEach((b) => b.remove());
    }
  });

  // Notes Auto-Save while typing (accessible to all users, automatic save)
  const notesDebounceTimers = new Map();

  async function saveJobNotes(jobId, val, container) {
    try {
      const res = await apiRequest(`/api/jobs/${jobId}/notes`, {
        method: "POST",
        body: JSON.stringify({ notes: val }),
      });
      if (res && res.success !== false) {
        const indicator = container ? container.querySelector(".notes-save-indicator") : null;
        if (indicator) {
          indicator.style.display = "inline-flex";
          setTimeout(() => {
            indicator.style.display = "none";
          }, 2000);
        }
      }
    } catch (err) {
      console.error("Fehler beim Speichern der Notiz:", err);
    }
  }

  document.addEventListener("input", (e) => {
    const textarea = e.target.closest(".job-notes-input");
    if (textarea) {
      const jobId = textarea.getAttribute("data-job-id");
      const val = textarea.value;

      // Update in-memory state immediately for live search
      if (state.jobs) {
        const j = state.jobs.find((job) => String(job.id) === String(jobId));
        if (j) j.notes = val;
      }
      if (window.allRechnungenJobs) {
        const rj = window.allRechnungenJobs.find((job) => String(job.id) === String(jobId));
        if (rj) rj.notes = val;
      }
      if (state.driveOnlySearchResults) {
        const dj = state.driveOnlySearchResults.find((job) => String(job.id) === String(jobId));
        if (dj) dj.notes = val;
      }

      if (notesDebounceTimers.has(jobId)) {
        clearTimeout(notesDebounceTimers.get(jobId));
      }

      const timer = setTimeout(() => {
        notesDebounceTimers.delete(jobId);
        saveJobNotes(jobId, val, textarea.closest(".border-top") || textarea.parentElement);
      }, 500);

      notesDebounceTimers.set(jobId, timer);
    }
  });

  document.addEventListener("change", (e) => {
    const textarea = e.target.closest(".job-notes-input");
    if (textarea) {
      const jobId = textarea.getAttribute("data-job-id");
      if (notesDebounceTimers.has(jobId)) {
        clearTimeout(notesDebounceTimers.get(jobId));
        notesDebounceTimers.delete(jobId);
      }
      saveJobNotes(jobId, textarea.value, textarea.closest(".border-top") || textarea.parentElement);
    }
  });
}

// Auto-advance progress bars for processing jobs smoothly in real-time
setInterval(() => {
  const bars = document.querySelectorAll(".ai-progress-bar");
  if (!bars || bars.length === 0) return;
  const now = Date.now();
  bars.forEach((bar) => {
    const startTime = parseFloat(bar.getAttribute("data-start-time")) || now;
    const elapsedSec = Math.max(0, (now - startTime) / 1000);
    // Linearer Fortschritt: Nach exakt 3 Minuten (180s) 99% erreichen und warten
    const progressPercent = Math.min(99, Math.max(0, Math.round((elapsedSec / 180) * 99)));
    bar.style.width = `${progressPercent}%`;
    const box = bar.closest(".ai-processing-box");
    if (box) {
      const percentEl = box.querySelector(".ai-progress-percent");
      if (percentEl) percentEl.innerText = `${progressPercent}%`;
    }
  });
}, 800);
