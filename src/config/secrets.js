const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { STORE_DIR } = require("./paths");

function getOrGenerateSecret(envVal, filename, generateFn, logMsg) {
  if (envVal && String(envVal).trim().length > 0) {
    return String(envVal).trim();
  }
  const filePath = path.join(STORE_DIR, filename);
  if (fs.existsSync(filePath)) {
    try {
      const saved = fs.readFileSync(filePath, "utf8").trim();
      if (saved.length > 0) return saved;
    } catch (e) {}
  }
  const generated = generateFn();
  try {
    fs.writeFileSync(filePath, generated, { encoding: "utf8", mode: 0o600 });
    if (logMsg) console.log(logMsg(generated));
  } catch (e) {}
  return generated;
}

const AUTH_ENABLED = process.env.AUTH_ENABLED !== "false";

const JWT_SECRET = getOrGenerateSecret(
  process.env.JWT_SECRET,
  ".jwt_secret",
  () => crypto.randomBytes(64).toString("hex")
);

const ADMIN_PASSWORD = getOrGenerateSecret(
  process.env.ADMIN_PASSWORD,
  ".admin_password",
  () => crypto.randomBytes(16).toString("hex"),
  (pwd) =>
    `[SECURITY] Kein ADMIN_PASSWORD in .env gesetzt. Ein sicheres Zufallspasswort wurde generiert und in store/.admin_password gespeichert: ${pwd}`
);

const APP_PASSWORD = getOrGenerateSecret(
  process.env.APP_PASSWORD,
  ".app_password",
  () => crypto.randomBytes(16).toString("hex"),
  (pwd) =>
    `[SECURITY] Kein APP_PASSWORD in .env gesetzt. Ein sicheres Zufallspasswort wurde generiert und in store/.app_password gespeichert: ${pwd}`
);

module.exports = {
  AUTH_ENABLED,
  JWT_SECRET,
  ADMIN_PASSWORD,
  APP_PASSWORD,
};
