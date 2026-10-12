/**
 * ClickUp Integration Module (Single Transfer, Test Connection, Sync All Review Modal)
 */
import { escapeHtml, showToast, debugLog } from "./utils.js";
import { apiRequest } from "./api.js";
import { getAllClientCredentials, state, findJobInState } from "./state.js";
import { renderJobsList } from "./jobs.js";

let pendingClickupTransferJobId = null;
let pendingClickupTransferBtn = null;
let currentSyncPreviewData = null;
let currentSyncFilter = "all";
let selectedSyncJobIds = new Set();

const SYNC_RANGE_STORAGE_KEY = "clickup_sync_range";

export function initClickUpEvents() {
  const testClickUpBtn = document.getElementById("clickup-test-connection-btn");
  const clickupTestStatus = document.getElementById("clickup-test-status");

  // 1. Test Connection Button in Settings
  if (testClickUpBtn) {
    testClickUpBtn.addEventListener("click", async () => {
      const creds = getAllClientCredentials();
      const apiKey = creds.clickupApiKey;
      const listId = creds.clickupListId;

      if (!apiKey) {
        if (clickupTestStatus) clickupTestStatus.innerHTML = '<span style="color: #dc3545;">⚠️ Bitte geben Sie zuerst einen API-Key ein.</span>';
        showToast("Bitte geben Sie zuerst einen ClickUp API-Key ein.", "warning");
        return;
      }

      testClickUpBtn.disabled = true;
      testClickUpBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> Prüfe...`;
      if (clickupTestStatus) clickupTestStatus.innerHTML = '<span style="color: #666;">Verbindung zu ClickUp wird getestet...</span>';

      try {
        const data = await apiRequest("/api/clickup/verify", {
          method: "POST",
          body: JSON.stringify({ apiKey, listId }),
        });

        if (data.success) {
          if (clickupTestStatus) {
            clickupTestStatus.innerHTML = `
              <span style="color: #198754; font-weight: 500;">
                ✓ Erfolgreich verbunden! Liste: <strong>${escapeHtml(data.listName || listId)}</strong> (Space: ${escapeHtml(data.spaceName || '-')})
              </span>
            `;
          }
          showToast(`✓ ClickUp verbunden mit Liste "${data.listName || listId}"`, "success");
        } else {
          if (clickupTestStatus) {
            clickupTestStatus.innerHTML = `
              <span style="color: #dc3545;">
                ✗ Verbindung fehlgeschlagen: ${escapeHtml(data.error || "Unbekannter Fehler")}
              </span>
            `;
          }
          showToast("ClickUp Verbindung fehlgeschlagen: " + (data.error || "Unbekannter Fehler"), "error");
        }
      } catch (e) {
        if (clickupTestStatus) clickupTestStatus.innerHTML = `<span style="color: #dc3545;">✗ Netzwerkfehler: ${escapeHtml(e.message)}</span>`;
        showToast("Netzwerkfehler: " + e.message, "error");
      } finally {
        testClickUpBtn.disabled = false;
        testClickUpBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">sync_alt</span> Verbindung prüfen`;
      }
    });
  }

  // 2. Single ClickUp Re-Transfer Confirmation Modal
  const cancelClickupBtn = document.getElementById("cancel-clickup-transfer-btn");
  const closeClickupXBtn = document.getElementById("close-clickup-modal-x");
  const confirmClickupBtn = document.getElementById("confirm-clickup-transfer-btn");
  const confirmClickupModal = document.getElementById("confirm-clickup-modal");

  const hideClickupConfirmModal = () => {
    if (confirmClickupModal) confirmClickupModal.style.display = "none";
    if (pendingClickupTransferBtn) {
      pendingClickupTransferBtn.disabled = false;
      renderJobsList();
    }
    pendingClickupTransferJobId = null;
    pendingClickupTransferBtn = null;
  };

  if (cancelClickupBtn) cancelClickupBtn.addEventListener("click", hideClickupConfirmModal);
  if (closeClickupXBtn) closeClickupXBtn.addEventListener("click", hideClickupConfirmModal);
  if (confirmClickupModal) {
    confirmClickupModal.addEventListener("click", (e) => {
      if (e.target === confirmClickupModal) hideClickupConfirmModal();
    });
  }

  if (confirmClickupBtn) {
    confirmClickupBtn.addEventListener("click", async () => {
      hideClickupConfirmModal();
      if (pendingClickupTransferJobId) {
        const jobId = pendingClickupTransferJobId;
        const btn = pendingClickupTransferBtn;
        pendingClickupTransferJobId = null;
        pendingClickupTransferBtn = null;
        await executeClickupTransfer(jobId, true, btn);
      }
    });
  }

  // 3. ClickUp Sync All Review Modal
  const triggerSyncModalBtn = document.getElementById("clickup-trigger-sync-btn");
  const clickupSyncModal = document.getElementById("clickup-sync-modal");
  const closeSyncModalBtn = document.getElementById("close-clickup-sync-btn");
  const cancelSyncModalBtn = document.getElementById("cancel-clickup-sync-btn");
  const confirmSyncModalBtn = document.getElementById("confirm-clickup-sync-btn");

  const hideSyncModal = () => {
    if (clickupSyncModal) clickupSyncModal.style.display = "none";
  };

  if (closeSyncModalBtn) closeSyncModalBtn.addEventListener("click", hideSyncModal);
  if (cancelSyncModalBtn) cancelSyncModalBtn.addEventListener("click", hideSyncModal);
  if (clickupSyncModal) {
    clickupSyncModal.addEventListener("click", (e) => {
      if (e.target === clickupSyncModal) hideSyncModal();
    });
  }

  if (triggerSyncModalBtn) {
    triggerSyncModalBtn.addEventListener("click", openClickUpSyncModal);
  }

  // Sync Review Tabs
  ["all", "create", "update", "uptodate", "skip"].forEach((tabKey) => {
    const tabBtn = document.getElementById(`clickup-tab-${tabKey}`);
    if (tabBtn) {
      tabBtn.addEventListener("click", () => {
        ["all", "create", "update", "uptodate", "skip"].forEach((k) => {
          const b = document.getElementById(`clickup-tab-${k}`);
          if (b) b.classList.remove("active");
        });
        tabBtn.classList.add("active");
        currentSyncFilter = tabKey;
        renderSyncPreviewItems();
      });
    }
  });

  // Time range controls
  const rangeSelect = document.getElementById("clickup-sync-range");
  const dateFromInput = document.getElementById("clickup-sync-date-from");
  const dateToInput = document.getElementById("clickup-sync-date-to");
  const reloadBtn = document.getElementById("clickup-sync-reload-btn");

  if (rangeSelect) {
    rangeSelect.addEventListener("change", () => {
      try {
        localStorage.setItem(SYNC_RANGE_STORAGE_KEY, rangeSelect.value);
      } catch (e) {}
      if (rangeSelect.value !== "custom") {
        applySyncRangePreset(rangeSelect.value);
        loadSyncPreview();
      }
    });
  }
  [dateFromInput, dateToInput].forEach((input) => {
    if (!input) return;
    input.addEventListener("change", () => {
      if (rangeSelect) rangeSelect.value = "custom";
    });
  });
  if (reloadBtn) reloadBtn.addEventListener("click", loadSyncPreview);

  // Item selection (checkboxes)
  const syncItemsList = document.getElementById("clickup-sync-items-list");
  if (syncItemsList) {
    syncItemsList.addEventListener("change", (e) => {
      const cb = e.target.closest(".clickup-sync-item-cb");
      if (!cb) return;
      const jobId = cb.getAttribute("data-job-id");
      if (cb.checked) selectedSyncJobIds.add(jobId);
      else selectedSyncJobIds.delete(jobId);
      const row = cb.closest(".clickup-sync-row");
      if (row) {
        row.classList.toggle("is-off", !cb.checked);
      }
      updateSyncSelectionUi();
    });
  }

  const selectAllCb = document.getElementById("clickup-sync-select-all");
  if (selectAllCb) {
    selectAllCb.addEventListener("change", () => {
      getVisibleSelectableItems().forEach((item) => {
        if (selectAllCb.checked) selectedSyncJobIds.add(item.jobId);
        else selectedSyncJobIds.delete(item.jobId);
      });
      renderSyncPreviewItems();
    });
  }

  // Start Batch Sync Button
  if (confirmSyncModalBtn) {
    confirmSyncModalBtn.addEventListener("click", async () => {
      if (!currentSyncPreviewData) return;
      const { toCreate = [], toUpdate = [] } = currentSyncPreviewData;
      const allTasksToProcess = [
        ...toCreate.map((t) => ({ ...t, isUpdate: false })),
        ...toUpdate.map((t) => ({ ...t, isUpdate: true })),
      ].filter((t) => selectedSyncJobIds.has(t.jobId));

      if (allTasksToProcess.length === 0) return;

      confirmSyncModalBtn.disabled = true;
      if (cancelSyncModalBtn) cancelSyncModalBtn.disabled = true;

      const progressContainer = document.getElementById("clickup-sync-progress-container");
      const progressBar = document.getElementById("clickup-sync-progress-bar");
      const progressText = document.getElementById("clickup-sync-progress-text");
      const progressPercent = document.getElementById("clickup-sync-progress-percent");

      if (progressContainer) progressContainer.style.display = "block";

      const creds = getAllClientCredentials();
      let completedCount = 0;
      const total = allTasksToProcess.length;

      for (const item of allTasksToProcess) {
        if (progressText) progressText.innerText = `Übertrage (${completedCount + 1}/${total}): ${item.fileName || item.suggestedTaskName}...`;
        const pct = Math.round((completedCount / total) * 100);
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressPercent) progressPercent.innerText = `${pct}%`;

        try {
          await apiRequest("/api/clickup/transfer", {
            method: "POST",
            body: JSON.stringify({
              jobId: item.jobId || item.id,
              force: true,
              apiKey: creds.clickupApiKey,
              listId: creds.clickupListId,
            }),
          });
        } catch (e) {
          debugLog("CLICKUP", `Fehler bei Übertragung von ${item.fileName}:`, e);
        }

        completedCount++;
      }

      if (progressBar) progressBar.style.width = "100%";
      if (progressPercent) progressPercent.innerText = "100%";
      if (progressText) progressText.innerText = `Fertig! ${completedCount} Belege erfolgreich synchronisiert.`;

      showToast(`✓ ${completedCount} Belege erfolgreich mit ClickUp synchronisiert!`, "success");
      setTimeout(() => {
        hideSyncModal();
        if (window.loadRechnungenView) window.loadRechnungenView();
      }, 1200);
    });
  }
}

export async function openClickUpSyncModal() {
  if (!state.isAdmin) {
    showToast("ClickUp-Synchronisation ist nur für Administratoren verfügbar.", "warning");
    return;
  }
  const clickupSyncModal = document.getElementById("clickup-sync-modal");
  if (!clickupSyncModal) return;

  const rangeSelect = document.getElementById("clickup-sync-range");
  if (rangeSelect) {
    let savedRange = null;
    try {
      savedRange = localStorage.getItem(SYNC_RANGE_STORAGE_KEY);
    } catch (e) {}
    if (savedRange && savedRange !== "custom" && rangeSelect.querySelector(`option[value="${savedRange}"]`)) {
      rangeSelect.value = savedRange;
    }
    if (rangeSelect.value !== "custom") applySyncRangePreset(rangeSelect.value);
  }

  clickupSyncModal.style.display = "flex";
  await loadSyncPreview();
}

function toIsoDateLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function applySyncRangePreset(preset) {
  const fromInput = document.getElementById("clickup-sync-date-from");
  const toInput = document.getElementById("clickup-sync-date-to");
  if (!fromInput || !toInput) return;

  const today = new Date();
  if (preset === "all") {
    fromInput.value = "";
    toInput.value = "";
    return;
  }
  let from;
  if (preset === "year") {
    from = new Date(today.getFullYear(), 0, 1);
  } else {
    const days = parseInt(preset, 10) || 30;
    from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  }
  fromInput.value = toIsoDateLocal(from);
  toInput.value = toIsoDateLocal(today);
}

async function loadSyncPreview() {
  const syncItemsList = document.getElementById("clickup-sync-items-list");
  const syncProgressContainer = document.getElementById("clickup-sync-progress-container");
  const reloadBtn = document.getElementById("clickup-sync-reload-btn");
  if (!syncItemsList) return;

  currentSyncPreviewData = null;
  selectedSyncJobIds = new Set();
  updateSyncSelectionUi();
  syncItemsList.innerHTML = '<div style="text-align: center; color: #888; padding: 30px;"><div class="spinner-border spinner-border-sm text-primary mb-2" role="status"></div><br>Lade Sync-Vorschau aus ClickUp...</div>';
  if (syncProgressContainer) syncProgressContainer.style.display = "none";
  if (reloadBtn) reloadBtn.disabled = true;
  const cancelSyncModalBtn = document.getElementById("cancel-clickup-sync-btn");
  if (cancelSyncModalBtn) cancelSyncModalBtn.disabled = false;

  try {
    const creds = getAllClientCredentials();
    if (!creds.clickupApiKey) {
      syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Kein ClickUp API-Key hinterlegt. Bitte hinterlege deinen API-Key in den Einstellungen.</div>`;
      return;
    }

    const dateFrom = document.getElementById("clickup-sync-date-from")?.value || "";
    const dateTo = document.getElementById("clickup-sync-date-to")?.value || "";
    if (dateFrom && dateTo && dateFrom > dateTo) {
      syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Das Startdatum liegt nach dem Enddatum.</div>`;
      return;
    }

    const filterPrivate = localStorage.getItem("clickup_filter_private") !== "false";
    const data = await apiRequest("/api/clickup/sync-preview", {
      method: "POST",
      body: JSON.stringify({
        apiKey: creds.clickupApiKey,
        listId: creds.clickupListId,
        filterPrivate,
        dateFrom,
        dateTo,
      }),
    });

    if (data.success) {
      currentSyncPreviewData = data;
      currentSyncFilter = "all";
      ["all", "create", "update", "uptodate", "skip"].forEach((k) => {
        document.getElementById(`clickup-tab-${k}`)?.classList.toggle("active", k === "all");
      });
      selectedSyncJobIds = new Set([...data.toCreate, ...data.toUpdate].map((item) => item.jobId));
      renderSyncPreviewItems();
    } else {
      syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Fehler beim Laden der Vorschau: ${escapeHtml(data.error || "Unbekannt")}</div>`;
    }
  } catch (e) {
    syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Netzwerkfehler: ${escapeHtml(e.message)}</div>`;
  } finally {
    if (reloadBtn) reloadBtn.disabled = false;
  }
}

function getVisibleSelectableItems() {
  if (!currentSyncPreviewData) return [];
  const { toCreate = [], toUpdate = [] } = currentSyncPreviewData;
  const items = [];
  if (currentSyncFilter === "all" || currentSyncFilter === "create") items.push(...toCreate);
  if (currentSyncFilter === "all" || currentSyncFilter === "update") items.push(...toUpdate);
  return items;
}

function updateSyncSelectionUi() {
  const countEl = document.getElementById("clickup-sync-selection-count");
  const selectAllCb = document.getElementById("clickup-sync-select-all");
  const confirmBtn = document.getElementById("confirm-clickup-sync-btn");
  const confirmLabel = document.getElementById("confirm-clickup-sync-label");

  const selectable = currentSyncPreviewData
    ? [...(currentSyncPreviewData.toCreate || []), ...(currentSyncPreviewData.toUpdate || [])]
    : [];
  const selectedCount = selectable.filter((item) => selectedSyncJobIds.has(item.jobId)).length;

  if (countEl) countEl.innerText = `${selectedCount} von ${selectable.length} ausgewählt`;
  if (confirmBtn) confirmBtn.disabled = selectedCount === 0;
  if (confirmLabel) {
    confirmLabel.innerText = selectedCount > 0 ? `${selectedCount} Beleg(e) synchronisieren` : "Synchronisation starten";
  }

  if (selectAllCb) {
    const visible = getVisibleSelectableItems();
    const visibleSelected = visible.filter((item) => selectedSyncJobIds.has(item.jobId)).length;
    selectAllCb.disabled = visible.length === 0;
    selectAllCb.checked = visible.length > 0 && visibleSelected === visible.length;
    selectAllCb.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
  }
}

function formatSyncItemDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("de-DE");
}

function renderSyncPreviewItems() {
  const countCreateSpan = document.getElementById("clickup-count-create");
  const countUpdateSpan = document.getElementById("clickup-count-update");
  const countUptodateSpan = document.getElementById("clickup-count-uptodate");
  const countSkipSpan = document.getElementById("clickup-count-skip");
  const syncItemsList = document.getElementById("clickup-sync-items-list");

  if (!currentSyncPreviewData || !syncItemsList) return;
  const { toCreate = [], toUpdate = [], upToDate = [], toSkip = [] } = currentSyncPreviewData;

  if (countCreateSpan) countCreateSpan.innerText = toCreate.length;
  if (countUpdateSpan) countUpdateSpan.innerText = toUpdate.length;
  if (countUptodateSpan) countUptodateSpan.innerText = upToDate.length;
  if (countSkipSpan) countSkipSpan.innerText = toSkip.length;

  let itemsToRender = [];
  if (currentSyncFilter === "all" || currentSyncFilter === "create") {
    toCreate.forEach((item) => itemsToRender.push({ ...item, type: "create" }));
  }
  if (currentSyncFilter === "all" || currentSyncFilter === "update") {
    toUpdate.forEach((item) => itemsToRender.push({ ...item, type: "update" }));
  }
  if (currentSyncFilter === "all" || currentSyncFilter === "uptodate") {
    upToDate.forEach((item) => itemsToRender.push({ ...item, type: "uptodate" }));
  }
  if (currentSyncFilter === "all" || currentSyncFilter === "skip") {
    toSkip.forEach((item) => itemsToRender.push({ ...item, type: "skip" }));
  }

  updateSyncSelectionUi();

  if (itemsToRender.length === 0) {
    syncItemsList.innerHTML = '<div class="cus-empty">Keine Dokumente für diesen Filter bzw. Zeitraum gefunden.</div>';
    return;
  }

  const badges = {
    create: ["cus-badge-create", "Neu"],
    update: ["cus-badge-update", "Update"],
    uptodate: ["cus-badge-uptodate", "Aktuell"],
    skip: ["cus-badge-skip", "Privat"],
  };

  let html = "";
  itemsToRender.forEach((item) => {
    const safeFileName = escapeHtml(item.fileName || "-");
    const safeCompany = escapeHtml(item.company || "Unbekannt");
    const safeAmount = item.amount ? escapeHtml(item.amount) : "";
    const safeJobId = escapeHtml(item.jobId || "");
    const uploadDateStr = escapeHtml(formatSyncItemDate(item.uploadDate));
    const isSelectable = item.type === "create" || item.type === "update";
    const isSelected = isSelectable && selectedSyncJobIds.has(item.jobId);
    const [badgeClass, badgeLabel] = badges[item.type];

    let tooltip = safeFileName;
    if (item.type === "create") tooltip += ` → Neuer Task: ${escapeHtml(item.suggestedTaskName || item.fileName || "-")}`;
    else if (item.type === "skip") tooltip += ` → ${escapeHtml(item.reason || "Privat")}`;
    else if (item.existingTaskId) tooltip += ` → Task #${escapeHtml(item.existingTaskId)} (${escapeHtml(item.existingTaskName || "")}) [${escapeHtml(item.existingTaskStatus || "offen")}]`;

    const taskHtml = item.existingTaskId
      ? `<a href="${item.existingTaskUrl ? encodeURI(item.existingTaskUrl) : "#"}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${escapeHtml(item.existingTaskId)}</a>`
      : "";
    const checkboxHtml = isSelectable
      ? `<input type="checkbox" class="clickup-sync-item-cb" data-job-id="${safeJobId}" ${isSelected ? "checked" : ""} />`
      : `<span class="cus-cb-placeholder"></span>`;
    const rowTag = isSelectable ? "label" : "div";
    const rowClass = `clickup-sync-row cus-row${isSelectable && !isSelected ? " is-off" : ""}${isSelectable ? "" : " is-readonly"}`;

    html += `<${rowTag} class="${rowClass}" title="${tooltip}">
        ${checkboxHtml}
        <span class="cus-badge ${badgeClass}">${badgeLabel}</span>
        <span class="cus-name">${safeFileName}</span>
        <span class="cus-meta cus-date">${uploadDateStr}</span>
        <span class="cus-meta cus-company">${safeCompany}</span>
        <span class="cus-meta cus-amount">${safeAmount}</span>
        <span class="cus-meta cus-task">${taskHtml}</span>
      </${rowTag}>`;
  });

  syncItemsList.innerHTML = html;
}

export async function transferJobToClickUp(jobId, force = false, btn = null) {
  if (!state.isAdmin) {
    showToast("ClickUp-Synchronisation ist nur für Administratoren verfügbar.", "warning");
    return;
  }

  if (force) {
    return await executeClickupTransfer(jobId, true, btn);
  }

  let targetJob = findJobInState(jobId);
  if (!targetJob) {
    try {
      const data = await apiRequest(`/api/status?ids=${encodeURIComponent(jobId)}`);
      if (data.statuses && data.statuses.length > 0) {
        targetJob = data.statuses[0];
      }
    } catch (e) {}
  }

  if (!targetJob) {
    showToast("Dokument nicht gefunden.", "error");
    return;
  }

  const res = targetJob.result || {};
  const isAlreadyTransferred = !!(targetJob.clickup && targetJob.clickup.taskId);
  const taskId = targetJob.clickup?.taskId;
  const taskUrl = targetJob.clickup?.taskUrl || (taskId ? `https://app.clickup.com/t/${taskId}` : "");

  pendingClickupTransferJobId = targetJob.id || jobId;
  pendingClickupTransferBtn = btn;

  // 1. Set Title & Button text
  const modalTitle = document.getElementById("confirm-clickup-modal-title");
  const btnText = document.getElementById("confirm-clickup-btn-text");
  if (modalTitle) {
    modalTitle.innerText = isAlreadyTransferred ? "ClickUp Task aktualisieren" : "ClickUp Task erstellen";
  }
  if (btnText) {
    btnText.innerText = isAlreadyTransferred ? "Task aktualisieren" : "Task in ClickUp erstellen";
  }

  // 2. Thumbnail
  const thumbEl = document.getElementById("clickup-modal-thumb");
  if (thumbEl) {
    const thumbUrl = `/api/thumbnail/${targetJob.id}?v=${targetJob.aiPipelineCompletedAt || targetJob.uploadDate || 1}`;
    thumbEl.innerHTML = `<img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML='<span class=\\'material-symbols-outlined text-muted\\'>description</span>'">`;
  }

  // 3. Document details
  const docTitle = document.getElementById("confirm-clickup-doc-title");
  const docDate = document.getElementById("confirm-clickup-doc-date");
  const docComp = document.getElementById("confirm-clickup-doc-company");
  const docCat = document.getElementById("confirm-clickup-doc-category");
  const docInv = document.getElementById("confirm-clickup-doc-inv");
  const docAmt = document.getElementById("confirm-clickup-doc-amt");

  const rawClickupDate = res.documentDate || targetJob.documentDate;
  const clickupDateDisplay = (rawClickupDate && rawClickupDate !== "unknown" && rawClickupDate !== "none" && rawClickupDate !== "-")
    ? rawClickupDate
    : (targetJob.uploadDate ? formatDateDisplay(targetJob.uploadDate) : "-");
  if (docDate) docDate.innerText = `📅 ${clickupDateDisplay}`;
  if (docComp) docComp.innerText = `🏢 ${res.company || "Unbekannt"}`;
  if (docCat) docCat.innerText = `📁 ${res.category || "-"}`;
  if (docInv) docInv.innerText = `Rechnung: ${res.invoiceNumber && res.invoiceNumber !== "none" ? res.invoiceNumber : "-"}`;
  if (docAmt) {
    const amtStr = res.invoiceAmmount ? `${(res.invoiceAmmount / 100).toFixed(2).replace(".", ",")} €` : "";
    docAmt.innerText = amtStr ? `Betrag: ${amtStr}` : "";
  }

  // 4. Task Name Preview
  const taskPreview = document.getElementById("confirm-clickup-task-preview");
  const cat = res.category || "Dokument";
  const desc = Array.isArray(res.tags) && res.tags.length > 0 && res.tags[0] !== "none"
    ? res.tags.slice(0, 3).join(" ")
    : "Dokument";
  const suggestedTaskName = `(${cat}) ${desc}`;
  if (taskPreview) taskPreview.innerText = suggestedTaskName;

  // 5. Explanatory text & link
  const textEl = document.getElementById("confirm-clickup-text");
  if (textEl) {
    textEl.innerText = isAlreadyTransferred
      ? `Dieses Dokument wurde bereits übertragen (Task #${taskId}). Möchtest du die Metadaten in ClickUp aktualisieren?`
      : `Möchtest du dieses Dokument jetzt als Aufgabe in die konfigurierte ClickUp-Liste übertragen?`;
  }

  const linkContainer = document.getElementById("confirm-clickup-link-container");
  const taskLink = document.getElementById("confirm-clickup-task-link");
  const taskIdBadge = document.getElementById("confirm-clickup-task-id-badge");

  if (linkContainer && taskLink) {
    if (isAlreadyTransferred && (taskId || taskUrl)) {
      linkContainer.style.display = "block";
      taskLink.href = taskUrl || `https://app.clickup.com/t/${taskId}`;
      if (taskIdBadge) taskIdBadge.innerText = `#${taskId || ""}`;
    } else {
      linkContainer.style.display = "none";
    }
  }

  // 6. Show Modal
  const confirmModal = document.getElementById("confirm-clickup-modal");
  if (confirmModal) confirmModal.style.display = "flex";
}

async function executeClickupTransfer(jobId, force = true, btn = null) {
  const originalBtnHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" style="width: 12px; height: 12px;"></span> <span>Sende...</span>`;
  }

  try {
    const creds = getAllClientCredentials();
    const data = await apiRequest("/api/clickup/transfer", {
      method: "POST",
      body: JSON.stringify({
        jobId,
        force: true,
        apiKey: creds.clickupApiKey || "",
        listId: creds.clickupListId || "",
      }),
    });

    if (data.success) {
      const targetJob = findJobInState(jobId);
      if (targetJob) {
        targetJob.clickup = data.clickup;
      }
      showToast("✓ Erfolgreich zu ClickUp übertragen!", "success");
      renderJobsList();
      if (window.loadRechnungenView) window.loadRechnungenView();
    } else {
      showToast("ClickUp Übertragung fehlgeschlagen: " + (data.error || "Unbekannter Fehler"), "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
      }
    }
  } catch (err) {
    showToast("Fehler bei ClickUp-Übertragung: " + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnHtml;
    }
  }
}
