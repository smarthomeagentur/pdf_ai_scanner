const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAlphaNum, findDuplicatesForJob } = require("../../src/services/duplicateService");
const { sampleJob1, sampleJobDuplicate } = require("../helpers/mockData");

test("duplicateService - normalizeAlphaNum", async (t) => {
  await t.test("normalizes string to lowercase alphanumeric characters", () => {
    assert.equal(normalizeAlphaNum("RE-2026/01.A"), "re202601a");
    assert.equal(normalizeAlphaNum("  123-ABC_xyz  "), "123abcxyz");
  });

  await t.test("returns empty string for null, undefined or empty input", () => {
    assert.equal(normalizeAlphaNum(null), "");
    assert.equal(normalizeAlphaNum(undefined), "");
    assert.equal(normalizeAlphaNum(""), "");
  });
});

test("duplicateService - findDuplicatesForJob", async (t) => {
  await t.test("ignores comparison against the same job ID", () => {
    const allJobs = { [sampleJob1.id]: sampleJob1 };
    const duplicates = findDuplicatesForJob(sampleJob1, allJobs);
    assert.equal(duplicates.length, 0);
  });

  await t.test("returns empty array if job has duplicateDismissed set to true", () => {
    const dismissedJob = { ...sampleJobDuplicate, duplicateDismissed: true };
    const allJobs = { [sampleJob1.id]: sampleJob1 };
    const duplicates = findDuplicatesForJob(dismissedJob, allJobs);
    assert.equal(duplicates.length, 0);
  });

  await t.test("identifies duplicate by matching invoiceNumber and invoiceAmmount", () => {
    const allJobs = { [sampleJob1.id]: sampleJob1 };
    const duplicates = findDuplicatesForJob(sampleJobDuplicate, allJobs);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].job.id, sampleJob1.id);
    assert.equal(duplicates[0].reason, "Gleiche Rechnungsnummer & Betrag");
  });

  await t.test("identifies duplicate by matching invoiceNumber and documentDate when amount differs", () => {
    const diffAmountJob = {
      ...sampleJobDuplicate,
      result: {
        ...sampleJobDuplicate.result,
        invoiceAmmount: 9999, // different amount
        full: "different generated filename 12345",
      },
      originalName: "completely_different_filename.pdf",
    };
    const allJobs = { [sampleJob1.id]: sampleJob1 };
    const duplicates = findDuplicatesForJob(diffAmountJob, allJobs);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].reason, "Gleiche Rechnungsnummer & Datum");
  });

  await t.test("identifies duplicate by identical generated full name", () => {
    const matchingFullNameJob = {
      id: "job-full-name-match",
      originalName: "unique_orig.pdf",
      result: {
        invoiceNumber: "none",
        invoiceAmmount: null,
        full: sampleJob1.result.full,
      },
    };
    const allJobs = { [sampleJob1.id]: sampleJob1 };
    const duplicates = findDuplicatesForJob(matchingFullNameJob, allJobs);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].reason, "Identischer generierter Dateiname");
  });

  await t.test("identifies duplicate by identical originalName when other fields are empty", () => {
    const matchingOrigNameJob = {
      id: "job-orig-match",
      originalName: sampleJob1.originalName,
      result: {
        invoiceNumber: "-",
        invoiceAmmount: null,
        documentDate: "unknown",
        full: "short",
      },
    };
    const allJobs = { [sampleJob1.id]: sampleJob1 };
    const duplicates = findDuplicatesForJob(matchingOrigNameJob, allJobs);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].reason, "Identischer Original-Dateiname");
  });
});
