/**
 * Settings Modal & Zero-Trust Secrets Management with Debug Logging
 */
import { showToast, debugLog, extractCleanFolderId, isDebugEnabled, setDebugEnabled, escapeHtml } from "./utils.js";
import { apiRequest } from "./api.js";
import {
  STORAGE_KEYS,
  getClientSecret,
  setClientSecret,
  getAccountingAccounts,
  saveOrUpdateAccountingAccount,
  deleteAccountingAccountById,
  state,
} from "./state.js";
import { openGooglePicker } from "./drivePicker.js";

let googleClientId = null;
let authClientCode = null;

let adminLockoutTimer = null;
let adminRemainingSeconds = 0;
let pendingAdminAuthCallback = null;

export function openAdminLoginModal(onSuccess = null) {
  const modal = document.getElementById("admin-login-modal");
  const pwdInput = document.getElementById("admin-login-password");
  const statusBox = document.getElementById("admin-login-status");
  const submitBtn = document.getElementById("admin-login-submit-btn");

  if (!modal) return;
  pendingAdminAuthCallback = onSuccess;

  if (pwdInput && !adminLockoutTimer) {
    pwdInput.value = "";
    pwdInput.disabled = false;
  }
  if (statusBox && !adminLockoutTimer) {
    statusBox.innerHTML = "";
  }
  if (submitBtn && !adminLockoutTimer) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">lock_open</span> <span>Entsperren</span>`;
  }

  modal.style.display = "flex";
  if (pwdInput && !adminLockoutTimer) {
    setTimeout(() => pwdInput.focus(), 100);
  }
}

export function closeAdminLoginModal() {
  const modal = document.getElementById("admin-login-modal");
  if (modal) modal.style.display = "none";
  pendingAdminAuthCallback = null;
}

function startAdminLockoutCountdown(seconds = 60) {
  const submitBtn = document.getElementById("admin-login-submit-btn");
  const pwdInput = document.getElementById("admin-login-password");
  const statusBox = document.getElementById("admin-login-status");

  if (adminLockoutTimer) clearInterval(adminLockoutTimer);
  adminRemainingSeconds = seconds;

  if (submitBtn) submitBtn.disabled = true;
  if (pwdInput) {
    pwdInput.disabled = true;
    pwdInput.blur();
  }

  const updateDisplay = () => {
    if (adminRemainingSeconds <= 0) {
      clearInterval(adminLockoutTimer);
      adminLockoutTimer = null;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">lock_open</span> <span>Entsperren</span>`;
      }
      if (pwdInput) {
        pwdInput.disabled = false;
        pwdInput.focus();
      }
      if (statusBox) statusBox.innerHTML = "";
      return;
    }

    if (statusBox) {
      statusBox.innerHTML = `
        <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-center gap-1">
          <span class="material-symbols-outlined" style="font-size: 18px;">timer</span>
          <span>Zu viele Fehlversuche. Bitte warte noch <strong>${adminRemainingSeconds}s</strong>...</span>
        </div>
      `;
    }
    adminRemainingSeconds--;
  };

  updateDisplay();
  adminLockoutTimer = setInterval(updateDisplay, 1000);
}

async function handleAdminLoginSubmit(e) {
  if (e) e.preventDefault();
  if (adminLockoutTimer) return;

  const pwdInput = document.getElementById("admin-login-password");
  const statusBox = document.getElementById("admin-login-status");
  const submitBtn = document.getElementById("admin-login-submit-btn");
  const pw = pwdInput?.value?.trim() || "";

  if (!pw) {
    if (statusBox) statusBox.innerHTML = `<div class="text-danger">Bitte Passwort eingeben.</div>`;
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status"></span> <span>Prüfe...</span>`;
  }
  if (statusBox) statusBox.innerHTML = "";

  try {
    const loginRes = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const loginData = await loginRes.json().catch(() => ({}));

    if (loginRes.status === 429) {
      startAdminLockoutCountdown(loginData.retryAfter || 60);
      return;
    }

    if (loginData.success) {
      state.isAdmin = true;
      const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
      if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";

      closeAdminLoginModal();
      showToast("Admin-Login erfolgreich!", "success");

      if (window.renderJobsList) {
        window.renderJobsList(state.jobs, true);
      }

      if (typeof pendingAdminAuthCallback === "function") {
        const cb = pendingAdminAuthCallback;
        pendingAdminAuthCallback = null;
        cb();
      }
    } else {
      if (statusBox) {
        statusBox.innerHTML = `
          <div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle d-flex align-items-center gap-1">
            <span class="material-symbols-outlined" style="font-size: 16px;">error</span>
            <span>${escapeHtml(loginData.error || "Falsches Admin-Passwort.")}</span>
          </div>
        `;
      }
      if (pwdInput) {
        pwdInput.value = "";
        pwdInput.focus();
      }
    }
  } catch (err) {
    if (statusBox) {
      statusBox.innerHTML = `<div class="text-danger">Verbindungsfehler: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    if (!adminLockoutTimer && submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">lock_open</span> <span>Entsperren</span>`;
    }
  }
}

export async function openSettingsModal() {
  debugLog("SETTINGS", "Opening Settings Modal...");
  const modalEl = document.getElementById("settings-modal");
  if (!modalEl) return;

  // 1. Verify Admin Access
  try {
    const adminCheckRes = await fetch("/api/admin-check");
    const checkData = await adminCheckRes.json().catch(() => ({}));
    if (!checkData.isAdmin) {
      openAdminLoginModal(() => openSettingsModal());
      return;
    } else {
      state.isAdmin = true;
      const navRechnungenTab = document.getElementById("nav-rechnungen-tab");
      if (navRechnungenTab) navRechnungenTab.style.display = "inline-flex";
      if (window.renderJobsList) window.renderJobsList(state.jobs, true);
    }
  } catch (e) {
    console.error("Admin Check Error", e);
    return;
  }

  if (!state.isAdmin) return;

  modalEl.style.display = "flex";

  // Reset active tab to first tab
  const firstTab = document.querySelector("#settings-modal .gdev-tab-btn");
  if (firstTab) {
    document.querySelectorAll("#settings-modal .gdev-tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("#settings-modal .settings-tab-panel").forEach((p) => (p.style.display = "none"));
    firstTab.classList.add("active");
    const target = firstTab.getAttribute("data-tab-target");
    const targetPanel = document.getElementById(`settings-panel-${target}`);
    if (targetPanel) targetPanel.style.display = "block";
  }

  // Show all admin setting sections
  const showSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "block";
  };

  showSection("folder-settings-container");
  showSection("ai-folder-settings-container");
  showSection("drive-sync-settings-container");
  showSection("lexoffice-settings-container");
  showSection("clickup-settings-container");
  showSection("ai-prompt-settings-container");
  showSection("admin-backup-container");
  showSection("gmail-settings-container");
  showSection("saveSettingsBtn");

  // Fetch current settings from backend
  try {
    const serverSettings = await apiRequest("/api/settings");
    debugLog("SETTINGS", "Server settings loaded:", serverSettings);
    populateSettingsForm(serverSettings);
  } catch (err) {
    console.warn("Could not fetch server settings:", err.message);
    populateSettingsForm({});
  }

  // Render modular accounting accounts list
  renderAccountingAccountsList();

  // Setup Drive auth status & GIS code client
  await initDriveAuthSection();
}

export function renderAccountingAccountsList() {
  const container = document.getElementById("accounting-accounts-container");
  if (!container) return;

  const accounts = getAccountingAccounts();
  if (accounts.length === 0) {
    container.innerHTML = `
      <div class="p-3 text-center border bg-light text-muted small">
        <span class="material-symbols-outlined d-block mb-1" style="font-size: 24px;">account_balance</span>
        Noch keine Buchhaltungs-Zugänge angelegt.<br />Klicke auf den Button unten, um einen Lexoffice- oder BuchhaltungsButler-Zugang hinzuzufügen.
      </div>
    `;
    return;
  }

  container.innerHTML = accounts
    .map((acc) => {
      const isButler = acc.provider === "buchhaltungsbutler";
      const badgeHtml = isButler
        ? `<span class="badge bg-info-subtle text-info-emphasis border border-info-subtle" style="font-size: 11px; font-weight: normal; border-radius: 0;">BuchhaltungsButler</span>`
        : `<span class="badge bg-primary-subtle text-primary border border-primary-subtle" style="font-size: 11px; font-weight: normal; border-radius: 0;">Lexoffice</span>`;

      let credDetail = "";
      if (isButler) {
        credDetail = `Client: <code>${escapeHtml(acc.credentials?.client || "-")}</code>`;
      } else {
        const key = acc.credentials?.apiKey || "";
        const masked = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : (key ? "***" : "Kein Key");
        credDetail = `API-Key: <code>${escapeHtml(masked)}</code>`;
      }

      return `
        <div class="d-flex align-items-center justify-content-between p-2 px-3 border bg-white" data-acc-id="${escapeHtml(acc.id)}" style="border-radius: 0;">
          <div>
            <div class="d-flex align-items-center gap-2">
              <span class="fw-semibold text-dark" style="font-size: 13.5px;">${escapeHtml(acc.name)}</span>
              ${badgeHtml}
            </div>
            <div class="text-muted small mt-1" style="font-size: 11.5px;">
              ${credDetail}
            </div>
          </div>
          <div class="d-flex align-items-center gap-1">
            <button type="button" class="btn btn-sm btn-outline-secondary btn-test-acc p-1 px-2" data-acc-id="${escapeHtml(acc.id)}" title="Verbindung prüfen" style="border-radius: 0; font-size: 12px;">
              <span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">sync_alt</span>
            </button>
            <button type="button" class="btn btn-sm btn-outline-primary btn-edit-acc p-1 px-2" data-acc-id="${escapeHtml(acc.id)}" title="Bearbeiten" style="border-radius: 0; font-size: 12px;">
              <span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">edit</span>
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger btn-delete-acc p-1 px-2" data-acc-id="${escapeHtml(acc.id)}" title="Entfernen" style="border-radius: 0; font-size: 12px;">
              <span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">delete</span>
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}

export function openAccountingAccountModal(accToEdit = null) {
  const modal = document.getElementById("accounting-account-modal");
  const title = document.getElementById("acc-modal-title");
  const idInput = document.getElementById("acc-modal-id");
  const nameInput = document.getElementById("acc-modal-name");
  const providerSelect = document.getElementById("acc-modal-provider");
  const lexFields = document.getElementById("acc-modal-lex-fields");
  const butlerFields = document.getElementById("acc-modal-butler-fields");
  const lexKeyInput = document.getElementById("acc-modal-lex-key");
  const butlerClientInput = document.getElementById("acc-modal-butler-client");
  const butlerSecretInput = document.getElementById("acc-modal-butler-secret");
  const butlerKeyInput = document.getElementById("acc-modal-butler-key");
  const statusBox = document.getElementById("acc-modal-test-status");

  if (!modal) return;

  if (statusBox) statusBox.innerHTML = "";

  if (accToEdit) {
    if (title) title.innerHTML = `<span class="material-symbols-outlined text-primary" style="font-size: 20px;">account_balance</span><span>Zugang bearbeiten</span>`;
    if (idInput) idInput.value = accToEdit.id;
    if (nameInput) nameInput.value = accToEdit.name || "";
    if (providerSelect) providerSelect.value = accToEdit.provider || "lexoffice";
    if (lexKeyInput) lexKeyInput.value = accToEdit.credentials?.apiKey || "";
    if (butlerClientInput) butlerClientInput.value = accToEdit.credentials?.client || "";
    if (butlerSecretInput) butlerSecretInput.value = accToEdit.credentials?.secret || "";
    if (butlerKeyInput) butlerKeyInput.value = accToEdit.credentials?.key || "";
  } else {
    if (title) title.innerHTML = `<span class="material-symbols-outlined text-primary" style="font-size: 20px;">account_balance</span><span>Buchhaltungs-Zugang anlegen</span>`;
    if (idInput) idInput.value = "";
    if (nameInput) nameInput.value = "";
    if (providerSelect) providerSelect.value = "lexoffice";
    if (lexKeyInput) lexKeyInput.value = "";
    if (butlerClientInput) butlerClientInput.value = "";
    if (butlerSecretInput) butlerSecretInput.value = "";
    if (butlerKeyInput) butlerKeyInput.value = "";
  }

  // Toggle fields
  const isButler = (providerSelect?.value === "buchhaltungsbutler");
  if (lexFields) lexFields.style.display = isButler ? "none" : "block";
  if (butlerFields) butlerFields.style.display = isButler ? "block" : "none";

  modal.style.display = "flex";
}

export function closeAccountingAccountModal() {
  const modal = document.getElementById("accounting-account-modal");
  if (modal) modal.style.display = "none";
}

async function testAccountingAccountConnectionFromModal() {
  const provider = document.getElementById("acc-modal-provider")?.value || "lexoffice";
  const lexKey = document.getElementById("acc-modal-lex-key")?.value?.trim() || "";
  const butlerClient = document.getElementById("acc-modal-butler-client")?.value?.trim() || "";
  const butlerSecret = document.getElementById("acc-modal-butler-secret")?.value?.trim() || "";
  const butlerKey = document.getElementById("acc-modal-butler-key")?.value?.trim() || "";
  const statusBox = document.getElementById("acc-modal-test-status");

  if (!statusBox) return;

  statusBox.innerHTML = `<div class="text-muted d-flex align-items-center gap-1"><span class="spinner-border spinner-border-sm"></span> <span>Prüfe Verbindung...</span></div>`;

  try {
    const creds = provider === "buchhaltungsbutler"
      ? { client: butlerClient, secret: butlerSecret, key: butlerKey }
      : { apiKey: lexKey };

    const res = await apiRequest("/api/accounting/test-connection", {
      method: "POST",
      body: JSON.stringify({ provider, credentials: creds }),
    });

    if (res.success) {
      statusBox.innerHTML = `<div class="text-success fw-medium">✓ Verbindung erfolgreich! (${escapeHtml(res.companyName || "Aktiv")})</div>`;
    } else {
      statusBox.innerHTML = `<div class="text-danger fw-medium">✗ Fehler: ${escapeHtml(res.error || "Keine Verbindung")}</div>`;
    }
  } catch (err) {
    statusBox.innerHTML = `<div class="text-danger fw-medium">✗ Netzwerkfehler: ${escapeHtml(err.message)}</div>`;
  }
}

function saveAccountingAccountFromModal() {
  const idInput = document.getElementById("acc-modal-id")?.value?.trim() || "";
  const nameInput = document.getElementById("acc-modal-name")?.value?.trim() || "";
  const provider = document.getElementById("acc-modal-provider")?.value || "lexoffice";
  const lexKey = document.getElementById("acc-modal-lex-key")?.value?.trim() || "";
  const butlerClient = document.getElementById("acc-modal-butler-client")?.value?.trim() || "";
  const butlerSecret = document.getElementById("acc-modal-butler-secret")?.value?.trim() || "";
  const butlerKey = document.getElementById("acc-modal-butler-key")?.value?.trim() || "";

  if (!nameInput) {
    showToast("Bitte gib einen Namen für den Mandanten ein.", "warning");
    return;
  }

  const credentials = provider === "buchhaltungsbutler"
    ? { client: butlerClient, secret: butlerSecret, key: butlerKey }
    : { apiKey: lexKey };

  const accountObj = {
    id: idInput || `acc_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    name: nameInput,
    provider,
    credentials,
  };

  saveOrUpdateAccountingAccount(accountObj);
  showToast(`Buchhaltungs-Zugang "${nameInput}" gespeichert!`, "success");
  closeAccountingAccountModal();
  renderAccountingAccountsList();
}

function populateSettingsForm(settings = {}) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  };

  // Folder IDs
  const rawId = settings.FOLDER_ID || "";
  setVal("raw-folder-id", rawId);
  setVal("raw-folder-display", rawId);

  const aiId = settings.FOLDER_ID_SORTED || "";
  setVal("ai-folder-id", aiId);
  setVal("ai-folder-display", aiId);

  setVal(
    "ai-categories-input",
    settings.AI_CATEGORIES ||
      "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige"
  );
  setVal(
    "ai-company-input",
    settings.AI_COMPANY || "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel (Privat), Unbekannt"
  );

  const monDriveCb = document.getElementById("monitor-drive-checkbox");
  if (monDriveCb) monDriveCb.checked = settings.MONITOR_DRIVE === true;

  const autoArchCb = document.getElementById("gmail-auto-archive-checkbox");
  if (autoArchCb) autoArchCb.checked = settings.GMAIL_AUTO_ARCHIVE !== false;

  const queryInput = document.getElementById("gmail-scan-query-input");
  if (queryInput) queryInput.value = settings.GMAIL_SCAN_QUERY || "in:inbox filename:pdf";

  // Client-only localStorage keys
  setVal("clickup-api-key", getClientSecret(STORAGE_KEYS.CLICKUP_API_KEY));
  setVal("clickup-list-id", getClientSecret(STORAGE_KEYS.CLICKUP_LIST_ID));

  const autoTaskCb = document.getElementById("clickup-auto-task");
  if (autoTaskCb) autoTaskCb.checked = settings.CLICKUP_AUTO_TASK !== false;

  const filterPrivCb = document.getElementById("clickup-filter-private");
  if (filterPrivCb) filterPrivCb.checked = settings.CLICKUP_FILTER_PRIVATE !== false;

  const debugCb = document.getElementById("debug-logs-checkbox");
  if (debugCb) debugCb.checked = isDebugEnabled();
}

export async function saveAllSettings() {
  try {
    const getVal = (id) => document.getElementById(id)?.value?.trim() || "";

    const rawFolder = extractCleanFolderId(getVal("raw-folder-id") || getVal("raw-folder-display"));
    const aiFolder = extractCleanFolderId(getVal("ai-folder-id") || getVal("ai-folder-display"));
    const categories = getVal("ai-categories-input");
    const company = getVal("ai-company-input");
    const monitorDrive = document.getElementById("monitor-drive-checkbox")?.checked || false;
    const autoArchive = document.getElementById("gmail-auto-archive-checkbox")?.checked !== false;
    const scanQuery = getVal("gmail-scan-query-input") || "in:inbox filename:pdf";
    const autoTask = document.getElementById("clickup-auto-task")?.checked !== false;
    const filterPrivate = document.getElementById("clickup-filter-private")?.checked !== false;
    const debugEnabled = document.getElementById("debug-logs-checkbox")?.checked !== false;

    debugLog("SETTINGS", "Saving settings to server...", {
      rawFolder,
      aiFolder,
      company,
      categories,
      monitorDrive,
      autoArchive,
      scanQuery,
      debugEnabled,
    });

    // 1. Save server settings
    await apiRequest("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        FOLDER_ID: rawFolder,
        FOLDER_ID_SORTED: aiFolder,
        AI_COMPANY: company,
        AI_CATEGORIES: categories,
        MONITOR_DRIVE: monitorDrive,
        GMAIL_AUTO_ARCHIVE: autoArchive,
        GMAIL_SCAN_QUERY: scanQuery,
        CLICKUP_AUTO_TASK: autoTask,
        CLICKUP_FILTER_PRIVATE: filterPrivate,
      }),
    });

    // 2. Save client secrets & debug state in localStorage
    setClientSecret(STORAGE_KEYS.LEXOFFICE_WIREWIRE, getVal("lexoffice-key-wirewire"));
    setClientSecret(STORAGE_KEYS.LEXOFFICE_POLYXO, getVal("lexoffice-key-polyxo"));
    setClientSecret(STORAGE_KEYS.BUTTLER_CLIENT, getVal("butler-key-thewire-client"));
    setClientSecret(STORAGE_KEYS.BUTTLER_SECRET, getVal("butler-key-thewire-secret"));
    setClientSecret(STORAGE_KEYS.BUTTLER_KEY, getVal("butler-key-thewire-key"));
    setClientSecret(STORAGE_KEYS.CLICKUP_API_KEY, getVal("clickup-api-key"));
    setClientSecret(STORAGE_KEYS.CLICKUP_LIST_ID, getVal("clickup-list-id"));
    setDebugEnabled(debugEnabled);

    showToast("Einstellungen erfolgreich gespeichert!", "success");
    const modal = document.getElementById("settings-modal");
    if (modal) modal.style.display = "none";
  } catch (err) {
    debugLog("SETTINGS", "Failed to save settings:", err);
    showToast(`Fehler beim Speichern: ${err.message}`, "error");
  }
}

async function initDriveAuthSection() {
  const statusEl = document.getElementById("auth-status");
  const authBtn = document.getElementById("auth-btn");
  const disconnectBtn = document.getElementById("auth-disconnect-btn");
  const rawBrowseBtn = document.getElementById("raw-folder-browse");
  const aiBrowseBtn = document.getElementById("ai-folder-browse");

  try {
    const authStatus = await apiRequest("/api/auth/token-status");
    debugLog("SETTINGS", "Drive auth token status:", authStatus);
    if (authStatus.isConnected) {
      if (statusEl) statusEl.innerText = "Verbunden";
      if (authBtn) authBtn.style.display = "none";
      if (disconnectBtn) disconnectBtn.style.display = "inline-block";
      if (rawBrowseBtn) rawBrowseBtn.disabled = false;
      if (aiBrowseBtn) aiBrowseBtn.disabled = false;
    } else {
      if (statusEl) statusEl.innerText = "Nicht verbunden";
      if (authBtn) authBtn.style.display = "inline-block";
      if (disconnectBtn) disconnectBtn.style.display = "none";
      if (rawBrowseBtn) rawBrowseBtn.disabled = true;
      if (aiBrowseBtn) aiBrowseBtn.disabled = true;
    }
  } catch (e) {}

  try {
    const authData = await apiRequest("/api/auth/client-id");
    if (authData?.clientId) {
      googleClientId = authData.clientId;
      if (window.google?.accounts?.oauth2) {
        authClientCode = window.google.accounts.oauth2.initCodeClient({
          client_id: googleClientId,
          scope: "https://www.googleapis.com/auth/drive.file",
          include_granted_scopes: false,
          prompt: "consent",
          ux_mode: "popup",
          callback: async (response) => {
            if (response.code) {
              if (statusEl) statusEl.innerText = "Speichere Drive-Token...";
              try {
                await apiRequest("/api/auth/code", {
                  method: "POST",
                  body: JSON.stringify({ code: response.code }),
                });
                showToast("Google Drive erfolgreich verbunden!", "success");
                initDriveAuthSection();
              } catch (err) {
                showToast("Fehler bei Drive-Verbindung: " + err.message, "error");
              }
            }
          },
        });
      }
    }
  } catch (e) {}
}

export async function clearAppCacheAndStorage() {
  if (!confirm("Möchtest du wirklich den gesamten Cache, Offline-Speicher und Service Worker leeren und die App neu laden?")) {
    return;
  }
  showToast("Cache und Speicher werden geleert...", "info");
  try {
    // 1. Unregister all Service Workers
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }

    // 2. Clear all CacheStorage caches
    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      for (const key of cacheKeys) {
        await caches.delete(key);
      }
    }

    // 3. Clear Storage (localStorage, sessionStorage)
    localStorage.clear();
    sessionStorage.clear();

    // 4. Clear IndexedDB if present
    if (window.indexedDB && window.indexedDB.databases) {
      try {
        const dbs = await window.indexedDB.databases();
        for (const db of dbs) {
          if (db.name) {
            window.indexedDB.deleteDatabase(db.name);
          }
        }
      } catch (e) {}
    }

    showToast("Cache erfolgreich geleert! App wird neu geladen...", "success");

    // 5. Hard reload with cache buster
    setTimeout(() => {
      const cleanUrl = window.location.origin + window.location.pathname + "?v=" + Date.now();
      window.location.replace(cleanUrl);
    }, 400);
  } catch (err) {
    console.error("Fehler beim Leeren des Caches:", err);
    showToast("Fehler beim Leeren: " + err.message, "error");
  }
}

export function initSettingsEvents() {
  document.getElementById("openSettingsBtn")?.addEventListener("click", openSettingsModal);

  const closeSettings = () => {
    const modal = document.getElementById("settings-modal");
    if (modal) modal.style.display = "none";
  };

  document.getElementById("closeSettingsBtn")?.addEventListener("click", closeSettings);
  document.getElementById("closeSettingsBottomBtn")?.addEventListener("click", closeSettings);

  // Admin Login Modal Events
  document.getElementById("admin-login-close-btn")?.addEventListener("click", closeAdminLoginModal);
  document.getElementById("admin-login-cancel-btn")?.addEventListener("click", closeAdminLoginModal);
  document.getElementById("admin-login-form")?.addEventListener("submit", handleAdminLoginSubmit);
  document.getElementById("admin-login-toggle-pw")?.addEventListener("click", () => {
    const input = document.getElementById("admin-login-password");
    const icon = document.getElementById("admin-login-toggle-pw");
    if (!input || !icon) return;
    const isPw = input.getAttribute("type") === "password";
    input.setAttribute("type", isPw ? "text" : "password");
    icon.innerText = isPw ? "visibility_off" : "visibility";
  });

  // Settings Tab Switching (Google Developer Style)
  document.querySelectorAll("#settings-modal .gdev-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabTarget = btn.getAttribute("data-tab-target");
      if (!tabTarget) return;
      document.querySelectorAll("#settings-modal .gdev-tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll("#settings-modal .settings-tab-panel").forEach((p) => (p.style.display = "none"));
      btn.classList.add("active");
      const activePanel = document.getElementById(`settings-panel-${tabTarget}`);
      if (activePanel) activePanel.style.display = "block";
    });
  });

  // Modular Accounting Accounts Events
  document.getElementById("add-accounting-account-btn")?.addEventListener("click", () => {
    openAccountingAccountModal(null);
  });

  document.getElementById("acc-modal-close-btn")?.addEventListener("click", closeAccountingAccountModal);
  document.getElementById("acc-modal-cancel-btn")?.addEventListener("click", closeAccountingAccountModal);

  document.getElementById("acc-modal-provider")?.addEventListener("change", (e) => {
    const isButler = e.target.value === "buchhaltungsbutler";
    const lexFields = document.getElementById("acc-modal-lex-fields");
    const butlerFields = document.getElementById("acc-modal-butler-fields");
    if (lexFields) lexFields.style.display = isButler ? "none" : "block";
    if (butlerFields) butlerFields.style.display = isButler ? "block" : "none";
  });

  document.getElementById("acc-modal-test-btn")?.addEventListener("click", testAccountingAccountConnectionFromModal);
  document.getElementById("acc-modal-save-btn")?.addEventListener("click", saveAccountingAccountFromModal);

  // Accounting accounts list action buttons delegation
  document.getElementById("accounting-accounts-container")?.addEventListener("click", async (e) => {
    const testBtn = e.target.closest(".btn-test-acc");
    if (testBtn) {
      const accId = testBtn.getAttribute("data-acc-id");
      const accounts = getAccountingAccounts();
      const targetAcc = accounts.find((a) => a.id === accId);
      if (targetAcc) {
        testBtn.disabled = true;
        testBtn.innerHTML = `<span class="spinner-border spinner-border-sm" style="width: 12px; height: 12px;"></span>`;
        try {
          const res = await apiRequest("/api/accounting/test-connection", {
            method: "POST",
            body: JSON.stringify({ provider: targetAcc.provider, credentials: targetAcc.credentials }),
          });
          if (res.success) {
            showToast(`✓ Verbindung zu "${targetAcc.name}" (${res.companyName || targetAcc.provider}) erfolgreich!`, "success");
          } else {
            showToast(`✗ Verbindung fehlgeschlagen: ${res.error || "Fehler"}`, "error");
          }
        } catch (err) {
          showToast(`✗ Netzwerkfehler: ${err.message}`, "error");
        } finally {
          testBtn.disabled = false;
          testBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 15px; vertical-align: middle;">sync_alt</span>`;
        }
      }
      return;
    }

    const editBtn = e.target.closest(".btn-edit-acc");
    if (editBtn) {
      const accId = editBtn.getAttribute("data-acc-id");
      const accounts = getAccountingAccounts();
      const targetAcc = accounts.find((a) => a.id === accId);
      if (targetAcc) {
        openAccountingAccountModal(targetAcc);
      }
      return;
    }

    const deleteBtn = e.target.closest(".btn-delete-acc");
    if (deleteBtn) {
      const accId = deleteBtn.getAttribute("data-acc-id");
      const accounts = getAccountingAccounts();
      const targetAcc = accounts.find((a) => a.id === accId);
      if (targetAcc) {
        if (confirm(`Möchtest du den Buchhaltungs-Zugang "${targetAcc.name}" wirklich entfernen?`)) {
          deleteAccountingAccountById(accId);
          showToast(`Zugang "${targetAcc.name}" entfernt.`, "info");
          renderAccountingAccountsList();
        }
      }
      return;
    }
  });

  document.getElementById("saveSettingsBtn")?.addEventListener("click", saveAllSettings);

  document.getElementById("clear-cache-storage-btn")?.addEventListener("click", clearAppCacheAndStorage);

  document.getElementById("raw-folder-browse")?.addEventListener("click", (e) => {
    e.preventDefault();
    openGooglePicker("raw");
  });

  document.getElementById("ai-folder-browse")?.addEventListener("click", (e) => {
    e.preventDefault();
    openGooglePicker("ai");
  });

  document.getElementById("auth-btn")?.addEventListener("click", () => {
    if (authClientCode) authClientCode.requestCode();
  });

  document.getElementById("auth-disconnect-btn")?.addEventListener("click", async () => {
    if (!confirm("Möchtest du Google Drive wirklich trennen?")) return;
    try {
      await apiRequest("/api/auth/disconnect", { method: "POST" });
      showToast("Google Drive getrennt.", "info");
      initDriveAuthSection();
    } catch (e) {
      showToast("Fehler beim Trennen: " + e.message, "error");
    }
  });

  document.getElementById("download-backup-btn")?.addEventListener("click", () => {
    window.location.href = "/api/admin/backup";
  });

  document.getElementById("trigger-restore-btn")?.addEventListener("click", () => {
    document.getElementById("restore-file-input")?.click();
  });

  document.getElementById("restore-file-input")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await apiRequest("/api/admin/restore", {
        method: "POST",
        body: JSON.stringify(json),
      });
      showToast("Backup erfolgreich wiederhergestellt!", "success");
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      showToast("Fehler beim Wiederherstellen: " + err.message, "error");
    }
  });

  const handleRescanDuplicates = async (e) => {
    const btn = e.currentTarget;
    const origHtml = btn.innerHTML;
    const resultBox = document.getElementById("ai-duplicates-scan-result");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" style="width: 14px; height: 14px;"></span> Prüfe Duplikate...';
    if (resultBox) {
      resultBox.style.display = "block";
      resultBox.innerHTML = '<span class="text-muted"><span class="spinner-border spinner-border-sm me-1" style="width: 12px; height: 12px;"></span> Belege werden analysiert...</span>';
    }

    try {
      const data = await apiRequest("/api/jobs/rescan-duplicates", { method: "POST" });
      if (data.success) {
        const msg = `✅ ${data.markedCount || 0} Duplikat(e) in ${data.scanned || 0} Belegen gefunden.`;
        showToast(msg, "success");
        if (resultBox) {
          resultBox.innerHTML = `<div class="p-2 rounded bg-success-subtle text-success border border-success-subtle fw-medium">${msg}</div>`;
        }
        const statusData = await apiRequest("/api/status?ids=all").catch(() => null);
        if (statusData && statusData.statuses) {
          state.jobs = statusData.statuses;
          if (window.renderJobsList) window.renderJobsList(state.jobs, true);
        }
      } else {
        const errMsg = "Fehler: " + (data.error || "Unbekannt");
        showToast(errMsg, "error");
        if (resultBox) {
          resultBox.innerHTML = `<div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle">${escapeHtml(errMsg)}</div>`;
        }
      }
    } catch (err) {
      showToast("Netzwerkfehler: " + err.message, "error");
      if (resultBox) {
        resultBox.innerHTML = `<div class="p-2 rounded bg-danger-subtle text-danger border border-danger-subtle">${escapeHtml(err.message)}</div>`;
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  };

  document.querySelectorAll(".btn-trigger-rescan-duplicates, #ai-trigger-rescan-duplicates-btn").forEach((btn) => {
    btn.addEventListener("click", handleRescanDuplicates);
  });

  document.getElementById("trigger-clear-jobs-btn")?.addEventListener("click", async () => {
    if (!confirm("Warteschlange und Belegliste wirklich leeren?")) return;
    try {
      await apiRequest("/api/jobs", { method: "DELETE" });
      showToast("Liste geleert.", "info");
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      showToast("Fehler beim Leeren: " + err.message, "error");
    }
  });
}
