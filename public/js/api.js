/**
 * Central API Client with Automatic Secret Injecting & Error Handling
 */
import { getAllClientCredentials } from "./state.js";

export async function apiRequest(endpoint, options = {}) {
  const defaultHeaders = {
    Accept: "application/json",
  };

  if (!(options.body instanceof FormData)) {
    defaultHeaders["Content-Type"] = "application/json";
  }

  const credentials = getAllClientCredentials();
  if (credentials.wirewireApiKey) defaultHeaders["X-Lexoffice-Key-Wirewire"] = credentials.wirewireApiKey;
  if (credentials.polyxoApiKey) defaultHeaders["X-Lexoffice-Key-Polyxo"] = credentials.polyxoApiKey;
  if (credentials.clickupApiKey) defaultHeaders["X-Clickup-Api-Key"] = credentials.clickupApiKey;
  if (credentials.clickupListId) defaultHeaders["X-Clickup-List-Id"] = credentials.clickupListId;

  const mergedOptions = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {}),
    },
  };

  const res = await fetch(endpoint, mergedOptions);
  if (!res.ok) {
    let errorData = null;
    try {
      errorData = await res.json();
    } catch (e) {
      errorData = { error: `HTTP ${res.status}: ${res.statusText}` };
    }
    throw new Error(errorData.error || errorData.message || `HTTP ${res.status}`);
  }

  return await res.json();
}
