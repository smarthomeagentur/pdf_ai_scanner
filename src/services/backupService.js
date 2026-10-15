const { appSettings, saveSettings, withoutClientSecrets } = require("../config/settings");
const jobQueue = require("./jobQueueService");
const inbox = require("./inboxService");
const { extractJobsFromBackupData } = require("./backupScanService");

const BACKUP_FORMAT = "smart-cloud-scanner-backup";
const BACKUP_VERSION = 2;

/**
 * Full export of the current state: all jobs from SQLite, Drive sync state, skipped mails and settings.
 * Third-party secrets and Gmail/Drive OAuth tokens are never included.
 */
function createBackup() {
  const jobs = Object.values(jobQueue.uploadJobs);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    jobCount: jobs.length,
    jobs,
    appState: {
      processedDriveFiles: [...jobQueue.processedDriveFiles],
      hiddenDriveFiles: [...jobQueue.hiddenDriveFiles],
    },
    skippedEmails: inbox.getAllSkipped(),
    settings: withoutClientSecrets(appSettings),
  };
}

/**
 * Merges a backup into the current state. Existing jobs, Drive state and skipped mails are never
 * overwritten or removed; settings are only applied when includeSettings is set.
 * Accepts export v2 as well as old v1 exports and legacy jobs.json files.
 */
function restoreBackup(backupData, { dryRun = true, includeSettings = false } = {}) {
  if (!backupData || typeof backupData !== "object") {
    throw new Error("Ungültiges Backup-Format.");
  }
  const jobs = extractJobsFromBackupData(backupData);
  const hasSettings = !!backupData.settings && typeof backupData.settings === "object";
  if (!jobs && !hasSettings) {
    throw new Error("Die Datei enthält weder Belege noch Einstellungen.");
  }

  const source = `Backup-Upload ${backupData.createdAt || ""}`.trim();
  const jobResult = jobs ? jobQueue.restoreJobs(jobs, { dryRun, source }) : null;
  // Drive state: v2 under appState, v1 export inside jobs (= jobs.json content), legacy jobs.json at top level
  const driveState =
    backupData.appState || (backupData.jobs && !Array.isArray(backupData.jobs) ? backupData.jobs : backupData);
  const driveResult = jobQueue.mergeDriveState(driveState, { dryRun });
  const skippedEmails = inbox.mergeSkipped(backupData.skippedEmails, { dryRun });

  let settingsApplied = false;
  if (includeSettings && hasSettings && !dryRun) {
    Object.assign(appSettings, withoutClientSecrets(backupData.settings));
    saveSettings();
    settingsApplied = true;
  }

  return {
    dryRun,
    createdAt: backupData.createdAt || null,
    version: backupData.version || 1,
    jobs: jobResult,
    drive: driveResult,
    skippedEmails,
    hasSettings,
    settingsApplied,
  };
}

module.exports = {
  createBackup,
  restoreBackup,
};
