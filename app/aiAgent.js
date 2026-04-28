const fs = require("fs");
const pdf = require("pdf-parse");
const { fromPath } = require("pdf2pic");
const { Ollama } = require("ollama");
const dotenv = require("dotenv");
dotenv.config();
var debug = false;
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
//const ollama = new Ollama({ host: LOCAL_AI_HOST });

async function generatePdfName(filename, settings = {}) {
  var pdfFileName = "";
  var pdfDate = setFileDate();
  var pdfData = await extractTextFromPdf(filename);
  if (!pdfData) pdfData = "";
  if (debug) console.log("[AI] Nativ extrahierter Text: " + pdfData.length + " Zeichen");

  var pdfImageBuffer = false;
  if (pdfData.length < 100) {
    if (debug) console.log("[AI] Wenig Text. Generiere Bild und nutze OCR...");
    if (filename.toLowerCase().endsWith(".pdf")) {
      pdfImageBuffer = await getPdfImageBuffer(filename);
    } else {
      pdfImageBuffer = await fs.promises.readFile(filename).then((buf) => buf.toString("base64"));
    }

    if (pdfImageBuffer) {
      const ocrText = await performOcr(pdfImageBuffer, filename);
      if (ocrText) {
        pdfData += "\n" + ocrText;
      }
    }
  }

  pdfContentData = await getFileDataJSONGemma(pdfData, pdfImageBuffer, settings);

  // FALLBACK einbauen, falls die KI 'false' zurückmeldet (JSON kaputt oder Timeout)
  if (!pdfContentData) {
    console.error("[AI] KI Fallback aktiv. Generiere Standard-Daten, um Server-Crash zu verhindern.");
    pdfContentData = {
      category: "Unbekannt",
      company: "Unbekannt",
      tags: ["Fehler", "Scanner", "Unbekannt"],
      documentDate: "unknown",
      isInvoice: false,
    };
  }

  var firstThreeWords =
    pdfContentData.tags && Array.isArray(pdfContentData.tags)
      ? pdfContentData.tags.slice(0, 3).join(" ")
      : "Keine Tags";

  pdfFileName = `${pdfDate} -${pdfContentData.category}- ${firstThreeWords} (${pdfContentData.company})`;

  return {
    success: true,
    full: pdfFileName,
    date: pdfDate,
    documentDate: pdfContentData.documentDate,
    category: pdfContentData.category,
    tags: pdfContentData.tags,
    company: pdfContentData.company,
    isInvoice: pdfContentData.isInvoice,
  };
}

function setFileDate(fileName) {
  // Extract the date using a regular expression
  var dateMatch;
  if (fileName !== undefined) {
    dateMatch = fileName.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  }

  if (dateMatch) {
    const day = dateMatch[1]; // Extract day (e.g., 20)
    const month = dateMatch[2]; // Extract month (e.g., 01)
    const year = dateMatch[3].slice(2); // Extract last 2 digits of year (e.g., 25)

    // Combine into desired format
    const formattedDate = `${year}${month}${day}`;
    return formattedDate;
    // Output: "200125"
  } else {
    const today = new Date();

    // Extract the day, month, and year
    const day = String(today.getDate()).padStart(2, "0"); // Ensure 2 digits
    const month = String(today.getMonth() + 1).padStart(2, "0"); // Months are 0-based
    const year = String(today.getFullYear()).slice(2); // Get last 2 digits of year

    // Combine into the desired format
    const formattedDate = `${year}${month}${day}`;

    return formattedDate;
  }
}

async function getFileDataJSONGemma(pdfText, imageBuffer = false, settings = {}) {
  if (pdfText.length < 100 && imageBuffer == false) {
    console.log("[AI] PDF Text too short for analysis and no image buffer available");
    return false;
  }

  const allowedCompanies = settings.AI_COMPANY || "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt";
  const allowedCategories =
    settings.AI_CATEGORIES ||
    "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige";

  var instructionFileName =
    "Du bist ein Assistent zur Dokumentenanalyse. Analysiere den untenstehenden Text und extrahiere die angeforderten Informationen.\n" +
    "Gib das Ergebnis AUSSCHLIESSLICH als valides JSON aus.Füge keinen Text vor oder nach dem JSON hinzu.Verwende keine Markdown-Formatierung (kein ```json).\n" +
    "Regeln für die Datengewinnung:\n" +
    `1. "company": An wen ist das Dokument gerichtet? Erlaubte Werte sind: ${allowedCompanies}. Wenn keine der vorherigen Optionen passt, fülle das Feld mit "Unbekannt".\n` +
    `2. "category": Finde ein einzelnes Wort als Hauptkategorie des Dokuments. Nutze folgende Kategorien: ${allowedCategories}. Wenn keine dieser passt, vergib die Kategorie "Sonstige".\n` +
    '3. "tags": Finde bis zu 3 weitere beschreibende Wörter zum Inhalt. Versuche vor allem auch den Absender mit als Wort zu nennen. Das Wort im Feld "company" bzw "category" oder ein ähnliches Wort darf nicht bei tags dabei sein und sich dadurch widerholen. Gib diese als Array von Strings zurück.\n' +
    'WICHTIG: Wenn es keinen passenden Inhalt für Kategorie und Tags gibt, setze "category" auf "unknown" und "tags" auf ["none"].\n' +
    '4. "isInvoice": Boolean. Setze den Wert auf true, wenn es sich bei dem Dokument um eine Rechnung handelt, wenn eine Zahlung vorgenommen werden muss oder das Dokument irgend einen buchhalterischen Bezug hat. Andernfalls false.\n' +
    '5. "documentDate": String. Suche nach dem Datum auf dem Dokument (z.B. Rechnungsdatum oder Erstellungsdatum) und gib es im Format "DD.MM.YYYY" aus. Wenn keines abgedruckt ist, setze "unknown".\n' +
    'Verwende strikt dieses JSON-Schema:{"company": "String","category": "String","tags": ["String", "String", "String"],"isInvoice": Boolean, "documentDate": "String"}\n';

  var aiSettings = {
    model: "gemma4:e2b",
    messages: [
      {
        role: "user",
        content: instructionFileName,
      },
    ],
  };
  if (imageBuffer != false && pdfText.length < 100) {
    console.log("[AI] use PDF image Buffer");
    aiSettings.messages[0].images = [imageBuffer];
    aiSettings.messages[0].content = aiSettings.messages[0].content + "Hier ist der Inhalt eines Dokuments als Bild";
  } else {
    aiSettings.messages[0].content =
      aiSettings.messages[0].content +
      "Hier ist der Inhalt eines Dokuments:\n --- START DOKUMENT ---\n" +
      pdfText +
      "\n--- END DOKUMENT ---";
  }
  try {
    const response = await ollama.chat(aiSettings);
    if (debug) console.log("[AI] Response: " + response.message.content);
    try {
      var chatString = JSON.parse(response.message.content);
      chatString.documentDate = checkFileDate(chatString.documentDate);
      return chatString;
    } catch (error) {
      console.log("[ERROR] No JSON response from AI. Response was: " + response.message.content);
      return false;
    }
  } catch (error) {
    console.log("Es gab einen Fehler:", error);
    console.log("Stelle sicher, dass die Ollama-App im Hintergrund läuft!");
    return false;
  }
}

async function checkCompanyName(companyNameIn) {
  console.log(companyNameIn);

  const searchTermsTheWire = ["the wir", "thewir", "he wire", "ewire"];
  const searchTermsPolyxo = ["poly", "lyxo", "polyxo", "smarthomeagentur", "home agen", "agentur ug"];
  const searchTermsWireWire = ["irewire", "wire wire", "ire wir", "wirew", "wire"];
  const searchTermsDaniel = ["dani", "niel", "boebe", "böbe"];

  var companyName = false;

  if (companyName == false) companyName = searchNameInText(companyNameIn, searchTermsDaniel, "daniel");
  if (companyName == false) companyName = searchNameInText(companyNameIn, searchTermsTheWire, "the wire");
  if (companyName == false) companyName = searchNameInText(companyNameIn, searchTermsPolyxo, "polyxo");
  if (companyName == false) companyName = searchNameInText(companyNameIn, searchTermsWireWire, "wirewire");
  return companyName;
}

checkFileDate = (text) => {
  if (text) {
    // Falls die AI ein Dokumentendatum gefunden hat, dieses im Format DD.MM.YYYY zurückgeben
    const match = text.match(/\b(\d{2})[./-](\d{2})[./-](\d{4}|\d{2})\b/);
    if (match) {
      const day = match[1];
      const month = match[2];
      const year = match[3].length === 2 ? `20${match[3]}` : match[3];
      return `${day}.${month}.${year}`;
    }
  }
  return false;
};

async function getPdfImageBuffer(pdfPath) {
  try {
    const os = require("os");
    const path = require("path");
    const uniqueId = Date.now() + "-" + Math.random().toString(36).substring(2, 9);

    const options = {
      density: 150,
      saveFilename: `pdfPic_${uniqueId}`,
      savePath: os.tmpdir(), // In den temporären Ordner legen, um Hauptverzeichnis nicht vollzumüllen
      format: "png",
    };

    const convert = fromPath(pdfPath, options);
    const pageToConvertAsImage = 1;

    // Lass dir direkt Base64 zurückgeben anstatt eines Buffers
    const result = await convert(pageToConvertAsImage, { responseType: "base64" });

    // Temp-Datei asynchron löschen, falls pd2pic sie trotzdem anlegt
    const tempFileCheck = path.join(os.tmpdir(), `pdfPic_${uniqueId}.1.png`);
    if (fs.existsSync(tempFileCheck)) {
      fs.promises.unlink(tempFileCheck).catch(() => {});
    }

    if (!result || !result.base64) {
      console.log("[Fehler] pdf2pic hat kein valides Base64-Ergebnis geliefert.");
      return false;
    }

    return result.base64;
  } catch (err) {
    console.error("Fehler bei der pdf2pic Konvertierung:", err);
    return false;
  }
}

async function performOcr(base64Image, originalFilePath) {
  if (!base64Image) return "";
  try {
    console.log("[AI] Starte Tesseract OCR und Generierung von durchsuchbarem PDF...");
    const Tesseract = require("tesseract.js");
    const bufferToOcr = Buffer.from(base64Image, "base64");

    if (!globalTesseractWorker) {
      globalTesseractWorker = await Tesseract.createWorker("deu", 1, { logger: () => {} });
    }

    const {
      data: { text, pdf },
    } = await globalTesseractWorker.recognize(bufferToOcr, { pdfTitle: "Scan" }, { pdf: true });

    if (pdf && originalFilePath) {
      console.log("[AI] Überschreibe lokale Datei mit dem durchsuchbaren OCR-PDF...");
      const fs = require("fs");
      fs.writeFileSync(originalFilePath, Buffer.from(pdf));
    }

    console.log("[AI] OCR erfolgreich. Länge: " + (text ? text.length : 0));
    return text && text.trim().length > 20 ? text : "";
  } catch (ocrErr) {
    console.error("[AI] OCR fehlgeschlagen:", ocrErr);
    return "";
  }
}

async function extractTextFromPdf(pdfPath) {
  try {
    if (!pdfPath.toLowerCase().endsWith(".pdf")) return "";
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);

    return data.text || "";
    //console.log(data); // Full data object including metadata
  } catch (err) {
    console.error("Error parsing PDF:", err);
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
      const options = {
        density: 150,
        saveFilename: "thumb",
        savePath: ".",
        format: "jpeg",
      };
      const convert = fromPath(pdfPath, options);
      const result = await convert(1, { responseType: "base64" });
      if (result && result.base64) {
        return `data:image/jpeg;base64,${result.base64}`;
      }
      return null;
    } catch (err) {
      console.error("[AI] Fehler bei Fallback-Vorschaubild:", err);
      return null;
    }
  },
};
