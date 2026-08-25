const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { DB_FILE, JOBS_FILE } = require("../config/paths");

let db = null;

function getDatabase() {
  if (db) return db;

  db = new Database(DB_FILE);

  // Performance Pragmas (WAL mode for concurrent fast reads & writes)
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");

  // Create tables
  db.exec(`
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

  return db;
}

/**
 * Automatically migrates existing jobs from store/jobs.json into SQLite on initial run.
 */
function runAutoMigration(database) {
  try {
    const migrationState = database.prepare("SELECT value FROM app_state WHERE key = 'migration_done'").get();
    if (migrationState && migrationState.value === "true") {
      return;
    }

    if (!fs.existsSync(JOBS_FILE)) {
      database.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('migration_done', 'true')").run();
      return;
    }

    console.log("[SQLITE] Starte automatische Migration von jobs.json nach database.sqlite...");

    // 1. Sicherheitskopie erstellen
    const backupFile = `${JOBS_FILE}.bak`;
    fs.copyFileSync(JOBS_FILE, backupFile);
    console.log(`[SQLITE] Backup erstellt: ${backupFile}`);

    // 2. Daten einlesen
    const rawData = fs.readFileSync(JOBS_FILE, "utf8");
    const parsed = JSON.parse(rawData);

    const uploadJobs = parsed.uploadJobs || {};
    const uploadQueue = parsed.uploadQueue || [];
    const processedDriveFiles = parsed.processedDriveFiles || [];
    const hiddenDriveFiles = parsed.hiddenDriveFiles || [];

    const insertJobStmt = database.prepare(`
      INSERT OR REPLACE INTO jobs (
        id, original_name, status, source, upload_date, document_date,
        category, company, invoice_number, invoice_amount, is_invoice,
        is_hidden, is_private, suspected_duplicate, file_path,
        raw_drive_id, drive_file_id, data_json, created_at, updated_at
      ) VALUES (
        @id, @original_name, @status, @source, @upload_date, @document_date,
        @category, @company, @invoice_number, @invoice_amount, @is_invoice,
        @is_hidden, @is_private, @suspected_duplicate, @file_path,
        @raw_drive_id, @drive_file_id, @data_json, @created_at, @updated_at
      )
    `);

    const setAppStateStmt = database.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)");

    const migrateTx = database.transaction(() => {
      let count = 0;
      const now = Date.now();

      for (const jobId in uploadJobs) {
        const job = uploadJobs[jobId];
        if (!job || !job.id) continue;

        // Metadaten sauber extrahieren
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

        insertJobStmt.run({
          id: job.id,
          original_name: originalName,
          status,
          source,
          upload_date: uploadDate,
          document_date: documentDate,
          category,
          company,
          invoice_number: invoiceNumber,
          invoice_amount: invoiceAmount,
          is_invoice: isInvoice,
          is_hidden: isHidden,
          is_private: isPrivate,
          suspected_duplicate: suspectedDuplicate,
          file_path: filePath,
          raw_drive_id: rawDriveId,
          drive_file_id: driveFileId,
          data_json: JSON.stringify(job),
          created_at: new Date(uploadDate).getTime() || now,
          updated_at: now,
        });
        count++;
      }

      setAppStateStmt.run("upload_queue", JSON.stringify(uploadQueue));
      setAppStateStmt.run("processed_drive_files", JSON.stringify(processedDriveFiles));
      setAppStateStmt.run("hidden_drive_files", JSON.stringify(hiddenDriveFiles));
      setAppStateStmt.run("migration_done", "true");

      console.log(`[SQLITE] Migration erfolgreich! ${count} Belege/Jobs in SQLite importiert.`);
    });

    migrateTx();

    // 3. jobs.json umbenennen, um Verwirrung zu vermeiden
    if (fs.existsSync(JOBS_FILE)) {
      const migratedFile = `${JOBS_FILE}.migrated`;
      try {
        fs.renameSync(JOBS_FILE, migratedFile);
        console.log(`[SQLITE] jobs.json erfolgreich in jobs.json.migrated umbenannt.`);
      } catch (renameErr) {
        console.error(`[SQLITE] Fehler beim Umbenennen von jobs.json:`, renameErr);
      }
    }
  } catch (err) {
    console.error("[SQLITE] Fehler bei der Migration von jobs.json:", err);
  }
}

// Prepared Statements Cache
let statements = null;

function getStatements() {
  if (statements) return statements;
  const d = getDatabase();

  statements = {
    insertOrReplaceJob: d.prepare(`
      INSERT OR REPLACE INTO jobs (
        id, original_name, status, source, upload_date, document_date,
        category, company, invoice_number, invoice_amount, is_invoice,
        is_hidden, is_private, suspected_duplicate, file_path,
        raw_drive_id, drive_file_id, data_json, created_at, updated_at
      ) VALUES (
        @id, @original_name, @status, @source, @upload_date, @document_date,
        @category, @company, @invoice_number, @invoice_amount, @is_invoice,
        @is_hidden, @is_private, @suspected_duplicate, @file_path,
        @raw_drive_id, @drive_file_id, @data_json, @created_at, @updated_at
      )
    `),

    getJobById: d.prepare("SELECT data_json FROM jobs WHERE id = ?"),

    getAllJobs: d.prepare("SELECT data_json FROM jobs ORDER BY upload_date DESC"),

    getVisibleJobs: d.prepare("SELECT data_json FROM jobs WHERE is_hidden = 0 ORDER BY upload_date DESC"),

    deleteJobById: d.prepare("DELETE FROM jobs WHERE id = ?"),

    clearAllJobs: d.prepare("DELETE FROM jobs"),

    updateJobHidden: d.prepare("UPDATE jobs SET is_hidden = ?, updated_at = ? WHERE id = ?"),

    getAppState: d.prepare("SELECT value FROM app_state WHERE key = ?"),

    setAppState: d.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)"),

    cleanupOldJobs: d.prepare("DELETE FROM jobs WHERE created_at < ?"),
  };

  return statements;
}

module.exports = {
  getDatabase,
  getStatements,
};
