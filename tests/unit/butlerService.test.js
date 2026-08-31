const test = require("node:test");
const assert = require("node:assert/strict");
const butlerApi = require("../../src/services/butlerService");

test("butlerService - API Interface & Connection Verification", async (t) => {
  await t.test("exports both verifyConnection and testConnection as valid functions", () => {
    assert.equal(typeof butlerApi.verifyConnection, "function");
    assert.equal(typeof butlerApi.testConnection, "function");
    assert.equal(butlerApi.testConnection, butlerApi.verifyConnection);
  });

  await t.test("exports both searchReceipts and searchDocuments as valid functions", () => {
    assert.equal(typeof butlerApi.searchReceipts, "function");
    assert.equal(typeof butlerApi.searchDocuments, "function");
    assert.equal(butlerApi.searchDocuments, butlerApi.searchReceipts);
  });

  await t.test("returns error when credentials are incomplete", async () => {
    const res = await butlerApi.verifyConnection({ client: "", secret: "", key: "" });
    assert.equal(res.success, false);
    assert.equal(res.valid, false);
    assert.ok(res.error.includes("Unvollständige BuchhaltungsButler Zugangsdaten"));
  });

  await t.test("correctly parses successful connection response", async () => {
    // Mock global fetch for this subtest
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, receipts: [] }),
    });

    try {
      const res = await butlerApi.testConnection({
        client: "test_client",
        secret: "test_secret",
        key: "test_key",
      });
      assert.equal(res.success, true);
      assert.equal(res.valid, true);
      assert.equal(res.organizationName, "test_client");
      assert.equal(res.companyName, "test_client");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test("correctly maps error codes (error_code: 4 / Mandanten-Fehler)", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error_code: 4 }),
    });

    try {
      const res = await butlerApi.testConnection({
        client: "test_client",
        secret: "test_secret",
        key: "test_key",
      });
      assert.equal(res.success, false);
      assert.equal(res.valid, false);
      assert.ok(res.error.includes("Mandanten-Fehler (Code 4)"));
    } finally {
      global.fetch = originalFetch;
    }
  });
});
