const { appSettings } = require("../config/settings");
const { checkIsAdmin } = require("../middleware/auth");

// ClickUp credentials only exist in the client's browser. For automatic transfer after processing
// they are held here in process memory only (never on the job, never in the queue, never in SQLite)
// and discarded once the job is done or the TTL has passed.
const CREDENTIAL_TTL_MS = 60 * 60 * 1000;
const pendingCredentials = new Map();

function extractAutoTransferCredentials(req) {
  if (appSettings.CLICKUP_AUTO_TASK === false) return null;
  if (!checkIsAdmin(req)) return null;
  const apiKey = String(req.headers["x-clickup-api-key"] || "").trim();
  if (!apiKey) return null;
  const listId = String(req.headers["x-clickup-list-id"] || "").trim();
  return { apiKey, listId };
}

function storeCredentials(jobIds, credentials) {
  if (!credentials) return;
  const expiresAt = Date.now() + CREDENTIAL_TTL_MS;
  for (const jobId of jobIds) {
    pendingCredentials.set(jobId, { ...credentials, expiresAt });
  }
}

// Returns the credentials once and removes them from the store.
function takeCredentials(jobId) {
  const entry = pendingCredentials.get(jobId);
  pendingCredentials.delete(jobId);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return { apiKey: entry.apiKey, listId: entry.listId };
}

function hasCredentials(jobId) {
  const entry = pendingCredentials.get(jobId);
  return !!entry && entry.expiresAt >= Date.now();
}

function discardCredentials(jobId) {
  pendingCredentials.delete(jobId);
}

setInterval(() => {
  const now = Date.now();
  for (const [jobId, entry] of pendingCredentials) {
    if (entry.expiresAt < now) {
      pendingCredentials.delete(jobId);
      console.log(`[CLICKUP] Zwischengespeicherter API-Key für Job ${jobId} abgelaufen und verworfen.`);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  extractAutoTransferCredentials,
  storeCredentials,
  takeCredentials,
  hasCredentials,
  discardCredentials,
};
