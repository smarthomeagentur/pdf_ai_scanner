const fs = require("fs");
const pdf = require("pdf-parse");
const { fromPath } = require("pdf2pic");
const { Ollama } = require("ollama");
const dotenv = require("dotenv");
dotenv.config();
var debug = false;
const LOCAL_AI_HOST = process.env.LOCAL_AI_HOST;
const ollama = new Ollama({ host: LOCAL_AI_HOST });

async function generatePdfName(filename) {
  var pdfFileName = "";
  var pdfDate = setFileDate();
  var pdfData = await extractTextFromPdf(filename);
  //var text = pdfData.substring(0, 700);
  if (debug) console.log("[AI] PDF Text text extracted: " + pdfData.length + " characters");
  var pdfContentData;
  if (pdfData.length < 100) {
    var pdfImageBuffer = await getPdfImageBuffer(filename);
    pdfContentData = await getFileDataJSONGemma(pdfData, pdfImageBuffer);
  } else {
    pdfContentData = await getFileDataJSONGemma(pdfData);
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

  //if (debug) console.log(text);
  var fileTags = false;
  var fileTags = await getFilenameSuggestionGemma(pdfData);
  if (fileTags == false) fileTags = ["no category", "no info"];

  if (debug) console.log("[AI] PDF Tags: ", fileTags);
  var category = fileTags.slice(0, 1).join("");
  var firstThreeWords = fileTags.slice(1, 4).join(" ");
  firstThreeWords = firstThreeWords.trim();
  firstThreeWords = firstThreeWords.replace(/\s{2,}/g, " ");

  var company = await getCompanySuggestionGemma(pdfData);
  if (company == false) company = "unbekannt";

  pdfFileName = `${pdfDate} -${category}- ${firstThreeWords} (${company})`;
  return { success: true, full: pdfFileName, date: pdfDate, category, tags: firstThreeWords, company };
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
    model: "gemma4:e4b",
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

async function getFilenameSuggestionGemma(pdfText) {
  if (pdfText.length < 100) {
    return ["keine Inhalte", "unbekannt"];
  }
  var instructionFileName =
    "Hier ist der Inhalt eines Dokuments:\n --- START DOKUMENT ---\n" +
    pdfText +
    "--- START DOKUMENT ---\n Ich möchte, dass du mir einen Dateinamen aus 4 Wörtern gibst. das 1. Wort ist die Kategorie (z.B. Buchhaltung, Personal, Rechnung, Steuer usw.). Gib mir nur die 4 Wörter zurück. Trenne die Wörter unbedingt mit Komma. Die Antwort darf nur diese 4 Wörter umfassen. Wenn es keine 4 Wörter gibt antworte mit weniger. Wenn es keinen passenden Inhalt gibt, antworte nur mit 'kein Inhalt'. Gib auch keine Anmerkungen oder Hinweise zurück. Nur die 4 Wörter!";
  try {
    const response = await ollama.chat({
      model: "gemma4:e4b", // Hier ggf. 'gemma:7b' eintragen, falls du das größere geladen hast
      messages: [
        {
          role: "user",
          content: instructionFileName,
        },
      ],
    });
    console.log(response.message.content);
    var chatString = response.message.content.replace(/[-/]/g, " ");
    chatString = chatString.trimStart();
    chatString = chatString.split(",");
    return chatString;
  } catch (error) {
    console.error("Es gab einen Fehler:", error);
    console.error("Stelle sicher, dass die Ollama-App im Hintergrund läuft!");
    return false;
  }
}

async function getCompanySuggestionGemma(pdfText) {
  if (pdfText.length < 100) {
    return false;
  }
  var instructionCompanySuggest =
    "Hier ist der Inhalt eines Dokuments:\n --- START DOKUMENT ---\n" +
    pdfText +
    "--- START DOKUMENT ---\n Ich möchte, dass du mir die Firma oder Person nennst, an welche das Dokument gerichtet ist. Antworte nur mit diesen Möglichkeiten: wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel oder Unbekannt, wenn keine der vorherigen passt. Gib mir nur die Zugehörigkeit als Wörter zurück.";
  try {
    const response = await ollama.chat({
      model: "gemma4:e4b", // Hier ggf. 'gemma:7b' eintragen, falls du das größere geladen hast
      messages: [
        {
          role: "user",
          content: instructionCompanySuggest,
        },
      ],
    });

    var chatMessage = response.message.content;
    console.log(chatMessage);

    const searchTermsTheWire = ["the wir", "thewir", "he wire", "ewire"];
    const searchTermsPolyxo = ["poly", "lyxo", "polyxo", "smarthomeagentur", "home agen", "agentur ug"];
    const searchTermsWireWire = ["irewire", "wire wire", "ire wir", "wirew", "wire"];
    const searchTermsDaniel = ["dani", "niel", "boebe", "böbe"];

    var companyName = false;

    if (companyName == false) companyName = searchNameInText(chatMessage, searchTermsDaniel, "daniel");
    if (companyName == false) companyName = searchNameInText(chatMessage, searchTermsTheWire, "the wire");
    if (companyName == false) companyName = searchNameInText(chatMessage, searchTermsPolyxo, "polyxo");
    if (companyName == false) companyName = searchNameInText(chatMessage, searchTermsWireWire, "wirewire");
    return companyName;
  } catch (error) {
    console.error("Es gab einen Fehler:", error);
    console.error("Stelle sicher, dass die Ollama-App im Hintergrund läuft!");
    return false;
  }
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

function searchNameInText(text, searchTerms, returnCompanyName = "unbekannt") {
  for (const term of searchTerms) {
    if (text.toLowerCase().includes(term)) {
      return returnCompanyName;
    }
  }
  return false;
}

function containsAnyMatch(array, searchTerms) {
  // Convert all search terms to lowercase for case-insensitive matching
  const lowerCaseSearchTerms = searchTerms.map((term) => term.toLowerCase());

  // Check if any element in the array matches any of the search terms
  return array.some((item) => lowerCaseSearchTerms.some((term) => item.toLowerCase().includes(term)));
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

module.exports = {
  init: function (api_key, setDebug = false) {
    debug = setDebug;
    return true;
  },
  getPdfName: async function (filePath) {
    return await generatePdfName(filePath);
  },
};
