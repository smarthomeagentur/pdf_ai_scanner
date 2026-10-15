const fs = require("fs");
const path = require("path");
const { DB_FILE, AUTO_BACKUP_DIR } = require("../config/paths");

// One copy of database.sqlite per day in AUTO_BACKUP_DIR, the newest AUTO_BACKUP_KEEP are kept
const KEEP_COUNT = Math.max(1, Number(process.env.AUTO_BACKUP_KEEP) || 14);
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const FILE_PATTERN = /^database_(\d{4}-\d{2}-\d{2})\.sqlite$/;

let intervalHandle = null;

function listAutoBackups() {
  try {
    return fs
      .readdirSync(AUTO_BACKUP_DIR)
      .filter((name) => FILE_PATTERN.test(name))
      .sort()
      .reverse();
  } catch (e) {
    return [];
  }
}

function pruneOldBackups() {
  for (const name of listAutoBackups().slice(KEEP_COUNT)) {
    try {
      fs.unlinkSync(path.join(AUTO_BACKUP_DIR, name));
      console.log(`[AUTO-BACKUP] Alte Sicherung entfernt: ${name}`);
    } catch (e) {
      console.error(`[AUTO-BACKUP] Konnte ${name} nicht entfernen:`, e.message);
    }
  }
}

/** Creates today's backup if it does not exist yet. Returns the path of a newly created backup or null. */
function runAutoBackup(jobCount) {
  if (process.env.NODE_ENV === "test" || !fs.existsSync(DB_FILE)) return null;
  // An empty DB must not rotate out the last good backups
  if (!jobCount) {
    console.warn("[AUTO-BACKUP] Datenbank enthält keine Belege – Sicherung übersprungen.");
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const target = path.join(AUTO_BACKUP_DIR, `database_${today}.sqlite`);
  if (fs.existsSync(target)) return null;

  try {
    fs.mkdirSync(AUTO_BACKUP_DIR, { recursive: true });
    // DB_FILE is always replaced atomically (tmp + rename), so a plain copy is consistent
    const tmpTarget = `${target}.partial`;
    fs.copyFileSync(DB_FILE, tmpTarget);
    fs.renameSync(tmpTarget, target);
    console.log(`[AUTO-BACKUP] Sicherung erstellt: ${target} (${jobCount} Belege)`);
    pruneOldBackups();
    return target;
  } catch (e) {
    console.error("[AUTO-BACKUP] Fehler beim Erstellen der Sicherung:", e.message);
    return null;
  }
}

function startAutoBackup(getJobCount) {
  if (process.env.NODE_ENV === "test" || intervalHandle) return;
  if (process.env.AUTO_BACKUP_ENABLED === "false") {
    console.log("[AUTO-BACKUP] Deaktiviert (AUTO_BACKUP_ENABLED=false).");
    return;
  }
  console.log(`[AUTO-BACKUP] Tägliche Sicherung aktiv: ${AUTO_BACKUP_DIR} (behält ${KEEP_COUNT} Tage)`);
  runAutoBackup(getJobCount());
  intervalHandle = setInterval(() => runAutoBackup(getJobCount()), CHECK_INTERVAL_MS);
  intervalHandle.unref();
}

module.exports = { startAutoBackup, runAutoBackup, listAutoBackups };
