const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { SKIPPED_EMAILS_FILE, CREDENTIALS_FILE, STORE_DIR } = require("../config/paths");

const GMAIL_ACCOUNTS_FILE = path.join(STORE_DIR, "gmail_accounts.json");

let skippedEmails = {};
let gmailAccounts = [];

function loadSkippedEmails() {
  if (fs.existsSync(SKIPPED_EMAILS_FILE)) {
    try {
      skippedEmails = JSON.parse(fs.readFileSync(SKIPPED_EMAILS_FILE, "utf8"));
    } catch (e) {
      console.error("[GMAIL] Fehler beim Laden der skipped_emails.json:", e);
    }
  }
}

function saveSkippedEmails() {
  try {
    fs.promises
      .writeFile(SKIPPED_EMAILS_FILE, JSON.stringify(skippedEmails, null, 2))
      .catch((err) => {
        console.error("[GMAIL] Fehler beim Speichern von skipped_emails.json:", err);
      });
  } catch (e) {}
}

loadSkippedEmails();

function loadGmailAccounts() {
  if (fs.existsSync(GMAIL_ACCOUNTS_FILE)) {
    try {
      gmailAccounts = JSON.parse(fs.readFileSync(GMAIL_ACCOUNTS_FILE, "utf8"));
    } catch (e) {
      console.error("[GMAIL] Fehler beim Laden der gmail_accounts.json:", e);
      gmailAccounts = [];
    }
  }
}

function saveGmailAccounts() {
  try {
    fs.promises
      .writeFile(GMAIL_ACCOUNTS_FILE, JSON.stringify(gmailAccounts, null, 2))
      .catch((err) => {
        console.error("[GMAIL] Fehler beim Speichern von gmail_accounts.json:", err);
      });
  } catch (e) {}
}

loadGmailAccounts();

function getOAuthClient() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    throw new Error("gdrive_secret.json nicht gefunden.");
  }
  const content = fs.readFileSync(CREDENTIALS_FILE, "utf8");
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  if (!key) throw new Error("Ungültiges gdrive_secret.json Format.");
  return new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    "postmessage"
  );
}

async function exchangeCodeForGmailAccount(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens || !tokens.access_token) {
    throw new Error("Keine Token von Google erhalten.");
  }

  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data?.emailAddress;
  if (!email) {
    throw new Error("Konnte E-Mail-Adresse nicht von Google abrufen.");
  }

  const existingIdx = gmailAccounts.findIndex((a) => a.email.toLowerCase() === email.toLowerCase());
  const existingAccount = existingIdx >= 0 ? gmailAccounts[existingIdx] : null;
  const refreshToken = tokens.refresh_token || (existingAccount && existingAccount.refreshToken);

  const accountData = {
    id: email,
    email: email,
    name: email,
    refreshToken: refreshToken || null,
    accessToken: tokens.access_token,
    expiresAt: tokens.expiry_date || (Date.now() + 3500 * 1000),
    connectedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    gmailAccounts[existingIdx] = accountData;
  } else {
    gmailAccounts.push(accountData);
  }
  saveGmailAccounts();

  return {
    email: accountData.email,
    accessToken: accountData.accessToken,
    expiresAt: accountData.expiresAt,
    hasRefreshToken: !!accountData.refreshToken,
  };
}

async function refreshGmailAccountToken(email) {
  if (!email) throw new Error("Keine E-Mail-Adresse übergeben.");
  const account = gmailAccounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!account || !account.refreshToken) {
    throw new Error("Kein Refresh-Token auf dem Server für " + email);
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: account.refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();

  account.accessToken = credentials.access_token;
  account.expiresAt = credentials.expiry_date || (Date.now() + 3500 * 1000);
  if (credentials.refresh_token) {
    account.refreshToken = credentials.refresh_token;
  }
  saveGmailAccounts();

  return {
    email: account.email,
    accessToken: account.accessToken,
    expiresAt: account.expiresAt,
  };
}

function removeGmailAccount(email) {
  if (!email) return;
  gmailAccounts = gmailAccounts.filter((a) => a.email.toLowerCase() !== email.toLowerCase());
  saveGmailAccounts();
}

function getAllSkipped() {
  return skippedEmails;
}

function addSkipped(id, mailData) {
  const mailId = id || (mailData && mailData.id);
  if (!mailId) throw new Error("Keine Mail-ID angegeben.");
  skippedEmails[mailId] = mailData || { id: mailId, skippedAt: new Date().toISOString() };
  saveSkippedEmails();
  return skippedEmails;
}

function removeSkipped(mailId) {
  if (mailId && skippedEmails[mailId]) {
    delete skippedEmails[mailId];
    saveSkippedEmails();
  }
  return skippedEmails;
}

module.exports = {
  loadSkippedEmails,
  saveSkippedEmails,
  getAllSkipped,
  addSkipped,
  removeSkipped,
  exchangeCodeForGmailAccount,
  refreshGmailAccountToken,
  removeGmailAccount,
};
