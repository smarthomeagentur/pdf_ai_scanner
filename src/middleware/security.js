const path = require("path");

/**
 * Checks if a target path is safely contained inside baseDir (Path Traversal Protection).
 */
function isSafeSubpath(baseDir, targetPath) {
  if (!targetPath || typeof targetPath !== "string") return false;
  // Reject Windows drive-letter paths (e.g., C:\...) if running on non-Windows systems
  if (process.platform !== "win32" && /^[a-zA-Z]:[/\\]/.test(targetPath)) {
    return false;
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

module.exports = {
  isSafeSubpath,
};
