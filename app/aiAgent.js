const fs = require("fs");
const pdf = require("pdf-parse");

const { HfInference } = require("@huggingface/inference");
var hf; //hugging face client
debug = false;

async function generatePdfName(filename) {
  var pdfFileName = "";
  var pdfDate = setFileDate();
  var pdfData = await extractTextFromPdf(filename);
  var text = pdfData.substring(0, 700);
  if (debug) console.log("[AI] PDF Text text extracted");
  var fileTags = false;
  for (var i = 0; i < 5; i++) {
    fileTags = await getFilenameSuggestion(text);
    if (fileTags != false) break;
  }
  if (fileTags == false) return { success: false };

  if (debug) console.log("[AI] PDF Tags: ", fileTags);

  const category = fileTags.slice(0, 1).join("");
  var firstThreeWords = fileTags.slice(1, 4).join(" ");
  firstThreeWords = firstThreeWords.trim();
  firstThreeWords = firstThreeWords.replace(/\s{2,}/g, " ");

  var company = false;
  var models = [
    "Jean-Baptiste/roberta-large-ner-english",
    "dbmdz/bert-large-cased-finetuned-conll03-english",
    "dslim/bert-large-NER",
  ];
  var selector = 0;
  for (var i = 0; i < 5; i++) {
    company = await getCompanyName(text, models[selector]);
    console.log("[AI] PDF Company: ", company, " Model: ", models[selector]);
    if (company != false && company != "unbekannt") break;
    if (selector == 2 && company != false) {
      company = await getCompanySuggestion(text);
      console.log("[AI] PDF Company Backup: ", company);
      break;
    }
    selector++;
  }
  if (company == false) return { success: false };

  pdfFileName = `${pdfDate} -${category}- ${firstThreeWords} (${company})`;
  return { success: true, full: pdfFileName, date: pdfDate, category, tags: firstThreeWords, company };
}

async function getCompanyName(text, model) {
  if (text.length < 100) {
    return "unbekannt";
  }
  const searchTermsTheWire = ["the wir", "thewir", "he wire", "ewire"];
  const searchTermsPolyxo = ["poly", "lyxo", "polyxo", "smarthomeagentur", "home agen", "agentur ug"];
  const searchTermsWireWire = ["irewire", "wire wire", "ire wir", "wirew", "wire"];
  const searchTermsDaniel = ["dani", "niel", "boebe", "böbe"];

  return new Promise(async (resolve) => {
    var result;
    try {
      result = await hf.request({
        inputs: text,
        options: { wait_for_model: true },
        //model: "dbmdz/bert-large-cased-finetuned-conll03-english",
        model: model,
      });
    } catch (err) {
      console.log("Error generating company name:", err);
      resolve(false);
    }

    if (debug) console.log(result);

    const companyNames = result
      .reduce((acc, entity) => {
        if (entity.entity_group === "ORG") {
          const prev = acc[acc.length - 1];

          // Merge consecutive ORG tokens
          if (prev && prev.end === entity.start) {
            prev.word += entity.word.replace(/^##/, ""); // Append and remove leading ##
            prev.end = entity.end;
          } else {
            // Start a new entity
            acc.push({ ...entity });
          }
        }
        return acc;
      }, [])
      .map((entity) => entity.word); // Extract merged entity words
    if (debug) console.log(companyNames);

    const personName = result
      .reduce((acc, entity) => {
        if (entity.entity_group === "PER") {
          const prev = acc[acc.length - 1];

          // Merge consecutive ORG tokens
          if (prev && prev.end === entity.start) {
            prev.word += entity.word.replace(/^##/, ""); // Append and remove leading ##
            prev.end = entity.end;
          } else {
            // Start a new entity
            acc.push({ ...entity });
          }
        }
        return acc;
      }, [])
      .map((entity) => entity.word); // Extract merged entity words
    if (debug) console.log(personName);

    var companyName = "unbekannt";
    if (await containsAnyMatch(personName, searchTermsDaniel)) companyName = "daniel";
    if (await containsAnyMatch(companyNames, searchTermsDaniel)) companyName = "daniel";
    if (await containsAnyMatch(companyNames, searchTermsTheWire)) companyName = "the wire";
    if (await containsAnyMatch(companyNames, searchTermsPolyxo)) companyName = "polyxo";
    if (await containsAnyMatch(companyNames, searchTermsWireWire)) companyName = "wirewire";

    resolve(companyName);
  });
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

async function getFilenameSuggestion(pdfText) {
  if (pdfText.length < 100) {
    return ["keine Inhalte", "unbekannt"];
  }
  const instruction =
    "Ich habe eine PDF mit folgendem Inhalt und möchte, dass du mir einen Dateinamen aus 4 Wörtern gibst. das 1. wort ist die Kategorie (z.B. Buchhaltung, Personal, Rechnung, Steuer usw.). Gib mir nur die 4 Wörter zurück. Trenne die Wörter mit Komma. Die Antwort darf nur diese 4 Wörter umfassen. Wenn es keine 4 Wörter gibt antworte mit weniger. Wenn es keinen passenden Inhalt gibt, antworte nur mit 'kein Inhalt'. Hier ist der Inhalt:\n " +
    pdfText;

  try {
    const chatCompletion = await hf.chatCompletion({
      //model: "microsoft/Phi-3.5-mini-instruct",
      model: "microsoft/phi-4",
      messages: [
        {
          role: "user",
          content: instruction,
        },
      ],
      provider: "hf-inference",
      max_tokens: 800,
    });

    var chatString = chatCompletion.choices[0].message.content.replace(/[-/]/g, " ");
    chatString = chatString.trimStart();
    const wordsArray = chatString.split(",");

    return wordsArray;
  } catch (err) {
    console.log("Error generating filename suggestion:", err);
    return false;
  }
}

async function getCompanySuggestion(pdfText) {
  if (pdfText.length < 100) {
    return "unbekannt";
  }
  const instruction =
    "Ich habe eine PDF mit folgendem Inhalt und möchte, dass du mir die Firma oder Person nennst, an welche das Dokument gerichtet ist. Antworte nur mit diesen Möglichkeiten: wirewire, the wire, polyxo, daniel oder unbekannt, wenn keine der vorherigen passt. Gib mir nur die Zugehörigkeit als Wörter zurück. Hier ist der Inhalt:\n " +
    pdfText;

  try {
    const chatCompletion = await hf.chatCompletion({
      model: "microsoft/phi-4",
      messages: [
        {
          role: "user",
          content: instruction,
        },
      ],
      provider: "hf-inference",
      max_tokens: 800,
    });

    var chatString = chatCompletion.choices[0].message.content.replace(/[-/]/g, " ");
    chatString = chatString.trimStart();
    const wordsArray = chatString.split(",");

    switch (wordsArray[0]) {
      case "daniel":
      case "the wire":
      case "polyxo":
      case "wirewire":
        return wordsArray[0]; // Return the matched string
      default:
        return "unbekannt";
    }
  } catch (err) {
    console.log("Error generating filename suggestion:", err);
    return false;
  }
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
    hf = new HfInference(api_key); // Replace with your Hugging Face API key
    debug = setDebug;
    return true;
  },
  getPdfName: async function (filePath) {
    return await generatePdfName(filePath);
  },
};
