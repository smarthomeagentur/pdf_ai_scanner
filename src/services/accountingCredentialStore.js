const { checkIsAdmin } = require("../middleware/auth");

// Accounting credentials only exist in the client's browser (Zero-Trust).
// For automatic transfer after AI processing they are held in process memory only
// (never on the job, never in SQLite, never on disk) and discarded once the job finishes or TTL expires.
const CREDENTIAL_TTL_MS = 60 * 60 * 1000;
const pendingAccountingConfigs = new Map();

function decodeAccountsHeader(rawHeader) {
  if (!rawHeader || typeof rawHeader !== "string") return [];
  try {
    const trimmed = rawHeader.trim();
    if (!trimmed) return [];
    const jsonStr = trimmed.startsWith("[")
      ? trimmed
      : Buffer.from(trimmed, "base64").toString("utf8");
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((acc) => acc && typeof acc === "object" && acc.id)
      .map((acc) => ({
        id: String(acc.id),
        name: String(acc.name || acc.id),
        provider: acc.provider === "buchhaltungsbutler" ? "buchhaltungsbutler" : "lexoffice",
        credentials: acc.credentials && typeof acc.credentials === "object" ? { ...acc.credentials } : {},
      }));
  } catch (err) {
    console.warn("[ACCOUNTING] Konnte X-Accounting-Accounts Header nicht parsen:", err.message);
    return [];
  }
}

function parseAccountingTargets(body) {
  if (!body) return null;
  if (Array.isArray(body.accountingTargets)) return body.accountingTargets;
  if (typeof body.accountingTargets === "string" && body.accountingTargets.trim()) {
    try {
      const parsed = JSON.parse(body.accountingTargets);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {}
  }
  return null;
}

/**
 * Extracts per-job accounting auto-sync configuration from an upload/scan request.
 * Returns a Map<jobId, { accounts, explicitAccountId, skipAutoSync }> or null.
 */
function extractAccountingAutoSync(req, jobs = []) {
  if (!checkIsAdmin(req)) return null;
  const accounts = decodeAccountsHeader(req.headers["x-accounting-accounts"]);
  if (accounts.length === 0) return null;

  const targetsArray = parseAccountingTargets(req.body);
  const singleTarget =
    req.body && typeof req.body.accountingAccountId === "string"
      ? req.body.accountingAccountId.trim()
      : null;

  const result = new Map();
  jobs.forEach((job, idx) => {
    if (!job || !job.id) return;
    let explicitTarget = null;
    if (targetsArray && idx < targetsArray.length) {
      explicitTarget = targetsArray[idx] !== undefined && targetsArray[idx] !== null ? String(targetsArray[idx]).trim() : null;
    } else if (singleTarget !== null) {
      explicitTarget = singleTarget;
    }

    const skipAutoSync = explicitTarget === "none" || explicitTarget === "false";
    const explicitAccountId =
      explicitTarget && !skipAutoSync && explicitTarget !== "auto" ? explicitTarget : null;

    result.set(job.id, {
      accounts,
      explicitAccountId,
      skipAutoSync,
    });
  });

  return result.size > 0 ? result : null;
}

function storeConfig(jobConfigMap) {
  if (!jobConfigMap) return;
  const expiresAt = Date.now() + CREDENTIAL_TTL_MS;
  for (const [jobId, cfg] of jobConfigMap.entries()) {
    pendingAccountingConfigs.set(jobId, { ...cfg, expiresAt });
  }
}

function takeConfig(jobId) {
  const entry = pendingAccountingConfigs.get(jobId);
  pendingAccountingConfigs.delete(jobId);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return {
    accounts: entry.accounts,
    explicitAccountId: entry.explicitAccountId,
    skipAutoSync: entry.skipAutoSync,
  };
}

function hasConfig(jobId) {
  const entry = pendingAccountingConfigs.get(jobId);
  return !!entry && entry.expiresAt >= Date.now() && !entry.skipAutoSync;
}

function discardConfig(jobId) {
  pendingAccountingConfigs.delete(jobId);
}

setInterval(() => {
  const now = Date.now();
  for (const [jobId, entry] of pendingAccountingConfigs) {
    if (entry.expiresAt < now) {
      pendingAccountingConfigs.delete(jobId);
      console.log(`[ACCOUNTING] Zwischengespeicherte Buchhaltungs-Daten für Job ${jobId} abgelaufen und verworfen.`);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  decodeAccountsHeader,
  extractAccountingAutoSync,
  storeConfig,
  takeConfig,
  hasConfig,
  discardConfig,
};
