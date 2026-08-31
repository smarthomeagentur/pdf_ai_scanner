const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../../src/server");
const { JWT_SECRET } = require("../../src/config/secrets");

function createTokenCookie(role = "user") {
  const token = jwt.sign({ role }, JWT_SECRET, { expiresIn: "1h" });
  return `auth_token=${token}`;
}

test("Integration - Settings Routes (/api/settings) & Zero-Trust Secrets", async (t) => {
  await t.test("GET /api/settings denies access without authentication", async () => {
    const res = await request(app).get("/api/settings");
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "Nur für Administratoren zugänglich.");
  });

  await t.test("GET /api/settings denies access for standard user role", async () => {
    const userCookie = createTokenCookie("user");
    const res = await request(app).get("/api/settings").set("Cookie", [userCookie]);

    assert.equal(res.status, 403);
    assert.equal(res.body.error, "Nur für Administratoren zugänglich.");
  });

  await t.test("GET /api/settings grants access to admin and NEVER leaks sensitive API keys", async () => {
    const adminCookie = createTokenCookie("admin");
    const res = await request(app).get("/api/settings").set("Cookie", [adminCookie]);

    assert.equal(res.status, 200);
    assert.ok(typeof res.body === "object");

    // Zero-Trust Verification: Ensure sensitive keys are stripped
    assert.equal(res.body.LEXOFFICE_KEY_WIREWIRE, undefined);
    assert.equal(res.body.LEXOFFICE_KEY_THEWIRE, undefined);
    assert.equal(res.body.LEXOFFICE_KEY_POLYXO, undefined);
    assert.equal(res.body.BUTTLER_KEY_THEWIRE_CLIENT, undefined);
    assert.equal(res.body.BUTTLER_KEY_THEWIRE_SECRET, undefined);
    assert.equal(res.body.BUTTLER_KEY_THEWIRE_KEY, undefined);
    assert.equal(res.body.CLICKUP_API_KEY, undefined);
    assert.equal(res.body.CLICKUP_LIST_ID, undefined);
  });
});
