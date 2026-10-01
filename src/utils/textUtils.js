/**
 * Utility functions for text normalization and identifier generation.
 */

/**
 * Normalizes broken UTF-8 / Mojibake strings so German umlauts render correctly.
 * @param {string} str
 * @returns {string}
 */
function fixUmlauts(str) {
  if (!str || typeof str !== "string") return str || "";
  try {
    if (/[\u00C2-\u00C3][\u0080-\u00BF]/.test(str)) {
      return Buffer.from(str, "latin1").toString("utf8");
    }
  } catch (_e) {}
  return str;
}

/**
 * Generates a unique, collision-resistant job ID string based on timestamp and randomness.
 * @returns {string}
 */
function generateJobId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

module.exports = {
  fixUmlauts,
  generateJobId,
};
