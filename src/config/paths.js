const path = require("path");
const fs = require("fs");

const ROOT_DIR = process.cwd();
const STORE_DIR = path.join(ROOT_DIR, "store");
if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });

const DOWNLOADS_DIR = path.join(ROOT_DIR, "downloads");
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const THUMBS_DIR = path.join(STORE_DIR, "thumbs");
if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR, { recursive: true });

const SETTINGS_FILE = path.join(STORE_DIR, "settings.json");
const TOKEN_FILE = path.join(STORE_DIR, "token.json");
const JOBS_FILE = path.join(STORE_DIR, "jobs.json");
const DB_FILE = path.join(STORE_DIR, "database.sqlite");
const SKIPPED_EMAILS_FILE = path.join(STORE_DIR, "skipped_emails.json");
const CREDENTIALS_FILE = path.join(ROOT_DIR, "gdrive_secret.json");
const SCANNER_SCRIPT = path.join(__dirname, "..", "workers", "scanner.py");
const COMPRESS_SCRIPT = path.join(__dirname, "..", "workers", "compress_pdf.py");

function getPythonPath() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;

  const isWindows = process.platform === "win32";
  const venvWin = path.join(ROOT_DIR, "venv", "Scripts", "python.exe");
  const venvUnix = path.join(ROOT_DIR, "venv", "bin", "python");
  const dotVenvUnix = path.join(ROOT_DIR, ".venv", "bin", "python");

  if (isWindows) {
    if (fs.existsSync(venvWin)) return venvWin;
    return "python";
  }

  // Linux / WSL / Docker / macOS
  if (fs.existsSync(venvUnix)) return venvUnix;
  if (fs.existsSync(dotVenvUnix)) return dotVenvUnix;
  return "python3";
}

module.exports = {
  ROOT_DIR,
  STORE_DIR,
  DOWNLOADS_DIR,
  THUMBS_DIR,
  SETTINGS_FILE,
  TOKEN_FILE,
  JOBS_FILE,
  DB_FILE,
  SKIPPED_EMAILS_FILE,
  CREDENTIALS_FILE,
  SCANNER_SCRIPT,
  COMPRESS_SCRIPT,
  getPythonPath,
};
