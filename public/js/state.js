/**
 * Central State & LocalStorage Manager (Zero-Trust)
 */

export const STORAGE_KEYS = {
  ACCOUNTING_ACCOUNTS: "scanner_accounting_accounts_v1",
  LEXOFFICE_WIREWIRE: "scanner_lexoffice_key_wirewire",
  LEXOFFICE_POLYXO: "scanner_lexoffice_key_polyxo",
  BUTTLER_CLIENT: "scanner_buttler_key_thewire_client",
  BUTTLER_SECRET: "scanner_buttler_key_thewire_secret",
  BUTTLER_KEY: "scanner_buttler_key_thewire_key",
  CLICKUP_API_KEY: "scanner_clickup_api_key",
  CLICKUP_LIST_ID: "scanner_clickup_list_id",
  GMAIL_ACCOUNTS: "scanner_client_gmail_accounts",
  GMAIL_SKIPPED: "scanner_client_gmail_skipped",
  DRIVE_SEARCH_QUERY: "scanner_client_drive_query",
};

export const state = {
  isAdmin: false,
  activeFilter: "all",
  searchQuery: "",
  deepSearchSnippets: new Map(),
  driveOnlySearchResults: [],
  selectedCategories: new Set(),
  dateFilter: "alle",
  companyFilter: "alle",
  sortOrder: "docdate_desc",
  jobs: [],
  selectedJobId: null,
  gmailAccounts: [],
  accountingAccounts: [],
  skippedEmails: {},
  settings: {},
};

export function getClientSecret(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (e) {
    return "";
  }
}

export function setClientSecret(key, value) {
  try {
    if (value && String(value).trim()) {
      localStorage.setItem(key, String(value).trim());
    } else {
      localStorage.removeItem(key);
    }
  } catch (e) {}
}

export function getAllClientCredentials() {
  return {
    wirewireApiKey: getClientSecret(STORAGE_KEYS.LEXOFFICE_WIREWIRE),
    polyxoApiKey: getClientSecret(STORAGE_KEYS.LEXOFFICE_POLYXO),
    thewireClient: getClientSecret(STORAGE_KEYS.BUTTLER_CLIENT),
    thewireSecret: getClientSecret(STORAGE_KEYS.BUTTLER_SECRET),
    thewireKey: getClientSecret(STORAGE_KEYS.BUTTLER_KEY),
    clickupApiKey: getClientSecret(STORAGE_KEYS.CLICKUP_API_KEY),
    clickupListId: getClientSecret(STORAGE_KEYS.CLICKUP_LIST_ID),
  };
}

/**
 * Modular Accounting Accounts Manager (Zero-Trust)
 * Returns array of { id, name, provider: 'lexoffice'|'buchhaltungsbutler', credentials: {...}, createdAt }
 */
export function getAccountingAccounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACCOUNTING_ACCOUNTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.accountingAccounts = parsed;
        return parsed;
      }
    }
  } catch (e) {}

  // Auto-migration from legacy static keys if found
  const legacyWirewireKey = getClientSecret(STORAGE_KEYS.LEXOFFICE_WIREWIRE);
  const legacyPolyxoKey = getClientSecret(STORAGE_KEYS.LEXOFFICE_POLYXO);
  const legacyButlerClient = getClientSecret(STORAGE_KEYS.BUTTLER_CLIENT);
  const legacyButlerSecret = getClientSecret(STORAGE_KEYS.BUTTLER_SECRET);
  const legacyButlerKey = getClientSecret(STORAGE_KEYS.BUTTLER_KEY);

  const migrated = [];
  if (legacyButlerClient || legacyButlerSecret || legacyButlerKey) {
    migrated.push({
      id: "thewire",
      name: "The Wire UG",
      provider: "buchhaltungsbutler",
      credentials: {
        client: legacyButlerClient,
        secret: legacyButlerSecret,
        key: legacyButlerKey,
      },
      createdAt: new Date().toISOString(),
    });
  }
  if (legacyWirewireKey) {
    migrated.push({
      id: "wirewire",
      name: "wirewire GmbH",
      provider: "lexoffice",
      credentials: {
        apiKey: legacyWirewireKey,
      },
      createdAt: new Date().toISOString(),
    });
  }
  if (legacyPolyxoKey) {
    migrated.push({
      id: "polyxo",
      name: "Polyxo Studios GmbH",
      provider: "lexoffice",
      credentials: {
        apiKey: legacyPolyxoKey,
      },
      createdAt: new Date().toISOString(),
    });
  }

  if (migrated.length > 0) {
    saveAccountingAccounts(migrated);
    return migrated;
  }

  state.accountingAccounts = [];
  return [];
}

export function saveAccountingAccounts(accounts) {
  try {
    const valid = Array.isArray(accounts) ? accounts : [];
    localStorage.setItem(STORAGE_KEYS.ACCOUNTING_ACCOUNTS, JSON.stringify(valid));
    state.accountingAccounts = valid;
  } catch (e) {
    console.error("Failed to save accounting accounts to localStorage:", e);
  }
}

export function saveOrUpdateAccountingAccount(account) {
  const accounts = getAccountingAccounts();
  const index = accounts.findIndex((a) => a.id === account.id);
  if (index >= 0) {
    accounts[index] = { ...accounts[index], ...account, updatedAt: new Date().toISOString() };
  } else {
    accounts.push({
      ...account,
      id: account.id || `acc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      createdAt: new Date().toISOString(),
    });
  }
  saveAccountingAccounts(accounts);
  return accounts;
}

export function deleteAccountingAccountById(id) {
  const accounts = getAccountingAccounts().filter((a) => a.id !== id);
  saveAccountingAccounts(accounts);
  return accounts;
}

export function findJobInState(jobId) {
  if (!jobId) return null;
  const strId = String(jobId);
  const cleanId = strId.replace(/^gdrive_/, "");

  const matcher = (j) => {
    if (!j) return false;
    const jId = String(j.id || "");
    const jClean = jId.replace(/^gdrive_/, "");
    const rawDrive = String(j.rawDriveId || "");
    const driveFile = String(j.driveFileId || "");
    return (
      jId === strId ||
      jClean === cleanId ||
      rawDrive === cleanId ||
      driveFile === cleanId ||
      rawDrive === strId ||
      driveFile === strId
    );
  };

  if (Array.isArray(state.jobs)) {
    const found = state.jobs.find(matcher);
    if (found) return found;
  }
  if (Array.isArray(state.driveOnlySearchResults)) {
    const found = state.driveOnlySearchResults.find(matcher);
    if (found) return found;
  }
  if (window.allRechnungenJobs && Array.isArray(window.allRechnungenJobs)) {
    const found = window.allRechnungenJobs.find(matcher);
    if (found) return found;
  }
  return null;
}
