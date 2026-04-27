const fs = require("fs");
const pdf = require("pdf-parse");
const { fromPath } = require("pdf2pic");
const { Ollama } = require("ollama");
const dotenv = require("dotenv");
dotenv.config();
var debug = false;
const LOCAL_AI_HOST = process.env.LOCAL_AI_HOST;

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

async function generatePdfName(filename) {
  var pdfFileName = "";
  var pdfDate = setFileDate();
  var pdfData = await extractTextFromPdf(filename);
  if (debug) console.log("[AI] PDF Text text extracted: " + pdfData.length + " characters");
  var pdfContentData;
  if (pdfData.length < 100) {
    var pdfImageBuffer = await getPdfImageBuffer(filename);
    pdfContentData = await getFileDataJSONGemma(pdfData, pdfImageBuffer);
  } else {
    pdfContentData = await getFileDataJSONGemma(pdfData);
  }
  if (pdfContentData == false) {
    return {
      success: false,
    };
  }
  var firstThreeWords = pdfContentData.tags.slice(0, 3).join(" ");
  pdfFileName = `${pdfDate} -${pdfContentData.category}- ${firstThreeWords} (${pdfContentData.company})`;

  return {
    success: true,
    full: pdfFileName,
    date: pdfDate,
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

async function getFileDataJSONGemma(pdfText, imageBuffer = false) {
  if (pdfText.length < 100 && imageBuffer == false) {
    console.log("[AI] PDF Text too short for analysis and no image buffer available");
    return false;
  }
  var instructionFileName =
    "Du bist ein Assistent zur Dokumentenanalyse. Analysiere den untenstehenden Text und extrahiere die angeforderten Informationen.\n" +
    "Gib das Ergebnis AUSSCHLIESSLICH als valides JSON aus.Füge keinen Text vor oder nach dem JSON hinzu.Verwende keine Markdown-Formatierung (kein ```json).\n" +
    "Regeln für die Datengewinnung:\n" +
    '1. "company": An wen ist das Dokument gerichtet? Erlaubte Werte sind AUSSCHLIESSLICH: "wirewire GmbH", "The Wire UG", "Polyxo Studios GmbH", "Daniel" oder "Unbekannt" (wenn keine der vorherigen Optionen passt).\n' +
    '2. "category": Finde ein einzelnes Wort als Hauptkategorie des Dokuments Nutze Folgende Kategorien: Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat. Wenn keine dieser passt vergib die Kategorie "Sonstige"\n' +
    '3. "tags": Finde bis zu 3 weitere beschreibende Wörter zum Inhalt. Versuche vor allem auch den Absender mit als Wort zu nennen. Das Wort im Feld "company" bzw "category" oder ein ähnliches Wort darf nicht bei tags dabei sein. Gib diese als Array von Strings zurück.\n' +
    'WICHTIG: Wenn es keinen passenden Inhalt für Kategorie und Tags gibt, setze "category" auf "unknown" und "tags" auf ["none"].\n' +
    '4. "isInvoice": Boolean. Setze den Wert auf true, wenn es sich bei dem Dokument um eine Rechnung handelt, wenn eine Zahlung vorgenommen werden muss oder das Dokument irgend einen buchhalterischen Bezug hat. Andernfalls false.\n' +
    'Verwende strikt dieses JSON-Schema:{"company": "String","category": "String","tags": ["String", "String", "String"],"isInvoice": Boolean}"\n';

  var aiSettings = {
    model: "gemma4:e2b",
    messages: [
      {
        role: "user",
        content: instructionFileName,
      },
    ],
  };
  if (imageBuffer != false) {
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

async function fitCompanyName(companyNameIn) {
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

async function getPdfImageBuffer(pdfPath) {
  try {
    const options = {
      density: 150,
      saveFilename: "pdfPic",
      savePath: ".",
      format: "png",
      width: 800,
      height: 1100,
    };

    const convert = fromPath(pdfPath, options);
    const pageToConvertAsImage = 1;

    // Lass dir direkt Base64 zurückgeben anstatt eines Buffers
    const result = await convert(pageToConvertAsImage, { responseType: "base64" });

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

async function extractTextFromPdf(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);

    return data.text;
    //console.log(data); // Full data object including metadata
  } catch (err) {
    console.error("Error parsing PDF:", err);
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
  getPdfName: async function (filePath) {
    return await generatePdfName(filePath);
  },
};
