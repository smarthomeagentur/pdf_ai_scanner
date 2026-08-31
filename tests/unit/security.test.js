const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const { isSafeSubpath } = require("../../src/middleware/security");

test("security middleware - isSafeSubpath (Path Traversal Protection)", async (t) => {
  const baseDir = path.join(os.tmpdir(), "safe_test_storage");

  await t.test("allows legitimate files directly inside the base directory", () => {
    const validPath = path.join(baseDir, "document_123.pdf");
    assert.equal(isSafeSubpath(baseDir, validPath), true);
  });

  await t.test("allows files in nested subdirectories inside base directory", () => {
    const validNestedPath = path.join(baseDir, "subfolder", "nested_document.pdf");
    assert.equal(isSafeSubpath(baseDir, validNestedPath), true);
  });

  await t.test("rejects directory traversal attempts with ../", () => {
    const maliciousPath = path.join(baseDir, "..", "secret.json");
    assert.equal(isSafeSubpath(baseDir, maliciousPath), false);

    const deepMaliciousPath = path.join(baseDir, "subfolder", "..", "..", "etc", "passwd");
    assert.equal(isSafeSubpath(baseDir, deepMaliciousPath), false);
  });

  await t.test("rejects absolute paths outside the base directory", () => {
    const rootPath = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
    assert.equal(isSafeSubpath(baseDir, rootPath), false);
  });

  await t.test("rejects null, undefined, empty string, or non-string inputs", () => {
    assert.equal(isSafeSubpath(baseDir, null), false);
    assert.equal(isSafeSubpath(baseDir, undefined), false);
    assert.equal(isSafeSubpath(baseDir, ""), false);
    assert.equal(isSafeSubpath(baseDir, 12345), false);
    assert.equal(isSafeSubpath(baseDir, {}), false);
  });
});
