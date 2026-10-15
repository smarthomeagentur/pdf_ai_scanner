const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Backup scan only looks into known dirs; point it at a temp dir before loading the services
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-restore-test-"));
process.env.BACKUP_SCAN_DIRS = backupDir;

const jobQueue = require("../../src/services/jobQueueService");

const backupFile = path.join(backupDir, "jobs.json.migrated");
fs.writeFileSync(
  backupFile,
  JSON.stringify({
    uploadJobs: {
      "restore-done": {
        id: "restore-done",
        originalName: "a.pdf",
        status: "completed",
        result: { full: "A" },
        uploadDate: "2026-07-28T10:00:00.000Z",
        rawDriveId: "drive-a",
      },
      "restore-pending": {
        id: "restore-pending",
        originalName: "b.pdf",
        status: "pending",
        inAiPipeline: true,
        uploadDate: "2026-07-29T10:00:00.000Z",
      },
      "restore-dup": {
        id: "restore-dup",
        originalName: "c.pdf",
        status: "completed",
        result: { full: "C" },
        uploadDate: "2026-07-30T10:00:00.000Z",
        rawDriveId: "drive-existing",
      },
    },
  }),
);

test("backup restore", async (t) => {
  await jobQueue.loadJobs();
  jobQueue.addJobs([
    {
      id: "current-job",
      originalName: "x.pdf",
      status: "completed",
      result: { full: "X" },
      rawDriveId: "drive-existing",
      uploadDate: new Date().toISOString(),
    },
  ]);

  await t.test("lists the backup with its missing jobs", async () => {
    const backups = await jobQueue.listBackups();
    const found = backups.find((b) => b.fullPath === path.resolve(backupFile));
    assert.ok(found);
    assert.equal(found.count, 3);
    assert.equal(found.missing, 3);
  });

  await t.test("dry run changes nothing", async () => {
    const result = await jobQueue.restoreJobsFromBackup(backupFile, { dryRun: true });
    assert.equal(result.restored, 2);
    assert.equal(result.duplicates, 1);
    assert.equal(jobQueue.uploadJobs["restore-done"], undefined);
  });

  await t.test("restores missing jobs without re-queueing them", async () => {
    const result = await jobQueue.restoreJobsFromBackup(backupFile, { dryRun: false });
    assert.equal(result.restored, 2);
    assert.equal(result.duplicates, 1);
    assert.equal(result.unfinished, 1);

    const pending = jobQueue.uploadJobs["restore-pending"];
    assert.equal(pending.status, "failed");
    assert.equal(pending.inAiPipeline, false);
    assert.ok(pending.restoredFromBackup);
    assert.equal(jobQueue.uploadJobs["restore-dup"], undefined);
  });

  await t.test("second restore skips everything already present", async () => {
    const result = await jobQueue.restoreJobsFromBackup(backupFile, { dryRun: false });
    assert.equal(result.restored, 0);
    assert.equal(result.existing, 2);
  });

  await t.test("rejects files outside the scanned backup locations", async () => {
    await assert.rejects(() => jobQueue.restoreJobsFromBackup(path.join(os.tmpdir(), "evil.json")), /nicht gefunden/);
  });

  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("backup export / import", async (t) => {
  const { createBackup, restoreBackup } = require("../../src/services/backupService");
  const { appSettings } = require("../../src/config/settings");

  await t.test("export contains all current jobs but no client secrets", () => {
    appSettings.CLICKUP_API_KEY = "secret";
    const backup = createBackup();
    delete appSettings.CLICKUP_API_KEY;
    assert.equal(backup.version, 2);
    assert.equal(backup.jobCount, Object.keys(jobQueue.uploadJobs).length);
    assert.ok(backup.jobs.some((j) => j.id === "current-job"));
    assert.equal("CLICKUP_API_KEY" in backup.settings, false);
  });

  await t.test("re-importing an export adds nothing", () => {
    const result = restoreBackup(JSON.parse(JSON.stringify(createBackup())), { dryRun: false });
    assert.equal(result.jobs.restored, 0);
    assert.equal(result.settingsApplied, false);
  });

  await t.test("imports missing jobs from an export and the legacy jobs.json format", () => {
    const exported = {
      version: 2,
      jobs: [{ id: "export-only", originalName: "e.pdf", status: "completed", result: { full: "E" } }],
    };
    assert.equal(restoreBackup(exported, { dryRun: true }).jobs.restored, 1);
    assert.equal(jobQueue.uploadJobs["export-only"], undefined);
    assert.equal(restoreBackup(exported, { dryRun: false }).jobs.restored, 1);
    assert.ok(jobQueue.uploadJobs["export-only"]);

    const legacy = {
      uploadJobs: { "legacy-only": { id: "legacy-only", originalName: "l.pdf", status: "completed" } },
      processedDriveFiles: ["legacy-drive"],
    };
    const legacyResult = restoreBackup(legacy, { dryRun: false });
    assert.equal(legacyResult.jobs.restored, 1);
    assert.equal(legacyResult.drive.processedDriveFiles, 1);
    assert.ok(jobQueue.processedDriveFiles.includes("legacy-drive"));
  });

  await t.test("applies settings only when requested", () => {
    const backup = { version: 2, jobs: [], settings: { GMAIL_SCAN_QUERY: "from:test", CLICKUP_API_KEY: "leak" } };
    const before = appSettings.GMAIL_SCAN_QUERY;
    restoreBackup(backup, { dryRun: false });
    assert.equal(appSettings.GMAIL_SCAN_QUERY, before);
    const result = restoreBackup(backup, { dryRun: false, includeSettings: true });
    assert.equal(result.settingsApplied, true);
    assert.equal(appSettings.GMAIL_SCAN_QUERY, "from:test");
    assert.equal(appSettings.CLICKUP_API_KEY, undefined);
    appSettings.GMAIL_SCAN_QUERY = before;
  });

  await t.test("rejects data without jobs or settings", () => {
    assert.throws(() => restoreBackup({ foo: 1 }), /weder Belege noch Einstellungen/);
  });
});

test("cancel open jobs", async () => {
  // Add pending jobs directly (addJobs would start the AI queue)
  jobQueue.uploadJobs["cancel-a"] = { id: "cancel-a", originalName: "a.pdf", status: "pending", inAiPipeline: true };
  jobQueue.uploadJobs["cancel-b"] = { id: "cancel-b", originalName: "b.pdf", status: "pending", inAiPipeline: true };
  jobQueue.uploadJobs["cancel-done"] = { id: "cancel-done", originalName: "c.pdf", status: "completed" };

  assert.ok(jobQueue.getQueueStatus().pending >= 2);
  const result = jobQueue.cancelOpenJobs();
  assert.ok(result.cancelled >= 2);
  assert.equal(jobQueue.getQueueStatus().pending, 0);
  assert.equal(jobQueue.uploadJobs["cancel-a"].status, "failed");
  assert.equal(jobQueue.uploadJobs["cancel-a"].inAiPipeline, false);
  assert.match(jobQueue.uploadJobs["cancel-a"].error, /abgebrochen/);
  assert.equal(jobQueue.uploadJobs["cancel-done"].status, "completed");
});
