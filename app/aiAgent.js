const fs = require("fs");
const os = require("os");
const path = require("path");
const pdf = require("pdf-parse");
const { fromPath } = require("pdf2pic");
const { Ollama } = require("ollama");
const dotenv = require("dotenv");
dotenv.config();

let debug = false;
const LOCAL_AI_HOST = process.env.LOCAL_AI_HOST;

let globalTesseractWorker = null;

// Custom fetch to retry on timeout, which happens often on slow machines or when model cold-starts
const customFetch = async (url, options) => {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error.cause && error.cause.code === "UND_ERR_HEADERS_TIMEOUT") {
      console.log("[AI] Headers Timeout Error (Modell lädt eventuell noch). Zweiter Versuch...");
      return await fetch(url, options);
    }
    throw error;
  }
};

const ollama = new Ollama({ host: LOCAL_AI_HOST, fetch: customFetch });

async function generatePdfName(filename, settings = {}) {
  try {
    let pdfFileName = "";
    const pdfDate = setFileDate(filename);
    const rawText = await extractTextFromPdf(filename);
    const cleanText = (rawText || "").replace(/[\s\r\n\t]+/g, " ").trim();
    let pdfData = cleanText;
    let pdfImageBuffer = false;

    if (cleanText.length >= 40) {
      console.log(`[AI] Vorhandene Text-/OCR-Ebene im PDF erkannt (${cleanText.length} Zeichen). Tesseract OCR wird übersprungen.`);
    } else {
      console.log(`[AI] Kein ausreichender nativer Text im Dokument (${cleanText.length} Zeichen). Starte Bild-Konvertierung & Fallback-OCR...`);
      try {
        if (filename.toLowerCase().endsWith(".pdf")) {
          pdfImageBuffer = await getPdfImageBuffer(filename);
        } else {
          pdfImageBuffer = await fs.promises.readFile(filename).then((buf) => buf.toString("base64")).catch(() => false);
        }

        if (pdfImageBuffer) {
          const ocrText = await performOcr(pdfImageBuffer, filename);
          if (ocrText && ocrText.trim().length > 0) {
            pdfData = (pdfData ? pdfData + "\n" : "") + ocrText.trim();
          }
        }
      } catch (ocrWrapperErr) {
        console.error("[AI] Fehler bei OCR Vorbereitung:", ocrWrapperErr.message || ocrWrapperErr);
      }
    }

    const pdfContentData = (await getFileDataJSONGemma(pdfData, settings)) || {
      category: "Unbekannt",
      company: "Unbekannt",
      tags: ["Dokument", "Unbekannt"],
      documentDate: "unknown",
      isInvoice: false,
      invoiceNumber: "none",
      invoiceAmmount: 0,
    };

    const firstThreeWords =
      pdfContentData.tags && Array.isArray(pdfContentData.tags) && pdfContentData.tags.length > 0
        ? pdfContentData.tags.slice(0, 3).join(" ")
        : "Dokument";

    pdfFileName = `${pdfDate} -${pdfContentData.category || "Unbekannt"}- ${firstThreeWords} (${pdfContentData.company || "Unbekannt"})`;

    return {
      success: true,
      full: pdfFileName,
      date: pdfDate,
      documentDate: pdfContentData.documentDate || "unknown",
      category: pdfContentData.category || "Unbekannt",
      tags: pdfContentData.tags || ["Dokument"],
      company: pdfContentData.company || "Unbekannt",
      isInvoice: !!pdfContentData.isInvoice,
      invoiceNumber: pdfContentData.invoiceNumber || "none",
      invoiceAmmount: pdfContentData.invoiceAmmount || 0,
    };
  } catch (fatalErr) {
    console.error("[AI] Fataler Fehler bei generatePdfName:", fatalErr);
    const pdfDate = setFileDate(filename);
    return {
      success: true,
      full: `${pdfDate} -Unbekannt- Dokument (Unbekannt)`,
      date: pdfDate,
      documentDate: "unknown",
      category: "Unbekannt",
      tags: ["Dokument"],
      company: "Unbekannt",
      isInvoice: false,
      invoiceNumber: "none",
      invoiceAmmount: 0,
    };
  }
}

function setFileDate(fileName) {
  if (fileName) {
    const dateMatch = fileName.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
    if (dateMatch) {
      const day = dateMatch[1];
      const month = dateMatch[2];
      const year = dateMatch[3].slice(2);
      return `${year}${month}${day}`;
    }
  }

  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = String(today.getFullYear()).slice(2);
  return `${year}${month}${day}`;
}

async function getFileDataJSONGemma(pdfText, settings = {}) {
  const allowedCompanies = settings.AI_COMPANY || "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt";
  const allowedCategories =
    settings.AI_CATEGORIES ||
    "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige";

  const instructionFileName =
    "Du bist ein Assistent zur Dokumentenanalyse. Analysiere den folgenden Beleg/Text und extrahiere die Informationen als valides JSON.\n" +
    "Gib AUSSCHLIESSLICH das JSON-Objekt zurück, ohne zusätzlichen Text und ohne Markdown-Codeblöcke (\`\`\`json).\n" +
    "Regeln:\n" +
    `1. "company": Ziel-Unternehmen/Organisation. Erlaubte Werte: ${allowedCompanies}. Wenn unklar, "Unbekannt".\n` +
    `2. "category": Hauptkategorie aus: ${allowedCategories}. Wenn unklar, "Sonstige".\n` +
    '3. "tags": Array von 3-5 prägnanten Schlagworten zum Inhalt/Absender.\n' +
    '4. "isInvoice": Boolean (true/false) ob es sich um eine Rechnung/Zahlungsbeleg handelt.\n' +
    '5. "documentDate": String mit Datum im Format "DD.MM.YYYY" oder "unknown".\n' +
    '6. "invoiceNumber": String mit Rechnungs-/Belegnummer oder "none".\n' +
    '7. "invoiceAmmount": Integer in Cent (z.B. 1999 für 19,99€) oder 0.\n' +
    'JSON Schema:\n' +
    '{"company":"String","category":"String","tags":["String"],"isInvoice":true,"documentDate":"String","invoiceNumber":"String","invoiceAmmount":0}';

  const targetModel = process.env.LOCAL_AI_MODEL || "gemma4:e2b";
  const textContent = (pdfText && pdfText.trim().length > 0) ? pdfText.slice(0, 4000) : "Kein Text lesbar";

  const aiSettings = {
    model: targetModel,
    messages: [
      {
        role: "user",
        content: instructionFileName + "\n\nDokumententext:\n--- START ---\n" + textContent + "\n--- END ---",
      },
    ],
    options: { temperature: 0.1 },
  };

  try {
    const response = await ollama.chat(aiSettings);
    let raw = (response?.message?.content || "").trim();
    if (raw.startsWith("```json")) raw = raw.replace(/^```json/, "").replace(/```$/, "").trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```/, "").replace(/```$/, "").trim();
    const chatString = JSON.parse(raw);
    chatString.documentDate = checkFileDate(chatString.documentDate);
    return chatString;
  } catch (error) {
    console.error("[AI] Fehler bei Ollama JSON-Analyse:", error.message || error);
    return false;
  }
}

function checkFileDate(text) {
  if (text) {
    const match = text.match(/\b(\d{2})[./-](\d{2})[./-](\d{4}|\d{2})\b/);
    if (match) {
      const day = match[1];
      const month = match[2];
      const year = match[3].length === 2 ? `20${match[3]}` : match[3];
      return `${day}.${month}.${year}`;
    }
  }
  return "unknown";
}

function getPythonPath() {
  const venvWin = path.join(__dirname, "..", "venv", "Scripts", "python.exe");
  const venvUnix = path.join(__dirname, "..", "venv", "bin", "python");
  if (fs.existsSync(venvWin)) return venvWin;
  if (fs.existsSync(venvUnix)) return venvUnix;
  return "python";
}

async function getPdfImageBuffer(pdfPath) {
  try {
    const uniqueId = Date.now() + "-" + Math.random().toString(36).substring(2, 9);
    const outPng = path.join(os.tmpdir(), `pdfPic_${uniqueId}.png`);

    // 1. Primär: PyMuPDF (fitz) - schnell & zuverlässig
    try {
      const { execFile } = require("child_process");
      const util = require("util");
      const execFileAsync = util.promisify(execFile);
      await execFileAsync(getPythonPath(), [
        "-c",
        "import sys, fitz; doc=fitz.open(sys.argv[1]); pix=doc[0].get_pixmap(dpi=150); pix.save(sys.argv[2]); doc.close()",
        pdfPath,
        outPng,
      ]);
      if (fs.existsSync(outPng)) {
        const buf = await fs.promises.readFile(outPng);
        await fs.promises.unlink(outPng).catch(() => {});
        if (buf && buf.length > 100) {
          return buf.toString("base64");
        }
      }
    } catch (fitzErr) {
      // Fallback
    }

    // 2. Fallback: pdf2pic
    const options = {
      density: 150,
      saveFilename: `pdfPic_${uniqueId}`,
      savePath: os.tmpdir(),
      format: "png",
    };

    const convert = fromPath(pdfPath, options);
    const result = await convert(1, { responseType: "base64" });

    const tempFileCheck = path.join(os.tmpdir(), `pdfPic_${uniqueId}.1.png`);
    if (fs.existsSync(tempFileCheck)) {
      fs.promises.unlink(tempFileCheck).catch(() => { });
    }

    if (!result || !result.base64) {
      return false;
    }

    return result.base64;
  } catch (err) {
    console.error("[AI] Fehler bei der PDF-Bild-Extraktion:", err.message || err);
    return false;
  }
}

async function performOcr(base64Image, originalFilePath) {
  if (!base64Image) return "";
  try {
    const { execFile } = require("child_process");
    const util = require("util");
    const execFileAsync = util.promisify(execFile);

    console.log("[AI] Starte OCR Prozess...");

    // VERSUCH 1: OCRmyPDF
    if (originalFilePath && originalFilePath.toLowerCase().endsWith(".pdf")) {
      try {
        await execFileAsync("ocrmypdf", ["-l", "deu", "--force-ocr", originalFilePath, originalFilePath]);
        console.log("[AI] ocrmypdf erfolgreich! PDF ist nun durchsuchbar.");
        const reReadText = await extractTextFromPdf(originalFilePath);
        if (reReadText && reReadText.trim().length > 20) {
          return reReadText.trim();
        }
      } catch (err) {
        // Fallback
      }
    }

    // VERSUCH 2: Fallback (Tesseract.js)
    try {
      if (typeof base64Image === "string" && (base64Image.startsWith("JVBERi0") || base64Image.startsWith("%PDF"))) {
        console.log("[AI] Base64 ist ein PDF-Header, überspringe Tesseract.js (nur Bild-Raster unterstützt).");
        return "";
      }

      const Tesseract = require("tesseract.js");
      const bufferToOcr = Buffer.from(base64Image, "base64");
      if (!bufferToOcr || bufferToOcr.length < 50) {
        return "";
      }

      // Validierung PNG oder JPEG
      const isPng = bufferToOcr[0] === 0x89 && bufferToOcr[1] === 0x50;
      const isJpg = bufferToOcr[0] === 0xff && bufferToOcr[1] === 0xd8;
      if (!isPng && !isJpg) {
        console.log("[AI] Buffer ist kein valides PNG/JPEG. Überspringe Tesseract.");
        return "";
      }

      if (!globalTesseractWorker) {
        globalTesseractWorker = await Tesseract.createWorker("deu", 1, { logger: () => { } });
      }

      const res = await globalTesseractWorker.recognize(bufferToOcr);
      const text = res?.data?.text || "";
      console.log("[AI] Text für Metadaten extrahiert. Länge: " + (text ? text.length : 0));
      return text && text.trim().length > 20 ? text : "";
    } catch (tessErr) {
      console.error("[AI] Tesseract.js OCR Fehler (wird übersprungen):", tessErr.message || tessErr);
      if (globalTesseractWorker) {
        try { await globalTesseractWorker.terminate(); } catch (e) {}
        globalTesseractWorker = null;
      }
      return "";
    }
  } catch (ocrErr) {
    console.error("[AI] OCR fehlgeschlagen:", ocrErr.message || ocrErr);
    return "";
  }
}

async function extractTextFromPdf(pdfPath) {
  try {
    if (!pdfPath.toLowerCase().endsWith(".pdf")) return "";
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    return data.text || "";
  } catch (err) {
    console.error("[AI] Error parsing PDF:", err.message || err);
    return "";
  }
}

function searchNameInText(text, searchTerms, returnCompanyName = "unbekannt") {
  for (const term of searchTerms) {
    if (text.toLowerCase().includes(term)) {
      return returnCompanyName;
    }
  }
  return false;
}

module.exports = {
  init: function (setDebug = false) {
    debug = setDebug;
    return true;
  },
  getPdfName: async function (filePath, settings = {}) {
    return await generatePdfName(filePath, settings);
  },
  generateThumbnail: async function (pdfPath) {
    try {
      if (!pdfPath.toLowerCase().endsWith(".pdf")) return null;
      const uniqueId = Date.now() + "-" + Math.random().toString(36).substring(2, 9);
      const options = {
        density: 150,
        saveFilename: `thumb_${uniqueId}`,
        savePath: os.tmpdir(),
        format: "jpeg",
      };
      const convert = fromPath(pdfPath, options);
      const result = await convert(1, { responseType: "base64" });
      const tempThumb = path.join(os.tmpdir(), `thumb_${uniqueId}.1.jpeg`);
      if (fs.existsSync(tempThumb)) {
        fs.promises.unlink(tempThumb).catch(() => {});
      }
      if (result && result.base64) {
        return `data:image/jpeg;base64,${result.base64}`;
      }
      return null;
    } catch (err) {
      console.error("[AI] Fehler bei Fallback-Vorschaubild:", err.message || err);
      return null;
    }
  },
};
