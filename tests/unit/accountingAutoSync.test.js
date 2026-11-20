const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../../src/config/secrets");
const {
  decodeAccountsHeader,
  extractAccountingAutoSync,
  storeConfig,
  takeConfig,
  hasConfig,
  discardConfig,
} = require("../../src/services/accountingCredentialStore");
const { matchAccountByCompanyName, transferDocumentToAccounting } = require("../../src/services/accountingService");

const SAMPLE_ACCOUNTS = [
  {
    id: "acc_1",
    name: "wirewire GmbH",
    provider: "lexoffice",
    credentials: { apiKey: "lex_wire_key" },
  },
  {
    id: "acc_2",
    name: "Polyxo Studios GmbH",
    provider: "lexoffice",
    credentials: { apiKey: "lex_poly_key" },
  },
  {
    id: "acc_1795181217140_mskrz",
    name: "The Wire UG",
    provider: "buchhaltungsbutler",
    credentials: { client: "the_wire_ug", secret: "sec", key: "k" },
  },
];

function makeAdminReq(headers = {}, body = {}) {
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
  return {
    cookies: { auth_token: token },
    headers,
    body,
  };
}

test("Unit - accountingCredentialStore", async (t) => {
  await t.test("decodeAccountsHeader decodes UTF-8 base64 account payloads", () => {
    const accountsWithUmlaut = [
      { id: "acc_ö", name: "Böber & Söhne GmbH", provider: "lexoffice", credentials: { apiKey: "k1" } },
    ];
    const encoded = Buffer.from(JSON.stringify(accountsWithUmlaut), "utf8").toString("base64");
    const decoded = decodeAccountsHeader(encoded);
    assert.equal(decoded.length, 1);
    assert.equal(decoded[0].name, "Böber & Söhne GmbH");
    assert.equal(decoded[0].credentials.apiKey, "k1");
  });

  await t.test("extractAccountingAutoSync rejects non-admin requests", () => {
    const encoded = Buffer.from(JSON.stringify(SAMPLE_ACCOUNTS), "utf8").toString("base64");
    const req = { cookies: {}, headers: { "x-accounting-accounts": encoded }, body: {} };
    assert.equal(extractAccountingAutoSync(req, [{ id: "job-1" }]), null);
  });

  await t.test("extractAccountingAutoSync maps per-file accountingTargets including explicit none", () => {
    const encoded = Buffer.from(JSON.stringify(SAMPLE_ACCOUNTS), "utf8").toString("base64");
    const req = makeAdminReq(
      { "x-accounting-accounts": encoded },
      { accountingTargets: JSON.stringify(["acc_1795181217140_mskrz", "none"]) },
    );
    const jobs = [{ id: "job-a" }, { id: "job-b" }];
    const map = extractAccountingAutoSync(req, jobs);

    assert.ok(map instanceof Map);
    storeConfig(map);

    assert.equal(hasConfig("job-a"), true);
    assert.equal(hasConfig("job-b"), false);

    const cfgA = takeConfig("job-a");
    assert.equal(cfgA.explicitAccountId, "acc_1795181217140_mskrz");
    assert.equal(cfgA.skipAutoSync, false);
    assert.equal(takeConfig("job-a"), null);

    const cfgB = takeConfig("job-b");
    assert.equal(cfgB.skipAutoSync, true);
    discardConfig("job-b");
  });
});

test("Unit - matchAccountByCompanyName", async (t) => {
  await t.test("matches exact and shortened company names unambiguously", () => {
    assert.equal(matchAccountByCompanyName("The Wire UG", SAMPLE_ACCOUNTS)?.id, "acc_1795181217140_mskrz");
    assert.equal(matchAccountByCompanyName("the wire", SAMPLE_ACCOUNTS)?.id, "acc_1795181217140_mskrz");
    assert.equal(matchAccountByCompanyName("thewire", SAMPLE_ACCOUNTS)?.id, "acc_1795181217140_mskrz");
    assert.equal(matchAccountByCompanyName("wirewire", SAMPLE_ACCOUNTS)?.id, "acc_1");
    assert.equal(matchAccountByCompanyName("Polyxo", SAMPLE_ACCOUNTS)?.id, "acc_2");
  });

  await t.test("returns null for private or unknown companies", () => {
    assert.equal(matchAccountByCompanyName("Daniel (Privat)", SAMPLE_ACCOUNTS), null);
    assert.equal(matchAccountByCompanyName("Unbekannt", SAMPLE_ACCOUNTS), null);
    assert.equal(matchAccountByCompanyName("", SAMPLE_ACCOUNTS), null);
  });
});

test("Unit - transferDocumentToAccounting (BuchhaltungsButler & Lexoffice)", async (t) => {
  await t.test("uploads PDF to BuchhaltungsButler with modular account id", async () => {
    const originalFetch = global.fetch;
    let capturedUrl = "";
    let capturedBody = null;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, id_by_customer: "bb_999" }),
      };
    };

    try {
      const job = { id: "job-bb-1", originalName: "Rechnung.pdf", result: { full: "261120 -Rechnungen- Test" } };
      const res = await transferDocumentToAccounting({
        job,
        account: SAMPLE_ACCOUNTS[2],
        fileBuffer: Buffer.from("%PDF-1.4 test"),
      });

      assert.equal(res.success, true);
      assert.equal(res.provider, "buchhaltungsbutler");
      assert.equal(res.accountId, "acc_1795181217140_mskrz");
      assert.equal(res.fileId, "bb_999");
      assert.ok(capturedUrl.includes("/receipts/upload"));
      assert.equal(capturedBody.api_key, "k");
      assert.equal(job.lexofficeTransfers["acc_1795181217140_mskrz"].fileId, "bb_999");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test("uploads PDF to Lexoffice with modular account id", async () => {
    const originalFetch = global.fetch;
    let capturedUrl = "";
    global.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "lex_file_123" }),
      };
    };

    try {
      const job = { id: "job-lex-1", originalName: "Rechnung.pdf", result: { full: "261120 -Rechnungen- Lex" } };
      const res = await transferDocumentToAccounting({
        job,
        account: SAMPLE_ACCOUNTS[0],
        fileBuffer: Buffer.from("%PDF-1.4 test"),
      });

      assert.equal(res.success, true);
      assert.equal(res.provider, "lexoffice");
      assert.equal(res.accountId, "acc_1");
      assert.equal(res.fileId, "lex_file_123");
      assert.equal(capturedUrl, "https://api.lexoffice.io/v1/files");
      assert.equal(job.lexofficeTransfers["acc_1"].fileId, "lex_file_123");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
