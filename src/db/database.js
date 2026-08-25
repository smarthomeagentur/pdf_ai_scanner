const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");
const { DB_FILE, JOBS_FILE } = require("../config/paths");

let SQL = null;
let db = null;
let isInitialized = false;

/**
 * Initializes the SQLite (WASM) database.
 * 100% portable: Zero native C++ compilation, zero segmentation faults across Coolify, Docker, Linux, Windows.
 */
async function initDatabase() {
  if (isInitialized && db) return db;

  if (!SQL) {
    SQL = await initSqlJs();
  }

  // If existing database.sqlite exists on disk, load its binary buffer
  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      db = new SQL.Database(fileBuffer);
    } catch (readErr) {
      console.error("[SQLITE] Fehler beim Lesen von database.sqlite, erstelle neue Datenbank:", readErr);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Create tables and indexes
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT,
      upload_date TEXT NOT NULL,
      document_date TEXT,
      category TEXT,
      company TEXT,
      invoice_number TEXT,
      invoice_amount INTEGER DEFAULT 0,
      is_invoice INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      is_private INTEGER DEFAULT 0,
      suspected_duplicate INTEGER DEFAULT 0,
      file_path TEXT,
      raw_drive_id TEXT,
      drive_file_id TEXT,
      data_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_upload_date ON jobs(upload_date);
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
    CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);
    CREATE INDEX IF NOT EXISTS idx_jobs_is_hidden ON jobs(is_hidden);
    CREATE INDEX IF NOT EXISTS idx_jobs_drive_file_id ON jobs(drive_file_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_raw_drive_id ON jobs(raw_drive_id);

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  runAutoMigration(db);
  saveDatabaseToDisk();

  isInitialized = true;
  return db;
}

/**
 * Persists the binary SQLite database to disk atomically to prevent corruption.
 */
function saveDatabaseToDisk() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpFile = `${DB_FILE}.tmp_${Date.now()}`;
    fs.writeFileSync(tmpFile, buffer);
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error("[SQLITE] Fehler beim Speichern von database.sqlite auf Festplatte:", err);
  }
}

/**
 * Automatically migrates existing jobs from store/jobs.json or jobs.json.migrated if DB is empty.
 */
function runAutoMigration(database) {
  try {
    const stmt = database.prepare("SELECT value FROM app_state WHERE key = 'migration_done'");
    let migrationDone = false;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      migrationDone = row.value === "true";
    }
    stmt.free();

    if (migrationDone) return;

    const sourceFile = fs.existsSync(JOBS_FILE)
      ? JOBS_FILE
      : fs.existsSync(`${JOBS_FILE}.migrated`)
      ? `${JOBS_FILE}.migrated`
      : null;

    if (!sourceFile) {
      database.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('migration_done', 'true')");
      return;
    }

    console.log(`[SQLITE] Starte automatische Migration von ${path.basename(sourceFile)} nach database.sqlite...`);

    const rawData = fs.readFileSync(sourceFile, "utf8");
    const parsed = JSON.parse(rawData);

    const uploadJobs = parsed.uploadJobs || {};
    const uploadQueue = parsed.uploadQueue || [];
    const processedDriveFiles = parsed.processedDriveFiles || [];
    const hiddenDriveFiles = parsed.hiddenDriveFiles || [];

    let count = 0;
    const now = Date.now();

    for (const jobId in uploadJobs) {
      const job = uploadJobs[jobId];
      if (!job || !job.id) continue;

      const originalName = job.originalName || job.result?.full || "Dokument.pdf";
      const status = job.status || "completed";
      const source = job.source || "upload";
      const uploadDate = job.uploadDate || new Date(now).toISOString();
      const documentDate = job.result?.documentDate || job.documentDate || "unknown";
      const category = job.result?.category || job.category || "Unbekannt";
      const company = job.result?.company || job.company || "Unbekannt";
      const invoiceNumber = job.result?.invoiceNumber || job.invoiceNumber || "none";
      const invoiceAmount = Number(job.result?.invoiceAmmount || job.invoiceAmmount || 0) || 0;
      const isInvoice = (job.result?.isInvoice ?? job.isInvoice) ? 1 : 0;
      const isHidden = job.isHidden ? 1 : 0;
      const isPrivate = job.isPrivate ? 1 : 0;
      const suspectedDuplicate = job.suspectedDuplicate ? 1 : 0;
      const filePath = job.filePath || "";
      const rawDriveId = job.rawDriveId || "";
      const driveFileId = job.driveFileId || "";

      database.run(
        `INSERT OR REPLACE INTO jobs (
          id, original_name, status, source, upload_date, document_date,
          category, company, invoice_number, invoice_amount, is_invoice,
          is_hidden, is_private, suspected_duplicate, file_path,
          raw_drive_id, drive_file_id, data_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          job.id,
          originalName,
          status,
          source,
          uploadDate,
          documentDate,
          category,
          company,
          invoiceNumber,
          invoiceAmount,
          isInvoice,
          isHidden,
          isPrivate,
          suspectedDuplicate,
          filePath,
          rawDriveId,
          driveFileId,
          JSON.stringify(job),
          new Date(uploadDate).getTime() || now,
          now,
        ]
      );
      count++;
    }

    database.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('upload_queue', ?)", [JSON.stringify(uploadQueue)]);
    database.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('processed_drive_files', ?)", [JSON.stringify(processedDriveFiles)]);
    database.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('hidden_drive_files', ?)", [JSON.stringify(hiddenDriveFiles)]);
    database.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('migration_done', 'true')");

    if (fs.existsSync(JOBS_FILE)) {
      try {
        fs.renameSync(JOBS_FILE, `${JOBS_FILE}.migrated`);
      } catch (e) {}
    }

    console.log(`[SQLITE] Migration erfolgreich! ${count} Belege/Jobs in SQLite importiert.`);
  } catch (err) {
    console.error("[SQLITE] Fehler bei der Migration von jobs.json:", err);
  }
}

const dbWrapper = {
  initDatabase,
  saveDatabaseToDisk,

  insertOrReplaceJob(job) {
    if (!db || !job || !job.id) return;
    const now = Date.now();
    const originalName = job.originalName || job.result?.full || "Dokument.pdf";
    const status = job.status || "pending";
    const source = job.source || "upload";
    const uploadDate = job.uploadDate || new Date(now).toISOString();
    const documentDate = job.result?.documentDate || job.documentDate || "unknown";
    const category = job.result?.category || job.category || "Unbekannt";
    const company = job.result?.company || job.company || "Unbekannt";
    const invoiceNumber = job.result?.invoiceNumber || job.invoiceNumber || "none";
    const invoiceAmount = Number(job.result?.invoiceAmmount || job.invoiceAmmount || 0) || 0;
    const isInvoice = (job.result?.isInvoice ?? job.isInvoice) ? 1 : 0;
    const isHidden = job.isHidden ? 1 : 0;
    const isPrivate = job.isPrivate ? 1 : 0;
    const suspectedDuplicate = job.suspectedDuplicate ? 1 : 0;
    const filePath = job.filePath || "";
    const rawDriveId = job.rawDriveId || "";
    const driveFileId = job.driveFileId || "";

    db.run(
      `INSERT OR REPLACE INTO jobs (
        id, original_name, status, source, upload_date, document_date,
        category, company, invoice_number, invoice_amount, is_invoice,
        is_hidden, is_private, suspected_duplicate, file_path,
        raw_drive_id, drive_file_id, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        originalName,
        status,
        source,
        uploadDate,
        documentDate,
        category,
        company,
        invoiceNumber,
        invoiceAmount,
        isInvoice,
        isHidden,
        isPrivate,
        suspectedDuplicate,
        filePath,
        rawDriveId,
        driveFileId,
        JSON.stringify(job),
        new Date(uploadDate).getTime() || now,
        now,
      ]
    );
    saveDatabaseToDisk();
  },

  getAllJobs() {
    if (!db) return [];
    const results = [];
    const stmt = db.prepare("SELECT data_json FROM jobs ORDER BY upload_date DESC");
    while (stmt.step()) {
      const row = stmt.getAsObject();
      try {
        results.push(JSON.parse(row.data_json));
      } catch (e) {}
    }
    stmt.free();
    return results;
  },

  getJobById(id) {
    if (!db || !id) return null;
    const stmt = db.prepare("SELECT data_json FROM jobs WHERE id = ?");
    stmt.bind([id]);
    let result = null;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      try {
        result = JSON.parse(row.data_json);
      } catch (e) {}
    }
    stmt.free();
    return result;
  },

  deleteJobById(id) {
    if (!db || !id) return;
    db.run("DELETE FROM jobs WHERE id = ?", [id]);
    saveDatabaseToDisk();
  },

  clearAllJobs() {
    if (!db) return;
    db.run("DELETE FROM jobs");
    saveDatabaseToDisk();
  },

  getAppState(key) {
    if (!db || !key) return null;
    const stmt = db.prepare("SELECT value FROM app_state WHERE key = ?");
    stmt.bind([key]);
    let result = null;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      result = row.value;
    }
    stmt.free();
    return result;
  },

  setAppState(key, value) {
    if (!db || !key) return;
    db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", [key, String(value)]);
    saveDatabaseToDisk();
  },

  cleanupOldJobs(maxAgeTimestamp) {
    if (!db || !maxAgeTimestamp) return;
    db.run("DELETE FROM jobs WHERE created_at < ?", [maxAgeTimestamp]);
    saveDatabaseToDisk();
  },
};

module.exports = dbWrapper;
