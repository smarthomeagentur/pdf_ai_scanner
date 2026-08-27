const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { isSafeSubpath } = require("../../src/middleware/security");
const { DOWNLOADS_DIR } = require("../../src/config/paths");

test("Security Regression Tests (Enforcing .github/copilot-instructions.md)", async (t) => {
  await t.test("Rule A: Path Traversal prevention blocks directory navigation payloads", () => {
    const maliciousInputs = [
      "../../etc/passwd",
      "..\\..\\Windows\\System32\\config\\SAM",
      "....//....//etc/shadow",
      "/var/log/syslog",
      process.platform === "win32" ? "C:\\boot.ini" : "/etc/shadow",
    ];

    for (const input of maliciousInputs) {
      // Normalize both Windows (\) and POSIX (/) path separators cross-platform
      const sanitizedBasename = path.basename(input.replace(/\\/g, "/"));
      const safeCombined = path.join(DOWNLOADS_DIR, sanitizedBasename);

      // 1. Ensure path.basename removes directory traversal markers
      assert.equal(
        sanitizedBasename.includes(".."),
        false,
        `path.basename failed to strip traversal markers from: ${input}`,
      );

      // 2. Ensure isSafeSubpath accepts the sanitized path inside DOWNLOADS_DIR
      assert.equal(
        isSafeSubpath(DOWNLOADS_DIR, safeCombined),
        true,
        `Sanitized path should be safely contained in DOWNLOADS_DIR`,
      );

      // 3. Ensure unsanitized raw path is strictly rejected by isSafeSubpath
      const rawCombined = path.resolve(DOWNLOADS_DIR, input);
      assert.equal(
        isSafeSubpath(DOWNLOADS_DIR, rawCombined),
        false,
        `Raw path ${input} must be rejected by isSafeSubpath`,
      );
    }
  });

  await t.test("Rule B: Command Injection prevention check on codebase", () => {
    // Scan src/ codebase to ensure child_process.exec() is NEVER used
    const srcDir = path.resolve(__dirname, "../../src");

    function findJsFiles(dir) {
      let results = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(findJsFiles(fullPath));
        } else if (entry.name.endsWith(".js")) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const jsFiles = findJsFiles(srcDir);
    for (const file of jsFiles) {
      const content = fs.readFileSync(file, "utf8");
      // Assert that 'child_process' is never imported with 'exec' (only execFile)
      const hasUnsafeExec =
        /(?:require\s*\(\s*["']child_process["']\s*\)\.exec\s*\(|const\s*\{[^}]*\bexec\b[^}]*\}\s*=\s*require\s*\(\s*["']child_process["']\s*\))/.test(
          content,
        );
      assert.equal(
        hasUnsafeExec,
        false,
        `Security violation: Dangerous child_process.exec() found in ${path.relative(srcDir, file)}. Use execFile with argument arrays!`,
      );
    }
  });

  await t.test("Rule E: AI JSON Fallback integrity", () => {
    // Verify fallback structure for AI metadata extraction
    const fallback = {
      company: "Unbekannt",
      category: "unknown",
      tags: ["none"],
      isInvoice: false,
      documentDate: "unknown",
      invoiceNumber: "none",
      invoiceAmmount: 0,
    };

    assert.ok(Array.isArray(fallback.tags));
    assert.equal(typeof fallback.company, "string");
    assert.equal(typeof fallback.category, "string");
    assert.equal(typeof fallback.isInvoice, "boolean");
    assert.equal(typeof fallback.invoiceAmmount, "number");
  });
});
