/**
 * Client-Side Gmail Scanner (Zero-Trust)
 */
import { escapeHtml, formatDateDisplay, showToast } from "./utils.js";
import { STORAGE_KEYS, getClientSecret, setClientSecret } from "./state.js";
import { apiRequest } from "./api.js";

let tokenClient = null;

export function initGmailGIS(clientId) {
  if (!clientId || !window.google?.accounts?.oauth2) return;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
    callback: async (tokenResponse) => {
      if (tokenResponse.access_token) {
        await handleGmailTokenReceived(tokenResponse.access_token);
      }
    },
  });
}

export function requestGmailAuth() {
  if (tokenClient) {
    tokenClient.requestAccessToken({ prompt: "consent" });
  } else {
    showToast("Google Identity Services lädt noch...", "warning");
  }
}

async function handleGmailTokenReceived(accessToken) {
  try {
    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) throw new Error("Profil konnte nicht geladen werden.");
    const profile = await profileRes.json();

    const accounts = getStoredGmailAccounts();
    const existingIdx = accounts.findIndex((a) => a.email === profile.emailAddress);
    const accountData = {
      email: profile.emailAddress,
      token: accessToken,
      connectedAt: new Date().toISOString(),
      expiresAt: Date.now() + 3500 * 1000,
    };

    if (existingIdx >= 0) {
      accounts[existingIdx] = accountData;
    } else {
      accounts.push(accountData);
    }

    setClientSecret(STORAGE_KEYS.GMAIL_ACCOUNTS, JSON.stringify(accounts));
    showToast(`Gmail-Konto verbunden: ${profile.emailAddress}`, "success");
    loadInboxData();
  } catch (err) {
    showToast(`Fehler beim Verbinden: ${err.message}`, "error");
  }
}

export function getStoredGmailAccounts() {
  try {
    const raw = getClientSecret(STORAGE_KEYS.GMAIL_ACCOUNTS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export async function loadInboxData() {
  const container = document.getElementById("inbox-messages-list");
  if (!container) return;

  // Load server-persisted skipped emails
  let serverSkipped = {};
  try {
    const res = await apiRequest("/api/inbox/skipped");
    if (res && res.skipped) serverSkipped = res.skipped;
  } catch (e) {}

  let localSkipped = {};
  try {
    const raw = getClientSecret(STORAGE_KEYS.GMAIL_SKIPPED);
    if (raw) localSkipped = JSON.parse(raw);
  } catch (e) {}

  const mergedSkipped = { ...serverSkipped, ...localSkipped };
  setClientSecret(STORAGE_KEYS.GMAIL_SKIPPED, JSON.stringify(mergedSkipped));

  const accounts = getStoredGmailAccounts();
  if (accounts.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-muted">Keine Gmail-Konten verbunden. Klicke oben auf "+ Gmail-Konto verbinden".</div>`;
    return;
  }

  container.innerHTML = `<div class="p-8 text-center text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Lade Posteingänge...</div>`;

  const allMails = [];
  for (const acc of accounts) {
    try {
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox filename:pdf&maxResults=30`,
        { headers: { Authorization: `Bearer ${acc.token}` } }
      );
      if (listRes.status === 401) {
        acc.expired = true;
        continue;
      }
      const listData = await listRes.json();
      for (const msg of listData.messages || []) {
        if (mergedSkipped[msg.id]) continue;
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${acc.token}` } }
        );
        if (!msgRes.ok) continue;
        const msgData = await msgRes.json();
        const headers = msgData.payload?.headers || [];
        const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "Kein Betreff";
        const from = headers.find((h) => h.name.toLowerCase() === "from")?.value || "Unbekannt";
        const date = headers.find((h) => h.name.toLowerCase() === "date")?.value || "";

        const pdfParts = [];
        extractPdfParts(msgData.payload?.parts || [], pdfParts);

        if (pdfParts.length > 0) {
          allMails.push({
            id: msg.id,
            accountEmail: acc.email,
            subject,
            from,
            date,
            snippet: msgData.snippet || "",
            pdfParts,
          });
        }
      }
    } catch (e) {}
  }

  renderInboxList(container, allMails);
}

function extractPdfParts(parts, result = []) {
  for (const p of parts) {
    if (p.filename && p.filename.toLowerCase().endsWith(".pdf") && p.body?.attachmentId) {
      result.push({ filename: p.filename, attachmentId: p.body.attachmentId, size: p.body.size });
    }
    if (p.parts) extractPdfParts(p.parts, result);
  }
}

function renderInboxList(container, mails) {
  if (mails.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-muted">Keine neuen E-Mails mit PDF-Belegen im Posteingang gefunden.</div>`;
    return;
  }

  container.innerHTML = mails
    .map(
      (m) => `
    <div class="card mb-3 p-3 shadow-sm inbox-item-card" data-id="${m.id}">
      <div class="d-flex justify-content-between align-items-start">
        <div>
          <span class="badge bg-secondary mb-1">${escapeHtml(m.accountEmail)}</span>
          <h6 class="mb-1 text-dark fw-bold">${escapeHtml(m.subject)}</h6>
          <div class="text-muted small mb-2">Von: <strong>${escapeHtml(m.from)}</strong> &bull; ${escapeHtml(m.date)}</div>
          <div class="text-secondary small text-truncate" style="max-width: 600px;">${escapeHtml(m.snippet)}</div>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-secondary skip-mail-btn" data-id="${m.id}">Überspringen</button>
          <button class="btn btn-sm btn-primary import-mail-btn" data-id="${m.id}">Importieren (${m.pdfParts.length} PDF)</button>
        </div>
      </div>
    </div>`
    )
    .join("");

  container.querySelectorAll(".skip-mail-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await skipEmail(id);
    });
  });
}

async function skipEmail(mailId) {
  try {
    const raw = getClientSecret(STORAGE_KEYS.GMAIL_SKIPPED);
    const skipped = raw ? JSON.parse(raw) : {};
    skipped[mailId] = { id: mailId, skippedAt: new Date().toISOString() };
    setClientSecret(STORAGE_KEYS.GMAIL_SKIPPED, JSON.stringify(skipped));

    await apiRequest("/api/inbox/skipped", {
      method: "POST",
      body: JSON.stringify({ id: mailId }),
    });

    showToast("E-Mail übersprungen.", "info");
    loadInboxData();
  } catch (e) {
    showToast("Fehler beim Überspringen: " + e.message, "error");
  }
}
