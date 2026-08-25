// src/services/butlerService.js
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

/**
 * Searches / retrieves existing receipts in BuchhaltungsButler to match against a document.
 * @param {Object} params
 * @param {string} params.client
 * @param {string} params.secret
 * @param {string} params.key
 * @param {string} [params.invoiceNumber]
 * @param {string} [params.fileName]
 * @param {number} [params.amountInCents]
 * @param {string} [params.documentDate]
 * @param {string} [params.company]
 * @returns {Promise<{ found: boolean, matches: Array<Object>, error?: string }>}
 */
async function searchReceipts({ client, secret, key, invoiceNumber, fileName, amountInCents, documentDate, company }) {
  if (!client || !secret || !key) return { found: false, matches: [] };
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
        limit: 100,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !Array.isArray(data.receipts)) {
      return { found: false, matches: [], error: data.message || `API Status ${res.status}` };
    }

    const targetAmountEuro = amountInCents ? amountInCents / 100 : null;
    const cleanInvNum = invoiceNumber && invoiceNumber !== "none" && invoiceNumber !== "-" ? invoiceNumber.trim().toLowerCase() : null;
    const cleanFileName = fileName ? fileName.trim().toLowerCase() : null;
    const cleanCompany = company && company !== "-" ? company.trim().toLowerCase() : null;

    const matches = [];

    for (const receipt of data.receipts) {
      const matchReasons = [];
      const rId = receipt.id || receipt.receipt_id || receipt.id_by_customer || "-";
      const rFile = (receipt.file_name || "").toLowerCase();
      const rNum = (receipt.invoice_number || receipt.number || receipt.receipt_number || "").toLowerCase();
      const rAmount = parseFloat(receipt.amount || receipt.total_amount || receipt.net_amount || "0");
      const rDate = receipt.date || receipt.receipt_date || receipt.created_at || "";
      const rPartner = (receipt.customer_name || receipt.partner || receipt.comment || "").toLowerCase();

      let hasInvMatch = false;
      let hasFileMatch = false;
      let hasAmountMatch = false;
      let hasDateMatch = false;
      let hasCompanyMatch = false;

      // 1. Invoice Number Match
      if (cleanInvNum && rNum && (rNum.includes(cleanInvNum) || cleanInvNum.includes(rNum))) {
        matchReasons.push(`Rechnungsnummer stimmt überein (${receipt.invoice_number || receipt.number})`);
        hasInvMatch = true;
      }

      // 2. Filename Match
      if (cleanFileName && rFile && (rFile.includes(cleanFileName) || cleanFileName.includes(rFile))) {
        matchReasons.push(`Dateiname stimmt überein (${receipt.file_name})`);
        hasFileMatch = true;
      }

      // 3. Amount Match
      if (targetAmountEuro !== null && rAmount > 0 && Math.abs(rAmount - targetAmountEuro) < 0.02) {
        matchReasons.push(`Betrag stimmt überein (${rAmount.toFixed(2).replace(".", ",")} €)`);
        hasAmountMatch = true;
      }

      // 4. Date Match
      if (documentDate && documentDate !== "-" && documentDate !== "unknown" && rDate.startsWith(documentDate)) {
        matchReasons.push(`Belegdatum stimmt überein (${documentDate})`);
        hasDateMatch = true;
      }

      // 5. Company Match
      if (cleanCompany && rPartner && (rPartner.includes(cleanCompany) || cleanCompany.includes(rPartner))) {
        matchReasons.push(`Unternehmen / Partner stimmt überein (${receipt.customer_name || receipt.partner || cleanCompany})`);
        hasCompanyMatch = true;
      }

      // High confidence criteria for duplicate detection
      const isConfidentMatch = hasInvMatch || hasFileMatch || (hasAmountMatch && (hasDateMatch || hasCompanyMatch));

      if (isConfidentMatch && matchReasons.length > 0) {
        const score = (hasInvMatch ? 4 : 0) + (hasFileMatch ? 3 : 0) + (hasAmountMatch ? 3 : 0) + (hasDateMatch ? 2 : 0) + (hasCompanyMatch ? 1 : 0);
        matches.push({
          id: rId,
          fileName: receipt.file_name || "Unbekannt",
          invoiceNumber: receipt.invoice_number || receipt.number || "-",
          amount: rAmount > 0 ? `${rAmount.toFixed(2).replace(".", ",")} €` : "-",
          date: rDate || "-",
          partner: receipt.customer_name || receipt.partner || "-",
          matchReasons,
          score,
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);

    return {
      found: matches.length > 0,
      matches,
    };
  } catch (err) {
    return { found: false, matches: [], error: err.message };
  }
}

module.exports = {
  verifyConnection,
  uploadReceipt,
  searchReceipts,
};
