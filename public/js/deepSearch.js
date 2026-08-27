/**
 * Live Full-Text & OCR Deep Search Module
 */
import { escapeHtml, debounce, debugLog } from "./utils.js";
import { apiRequest } from "./api.js";
import { state } from "./state.js";
import { renderJobsList } from "./jobs.js";

let deepSearchDebounceTimer = null;

export function initDeepSearch() {
  debugLog("SEARCH", "Initializing Live Deep Search & Filter handlers...");
  const searchInput = document.getElementById("start-search-input");
  const clearBtn = document.getElementById("search-clear-btn");
  const resetFiltersBtn = document.getElementById("start-reset-filters-btn");
  const sortSelect = document.getElementById("start-sort-select");
  const dateFilter = document.getElementById("start-filter-date");
  const companyFilter = document.getElementById("start-filter-company");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value.trim();
      if (clearBtn) clearBtn.style.display = state.searchQuery ? "inline-flex" : "none";

      updateResetFiltersVisibility();

      // 1. Instant in-memory filter
      renderJobsList();

      // 2. Debounced deep OCR / fulltext search
      clearTimeout(deepSearchDebounceTimer);
      if (state.searchQuery.length >= 2) {
        setSearchIconSpinning(true);
        deepSearchDebounceTimer = setTimeout(() => {
          runDeepSearch(state.searchQuery);
        }, 300);
      } else {
        state.deepSearchSnippets.clear();
        state.driveOnlySearchResults = [];
        setSearchIconSpinning(false);
        updateResetFiltersVisibility();
        renderJobsList();
      }
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(deepSearchDebounceTimer);
        if (state.searchQuery.length >= 2) {
          runDeepSearch(state.searchQuery);
        }
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      state.searchQuery = "";
      state.deepSearchSnippets.clear();
      state.driveOnlySearchResults = [];
      clearBtn.style.display = "none";
      setSearchIconSpinning(false);
      updateAllFilterCounts();
      renderJobsList();
    });
  }

  if (dateFilter) {
    dateFilter.addEventListener("change", (e) => {
      state.dateFilter = e.target.value;
      updateAllFilterCounts();
      renderJobsList();
    });
  }

  if (companyFilter) {
    companyFilter.addEventListener("change", (e) => {
      state.companyFilter = e.target.value;
      updateAllFilterCounts();
      renderJobsList();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      state.sortOrder = e.target.value;
      updateAllFilterCounts();
      renderJobsList();
    });
  }

  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener("click", () => {
      state.searchQuery = "";
      state.dateFilter = "alle";
      state.companyFilter = "alle";
      state.sortOrder = "uploaddate_desc";
      state.selectedCategories.clear();
      state.deepSearchSnippets.clear();
      state.driveOnlySearchResults = [];

      if (searchInput) searchInput.value = "";
      if (clearBtn) clearBtn.style.display = "none";
      if (dateFilter) dateFilter.value = "alle";
      if (companyFilter) companyFilter.value = "alle";
      if (sortSelect) sortSelect.value = "uploaddate_desc";

      setSearchIconSpinning(false);
      updateAllFilterCounts();
      renderJobsList();
    });
  }

  renderCategoryBubbles();
}

export async function runDeepSearch(query) {
  debugLog("SEARCH", `Running OCR full-text search for "${query}"...`);
  try {
    const data = await apiRequest(`/api/documents/deep-search?q=${encodeURIComponent(query)}`);
    if (state.searchQuery.toLowerCase() !== query.toLowerCase()) return;

    state.deepSearchSnippets.clear();
    state.driveOnlySearchResults = [];

    if (data.success && Array.isArray(data.results)) {
      data.results.forEach((item) => {
        const targetId = item.jobId || item.id;
        if (targetId && item.snippet) {
          state.deepSearchSnippets.set(targetId, item.snippet);
        }
        if (item.isDriveOnly) {
          state.driveOnlySearchResults.push(item);
        }
      });
      debugLog("SEARCH", `Deep search found ${data.results.length} matches (${state.driveOnlySearchResults.length} on Google Drive).`);
    }
  } catch (err) {
    debugLog("SEARCH", "Deep search error:", err);
  } finally {
    setSearchIconSpinning(false);
    renderJobsList();
  }
}

function setSearchIconSpinning(isSpinning) {
  const icon = document.getElementById("search-icon-symbol");
  if (!icon) return;
  icon.classList.remove("spinner-border", "spinner-border-sm");
  if (isSpinning) {
    icon.innerText = "sync";
    icon.classList.add("spin-animation");
  } else {
    icon.innerText = "search";
    icon.classList.remove("spin-animation");
  }
}

export function renderCategoryBubbles() {
  const container = document.getElementById("start-filter-category-bubbles");
  if (!container) return;

  const defaultCats = [
    "Rechnungen",
    "Dokumente",
    "Administration",
    "Personal",
    "Projekte",
    "Verträge",
    "Marketing",
    "Förderung",
    "Buchhaltung",
    "Vertrieb",
    "Privat",
    "Sonstige",
    "Duplikat-Verdacht",
  ];

  container.innerHTML = "";
  defaultCats.forEach((cat) => {
    const catLower = cat.toLowerCase();
    const isSelected = state.selectedCategories.has(catLower);

    const count = (state.jobs || []).filter((job) => {
      const res = job.result || {};
      const jobCat = (res.category || "").toLowerCase();
      const isInvoice = res.isInvoice === true || jobCat.includes("rechnung");
      const isPrivat = job.isPrivate === true || jobCat.includes("privat");

      if (catLower.includes("duplikat")) return job.suspectedDuplicate === true;
      if (catLower === "rechnungen" || catLower === "rechnung") return isInvoice;
      if (catLower === "dokumente" || catLower === "dokument") return !isInvoice;
      if (catLower === "privat") return isPrivat;
      return jobCat.includes(catLower);
    }).length;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `start-cat-bubble ${isSelected ? "active" : ""}`;
    btn.innerHTML = `<span>${cat}</span> <span class="bubble-count">(${count})</span>${
      isSelected ? ' <span class="material-symbols-outlined" style="font-size: 14px; margin-left: 2px;">check</span>' : ""
    }`;

    btn.addEventListener("click", () => {
      if (state.selectedCategories.has(catLower)) {
        state.selectedCategories.delete(catLower);
      } else {
        state.selectedCategories.add(catLower);
      }
      renderCategoryBubbles();
      renderJobsList();
    });

    container.appendChild(btn);
  });

  updateCompanyCounts();
  updateResetFiltersVisibility();
}

export function updateCompanyCounts() {
  const compSelect = document.getElementById("start-filter-company");
  if (!compSelect) return;

  const jobs = state.jobs || [];
  const totalJobs = jobs.filter((j) => !j.isHidden).length;
  const countThewire = jobs.filter((j) => !j.isHidden && ((j.result?.company || "").toLowerCase().includes("the wire") || (j.targetCompany || "").toLowerCase().includes("the wire") || (j.result?.company || "").toLowerCase().includes("thewire") || (j.targetCompany || "").toLowerCase().includes("thewire")) && !(j.result?.company || "").toLowerCase().includes("wirewire")).length;
  const countWirewire = jobs.filter((j) => !j.isHidden && ((j.result?.company || "").toLowerCase().includes("wirewire") || (j.targetCompany || "").toLowerCase().includes("wirewire"))).length;
  const countPolyxo = jobs.filter((j) => !j.isHidden && ((j.result?.company || "").toLowerCase().includes("polyxo") || (j.targetCompany || "").toLowerCase().includes("polyxo"))).length;
  const countDaniel = jobs.filter((j) => !j.isHidden && ((j.result?.company || "").toLowerCase().includes("daniel") || (j.targetCompany || "").toLowerCase().includes("daniel") || j.isPrivate)).length;
  const countAndere = Math.max(0, totalJobs - countThewire - countWirewire - countPolyxo - countDaniel);

  const compLabels = {
    alle: `🏢 Alle Unternehmen (${totalJobs})`,
    thewire: `The Wire UG (${countThewire})`,
    wirewire: `wirewire GmbH (${countWirewire})`,
    polyxo: `Polyxo Studios GmbH (${countPolyxo})`,
    daniel: `Daniel (Privat) (${countDaniel})`,
    andere: `Andere / Unbekannt (${countAndere})`,
  };

  Array.from(compSelect.options).forEach((opt) => {
    if (compLabels[opt.value]) {
      opt.text = compLabels[opt.value];
    }
  });
}

export function updateAllFilterCounts() {
  renderCategoryBubbles();
  updateCompanyCounts();
  updateResetFiltersVisibility();
}

export function updateResetFiltersVisibility() {
  const container = document.getElementById("start-reset-filters-container");
  const summaryEl = document.getElementById("start-active-filters-summary");
  if (!container) return;

  const hasSearch = !!state.searchQuery;
  const hasDate = state.dateFilter !== "alle";
  const hasComp = state.companyFilter !== "alle";
  const hasCats = state.selectedCategories.size > 0;
  const hasCustomSort = state.sortOrder !== "uploaddate_desc";

  const isFiltered = hasSearch || hasDate || hasComp || hasCats || hasCustomSort;

  if (isFiltered) {
    container.style.setProperty("display", "flex", "important");
    if (summaryEl) {
      const activeFilters = [];
      if (hasSearch) activeFilters.push(`Suche: "${state.searchQuery}"`);
      if (hasDate) {
        const dateOpt = document.querySelector(`#start-filter-date option[value="${state.dateFilter}"]`);
        activeFilters.push(dateOpt ? dateOpt.text.split("(")[0].trim() : `Zeitraum: ${state.dateFilter}`);
      }
      if (hasComp) {
        const compOpt = document.querySelector(`#start-filter-company option[value="${state.companyFilter}"]`);
        activeFilters.push(compOpt ? compOpt.text.split("(")[0].trim() : `Unternehmen: ${state.companyFilter}`);
      }
      if (hasCats) {
        activeFilters.push(`${state.selectedCategories.size} Kategorie(n)`);
      }
      if (hasCustomSort) {
        const sortOpt = document.querySelector(`#start-sort-select option[value="${state.sortOrder}"]`);
        activeFilters.push(sortOpt ? sortOpt.text : `Sortierung: ${state.sortOrder}`);
      }

      summaryEl.innerHTML = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle me-1"><span class="material-symbols-outlined" style="font-size: 13px; vertical-align: -2px;">filter_alt</span> ${activeFilters.length} Filter aktiv:</span> <span class="text-secondary">${escapeHtml(activeFilters.join(" • "))}</span>`;
    }
  } else {
    container.style.setProperty("display", "none", "important");
    if (summaryEl) {
      summaryEl.innerHTML = "";
    }
  }
}
