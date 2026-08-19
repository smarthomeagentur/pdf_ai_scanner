const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.modify",
];

const INVOICE_PATTERNS = [
  /rechnung/i,
  /rechnungen/i,
  /rechnungsnummer/i,
  /rechnungsbeleg/i,
  /invoice/i,
  /invoices/i,
  /receipt/i,
  /receipts/i,
  /receipe/i,
  /beleg/i,
  /belege/i,
  /abrechnung/i,
  /quittung/i,
  /gutschrift/i,
  /payment/i,
  /zahlung/i,
  /bestellbestätigung/i,
  /order/i,
  /auftrag/i,
  /bill/i,
  /tax/i,
  /gebühr/i,
  /honorarnote/i,
  /entgelt/i,
  /subscription/i,
  /statement/i,
  /kontoauszug/i,
  /inv[-_]?\d+/i,
  /re[-_]?\d+/i,
  /rg[-_]?\d+/i,
];

class GmailAPI {
  constructor(tokenPath, credentialsPath, accountsPath) {
    this.tokenPath = tokenPath;
    this.credentialsPath = credentialsPath;
    this.accountsPath = accountsPath || path.join(path.dirname(tokenPath), "gmail_accounts.json");
    this.accounts = {};
    this.loadAccounts();
  }

  loadAccounts() {
    try {
      if (fs.existsSync(this.accountsPath)) {
        const content = fs.readFileSync(this.accountsPath, "utf8");
        this.accounts = JSON.parse(content);
      }
    } catch (err) {
      console.error("[GMAIL] Fehler beim Laden von gmail_accounts.json:", err.message);
      this.accounts = {};
    }
  }

  async saveAccounts() {
    try {
      await fs.promises.writeFile(this.accountsPath, JSON.stringify(this.accounts, null, 2), "utf8");
    } catch (err) {
      console.error("[GMAIL] Fehler beim Speichern von gmail_accounts.json:", err);
    }
  }

  async loadSavedCredentialsIfExist(accountToken) {
    try {
      if (accountToken) {
        return google.auth.fromJSON(accountToken);
      }
      if (fs.existsSync(this.tokenPath)) {
        const content = await fs.promises.readFile(this.tokenPath, "utf8");
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  async saveCredentials(client) {
    const content = await fs.promises.readFile(this.credentialsPath, "utf8");
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = {
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials?.refresh_token,
    };
    await fs.promises.writeFile(this.tokenPath, JSON.stringify(payload, null, 2), "utf8");
  }

  async authorize(accountToken) {
    let client = await this.loadSavedCredentialsIfExist(accountToken);
    if (client) return client;
    client = await authenticate({ scopes: SCOPES, keyfilePath: this.credentialsPath });
    if (client.credentials) await this.saveCredentials(client);
    return client;
  }

  /**
   * Liefert alle registrierten Google Mail Konten.
   */
  async getAccountsList() {
    this.loadAccounts();
    const list = Object.values(this.accounts);

    // Falls noch kein Konto in gmail_accounts.json existiert, aber token.json vorhanden ist
    if (list.length === 0 && fs.existsSync(this.tokenPath)) {
      try {
        const client = await this.authorize();
        const gmail = google.gmail({ version: "v1", auth: client });
        const profileRes = await gmail.users.getProfile({ userId: "me" });
        const email = profileRes.data.emailAddress || "Hauptkonto";

        const primaryAcc = {
          id: email,
          email: email,
          name: "Hauptkonto (" + email + ")",
          isPrimary: true,
          addedAt: new Date().toISOString(),
          token: JSON.parse(await fs.promises.readFile(this.tokenPath, "utf8")),
        };
        this.accounts[email] = primaryAcc;
        await this.saveAccounts();
        return [primaryAcc];
      } catch (e) {
        // Fallback wenn API noch nicht erreichbar
        return [{
          id: "primary",
          email: "Hauptkonto",
          name: "Hauptkonto (Standard)",
          isPrimary: true,
          addedAt: new Date().toISOString(),
        }];
      }
    }

    return list;
  }

  /**
   * Fügt ein neues Konto nach OAuth-Autorisierung hinzu.
   * @param {Object} tokens - Die OAuth Tokens
   * @param {Object} keyData - Die Google Client Credentials
   * @param {boolean} isSecondary - Wenn true, wird dieses Konto ausschließlich als sekundärer Posteingang registriert und das Hauptkonto (Google Drive) bleibt unberührt.
   */
  async addAccountFromTokens(tokens, keyData, isSecondary = false) {
    const key = keyData.installed || keyData.web;
    const tokenPayload = {
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: tokens.refresh_token,
    };

    const authClient = google.auth.fromJSON(tokenPayload);
    const gmail = google.gmail({ version: "v1", auth: authClient });
    const profileRes = await gmail.users.getProfile({ userId: "me" });
    const email = profileRes.data.emailAddress;

    if (!email) {
      throw new Error("E-Mail-Adresse des Google-Kontos konnte nicht ermittelt werden.");
    }

    this.loadAccounts();

    // Wenn isSecondary true ist: Es ist definitiv ein sekundäres Konto
    // Wenn isSecondary false ist: Es ist das Hauptkonto (Drive + Gmail)
    const isPrimaryAccount = !isSecondary;

    if (isPrimaryAccount) {
      // Setze alle anderen Konten auf isPrimary = false
      Object.values(this.accounts).forEach((acc) => {
        acc.isPrimary = false;
      });
    }

    const account = {
      id: email,
      email: email,
      name: isPrimaryAccount ? `Hauptkonto (${email})` : email,
      isPrimary: isPrimaryAccount,
      addedAt: new Date().toISOString(),
      token: tokenPayload,
    };

    this.accounts[email] = account;
    await this.saveAccounts();

    // NUR wenn es das Hauptkonto ist, in token.json sichern
    if (isPrimaryAccount) {
      await fs.promises.writeFile(this.tokenPath, JSON.stringify(tokenPayload, null, 2), "utf8");
    }

    return account;
  }

  /**
   * Entfernt ein verbundenes Konto.
   */
  async removeAccount(accountId) {
    this.loadAccounts();
    if (this.accounts[accountId]) {
      delete this.accounts[accountId];
      await this.saveAccounts();
      return true;
    }
    return false;
  }

  /**
   * Initialisiert den Gmail Client für ein bestimmtes Konto (oder das Standardkonto).
   */
  async getClient(accountId) {
    this.loadAccounts();
    let account = null;

    if (accountId && accountId !== "all" && accountId !== "primary") {
      account = this.accounts[accountId];
    } else if (Object.keys(this.accounts).length > 0) {
      // Nimm das primäre Konto oder das erste verfügbare
      account = Object.values(this.accounts).find((a) => a.isPrimary) || Object.values(this.accounts)[0];
    }

    const authClient = await this.authorize(account ? account.token : null);
    return google.gmail({ version: "v1", auth: authClient });
  }

  /**
   * Prüft ob Text / Dateinamen einer E-Mail auf Rechnungen / Belege hinweisen.
   */
  checkIsInvoiceOrReceipt(subject = "", snippet = "", attachments = []) {
    const combinedText = `${subject} ${snippet} ${attachments.map((a) => a.filename || "").join(" ")}`;
    for (const pattern of INVOICE_PATTERNS) {
      if (pattern.test(combinedText)) {
        return { isInvoice: true, pattern: pattern.source };
      }
    }
    return { isInvoice: false };
  }

  /**
   * Extrahiert alle PDF-Anhänge aus den MIME-Parts einer E-Mail-Nachricht rekursiv.
   */
  extractPdfParts(parts, result = []) {
    if (!parts || !Array.isArray(parts)) return result;

    for (const part of parts) {
      const filename = part.filename || "";
      const isPdf =
        filename.toLowerCase().endsWith(".pdf") ||
        part.mimeType === "application/pdf" ||
        part.mimeType === "application/x-pdf";

      if (isPdf && part.body && part.body.attachmentId) {
        result.push({
          attachmentId: part.body.attachmentId,
          filename: filename || `Anhang_${result.length + 1}.pdf`,
          size: part.body.size || 0,
          mimeType: part.mimeType || "application/pdf",
        });
      }

      if (part.parts && Array.isArray(part.parts)) {
        this.extractPdfParts(part.parts, result);
      }
    }

    return result;
  }

  /**
   * Sucht im Posteingang eines oder aller Konten nach offenen E-Mails mit PDF-Anhängen.
   */
  async listInboxEmailsWithPdfs(options = {}) {
    const query = options.query || "in:inbox filename:pdf";
    const maxResults = options.maxResults || 50;
    const requestedAccountId = options.accountId || "all";

    const accountsList = await this.getAccountsList();
    const accountsToQuery = [];

    if (requestedAccountId !== "all") {
      const matched = accountsList.find((a) => a.id === requestedAccountId || a.email === requestedAccountId);
      if (matched) {
        accountsToQuery.push(matched);
      } else if (accountsList.length > 0) {
        accountsToQuery.push(accountsList[0]);
      }
    } else {
      accountsToQuery.push(...accountsList);
    }

    // Wenn keine Kontenliste vorhanden ist, versuche Standard-Auth
    if (accountsToQuery.length === 0) {
      accountsToQuery.push({ id: "primary", email: "Hauptkonto", name: "Hauptkonto" });
    }

    const allEmails = [];

    for (const acc of accountsToQuery) {
      try {
        const gmail = await this.getClient(acc.id);
        const listRes = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: maxResults,
        });

        const messageItems = listRes.data.messages || [];
        for (const item of messageItems) {
          try {
            const msg = await gmail.users.messages.get({
              userId: "me",
              id: item.id,
              format: "full",
            });

            const payload = msg.data.payload || {};
            const headers = payload.headers || [];

            const getHeader = (name) => {
              const h = headers.find((header) => header.name.toLowerCase() === name.toLowerCase());
              return h ? h.value : "";
            };

            const subject = getHeader("Subject") || "(Kein Betreff)";
            const fromRaw = getHeader("From") || "Unbekannter Absender";
            const dateRaw = getHeader("Date") || "";
            const toRaw = getHeader("To") || "";

            let fromName = fromRaw;
            let fromEmail = fromRaw;
            const fromMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/);
            if (fromMatch) {
              fromName = fromMatch[1].replace(/^["']|["']$/g, "").trim() || fromMatch[2];
              fromEmail = fromMatch[2].trim();
            }

            const attachments = [];
            if (payload.parts) {
              this.extractPdfParts(payload.parts, attachments);
            } else if (payload.body && payload.body.attachmentId) {
              const fn = payload.filename || "";
              if (fn.toLowerCase().endsWith(".pdf") || payload.mimeType === "application/pdf") {
                attachments.push({
                  attachmentId: payload.body.attachmentId,
                  filename: fn || "Anhang.pdf",
                  size: payload.body.size || 0,
                  mimeType: payload.mimeType || "application/pdf",
                });
              }
            }

            if (attachments.length > 0) {
              const detection = this.checkIsInvoiceOrReceipt(subject, msg.data.snippet || "", attachments);

              allEmails.push({
                id: msg.data.id,
                accountId: acc.id,
                accountEmail: acc.email,
                accountName: acc.name,
                threadId: msg.data.threadId,
                subject: subject,
                fromRaw: fromRaw,
                fromName: fromName,
                fromEmail: fromEmail,
                to: toRaw,
                date: dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString(),
                snippet: msg.data.snippet || "",
                labels: msg.data.labelIds || [],
                attachments: attachments,
                isDetected: detection.isInvoice,
                detectionReason: detection.isInvoice ? "Rechnung / Beleg erkannt" : null,
              });
            }
          } catch (msgErr) {
            console.error(`[GMAIL] Fehler bei Nachricht ${item.id} (${acc.email}):`, msgErr.message);
          }
        }
      } catch (accErr) {
        console.error(`[GMAIL] Fehler beim Abrufen für Konto ${acc.email}:`, accErr.message);
        // Falls dieses Konto Insufficient Permission hat, weiterwerfen wenn einziges Konto
        if (accountsToQuery.length === 1) {
          throw accErr;
        }
      }
    }

    // Sortiere alle E-Mails nach Datum absteigend
    allEmails.sort((a, b) => new Date(b.date) - new Date(a.date));
    return allEmails;
  }

  /**
   * Lädt einen konkreten PDF-Anhang einer Nachricht herunter.
   */
  async downloadAttachment(messageId, attachmentId, accountId) {
    try {
      const gmail = await this.getClient(accountId);
      const res = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: messageId,
        id: attachmentId,
      });

      const rawData = res.data.data;
      if (!rawData) {
        throw new Error("Keine Daten für diesen Anhang erhalten.");
      }

      const base64Standard = rawData.replace(/-/g, "+").replace(/_/g, "/");
      const buffer = Buffer.from(base64Standard, "base64");
      return buffer;
    } catch (err) {
      console.error(`[GMAIL] Fehler beim Herunterladen des Anhangs ${attachmentId} (Mail ${messageId}):`, err);
      throw err;
    }
  }

  /**
   * Archiviert eine E-Mail (entfernt das INBOX-Label).
   */
  async archiveEmail(messageId, accountId) {
    try {
      const gmail = await this.getClient(accountId);
      await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          removeLabelIds: ["INBOX"],
        },
      });
      console.log(`[GMAIL] E-Mail ${messageId} (${accountId || 'Standard'}) archiviert (INBOX entfernt).`);
      return true;
    } catch (err) {
      console.error(`[GMAIL] Fehler beim Archivieren der E-Mail ${messageId}:`, err);
      throw err;
    }
  }

  /**
   * Stellt eine E-Mail im Posteingang wieder her (fügt INBOX-Label wieder hinzu).
   */
  async unarchiveEmail(messageId, accountId) {
    try {
      const gmail = await this.getClient(accountId);
      await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          addLabelIds: ["INBOX"],
        },
      });
      console.log(`[GMAIL] E-Mail ${messageId} wieder in den Posteingang verschoben.`);
      return true;
    } catch (err) {
      console.error(`[GMAIL] Fehler beim Wiederherstellen der E-Mail ${messageId}:`, err);
      throw err;
    }
  }
}

module.exports = GmailAPI;
