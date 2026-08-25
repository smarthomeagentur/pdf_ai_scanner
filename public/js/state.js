/**
 * Central State & LocalStorage Manager (Zero-Trust)
 */

export const STORAGE_KEYS = {
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
