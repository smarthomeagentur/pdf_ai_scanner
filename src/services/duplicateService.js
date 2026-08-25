/**
 * Utility to normalize strings for robust comparison.
 */
function normalizeAlphaNum(str) {
  if (!str) return "";
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Checks if a job has a matching duplicate in the existing jobs collection.
 */
function findDuplicatesForJob(job, allJobs = {}) {
  if (!job || job.duplicateDismissed) return [];
  const jobId = job.id;
  const sortedName = job.result || {};

  const normInvNum =
    sortedName.invoiceNumber &&
    sortedName.invoiceNumber !== "none" &&
    sortedName.invoiceNumber !== "-"
      ? normalizeAlphaNum(sortedName.invoiceNumber)
      : null;
  const normAmount = sortedName.invoiceAmmount || null;
  const normDate =
    sortedName.documentDate && sortedName.documentDate !== "unknown"
      ? sortedName.documentDate
      : null;
  const normFull = (sortedName.full || "").trim().toLowerCase();
  const normOrigName = (job.originalName || "").trim().toLowerCase();

  const duplicates = [];

  for (const otherId in allJobs) {
    if (otherId === jobId) continue;
    const j = allJobs[otherId];
    if (!j) continue;
    const oRes = j.result || {};

    const otherInvNum =
      oRes.invoiceNumber &&
      oRes.invoiceNumber !== "none" &&
      oRes.invoiceNumber !== "-"
        ? normalizeAlphaNum(oRes.invoiceNumber)
        : null;
    const otherAmount = oRes.invoiceAmmount || null;
    const otherDate =
      oRes.documentDate && oRes.documentDate !== "unknown"
        ? oRes.documentDate
        : null;
    const otherFull = (oRes.full || "").trim().toLowerCase();
    const otherOrig = (j.originalName || "").trim().toLowerCase();

    // 1. Exact match by invoice number + amount
    if (
      normInvNum &&
      otherInvNum &&
      normInvNum.length >= 4 &&
      normInvNum === otherInvNum
    ) {
      if (normAmount && otherAmount && normAmount === otherAmount) {
        duplicates.push({ job: j, reason: "Gleiche Rechnungsnummer & Betrag" });
        continue;
      }
      if (normDate && otherDate && normDate === otherDate) {
        duplicates.push({ job: j, reason: "Gleiche Rechnungsnummer & Datum" });
        continue;
      }
    }

    // 2. Exact match by generated name
    if (normFull && otherFull && normFull === otherFull && normFull.length > 10) {
      duplicates.push({ job: j, reason: "Identischer generierter Dateiname" });
      continue;
    }

    // 3. Exact match by original filename
    if (
      normOrigName &&
      otherOrig &&
      normOrigName === otherOrig &&
      normOrigName.length > 5
    ) {
      duplicates.push({ job: j, reason: "Identischer Original-Dateiname" });
      continue;
    }
  }

  return duplicates;
}

module.exports = {
  normalizeAlphaNum,
  findDuplicatesForJob,
};
