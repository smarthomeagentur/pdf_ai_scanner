// app/butlerApi.js
// BuchhaltungsButler (buchhaltungsbutler.de) REST API Integration

const BUTLER_API_BASE = "https://api.buchhaltungsbutler.de/v1";

/**
 * Validates connection and credentials with BuchhaltungsButler API.
 * Uses /receipts/get with limit: 1 to verify credentials and Mandant access.
 * @param {Object} params
 * @param {string} params.client API Client (e.g. the_wire_ug)
 * @param {string} params.secret API Secret
 * @param {string} params.key API Key
 * @returns {Promise<{ valid: boolean, error?: string, organizationName?: string }>}
 */
async function verifyConnection({ client, secret, key }) {
  if (!client || !secret || !key) {
    return { valid: false, error: "Unvollständige BuchhaltungsButler Zugangsdaten (Client, Secret oder Key fehlt)." };
  }

  const basicAuth = Buffer.from(`${client.trim()}:${secret.trim()}`).toString("base64");

  try {
    const res = await fetch(`${BUTLER_API_BASE}/receipts/get`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: key.trim(),
        list_direction: "inbound",
        limit: 1,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success === true) {
      return {
        valid: true,
        organizationName: client,
      };
    }

    if (data.error_code === 4) {
      return {
        valid: false,
        error: "BuchhaltungsButler Mandanten-Fehler (Code 4): Der API-Key ist im Portal nicht für den API-Client ('" + client + "') freigeschaltet.",
      };
    }

    if (data.error_code === 3) {
      return {
        valid: false,
        error: "BuchhaltungsButler Authentifizierungsfehler (Code 3): API Client oder Secret ist ungültig.",
      };
    }

    return {
      valid: false,
      error: data.message || `API Fehler (${res.status})`,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Verbindungsfehler zu BuchhaltungsButler: ${err.message}`,
    };
  }
}

/**
 * Uploads a document (PDF) to BuchhaltungsButler as an expense/income receipt.
 * @param {Object} params
 * @param {Buffer} params.fileBuffer PDF Buffer
 * @param {string} params.fileName PDF Filename
 * @param {string} params.client API Client
 * @param {string} params.secret API Secret
 * @param {string} params.key API Key
 * @param {string} [params.type="expense"] Receipt type ('expense' or 'income')
 * @returns {Promise<{ success: boolean, fileId?: string, transferredAt?: string, error?: string }>}
 */
async function uploadReceipt({ fileBuffer, fileName, client, secret, key, type = "expense" }) {
  if (!fileBuffer || fileBuffer.length === 0) {
    return { success: false, error: "Keine Datei zum Hochladen vorhanden." };
  }
  if (!client || !secret || !key) {
    return { success: false, error: "BuchhaltungsButler Zugangsdaten fehlen in den Einstellungen." };
  }

  const basicAuth = Buffer.from(`${client.trim()}:${secret.trim()}`).toString("base64");
  let sanitizedFileName = fileName || "Dokument.pdf";
  if (!sanitizedFileName.toLowerCase().endsWith(".pdf")) sanitizedFileName += ".pdf";

  // Map type to BuchhaltungsButler swagger specification
  const bbType = type === "income" ? "invoice outbound" : "invoice inbound";

  const payload = {
    api_key: key.trim(),
    type: bbType,
    file_name: sanitizedFileName,
    file: fileBuffer.toString("base64"),
  };

  try {
    const res = await fetch(`${BUTLER_API_BASE}/receipts/upload`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      const fileId = data.id_by_customer || data.id || data.receipt_id || `bb_${Date.now()}`;
      return {
        success: true,
        fileId: fileId.toString(),
        transferredAt: new Date().toISOString(),
      };
    }

    const errMsg = data.message || `BuchhaltungsButler Fehler (${res.status}): ${JSON.stringify(data)}`;
    console.error("[BUTLER API] Upload fehlgeschlagen:", res.status, data);
    return {
      success: false,
      error: errMsg,
    };
  } catch (err) {
    console.error("[BUTLER API] Netzwerkfehler beim Upload:", err);
    return {
      success: false,
      error: `Netzwerkfehler bei BuchhaltungsButler: ${err.message}`,
    };
  }
}

module.exports = {
  verifyConnection,
  uploadReceipt,
};
