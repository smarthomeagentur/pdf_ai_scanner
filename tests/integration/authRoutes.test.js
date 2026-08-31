const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../src/server");
const { APP_PASSWORD, ADMIN_PASSWORD } = require("../../src/config/secrets");

test("Integration - Auth Routes (/api/*)", async (t) => {
  await t.test("GET /api/config returns public authentication status", async () => {
    const res = await request(app).get("/api/config");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.authEnabled, "boolean");
    assert.equal(typeof res.body.hasAppPassword, "boolean");
    assert.equal(typeof res.body.hasAdminPassword, "boolean");
    assert.equal(res.body.isAdmin, false);
  });

  await t.test("POST /api/login rejects invalid passwords with 401", async () => {
    const res = await request(app).post("/api/login").send({ password: "wrong_password_attempt" });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, "Falsches Passwort.");
  });

  await t.test("POST /api/login succeeds with APP_PASSWORD and sets auth_token cookie", async () => {
    const res = await request(app).post("/api/login").send({ password: APP_PASSWORD });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.role, "user");

    const cookies = res.headers["set-cookie"];
    assert.ok(cookies, "Expected set-cookie header to be present");
    assert.ok(
      cookies.some((c) => c.startsWith("auth_token=")),
      "Expected auth_token cookie to be set",
    );
  });

  await t.test("POST /api/login promotes to admin role when ADMIN_PASSWORD is provided", async () => {
    const res = await request(app).post("/api/login").send({ password: ADMIN_PASSWORD });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.role, "admin");
  });

  await t.test("POST /api/admin-login succeeds with ADMIN_PASSWORD", async () => {
    const res = await request(app).post("/api/admin-login").send({ password: ADMIN_PASSWORD });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  });

  await t.test("POST /api/admin-login rejects standard user password with 401", async () => {
    const res = await request(app).post("/api/admin-login").send({ password: APP_PASSWORD });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  await t.test("POST /api/logout clears auth_token cookie", async () => {
    const res = await request(app).post("/api/logout");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);

    const cookies = res.headers["set-cookie"];
    assert.ok(cookies, "Expected set-cookie header on logout");
    assert.ok(
      cookies.some((c) => c.includes("auth_token=;")),
      "Expected auth_token to be cleared",
    );
  });
});
