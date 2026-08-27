/**
 * Sanitizes a string for secure HTML insertion (XSS Prevention).
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Formats bytes to readable human string.
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Formats a Date object or ISO string for display in German format.
 */
export function formatDateDisplay(dateInput) {
  if (!dateInput || dateInput === "unknown" || dateInput === "none" || dateInput === "-") return "-";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (e) {
    return String(dateInput);
  }
}

/**
 * Formats an integer (in cents) or float to Euro currency string.
 */
export function formatCurrency(amount) {
  if (amount === undefined || amount === null || amount === "none" || amount === "-") return "-";
  const num = typeof amount === "string" ? parseFloat(amount.replace(",", ".")) : amount;
  if (isNaN(num)) return "-";
  const euros = num > 100 && Number.isInteger(num) ? num / 100 : num;
  return (
    euros.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

/**
 * Highlights matching search query substrings safely.
 */
export function highlightQueryText(text, query) {
  if (!text || !query || !String(query).trim()) return escapeHtml(text || "");
  const safeText = String(text);
  const q = String(query).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${q})`, "gi");
  const parts = safeText.split(regex);
  return parts
    .map((part) =>
      part.toLowerCase() === String(query).trim().toLowerCase()
        ? `<mark class="bg-warning text-dark px-1 rounded">${escapeHtml(part)}</mark>`
        : escapeHtml(part)
    )
    .join("");
}

/**
 * Debounce helper for input search.
 */
export function debounce(fn, delay = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Displays user toasts/notifications.
 */
export function showToast(message, type = "info") {
  const toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    console.log(`[TOAST:${type}] ${message}`);
    return;
  }

  const toast = document.createElement("div");
  toast.className = `alert alert-${type === "error" ? "danger" : type} shadow-sm`;
  toast.innerText = message;
  toast.style.margin = "8px 0";
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

/**
 * Extracts a clean Google Drive folder ID from a string that might contain name + ID or a URL.
 */
export function extractCleanFolderId(val) {
  if (!val || typeof val !== "string") return "";
  const trimmed = val.trim();
  const parenMatch = trimmed.match(/\(([a-zA-Z0-9_-]{10,})\)$/);
  if (parenMatch) return parenMatch[1];
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (urlMatch) return urlMatch[1];
  return trimmed;
}

/**
 * Configurable Debug Logger
 */
export function isDebugEnabled() {
  const val = localStorage.getItem("DEBUG_LOGS");
  return val === null || val === "true"; // Default to enabled for easy troubleshooting
}

export function setDebugEnabled(enabled) {
  localStorage.setItem("DEBUG_LOGS", enabled ? "true" : "false");
}

export function debugLog(moduleName, ...args) {
  if (isDebugEnabled()) {
    console.log(`%c[DEBUG:${moduleName}]`, "color: #0284c7; font-weight: bold; background: #e0f2fe; padding: 2px 6px; border-radius: 4px;", ...args);
  }
}
