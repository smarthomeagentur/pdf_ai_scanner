const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { requireAdmin } = require("../middleware/auth");
const { appSettings } = require("../config/settings");
const { DOWNLOADS_DIR, ROOT_DIR, getPythonPath, COMPRESS_SCRIPT } = require("../config/paths");
const { getJob, saveJobs, uploadJobs } = require("../services/jobQueueService");
const { driveApi } = require("../services/driveService");
const { renderPdfToJpeg } = require("../services/fileRenderService");
const {
  fetchLexofficeWithRetry,
  searchLexofficeVouchers,
  butlerApi,
} = require("../services/accountingService");

const router = express.Router();

async function getJobPdfBuffer(job) {
  if (job.filePath && fs.existsSync(job.filePath)) {
    return await fs.promises.readFile(job.filePath);
  }

  let driveFileId = job.rawDriveId;
  if (!driveFileId && job.result && job.result.webViewLink) {
    const match = job.result.webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) driveFileId = match[1];
  }

  if (!driveFileId) return null;

  try {
    const drive = await driveApi.getClient();
    const driveRes = await drive.files.get({ fileId: driveFileId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(driveRes.data);
  } catch (e) {
    console.error(`[PDF BUFFER] Fehler beim Laden der Datei aus Google Drive (ID ${driveFileId}):`, e);
    return null;
  }
}

async function checkSingleModularAccount(job, account) {
  const accountId = account.id || account.companyKey || "unknown";
  const accountName = account.name || account.companyDisplayName || accountId;
  const provider = account.provider || (accountId === "thewire" ? "buchhaltungsbutler" : "lexoffice");
  const providerName = provider === "buchhaltungsbutler" ? "BuchhaltungsButler" : "Lexoffice";
  const credentials = account.credentials || {};

  let apiValid = false;
  let apiError = null;
  let organizationName = null;
  let liveSearch = { performed: false, found: false, matches: [] };

  if (provider === "buchhaltungsbutler") {
    const client = (credentials.client || credentials.thewireClient || appSettings.BUTTLER_KEY_THEWIRE_CLIENT || process.env.BUTTLER_KEY_THEWIRE_CLIENT || "").trim();
    const secret = (credentials.secret || credentials.thewireSecret || appSettings.BUTTLER_KEY_THEWIRE_SECRET || process.env.BUTTLER_KEY_THEWIRE_SECRET || "").trim();
    const key = (credentials.key || credentials.thewireKey || appSettings.BUTTLER_KEY_THEWIRE_KEY || process.env.BUTTLER_KEY_THEWIRE_KEY || "").trim();

    if (client && secret && key) {
      try {
        const testRes = await butlerApi.testConnection({ client, secret, key });
        if (testRes.success) {
          apiValid = true;
          organizationName = testRes.companyName || accountName;
          const invNum = job.result?.invoiceNumber && job.result?.invoiceNumber !== "none" ? job.result.invoiceNumber : "";
          const fName = job.result?.full || job.originalName || "";
          const amountCents = job.result?.invoiceAmmount !== undefined ? job.result.invoiceAmmount : job.invoiceAmmount;
          const searchRes = await butlerApi.searchDocuments({
            client,
            secret,
            key,
            invoiceNumber: invNum,
            fileName: fName,
            amountInCents: amountCents,
          });
          liveSearch = {
            performed: true,
            found: searchRes.found,
            matches: searchRes.matches || [],
            error: searchRes.error,
          };
        } else {
          apiValid = false;
          apiError = testRes.error || "BuchhaltungsButler API-Verbindung fehlgeschlagen.";
        }
      } catch (err) {
        apiValid = false;
        apiError = `Verbindungsfehler zu BuchhaltungsButler: ${err.message}`;
      }
    } else {
      apiValid = false;
      apiError = `Keine Zugangsdaten für BuchhaltungsButler (${accountName}) hinterlegt.`;
    }
  } else {
    // Lexoffice
    const apiKey = (credentials.apiKey || credentials.wirewireApiKey || credentials.polyxoApiKey || appSettings[`LEXOFFICE_KEY_${String(accountId).toUpperCase()}`] || process.env[`LEXOFFICE_KEY_${String(accountId).toUpperCase()}`] || "").trim();

    if (apiKey) {
      try {
        const apiRes = await fetchLexofficeWithRetry("https://api.lexoffice.io/v1/profile", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (apiRes.ok) {
          apiValid = true;
          const profile = await apiRes.json();
          organizationName = profile.organizationName || accountName;
          const invNum = job.result?.invoiceNumber && job.result?.invoiceNumber !== "none" ? job.result.invoiceNumber : "";
          const fName = job.result?.full || job.originalName || "";
          const amountCents = job.result?.invoiceAmmount !== undefined ? job.result.invoiceAmmount : job.invoiceAmmount;
          const docDate = job.result?.documentDate || "";
          const compName = job.result?.company || "";
          const searchRes = await searchLexofficeVouchers(apiKey, {
            invoiceNumber: invNum,
            fileName: fName,
            amountInCents: amountCents,
            documentDate: docDate,
            company: compName,
          });
          liveSearch = {
            performed: true,
            found: searchRes.found,
            matches: searchRes.matches || [],
            error: searchRes.error,
          };
        } else {
          apiValid = false;
          apiError = `Lexoffice API Fehler (${apiRes.status}): Ungültiger API-Key oder keine Berechtigung.`;
        }
      } catch (err) {
        apiValid = false;
        apiError = `Verbindungsfehler zu Lexoffice: ${err.message}`;
      }
    } else {
      apiValid = false;
      apiError = `Kein API-Key für Lexoffice (${accountName}) hinterlegt.`;
    }
  }

  // Check if transferred under accountId or accountName or legacy keys
  const transfers = job.lexofficeTransfers || {};
  let alreadyTransferred = false;
  let transferredInfo = null;

  if (transfers[accountId]) {
    alreadyTransferred = true;
    transferredInfo = transfers[accountId];
  } else if (transfers[accountName]) {
    alreadyTransferred = true;
    transferredInfo = transfers[accountName];
  } else if (accountId === "thewire" && transfers["thewire"]) {
    alreadyTransferred = true;
    transferredInfo = transfers["thewire"];
  } else if (accountId === "wirewire" && transfers["wirewire"]) {
    alreadyTransferred = true;
    transferredInfo = transfers["wirewire"];
  } else if (accountId === "polyxo" && transfers["polyxo"]) {
    alreadyTransferred = true;
    transferredInfo = transfers["polyxo"];
  }

  const hasLiveMatch = !!(liveSearch.found && Array.isArray(liveSearch.matches) && liveSearch.matches.length > 0);

  return {
    accountId,
    companyKey: accountId,
    accountName,
    companyDisplayName: accountName,
    provider,
    providerName,
    apiValid,
    apiError,
    organizationName,
    alreadyTransferred,
    transferredInfo,
    liveSearch,
    hasMatch: alreadyTransferred || hasLiveMatch,
    topMatch: hasLiveMatch ? liveSearch.matches[0] : null,
  };
}

router.post("/api/accounting/test-connection", requireAdmin, async (req, res) => {
  const { provider, credentials = {} } = req.body;
  try {
    if (provider === "buchhaltungsbutler") {
      const client = (credentials.client || "").trim();
      const secret = (credentials.secret || "").trim();
      const key = (credentials.key || "").trim();
      if (!client || !secret || !key) {
        return res.json({ success: false, error: "Client, Secret und Key sind erforderlich." });
      }
      const testRes = await butlerApi.testConnection({ client, secret, key });
      return res.json(testRes);
    } else {
      // Lexoffice
      const apiKey = (credentials.apiKey || "").trim();
      if (!apiKey) {
        return res.json({ success: false, error: "API-Key ist erforderlich." });
      }
      const apiRes = await fetchLexofficeWithRetry("https://api.lexoffice.io/v1/profile", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (apiRes.ok) {
        const profile = await apiRes.json();
        return res.json({
          success: true,
          companyName: profile.organizationName || "Lexoffice Organisation",
        });
      } else {
        return res.json({
          success: false,
          error: `Lexoffice API Fehler (${apiRes.status}): Ungültiger API-Key oder fehlende Berechtigung.`,
        });
      }
    }
  } catch (err) {
    return res.json({ success: false, error: `Verbindungsfehler: ${err.message}` });
  }
});

router.post(["/api/accounting/check", "/api/lexoffice/check"], requireAdmin, async (req, res) => {
  const { jobId, companyKey, accounts = [], credentials = {} } = req.body;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden" });

  // If accounts list is provided dynamically from frontend
  let accountsToCheck = Array.isArray(accounts) && accounts.length > 0 ? accounts : [];

  // Fallback to legacy static list if no accounts were sent
  if (accountsToCheck.length === 0) {
    accountsToCheck = [
      { id: "thewire", name: "The Wire UG", provider: "buchhaltungsbutler", credentials: { client: credentials.thewireClient, secret: credentials.thewireSecret, key: credentials.thewireKey } },
      { id: "wirewire", name: "wirewire GmbH", provider: "lexoffice", credentials: { apiKey: credentials.wirewireApiKey } },
      { id: "polyxo", name: "Polyxo Studios GmbH", provider: "lexoffice", credentials: { apiKey: credentials.polyxoApiKey } },
    ];
  }

  const allCompanyChecksArray = await Promise.all(
    accountsToCheck.map((acc) => checkSingleModularAccount(job, acc))
  );

  const allCompanyChecks = {};
  allCompanyChecksArray.forEach((cRes) => {
    allCompanyChecks[cRes.accountId] = cRes;
  });

  // Suggest best matching account based on document AI company
  let suggestedCompany = null;
  const docCompany = (job.result?.company || "").toLowerCase();
  for (const acc of accountsToCheck) {
    const accName = (acc.name || "").toLowerCase();
    if (docCompany && (docCompany.includes(accName) || accName.includes(docCompany))) {
      suggestedCompany = acc.id;
      break;
    }
  }
  if (!suggestedCompany && accountsToCheck.length > 0) {
    suggestedCompany = accountsToCheck[0].id;
  }

  const targetComp = companyKey && allCompanyChecks[companyKey] ? companyKey : suggestedCompany;
  const selectedData = allCompanyChecks[targetComp] || (accountsToCheck.length > 0 ? allCompanyChecks[accountsToCheck[0].id] : null);

  res.json({
    success: true,
    jobId: job.id,
    provider: selectedData?.provider || "lexoffice",
    providerName: selectedData?.providerName || "Lexoffice",
    selectedCompany: targetComp,
    suggestedCompany,
    apiValid: selectedData?.apiValid || false,
    apiError: selectedData?.apiError || null,
    organizationName: selectedData?.organizationName || null,
    alreadyTransferred: selectedData?.alreadyTransferred || false,
    transferredInfo: selectedData?.transferredInfo || null,
    liveSearch: selectedData?.liveSearch || { performed: false, found: false, matches: [] },
    allCompanyChecks,
    allTransfers: job.lexofficeTransfers || {},
    accounts: accountsToCheck,
    documentDetails: {
      title: job.result?.full || job.originalName,
      documentDate: job.result?.documentDate || "-",
      invoiceNumber: job.result?.invoiceNumber || job.invoiceNumber || "none",
      invoiceAmmount: job.result?.invoiceAmmount !== undefined ? job.result.invoiceAmmount : (job.invoiceAmmount || 0),
      company: job.result?.company || "-",
      category: job.result?.category || "-",
      thumbnailLink: job.result?.thumbnailLink,
      webViewLink: job.result?.webViewLink,
      rawDriveId: job.rawDriveId,
    },
  });
});

router.post("/api/accounting/mark-synced", requireAdmin, async (req, res) => {
  const { jobId, companyKey, accountId, fileId } = req.body;
  const targetKey = accountId || companyKey;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden" });

  if (!job.lexofficeTransfers) job.lexofficeTransfers = {};
  const provider = targetKey === "thewire" ? "buchhaltungsbutler" : "lexoffice";
  job.lexofficeTransfers[targetKey] = {
    provider,
    fileId: fileId || `manual_${Date.now()}`,
    transferredAt: new Date().toISOString(),
    manuallyMatched: true,
  };
  saveJobs();
  res.json({ success: true, allTransfers: job.lexofficeTransfers });
});

router.post(["/api/accounting/transfer", "/api/lexoffice/transfer"], requireAdmin, async (req, res) => {
  const { jobId, companyKey, account, force, apiKey: reqApiKey, client: reqClient, secret: reqSecret, key: reqKey, credentials = {} } = req.body;
  
  const targetAccount = account || {
    id: companyKey || "thewire",
    name: companyKey === "thewire" ? "The Wire UG" : (companyKey === "wirewire" ? "wirewire GmbH" : "Polyxo Studios GmbH"),
    provider: companyKey === "thewire" ? "buchhaltungsbutler" : "lexoffice",
    credentials: {
      apiKey: reqApiKey || (companyKey === "wirewire" ? credentials.wirewireApiKey : credentials.polyxoApiKey) || credentials.apiKey,
      client: reqClient || credentials.thewireClient || credentials.client,
      secret: reqSecret || credentials.thewireSecret || credentials.secret,
      key: reqKey || credentials.thewireKey || credentials.key,
    },
  };

  const accountId = targetAccount.id || companyKey;
  const accountName = targetAccount.name || accountId;
  const provider = targetAccount.provider || (accountId === "thewire" ? "buchhaltungsbutler" : "lexoffice");
  const creds = targetAccount.credentials || {};

  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });

  if (job.lexofficeTransfers && job.lexofficeTransfers[accountId] && !force) {
    const existing = job.lexofficeTransfers[accountId];
    const pName = existing.provider === "buchhaltungsbutler" ? "BuchhaltungsButler" : "Lexoffice";
    return res.json({
      success: false,
      alreadyTransferred: true,
      transferredInfo: existing,
      error: `Dokument wurde bereits am ${new Date(existing.transferredAt).toLocaleString("de-DE")} zu ${pName} (${accountName}) übertragen.`,
    });
  }

  try {
    let fileBuffer = await getJobPdfBuffer(job);
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "Datei ist nicht mehr auf dem Server oder Google Drive vorhanden." });
    }

    let fileName = (job.result && job.result.full ? job.result.full : job.originalName) || "Dokument.pdf";
    if (!fileName.toLowerCase().endsWith(".pdf")) fileName += ".pdf";

    const MAX_BYTES = 3.5 * 1024 * 1024;
    if (fileBuffer && fileBuffer.length > MAX_BYTES) {
      const tempIn = path.join(DOWNLOADS_DIR, `compress_in_${Date.now()}.pdf`);
      const tempOut = path.join(DOWNLOADS_DIR, `compress_out_${Date.now()}.pdf`);
      try {
        await fs.promises.writeFile(tempIn, fileBuffer);
        await new Promise((resolve, reject) => {
          execFile(
            getPythonPath(),
            [COMPRESS_SCRIPT, tempIn, tempOut],
            (error) => {
              if (error) reject(error);
              else resolve();
            }
          );
        });
        if (fs.existsSync(tempOut)) {
          fileBuffer = await fs.promises.readFile(tempOut);
        }
      } catch (compressErr) {
      } finally {
        if (fs.existsSync(tempIn)) fs.promises.unlink(tempIn).catch(() => {});
        if (fs.existsSync(tempOut)) fs.promises.unlink(tempOut).catch(() => {});
      }
    }

    if (provider === "buchhaltungsbutler") {
      const client = (creds.client || reqClient || appSettings.BUTTLER_KEY_THEWIRE_CLIENT || process.env.BUTTLER_KEY_THEWIRE_CLIENT || "").trim();
      const secret = (creds.secret || reqSecret || appSettings.BUTTLER_KEY_THEWIRE_SECRET || process.env.BUTTLER_KEY_THEWIRE_SECRET || "").trim();
      const key = (creds.key || reqKey || appSettings.BUTTLER_KEY_THEWIRE_KEY || process.env.BUTTLER_KEY_THEWIRE_KEY || "").trim();

      if (!client || !secret || !key) {
        return res.status(400).json({
          success: false,
          error: `BuchhaltungsButler Zugangsdaten für ${accountName} fehlen.`,
        });
      }

      const butlerRes = await butlerApi.uploadReceipt({
        fileBuffer,
        fileName,
        client,
        secret,
        key,
        type: "expense",
      });

      if (!butlerRes.success) {
        return res.status(500).json({
          success: false,
          error: butlerRes.error || "Fehler beim Upload zu BuchhaltungsButler.",
        });
      }

      if (!job.lexofficeTransfers) job.lexofficeTransfers = {};
      job.lexofficeTransfers[accountId] = {
        provider: "buchhaltungsbutler",
        transferredAt: butlerRes.transferredAt,
        fileId: butlerRes.fileId,
        lexofficeFileId: butlerRes.fileId,
        accountId,
        company: accountName,
      };
      job.targetCompany = accountId;
      saveJobs();

      return res.json({
        success: true,
        provider: "buchhaltungsbutler",
        providerName: "BuchhaltungsButler",
        fileId: butlerRes.fileId,
        lexofficeFileId: butlerRes.fileId,
        transferredAt: butlerRes.transferredAt,
        company: accountName,
        accountId,
      });
    } else {
      // Lexoffice
      const apiKey = (creds.apiKey || reqApiKey || appSettings[`LEXOFFICE_KEY_${String(accountId).toUpperCase()}`] || process.env[`LEXOFFICE_KEY_${String(accountId).toUpperCase()}`] || "").trim();

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: `Kein Lexoffice API-Key für ${accountName} angegeben.`,
        });
      }

      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
      const pre = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`
      );
      const post = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nvoucher\r\n--${boundary}--\r\n`);
      const bodyBuffer = Buffer.concat([pre, fileBuffer, post]);

      const lexRes = await fetchLexofficeWithRetry("https://api.lexoffice.io/v1/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          Accept: "application/json",
        },
        body: bodyBuffer,
      });

      if (!lexRes.ok) {
        const errText = await lexRes.text();
        return res.status(lexRes.status).json({
          success: false,
          error: `Lexoffice API Fehler (${lexRes.status}): ${errText}`,
        });
      }

      const lexData = await lexRes.json();
      if (!job.lexofficeTransfers) job.lexofficeTransfers = {};
      job.lexofficeTransfers[accountId] = {
        provider: "lexoffice",
        transferredAt: new Date().toISOString(),
        fileId: lexData.id,
        lexofficeFileId: lexData.id,
        accountId,
        company: accountName,
      };
      job.targetCompany = accountId;
      saveJobs();

      return res.json({
        success: true,
        provider: "lexoffice",
        providerName: "Lexoffice",
        fileId: lexData.id,
        lexofficeFileId: lexData.id,
        transferredAt: job.lexofficeTransfers[accountId].transferredAt,
        company: accountName,
        accountId,
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || "Fehler bei der Übertragung." });
  }
});

router.get("/api/accounting/voucher-preview", requireAdmin, async (req, res) => {
  try {
    const { companyKey, voucherId } = req.query;
    let apiKey = (req.query.apiKey || "").trim();

    if (!apiKey && companyKey) {
      const apiKeySettingName = `LEXOFFICE_KEY_${companyKey.toUpperCase()}`;
      apiKey = (appSettings[apiKeySettingName] || process.env[apiKeySettingName] || "").trim();
    }

    if (!voucherId || !apiKey) {
      return res.status(400).json({ success: false, error: "voucherId und apiKey erforderlich" });
    }

    let fileBuffer = null;
    let contentType = "";

    // Strategy 1: /v1/vouchers/{voucherId}
    try {
      const voucherRes = await fetch(`https://api.lexoffice.io/v1/vouchers/${voucherId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });

      if (voucherRes.ok) {
        const voucherJson = await voucherRes.json();
        let fileId = null;
        if (voucherJson.files && voucherJson.files.length > 0) {
          const firstFile = voucherJson.files[0];
          fileId = typeof firstFile === "string" ? firstFile : (firstFile.documentFileId || firstFile.id || firstFile.fileId);
        } else if (voucherJson.documentFileId) {
          fileId = voucherJson.documentFileId;
        }

        if (fileId) {
          const fileRes = await fetch(`https://api.lexoffice.io/v1/files/${fileId}`, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: "*/*" },
          });
          if (fileRes.ok) {
            contentType = fileRes.headers.get("content-type") || "";
            const arrayBuffer = await fileRes.arrayBuffer();
            fileBuffer = Buffer.from(arrayBuffer);
          }
        }
      }
    } catch (e) {}

    // Strategy 2: /v1/invoices/{voucherId}/document
    if (!fileBuffer) {
      try {
        const docRes = await fetch(`https://api.lexoffice.io/v1/invoices/${voucherId}/document`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        });
        if (docRes.ok) {
          const docJson = await docRes.json();
          if (docJson.documentFileId) {
            const fileRes = await fetch(`https://api.lexoffice.io/v1/files/${docJson.documentFileId}`, {
              headers: { Authorization: `Bearer ${apiKey}`, Accept: "*/*" },
            });
            if (fileRes.ok) {
              contentType = fileRes.headers.get("content-type") || "";
              const arrayBuffer = await fileRes.arrayBuffer();
              fileBuffer = Buffer.from(arrayBuffer);
            }
          }
        }
      } catch (e) {}
    }

    // Strategy 3: /v1/files/{voucherId} directly
    if (!fileBuffer) {
      try {
        const fileRes = await fetch(`https://api.lexoffice.io/v1/files/${voucherId}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "*/*" },
        });
        if (fileRes.ok) {
          contentType = fileRes.headers.get("content-type") || "";
          const arrayBuffer = await fileRes.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuffer);
        }
      } catch (e) {}
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(404).json({ success: false, error: "Beleg-Datei konnte aus Lexoffice nicht geladen werden" });
    }

    if (contentType.includes("image/jpeg") || contentType.includes("image/png") || contentType.includes("image/webp")) {
      res.setHeader("Content-Type", contentType);
      return res.send(fileBuffer);
    }

    // Render PDF page 1 to JPEG
    const tempDir = path.join(DOWNLOADS_DIR, "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempPdf = path.join(tempDir, `lex_${voucherId}_${Date.now()}.pdf`);
    const tempJpg = path.join(tempDir, `lex_${voucherId}_${Date.now()}.jpg`);

    await fs.promises.writeFile(tempPdf, fileBuffer);
    await renderPdfToJpeg(tempPdf, tempJpg);

    if (fs.existsSync(tempJpg)) {
      const jpgBuffer = await fs.promises.readFile(tempJpg);
      fs.promises.unlink(tempPdf).catch(() => {});
      fs.promises.unlink(tempJpg).catch(() => {});

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(jpgBuffer);
    } else {
      fs.promises.unlink(tempPdf).catch(() => {});
      return res.status(500).json({ success: false, error: "Rendering fehlgeschlagen" });
    }
  } catch (err) {
    console.error("[ACCOUNTING PREVIEW] Fehler:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
