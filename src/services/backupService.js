const fs = require("fs");
const path = require("path");
const { SETTINGS_FILE, JOBS_FILE, SKIPPED_EMAILS_FILE } = require("../config/paths");

function createBackup() {
  const backupData = {
    version: "1.0",
    createdAt: new Date().toISOString(),
    settings: fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) : {},
    jobs: fs.existsSync(JOBS_FILE) ? JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")) : {},
    skippedEmails: fs.existsSync(SKIPPED_EMAILS_FILE) ? JSON.parse(fs.readFileSync(SKIPPED_EMAILS_FILE, "utf8")) : {},
  };
  return backupData;
}

function restoreBackup(backupData) {
  if (!backupData || typeof backupData !== "object") {
    throw new Error("Ungültiges Backup-Format.");
  }
  if (backupData.settings) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(backupData.settings, null, 2), "utf8");
  }
  if (backupData.jobs) {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(backupData.jobs, null, 2), "utf8");
  }
  if (backupData.skippedEmails) {
    fs.writeFileSync(SKIPPED_EMAILS_FILE, JSON.stringify(backupData.skippedEmails, null, 2), "utf8");
  }
  return true;
}

module.exports = {
  createBackup,
  restoreBackup,
};
