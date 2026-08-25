const fs = require("fs");
const { SKIPPED_EMAILS_FILE } = require("../config/paths");

let skippedEmails = {};

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
};
