/**
 * Live Full-Text & Metadata Search
 */
import { escapeHtml, formatFileSize, formatDateDisplay, debounce } from "./utils.js";
import { apiRequest } from "./api.js";

export function initDeepSearch() {
  const input = document.getElementById("search-input");
  const resultsContainer = document.getElementById("search-results-modal-body");
  if (!input) return;

  const handleSearch = debounce(async () => {
    const query = input.value.trim();
    if (query.length < 2) return;

    try {
      const data = await apiRequest(`/api/documents/deep-search?q=${encodeURIComponent(query)}`);
      renderSearchResults(resultsContainer, data.results || [], query);
    } catch (e) {
      if (resultsContainer) {
        resultsContainer.innerHTML = `<div class="p-4 text-danger">Fehler bei der Suche: ${escapeHtml(e.message)}</div>`;
      }
    }
  }, 350);

  input.addEventListener("input", handleSearch);
}

function renderSearchResults(container, results, query) {
  if (!container) return;
  if (results.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-muted">Keine Treffer für "${escapeHtml(query)}" gefunden.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="list-group list-group-flush">
      ${results
        .map(
          (r) => `
        <div class="list-group-item p-3 list-group-item-action d-flex justify-content-between align-items-center">
          <div>
            <span class="badge ${r.isLocal ? "bg-primary" : "bg-success"} mb-1">${escapeHtml(r.source)}</span>
            <h6 class="mb-1 fw-bold text-dark">${escapeHtml(r.name)}</h6>
            <div class="small text-secondary mb-2">${escapeHtml(r.snippet)}</div>
            <div class="small text-muted">${formatDateDisplay(r.date)} &bull; ${formatFileSize(r.size)}</div>
          </div>
          <div>
            ${r.isLocal ? `<a href="/api/jobs/${r.id}/file" target="_blank" class="btn btn-sm btn-outline-primary">Öffnen</a>` : `<a href="${r.webViewLink}" target="_blank" class="btn btn-sm btn-outline-success">In Drive</a>`}
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}
