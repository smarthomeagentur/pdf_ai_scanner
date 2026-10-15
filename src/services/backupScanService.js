const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const { ROOT_DIR, STORE_DIR, DOWNLOADS_DIR, DB_FILE } = require("../config/paths");

// Read-only scan: reports possible job backups on startup, never imports or modifies anything
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const SQLITE_PATTERN = /\.(sqlite|sqlite3|db)(\.(tmp_\d+|bak|backup|old|\d+))?$|\.sqlite\.[\w-]+$/i;
const JSON_PATTERN = /(jobs|backup|database)[^/\\]*\.(json|bak|migrated)$|\.json\.(bak|migrated|old)$/i;

function getScanDirs() {
  const extra = (process.env.BACKUP_SCAN_DIRS || "")
    .split(/[;,]/)
    .map((d) => d.trim())
    .filter(Boolean);
  return [...new Set([STORE_DIR, DOWNLOADS_DIR, ROOT_DIR, path.join(ROOT_DIR, "backups"), path.join(STORE_DIR, "backups"), ...extra])];
}

function formatDate(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : "?";
}

function summarize(jobs, currentJobIds) {
  const dates = jobs.map((j) => new Date(j.uploadDate || j.created_at || 0).getTime()).filter((t) => t > 0);
  const missing = jobs.filter((j) => j.id && !currentJobIds.has(j.id)).length;
  return {
    count: jobs.length,
    missing,
    from: dates.length ? Math.min(...dates) : null,
    to: dates.length ? Math.max(...dates) : null,
  };
}

function readSqliteJobs(SQL, filePath) {
  const db = new SQL.Database(fs.readFileSync(filePath));
  try {
    const res = db.exec("SELECT data_json FROM jobs");
    if (!res[0]) return [];
    return res[0].values
      .map(([json]) => {
        try {
          return JSON.parse(json);
        } catch (e) {
          return null;
        }
      })
      .filter((j) => j && j.id);
  } finally {
    db.close();
  }
}

/**
 * Jobs from any known backup format: export v2 ({ jobs: [...] }), legacy jobs.json ({ uploadJobs })
 * or old admin export v1 ({ jobs: { uploadJobs } }). Returns null if the data contains no jobs.
 */
function extractJobsFromBackupData(parsed) {
  if (Array.isArray(parsed?.jobs)) return parsed.jobs.filter((j) => j && j.id);
  const jobsObj = parsed?.uploadJobs || parsed?.jobs?.uploadJobs || null;
  if (!jobsObj || typeof jobsObj !== "object") return null;
  return Object.values(jobsObj).filter((j) => j && j.id);
}

function readJsonJobs(filePath) {
  return extractJobsFromBackupData(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function findCandidates() {
  const activeDb = path.resolve(DB_FILE);
  const seen = new Set();
  const candidates = [];
  for (const dir of getScanDirs()) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.resolve(dir, entry.name);
      if (fullPath === activeDb || seen.has(fullPath)) continue;
      const isWal = /\.(sqlite|db)-(wal|journal)$/i.test(entry.name);
      const type = isWal ? "wal" : SQLITE_PATTERN.test(entry.name) ? "sqlite" : JSON_PATTERN.test(entry.name) ? "json" : null;
      if (!type) continue;
      seen.add(fullPath);
      candidates.push({ fullPath, name: entry.name, type });
    }
  }
  return candidates;
}

/** Full job objects of a backup file; only files found by the scan are accepted (no arbitrary paths). */
async function readBackupJobs(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const candidate = findCandidates().find((c) => c.fullPath === resolved && c.type !== "wal");
  if (!candidate) throw new Error("Backup-Datei nicht gefunden oder nicht zulässig.");
  if (fs.statSync(resolved).size > MAX_FILE_SIZE) throw new Error("Backup-Datei ist zu groß.");
  if (candidate.type === "sqlite") return readSqliteJobs(await initSqlJs(), resolved);
  const jobs = readJsonJobs(resolved);
  if (!jobs) throw new Error("Datei enthält keine Jobs.");
  return jobs;
}

async function scanForBackups(currentJobIds = new Set(), { silent = false } = {}) {
  const log = silent ? () => {} : console.log;
  if (process.env.NODE_ENV === "test" && !silent) return [];
  const found = [];
  try {
    const candidates = findCandidates();
    log(`[BACKUP-SCAN] Suche nach Backups in: ${getScanDirs().join(", ")}`);
    if (candidates.length === 0) {
      log("[BACKUP-SCAN] Keine Backup-Dateien gefunden.");
      return found;
    }

    const SQL = await initSqlJs();
    for (const c of candidates) {
      let stat;
      try {
        stat = fs.statSync(c.fullPath);
      } catch (e) {
        continue;
      }
      const meta = `${(stat.size / 1024).toFixed(0)} KB, geändert ${formatDate(stat.mtimeMs)}`;

      if (c.type === "wal") {
        log(`[BACKUP-SCAN] ⚠ ${c.fullPath} (${meta}): SQLite-WAL/Journal, kann ältere Datenbankseiten enthalten (nicht automatisch lesbar).`);
        found.push({ ...c, size: stat.size });
        continue;
      }
      if (stat.size === 0 || stat.size > MAX_FILE_SIZE) continue;

      try {
        const jobs = c.type === "sqlite" ? readSqliteJobs(SQL, c.fullPath) : readJsonJobs(c.fullPath);
        if (!jobs) continue;
        const s = summarize(jobs, currentJobIds);
        const marker = s.missing > 0 ? "✅" : "•";
        log(
          `[BACKUP-SCAN] ${marker} ${c.fullPath} (${meta}): ${s.count} Jobs, Zeitraum ${formatDate(s.from)} – ${formatDate(s.to)}, ${s.missing} davon NICHT in aktueller DB`
        );
        found.push({ ...c, size: stat.size, ...s });
      } catch (e) {
        log(`[BACKUP-SCAN] ✖ ${c.fullPath} (${meta}): nicht lesbar (${e.message})`);
      }
    }

    const withMissing = found.filter((f) => f.missing > 0);
    const maxMissing = withMissing.reduce((max, f) => Math.max(max, f.missing), 0);
    log(
      `[BACKUP-SCAN] ${found.length} Backup-Datei(en) gefunden, ${withMissing.length} mit Jobs, die in der aktuellen DB fehlen` +
        (maxMissing > 0 ? ` (max. ${maxMissing} fehlende Jobs in einer Datei).` : ".")
    );
  } catch (e) {
    console.error("[BACKUP-SCAN] Fehler beim Scannen nach Backups:", e.message || e);
  }
  return found;
}

module.exports = { scanForBackups, readBackupJobs, extractJobsFromBackupData };
