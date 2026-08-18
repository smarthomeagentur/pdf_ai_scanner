// app/butlerApi.js
// BuchhaltungsButler (buchhaltungsbutler.de) REST API Integration

const BUTLER_API_BASE = "https://api.buchhaltungsbutler.de/v1";

/**
 * Validates connection and credentials with BuchhaltungsButler API.
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
    // Send probe request to /receipts/add without type to check authentication
    const res = await fetch(`${BUTLER_API_BASE}/receipts/add`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: key.trim() }),
    });

    const data = await res.json().catch(() => ({}));

    // error_code 8 means "invalid type specified" -> credentials ARE VALID and authenticated!
    if (data.error_code === 8 || data.success === true) {
      return {
        valid: true,
        organizationName: client,
      };
    }

    if (data.error_code === 4) {
      return {
        valid: false,
        error: `BuchhaltungsButler Mandanten-Fehler (Code 4): ${data.message || "API Client/Key im BuchhaltungsButler-Portal nicht für Mandanten freigeschaltet."}`,
      };
    }

    if (data.error_code === 3) {
      return {
        valid: false,
        error: "BuchhaltungsButler Authentifizierungsfehler: API Client oder Secret ungültig.",
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
 * Uploads a document (PDF) to BuchhaltungsButler as an expense receipt.
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

  const payload = {
    key: key.trim(),
    type: type || "expense",
    file_name: sanitizedFileName,
    file: fileBuffer.toString("base64"),
  };

  try {
    const res = await fetch(`${BUTLER_API_BASE}/receipts/add`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success) {
      const fileId = data.id || data.receipt_id || `bb_${Date.now()}`;
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
