/**
 * Accounting Integration & Rechnungs-Ansicht (Lexoffice & BuchhaltungsButler)
 */
import { escapeHtml, formatCurrency, formatDateDisplay, highlightQueryText, showToast, debugLog } from "./utils.js";
import { apiRequest } from "./api.js";
import { getAllClientCredentials, state } from "./state.js";
import { transferJobToClickUp } from "./clickup.js";

let allRechnungenJobs = [];
let currentLexJobId = null;
let currentLexCheckData = null;
let currentSelectedLexCompany = "thewire";

let currentCompareJobId = null;
let currentCompareCompany = null;
let currentCompareMatch = null;

export function initRechnungenEvents() {
  const filterRechnungenSearch = document.getElementById("filter-rechnungen-search");
  const filterOnlyInvoices = document.getElementById("filter-only-invoices");
  const filterCompany = document.getElementById("filter-company");
  const filterStatus = document.getElementById("filter-status");
  const filterYear = document.getElementById("filter-year");
  const filterQuarter = document.getElementById("filter-quarter");
  const rechnungenList = document.getElementById("rechnungen-list");

  if (filterRechnungenSearch) filterRechnungenSearch.addEventListener("input", renderRechnungenList);
  if (filterOnlyInvoices) filterOnlyInvoices.addEventListener("change", renderRechnungenList);
  if (filterCompany) filterCompany.addEventListener("change", renderRechnungenList);
  if (filterStatus) filterStatus.addEventListener("change", renderRechnungenList);
  if (filterYear) filterYear.addEventListener("change", renderRechnungenList);
  if (filterQuarter) filterQuarter.addEventListener("change", renderRechnungenList);

  if (rechnungenList) {
    rechnungenList.addEventListener("click", async (e) => {
      // 1. ClickUp transfer
      const clickupBtn = e.target.closest(".rechnung-clickup-btn");
      if (clickupBtn) {
        const jobId = clickupBtn.getAttribute("data-job-id");
        if (jobId) {
          transferJobToClickUp(jobId, false, clickupBtn);
        }
        return;
      }

      // 2. Accounting sync modal
      const lexBtn = e.target.closest(".rechnung-lex-btn");
      if (lexBtn) {
        const jobId = lexBtn.getAttribute("data-job-id");
        if (jobId) {
          openAccountingModal(jobId);
        }
        return;
      }
    });
  }
}

export function initAccountingEvents() {
  const lexModalCloseBtn = document.getElementById("lex-modal-close-btn");
  const lexModalCancelBtn = document.getElementById("lex-modal-cancel-btn");
  const lexModalSubmitBtn = document.getElementById("lex-modal-submit-btn");
  const lexSyncModal = document.getElementById("lexoffice-sync-modal");

  if (lexModalCloseBtn) lexModalCloseBtn.addEventListener("click", closeLexofficeModal);
  if (lexModalCancelBtn) lexModalCancelBtn.addEventListener("click", closeLexofficeModal);
  if (lexSyncModal) {
    lexSyncModal.addEventListener("click", (e) => {
      if (e.target === lexSyncModal) closeLexofficeModal();
    });
  }

  if (lexModalSubmitBtn) {
    lexModalSubmitBtn.addEventListener("click", handleLexModalSubmit);
  }

  // Accounting Compare Modal Handlers
  const compareModalCloseBtn = document.getElementById("compare-modal-close-btn");
  const compareModalBackBtn = document.getElementById("compare-modal-back-btn");
  const compareModalMarkBtn = document.getElementById("compare-modal-mark-btn");
  const compareModalUploadBtn = document.getElementById("compare-modal-upload-btn");
  const accountingCompareModal = document.getElementById("accounting-compare-modal");

  if (compareModalCloseBtn) compareModalCloseBtn.addEventListener("click", closeAccountingCompareModal);
  if (compareModalBackBtn) {
    compareModalBackBtn.addEventListener("click", () => {
      closeAccountingCompareModal();
      if (lexSyncModal) lexSyncModal.style.display = "flex";
    });
  }
  if (accountingCompareModal) {
    accountingCompareModal.addEventListener("click", (e) => {
      if (e.target === accountingCompareModal) closeAccountingCompareModal();
    });
  }

  if (compareModalMarkBtn) {
    compareModalMarkBtn.addEventListener("click", async () => {
      if (!currentCompareJobId || !currentCompareCompany || !currentCompareMatch) return;
      const jobId = currentCompareJobId;
      const companyKey = currentCompareCompany;
      const fileId = currentCompareMatch.id;

      compareModalMarkBtn.disabled = true;
      compareModalMarkBtn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> <span>Speichere...</span>`;

      try {
        const data = await apiRequest("/api/accounting/mark-synced", {
          method: "POST",
          body: JSON.stringify({ jobId, companyKey, fileId }),
        });
        if (data.success) {
          showToast("✓ Beleg erfolgreich als synchronisiert markiert!", "success");
          closeAccountingCompareModal();
          closeLexofficeModal();
          if (window.loadRechnungenView) window.loadRechnungenView();
        } else {
          showToast("Fehler beim Speichern: " + (data.error || "Unbekannt"), "error");
          compareModalMarkBtn.disabled = false;
        }
      } catch (err) {
        showToast("Netzwerkfehler: " + err.message, "error");
        compareModalMarkBtn.disabled = false;
      }
    });
  }

  if (compareModalUploadBtn) {
    compareModalUploadBtn.addEventListener("click", async () => {
      if (!currentCompareJobId || !currentCompareCompany) return;
      closeAccountingCompareModal();
      if (lexSyncModal) lexSyncModal.style.display = "flex";
      if (lexModalSubmitBtn) lexModalSubmitBtn.click();
    });
  }
}

export function closeLexofficeModal() {
  const lexSyncModal = document.getElementById("lexoffice-sync-modal");
  if (lexSyncModal) lexSyncModal.style.display = "none";
  currentLexJobId = null;
  currentLexCheckData = null;
  currentSelectedLexCompany = "thewire";
}

export async function openAccountingModal(jobId, companyKey = null) {
  const lexSyncModal = document.getElementById("lexoffice-sync-modal");
  if (!lexSyncModal) return;

  const job = (state.jobs && state.jobs.find((j) => j.id === jobId)) || (allRechnungenJobs && allRechnungenJobs.find((j) => j.id === jobId));
  if (!job) {
    showToast("Dokument nicht gefunden.", "error");
    return;
  }

  currentLexJobId = jobId;
  const res = job.result || {};
  lexSyncModal.style.display = "flex";

  // Pre-fill Document preview info
  const lexDocThumbContainer = document.getElementById("lex-doc-thumb-container");
  const lexDocTitle = document.getElementById("lex-doc-title");
  const lexDocDate = document.getElementById("lex-doc-date");
  const lexDocCompany = document.getElementById("lex-doc-company");
  const lexDocInvNumber = document.getElementById("lex-doc-inv-number");
  const lexDocAmount = document.getElementById("lex-doc-amount");

  const thumbSrc = `/api/thumbnail/${job.id}`;
  if (lexDocThumbContainer) {
    lexDocThumbContainer.innerHTML = `<img src="${thumbSrc}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'material-symbols-outlined text-muted\\'>description</span>';" />`;
  }

  if (lexDocTitle) {
    lexDocTitle.innerText = res.full || job.originalName || "Dokument.pdf";
    lexDocTitle.title = res.full || job.originalName || "";
  }
  if (lexDocDate) {
    lexDocDate.innerText = `📅 ${formatDateDisplay(res.documentDate || job.uploadDate)}`;
  }
  if (lexDocCompany) {
    lexDocCompany.innerText = `🏢 ${res.company || "Unbekannt"}`;
  }

  const invNum = res.invoiceNumber && res.invoiceNumber !== "none" ? res.invoiceNumber : (job.invoiceNumber && job.invoiceNumber !== "none" ? job.invoiceNumber : "-");
  if (lexDocInvNumber) {
    lexDocInvNumber.innerText = `Rechnung: ${invNum}`;
  }

  let amountStr = "-";
  const invAmt = res.invoiceAmmount !== undefined ? res.invoiceAmmount : job.invoiceAmmount;
  if (invAmt && invAmt > 0) {
    amountStr = (invAmt / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }
  if (lexDocAmount) {
    lexDocAmount.innerText = `Betrag: ${amountStr}`;
  }

  // Default target company
  currentSelectedLexCompany = companyKey || job.targetCompany || detectDefaultTargetCompany(res.company) || "thewire";

  await checkLexofficeTarget(jobId, currentSelectedLexCompany);
}

async function checkLexofficeTarget(jobId, companyKey) {
  const lexModalSubmitBtn = document.getElementById("lex-modal-submit-btn");
  const lexModalStatusContainer = document.getElementById("lex-modal-status-container");

  if (!lexModalSubmitBtn || !lexModalStatusContainer) return;

  currentSelectedLexCompany = companyKey || currentSelectedLexCompany || "thewire";

  lexModalSubmitBtn.disabled = true;
  lexModalStatusContainer.innerHTML = `
    <div class="d-flex align-items-center gap-2 text-muted py-2">
      <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
      <span>Prüfe alle angebundenen Unternehmen & Buchhaltungssysteme auf Belege...</span>
    </div>
  `;

  try {
    const creds = getAllClientCredentials();
    const data = await apiRequest("/api/accounting/check", {
      method: "POST",
      body: JSON.stringify({
        jobId,
        companyKey: currentSelectedLexCompany,
        credentials: {
          wirewireApiKey: creds.wirewireApiKey || "",
          polyxoApiKey: creds.polyxoApiKey || "",
          thewireClient: creds.thewireClient || "",
          thewireSecret: creds.thewireSecret || "",
          thewireKey: creds.thewireKey || "",
        },
      }),
    });

    currentLexCheckData = data;

    if (!data.success) {
      lexModalStatusContainer.innerHTML = `
        <div class="text-danger d-flex align-items-center gap-2">
          <span class="material-symbols-outlined">error</span>
          <span>Fehler bei der Prüfung: ${escapeHtml(data.error || "Unbekannt")}</span>
        </div>
      `;
      lexModalSubmitBtn.disabled = true;
      return;
    }

    renderAccountingModalContent();
  } catch (err) {
    lexModalStatusContainer.innerHTML = `
      <div class="text-danger d-flex align-items-center gap-2">
        <span class="material-symbols-outlined">wifi_off</span>
        <span>Verbindungsfehler: ${escapeHtml(err.message)}</span>
      </div>
    `;
    lexModalSubmitBtn.disabled = true;
  }
}

function renderAccountingModalContent() {
  if (!currentLexCheckData || !currentLexJobId) return;

  const data = currentLexCheckData;
  const companyKey = currentSelectedLexCompany || "thewire";
  const allCompanyChecks = data.allCompanyChecks || {};
  const selectedData = allCompanyChecks[companyKey] || {
    companyKey,
    companyDisplayName: companyKey === "thewire" ? "The Wire UG" : (companyKey === "wirewire" ? "wirewire GmbH" : "Polyxo Studios GmbH"),
    provider: companyKey === "thewire" ? "buchhaltungsbutler" : "lexoffice",
    providerName: companyKey === "thewire" ? "BuchhaltungsButler" : "Lexoffice",
    apiValid: false,
    alreadyTransferred: false,
    liveSearch: { found: false, matches: [] },
  };

  const isButler = companyKey === "thewire";
  const providerName = selectedData.providerName || (isButler ? "BuchhaltungsButler" : "Lexoffice");

  const lexModalProviderBadge = document.getElementById("lex-modal-provider-badge");
  const lexModalSubmitBtn = document.getElementById("lex-modal-submit-btn");
  const lexModalSubmitText = document.getElementById("lex-modal-submit-text");
  const lexModalStatusContainer = document.getElementById("lex-modal-status-container");

  if (lexModalProviderBadge) {
    lexModalProviderBadge.innerText = providerName;
    lexModalProviderBadge.className = isButler
      ? "badge bg-info-subtle text-info-emphasis border border-info-subtle small"
      : "badge bg-primary-subtle text-primary border border-primary-subtle small";
  }

  const companyKeys = ["thewire", "wirewire", "polyxo"];

  // 1. Interactive Company Badges (Target Selection)
  const badgesContainer = document.getElementById("lex-modal-company-badges");
  const companyBadgesHtml = companyKeys
    .map((ck) => {
      const cInfo = allCompanyChecks[ck];
      if (!cInfo) return "";
      const isSelected = ck === companyKey;
      const shortName = ck === "thewire" ? "The Wire UG" : (ck === "wirewire" ? "wirewire GmbH" : "Polyxo Studios");
      const providerLabel = ck === "thewire" ? "BuchhaltungsButler" : "Lexoffice";

      let badgeClass = "bg-light text-muted border";
      let statusIcon = "radio_button_unchecked";
      let statusText = "Kein Beleg";

      if (cInfo.alreadyTransferred) {
        badgeClass = "bg-success text-white";
        statusIcon = "check_circle";
        statusText = "Übertragen";
      } else if (cInfo.liveSearch && cInfo.liveSearch.found && cInfo.liveSearch.matches && cInfo.liveSearch.matches.length > 0) {
        badgeClass = "bg-warning text-dark border-warning";
        statusIcon = "find_in_page";
        statusText = "Treffer";
      } else if (!cInfo.apiValid) {
        badgeClass = "bg-secondary-subtle text-secondary";
        statusIcon = "block";
        statusText = "Nicht eingerichtet";
      }

      const cardStyle = isSelected
        ? "border: 2px solid #0d6efd !important; background: #eef4ff; box-shadow: 0 0 0 1px #0d6efd;"
        : "border: 1px solid #dee2e6; background: #ffffff; cursor: pointer;";

      return `
        <div class="company-select-badge p-2 px-3 rounded-3 d-flex flex-column gap-1 flex-grow-1" 
             style="${cardStyle} min-width: 140px; transition: all 0.15s ease;"
             data-company="${ck}"
             title="${shortName} (${providerLabel}): ${statusText}">
          <div class="d-flex align-items-center justify-content-between gap-2">
            <div class="d-flex align-items-center gap-1">
              <span class="material-symbols-outlined" style="font-size: 16px; color: ${isSelected ? '#0d6efd' : '#666'};">
                ${isSelected ? 'radio_button_checked' : 'radio_button_unchecked'}
              </span>
              <strong style="font-size: 13px; color: ${isSelected ? '#0d6efd' : '#222'};">${shortName}</strong>
            </div>
            <span class="badge ${badgeClass} d-inline-flex align-items-center gap-1" style="font-size: 10px; padding: 2px 6px;">
              <span class="material-symbols-outlined" style="font-size: 11px;">${statusIcon}</span> ${statusText}
            </span>
          </div>
          <div class="text-muted" style="font-size: 11px; padding-left: 20px;">
            ${providerLabel}
          </div>
        </div>
      `;
    })
    .join("");

  if (badgesContainer) {
    badgesContainer.innerHTML = companyBadgesHtml;
    badgesContainer.querySelectorAll(".company-select-badge").forEach((badge) => {
      badge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetComp = badge.getAttribute("data-company");
        if (targetComp && targetComp !== currentSelectedLexCompany) {
          currentSelectedLexCompany = targetComp;
          renderAccountingModalContent();
        }
      });
    });
  }

  // 2. Cross-Company Warning Alerts for Other Companies
  let otherCompanyAlertsHtml = "";
  companyKeys.forEach((ck) => {
    if (ck === companyKey) return;
    const otherInfo = allCompanyChecks[ck];
    if (!otherInfo) return;

    if (otherInfo.alreadyTransferred) {
      const dateFormatted = otherInfo.transferredInfo?.transferredAt
        ? new Date(otherInfo.transferredInfo.transferredAt).toLocaleString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "-";
      otherCompanyAlertsHtml += `
        <div class="p-2 mb-2 rounded-3 border bg-success-subtle text-success-emphasis d-flex align-items-center justify-content-between flex-wrap gap-2" style="border-color: #a5d6a7 !important;">
          <div class="d-flex align-items-center gap-2">
            <span class="material-symbols-outlined text-success" style="font-size: 20px;">task_alt</span>
            <div style="font-size: 12.5px;">
              <strong>Bereits übertragen:</strong> Beleg existiert schon in <strong>${otherInfo.companyDisplayName}</strong> (${otherInfo.providerName}, übertragen am ${dateFormatted} Uhr).
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-success btn-switch-modal-company py-1 px-2 d-inline-flex align-items-center gap-1" data-company="${ck}" style="border-radius: 6px; font-size: 11.5px; font-weight: 500;">
            <span class="material-symbols-outlined" style="font-size: 14px;">swap_horiz</span>
            <span>Zu ${otherInfo.companyDisplayName} wechseln</span>
          </button>
        </div>
      `;
    } else if (otherInfo.liveSearch && otherInfo.liveSearch.found && otherInfo.liveSearch.matches && otherInfo.liveSearch.matches.length > 0) {
      const topMatch = otherInfo.liveSearch.matches[0];
      otherCompanyAlertsHtml += `
        <div class="p-2 mb-2 rounded-3 border bg-warning-subtle text-dark d-flex align-items-center justify-content-between flex-wrap gap-2" style="border-color: #ffc107 !important;">
          <div class="d-flex align-items-center gap-2">
            <span class="material-symbols-outlined text-warning-emphasis" style="font-size: 20px;">find_in_page</span>
            <div style="font-size: 12.5px;">
              <strong>Gefunden in anderem Unternehmen:</strong> In <strong>${otherInfo.companyDisplayName}</strong> (${otherInfo.providerName}) existiert bereits ein übereinstimmender Beleg (${topMatch.invoiceNumber !== '-' ? topMatch.invoiceNumber : (topMatch.amount || topMatch.totalAmount || '')}).
            </div>
          </div>
          <div class="d-flex align-items-center gap-1">
            <button type="button" class="btn btn-sm btn-outline-primary btn-open-compare-modal py-1 px-2 d-inline-flex align-items-center gap-1" data-job-id="${currentLexJobId}" data-company="${ck}" data-match-index="0" style="border-radius: 6px; font-size: 11.5px;">
              <span class="material-symbols-outlined" style="font-size: 14px;">compare</span>
              <span>Vorschau</span>
            </button>
            <button type="button" class="btn btn-sm btn-outline-dark btn-switch-modal-company py-1 px-2 d-inline-flex align-items-center gap-1" data-company="${ck}" style="border-radius: 6px; font-size: 11.5px; font-weight: 500;">
              <span class="material-symbols-outlined" style="font-size: 14px;">swap_horiz</span>
              <span>Zu ${otherInfo.companyDisplayName} wechseln</span>
            </button>
          </div>
        </div>
      `;
    }
  });

  // Check API validity of selected company
  if (!selectedData.apiValid) {
    if (lexModalStatusContainer) {
      lexModalStatusContainer.innerHTML = `
        ${otherCompanyAlertsHtml}
        <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-start gap-2">
          <span class="material-symbols-outlined flex-shrink-0" style="font-size: 20px;">warning</span>
          <div>
            <strong>API-Prüfung fehlgeschlagen:</strong><br>
            ${escapeHtml(selectedData.apiError || `Keine gültigen Zugangsdaten für ${providerName} (${companyKey}) hinterlegt.`)}
            <div class="small mt-1 text-muted">Bitte hinterlege die Zugangsdaten in den Einstellungen.</div>
          </div>
        </div>
      `;
    }
    if (lexModalSubmitBtn) {
      lexModalSubmitBtn.disabled = true;
      lexModalSubmitBtn.className = "btn btn-secondary px-4 d-flex align-items-center gap-2";
    }
    if (lexModalSubmitText) lexModalSubmitText.innerText = "API-Key erforderlich";
    wireModalInternalButtons();
    return;
  }

  // 3. Live Match in Selected Company
  const hasLiveMatch = selectedData.liveSearch && selectedData.liveSearch.found && selectedData.liveSearch.matches && selectedData.liveSearch.matches.length > 0;
  let liveMatchHtml = "";
  if (hasLiveMatch) {
    const topMatch = selectedData.liveSearch.matches[0];
    const matchBadge = `<span class="badge bg-warning text-dark border border-warning-subtle">${topMatch.matchReasons?.length || 1} Übereinstimmungen</span>`;
    const reasonsList = (topMatch.matchReasons || []).map((r) => `<li><span class="text-success fw-medium">✓</span> ${escapeHtml(r)}</li>`).join("");

    liveMatchHtml = `
      <div class="p-3 mb-2 rounded-3 border bg-warning-subtle text-dark" style="border-color: #ffc107 !important;">
        <div class="d-flex align-items-center justify-content-between flex-wrap gap-1 mb-2">
          <div class="d-flex align-items-center gap-1 fw-bold" style="font-size: 13.5px; color: #664d03;">
            <span class="material-symbols-outlined" style="font-size: 20px;">find_in_page</span>
            <span>Beleg bereits in ${providerName} (${companyKey}) gefunden!</span>
          </div>
          ${matchBadge}
        </div>
        
        <div class="p-2 rounded bg-white border mb-2" style="font-size: 12.5px; line-height: 1.5;">
          <div class="d-flex justify-content-between flex-wrap gap-2">
            <div><strong>Gefundener Beleg:</strong> ${escapeHtml(topMatch.invoiceNumber !== '-' ? topMatch.invoiceNumber : topMatch.fileName || "")}</div>
            <div><strong>Betrag:</strong> <span class="font-monospace text-success fw-bold">${escapeHtml(topMatch.amount || topMatch.totalAmount || "")}</span></div>
          </div>
          <div class="text-muted small mt-1">
            <span>Datum: <strong>${escapeHtml(topMatch.date || topMatch.voucherDate || "-")}</strong></span>
            ${topMatch.partner || topMatch.contactName ? ` | <span>Partner: <strong>${escapeHtml(topMatch.partner || topMatch.contactName)}</strong></span>` : ''}
            ${topMatch.voucherStatus ? ` | Status: <span class="badge bg-light text-dark border">${escapeHtml(topMatch.voucherStatus)}</span>` : ''}
          </div>
          <div class="mt-2 pt-2 border-top">
            <span class="text-muted fw-bold small" style="font-size: 11px;">Abgeglichene Datenpunkte:</span>
            <ul class="mb-0 ps-0 mt-1 small" style="font-size: 12px; list-style-type: none;">
              ${reasonsList}
            </ul>
          </div>
        </div>

        <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 pt-1">
          <button type="button" class="btn btn-sm btn-outline-primary btn-open-compare-modal d-inline-flex align-items-center gap-1" data-job-id="${currentLexJobId}" data-company="${companyKey}" data-match-index="0" style="border-radius: 12px; font-size: 12px; padding: 4px 12px; font-weight: 500;">
            <span class="material-symbols-outlined" style="font-size: 16px;">compare</span>
            <span>Belege gegenüberstellen (Vorschau)</span>
          </button>
          <button type="button" class="btn btn-sm btn-success btn-mark-synced-direct d-inline-flex align-items-center gap-1" data-job-id="${currentLexJobId}" data-company="${companyKey}" data-file-id="${topMatch.id}" style="border-radius: 12px; font-size: 12px; padding: 4px 12px;">
            <span class="material-symbols-outlined" style="font-size: 16px;">check_circle</span>
            <span>Als synchronisiert markieren</span>
          </button>
        </div>
      </div>
    `;
  }

  // 4. Overall status in Selected Company
  if (selectedData.alreadyTransferred && selectedData.transferredInfo) {
    const dateFormatted = new Date(selectedData.transferredInfo.transferredAt).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const fileId = selectedData.transferredInfo.fileId || selectedData.transferredInfo.lexofficeFileId || "-";
    if (lexModalStatusContainer) {
      lexModalStatusContainer.innerHTML = `
        ${otherCompanyAlertsHtml}
        ${liveMatchHtml}
        <div class="p-2 rounded bg-success-subtle text-success-emphasis border border-success-subtle d-flex align-items-start gap-2">
          <span class="material-symbols-outlined text-success flex-shrink-0" style="font-size: 20px;">check_circle</span>
          <div style="font-size: 13px;">
            <strong>Bereits bei ${providerName} vorhanden:</strong><br>
            Übertragen an <strong>${companyKey}</strong> am <strong>${dateFormatted} Uhr</strong>.<br>
            <span class="small text-muted font-monospace">Beleg-ID: ${escapeHtml(fileId)}</span>
          </div>
        </div>
      `;
    }
    if (lexModalSubmitBtn) {
      lexModalSubmitBtn.disabled = false;
      lexModalSubmitBtn.className = "btn btn-outline-primary px-4 d-flex align-items-center gap-2";
    }
    if (lexModalSubmitText) lexModalSubmitText.innerText = "Trotzdem erneut übertragen";
  } else if (hasLiveMatch) {
    if (lexModalStatusContainer) {
      lexModalStatusContainer.innerHTML = `
        ${otherCompanyAlertsHtml}
        ${liveMatchHtml}
      `;
    }
    if (lexModalSubmitBtn) {
      lexModalSubmitBtn.disabled = false;
      lexModalSubmitBtn.className = "btn btn-outline-warning text-dark px-4 d-flex align-items-center gap-2";
    }
    if (lexModalSubmitText) lexModalSubmitText.innerText = "Trotzdem übertragen (Duplikat)";
  } else {
    if (lexModalStatusContainer) {
      lexModalStatusContainer.innerHTML = `
        ${otherCompanyAlertsHtml}
        <div class="p-2 rounded bg-info-subtle text-info-emphasis border border-info-subtle d-flex align-items-start gap-2">
          <span class="material-symbols-outlined text-primary flex-shrink-0" style="font-size: 20px;">cloud_upload</span>
          <div style="font-size: 13px;">
            <strong>Bereit zum Upload:</strong><br>
            API verbunden mit <strong>${escapeHtml(selectedData.organizationName || providerName)}</strong>.<br>
            <span class="text-success small fw-medium">✓ Kein übereinstimmender Beleg in ${providerName} (${companyKey}) gefunden.</span>
          </div>
        </div>
      `;
    }
    if (lexModalSubmitBtn) {
      lexModalSubmitBtn.disabled = false;
      lexModalSubmitBtn.className = "btn btn-primary px-4 d-flex align-items-center gap-2";
    }
    if (lexModalSubmitText) lexModalSubmitText.innerText = "Upload starten";
  }

  wireModalInternalButtons();
}

function wireModalInternalButtons() {
  const lexModalStatusContainer = document.getElementById("lex-modal-status-container");
  if (!lexModalStatusContainer) return;

  lexModalStatusContainer.querySelectorAll(".btn-switch-modal-company").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetComp = btn.getAttribute("data-company");
      if (targetComp && targetComp !== currentSelectedLexCompany) {
        currentSelectedLexCompany = targetComp;
        renderAccountingModalContent();
      }
    });
  });

  lexModalStatusContainer.querySelectorAll(".btn-open-compare-modal").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const jobId = btn.getAttribute("data-job-id");
      const companyKey = btn.getAttribute("data-company");
      const matchIdx = parseInt(btn.getAttribute("data-match-index") || "0", 10);
      openAccountingCompareModal(jobId, companyKey, matchIdx);
    });
  });

  lexModalStatusContainer.querySelectorAll(".btn-mark-synced-direct").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const jobId = btn.getAttribute("data-job-id");
      const companyKey = btn.getAttribute("data-company");
      const fileId = btn.getAttribute("data-file-id");

      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-border spinner-border-sm"></span> <span>Speichere...</span>`;

      try {
        const data = await apiRequest("/api/accounting/mark-synced", {
          method: "POST",
          body: JSON.stringify({ jobId, companyKey, fileId }),
        });
        if (data.success) {
          showToast("✓ Beleg erfolgreich als synchronisiert markiert!", "success");
          closeLexofficeModal();
          if (window.loadRechnungenView) window.loadRechnungenView();
        } else {
          showToast("Fehler beim Speichern: " + (data.error || "Unbekannt"), "error");
          btn.disabled = false;
        }
      } catch (err) {
        showToast("Netzwerkfehler: " + err.message, "error");
        btn.disabled = false;
      }
    });
  });
}

async function handleLexModalSubmit() {
  if (!currentLexJobId) return;
  const jobId = currentLexJobId;
  const companyKey = currentSelectedLexCompany || "thewire";
  const isForce = currentLexCheckData && currentLexCheckData.allCompanyChecks && currentLexCheckData.allCompanyChecks[companyKey]?.alreadyTransferred;
  const providerName = (currentLexCheckData?.allCompanyChecks && currentLexCheckData.allCompanyChecks[companyKey]?.providerName) || (companyKey === "thewire" ? "BuchhaltungsButler" : "Lexoffice");

  const lexModalSubmitBtn = document.getElementById("lex-modal-submit-btn");
  const lexModalCancelBtn = document.getElementById("lex-modal-cancel-btn");
  const lexModalStatusContainer = document.getElementById("lex-modal-status-container");

  if (lexModalSubmitBtn) {
    lexModalSubmitBtn.disabled = true;
    lexModalSubmitBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> <span>Wird übertragen...</span>`;
  }
  if (lexModalCancelBtn) lexModalCancelBtn.disabled = true;

  if (lexModalStatusContainer) {
    lexModalStatusContainer.innerHTML = `
      <div class="d-flex align-items-center gap-2 text-primary">
        <div class="spinner-border spinner-border-sm" role="status"></div>
        <span>Lade Beleg zu ${providerName} (<strong>${companyKey}</strong>) hoch...</span>
      </div>
    `;
  }

  try {
    const creds = getAllClientCredentials();
    const data = await apiRequest("/api/accounting/transfer", {
      method: "POST",
      body: JSON.stringify({
        jobId,
        companyKey,
        force: isForce,
        apiKey: companyKey === "polyxo" ? creds.polyxoApiKey : creds.wirewireApiKey,
        client: creds.thewireClient,
        secret: creds.thewireSecret,
        key: creds.thewireKey,
      }),
    });

    if (data.success) {
      showToast(`✓ Beleg erfolgreich an ${providerName} (${companyKey}) übertragen!`, "success");
      closeLexofficeModal();
      if (window.loadRechnungenView) window.loadRechnungenView();
    } else {
      if (lexModalStatusContainer) {
        lexModalStatusContainer.innerHTML = `
          <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-start gap-2">
            <span class="material-symbols-outlined flex-shrink-0">error</span>
            <div><strong>Upload fehlgeschlagen:</strong><br>${escapeHtml(data.error || "Unbekannter Fehler")}</div>
          </div>
        `;
      }
      if (lexModalSubmitBtn) {
        lexModalSubmitBtn.disabled = false;
        lexModalSubmitBtn.innerHTML = `<span class="material-symbols-outlined">cloud_upload</span> <span>Erneut versuchen</span>`;
      }
      if (lexModalCancelBtn) lexModalCancelBtn.disabled = false;
    }
  } catch (err) {
    if (lexModalStatusContainer) {
      lexModalStatusContainer.innerHTML = `
        <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-start gap-2">
          <span class="material-symbols-outlined flex-shrink-0">wifi_off</span>
          <div><strong>Netzwerkfehler:</strong><br>${escapeHtml(err.message)}</div>
        </div>
      `;
    }
    if (lexModalSubmitBtn) {
      lexModalSubmitBtn.disabled = false;
      lexModalSubmitBtn.innerHTML = `<span class="material-symbols-outlined">cloud_upload</span> <span>Erneut versuchen</span>`;
    }
    if (lexModalCancelBtn) lexModalCancelBtn.disabled = false;
  }
}

export function closeAccountingCompareModal() {
  const accountingCompareModal = document.getElementById("accounting-compare-modal");
  if (accountingCompareModal) accountingCompareModal.style.display = "none";
  currentCompareJobId = null;
  currentCompareCompany = null;
  currentCompareMatch = null;
}

export function openAccountingCompareModal(jobId, companyKey, matchIndex = 0) {
  const job = (state.jobs && state.jobs.find((j) => j.id === jobId)) || (allRechnungenJobs && allRechnungenJobs.find((j) => j.id === jobId));
  if (!job || !currentLexCheckData) return;

  const accountingCompareModal = document.getElementById("accounting-compare-modal");
  const compareLocalImg = document.getElementById("compare-local-img");
  const compareLocalLoading = document.getElementById("compare-local-loading");
  const compareRemoteImg = document.getElementById("compare-remote-img");
  const compareRemoteLoading = document.getElementById("compare-remote-loading");

  currentCompareJobId = jobId;
  currentCompareCompany = companyKey;

  const allCompanyChecks = currentLexCheckData.allCompanyChecks || {};
  const cInfo = allCompanyChecks[companyKey];
  if (!cInfo || !cInfo.liveSearch || !cInfo.liveSearch.matches || !cInfo.liveSearch.matches[matchIndex]) {
    showToast("Kein Vergleichsbeleg gefunden.", "warning");
    return;
  }

  const match = cInfo.liveSearch.matches[matchIndex];
  currentCompareMatch = match;

  const res = job.result || {};
  const isButler = companyKey === "thewire";
  const providerName = cInfo.providerName || (isButler ? "BuchhaltungsButler" : "Lexoffice");

  // Populate Local info
  const compareLocalInv = document.getElementById("compare-local-inv");
  const compareLocalAmt = document.getElementById("compare-local-amt");
  const compareLocalDate = document.getElementById("compare-local-date");
  const compareLocalComp = document.getElementById("compare-local-comp");

  if (compareLocalInv) compareLocalInv.innerHTML = `Rechnung: <strong>${escapeHtml(res.invoiceNumber || job.invoiceNumber || "-")}</strong>`;
  if (compareLocalAmt) compareLocalAmt.innerText = `Betrag: ${formatCurrency(res.invoiceAmmount || job.invoiceAmmount || 0)}`;
  if (compareLocalDate) compareLocalDate.innerText = `Datum: ${formatDateDisplay(res.documentDate || job.uploadDate)}`;
  if (compareLocalComp) compareLocalComp.innerText = `Firma: ${escapeHtml(res.company || job.targetCompany || "-")}`;

  if (compareLocalLoading) compareLocalLoading.style.display = "flex";
  if (compareLocalImg) {
    compareLocalImg.style.display = "none";
    compareLocalImg.onload = () => {
      if (compareLocalLoading) compareLocalLoading.style.display = "none";
      compareLocalImg.style.display = "block";
    };
    compareLocalImg.onerror = () => {
      if (compareLocalLoading) compareLocalLoading.innerHTML = '<span class="material-symbols-outlined text-muted" style="font-size: 40px;">description</span><div class="small mt-2 text-white-50">Vorschau nicht verfügbar</div>';
    };
    compareLocalImg.src = `/api/thumbnail/${job.id}?t=${Date.now()}`;
  }

  // Populate Remote info
  const compareRemoteInv = document.getElementById("compare-remote-inv");
  const compareRemoteAmt = document.getElementById("compare-remote-amt");
  const compareRemoteDate = document.getElementById("compare-remote-date");
  const compareRemoteContact = document.getElementById("compare-remote-contact");
  const compareRemoteBadge = document.getElementById("compare-remote-badge");

  if (compareRemoteBadge) {
    compareRemoteBadge.innerText = `${providerName} (${cInfo.companyDisplayName || companyKey})`;
  }
  if (compareRemoteInv) compareRemoteInv.innerHTML = `Beleg-Nr: <strong>${escapeHtml(match.voucherNumber && match.voucherNumber !== '-' ? match.voucherNumber : (match.invoiceNumber || match.fileName || "-"))}</strong>`;
  if (compareRemoteAmt) compareRemoteAmt.innerText = `Betrag: ${escapeHtml(match.totalAmount || match.amount || "-")}`;
  if (compareRemoteDate) compareRemoteDate.innerText = `Datum: ${escapeHtml(match.voucherDate || match.date || "-")}`;
  if (compareRemoteContact) compareRemoteContact.innerText = `Kontakt: ${escapeHtml(match.contactName || match.partner || "-")}`;

  if (compareRemoteLoading) {
    compareRemoteLoading.style.display = "flex";
    compareRemoteLoading.innerHTML = `<div class="spinner-border spinner-border-sm text-light mb-2" role="status"></div><div class="small">Lade Beleg Seite 1 aus ${providerName}...</div>`;
  }
  if (compareRemoteImg) {
    compareRemoteImg.style.display = "none";
    if (isButler) {
      if (compareRemoteLoading) {
        compareRemoteLoading.innerHTML = `
          <span class="material-symbols-outlined" style="font-size: 48px; color: #17a2b8;">description</span>
          <h6 class="mt-2 text-white">BuchhaltungsButler Beleg</h6>
          <div class="small text-white-50">Beleg <strong>${escapeHtml(match.invoiceNumber || match.fileName || "")}</strong> liegt im Portal vor.</div>
        `;
      }
    } else {
      compareRemoteImg.onload = () => {
        if (compareRemoteLoading) compareRemoteLoading.style.display = "none";
        compareRemoteImg.style.display = "block";
      };
      compareRemoteImg.onerror = () => {
        if (compareRemoteLoading) {
          compareRemoteLoading.innerHTML = '<span class="material-symbols-outlined text-warning" style="font-size: 40px;">warning</span><div class="small mt-2 text-white-50">Vorschau konnte aus Lexoffice nicht gerendert werden</div>';
        }
      };
      const creds = getAllClientCredentials();
      const apiKey = companyKey === "polyxo" ? (creds.polyxoApiKey || "") : (creds.wirewireApiKey || "");
      compareRemoteImg.src = `/api/accounting/voucher-preview?companyKey=${encodeURIComponent(companyKey)}&voucherId=${encodeURIComponent(match.id)}&apiKey=${encodeURIComponent(apiKey)}&_t=${Date.now()}`;
    }
  }

  const lexSyncModal = document.getElementById("lexoffice-sync-modal");
  if (lexSyncModal) lexSyncModal.style.display = "none";
  if (accountingCompareModal) accountingCompareModal.style.display = "flex";
}

export async function loadRechnungenView() {
  const rechnungenList = document.getElementById("rechnungen-list");
  if (!rechnungenList) return;

  rechnungenList.innerHTML = `
    <div class="text-center p-5 text-muted">
      <div class="spinner-border text-primary mb-3" role="status"></div>
      <div>Lade Dokumente...</div>
    </div>
  `;

  try {
    const data = await apiRequest("/api/status?ids=all");
    if (data.success) {
      allRechnungenJobs = (data.statuses || []).filter((j) => j.status === "completed" && j.result);
      populateYearFilter(allRechnungenJobs);
      renderRechnungenList();
    } else {
      rechnungenList.innerHTML = `<div class="alert alert-danger">Fehler beim Laden der Dokumente.</div>`;
    }
  } catch (err) {
    rechnungenList.innerHTML = `<div class="alert alert-danger">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
  }
}

function getDocumentYearAndQuarter(job) {
  const res = job.result || {};
  let dateObj = null;
  if (res.documentDate) {
    dateObj = new Date(res.documentDate);
  } else if (job.uploadDate) {
    dateObj = new Date(job.uploadDate);
  } else {
    dateObj = new Date();
  }

  if (isNaN(dateObj.getTime())) dateObj = new Date();

  const year = dateObj.getFullYear().toString();
  const month = dateObj.getMonth() + 1;

  let quarter = "Q1";
  if (month >= 1 && month <= 3) quarter = "Q1";
  else if (month >= 4 && month <= 6) quarter = "Q2";
  else if (month >= 7 && month <= 9) quarter = "Q3";
  else quarter = "Q4";

  const dateStr = formatDateDisplay(dateObj);
  return { year, quarter, dateStr };
}

function populateYearFilter(jobs) {
  const filterYear = document.getElementById("filter-year");
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

export function renderRechnungenList() {
  const rechnungenList = document.getElementById("rechnungen-list");
  const rechnungenCountBadge = document.getElementById("rechnungen-count-badge");
  const filterRechnungenSearch = document.getElementById("filter-rechnungen-search");
  const filterOnlyInvoices = document.getElementById("filter-only-invoices");
  const filterCompany = document.getElementById("filter-company");
  const filterStatus = document.getElementById("filter-status");
  const filterYear = document.getElementById("filter-year");
  const filterQuarter = document.getElementById("filter-quarter");

  if (!rechnungenList) return;

  if (!allRechnungenJobs || allRechnungenJobs.length === 0) {
    rechnungenList.innerHTML = `<div class="text-center p-5 text-muted bg-white rounded shadow-sm">Keine Dokumente vorhanden.</div>`;
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

    // Exclude hidden documents
    if (job.isHidden) return false;

    // 0. Live Text Search filter
    if (searchQuery) {
      const title = (res.full || job.originalName || "").toLowerCase();
      const comp = (res.company || "").toLowerCase();
      const targetComp = (job.targetCompany || "").toLowerCase();
      const invNum = (res.invoiceNumber || job.invoiceNumber || "").toLowerCase();
      const cat = (res.category || "").toLowerCase();
      const tags = (res.tags && Array.isArray(res.tags) ? res.tags.join(" ") : (typeof res.tags === "string" ? res.tags : "")).toLowerCase();
      const notes = (job.notes || "").toLowerCase();
      const amtStr = res.invoiceAmmount ? (res.invoiceAmmount / 100).toFixed(2).replace(".", ",") : "";

      const matches =
        title.includes(searchQuery) ||
        comp.includes(searchQuery) ||
        targetComp.includes(searchQuery) ||
        invNum.includes(searchQuery) ||
        cat.includes(searchQuery) ||
        tags.includes(searchQuery) ||
        notes.includes(searchQuery) ||
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

    // 3. Status filter (Lexoffice / Buchhaltung transfer status)
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
      if (selectedStatus === "duplikat" && !job.suspectedDuplicate) return false;
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
      <div class="text-center p-5 text-muted bg-white rounded shadow-sm border">
        <span class="material-symbols-outlined mb-2" style="font-size: 44px; color: #cbd5e1;">find_in_page</span>
        <div class="fw-medium">Keine Dokumente entsprechen den gewählten Filtern.</div>
      </div>
    `;
    return;
  }

  rechnungenList.innerHTML = "";
  filteredJobs.forEach((job) => {
    const card = createRechnungCard(job, searchQuery);
    rechnungenList.appendChild(card);
  });
}

function createRechnungCard(job, searchQuery = "") {
  const res = job.result || {};
  const defaultTarget = job.targetCompany || detectDefaultTargetCompany(res.company) || "thewire";

  const card = document.createElement("div");
  card.className = "card shadow-sm border-0 mb-2";
  card.style.borderRadius = "12px";

  const thumbSrc = `/api/thumbnail/${job.id}`;
  const thumbnailHtml = `<img src="${thumbSrc}" loading="lazy" style="width: 65px; height: 85px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0;" onerror="this.onerror=null; this.parentElement.innerHTML='<div style=\\'width:65px;height:85px;background:#f1f5f9;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;\\'><span class=\\'material-symbols-outlined\\'>description</span></div>';" />`;

  // Format amount
  let amountFormatted = "";
  if (res.invoiceAmmount && res.invoiceAmmount > 0) {
    amountFormatted = (res.invoiceAmmount / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  // Accounting transfers status
  const lexTransfers = job.lexofficeTransfers || {};
  const transferredCompanies = Object.keys(lexTransfers);
  const isLexTransferred = transferredCompanies.length > 0;
  const targetTransferred = lexTransfers[defaultTarget];
  const activeTransfer = targetTransferred || (isLexTransferred ? lexTransfers[transferredCompanies[0]] : null);
  const activeCompany = activeTransfer ? activeTransfer.company : defaultTarget;
  const providerLabel = activeTransfer && activeTransfer.provider === "buchhaltungsbutler"
    ? "BuchhaltungsButler"
    : (activeCompany === "thewire" ? "BuchhaltungsButler" : "Lexoffice");

  const isInvoiceBadge = res.isInvoice
    ? `<span class="badge bg-success-subtle text-success border border-success-subtle me-1">Rechnung</span>`
    : `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle me-1">Dokument</span>`;

  let lexStatusBadgeHtml = "";
  if (activeTransfer) {
    const dateStr = new Date(activeTransfer.transferredAt).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    lexStatusBadgeHtml = `
      <span class="badge bg-success text-white d-inline-flex align-items-center gap-1 p-1 px-2" style="font-weight: 500; font-size: 11.5px;">
        <span class="material-symbols-outlined" style="font-size: 14px;">check_circle</span>
        Übertragen an ${providerLabel} (${activeCompany}) am ${dateStr}
      </span>
    `;
  }

  const safeCompany = escapeHtml(res.company || "Unbekannt");
  const safeCategory = res.category ? escapeHtml(res.category) : "";
  const safeDocTitle = highlightQueryText(res.full || job.originalName || "Dokument", searchQuery);
  const safeDocDate = escapeHtml(formatDateDisplay(res.documentDate || job.uploadDate));
  const safeInvNum = res.invoiceNumber && res.invoiceNumber !== "none" ? highlightQueryText(res.invoiceNumber, searchQuery) : "";
  const safeAmt = amountFormatted ? escapeHtml(amountFormatted) : "";

  card.innerHTML = `
    <div class="card-body p-3">
      <div class="d-flex gap-3 align-items-start">
        <div class="flex-shrink-0">
          ${thumbnailHtml}
        </div>
        <div class="flex-grow-1" style="min-width: 0;">
          <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
            ${isInvoiceBadge}
            <span class="badge bg-primary-subtle text-primary border border-primary-subtle">${safeCompany}</span>
            ${safeCategory ? `<span class="badge bg-light text-dark border">${safeCategory}</span>` : ""}
            <span class="text-muted small"><span class="material-symbols-outlined align-text-top" style="font-size: 14px;">calendar_today</span> ${safeDocDate}</span>
          </div>
          <h6 class="mb-1 fw-bold text-dark text-truncate" style="font-size: 14.5px;">${safeDocTitle}</h6>
          <div class="small text-muted d-flex gap-3 flex-wrap align-items-center mt-1">
            ${safeInvNum ? `<span>Rechnungs-Nr: <strong>${safeInvNum}</strong></span>` : ""}
            ${safeAmt ? `<span class="text-success font-monospace">Betrag: <strong>${safeAmt}</strong></span>` : ""}
          </div>
          ${lexStatusBadgeHtml ? `<div class="lexoffice-status-area mt-2 small">${lexStatusBadgeHtml}</div>` : ""}
        </div>
      </div>

      <div class="border-top mt-2 pt-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="d-flex align-items-center gap-2">
          <span class="text-muted small" style="font-size: 12px; font-weight: 500;">ClickUp:</span>
          ${job.clickup && job.clickup.taskId
            ? `<a href="${job.clickup.taskUrl || `https://app.clickup.com/t/${encodeURIComponent(job.clickup.taskId)}`}" target="_blank" class="badge text-decoration-none" style="background: #7b68ee; color: white;">#${escapeHtml(job.clickup.taskId)} (${escapeHtml(job.clickup.status || 'offen')})</a>`
            : `<span class="badge bg-light text-secondary border">Nicht übertragen</span>`
          }
        </div>
        <button type="button" class="btn btn-sm btn-outline-secondary rechnung-clickup-btn d-flex align-items-center gap-1" data-job-id="${encodeURIComponent(job.id)}" style="border-radius: 20px; padding: 4px 12px; font-size: 12px; border-color: #7b68ee; color: #7b68ee;">
          <span class="material-symbols-outlined" style="font-size: 15px;">cloud_upload</span>
          <span>${job.clickup && job.clickup.taskId ? "ClickUp aktualisieren" : "Zu ClickUp"}</span>
        </button>
      </div>

      <div class="border-top mt-2 pt-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div class="d-flex align-items-center gap-2">
          <span class="text-muted small" style="font-size: 12px; font-weight: 500;">Buchhaltung:</span>
          ${activeTransfer
            ? `<span class="badge bg-success-subtle text-success border border-success-subtle d-inline-flex align-items-center gap-1"><span class="material-symbols-outlined" style="font-size: 13px;">check_circle</span> <span>✓ Übertragen am ${new Date(activeTransfer.transferredAt).toLocaleDateString("de-DE")}</span></span>`
            : `<span class="badge bg-light text-secondary border">Nicht übertragen</span>`
          }
        </div>
        <button type="button" class="btn btn-sm ${activeTransfer ? 'btn-outline-success' : 'btn-outline-primary'} rechnung-lex-btn d-flex align-items-center gap-1" data-job-id="${job.id}" style="border-radius: 20px; padding: 4px 12px; font-size: 12px;">
          <span class="material-symbols-outlined" style="font-size: 15px;">${activeTransfer ? 'check_circle' : 'sync'}</span>
          <span>${activeTransfer ? '✓ Synchronisiert' : 'In Buchhaltung'}</span>
        </button>
      </div>
    </div>
  `;

  return card;
}
