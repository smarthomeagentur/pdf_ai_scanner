const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/server");
const { JWT_SECRET } = require("../../src/config/secrets");

function createTokenCookie(role = "admin") {
  const token = jwt.sign({ role }, JWT_SECRET, { expiresIn: "1h" });
  return `auth_token=${token}`;
}

test("Integration - Accounting Routes (/api/accounting/test-connection)", async (t) => {
  await t.test("POST /api/accounting/test-connection rejects unauthenticated requests with 403", async () => {
    const res = await request(app)
      .post("/api/accounting/test-connection")
      .send({ provider: "buchhaltungsbutler", credentials: {} });

    assert.equal(res.status, 403);
  });

  await t.test(
    "POST /api/accounting/test-connection returns error on missing BuchhaltungsButler credentials",
    async () => {
      const adminCookie = createTokenCookie("admin");
      const res = await request(app)
        .post("/api/accounting/test-connection")
        .set("Cookie", [adminCookie])
        .send({
          provider: "buchhaltungsbutler",
          credentials: { client: "", secret: "", key: "" },
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, false);
      assert.ok(res.body.error.includes("Client, Secret und Key sind erforderlich"));
    },
  );

  await t.test("POST /api/accounting/test-connection returns error on missing Lexoffice apiKey", async () => {
    const adminCookie = createTokenCookie("admin");
    const res = await request(app)
      .post("/api/accounting/test-connection")
      .set("Cookie", [adminCookie])
      .send({
        provider: "lexoffice",
        credentials: { apiKey: "" },
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes("API-Key ist erforderlich"));
  });

  await t.test(
    "POST /api/accounting/test-connection successfully tests BuchhaltungsButler connection (mocked)",
    async () => {
      const adminCookie = createTokenCookie("admin");

      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, receipts: [] }),
      });

      try {
        const res = await request(app)
          .post("/api/accounting/test-connection")
          .set("Cookie", [adminCookie])
          .send({
            provider: "buchhaltungsbutler",
            credentials: { client: "mock_tenant_client", secret: "test_secret", key: "test_key" },
          });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.companyName, "mock_tenant_client");
      } finally {
        global.fetch = originalFetch;
      }
    },
  );
});
