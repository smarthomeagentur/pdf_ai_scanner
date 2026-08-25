/**
 * Google Drive Sync & Background Import Module
 */
import { escapeHtml, formatFileSize, formatDateDisplay, showToast, debugLog } from "./utils.js";
import { apiRequest } from "./api.js";

let syncDataCache = null;
let currentFilter = "all";

export async function openDriveSyncModal() {
  if (!state.isAdmin) {
    showToast("Google Drive Synchronisation ist nur für Administratoren verfügbar.", "warning");
    return;
  }
  debugLog("DRIVE_SYNC", "Opening Google Drive Sync Modal...");
  const modalEl = document.getElementById("drive-sync-modal");
  const loadingEl = document.getElementById("drive-sync-loading");
  const listEl = document.getElementById("drive-sync-list");

  if (!modalEl) {
    console.error("[DRIVE_SYNC] Modal element #drive-sync-modal not found!");
    return;
  }

  modalEl.style.display = "flex";
  if (loadingEl) loadingEl.style.display = "block";
  if (listEl) listEl.style.display = "none";

  try {
    const data = await apiRequest("/api/drive/sync-preview");
    debugLog("DRIVE_SYNC", "Received sync preview data:", {
      toImport: data?.toImport?.length || 0,
      needsEnrichment: data?.needsEnrichment?.length || 0,
      existingComplete: data?.existingComplete?.length || 0,
      skipped: data?.skipped?.length || 0,
    });

    syncDataCache = data;
    renderDriveSyncModal(data);
  } catch (err) {
    debugLog("DRIVE_SYNC", "Error fetching sync preview:", err);
    if (loadingEl) {
      loadingEl.innerHTML = `<div class="p-4 text-danger"><span class="material-symbols-outlined d-block fs-2 mb-2">error</span>Fehler beim Laden der Google Drive Dateien: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderDriveSyncModal(data) {
  const loadingEl = document.getElementById("drive-sync-loading");
  const listEl = document.getElementById("drive-sync-list");

  const toImport = data.toImport || [];
  const needsEnrichment = data.needsEnrichment || [];
  const existingComplete = data.existingComplete || [];
  const skipped = data.skipped || [];
  const total = toImport.length + needsEnrichment.length + existingComplete.length + skipped.length;

  // Populate Pill Counters
  const setCounter = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };
  setCounter("drive-count-new", toImport.length);
  setCounter("drive-count-enrich", needsEnrichment.length);
  setCounter("drive-count-existing", existingComplete.length);
  setCounter("drive-count-total", total);
  setCounter("drive-count-skipped", skipped.length);

  if (loadingEl) loadingEl.style.display = "none";
  if (listEl) {
    listEl.style.display = "block";
    renderFilteredItems();
  }
}

function renderFilteredItems() {
  const listEl = document.getElementById("drive-sync-list");
  if (!listEl || !syncDataCache) return;

  const toImport = syncDataCache.toImport || [];
  const needsEnrichment = syncDataCache.needsEnrichment || [];
  const existingComplete = syncDataCache.existingComplete || [];
  const skipped = syncDataCache.skipped || [];

  let itemsToDisplay = [];
  if (currentFilter === "all") {
    itemsToDisplay = [
      ...toImport.map((i) => ({ ...i, type: "new", checked: true })),
      ...needsEnrichment.map((i) => ({ ...i, type: "enrich", checked: true })),
      ...existingComplete.map((i) => ({ ...i, type: "complete", checked: false })),
      ...skipped.map((i) => ({ ...i, type: "skipped", checked: false })),
    ];
  } else if (currentFilter === "new") {
    itemsToDisplay = toImport.map((i) => ({ ...i, type: "new", checked: true }));
  } else if (currentFilter === "enrich") {
    itemsToDisplay = needsEnrichment.map((i) => ({ ...i, type: "enrich", checked: true }));
  } else if (currentFilter === "complete") {
    itemsToDisplay = existingComplete.map((i) => ({ ...i, type: "complete", checked: false }));
  } else if (currentFilter === "skipped") {
    itemsToDisplay = skipped.map((i) => ({ ...i, type: "skipped", checked: false }));
  }

  if (itemsToDisplay.length === 0) {
    listEl.innerHTML = `<div class="p-4 text-center text-muted">Keine Belege in diesem Filter.</div>`;
    return;
  }

  listEl.innerHTML = `
    <div class="list-group list-group-flush">
      ${itemsToDisplay
        .map((f) => {
          const badge =
            f.type === "new"
              ? `<span class="badge bg-success">Neu</span>`
              : f.type === "enrich"
              ? `<span class="badge bg-warning text-dark">Metadaten fehlen</span>`
              : f.type === "complete"
              ? `<span class="badge bg-primary">Vollständig</span>`
              : `<span class="badge bg-secondary">${escapeHtml(f.reason || "Ausgeblendet")}</span>`;

          const isActionable = f.type === "new" || f.type === "enrich";

          return `
          <div class="list-group-item d-flex justify-content-between align-items-center p-2 px-3">
            <div class="d-flex align-items-center gap-2" style="min-width: 0;">
              <input class="form-check-input sync-item-checkbox" type="checkbox" value="${f.id}" data-name="${escapeHtml(f.name)}" ${f.checked ? "checked" : ""} ${!isActionable ? "disabled" : ""} />
              <div class="text-truncate" style="max-width: 420px;">
                <strong class="text-dark d-block text-truncate" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</strong>
                <div class="small text-muted">${formatDateDisplay(f.createdTime)} &bull; ${formatFileSize(f.size)}</div>
              </div>
            </div>
            <div class="d-flex align-items-center gap-2">
              ${badge}
              ${f.webViewLink ? `<a href="${f.webViewLink}" target="_blank" class="btn btn-sm btn-outline-secondary p-1" title="In Drive öffnen"><span class="material-symbols-outlined" style="font-size: 16px;">open_in_new</span></a>` : ""}
            </div>
          </div>`;
        })
        .join("")}
    </div>`;
}

export function initDriveSyncEvents() {
  document.getElementById("openDriveSyncBtn")?.addEventListener("click", openDriveSyncModal);

  const closeDriveSync = () => {
    const modal = document.getElementById("drive-sync-modal");
    if (modal) modal.style.display = "none";
  };

  document.getElementById("drive-sync-close-x-btn")?.addEventListener("click", closeDriveSync);
  document.getElementById("drive-sync-close-btn")?.addEventListener("click", closeDriveSync);

  // Filter tab buttons
  document.querySelectorAll(".drive-filter-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".drive-filter-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.getAttribute("data-filter") || "all";
      renderFilteredItems();
    });
  });

  // Select all checkbox
  document.getElementById("drive-sync-select-all")?.addEventListener("change", (e) => {
    const checked = e.target.checked;
    document.querySelectorAll(".sync-item-checkbox:not(:disabled)").forEach((cb) => {
      cb.checked = checked;
    });
  });

  // Submit sync button
  document.getElementById("drive-sync-submit-btn")?.addEventListener("click", async () => {
    const checkedBoxes = Array.from(document.querySelectorAll(".sync-item-checkbox:checked"));
    const selected = checkedBoxes.map((cb) => ({
      id: cb.value,
      name: cb.getAttribute("data-name"),
    }));

    if (selected.length === 0) {
      showToast("Keine Dateien ausgewählt.", "warning");
      return;
    }

    debugLog("DRIVE_SYNC", `Starting sync execution for ${selected.length} items...`, selected);
    try {
      const res = await apiRequest("/api/drive/sync-execute", {
        method: "POST",
        body: JSON.stringify({ items: selected }),
      });
      debugLog("DRIVE_SYNC", "Sync execution started response:", res);
      showToast(`Hintergrund-Synchronisation von ${selected.length} Dateien gestartet!`, "success");
      closeDriveSync();
    } catch (e) {
      debugLog("DRIVE_SYNC", "Failed to start sync execution:", e);
      showToast(`Fehler beim Starten der Synchronisation: ${e.message}`, "error");
    }
  });
}
