const fs = require("fs");
const path = require("path");
const butlerApi = require("./butlerService");
const { normalizeAlphaNum } = require("./duplicateService");

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

function matchLexofficeList(vouchers, { cleanInvNum, targetAmountEuro, cleanFileName, documentDate, cleanCompany }) {
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

    if (normSearchInv && normVoucherNum && (normSearchInv.includes(normVoucherNum) || normVoucherNum.includes(normSearchInv))) {
      matchReasons.push(`Rechnungsnummer stimmt überein (${v.voucherNumber})`);
    }

    if (targetAmountEuro !== null && vAmount > 0 && Math.abs(vAmount - targetAmountEuro) < 0.02) {
      matchReasons.push(`Betrag stimmt überein (${vAmount.toFixed(2).replace(".", ",")} €)`);
    }

    if (documentDate && documentDate !== "-" && documentDate !== "unknown") {
      const cleanDocDate = documentDate.replace(/[^0-9]/g, "");
      const cleanVDate = vDate.replace(/[^0-9]/g, "");
      if (vDate.startsWith(documentDate) || (cleanDocDate.length >= 6 && cleanVDate.includes(cleanDocDate))) {
        matchReasons.push(`Belegdatum stimmt überein (${documentDate})`);
      }
    }

    if (cleanCompany && vContact && (vContact.includes(cleanCompany) || cleanCompany.includes(vContact))) {
      matchReasons.push(`Lieferant / Kontakt stimmt überein (${v.contactName})`);
    }

    if (matchReasons.length > 0) {
      matches.push({
        id: v.id,
        voucherNumber: v.voucherNumber || "-",
        voucherDate: v.voucherDate || "-",
        totalAmount: vAmount,
        contactName: v.contactName || "-",
        voucherStatus: vStatus,
        matchReasons,
      });
    }
  }

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

module.exports = {
  fetchLexofficeWithRetry,
  searchLexofficeVouchers,
  matchLexofficeList,
  butlerApi,
};
