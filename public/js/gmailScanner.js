/**
 * Client-Side Gmail / Workmail Inbox Scanner (Zero-Trust)
 */
import { escapeHtml, formatDateDisplay, formatFileSize, showToast, debugLog } from "./utils.js";
import { STORAGE_KEYS, getClientSecret, setClientSecret, state } from "./state.js";
import { apiRequest } from "./api.js";

let inboxAccounts = [];
let inboxActiveEmails = [];
let inboxSkippedEmails = [];
let selectedInboxMessageIds = new Set();
let currentInboxSubtab = "detected";
let isProcessingInboxBatch = false;

let currentPreviewMailIndex = -1;
let currentPreviewAttIndex = 0;
let currentBlobPreviewUrl = null;

export function initGmailScannerEvents() {
  debugLog("GMAIL", "Initializing Gmail Inbox scanner event listeners...");

  const inboxAddAccountBtn = document.getElementById("inbox-add-account-btn");
  const inboxGrantPermissionBtn = document.getElementById("inbox-grant-permission-btn");
  const settingsAddGmailAccountBtn = document.getElementById("settings-add-gmail-account-btn");
  const inboxRefreshBtn = document.getElementById("inbox-refresh-btn");
  const inboxAccountSelect = document.getElementById("inbox-account-select");
  const inboxTabDetected = document.getElementById("inbox-tab-detected");
  const inboxTabActive = document.getElementById("inbox-tab-active");
  const inboxTabSkipped = document.getElementById("inbox-tab-skipped");
  const inboxSearchInput = document.getElementById("inbox-search-input");
  const inboxFilterDate = document.getElementById("inbox-filter-date");
  const inboxSelectAllCb = document.getElementById("inbox-select-all-cb");
  const inboxBatchProcessBtn = document.getElementById("inbox-batch-process-btn");

  // PDF Preview elements
  const inboxPdfPrevBtn = document.getElementById("inbox-pdf-prev-btn");
  const inboxPdfNextBtn = document.getElementById("inbox-pdf-next-btn");
  const inboxPdfQuickProcessBtn = document.getElementById("inbox-pdf-quick-process-btn");
  const inboxPdfPreviewClose = document.getElementById("inbox-pdf-preview-close");
  const inboxPdfPreviewModal = document.getElementById("inbox-pdf-preview-modal");

  if (inboxAddAccountBtn) inboxAddAccountBtn.addEventListener("click", () => requestGmailAccountAuth());
  if (inboxGrantPermissionBtn) inboxGrantPermissionBtn.addEventListener("click", () => requestGmailAccountAuth());
  if (settingsAddGmailAccountBtn) settingsAddGmailAccountBtn.addEventListener("click", () => requestGmailAccountAuth());
  if (inboxRefreshBtn) inboxRefreshBtn.addEventListener("click", () => loadInboxData(false));

  document.addEventListener("click", (e) => {
    const reauthBtn = e.target.closest(".reauth-gmail-btn");
    if (reauthBtn) {
      e.preventDefault();
      e.stopPropagation();
      const email = reauthBtn.getAttribute("data-email");
      requestGmailAccountAuth(email);
    }
  });

  if (inboxAccountSelect) {
    inboxAccountSelect.addEventListener("change", () => loadInboxData(false));
  }

  if (inboxTabDetected) inboxTabDetected.addEventListener("click", () => setInboxSubtab("detected"));
  if (inboxTabActive) inboxTabActive.addEventListener("click", () => setInboxSubtab("active"));
  if (inboxTabSkipped) inboxTabSkipped.addEventListener("click", () => setInboxSubtab("skipped"));

  if (inboxSearchInput) inboxSearchInput.addEventListener("input", renderInboxList);
  if (inboxFilterDate) {
    inboxFilterDate.addEventListener("change", () => {
      if (currentInboxSubtab === "detected") {
        const visible = getVisibleInboxEmails();
        selectedInboxMessageIds.clear();
        visible.forEach((m) => selectedInboxMessageIds.add(m.id));
      }
      updateInboxBatchButton();
      renderInboxList();
    });
  }

  if (inboxSelectAllCb) {
    inboxSelectAllCb.addEventListener("change", () => {
      const visibleActive = getVisibleInboxEmails();
      if (inboxSelectAllCb.checked) {
        visibleActive.forEach((m) => selectedInboxMessageIds.add(m.id));
      } else {
        selectedInboxMessageIds.clear();
      }
      updateInboxBatchButton();
      renderInboxList();
    });
  }

  if (inboxBatchProcessBtn) {
    inboxBatchProcessBtn.addEventListener("click", processBatchSelectedEmails);
  }

  if (inboxPdfPrevBtn) inboxPdfPrevBtn.addEventListener("click", () => navigateInboxPdfPreview(-1));
  if (inboxPdfNextBtn) inboxPdfNextBtn.addEventListener("click", () => navigateInboxPdfPreview(1));
  if (inboxPdfPreviewClose) inboxPdfPreviewClose.addEventListener("click", closeInboxPdfPreview);

  if (inboxPdfQuickProcessBtn) {
    inboxPdfQuickProcessBtn.addEventListener("click", async () => {
      const visibleEmails = getVisibleInboxEmails();
      if (currentPreviewMailIndex < 0 || currentPreviewMailIndex >= visibleEmails.length) return;
      const mail = visibleEmails[currentPreviewMailIndex];
      await processSingleInboxEmail(mail, inboxPdfQuickProcessBtn);
      const updatedVisible = getVisibleInboxEmails();
      if (updatedVisible.length > 0) {
        const nextIdx = Math.min(currentPreviewMailIndex, updatedVisible.length - 1);
        openInboxPdfPreview(nextIdx, 0);
      } else {
        closeInboxPdfPreview();
      }
    });
  }

  if (inboxPdfPreviewModal) {
    inboxPdfPreviewModal.addEventListener("click", (e) => {
      if (e.target === inboxPdfPreviewModal) closeInboxPdfPreview();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (inboxPdfPreviewModal && inboxPdfPreviewModal.style.display !== "none") {
      if (e.key === "Escape") closeInboxPdfPreview();
      else if (e.key === "ArrowLeft") navigateInboxPdfPreview(-1);
      else if (e.key === "ArrowRight") navigateInboxPdfPreview(1);
    }
  });

  // Load initial accounts
  const accounts = getStoredGmailAccounts();
  updateAccountsDropdown(accounts);
}

export function getStoredGmailAccounts() {
  try {
    const raw = getClientSecret(STORAGE_KEYS.GMAIL_ACCOUNTS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveStoredGmailAccounts(accounts) {
  setClientSecret(STORAGE_KEYS.GMAIL_ACCOUNTS, JSON.stringify(accounts || []));
}

/**
 * Ensures that the given account has a valid access token.
 * If token is missing, expired, or expiring within 2 minutes, attempts silent refresh via GIS (prompt: '').
 */
export async function ensureAccountTokenValid(account, forceRefresh = false) {
  const isExpiringSoon = !account.expiresAt || (Date.now() > (account.expiresAt - 2 * 60 * 1000));
  if (!forceRefresh && !isExpiringSoon && account.accessToken && !account.needsReauth) {
    return { valid: true, accessToken: account.accessToken };
  }

  debugLog("GMAIL", `Token for ${account.email} needs refresh. Attempting silent GIS refresh...`);

  try {
    const data = await apiRequest("/api/auth/client-id");
    const clientId = data?.clientId;
    if (!clientId || !window.google?.accounts?.oauth2) {
      account.needsReauth = true;
      return { valid: false, needsReauth: true, error: "GIS nicht geladen" };
    }

    const tokenResponse = await new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ error: "timeout" });
        }
      }, 6000);

      try {
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
          include_granted_scopes: false,
          hint: account.email,
          prompt: "", // Silent mode (no user popup)
          callback: (res) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(res);
            }
          },
        });
        tokenClient.requestAccessToken({ prompt: "" });
      } catch (clientErr) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ error: clientErr.message });
        }
      }
    });

    if (tokenResponse && !tokenResponse.error && tokenResponse.access_token) {
      const accessToken = tokenResponse.access_token;
      const expiresIn = parseInt(tokenResponse.expires_in, 10) || 3599;
      const expiresAt = Date.now() + (expiresIn - 60) * 1000;

      account.accessToken = accessToken;
      account.expiresAt = expiresAt;
      account.needsReauth = false;

      // Update in storage
      const accounts = getStoredGmailAccounts();
      const idx = accounts.findIndex((a) => (a.id && a.id === account.id) || a.email.toLowerCase() === account.email.toLowerCase());
      if (idx >= 0) {
        accounts[idx] = { ...accounts[idx], accessToken, expiresAt, needsReauth: false };
        saveStoredGmailAccounts(accounts);
      }

      debugLog("GMAIL", `Silent refresh successful for ${account.email}! New expiry: ${new Date(expiresAt).toLocaleTimeString()}`);
      return { valid: true, accessToken };
    } else {
      debugLog("GMAIL", `Silent refresh failed for ${account.email}:`, tokenResponse?.error || "Unknown");
      account.needsReauth = true;
      const accounts = getStoredGmailAccounts();
      const idx = accounts.findIndex((a) => (a.id && a.id === account.id) || a.email.toLowerCase() === account.email.toLowerCase());
      if (idx >= 0) {
        accounts[idx].needsReauth = true;
        saveStoredGmailAccounts(accounts);
      }
      return { valid: false, needsReauth: true, error: tokenResponse?.error || "Silent refresh failed" };
    }
  } catch (err) {
    debugLog("GMAIL", `Silent refresh exception for ${account.email}:`, err);
    account.needsReauth = true;
    return { valid: false, needsReauth: true, error: err.message };
  }
}

export async function requestGmailAccountAuth(accountHint = null) {
  try {
    debugLog("GMAIL", "Fetching Google Client ID for Interactive Auth...");
    const data = await apiRequest("/api/auth/client-id");
    const clientId = data?.clientId;
    if (!clientId) {
      showToast("Google Client-ID konnte nicht geladen werden (gdrive_secret.json prüfen).", "error");
      return;
    }

    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      showToast("Google Identity Services lädt noch... Bitte kurz warten.", "warning");
      return;
    }

    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
      include_granted_scopes: false,
      hint: accountHint || undefined,
      callback: async (tokenResponse) => {
        if (tokenResponse.error) {
          debugLog("GMAIL", "Token error:", tokenResponse);
          if (tokenResponse.error !== "popup_closed_by_user") {
            showToast("Google-Anmeldung fehlgeschlagen: " + (tokenResponse.error_description || tokenResponse.error), "error");
          }
          return;
        }

        const accessToken = tokenResponse.access_token;
        const expiresIn = parseInt(tokenResponse.expires_in, 10) || 3599;
        const expiresAt = Date.now() + (expiresIn - 60) * 1000;

        try {
          const profRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const prof = await profRes.json();
          if (!prof || !prof.emailAddress) {
            throw new Error("Konnte E-Mail-Adresse nicht ermitteln.");
          }

          const accounts = getStoredGmailAccounts();
          const existingIdx = accounts.findIndex((a) => a.email.toLowerCase() === prof.emailAddress.toLowerCase());
          const accObj = {
            id: prof.emailAddress,
            email: prof.emailAddress,
            name: prof.emailAddress,
            accessToken: accessToken,
            expiresAt: expiresAt,
            needsReauth: false,
            connectedAt: new Date().toISOString(),
          };

          if (existingIdx >= 0) {
            accounts[existingIdx] = accObj;
          } else {
            accounts.push(accObj);
          }

          saveStoredGmailAccounts(accounts);
          updateAccountsDropdown(accounts);
          showToast(`Gmail-Konto ${prof.emailAddress} erfolgreich verbunden & reaktiviert!`, "success");
          await loadInboxData(false);
        } catch (profErr) {
          debugLog("GMAIL", "Profile error:", profErr);
          showToast("Fehler beim Abrufen des Gmail-Profils: " + profErr.message, "error");
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: accountHint ? "" : "select_account" });
  } catch (err) {
    debugLog("GMAIL", "Auth error:", err);
    showToast("Fehler bei der Gmail-Authentifizierung: " + err.message, "error");
  }
}

function updateAccountsDropdown(accounts) {
  inboxAccounts = accounts || [];
  const select = document.getElementById("inbox-account-select");
  if (!select) return;

  const currentVal = select.value || "all";
  select.innerHTML = `<option value="all">📥 Alle Posteingänge (${inboxAccounts.length || 0})</option>`;

  inboxAccounts.forEach((acc) => {
    const isExpired = acc.needsReauth || (acc.expiresAt && Date.now() > acc.expiresAt);
    const opt = document.createElement("option");
    opt.value = acc.id || acc.email;
    opt.innerText = `${isExpired ? "⚠️" : "✉️"} ${acc.email}${isExpired ? " (Re-Auth erforderlich)" : ""}`;
    select.appendChild(opt);
  });

  if (Array.from(select.options).some((o) => o.value === currentVal)) {
    select.value = currentVal;
  }

  // Update Settings Modal container if exists
  const settingsContainer = document.getElementById("gmail-accounts-container");
  if (settingsContainer) {
    settingsContainer.innerHTML = "";
    if (inboxAccounts.length === 0) {
      settingsContainer.innerHTML = `<div class="text-muted small">Noch keine Gmail-Konten im Browser verknüpft.</div>`;
    } else {
      inboxAccounts.forEach((acc) => {
        const isExpired = acc.needsReauth || (acc.expiresAt && Date.now() > acc.expiresAt);
        const expiresTimeStr = acc.expiresAt ? new Date(acc.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
        const item = document.createElement("div");
        item.className = "d-flex justify-content-between align-items-center p-2 rounded border bg-white small mb-2 flex-wrap gap-2";
        item.innerHTML = `
          <div class="d-flex align-items-center gap-2 text-truncate">
            <span class="material-symbols-outlined text-primary" style="font-size: 18px;">mail</span>
            <strong class="text-truncate">${escapeHtml(acc.email)}</strong>
            ${isExpired
              ? `<span class="badge bg-danger-subtle text-danger border border-danger-subtle" style="font-size: 10px;">Token abgelaufen</span>`
              : `<span class="badge bg-success-subtle text-success border border-success-subtle" style="font-size: 10px;">Aktiv (bis ${expiresTimeStr})</span>`
            }
          </div>
          <div class="d-flex align-items-center gap-2">
            ${isExpired ? `
              <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 reauth-gmail-btn d-inline-flex align-items-center gap-1" data-email="${escapeHtml(acc.email)}" style="font-size: 11px;">
                <span class="material-symbols-outlined" style="font-size: 14px;">lock_reset</span>
                <span>Reaktivieren</span>
              </button>
            ` : ""}
            <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2 remove-gmail-acc-btn" data-id="${acc.id}" style="font-size: 11px;">Trennen</button>
          </div>
        `;
        item.querySelector(".remove-gmail-acc-btn")?.addEventListener("click", () => {
          if (confirm(`Möchtest du das Google-Konto "${acc.email}" trennen?`)) {
            const updated = getStoredGmailAccounts().filter((a) => a.id !== acc.id && a.email !== acc.email);
            saveStoredGmailAccounts(updated);
            updateAccountsDropdown(updated);
            loadInboxData(false);
          }
        });
        settingsContainer.appendChild(item);
      });
    }
  }
}

export async function loadInboxData(silent = false) {
  const inboxLoadingContainer = document.getElementById("inbox-loading-container");
  const inboxEmailList = document.getElementById("inbox-email-list");
  const inboxEmptyContainer = document.getElementById("inbox-empty-container");
  const inboxErrorAlert = document.getElementById("inbox-error-alert");
  const inboxPermissionCard = document.getElementById("inbox-permission-card");

  let localSkipped = {};
  try {
    const raw = getClientSecret(STORAGE_KEYS.GMAIL_SKIPPED);
    if (raw) localSkipped = JSON.parse(raw);
  } catch (e) {}

  try {
    const skipRes = await apiRequest("/api/inbox/skipped").catch(() => null);
    if (skipRes && skipRes.skipped) {
      localSkipped = { ...skipRes.skipped, ...localSkipped };
      setClientSecret(STORAGE_KEYS.GMAIL_SKIPPED, JSON.stringify(localSkipped));
    }
  } catch (e) {}

  inboxSkippedEmails = Object.values(localSkipped).sort(
    (a, b) => new Date(b.skippedAt || b.date) - new Date(a.skippedAt || a.date)
  );

  const accounts = getStoredGmailAccounts();
  updateAccountsDropdown(accounts);

  if (!silent) {
    if (inboxLoadingContainer) inboxLoadingContainer.style.setProperty("display", "none", "important");
    if (inboxEmailList) inboxEmailList.style.setProperty("display", "none", "important");
    if (inboxEmptyContainer) inboxEmptyContainer.style.setProperty("display", "none", "important");
    if (inboxErrorAlert) inboxErrorAlert.style.setProperty("display", "none", "important");
    if (inboxPermissionCard) inboxPermissionCard.style.setProperty("display", "none", "important");
  }

  if (accounts.length === 0) {
    if (inboxPermissionCard) inboxPermissionCard.style.setProperty("display", "block", "important");
    updateCounterBadges(0, 0, inboxSkippedEmails.length);
    return;
  }

  if (!silent && inboxLoadingContainer) {
    inboxLoadingContainer.style.setProperty("display", "block", "important");
  }

  const selectedAccountVal = document.getElementById("inbox-account-select")?.value || "all";
  const targetAccounts = selectedAccountVal === "all" ? accounts : accounts.filter((a) => a.id === selectedAccountVal || a.email === selectedAccountVal);

  const scanQuery = "in:inbox filename:pdf";
  const allMails = [];
  const expiredAccounts = [];

  for (const account of targetAccounts) {
    try {
      const res = await fetchAccountEmailsDirect(account, scanQuery);
      if (res.expired) {
        expiredAccounts.push(account);
      } else if (res.emails) {
        res.emails.forEach((mail) => {
          if (!localSkipped[mail.id]) {
            allMails.push(mail);
          }
        });
      }
    } catch (err) {
      debugLog("GMAIL", `Error loading account ${account.email}:`, err);
    }
  }

  if (!silent && inboxLoadingContainer) {
    inboxLoadingContainer.style.setProperty("display", "none", "important");
  }

  if (expiredAccounts.length > 0) {
    if (inboxErrorAlert) {
      const errorTextEl = document.getElementById("inbox-error-text");
      if (errorTextEl) {
        errorTextEl.innerHTML = `
          <div class="d-flex flex-column gap-2">
            <div><strong>Anmeldung abgelaufen:</strong> Die Sitzung für ${expiredAccounts.length === 1 ? 'folgendes Google-Konto' : 'folgende Google-Konten'} muss bestätigt werden:</div>
            <div class="d-flex flex-wrap gap-2">
              ${expiredAccounts.map((acc) => `
                <button type="button" class="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1 reauth-gmail-btn" data-email="${escapeHtml(acc.email)}" style="font-size: 12px; font-weight: 500; border-radius: 6px;">
                  <span class="material-symbols-outlined" style="font-size: 16px;">lock_reset</span>
                  <span>${escapeHtml(acc.email)} reaktivieren</span>
                </button>
              `).join("")}
            </div>
          </div>
        `;
      }
      inboxErrorAlert.style.setProperty("display", "block", "important");
    }
  } else {
    if (inboxErrorAlert) inboxErrorAlert.style.setProperty("display", "none", "important");
  }

  inboxActiveEmails = allMails.sort((a, b) => new Date(b.date) - new Date(a.date));

  const detectedCount = inboxActiveEmails.filter((m) => m.isDetected).length;
  updateCounterBadges(detectedCount, inboxActiveEmails.length, inboxSkippedEmails.length);

  // Auto-select detected on load if on detected tab
  if (currentInboxSubtab === "detected") {
    const visible = getVisibleInboxEmails();
    selectedInboxMessageIds.clear();
    visible.forEach((m) => selectedInboxMessageIds.add(m.id));
  }

  updateInboxBatchButton();
  renderInboxList();
}

function updateCounterBadges(detected, active, skipped) {
  const cd = document.getElementById("inbox-count-detected");
  const ca = document.getElementById("inbox-count-active");
  const cs = document.getElementById("inbox-count-skipped");
  const navBadge = document.getElementById("nav-inbox-badge");

  if (cd) cd.innerText = detected;
  if (ca) ca.innerText = active;
  if (cs) cs.innerText = skipped;
  if (navBadge) {
    navBadge.innerText = detected;
    navBadge.style.display = detected > 0 ? "inline-block" : "none";
  }
}

async function fetchAccountEmailsDirect(account, query) {
  // 1. Validate & Silent Refresh if needed
  const tokenCheck = await ensureAccountTokenValid(account);
  if (!tokenCheck.valid) {
    return { expired: true, account, emails: [] };
  }

  let currentToken = tokenCheck.accessToken;
  const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=30`;
  let res = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${currentToken}` },
  });

  // If 401 Unauthorized, attempt forced silent refresh once
  if (res.status === 401) {
    debugLog("GMAIL", `Received 401 for ${account.email}. Attempting forced silent refresh...`);
    const retryCheck = await ensureAccountTokenValid(account, true);
    if (!retryCheck.valid) {
      return { expired: true, account, emails: [] };
    }
    currentToken = retryCheck.accessToken;
    res = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });
    if (!res.ok) {
      return { expired: true, account, emails: [] };
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail API Fehler (${res.status}): ${errText}`);
  }

  const listData = await res.json();
  const messages = listData.messages || [];
  if (messages.length === 0) return { expired: false, account, emails: [] };

  const detailPromises = messages.map(async (item) => {
    try {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (!msgRes.ok) return null;
      const msg = await msgRes.json();

      const headers = msg.payload?.headers || [];
      const getHeader = (name) => {
        const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
        return h ? h.value : "";
      };

      const subject = getHeader("Subject") || "(Kein Betreff)";
      const fromRaw = getHeader("From") || "Unbekannt";
      let fromName = fromRaw;
      let fromEmail = fromRaw;
      const emailMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/);
      if (emailMatch) {
        fromName = emailMatch[1].replace(/^["']|["']$/g, "").trim() || emailMatch[2];
        fromEmail = emailMatch[2];
      }

      const dateHeader = getHeader("Date");
      let dateIso = new Date().toISOString();
      if (dateHeader) {
        const parsedDate = new Date(dateHeader);
        if (!isNaN(parsedDate.getTime())) dateIso = parsedDate.toISOString();
      } else if (msg.internalDate) {
        dateIso = new Date(parseInt(msg.internalDate, 10)).toISOString();
      }

      const allFoundPdfs = [];
      extractPdfPartsFromPayload(msg.payload?.parts || [], allFoundPdfs);
      if (allFoundPdfs.length === 0) return null;

      const checkText = `${subject} ${fromName} ${fromEmail} ${msg.snippet || ""} ${allFoundPdfs.map((a) => a.filename).join(" ")}`.toLowerCase();
      const detectedKeywords = ["rechnung", "invoice", "beleg", "abrechnung", "gutschrift", "quittung", "honorarrechnung", "payment", "zahlungsbeleg", "auftragsbestätigung"];
      const isDetected = detectedKeywords.some((kw) => checkText.includes(kw));

      return {
        id: msg.id,
        accountId: account.id,
        accountEmail: account.email,
        subject,
        fromRaw,
        fromName,
        fromEmail,
        date: dateIso,
        snippet: msg.snippet || "",
        attachments: allFoundPdfs,
        isDetected,
      };
    } catch (e) {
      return null;
    }
  });

  const resolved = await Promise.all(detailPromises);
  return {
    expired: false,
    account,
    emails: resolved.filter(Boolean),
  };
}

function extractPdfPartsFromPayload(parts, found = []) {
  if (!parts || !Array.isArray(parts)) return found;
  for (const part of parts) {
    const filename = part.filename || "";
    const mimeType = (part.mimeType || "").toLowerCase();
    const isPdf = mimeType === "application/pdf" || mimeType === "application/x-pdf" || filename.toLowerCase().endsWith(".pdf");
    if (isPdf && part.body) {
      found.push({
        filename: filename || "Anhang.pdf",
        mimeType: mimeType || "application/pdf",
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId || null,
        data: part.body.data || null,
      });
    }
    if (part.parts) {
      extractPdfPartsFromPayload(part.parts, found);
    }
  }
  return found;
}

function setInboxSubtab(tabName) {
  currentInboxSubtab = tabName;

  const tabs = [
    { name: "detected", btn: document.getElementById("inbox-tab-detected") },
    { name: "active", btn: document.getElementById("inbox-tab-active") },
    { name: "skipped", btn: document.getElementById("inbox-tab-skipped") },
  ];

  tabs.forEach((t) => {
    if (!t.btn) return;
    if (t.name === tabName) {
      t.btn.classList.add("btn-primary", "active");
      t.btn.classList.remove("btn-outline-secondary");
    } else {
      t.btn.classList.remove("btn-primary", "active");
      t.btn.classList.add("btn-outline-secondary");
    }
  });

  const selectionControls = document.getElementById("inbox-selection-controls");
  const batchBtn = document.getElementById("inbox-batch-process-btn");

  if (tabName === "skipped") {
    if (selectionControls) selectionControls.style.display = "none";
    if (batchBtn) batchBtn.style.display = "none";
  } else {
    if (selectionControls) selectionControls.style.display = "flex";
    if (batchBtn) batchBtn.style.display = "inline-flex";
  }

  if (tabName === "detected") {
    const visible = getVisibleInboxEmails();
    selectedInboxMessageIds.clear();
    visible.forEach((m) => selectedInboxMessageIds.add(m.id));
  }

  updateInboxBatchButton();
  renderInboxList();
}

function getVisibleInboxEmails() {
  let sourceList = [];
  if (currentInboxSubtab === "detected") {
    sourceList = inboxActiveEmails.filter((m) => m.isDetected);
  } else if (currentInboxSubtab === "active") {
    sourceList = inboxActiveEmails;
  } else if (currentInboxSubtab === "skipped") {
    sourceList = inboxSkippedEmails;
  }

  const searchInput = document.getElementById("inbox-search-input");
  const filterDate = document.getElementById("inbox-filter-date");
  const q = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const dateFilter = filterDate ? filterDate.value : "alle";

  return sourceList.filter((m) => {
    if (!matchDateFilter(m.date, dateFilter)) return false;

    if (q) {
      const subject = (m.subject || "").toLowerCase();
      const fromName = (m.fromName || "").toLowerCase();
      const fromEmail = (m.fromEmail || "").toLowerCase();
      const snippet = (m.snippet || "").toLowerCase();
      const attNames = (m.attachments || []).map((a) => (a.filename || "").toLowerCase()).join(" ");
      const acc = (m.accountEmail || m.accountId || "").toLowerCase();
      if (!subject.includes(q) && !fromName.includes(q) && !fromEmail.includes(q) && !snippet.includes(q) && !attNames.includes(q) && !acc.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

function matchDateFilter(dateStr, filterVal) {
  if (!dateStr || filterVal === "alle") return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (filterVal === "today") return itemDay.getTime() === today.getTime();
  if (filterVal === "yesterday_today") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return itemDay.getTime() >= yesterday.getTime();
  }
  if (filterVal === "7days") {
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return itemDay.getTime() >= sevenDaysAgo.getTime();
  }
  if (filterVal === "30days") {
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return itemDay.getTime() >= thirtyDaysAgo.getTime();
  }
  if (filterVal === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (filterVal === "year2026") return d.getFullYear() === 2026;
  if (filterVal === "year2025") return d.getFullYear() === 2025;
  if (filterVal === "older") return d.getFullYear() < 2025;
  return true;
}

function updateInboxBatchButton() {
  const batchBtn = document.getElementById("inbox-batch-process-btn");
  const countSpan = document.getElementById("inbox-selected-count");
  if (!batchBtn) return;
  const count = selectedInboxMessageIds.size;
  if (countSpan) countSpan.innerText = count;
  batchBtn.disabled = count === 0 || isProcessingInboxBatch;
}

function renderInboxList() {
  const container = document.getElementById("inbox-email-list");
  const emptyContainer = document.getElementById("inbox-empty-container");
  if (!container) return;

  const visibleEmails = getVisibleInboxEmails();

  if (visibleEmails.length === 0) {
    container.style.setProperty("display", "none", "important");
    if (emptyContainer) emptyContainer.style.setProperty("display", "block", "important");
    return;
  }

  if (emptyContainer) emptyContainer.style.setProperty("display", "none", "important");
  container.style.setProperty("display", "flex", "important");
  container.innerHTML = "";

  visibleEmails.forEach((mail) => {
    const isSelected = selectedInboxMessageIds.has(mail.id);
    const isSkippedTab = currentInboxSubtab === "skipped";
    const attachments = mail.attachments || [];

    const card = document.createElement("div");
    card.className = `card shadow-sm border p-3 inbox-email-card ${isSelected ? "border-primary bg-primary-subtle" : "bg-white"}`;
    card.style.borderRadius = "12px";

    const attPillsHtml = attachments
      .map((att, idx) => `
        <span class="badge bg-light text-dark border p-2 d-inline-flex align-items-center gap-1 preview-att-btn" data-mail-id="${mail.id}" data-att-idx="${idx}" style="cursor: pointer;" title="Vorschau öffnen">
          <span class="material-symbols-outlined text-danger" style="font-size: 16px;">picture_as_pdf</span>
          <span class="fw-medium">${escapeHtml(att.filename)}</span>
          <span class="text-muted small">(${formatFileSize(att.size)})</span>
        </span>`)
      .join(" ");

    card.innerHTML = `
      <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
        <div class="d-flex align-items-start gap-3 flex-grow-1" style="min-width: 260px;">
          ${!isSkippedTab ? `
            <div class="pt-1">
              <input type="checkbox" class="form-check-input mail-select-cb" data-mail-id="${mail.id}" ${isSelected ? "checked" : ""} style="cursor: pointer; width: 18px; height: 18px;" />
            </div>` : ""}
          <div class="flex-grow-1" style="min-width: 0;">
            <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
              <span class="badge bg-secondary-subtle text-secondary small" style="font-size: 11px;">${escapeHtml(mail.accountEmail || mail.accountId)}</span>
              ${mail.isDetected ? `<span class="badge bg-success-subtle text-success border border-success-subtle" style="font-size: 11px;">🔍 Rechnung erkannt</span>` : ""}
              <span class="text-muted small ms-auto">${formatDateDisplay(mail.date)}</span>
            </div>
            <h6 class="fw-bold mb-1 text-dark text-truncate" title="${escapeHtml(mail.subject)}">${escapeHtml(mail.subject || "(Kein Betreff)")}</h6>
            <div class="small text-muted mb-2">Von: <strong>${escapeHtml(mail.fromName || mail.fromEmail)}</strong> &lt;${escapeHtml(mail.fromEmail)}&gt;</div>
            <div class="small text-secondary mb-2 text-truncate" style="max-width: 650px;">${escapeHtml(mail.snippet)}</div>
            <div class="d-flex flex-wrap gap-1 mt-2">${attPillsHtml}</div>
          </div>
        </div>
        <div class="d-flex align-items-center gap-2 ms-auto">
          ${!isSkippedTab ? `
            <button type="button" class="btn btn-sm btn-outline-secondary skip-single-mail-btn" data-mail-id="${mail.id}" title="Nicht verarbeiten / ignorieren">
              <span class="material-symbols-outlined" style="font-size: 15px;">playlist_remove</span>
              <span>Überspringen</span>
            </button>
            <button type="button" class="btn btn-sm btn-primary process-single-mail-btn" data-mail-id="${mail.id}">
              <span class="material-symbols-outlined" style="font-size: 15px;">play_arrow</span>
              <span>Importieren (${attachments.length})</span>
            </button>
          ` : `
            <button type="button" class="btn btn-sm btn-outline-primary unskip-single-mail-btn" data-mail-id="${mail.id}">
              <span class="material-symbols-outlined" style="font-size: 15px;">restore_from_trash</span>
              <span>Wiederherstellen</span>
            </button>
          `}
        </div>
      </div>
    `;

    card.querySelector(".mail-select-cb")?.addEventListener("change", (e) => {
      if (e.target.checked) selectedInboxMessageIds.add(mail.id);
      else selectedInboxMessageIds.delete(mail.id);
      updateInboxBatchButton();
      renderInboxList();
    });

    card.querySelectorAll(".preview-att-btn").forEach((pBtn) => {
      pBtn.addEventListener("click", () => {
        const attIdx = parseInt(pBtn.getAttribute("data-att-idx"), 10) || 0;
        openInboxPdfPreview(mail, attIdx);
      });
    });

    card.querySelector(".skip-single-mail-btn")?.addEventListener("click", async () => {
      await skipInboxEmail(mail);
    });

    card.querySelector(".process-single-mail-btn")?.addEventListener("click", async (e) => {
      await processSingleInboxEmail(mail, e.currentTarget);
    });

    card.querySelector(".unskip-single-mail-btn")?.addEventListener("click", async () => {
      await unskipInboxEmail(mail.id);
    });

    container.appendChild(card);
  });
}

async function skipInboxEmail(mail) {
  try {
    let localSkipped = {};
    const raw = getClientSecret(STORAGE_KEYS.GMAIL_SKIPPED);
    if (raw) localSkipped = JSON.parse(raw);

    localSkipped[mail.id] = {
      ...mail,
      skippedAt: new Date().toISOString(),
    };
    setClientSecret(STORAGE_KEYS.GMAIL_SKIPPED, JSON.stringify(localSkipped));

    await apiRequest("/api/inbox/skipped", {
      method: "POST",
      body: JSON.stringify({ id: mail.id, subject: mail.subject, fromName: mail.fromName, date: mail.date, attachments: mail.attachments }),
    });

    selectedInboxMessageIds.delete(mail.id);
    showToast(`E-Mail "${mail.subject}" übersprungen.`, "info");
    await loadInboxData(false);
  } catch (err) {
    showToast("Fehler beim Überspringen: " + err.message, "error");
  }
}

async function unskipInboxEmail(mailId) {
  try {
    let localSkipped = {};
    const raw = getClientSecret(STORAGE_KEYS.GMAIL_SKIPPED);
    if (raw) localSkipped = JSON.parse(raw);
    delete localSkipped[mailId];
    setClientSecret(STORAGE_KEYS.GMAIL_SKIPPED, JSON.stringify(localSkipped));

    await apiRequest(`/api/inbox/skipped/${mailId}`, { method: "DELETE" });
    showToast("E-Mail wiederhergestellt.", "success");
    await loadInboxData(false);
  } catch (err) {
    showToast("Fehler beim Wiederherstellen: " + err.message, "error");
  }
}

async function processSingleInboxEmail(mail, btnElement = null) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Verarbeite...`;
  }

  try {
    const accounts = getStoredGmailAccounts();
    const account = accounts.find((a) => a.id === mail.accountId || a.email === mail.accountEmail) || accounts[0];
    if (!account) throw new Error("Kein Google-Konto verknüpft.");

    const formData = new FormData();
    formData.append("gmailMessageId", mail.id);
    formData.append("source", "gmail");

    for (const att of mail.attachments || []) {
      const blob = await getGmailAttachmentBlob(account, mail.id, att);
      formData.append("files", blob, att.filename || "Anhang.pdf");
    }

    const data = await apiRequest("/api/upload", {
      method: "POST",
      body: formData,
    });

    if (data.success) {
      showToast(`${mail.attachments?.length || 1} PDF-Anhang/Anhänge zur Pipeline hinzugefügt!`, "success");

      // Auto-archive if enabled
      const archiveCb = document.getElementById("inbox-archive-toggle");
      if (archiveCb && archiveCb.checked) {
        await archiveGmailMessage(account, mail.id).catch(() => {});
      }

      await skipInboxEmail(mail);
    }
  } catch (err) {
    showToast("Fehler beim Verarbeiten: " + err.message, "error");
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = `<span class="material-symbols-outlined" style="font-size: 15px;">play_arrow</span><span>Importieren</span>`;
    }
  }
}

async function processBatchSelectedEmails() {
  const visible = getVisibleInboxEmails();
  const toProcess = visible.filter((m) => selectedInboxMessageIds.has(m.id));
  if (toProcess.length === 0) return;

  isProcessingInboxBatch = true;
  updateInboxBatchButton();

  showToast(`Verarbeite ${toProcess.length} ausgewählte E-Mails...`, "info");
  for (const mail of toProcess) {
    await processSingleInboxEmail(mail);
  }

  isProcessingInboxBatch = false;
  selectedInboxMessageIds.clear();
  updateInboxBatchButton();
  showToast("Stapelverarbeitung abgeschlossen!", "success");
}

async function archiveGmailMessage(account, messageId) {
  try {
    const tokenCheck = await ensureAccountTokenValid(account);
    const token = tokenCheck.valid ? tokenCheck.accessToken : account.accessToken;
    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
    });
  } catch (e) {}
}

function base64UrlToUint8Array(base64Url) {
  let base64 = String(base64Url).replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function getGmailAttachmentBlob(account, messageId, attachment) {
  if (attachment.data) {
    const bytes = base64UrlToUint8Array(attachment.data);
    return new Blob([bytes], { type: attachment.mimeType || "application/pdf" });
  }

  const tokenCheck = await ensureAccountTokenValid(account);
  const token = tokenCheck.valid ? tokenCheck.accessToken : account.accessToken;

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachment.attachmentId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Fehler beim Herunterladen des Anhangs (${res.status})`);
  const data = await res.json();
  const bytes = base64UrlToUint8Array(data.data);
  return new Blob([bytes], { type: attachment.mimeType || "application/pdf" });
}

export async function openInboxPdfPreview(mailOrId, attIndex = 0) {
  const modal = document.getElementById("inbox-pdf-preview-modal");
  const iframe = document.getElementById("inbox-pdf-preview-iframe");
  const title = document.getElementById("inbox-pdf-preview-title");
  const subtitle = document.getElementById("inbox-pdf-preview-subtitle");
  const counter = document.getElementById("inbox-pdf-preview-counter");
  const prevBtn = document.getElementById("inbox-pdf-prev-btn");
  const nextBtn = document.getElementById("inbox-pdf-next-btn");
  const downloadBtn = document.getElementById("inbox-pdf-download-btn");
  const extBtn = document.getElementById("inbox-pdf-external-btn");
  const loading = document.getElementById("inbox-pdf-loading");

  if (!modal || !iframe) return;

  const visibleEmails = getVisibleInboxEmails();
  let mail = typeof mailOrId === "object" ? mailOrId : visibleEmails.find((m) => m.id === mailOrId);
  if (!mail) return;

  currentPreviewMailIndex = visibleEmails.findIndex((m) => m.id === mail.id);
  const attachments = mail.attachments || [];
  if (attachments.length === 0) return;

  currentPreviewAttIndex = Math.max(0, Math.min(attIndex, attachments.length - 1));
  const currentAtt = attachments[currentPreviewAttIndex];

  if (title) title.innerText = currentAtt.filename || "Vorschau";
  if (subtitle) subtitle.innerText = `${mail.subject || "(Kein Betreff)"} • Von: ${mail.fromName || mail.fromEmail} • ${formatDateDisplay(mail.date)} • ${formatFileSize(currentAtt.size)}`;
  if (counter) counter.innerText = `${currentPreviewMailIndex + 1} / ${visibleEmails.length}`;
  if (prevBtn) prevBtn.disabled = currentPreviewMailIndex <= 0;
  if (nextBtn) nextBtn.disabled = currentPreviewMailIndex >= visibleEmails.length - 1;

  if (loading) loading.style.setProperty("display", "block", "important");
  modal.style.setProperty("display", "flex", "important");

  try {
    const accounts = getStoredGmailAccounts();
    const account = accounts.find((a) => a.id === mail.accountId || a.email === mail.accountEmail) || accounts[0];
    const blob = await getGmailAttachmentBlob(account, mail.id, currentAtt);
    if (currentBlobPreviewUrl) URL.revokeObjectURL(currentBlobPreviewUrl);
    currentBlobPreviewUrl = URL.createObjectURL(blob);

    if (downloadBtn) {
      downloadBtn.href = currentBlobPreviewUrl;
      downloadBtn.setAttribute("download", currentAtt.filename || "Dokument.pdf");
    }
    if (extBtn) extBtn.href = currentBlobPreviewUrl;

    iframe.onload = () => {
      if (loading) loading.style.setProperty("display", "none", "important");
    };
    iframe.src = currentBlobPreviewUrl;
  } catch (e) {
    if (loading) loading.style.setProperty("display", "none", "important");
    showToast("Vorschau konnte nicht geladen werden: " + e.message, "error");
  }
}

function navigateInboxPdfPreview(dir) {
  const visible = getVisibleInboxEmails();
  const nextIdx = currentPreviewMailIndex + dir;
  if (nextIdx >= 0 && nextIdx < visible.length) {
    openInboxPdfPreview(visible[nextIdx], 0);
  }
}

function closeInboxPdfPreview() {
  const modal = document.getElementById("inbox-pdf-preview-modal");
  const iframe = document.getElementById("inbox-pdf-preview-iframe");
  if (modal) modal.style.setProperty("display", "none", "important");
  if (iframe) iframe.src = "";
  if (currentBlobPreviewUrl) {
    URL.revokeObjectURL(currentBlobPreviewUrl);
    currentBlobPreviewUrl = null;
  }
}
