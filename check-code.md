# Codebase Audit & Improvement Plan (check-code.md)

Dieses Dokument enthält eine umfassende Code-Review und Architekturanalyse des Projekts **Adobe Cloud Downloader / Document Pipeline** (`adobe_cloud_downloader`). Es identifiziert Schwachstellen, Sicherheitsrisiken, Performance-Engpässe und strukturelle Optimierungspotenziale und ordnet diese in einer priorisierten Aufgabenliste mit detaillierten Lösungsvorschlägen ein.

---

## 1. Priorisierte Task-Übersicht

| Priorität | ID | Kategorie | Aufgabe | Betroffene Dateien | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0 (Kritisch)** | **SEC-01** | Sicherheit | Hardcodierte Standard-Passwörter & JWT-Secrets entfernen | [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-02** | Sicherheit | XSS-Prävention im Frontend (HTML-Escaping bei dynamischem Rendering) | [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-03** | Sicherheit | Path-Traversal-Schutz bei Datei-Downloads & Previews | [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-05** | Datenschutz / Zero-Trust | Client-Only Secrets (Lexoffice, BuchhaltungsButler, ClickUp) im Browser `localStorage` | [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js), [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-06** | Datenschutz / Drive Scope | Restriktiver Google Drive Scope `drive.file` + Google Drive Picker Dialog | [`app/driveApi.js`](file:///c:/WSL/adobe_cloud_downloader/app/driveApi.js), [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js), [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-07** | Datenschutz / Mail Zero-Trust | Gmail-Tokens clientseitig isoliert (`localStorage`), Server restlos bereinigt | [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js), [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js) | ✅ **Erledigt** |
| **P1 (Hoch)** | **ARCH-01** | Architektur | Modularisierung von `index.js` (Backend-Monolith in Services/Routes aufteilen) | [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js), `app/` | ⏳ Bereit zur Umsetzung |
| **P1 (Hoch)** | **ARCH-02** | Architektur | Modularisierung von `public/index.js` (Frontend-Skript aufteilen) | [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js) | ⏳ Bereit zur Umsetzung |
| **P1 (Hoch)** | **PERF-01** | Datenhaltung | Jobs-Speicherung (`jobs.json`) auf SQLite / Embedded DB migrieren | [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js), `store/` | ⏳ Bereit zur Umsetzung |
| **P1 (Hoch)** | **STAB-01** | Stabilität | Subprocess-Timeouts & Zombie-Process-Handling (Python/Ghostscript/Exiftool) | [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js), `app/` | ⏳ Bereit zur Umsetzung |
| **P2 (Mittel)** | **SEC-04** | Sicherheit | HTTP-Security-Header via `helmet` & globales Rate-Limiting | [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js) | ⏳ Bereit zur Umsetzung |
| **P2 (Mittel)** | **CLEAN-01** | Bereinigung | Server-seitige Legacy-Gmail-Reste isolieren / aufräumen | [`app/gmailApi.js`](file:///c:/WSL/adobe_cloud_downloader/app/gmailApi.js), [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js) | ⏳ Bereit zur Umsetzung |
| **P2 (Mittel)** | **AI-01** | KI / Robustheit | Ollama Timeout-Handling mit `AbortController` & Exponential Backoff | [`app/aiAgent.js`](file:///c:/WSL/adobe_cloud_downloader/app/aiAgent.js) | ⏳ Bereit zur Umsetzung |
| **P3 (Niedrig)** | **TEST-01** | Qualitätssicherung | Automatisierte Test-Suite (Unit- & Integrationstests) | `test/`, `package.json` | ⏳ Bereit zur Umsetzung |
| **P3 (Niedrig)** | **DOC-01** | Dokumentation | OpenAPI / Swagger API-Dokumentation & `.env.example` | `readme.md`, `.env.example` | ⏳ Bereit zur Umsetzung |

---

## 2. Detaillierte Task-Beschreibungen

---

### Task SEC-01: Hardcodierte Standard-Passwörter & JWT-Secrets entfernen
- **Priorität:** `P0 (Kritisch)`
- **Kategorie:** Sicherheit
- **Betroffene Dateien:** [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js)
- **Aktueller Zustand:**
  In `index.js` (Zeilen 44–47) werden unsichere Default-Werte verwendet:
  ```javascript
  const AUTH_ENABLED = process.env.AUTH_ENABLED === "true" || "true";
  const APP_PASSWORD = process.env.APP_PASSWORD || "admin";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "superadmin";
  const JWT_SECRET = process.env.JWT_SECRET || "default_super_secret_key_123";
  ```
  - `AUTH_ENABLED` prüft mit `|| "true"`, was immer wahr ist (String statt Boolean).
  - Wenn `.env` fehlt oder unvollständig ist, kann jeder Angreifer mit Standard-Passwörtern (`admin`, `superadmin`) vollen Zugriff auf das System und Google Drive Tokens erlangen.
- **Lösungsvorschlag:**
  1. Beim Serverstart prüfen, ob `JWT_SECRET` und Passwörter gesetzt sind. Wenn nicht, ein zufälliges kryptografisches Secret generieren oder den Start mit einer deutlichen Warnung / Error im Produktionsmodus verweigern.
  2. `AUTH_ENABLED = process.env.AUTH_ENABLED !== "false";` sauber als Boolean definieren.
  3. Niemals Default-Superadmin-Passwörter im Code hinterlegen.

---

### Task SEC-02: XSS-Prävention im Frontend (HTML-Escaping bei dynamischem Rendering)
- **Priorität:** `P0 (Kritisch)`
- **Kategorie:** Sicherheit
- **Betroffene Dateien:** [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js)
- **Aktueller Zustand:**
  Im Frontend werden Dateinamen, E-Mail-Betreffzeilen, Absendernamen und KI-Ergebnisse ungefiltert per String-Interpolation in `innerHTML` eingefügt:
  ```javascript
  card.innerHTML = `... <strong class="text-dark">${mail.fromName}</strong> ... ${mail.subject} ...`;
  ```
  Enthält ein E-Mail-Betreff oder ein gescanntes PDF schadhaften HTML/JS-Code (z.B. `<img src=x onerror=fetch(...)>`), wird dieser direkt im Kontext des Browsers ausgeführt und könnte im `localStorage` gespeicherte Gmail-Tokens entwenden (Stored XSS).
- **Lösungsvorschlag:**
  1. Globale Hilfsfunktion `escapeHtml(str)` in `public/index.js` etablieren:
     ```javascript
     function escapeHtml(str) {
       if (str === null || str === undefined) return "";
       return String(str)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
     }
     ```
  2. Alle dynamischen Werte in Kartenelementen, Details-Panels und Modals konsequent mit `escapeHtml(...)` umschließen.

---

### Task SEC-03: Path-Traversal-Schutz bei Datei-Downloads & Previews
- **Priorität:** `P0 (Kritisch)`
- **Kategorie:** Sicherheit
- **Betroffene Dateien:** [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js)
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  Alle Pfade werden mit `isSafeSubpath` gegen `downloads/` und `store/` validiert. Manipulationen wie `../../` werden abgewiesen.

---

### Task SEC-05: Zero-Trust Client-Only Secrets (Lexoffice, BuchhaltungsButler, ClickUp)
- **Priorität:** `P0 (Kritisch)`
- **Kategorie:** Datenschutz & Zero-Trust
- **Betroffene Dateien:** [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js), [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js)
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  Alle API-Schlüssel für Drittanbieter (Lexoffice API-Keys, BuchhaltungsButler Credentials, ClickUp API-Keys) werden ausschließlich im Browser `localStorage` gespeichert. Der Server speichert keine Drittanbieter-Schlüssel in `settings.json`. Schlüssel werden nur flüchtig für aktive Transfers im Request mitgegeben.

---

### Task SEC-06: Restriktiver Google Drive Scope `drive.file` + Google Picker
- **Priorität:** `P0 (Kritisch)`
- **Kategorie:** Datenschutz & Google Drive Sicherheit
- **Betroffene Dateien:** [`app/driveApi.js`](file:///c:/WSL/adobe_cloud_downloader/app/driveApi.js), [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js), [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js)
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  Der volle Drive-Scope wurde auf `https://www.googleapis.com/auth/drive.file` minimiert. Die App hat technisch keinen Zugriff auf restliche Drive-Inhalte. Die Ordnerauswahl erfolgt direkt über den sicheren, nativen Google Drive Picker Dialog.

---

### Task SEC-07: Zero-Trust Mail-Architektur (Client-Side GIS)
- **Priorität:** `P0 (Kritisch)`
- **Kategorie:** Datenschutz & E-Mail-Sicherheit
- **Betroffene Dateien:** [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js), [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js)
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  Gmail-Authentifizierung und E-Mail-Abfragen laufen zu 100 % im Browser. Keine Mail-Tokens auf dem Server. Alte Server-Dateien (`gmail_accounts.json`) wurden restlos gelöscht. Übersprungene E-Mails werden persistent synchronisiert.

---

---

### Task ARCH-01: Backend-Modularisierung (`index.js` aufteilen)
- **Priorität:** `P1 (Hoch)`
- **Kategorie:** Architektur & Wartbarkeit
- **Betroffene Dateien:** [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js) (aktuell ~3.940 Zeilen)
- **Aktueller Zustand:**
  `index.js` enthält alle Express-Routen, WebSocket/SSE-Handler, Queue-Verarbeitung, Drive-Sync-Cron, Lexoffice-Integration, OCR-Pipeline, ClickUp-Logik und Fehlerbehandlung in einer einzigen Datei. Dies erschwert Tests, Refactorings und Fehlerbehebungen erheblich.
- **Lösungsvorschlag:**
  Aufteilung in eine saubere Ordnerstruktur:
  - `src/routes/` (`auth.js`, `jobs.js`, `drive.js`, `settings.js`, `admin.js`)
  - `src/services/` (`jobQueueService.js`, `ocrService.js`, `metadataService.js`, `driveSyncService.js`)
  - `src/middleware/` (`authMiddleware.js`, `errorHandler.js`, `rateLimiters.js`)
  - `src/config/` (`settings.js`, `constants.js`)
  - `index.js` dient nur noch als schlanker Bootstrap-Einstiegspunkt (< 100 Zeilen).

---

### Task ARCH-02: Frontend-Modularisierung (`public/index.js` aufteilen)
- **Priorität:** `P1 (Hoch)`
- **Kategorie:** Architektur & Frontend
- **Betroffene Dateien:** [`public/index.js`](file:///c:/WSL/adobe_cloud_downloader/public/index.js) (aktuell ~5.500 Zeilen)
- **Aktueller Zustand:**
  Die gesamte Frontend-Logik (Kamera-Scanner, Bildverarbeitung/Cropping, Drive-Sync-UI, Gmail-Client-Scanner, Job-Details, Einstellungen, Filterung) liegt in einer einzigen JS-Datei ohne Modulsystem.
- **Lösungsvorschlag:**
  Nutzung von nativen ES-Modulen (`<script type="module">`) oder einem leichtgewichtigen Bundler (Vite / ESBuild):
  - `public/js/scanner.js` (Kamera & Bildbeschneidung)
  - `public/js/gmailClient.js` (GIS Auth, Direct Gmail API Scanner, LocalStorage)
  - `public/js/jobsList.js` (Job-Karten, Details, Aktionen, Retry, Hide)
  - `public/js/settings.js` (Settings Modal & Secrets Management)
  - `public/js/app.js` (Main Coordinator)

---

### Task PERF-01: Jobs-Speicherung (`jobs.json`) auf SQLite migrieren
- **Priorität:** `P1 (Hoch)`
- **Kategorie:** Performance & Datenkonsistenz
- **Betroffene Dateien:** [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js), `store/jobs.json`
- **Aktueller Zustand:**
  Alle verarbeiteten Jobs werden im Arbeitsspeicher (`uploadJobs`) gehalten und regelmäßig komplett als JSON-Datei (`jobs.json`) auf die Festplatte serialisiert.
  - Bei hunderten/tausenden Belegen führt dies zu hohem RAM-Verbrauch und blockierenden I/O-Schreibvorgängen.
  - Bei plötzlichem Prozessabbruch während des Schreibens besteht das Risiko von JSON-Korruption.
- **Lösungsvorschlag:**
  Migration auf `better-sqlite3`:
  - Echte Transaktionen (ACID) verhindern Datenverlust.
  - Indizierte Abfragen für Filter, Suche, Datumsbereiche und Status ohne Voll-Scan im RAM.
  - Paging (`LIMIT / OFFSET`) für schnelle UI-Reaktionszeiten bei vielen Belegen.

---

### Task STAB-01: Subprocess-Timeouts & Zombie-Process-Handling
- **Priorität:** `P1 (Hoch)`
- **Kategorie:** Stabilität & Ressourcen
- **Betroffene Dateien:** [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js), [`app/scanner.py`](file:///c:/WSL/adobe_cloud_downloader/app/scanner.py), [`app/compress_pdf.py`](file:///c:/WSL/adobe_cloud_downloader/app/compress_pdf.py)
- **Aktueller Zustand:**
  Python-Skripte (`scanner.py`, `compress_pdf.py`), Ghostscript und Exiftool werden als Child-Prozesse ausgeführt. Hängt ein Prozess (z.B. defektes PDF mit Endlosschleife im Ghostscript-Parser), kann die gesamte Abarbeitungs-Queue blockieren.
- **Lösungsvorschlag:**
  1. `execFile` immer mit festem Timeout (z.B. `timeout: 60000`) und `killSignal: 'SIGKILL'` ausstatten.
  2. Temporäre Zwischendateien (`tmp_*.pdf`, Bildausschnitte) immer in `try ... finally`-Blöcken aufräumen, um Speicherlecks auf der Festplatte zu verhindern.

---

### Task SEC-04: HTTP-Security-Header via `helmet` & globales Rate-Limiting
- **Priorität:** `P2 (Mittel)`
- **Kategorie:** Sicherheit
- **Betroffene Dateien:** [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js), `package.json`
- **Aktueller Zustand:**
  Es fehlen standardmäßige HTTP-Sicherheitsheader (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`).
  Rate-Limiting ist aktuell nur auf `/api/admin-login` aktiv, nicht jedoch auf `/api/upload` oder Standard-Logins.
- **Lösungsvorschlag:**
  - `helmet` Middleware einbinden.
  - Globales Rate-Limiting für API-Endpunkte und Datei-Uploads konfigurieren.

---

### Task CLEAN-01: Server-seitige Legacy-Gmail-Reste isolieren / aufräumen
- **Priorität:** `P2 (Mittel)`
- **Kategorie:** Code-Hygiene & Bereinigung
- **Betroffene Dateien:** [`app/gmailApi.js`](file:///c:/WSL/adobe_cloud_downloader/app/gmailApi.js), [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js)
- **Aktueller Zustand:**
  Da der Gmail-Scanner jetzt vollständig client-seitig (Zero-Trust via LocalStorage) läuft, werden die Server-Routen `/api/gmail/inbox`, `/api/gmail/process`, `/api/gmail/skip` und `app/gmailApi.js` im Normalbetrieb nicht mehr benötigt.
- **Lösungsvorschlag:**
  - Nicht mehr genutzte Server-Gmail-Routen und -Dateien entweder als Legacy kennzeichnen oder entfernen, um Verwirrung und Angriffsfläche zu minimieren.

---

### Task AI-01: Ollama Timeout-Handling mit `AbortController` & Exponential Backoff
- **Priorität:** `P2 (Mittel)`
- **Kategorie:** KI / Robustheit
- **Betroffene Dateien:** [`app/aiAgent.js`](file:///c:/WSL/adobe_cloud_downloader/app/aiAgent.js)
- **Aktueller Zustand:**
  `fetch` zu Ollama wartet ohne Timeout. Wenn Ollama hängt oder überlastet ist, blockiert die Anfrage unbegrenzt.
- **Lösungsvorschlag:**
  - Timeout per `AbortSignal.timeout(90000)` (90 Sekunden) hinzufügen.
  - Bei temporären 503/429 Fehlern 1-2 automatische Wiederholungsversuche mit kurzem Backoff einbauen.

---

### Task TEST-01: Automatisierte Test-Suite aufbauen
- **Priorität:** `P3 (Niedrig)`
- **Kategorie:** Qualitätssicherung
- **Betroffene Dateien:** `test/`, `package.json`
- **Aktueller Zustand:**
  Es gibt aktuell keine automatisierten Unit- oder E2E-Tests in CI/CD.
- **Lösungsvorschlag:**
  - Einrichten von Vitest / Jest für Unit-Tests (Datum-Validierung, KI-JSON-Parsing, Dateinamen-Sanitization, Butler-Mapping).
  - Integrationstests für API-Routen (`/api/upload`, `/api/jobs/:id/hide`, `/api/auth/client-id`).

---

### Task DOC-01: API-Dokumentation & `.env.example`
- **Priorität:** `P3 (Niedrig)`
- **Kategorie:** Dokumentation
- **Betroffene Dateien:** `readme.md`, `.env.example`
- **Aktueller Zustand:**
  Dokumentation der Umgebungsvariablen und API-Endpunkte ist teilweise über verschiedene Dateien verstreut.
- **Lösungsvorschlag:**
  - Erstellen einer vollständigen `.env.example` mit allen Konfigurationsparametern und Hinweisen zum Datenschutz (Gmail Tokens im Browser vs. Google Drive auf dem Server).
