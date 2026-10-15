const fs = require("fs");
const pdfParse = require("pdf-parse");

const localPdfTextCache = new Map();
const drivePdfTextCache = new Map();

function extractExactSnippet(fullText, query, maxContext = 65) {
  if (!fullText || !query) return "";
  const lowerText = fullText.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return "";

  const start = Math.max(0, idx - maxContext);
  const end = Math.min(fullText.length, idx + query.length + maxContext);

  let snippet = fullText.substring(start, end).replace(/\s+/g, " ").trim();

  if (start > 0) {
    const firstSpace = snippet.indexOf(" ");
    if (firstSpace > 0 && firstSpace < 15) {
      snippet = "..." + snippet.substring(firstSpace + 1);
    } else {
      snippet = "..." + snippet;
    }
  }

  if (end < fullText.length) {
    const lastSpace = snippet.lastIndexOf(" ");
    if (lastSpace > snippet.length - 15 && lastSpace > 0) {
      snippet = snippet.substring(0, lastSpace) + "...";
    } else {
      snippet = snippet + "...";
    }
  }

  return snippet;
}

// "umsatzsteuer polyxo" => ["umsatzsteuer", "polyxo"]; "quoted phrases" stay together
function parseSearchTerms(query) {
  const terms = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match;
  while ((match = regex.exec(query || "")) !== null) {
    const term = (match[1] || match[2] || "").trim().toLowerCase();
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms;
}

function matchesAllTerms(text, terms) {
  const lower = (text || "").toLowerCase();
  return terms.length > 0 && terms.every((term) => lower.includes(term));
}

// Prefer the whole query as phrase; otherwise show one snippet per term found in the text
function extractSearchSnippet(fullText, query, terms, maxContext = 65) {
  const phraseSnippet = extractExactSnippet(fullText, query, maxContext);
  if (phraseSnippet || terms.length <= 1) return phraseSnippet;
  const snippets = [];
  for (const term of terms) {
    if (snippets.some((s) => s.toLowerCase().includes(term))) continue;
    const snippet = extractExactSnippet(fullText, term, Math.round(maxContext / 2));
    if (snippet) snippets.push(snippet);
    if (snippets.length >= 3) break;
  }
  return snippets.join(" ");
}

async function getLocalPdfText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    const stat = await fs.promises.stat(filePath);
    const cached = localPdfTextCache.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.text;
    }
    const dataBuffer = await fs.promises.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    const text = (data.text || "").replace(/\r?\n/g, " ");
    localPdfTextCache.set(filePath, { mtime: stat.mtimeMs, text });
    return text;
  } catch (e) {
    return "";
  }
}

async function getDrivePdfText(drive, fileId, modifiedTime) {
  try {
    const cached = drivePdfTextCache.get(fileId);
    if (cached && cached.modifiedTime === modifiedTime) {
      return cached.text;
    }
    const res = await drive.files.get(
      { fileId: fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    if (res.data) {
      const buffer = Buffer.from(res.data);
      const parsed = await pdfParse(buffer);
      const text = (parsed.text || "").replace(/\r?\n/g, " ");
      drivePdfTextCache.set(fileId, { modifiedTime, text });
      return text;
    }
  } catch (e) {}
  return "";
}

function normalizeDocName(str) {
  return (str || "").toLowerCase().replace(/\.pdf$/i, "").trim();
}

function normalizeDocKey(str) {
  return (str || "").toLowerCase().replace(/\.pdf$/i, "").replace(/[^a-z0-9]/g, "");
}

module.exports = {
  extractExactSnippet,
  extractSearchSnippet,
  parseSearchTerms,
  matchesAllTerms,
  getLocalPdfText,
  getDrivePdfText,
  normalizeDocName,
  normalizeDocKey,
};
