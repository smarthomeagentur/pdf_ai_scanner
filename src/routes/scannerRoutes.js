const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { PDFDocument } = require("pdf-lib");
const { upload } = require("../middleware/upload");
const { DOWNLOADS_DIR, ROOT_DIR, getPythonPath, SCANNER_SCRIPT } = require("../config/paths");
const { addJobs } = require("../services/jobQueueService");

const router = express.Router();

router.post("/api/scan", upload.array("images", 50), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Keine Bilder hochgeladen." });

  const outputPdfPath = path.join(DOWNLOADS_DIR, `Scanned_${Date.now()}.pdf`);
  const coordsList = req.body.coords || [];
  const algorithm = req.body.algorithm || "color_enhanced";
  const autoQueue = req.body.autoQueue === "true";

  console.log(`[SCANNER] Starte Verarbeitung für ${req.files.length} Seite(n) mit Modus ${algorithm}`);

  try {
    const tempPdfs = [];
    const runScannerTask = (inputPath, tempPdfPath, coordsStr) =>
      new Promise((resolve, reject) => {
        execFile(
          getPythonPath(),
          [SCANNER_SCRIPT, inputPath, tempPdfPath, coordsStr, algorithm],
          (error) => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (error) reject(error);
            else resolve(tempPdfPath);
          }
        );
      });

    for (let i = 0; i < req.files.length; i++) {
      tempPdfs.push(
        await runScannerTask(
          req.files[i].path,
          path.join(DOWNLOADS_DIR, `temp_${Date.now()}_${i}.pdf`),
          Array.isArray(coordsList) ? coordsList[i] || "" : i === 0 ? coordsList : ""
        )
      );
    }

    if (tempPdfs.length === 1) {
      fs.renameSync(tempPdfs[0], outputPdfPath);
      const tempJpg = tempPdfs[0].replace(".pdf", ".jpg");
      if (fs.existsSync(tempJpg)) fs.renameSync(tempJpg, outputPdfPath.replace(".pdf", ".jpg"));
    } else {
      const mergedPdf = await PDFDocument.create();
      for (const pdfPath of tempPdfs) {
        const pdf = await PDFDocument.load(fs.readFileSync(pdfPath));
        (await mergedPdf.copyPages(pdf, pdf.getPageIndices())).forEach((page) => mergedPdf.addPage(page));
      }
      fs.writeFileSync(outputPdfPath, await mergedPdf.save());

      tempPdfs.forEach((p, i) => {
        if (fs.existsSync(p)) fs.unlinkSync(p);
        const jpg = p.replace(".pdf", ".jpg");
        if (fs.existsSync(jpg))
          i === 0 ? fs.renameSync(jpg, outputPdfPath.replace(".pdf", ".jpg")) : fs.unlinkSync(jpg);
      });
    }

    let createdJob = null;
    if (autoQueue) {
      const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
      createdJob = {
        id: jobId,
        originalName: path.basename(outputPdfPath),
        status: "pending",
        result: null,
        error: null,
        filePath: outputPdfPath,
        uploadDate: new Date().toISOString(),
      };
      addJobs([createdJob]);
    }

    res.set("X-File-Name", path.basename(outputPdfPath));
    res.set("Access-Control-Expose-Headers", "X-File-Name, X-Auto-Job");
    if (createdJob) res.set("X-Auto-Job", JSON.stringify(createdJob));

    res.download(outputPdfPath, "Scanned_Document.pdf", (err) => {
      if (!autoQueue && fs.existsSync(outputPdfPath)) {
        fs.promises.unlink(outputPdfPath).catch(() => {});
        const jpgPath = outputPdfPath.replace(".pdf", ".jpg");
        if (fs.existsSync(jpgPath)) fs.promises.unlink(jpgPath).catch(() => {});
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler beim Scannen des Dokuments." });
  }
});

router.post("/api/preview", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Kein Bild hochgeladen." });

  const inputPath = req.file.path;
  const outputJpgPath = path.join(DOWNLOADS_DIR, `Preview_${Date.now()}.jpg`);
  const algorithm = req.body.algorithm || "color_enhanced";

  try {
    await new Promise((resolve, reject) => {
      execFile(
        getPythonPath(),
        [SCANNER_SCRIPT, inputPath, outputJpgPath, req.body.coords || "skip", algorithm],
        (error, stdout) => {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (error) return reject(error);
          const match = stdout.match(/Auto-Detect: Nutze Filter '([^']+)'/);
          if (match) {
            res.setHeader("X-Detected-Algorithm", match[1]);
            res.setHeader("Access-Control-Expose-Headers", "X-Detected-Algorithm");
          }
          resolve(outputJpgPath);
        }
      );
    });

    res.download(outputJpgPath, "Preview.jpg", () => {
      if (fs.existsSync(outputJpgPath))
        setTimeout(() => fs.existsSync(outputJpgPath) && fs.unlinkSync(outputJpgPath), 10000);
    });
  } catch (error) {
    res.status(500).json({ error: "Fehler bei der Vorschaugenerierung." });
  }
});

module.exports = router;
