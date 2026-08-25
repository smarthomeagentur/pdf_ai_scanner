/**
 * ClickUp Integration Module
 */
import { escapeHtml, showToast } from "./utils.js";
import { apiRequest } from "./api.js";
import { getAllClientCredentials } from "./state.js";

export async function transferJobToClickUp(jobId, force = false) {
  try {
    const creds = getAllClientCredentials();
    const data = await apiRequest("/api/clickup/transfer", {
      method: "POST",
      body: JSON.stringify({
        jobId,
        force,
        apiKey: creds.clickupApiKey,
        listId: creds.clickupListId,
      }),
    });

    if (data.success) {
      showToast("Erfolgreich zu ClickUp übertragen!", "success");
    }
  } catch (err) {
    showToast(`ClickUp Fehler: ${err.message}`, "error");
  }
}
