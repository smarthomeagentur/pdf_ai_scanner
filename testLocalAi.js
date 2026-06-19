const fs = require("fs");
const pdf = require("pdf-parse");
const dotenv = require("dotenv");
dotenv.config();

const endpoint = process.env.LOCAL_AI_HOST + "/v1/chat/completions";

const appSettings = {
  AI_COMPANY: "wirewire GmbH, The Wire UG, Polyxo Studios GmbH, Daniel, Unbekannt",
  AI_CATEGORIES:
    "Administration, Personal, Projekte, Rechnungen, Verträge, Marketing, Förderung, Buchhaltung, Dokumentation, Vertrieb, Privat, Sonstige",
};

async function extractTextFromPdf(pdfPath) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    return data.text ? data.text.trim() : "";
  } catch (err) {
    console.error(`Fehler beim Lesen von ${pdfPath}:`, err.message);
    return "";
  }
}

async function testLocalAiWithPdf(filePath) {
  console.log(`\n===========================================`);
  console.log(`Teste Datei: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.log(`Datei existiert nicht: ${filePath}`);
    return;
  }

  const pdfText = await extractTextFromPdf(filePath);
  if (pdfText.length < 100) {
    console.log("PDF Text zu kurz für Analyse.");
    return;
  }

  const allowedCompanies = appSettings.AI_COMPANY;
  const allowedCategories = appSettings.AI_CATEGORIES;

  let instructionFileName =
    "Du bist ein Assistent zur Dokumentenanalyse. Analysiere den untenstehenden Text und extrahiere die angeforderten Informationen.\n" +
    "Gib das Ergebnis AUSSCHLIESSLICH als valides JSON aus.Füge keinen Text vor oder nach dem JSON hinzu.Verwende keine Markdown-Formatierung (kein ```json).\n" +
    "Regeln für die Datengewinnung:\n" +
    `1. "company": An wen ist das Dokument gerichtet? Erlaubte Werte sind: ${allowedCompanies}. Nimm eine dieser Optionen, wenn sie im Dokument genannt werden oder auch wenn du einen starken Verdacht hast. Wenn keine der vorherigen Optionen passt, fülle das Feld mit "Unbekannt".\n` +
    `2. "category": Finde ein einzelnes Wort als Hauptkategorie des Dokuments. Nutze folgende Kategorien: ${allowedCategories}. Wenn keine dieser passt, vergib die Kategorie "unknown".\n` +
    '3. "tags": Finde bis zu 3 weitere beschreibende Wörter zum Inhalt. Versuche vor allem auch den Absender mit als Wort zu nennen. Das Wort im Feld "company" bzw "category" oder ein ähnliches Wort darf nicht bei tags dabei sein und sich dadurch wiederholen. Gib diese als Array von Strings zurück.\n' +
    'WICHTIG: Wenn es keinen passenden Inhalt für Kategorie und Tags gibt, setze "category" auf "unknown" und "tags" auf ["none"].\n' +
    '4. "isInvoice": Boolean. Setze den Wert auf true, wenn es sich bei dem Dokument um eine Rechnung handelt, wenn eine Zahlung vorgenommen werden muss oder das Dokument irgend einen buchhalterischen Bezug hat. Andernfalls false.\n' +
    '5. "documentDate": String. Suche nach dem Datum auf dem Dokument (z.B. Rechnungsdatum oder Erstellungsdatum) und gib es im Format "DD.MM.YYYY" aus. Wenn keines abgedruckt ist, setze "unknown".\n' +
    'Verwende strikt dieses JSON-Schema:{"company": "String","category": "String","tags": ["String", "String", "String"],"isInvoice": Boolean, "documentDate": "String"}\n';

  instructionFileName +=
    "Hier ist der Inhalt eines Dokuments:\n --- START DOKUMENT ---\n" + pdfText + "\n--- END DOKUMENT ---";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
      },
      body: JSON.stringify({
        model: "default", // Passe ggf. an das OlliteRT Modell an
        messages: [{ role: "user", content: instructionFileName }],
        temperature: 0.2, // Niedrige Temperatur für sicheres JSON
      }),
    });

    if (!response.ok) {
      console.error(`HTTP Fehler! Status: ${response.status}`);
      const errText = await response.text();
      console.log("Details:", errText);
      return;
    }

    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      const resultText = data.choices[0].message.content;
      console.log("Ergebnis von lokaler KI:");
      console.log(resultText);
    } else {
      console.log("Keine Antwort erhalten.");
    }
  } catch (error) {
    console.error("Verbindung fehlgeschlagen.", error);
  }
}

async function runTests() {
  for (let i = 1; i <= 10; i++) {
    await testLocalAiWithPdf(`./samples-scanner/${i}.pdf`);
  }
}

runTests();
