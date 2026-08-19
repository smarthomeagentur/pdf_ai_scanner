const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.modify",
];

class GmailAPI {
  constructor(tokenPath, credentialsPath) {
    this.tokenPath = tokenPath;
    this.credentialsPath = credentialsPath;
  }

  async loadSavedCredentialsIfExist() {
    try {
      const content = await fs.promises.readFile(this.tokenPath, "utf8");
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

  async saveCredentials(client) {
    const content = await fs.promises.readFile(this.credentialsPath, "utf8");
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.promises.writeFile(this.tokenPath, payload);
  }

  async authorize() {
    let client = await this.loadSavedCredentialsIfExist();
    if (client) return client;
    client = await authenticate({ scopes: SCOPES, keyfilePath: this.credentialsPath });
    if (client.credentials) await this.saveCredentials(client);
    return client;
  }

  async getClient() {
    const authClient = await this.authorize();
    return google.gmail({ version: "v1", auth: authClient });
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
   * Sucht im Posteingang nach offenen E-Mails mit PDF-Anhängen.
   */
  async listInboxEmailsWithPdfs(options = {}) {
    const query = options.query || "in:inbox filename:pdf";
    const maxResults = options.maxResults || 50;

    try {
      const gmail = await this.getClient();
      const listRes = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: maxResults,
      });

      const messageItems = listRes.data.messages || [];
      if (messageItems.length === 0) {
        return [];
      }

      const emailList = [];

      // Detaillierte Nachrichten abrufen
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

          // Absender parsen (z. B. "Vorname Nachname <email@example.com>")
          let fromName = fromRaw;
          let fromEmail = fromRaw;
          const fromMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/);
          if (fromMatch) {
            fromName = fromMatch[1].replace(/^["']|["']$/g, "").trim() || fromMatch[2];
            fromEmail = fromMatch[2].trim();
          }

          // PDF-Anhänge extrahieren
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

          // Nur E-Mails aufnehmen, die tatsächlich PDF-Anhänge enthalten
          if (attachments.length > 0) {
            emailList.push({
              id: msg.data.id,
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
            });
          }
        } catch (msgErr) {
          console.error(`[GMAIL] Fehler beim Laden der Nachricht ${item.id}:`, msgErr.message);
        }
      }

      // Sortiere nach Datum (neueste zuerst)
      emailList.sort((a, b) => new Date(b.date) - new Date(a.date));

      return emailList;
    } catch (err) {
      console.error("[GMAIL] Fehler beim Abrufen der Posteingangs-Mails:", err);
      throw err;
    }
  }

  /**
   * Lädt einen konkreten PDF-Anhang einer Nachricht herunter und liefert einen Buffer zurück.
   */
  async downloadAttachment(messageId, attachmentId) {
    try {
      const gmail = await this.getClient();
      const res = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: messageId,
        id: attachmentId,
      });

      const rawData = res.data.data;
      if (!rawData) {
        throw new Error("Keine Daten für diesen Anhang erhalten.");
      }

      // Gmail nutzt base64url Encoding (mit - und _ anstelle von + und /)
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
  async archiveEmail(messageId) {
    try {
      const gmail = await this.getClient();
      await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: {
          removeLabelIds: ["INBOX"],
        },
      });
      console.log(`[GMAIL] E-Mail ${messageId} erfolgreich archiviert (INBOX-Label entfernt).`);
      return true;
    } catch (err) {
      console.error(`[GMAIL] Fehler beim Archivieren der E-Mail ${messageId}:`, err);
      throw err;
    }
  }

  /**
   * Stellt eine E-Mail im Posteingang wieder her (fügt INBOX-Label wieder hinzu).
   */
  async unarchiveEmail(messageId) {
    try {
      const gmail = await this.getClient();
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
