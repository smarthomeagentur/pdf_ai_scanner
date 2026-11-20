const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const butlerApi = require("./butlerService");
const { normalizeAlphaNum } = require("./duplicateService");
const { DOWNLOADS_DIR, getPythonPath, COMPRESS_SCRIPT } = require("../config/paths");
const { appSettings } = require("../config/settings");

async function fetchLexofficeWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      console.warn(`[LEXOFFICE] Rate limit (429) erreicht. Warte ${500 * (i + 1)}ms...`);
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      continue;
    }
    return res;
  }
  return fetch(url, options);
}

function matchLexofficeList(vouchers, { cleanInvNum, targetAmountEuro, _cleanFileName, documentDate, cleanCompany }) {
  const matches = [];
  const normSearchInv = cleanInvNum ? normalizeAlphaNum(cleanInvNum) : null;

  for (const v of vouchers) {
    const matchReasons = [];
    const vNum = v.voucherNumber || "";
    const normVoucherNum = normalizeAlphaNum(vNum);
    const vDate = v.voucherDate || "";
    const vAmount = parseFloat(v.totalAmount || "0");
    const vContact = (v.contactName || "").toLowerCase();
    const vStatus = v.voucherStatus || "offen";

    let hasInvMatch = false;
    let hasAmountMatch = false;
    let hasDateMatch = false;
    let hasCompanyMatch = false;

    if (normSearchInv && normVoucherNum && (normSearchInv.includes(normVoucherNum) || normVoucherNum.includes(normSearchInv))) {
      matchReasons.push(`Rechnungsnummer stimmt überein (${v.voucherNumber})`);
      hasInvMatch = true;
    }

    if (targetAmountEuro !== null && vAmount > 0 && Math.abs(vAmount - targetAmountEuro) < 0.02) {
      matchReasons.push(`Betrag stimmt überein (${vAmount.toFixed(2).replace(".", ",")} €)`);
      hasAmountMatch = true;
    }

    if (documentDate && documentDate !== "-" && documentDate !== "unknown") {
      const cleanDocDate = documentDate.replace(/[^0-9]/g, "");
      const cleanVDate = vDate.replace(/[^0-9]/g, "");
      if (vDate.startsWith(documentDate) || (cleanDocDate.length >= 6 && cleanVDate.includes(cleanDocDate))) {
        matchReasons.push(`Belegdatum stimmt überein (${documentDate})`);
        hasDateMatch = true;
      }
    }

    if (cleanCompany && vContact && (vContact.includes(cleanCompany) || cleanCompany.includes(vContact))) {
      matchReasons.push(`Lieferant / Kontakt stimmt überein (${v.contactName})`);
      hasCompanyMatch = true;
    }

    // High confidence criteria for duplicate detection:
    // 1. Matching Invoice Number (direct match)
    // 2. Matching Amount AND (Matching Date OR Matching Company/Partner)
    // A standalone company name or date match without matching amount/invoice number is NOT a duplicate.
    const isConfidentMatch = hasInvMatch || (hasAmountMatch && (hasDateMatch || hasCompanyMatch));

    if (isConfidentMatch && matchReasons.length > 0) {
      const score = (hasInvMatch ? 4 : 0) + (hasAmountMatch ? 3 : 0) + (hasDateMatch ? 2 : 0) + (hasCompanyMatch ? 1 : 0);
      matches.push({
        id: v.id,
        voucherNumber: v.voucherNumber || "-",
        voucherDate: v.voucherDate || "-",
        totalAmount: vAmount,
        contactName: v.contactName || "-",
        voucherStatus: vStatus,
        matchReasons,
        score,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return { found: matches.length > 0, matches };
}

async function searchLexofficeVouchers(apiKey, { invoiceNumber, fileName, amountInCents, documentDate, company }) {
  if (!apiKey) return { found: false, matches: [] };

  try {
    const cleanInvNum = invoiceNumber && invoiceNumber !== "none" && invoiceNumber !== "-" ? invoiceNumber.trim() : null;
    const targetAmountEuro = amountInCents !== undefined && amountInCents !== null ? amountInCents / 100 : null;
    const cleanFileName = fileName ? fileName.trim().toLowerCase() : null;
    const cleanCompany = company && company !== "-" ? company.trim().toLowerCase() : null;

    const allVouchers = [];
    const seenVoucherIds = new Set();
    const voucherStatuses = "draft,open,paid,paidoff,voided,transferred,sepadebit";
    const voucherTypes = "purchaseinvoice,purchasecreditnote,salesinvoice,salescreditnote,invoice,downpaymentinvoice,creditnote";

    if (cleanInvNum) {
      try {
        const directUrl = `https://api.lexoffice.io/v1/voucherlist?voucherNumber=${encodeURIComponent(cleanInvNum)}&voucherStatus=${voucherStatuses}&voucherType=${voucherTypes}&page=0&size=100`;
        const directRes = await fetchLexofficeWithRetry(directUrl, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (directRes.ok) {
          const directData = await directRes.json();
          (directData.content || []).forEach((v) => {
            if (v && v.id && !seenVoucherIds.has(v.id)) {
              seenVoucherIds.add(v.id);
              allVouchers.push(v);
            }
          });
        }
      } catch (e) {}
    }

    try {
      const generalUrl = `https://api.lexoffice.io/v1/voucherlist?voucherStatus=${voucherStatuses}&voucherType=${voucherTypes}&page=0&size=250`;
      const genRes = await fetchLexofficeWithRetry(generalUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (genRes.ok) {
        const genData = await genRes.json();
        (genData.content || []).forEach((v) => {
          if (v && v.id && !seenVoucherIds.has(v.id)) {
            seenVoucherIds.add(v.id);
            allVouchers.push(v);
          }
        });
      }
    } catch (e) {}

    return matchLexofficeList(allVouchers, { cleanInvNum, targetAmountEuro, cleanFileName, documentDate, cleanCompany });
  } catch (err) {
    console.error("[LEXOFFICE SEARCH] Fehler:", err);
    return { found: false, matches: [], error: err.message };
  }
}

function normalizeCompanyCore(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/\((.*?)\)/g, " ")
    .replace(/\b(gmbh|ug|haftungsbeschränkt|haftungsbeschraenkt|ag|gbr|kg|ohg|co|ek|e\.k\.|inc|ltd|llc|studios)\b/g, " ")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim();
}

function matchAccountByCompanyName(companyName, accounts = []) {
  if (!companyName || !Array.isArray(accounts) || accounts.length === 0) return null;
  const rawLower = String(companyName).toLowerCase().trim();
  if (!rawLower || rawLower === "-" || rawLower === "unbekannt" || rawLower === "unknown" || rawLower.includes("privat")) {
    return null;
  }

  const targetCore = normalizeCompanyCore(rawLower);
  const targetCompact = targetCore.replace(/\s+/g, "");
  if (targetCompact.length < 3) return null;

  // 1. Exact match on full lowercased name, id, or normalized core
  for (const acc of accounts) {
    const accNameLower = String(acc.name || "").toLowerCase().trim();
    const accIdLower = String(acc.id || "").toLowerCase().trim();
    const accCore = normalizeCompanyCore(accNameLower);
    const accCompact = accCore.replace(/\s+/g, "");
    if (
      accNameLower === rawLower ||
      accIdLower === rawLower ||
      (accCore && accCore === targetCore) ||
      (accCompact && accCompact === targetCompact)
    ) {
      return acc;
    }
  }

  // 2. Unambiguous substring match
  const partialMatches = accounts.filter((acc) => {
    const accCore = normalizeCompanyCore(acc.name || "");
    const accCompact = accCore.replace(/\s+/g, "");
    const accIdCompact = String(acc.id || "").toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
    if (accCompact.length >= 3 && (targetCompact.includes(accCompact) || accCompact.includes(targetCompact))) {
      return true;
    }
    if (accIdCompact.length >= 3 && !accIdCompact.startsWith("acc") && (targetCompact.includes(accIdCompact) || accIdCompact.includes(targetCompact))) {
      return true;
    }
    return false;
  });

  return partialMatches.length === 1 ? partialMatches[0] : null;
}

async function compressPdfBufferIfNeeded(fileBuffer) {
  const MAX_BYTES = 3.5 * 1024 * 1024;
  if (!fileBuffer || fileBuffer.length <= MAX_BYTES) return fileBuffer;

  const tempIn = path.join(DOWNLOADS_DIR, `compress_in_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.pdf`);
  const tempOut = path.join(DOWNLOADS_DIR, `compress_out_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.pdf`);
  try {
    await fs.promises.writeFile(tempIn, fileBuffer);
    await new Promise((resolve, reject) => {
      execFile(
        getPythonPath(),
        [COMPRESS_SCRIPT, tempIn, tempOut],
        { timeout: 45000, killSignal: "SIGKILL" },
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });
    if (fs.existsSync(tempOut)) {
      return await fs.promises.readFile(tempOut);
    }
  } catch (compressErr) {
    console.warn("[ACCOUNTING] PDF-Komprimierung fehlgeschlagen, nutze Original:", compressErr.message);
  } finally {
    if (fs.existsSync(tempIn)) fs.promises.unlink(tempIn).catch(() => {});
    if (fs.existsSync(tempOut)) fs.promises.unlink(tempOut).catch(() => {});
  }
  return fileBuffer;
}

async function checkAccountForDuplicate({ job, account }) {
  const accountId = account.id || account.companyKey || "unknown";
  const provider = account.provider || (accountId === "thewire" ? "buchhaltungsbutler" : "lexoffice");
  const creds = account.credentials || {};
  const invNum = job.result?.invoiceNumber && job.result?.invoiceNumber !== "none" ? job.result.invoiceNumber : "";
  const fName = job.result?.full || job.originalName || "";
  const amountCents = job.result?.invoiceAmmount !== undefined ? job.result.invoiceAmmount : job.invoiceAmmount;
  const docDate = job.result?.documentDate || "";
  const compName = job.result?.company || "";

  if (provider === "buchhaltungsbutler") {
    const client = (creds.client || creds.thewireClient || appSettings.BUTTLER_KEY_THEWIRE_CLIENT || process.env.BUTTLER_KEY_THEWIRE_CLIENT || "").trim();
    const secret = (creds.secret || creds.thewireSecret || appSettings.BUTTLER_KEY_THEWIRE_SECRET || process.env.BUTTLER_KEY_THEWIRE_SECRET || "").trim();
    const key = (creds.key || creds.thewireKey || appSettings.BUTTLER_KEY_THEWIRE_KEY || process.env.BUTTLER_KEY_THEWIRE_KEY || "").trim();
    if (!client || !secret || !key) return { found: false, matches: [] };
    return await (butlerApi.searchDocuments || butlerApi.searchReceipts)({
      client,
      secret,
      key,
      invoiceNumber: invNum,
      fileName: fName,
      amountInCents: amountCents,
      documentDate: docDate,
      company: compName,
    });
  }

  const apiKey = (
    creds.apiKey ||
    creds.wirewireApiKey ||
    creds.polyxoApiKey ||
    appSettings[`LEXOFFICE_KEY_${String(accountId).toUpperCase()}`] ||
    process.env[`LEXOFFICE_KEY_${String(accountId).toUpperCase()}`] ||
    ""
  ).trim();
  if (!apiKey) return { found: false, matches: [] };
  return await searchLexofficeVouchers(apiKey, {
    invoiceNumber: invNum,
    fileName: fName,
    amountInCents: amountCents,
    documentDate: docDate,
    company: compName,
  });
}

async function transferDocumentToAccounting({ job, account, fileBuffer }) {
  const accountId = account.id || account.companyKey || "unknown";
  const accountName = account.name || accountId;
  const provider = account.provider || (accountId === "thewire" ? "buchhaltungsbutler" : "lexoffice");
  const creds = account.credentials || {};

  if (!fileBuffer || fileBuffer.length === 0) {
    return { success: false, statusCode: 400, error: "Datei ist nicht mehr auf dem Server oder Google Drive vorhanden." };
  }

  let fileName = (job.result && job.result.full ? job.result.full : job.originalName) || "Dokument.pdf";
  if (!fileName.toLowerCase().endsWith(".pdf")) fileName += ".pdf";

  const preparedBuffer = await compressPdfBufferIfNeeded(fileBuffer);

  if (provider === "buchhaltungsbutler") {
    const client = (creds.client || appSettings.BUTTLER_KEY_THEWIRE_CLIENT || process.env.BUTTLER_KEY_THEWIRE_CLIENT || "").trim();
    const secret = (creds.secret || appSettings.BUTTLER_KEY_THEWIRE_SECRET || process.env.BUTTLER_KEY_THEWIRE_SECRET || "").trim();
    const key = (creds.key || appSettings.BUTTLER_KEY_THEWIRE_KEY || process.env.BUTTLER_KEY_THEWIRE_KEY || "").trim();

    if (!client || !secret || !key) {
      return {
        success: false,
        statusCode: 400,
        error: `BuchhaltungsButler Zugangsdaten für ${accountName} fehlen.`,
      };
    }

    const butlerRes = await butlerApi.uploadReceipt({
      fileBuffer: preparedBuffer,
      fileName,
      client,
      secret,
      key,
      type: "expense",
    });

    if (!butlerRes.success) {
      return {
        success: false,
        statusCode: 500,
        error: butlerRes.error || "Fehler beim Upload zu BuchhaltungsButler.",
      };
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

    return {
      success: true,
      provider: "buchhaltungsbutler",
      providerName: "BuchhaltungsButler",
      fileId: butlerRes.fileId,
      lexofficeFileId: butlerRes.fileId,
      transferredAt: butlerRes.transferredAt,
      company: accountName,
      accountId,
    };
  }

  // Lexoffice
  const apiKey = (
    creds.apiKey ||
    appSettings[`LEXOFFICE_KEY_${String(accountId).toUpperCase()}`] ||
    process.env[`LEXOFFICE_KEY_${String(accountId).toUpperCase()}`] ||
    ""
  ).trim();

  if (!apiKey) {
    return {
      success: false,
      statusCode: 400,
      error: `Kein Lexoffice API-Key für ${accountName} angegeben.`,
    };
  }

  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`
  );
  const post = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\nvoucher\r\n--${boundary}--\r\n`);
  const bodyBuffer = Buffer.concat([pre, preparedBuffer, post]);

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
    return {
      success: false,
      statusCode: lexRes.status,
      error: `Lexoffice API Fehler (${lexRes.status}): ${errText}`,
    };
  }

  const lexData = await lexRes.json();
  const transferredAt = new Date().toISOString();
  if (!job.lexofficeTransfers) job.lexofficeTransfers = {};
  job.lexofficeTransfers[accountId] = {
    provider: "lexoffice",
    transferredAt,
    fileId: lexData.id,
    lexofficeFileId: lexData.id,
    accountId,
    company: accountName,
  };
  job.targetCompany = accountId;

  return {
    success: true,
    provider: "lexoffice",
    providerName: "Lexoffice",
    fileId: lexData.id,
    lexofficeFileId: lexData.id,
    transferredAt,
    company: accountName,
    accountId,
  };
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBoundaryRegex(phrase) {
  const parts = String(phrase)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegex);
  if (parts.length === 0) return null;
  return new RegExp(`(?<![a-z0-9äöüß])${parts.join("\\s+")}(?![a-z0-9äöüß])`, "i");
}

const SHIPPING_LABEL_RE = /(lieferanschrift|lieferadresse|versandadresse|warenempfänger|shipping\s*address|delivery\s*address|ship\s*to)\s*:?/gi;
const BILLING_LABEL_RE = /(rechnungsanschrift|rechnungsadresse|rechnungsempfänger|billing\s*address|invoice\s*to|bill\s*to)\s*:?/gi;

function isInsideSectionAfterLabel(text, matchIndex, labelRegex, windowChars = 220) {
  if (matchIndex < 0) return false;
  const lookbackStart = Math.max(0, matchIndex - windowChars);
  const before = text.slice(lookbackStart, matchIndex);
  labelRegex.lastIndex = 0;
  let lastLabelEnd = -1;
  let m;
  while ((m = labelRegex.exec(before)) !== null) {
    lastLabelEnd = m.index + m[0].length;
  }
  return lastLabelEnd >= 0;
}

/**
 * Fast, word-boundary-aware company detection from extracted PDF text.
 * Never splits multi-word names into ambiguous single words (e.g. "The Wire" never matches "wirewire").
 * Distinguishes billing address from shipping address ("Lieferanschrift").
 */
function detectAccountFromText(text, accounts = []) {
  if (!text || typeof text !== "string" || !Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }

  const normalizedText = text.replace(/\r\n/g, "\n");
  const headerSlice = normalizedText.slice(0, 2200);

  let best = null;
  let secondBestScore = 0;

  for (const acc of accounts) {
    if (!acc || !acc.id || !acc.name) continue;
    const fullName = String(acc.name).trim();
    const core = normalizeCompanyCore(fullName);
    const compact = core.replace(/\s+/g, "");
    if (compact.length < 3) continue;

    let score = 0;
    let matchedText = "";
    let firstMatchIdx = -1;

    const fullRe = buildBoundaryRegex(fullName);
    if (fullRe) {
      const mHeader = headerSlice.match(fullRe);
      if (mHeader) {
        score += 40;
        matchedText = matchedText || mHeader[0];
        firstMatchIdx = mHeader.index;
      } else {
        const mBody = normalizedText.match(fullRe);
        if (mBody) {
          score += 25;
          matchedText = matchedText || mBody[0];
          firstMatchIdx = mBody.index;
        }
      }
    }

    const coreRe = buildBoundaryRegex(core);
    if (coreRe) {
      const mHeader = headerSlice.match(coreRe);
      if (mHeader) {
        score += 25;
        matchedText = matchedText || mHeader[0];
        if (firstMatchIdx === -1) firstMatchIdx = mHeader.index;
      } else {
        const mBody = normalizedText.match(coreRe);
        if (mBody) {
          score += 15;
          matchedText = matchedText || mBody[0];
          if (firstMatchIdx === -1) firstMatchIdx = mBody.index;
        }
      }
    }

    if (compact !== core) {
      const compactRe = buildBoundaryRegex(compact);
      if (compactRe) {
        const mHeader = headerSlice.match(compactRe);
        if (mHeader) {
          score += 15;
          matchedText = matchedText || mHeader[0];
          if (firstMatchIdx === -1) firstMatchIdx = mHeader.index;
        } else {
          const mBody = normalizedText.match(compactRe);
          if (mBody) {
            score += 10;
            matchedText = matchedText || mBody[0];
            if (firstMatchIdx === -1) firstMatchIdx = mBody.index;
          }
        }
      }
    }

    if (score > 0 && firstMatchIdx >= 0) {
      // Penalize matches that appear right under a shipping address ("Lieferanschrift:")
      // and boost matches under an explicit billing address ("Rechnungsadresse:")
      if (isInsideSectionAfterLabel(normalizedText, firstMatchIdx, SHIPPING_LABEL_RE, 180)) {
        score -= 35;
      } else if (isInsideSectionAfterLabel(normalizedText, firstMatchIdx, BILLING_LABEL_RE, 180)) {
        score += 20;
      }
    }

    if (score > 0) {
      if (!best || score > best.score) {
        if (best) secondBestScore = Math.max(secondBestScore, best.score);
        best = { account: acc, score, matchedText: matchedText || fullName };
      } else {
        secondBestScore = Math.max(secondBestScore, score);
      }
    }
  }

  if (best && best.score > secondBestScore) {
    return {
      accountId: best.account.id,
      accountName: best.account.name,
      matchedText: best.matchedText,
      score: best.score,
    };
  }
  return null;
}

module.exports = {
  fetchLexofficeWithRetry,
  searchLexofficeVouchers,
  matchLexofficeList,
  matchAccountByCompanyName,
  detectAccountFromText,
  compressPdfBufferIfNeeded,
  checkAccountForDuplicate,
  transferDocumentToAccounting,
  butlerApi,
};
