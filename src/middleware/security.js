const path = require("path");

/**
 * Checks if a target path is safely contained inside baseDir (Path Traversal Protection).
 */
function isSafeSubpath(baseDir, targetPath) {
  if (!targetPath || typeof targetPath !== "string") return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

module.exports = {
  isSafeSubpath,
};
