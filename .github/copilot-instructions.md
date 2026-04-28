# Project Overview: Cloud Document Downloader & OCR / AI Sync

Dieses Dokument dient als zentrale Wissensbasis für alle zukünftigen KI-Agenten und VS Code Copilot Sitzungen. Es fasst die Architektur, die verwendeten Technologien und alle in der Vergangenheit behobenen kritischen Fehler sowie Sicherheitsrichtlinien zusammen.

**Wichtig:** Verwende diese Informationen, um bei zukünftigen Änderungen den Kontext des Projekts zu verstehen und keine alten Sicherheitslücken wieder einzubauen!

## 1. Tech Stack & Architektur

- **Backend:** Node.js, Express.js
- **Authentifizierung:** JWT (JSON Web Tokens) in `HttpOnly` & `Strict` Cookies. Rate-Limiting per `express-rate-limit` auf `/api/login`.
- **KI & OCR:**
  - Tesseract.js für Textextraktion (Implementiert als **Global Singleton Worker**, um RAM- und CPU-Spitzen zu verhindern).
  - Ollama (Lokal, z. B. Gemma Model) für automatische Kategorisierung, Tagging und Datums-Erkennung von Dokumenten.
- **Google Drive Integration:** `googleapis` via `app/driveApi.js`.
- **Dateiverarbeitung:** `multer` für Uploads, `pdf-lib` für PDF-Manipulationen, `pdf2pic` für Thumbnail-Generierung. Externe Python-Skripte (`scanner.py`) werden via `execFile` angesprochen.

## 2. Projektstruktur

- `index.js`: Haupteinstiegspunkt. Enthält Express-Routing, Authentifizierungs-Middleware, Job-Queue-Logik zum asynchronen Hintergrund-Verarbeiten von Dateien und Interaktion mit Google Drive.
- `app/aiAgent.js`: Verarbeitet Dokumente, extrahiert Text (OCR), holt Metadaten über lokales LLM (Ollama) und baut durchsuchbare PDFs.
- `app/driveApi.js`: Kapselt die gesamte Google Drive API-Kommunikation (Uploads, Auth, Folder-Suche).
- `public/`: Enthält das Frontend (HTML, JS, CSS). Die Logik des Frontends wurde sauber in dedizierte Dateien aufgeteilt.
- `store/`: Arbeitsverzeichnis für persistente App-Daten (`settings.json`, `jobs.json`, `token.json`).

## 3. Bekannte und Behoberne Risiken (Bitte STRIKT einhalten!)

Bei Weiterentwicklungen am Code dürfen die folgenden reparierten Sicherheits- und Performanceprobleme **auf keinen Fall** wieder eingeführt werden:

### A. Path Traversal (Directory Traversal)

- Dateinamen, die vom Client stammen (z. B. in `/api/upload-scan` oder im Multer-Storage-Upload), **müssen immer** mit `path.basename(filename)` bereinigt werden. Es darf nie ungefiltert `path.join(Ordner, UserEingabe)` verwendet werden, da sonst Systemdateien gelesen, überschrieben oder gelöscht werden könnten (z.B. `../../etc/passwd`).

### B. Command Injection

- Der Aufruf von Shell-Skripten oder Python-Skripten (`scanner.py`) darf **niemals** über `exec()` mit Shell-Interpolation erfolgen!
- Es muss immer **`execFile()`** mit einem strikten Array für die Argumente verwendet werden, damit User-Eingaben nicht als System-Befehle interpretiert werden können.

### C. Performance: File I/O Blocking & RAM-Müll

- Beim Schreiben der Job-Reihenfolge (`saveJobs`) **muss asynchrones** `fs.promises.writeFile` genutzt werden. `fs.writeFileSync` blockiert den Main-Thread und bringt den Server bei hohem Traffic zum Erliegen.
- Jobs, die älter als 30 Tage sind, werden automatisch aus dem Speicher bereinigt, um Speicher-Leaks (Memory/RAM/Disk) zu vermeiden.

### D. Performance: OCR & Ressourcen

- `Tesseract.createWorker()` darf nicht bei jedem Dokumenten-Scan neu instanziiert und danach terminiert werden (kostet enorm CPU & blockiert 30+ MB RAM pro Instanz).
- In `app/aiAgent.js` existiert dafür ein `globalTesseractWorker`. Dieser Singleton muss für anfallende Scans wiederverwendet werden.

### E. App-Abstürze (Crashes) durch Unhandled Rejections & fehlende Fallbacks

- Externe APIs (wie Google Drive oder lokales Ollama) können Timeouts werfen. Es muss immer ein `try/catch` Block existieren.
- Bevor ein `fs.createReadStream()` (z. B. beim Drive Upload) gestartet wird, muss geprüft werden, ob die Datei überhaupt lokal existiert (`fs.existsSync`). Sonst reißt ein fehlendes File den Server ab.
- Wenn das LLM (Ollama) unverständliches JSON liefert oder ins Timeout läuft, gibt es in `aiAgent.js` ein vordefiniertes Fallback-JSON, damit Downstream-Code (wie Array-Slices `.slice(0,3)`) nicht in TypeError-Crashes rennt.

### F. Sicherheit: Temporäre Dateien

- Das Konvertieren von PDFs in Bilder (`pdf2pic`) nutzt temporäre Pfade via `os.tmpdir()` und generiert einmalige Dateinamen (`uniqueId`). Dies verhindert Race-Conditions (wenn 2 User gleichzeitig hochladen) und hält das Root-Verzeichnis sauber.

## 4. Frontend & UX Historie (Ältere Fixes)

- **iPhone Perspective Stretch Bug:** Bilder von iOS-Geräten wurden verzerrt dargestellt. Dies wurde durch das Entfernen hartcodierter Bild-Dimensionen in `pdf2pic` und flexible CSS-Regeln behoben. Setze keine fixen `width`/`height`-Attribute, die die Aspect-Ratio brechen.
- **Zero-Delay Polling:** Die Job-Queue (`uploadQueue`) wird im Frontend ohne Start-Verzögerung gepollt, um sofortiges Feedback zu garantieren.
- **Frontend Code-Split:** Die Benutzeroberfläche wurde bereinigt. HTML, JS und CSS liegen sauber getrennt im `public/` Ordner (z.B. `index.html`, `scanner.html`, `login.html`). Diese strikte Trennung ist bei UI-Erweiterungen beizubehalten. Formatiere neuen Code immer sauber (Prettier-Standard).

## 5. Arbeitsanweisungen für den KI-Agenten (WICHTIG!)

1. **Immer Fragen stellen:** Bevor du große, komplexe oder unklare Änderungen an der Codebase vornimmst, MUSS beim Nutzer nachgefragt werden. Nimm keine massiven Umbauten auf bloße Vermutungen hin vor.
2. **Kontinuierliches Update dieses Dokuments:** Sobald in einem Chat neue Architekturentscheidungen getroffen, Frameworks hinzugefügt oder hartnäckige Bugs gelöst wurden, bist du VERPFLICHTET, diese Datei (`.github/copilot-instructions.md`) entsprechend zu aktualisieren. Das Projekt-Gedächtnis muss immer auf dem neuesten Stand bleiben!

---

_Dieses Dokument lebt und wächst mit dem Projekt. Halte es stets aktuell!_
