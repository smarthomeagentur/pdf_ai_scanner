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

async function checkSingleAccountingCompany(job, compKey, credentials = {}) {
  const provider = compKey === "thewire" ? "buchhaltungsbutler" : "lexoffice";
  const providerName = compKey === "thewire" ? "BuchhaltungsButler" : "Lexoffice";
  const companyDisplayName =
    compKey === "wirewire" ? "wirewire GmbH" : compKey === "thewire" ? "The Wire UG" : "Polyxo Studios GmbH";

  let apiValid = false;
  let apiError = null;
  let organizationName = null;
  let liveSearch = { performed: false, found: false, matches: [] };

  if (provider === "buchhaltungsbutler") {
    const client = (credentials.thewireClient || credentials.client || appSettings.BUTTLER_KEY_THEWIRE_CLIENT || process.env.BUTTLER_KEY_THEWIRE_CLIENT || "").trim();
    const secret = (credentials.thewireSecret || credentials.secret || appSettings.BUTTLER_KEY_THEWIRE_SECRET || process.env.BUTTLER_KEY_THEWIRE_SECRET || "").trim();
    const key = (credentials.thewireKey || credentials.key || appSettings.BUTTLER_KEY_THEWIRE_KEY || process.env.BUTTLER_KEY_THEWIRE_KEY || "").trim();

    if (client && secret && key) {
      try {
        const testRes = await butlerApi.testConnection({ client, secret, key });
        if (testRes.success) {
          apiValid = true;
          organizationName = testRes.companyName || "The Wire UG";
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
      apiError = "Keine Zugangsdaten für BuchhaltungsButler (The Wire) hinterlegt.";
    }
  } else {
    // Lexoffice
    const keyProp = compKey === "wirewire" ? "wirewireApiKey" : "polyxoApiKey";
    const apiKeySettingName = `LEXOFFICE_KEY_${compKey.toUpperCase()}`;
    const apiKey = (credentials[keyProp] || credentials.apiKey || appSettings[apiKeySettingName] || process.env[apiKeySettingName] || "").trim();

    if (apiKey) {
      try {
        const apiRes = await fetchLexofficeWithRetry("https://api.lexoffice.io/v1/profile", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (apiRes.ok) {
          apiValid = true;
          const profile = await apiRes.json();
          organizationName = profile.organizationName || companyDisplayName;
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
      apiError = `Kein API-Key für Lexoffice (${compKey}) hinterlegt.`;
    }
  }

  const alreadyTransferred = !!(job.lexofficeTransfers && job.lexofficeTransfers[compKey]);
  const transferredInfo = alreadyTransferred ? job.lexofficeTransfers[compKey] : null;
  const hasLiveMatch = !!(liveSearch.found && Array.isArray(liveSearch.matches) && liveSearch.matches.length > 0);

  return {
    companyKey: compKey,
    companyDisplayName,
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

router.post(["/api/accounting/check", "/api/lexoffice/check"], requireAdmin, async (req, res) => {
  const { jobId, companyKey, credentials = {} } = req.body;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden" });

  const validCompanies = ["wirewire", "thewire", "polyxo"];
  let suggestedCompany = job.targetCompany;
  if (!suggestedCompany && job.result && job.result.company) {
    const c = job.result.company.toLowerCase();
    if (c.includes("wirewire")) suggestedCompany = "wirewire";
    else if (c.includes("the wire") || c.includes("thewire")) suggestedCompany = "thewire";
    else if (c.includes("polyxo")) suggestedCompany = "polyxo";
  }
  if (!suggestedCompany || !validCompanies.includes(suggestedCompany)) {
    suggestedCompany = "wirewire";
  }

  const targetComp = companyKey && validCompanies.includes(companyKey) ? companyKey : suggestedCompany;
  const allCompanyChecksArray = await Promise.all(
    validCompanies.map((c) => checkSingleAccountingCompany(job, c, credentials))
  );

  const allCompanyChecks = {};
  allCompanyChecksArray.forEach((cRes) => {
    allCompanyChecks[cRes.companyKey] = cRes;
  });

  const selectedData = allCompanyChecks[targetComp] || allCompanyChecks["wirewire"];

  res.json({
    success: true,
    jobId: job.id,
    provider: selectedData.provider,
    providerName: selectedData.providerName,
    selectedCompany: targetComp,
    suggestedCompany,
    apiValid: selectedData.apiValid,
    apiError: selectedData.apiError,
    organizationName: selectedData.organizationName,
    alreadyTransferred: selectedData.alreadyTransferred,
    transferredInfo: selectedData.transferredInfo,
    liveSearch: selectedData.liveSearch,
    allCompanyChecks,
    allTransfers: job.lexofficeTransfers || {},
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
  const { jobId, companyKey, fileId } = req.body;
  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden" });

  if (!job.lexofficeTransfers) job.lexofficeTransfers = {};
  const provider = companyKey === "thewire" ? "buchhaltungsbutler" : "lexoffice";
  job.lexofficeTransfers[companyKey] = {
    provider,
    fileId: fileId || `manual_${Date.now()}`,
    transferredAt: new Date().toISOString(),
    manuallyMatched: true,
  };
  saveJobs();
  res.json({ success: true, allTransfers: job.lexofficeTransfers });
});

router.post(["/api/accounting/transfer", "/api/lexoffice/transfer"], requireAdmin, async (req, res) => {
  const { jobId, companyKey, force, apiKey: reqApiKey, client: reqClient, secret: reqSecret, key: reqKey, credentials = {} } = req.body;
  const validCompanies = ["wirewire", "thewire", "polyxo"];
  if (!validCompanies.includes(companyKey)) {
    return res.status(400).json({ success: false, error: "Ungültige Zielfirma." });
  }

  const job = getJob(jobId);
  if (!job) return res.status(404).json({ success: false, error: "Dokument nicht gefunden." });

  if (job.lexofficeTransfers && job.lexofficeTransfers[companyKey] && !force) {
    const existing = job.lexofficeTransfers[companyKey];
    const pName = existing.provider === "buchhaltungsbutler" ? "BuchhaltungsButler" : "Lexoffice";
    return res.json({
      success: false,
      alreadyTransferred: true,
      transferredInfo: existing,
      error: `Dokument wurde bereits am ${new Date(existing.transferredAt).toLocaleString("de-DE")} zu ${pName} (${companyKey}) übertragen.`,
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

    if (companyKey === "thewire") {
      const client = (reqClient || credentials.thewireClient || credentials.client || appSettings.BUTTLER_KEY_THEWIRE_CLIENT || process.env.BUTTLER_KEY_THEWIRE_CLIENT || "").trim();
      const secret = (reqSecret || credentials.thewireSecret || credentials.secret || appSettings.BUTTLER_KEY_THEWIRE_SECRET || process.env.BUTTLER_KEY_THEWIRE_SECRET || "").trim();
      const key = (reqKey || credentials.thewireKey || credentials.key || appSettings.BUTTLER_KEY_THEWIRE_KEY || process.env.BUTTLER_KEY_THEWIRE_KEY || "").trim();

      if (!client || !secret || !key) {
        return res.status(400).json({
          success: false,
          error: "BuchhaltungsButler Zugangsdaten für The Wire fehlen.",
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
      job.lexofficeTransfers[companyKey] = {
        provider: "buchhaltungsbutler",
        transferredAt: butlerRes.transferredAt,
        fileId: butlerRes.fileId,
        lexofficeFileId: butlerRes.fileId,
        company: companyKey,
      };
      job.targetCompany = companyKey;
      saveJobs();

      return res.json({
        success: true,
        provider: "buchhaltungsbutler",
        providerName: "BuchhaltungsButler",
        fileId: butlerRes.fileId,
        lexofficeFileId: butlerRes.fileId,
        transferredAt: butlerRes.transferredAt,
        company: companyKey,
      });
    } else {
      const keyProp = companyKey === "wirewire" ? "wirewireApiKey" : "polyxoApiKey";
      const apiKeySettingName = `LEXOFFICE_KEY_${companyKey.toUpperCase()}`;
      const apiKey = (reqApiKey || credentials[keyProp] || credentials.apiKey || appSettings[apiKeySettingName] || process.env[apiKeySettingName] || "").trim();

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          error: `Kein Lexoffice API-Key für ${companyKey} angegeben.`,
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
      job.lexofficeTransfers[companyKey] = {
        provider: "lexoffice",
        transferredAt: new Date().toISOString(),
        fileId: lexData.id,
        lexofficeFileId: lexData.id,
        company: companyKey,
      };
      job.targetCompany = companyKey;
      saveJobs();

      return res.json({
        success: true,
        provider: "lexoffice",
        providerName: "Lexoffice",
        fileId: lexData.id,
        lexofficeFileId: lexData.id,
        transferredAt: job.lexofficeTransfers[companyKey].transferredAt,
        company: companyKey,
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || "Fehler bei der Übertragung." });
  }
});

router.get("/api/accounting/voucher-preview", async (req, res) => {
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
