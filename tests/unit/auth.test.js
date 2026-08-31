const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { verifyToken, checkIsAdmin } = require("../../src/middleware/auth");
const { JWT_SECRET } = require("../../src/config/secrets");

test("auth middleware - verifyToken and checkIsAdmin", async (t) => {
  await t.test("returns null when no auth_token cookie is present", () => {
    const req = { cookies: {} };
    assert.equal(verifyToken(req), null);
    assert.equal(checkIsAdmin(req), false);
  });

  await t.test("returns null when auth_token cookie is corrupted or invalid", () => {
    const req = { cookies: { auth_token: "invalid.jwt.token" } };
    assert.equal(verifyToken(req), null);
    assert.equal(checkIsAdmin(req), false);
  });

  await t.test("returns null when token is signed with a different secret", () => {
    const forgedToken = jwt.sign({ role: "admin" }, "different_secret_key_12345");
    const req = { cookies: { auth_token: forgedToken } };
    assert.equal(verifyToken(req), null);
    assert.equal(checkIsAdmin(req), false);
  });

  await t.test("correctly verifies a valid user token and confirms non-admin status", () => {
    const userToken = jwt.sign({ role: "user" }, JWT_SECRET, { expiresIn: "1h" });
    const req = { cookies: { auth_token: userToken } };
    const payload = verifyToken(req);

    assert.ok(payload);
    assert.equal(payload.role, "user");
    assert.equal(checkIsAdmin(req), false);
  });

  await t.test("correctly verifies a valid admin token and confirms admin status", () => {
    const adminToken = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "1h" });
    const req = { cookies: { auth_token: adminToken } };
    const payload = verifyToken(req);

    assert.ok(payload);
    assert.equal(payload.role, "admin");
    assert.equal(checkIsAdmin(req), true);
  });
});
