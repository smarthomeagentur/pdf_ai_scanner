/**
 * Google Drive Sync & Sequential Background Import Module
 */
import { escapeHtml, formatFileSize, formatDateDisplay, showToast } from "./utils.js";
import { apiRequest } from "./api.js";

export async function openDriveSyncModal() {
  const modalEl = document.getElementById("drive-sync-modal");
  const modalBody = document.getElementById("drive-sync-modal-body");
  if (!modalEl || !modalBody) return;

  modalBody.innerHTML = `<div class="p-5 text-center"><span class="spinner-border spinner-border-sm me-2"></span>Lade Google Drive Dateien...</div>`;
  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();

  try {
    const data = await apiRequest("/api/drive/sync-preview");
    renderDriveSyncPreview(modalBody, data);
  } catch (err) {
    modalBody.innerHTML = `<div class="p-4 alert alert-danger">Fehler beim Laden der Drive-Dateien: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDriveSyncPreview(container, data) {
  const toImport = data.toImport || [];
  const needsEnrichment = data.needsEnrichment || [];

  container.innerHTML = `
    <div class="p-3">
      <h6>Google Drive Synchronisation (${toImport.length} neu, ${needsEnrichment.length} unvollständig)</h6>
      <div class="list-group list-group-flush mb-3" style="max-height: 400px; overflow-y: auto;">
        ${toImport
          .map(
            (f) => `
          <div class="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <input class="form-check-input me-2 sync-select-item" type="checkbox" value="${f.id}" data-name="${escapeHtml(f.name)}" checked>
              <strong>${escapeHtml(f.name)}</strong>
              <div class="small text-muted">${formatDateDisplay(f.createdTime)} &bull; ${formatFileSize(f.size)}</div>
            </div>
            <span class="badge bg-primary">Neu</span>
          </div>`
          )
          .join("")}
      </div>
      <div class="d-flex justify-content-between align-items-center">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Abbrechen</button>
        <button class="btn btn-primary" id="start-drive-sync-btn">Ausgewählte importieren (${toImport.length})</button>
      </div>
    </div>`;

  const startBtn = container.querySelector("#start-drive-sync-btn");
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      const selected = Array.from(container.querySelectorAll(".sync-select-item:checked")).map((cb) => ({
        id: cb.value,
        name: cb.getAttribute("data-name"),
      }));

      if (selected.length === 0) {
        showToast("Keine Dateien ausgewählt.", "warning");
        return;
      }

      try {
        await apiRequest("/api/drive/sync-execute", {
          method: "POST",
          body: JSON.stringify({ items: selected }),
        });
        showToast("Hintergrund-Synchronisation gestartet!", "success");
        bootstrap.Modal.getInstance(document.getElementById("drive-sync-modal"))?.hide();
      } catch (e) {
        showToast("Fehler beim Starten des Syncs: " + e.message, "error");
      }
    });
  }
}
