const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const util = require("util");
const { fromPath } = require("pdf2pic");
const { DOWNLOADS_DIR, THUMBS_DIR, getPythonPath } = require("../config/paths");

const execFileAsync = util.promisify(execFile);

/**
 * Renders the first page of a PDF file to a JPEG thumbnail using multi-engine fallback.
 * Order: PyMuPDF (fitz) -> pdftoppm -> Ghostscript (gs) -> GraphicsMagick (gm) -> pdf2pic
 */
async function renderPdfToJpeg(pdfPath, targetThumbPath) {
  if (!fs.existsSync(pdfPath)) return false;

  // 1. PyMuPDF (fitz)
  try {
    await execFileAsync(getPythonPath(), [
      "-c",
      "import sys, fitz; doc=fitz.open(sys.argv[1]); page=doc[0]; pix=page.get_pixmap(dpi=150); pix.save(sys.argv[2]); doc.close()",
      pdfPath,
      targetThumbPath,
    ], { timeout: 30000 });
    if (fs.existsSync(targetThumbPath)) return true;
  } catch (fitzErr) {}

  // 2. pdftoppm (Poppler)
  try {
    const prefix = targetThumbPath.replace(/\.jpe?g$/i, "");
    await execFileAsync("pdftoppm", ["-jpeg", "-r", "150", "-f", "1", "-l", "1", "-singlefile", pdfPath, prefix], { timeout: 30000 });
    if (fs.existsSync(targetThumbPath)) return true;
    if (fs.existsSync(`${prefix}.jpg`)) {
      if (`${prefix}.jpg` !== targetThumbPath) {
        await fs.promises.rename(`${prefix}.jpg`, targetThumbPath).catch(() => {});
      }
      return true;
    }
  } catch (e) {}

  // 3. Ghostscript (gs)
  try {
    await execFileAsync("gs", [
      "-sDEVICE=jpeg",
      "-dJPEGQ=90",
      "-dNOPAUSE",
      "-dBATCH",
      "-dQUIET",
      "-dFirstPage=1",
      "-dLastPage=1",
      "-r150",
      `-sOutputFile=${targetThumbPath}`,
      pdfPath,
    ], { timeout: 30000 });
    if (fs.existsSync(targetThumbPath)) return true;
  } catch (gsErr) {}

  // 4. GraphicsMagick (gm)
  try {
    await execFileAsync("gm", [
      "convert",
      "-density",
      "150",
      `${pdfPath}[0]`,
      targetThumbPath,
    ], { timeout: 30000 });
    if (fs.existsSync(targetThumbPath)) return true;
  } catch (gmErr) {}

  // 5. pdf2pic
  try {
    const dir = path.dirname(targetThumbPath);
    const baseName = path.basename(targetThumbPath, path.extname(targetThumbPath));
    const convert = fromPath(pdfPath, {
      density: 150,
      saveFilename: baseName,
      savePath: dir,
      format: "jpeg",
    });
    const res = await convert(1);
    const possible = [
      path.join(dir, `${baseName}.1.jpeg`),
      path.join(dir, `${baseName}.1.jpg`),
      res?.path,
    ];
    for (const p of possible) {
      if (p && fs.existsSync(p)) {
        if (p !== targetThumbPath) {
          await fs.promises.rename(p, targetThumbPath).catch(() => {});
        }
        return true;
      }
    }
  } catch (p2pErr) {}

  return false;
}

/**
 * Resolves or generates a thumbnail file path on disk for a given job/file identifier.
 */
async function getOrGenerateThumbnailPath(identifier, getJobFn) {
  if (!identifier) return null;
  const cleanId = String(identifier).replace(/^gdrive_/, "");

  const candidatePaths = [
    path.join(DOWNLOADS_DIR, `thumb_${identifier}.jpg`),
    path.join(DOWNLOADS_DIR, `thumb_${identifier}.png`),
    path.join(DOWNLOADS_DIR, `thumb_${cleanId}.jpg`),
    path.join(DOWNLOADS_DIR, `thumb_${cleanId}.png`),
    path.join(THUMBS_DIR, `${identifier}.jpg`),
    path.join(THUMBS_DIR, `${cleanId}.jpg`),
    path.join(THUMBS_DIR, `thumb_${identifier}.jpg`),
    path.join(THUMBS_DIR, `thumb_${cleanId}.jpg`),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) return p;
  }

  if (typeof getJobFn === "function") {
    const job = getJobFn(identifier) || getJobFn(cleanId);
    const targetThumbPath = path.join(DOWNLOADS_DIR, `thumb_${identifier}.jpg`);
    if (job && job.filePath && fs.existsSync(job.filePath)) {
      const rendered = await renderPdfToJpeg(job.filePath, targetThumbPath);
      if (rendered && fs.existsSync(targetThumbPath)) return targetThumbPath;
    }
  }

  return null;
}

module.exports = {
  renderPdfToJpeg,
  getOrGenerateThumbnailPath,
};
