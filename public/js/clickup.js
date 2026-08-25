/**
 * ClickUp Integration Module (Single Transfer, Test Connection, Sync All Review Modal)
 */
import { escapeHtml, showToast, debugLog } from "./utils.js";
import { apiRequest } from "./api.js";
import { getAllClientCredentials, state } from "./state.js";
import { renderJobsList } from "./jobs.js";

let pendingClickupTransferJobId = null;
let pendingClickupTransferBtn = null;
let currentSyncPreviewData = null;
let currentSyncFilter = "all";

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
          if (b) b.classList.remove("active", "btn-primary", "btn-success", "btn-info", "btn-secondary", "btn-warning");
        });
        tabBtn.classList.add("active");
        currentSyncFilter = tabKey;
        renderSyncPreviewItems();
      });
    }
  });

  // Start Batch Sync Button
  if (confirmSyncModalBtn) {
    confirmSyncModalBtn.addEventListener("click", async () => {
      if (!currentSyncPreviewData) return;
      const { toCreate = [], toUpdate = [] } = currentSyncPreviewData;
      const allTasksToProcess = [
        ...toCreate.map((t) => ({ ...t, isUpdate: false })),
        ...toUpdate.map((t) => ({ ...t, isUpdate: true })),
      ];

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
  const clickupSyncModal = document.getElementById("clickup-sync-modal");
  const syncItemsList = document.getElementById("clickup-sync-items-list");
  const confirmSyncModalBtn = document.getElementById("confirm-clickup-sync-btn");
  const syncProgressContainer = document.getElementById("clickup-sync-progress-container");

  if (!clickupSyncModal || !syncItemsList) return;

  clickupSyncModal.style.display = "flex";
  syncItemsList.innerHTML = '<div style="text-align: center; color: #888; padding: 30px;"><div class="spinner-border spinner-border-sm text-primary mb-2" role="status"></div><br>Lade Sync-Vorschau aus ClickUp...</div>';
  if (confirmSyncModalBtn) confirmSyncModalBtn.disabled = true;
  if (syncProgressContainer) syncProgressContainer.style.display = "none";

  try {
    const creds = getAllClientCredentials();
    if (!creds.clickupApiKey) {
      syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Kein ClickUp API-Key hinterlegt. Bitte hinterlege deinen API-Key in den Einstellungen.</div>`;
      return;
    }

    const filterPrivate = localStorage.getItem("clickup_filter_private") !== "false";
    const data = await apiRequest("/api/clickup/sync-preview", {
      method: "POST",
      body: JSON.stringify({
        apiKey: creds.clickupApiKey,
        listId: creds.clickupListId,
        filterPrivate,
      }),
    });

    if (data.success) {
      currentSyncPreviewData = data;
      currentSyncFilter = "all";
      renderSyncPreviewItems();
      if (confirmSyncModalBtn) {
        confirmSyncModalBtn.disabled = (data.toCreate.length === 0 && data.toUpdate.length === 0);
      }
    } else {
      syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Fehler beim Laden der Vorschau: ${escapeHtml(data.error || "Unbekannt")}</div>`;
    }
  } catch (e) {
    syncItemsList.innerHTML = `<div style="color: #dc3545; padding: 20px; text-align: center;">Netzwerkfehler: ${escapeHtml(e.message)}</div>`;
  }
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

  if (itemsToRender.length === 0) {
    syncItemsList.innerHTML = '<div style="text-align: center; color: #888; padding: 30px;">Keine Dokumente für diesen Filter gefunden.</div>';
    return;
  }

  let html = "";
  itemsToRender.forEach((item) => {
    let badgeHtml = "";
    let actionInfoHtml = "";

    const safeFileName = escapeHtml(item.fileName || "-");
    const safeCompany = escapeHtml(item.company || "Unbekannt");
    const safeCategory = escapeHtml(item.category || "-");
    const safeAmount = item.amount ? escapeHtml(item.amount) : "";
    const safeTaskName = escapeHtml(item.suggestedTaskName || item.fileName || "-");
    const safeExistingTaskId = escapeHtml(item.existingTaskId || "");
    const safeExistingTaskName = escapeHtml(item.existingTaskName || "");
    const safeExistingTaskUrl = item.existingTaskUrl ? encodeURI(item.existingTaskUrl) : "#";
    const safeStatus = escapeHtml(item.existingTaskStatus || "offen");
    const safeReason = escapeHtml(item.reason || "Privat");

    if (item.type === "create") {
      badgeHtml = `<span style="background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">+ Neu anlegen</span>`;
      actionInfoHtml = `<span style="color: #666; font-size: 12px;">Vorgeschlagener Task: <strong>${safeTaskName}</strong></span>`;
    } else if (item.type === "update") {
      badgeHtml = `<span style="background: #e3f2fd; color: #1565c0; border: 1px solid #bbdefb; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">↻ Aktualisieren</span>`;
      actionInfoHtml = `<span style="color: #666; font-size: 12px;">Aktualisiert Task: <a href="${safeExistingTaskUrl}" target="_blank" style="color: #1976d2; font-weight: 500;">#${safeExistingTaskId} (${safeExistingTaskName})</a></span>`;
    } else if (item.type === "uptodate") {
      badgeHtml = `<span style="background: #f3e5f5; color: #7b1fa2; border: 1px solid #e1bee7; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">✓ Bereits aktuell</span>`;
      actionInfoHtml = `<span style="color: #7b1fa2; font-size: 12px;">Task ist synchron: <a href="${safeExistingTaskUrl}" target="_blank" style="color: #7b1fa2; font-weight: 500;">#${safeExistingTaskId} (${safeExistingTaskName})</a> <span style="color: #888;">[Status: ${safeStatus}]</span></span>`;
    } else if (item.type === "skip") {
      badgeHtml = `<span style="background: #fff3e0; color: #e65100; border: 1px solid #ffe0b2; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">⊘ Überspringen</span>`;
      actionInfoHtml = `<span style="color: #e65100; font-size: 12px;">${safeReason}</span>`;
    }

    html += `
      <div style="background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px 12px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px; flex-wrap: wrap;">
            ${badgeHtml}
            <span style="font-weight: 600; font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeFileName}">${safeFileName}</span>
          </div>
          <div style="display: flex; gap: 12px; font-size: 12px; color: #777; flex-wrap: wrap; margin-top: 2px;">
            <span>🏢 ${safeCompany}</span>
            <span>📁 ${safeCategory}</span>
            ${safeAmount ? `<span style="color: #2e7d32; font-weight: 500;">💰 ${safeAmount}</span>` : ''}
          </div>
          <div style="margin-top: 4px;">
            ${actionInfoHtml}
          </div>
        </div>
      </div>
    `;
  });

  syncItemsList.innerHTML = html;
}

export async function transferJobToClickUp(jobId, force = false, btn = null) {
  await executeClickupTransfer(jobId, force, btn);
}

async function executeClickupTransfer(jobId, force = false, btn = null) {
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
        force,
        apiKey: creds.clickupApiKey || "",
        listId: creds.clickupListId || "",
      }),
    });

    if (data.alreadyTransferred && !force) {
      pendingClickupTransferJobId = jobId;
      pendingClickupTransferBtn = btn;
      const targetJob = state.jobs.find((j) => j.id === jobId);
      const cu = data.clickup || targetJob?.clickup;
      const taskId = cu?.taskId;
      const taskUrl = cu?.taskUrl || (taskId ? `https://app.clickup.com/t/${taskId}` : "");

      const textEl = document.getElementById("confirm-clickup-text");
      if (textEl) {
        textEl.innerText = data.error || "Dieses Dokument wurde bereits an ClickUp übertragen. Möchtest du es aktualisieren?";
      }

      const linkContainer = document.getElementById("confirm-clickup-link-container");
      const taskLink = document.getElementById("confirm-clickup-task-link");
      const taskIdBadge = document.getElementById("confirm-clickup-task-id-badge");

      if (linkContainer && taskLink) {
        if (taskId || taskUrl) {
          linkContainer.style.display = "block";
          taskLink.href = taskUrl || `https://app.clickup.com/t/${taskId}`;
          if (taskIdBadge) taskIdBadge.innerText = `#${taskId || ""}`;
        } else {
          linkContainer.style.display = "none";
        }
      }

      const confirmModal = document.getElementById("confirm-clickup-modal");
      if (confirmModal) confirmModal.style.display = "flex";

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalBtnHtml;
      }
      return;
    }

    if (data.success) {
      const targetJob = state.jobs.find((j) => j.id === jobId);
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
