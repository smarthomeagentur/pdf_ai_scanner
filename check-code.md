# Codebase Audit & Improvement Plan (check-code.md)

Dieses Dokument enthält eine umfassende Code-Review und Architekturanalyse des Projekts **Adobe Cloud Downloader / Document Pipeline** (`adobe_cloud_downloader`). Es identifiziert Schwachstellen, Sicherheitsrisiken, Performance-Engpässe und strukturelle Optimierungspotenziale und ordnet diese in einer priorisierten Aufgabenliste mit detaillierten Lösungsvorschlägen ein.

---

## 1. Priorisierte Task-Übersicht

| Priorität | ID | Kategorie | Aufgabe | Betroffene Dateien | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **P0 (Kritisch)** | **SEC-01** | Sicherheit | Hardcodierte Standard-Passwörter & JWT-Secrets entfernen | [`src/config/secrets.js`](file:///c:/WSL/adobe_cloud_downloader/src/config/secrets.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-02** | Sicherheit | XSS-Prävention im Frontend (HTML-Escaping bei dynamischem Rendering) | [`public/js/utils.js`](file:///c:/WSL/adobe_cloud_downloader/public/js/utils.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-03** | Sicherheit | Path-Traversal-Schutz bei Datei-Downloads & Previews | [`src/middleware/security.js`](file:///c:/WSL/adobe_cloud_downloader/src/middleware/security.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-05** | Datenschutz / Zero-Trust | Client-Only Secrets (Lexoffice, BuchhaltungsButler, ClickUp) im Browser `localStorage` | [`public/js/state.js`](file:///c:/WSL/adobe_cloud_downloader/public/js/state.js), [`src/config/settings.js`](file:///c:/WSL/adobe_cloud_downloader/src/config/settings.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-06** | Datenschutz / Drive Scope | Restriktiver Google Drive Scope `drive.file` + Google Drive Picker Dialog | [`app/driveApi.js`](file:///c:/WSL/adobe_cloud_downloader/app/driveApi.js), [`public/js/drivePicker.js`](file:///c:/WSL/adobe_cloud_downloader/public/js/drivePicker.js) | ✅ **Erledigt** |
| **P0 (Kritisch)** | **SEC-07** | Datenschutz / Mail Zero-Trust | Gmail-Tokens clientseitig isoliert (`localStorage`), Server restlos bereinigt | [`public/js/gmailScanner.js`](file:///c:/WSL/adobe_cloud_downloader/public/js/gmailScanner.js), [`src/routes/inboxRoutes.js`](file:///c:/WSL/adobe_cloud_downloader/src/routes/inboxRoutes.js) | ✅ **Erledigt** |
| **P1 (Hoch)** | **ARCH-01** | Architektur | Modularisierung von `index.js` (Backend-Monolith in Services/Routes aufteilen) | [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js), `src/` | ✅ **Erledigt** |
| **P1 (Hoch)** | **ARCH-02** | Architektur | Modularisierung von `public/index.js` (Frontend in native ES-Module aufgeteilt) | `public/js/`, [`public/index.html`](file:///c:/WSL/adobe_cloud_downloader/public/index.html) | ✅ **Erledigt** |
| **P2 (Mittel)** | **CLEAN-01** | Bereinigung | Server-seitige Legacy-Gmail-Reste isolieren / aufräumen | [`app/gmailApi.js`](file:///c:/WSL/adobe_cloud_downloader/app/gmailApi.js), `src/` | ✅ **Erledigt** |
| **P1 (Hoch)** | **PERF-01** | Datenhaltung | Jobs-Speicherung auf SQLite (`better-sqlite3`) & Auto-Migration | [`src/db/database.js`](file:///c:/WSL/adobe_cloud_downloader/src/db/database.js), [`src/services/jobQueueService.js`](file:///c:/WSL/adobe_cloud_downloader/src/services/jobQueueService.js) | ✅ **Erledigt** |
| **P1 (Hoch)** | **STAB-01** | Stabilität | Subprocess-Timeouts & Zombie-Process-Handling (Python/Ghostscript/Exiftool) | [`src/services/fileRenderService.js`](file:///c:/WSL/adobe_cloud_downloader/src/services/fileRenderService.js), [`src/routes/scannerRoutes.js`](file:///c:/WSL/adobe_cloud_downloader/src/routes/scannerRoutes.js) | ✅ **Erledigt** |
| **P2 (Mittel)** | **SEC-04** | Sicherheit | HTTP-Security-Header via `helmet` & globales Rate-Limiting | [`src/server.js`](file:///c:/WSL/adobe_cloud_downloader/src/server.js), `package.json` | ✅ **Erledigt** |
| **P2 (Mittel)** | **AI-01** | KI / Robustheit | Ollama Timeout-Handling (6-Min-Timeout) & Exponential Backoff Retry | [`src/services/aiService.js`](file:///c:/WSL/adobe_cloud_downloader/src/services/aiService.js) | ✅ **Erledigt** |
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

### Task ARCH-01: Backend-Modularisierung (`index.js` aufgeteilt)
- **Priorität:** `P1 (Hoch)`
- **Kategorie:** Architektur & Wartbarkeit
- **Betroffene Dateien:** [`index.js`](file:///c:/WSL/adobe_cloud_downloader/index.js), `src/`
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  `index.js` wurde vollständig entflochten (< 100 Zeilen Bootstrap-Code). Die Logik ist sauber unterteilt:
  - `src/config/`: `paths.js`, `secrets.js`, `settings.js`
  - `src/middleware/`: `auth.js`, `security.js`, `rateLimiters.js`, `upload.js`
  - `src/services/`: `driveService.js`, `jobQueueService.js`, `deepSearchService.js`, `duplicateService.js`, `accountingService.js`, `clickupService.js`, `backupService.js`, `inboxService.js`, `fileRenderService.js`
  - `src/routes/`: `authRoutes.js`, `settingsRoutes.js`, `driveRoutes.js`, `jobRoutes.js`, `searchRoutes.js`, `accountingRoutes.js`, `clickupRoutes.js`, `inboxRoutes.js`, `adminRoutes.js`, `scannerRoutes.js`
  - `src/server.js`: Express-App Initialisierung und Middleware-Setup.

---

### Task ARCH-02: Frontend-Modularisierung (`public/js/` native ES-Module)
- **Priorität:** `P1 (Hoch)`
- **Kategorie:** Architektur & Frontend
- **Betroffene Dateien:** `public/js/`, [`public/index.html`](file:///c:/WSL/adobe_cloud_downloader/public/index.html)
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  Das Frontend nutzt native ES-Module (`<script type="module" src="/js/app.js">`):
  - `public/js/utils.js`: XSS-Escaping, Formatierungshelfer, Toasts, Debounce
  - `public/js/state.js`: LocalStorage Zero-Trust Secrets & Status-Manager
  - `public/js/api.js`: REST-Client mit Secret-Injection
  - `public/js/drivePicker.js`: Google Drive Picker Integration
  - `public/js/jobs.js`: Beleg-Raster, Filterung, Aktionen & Detailansicht
  - `public/js/deepSearch.js`: Live-Volltext- & Metadatensuche
  - `public/js/accounting.js`: Lexoffice & BuchhaltungsButler Modal & Sync
  - `public/js/clickup.js`: ClickUp Tasks & Sync
  - `public/js/driveSync.js`: Google Drive Import & Synchronisation
  - `public/js/gmailScanner.js`: Client-Side GIS Scanner & Posteingang-Tab
  - `public/js/settings.js`: Einstellungs-Dialog
  - `public/js/app.js`: Einstiegspunkt & Bootstrapping

---

### Task CLEAN-01: Server-seitige Legacy-Gmail-Reste bereinigt
- **Priorität:** `P2 (Mittel)`
- **Kategorie:** Bereinigung & Hygiene
- **Betroffene Dateien:** [`app/gmailApi.js`](file:///c:/WSL/adobe_cloud_downloader/app/gmailApi.js), `src/`
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  Nicht mehr genutzte Server-Routen (`/api/gmail/*`) wurden restlos entfernt. Die Datei `app/gmailApi.js` wurde als Legacy-Stub markiert. Alle Gmail-Vorgänge laufen zu 100 % im Client.

---

### Task PERF-01: Jobs-Speicherung auf SQLite migrieren
- **Priorität:** `P1 (Hoch)`
- **Kategorie:** Performance & Datenkonsistenz
- **Betroffene Dateien:** [`src/db/database.js`](file:///c:/WSL/adobe_cloud_downloader/src/db/database.js), [`src/services/jobQueueService.js`](file:///c:/WSL/adobe_cloud_downloader/src/services/jobQueueService.js), `store/database.sqlite`
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  Migration auf `better-sqlite3` mit WAL-Modus (`store/database.sqlite`) und indizierten Tabellen `jobs` und `app_state`. Vollautomatische, transaktionale Datenübernahme aus `jobs.json` mit automatischem Backup (`jobs.json.bak`). Die Service-API in `jobQueueService.js` bleibt zu 100 % rückwärtskompatibel.

---

### Task STAB-01: Subprocess-Timeouts & Zombie-Process-Handling
- **Priorität:** `P1 (Hoch)`
- **Kategorie:** Stabilität & Ressourcen
- **Betroffene Dateien:** [`src/services/fileRenderService.js`](file:///c:/WSL/adobe_cloud_downloader/src/services/fileRenderService.js), [`src/services/aiService.js`](file:///c:/WSL/adobe_cloud_downloader/src/services/aiService.js), [`src/routes/scannerRoutes.js`](file:///c:/WSL/adobe_cloud_downloader/src/routes/scannerRoutes.js), [`src/routes/accountingRoutes.js`](file:///c:/WSL/adobe_cloud_downloader/src/routes/accountingRoutes.js)
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  Alle `execFile`-Aufrufe (Ghostscript, pdftoppm, PyMuPDF, `scanner.py`, `compress_pdf.py`, `ocrmypdf`) sind mit harten Timeouts (30–60s) und `killSignal: 'SIGKILL'` abgesichert. Temporäre Zwischendateien (`tmp_*.pdf`, Bildausschnitte) werden in `try ... finally`-Blöcken restlos gelöscht.

---

### Task SEC-04: HTTP-Security-Header via `helmet` & globales Rate-Limiting
- **Priorität:** `P2 (Mittel)`
- **Kategorie:** Sicherheit
- **Betroffene Dateien:** [`src/server.js`](file:///c:/WSL/adobe_cloud_downloader/src/server.js), `package.json`
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  `helmet` ist in `src/server.js` eingebunden. Die Content-Security-Policy (CSP) erlaubt Google GSI, Google Drive Picker, Bootstrap CDN und ONNX WASM. `crossOriginOpenerPolicy` ist auf `same-origin-allow-popups` konfiguriert für reibungslose Google-Logins. Upload- und Scan-Endpunkte sind per `uploadLimiter` abgesichert.

---

### Task AI-01: Ollama Timeout-Handling & Exponential Backoff
- **Priorität:** `P2 (Mittel)`
- **Kategorie:** KI / Robustheit
- **Betroffene Dateien:** [`src/services/aiService.js`](file:///c:/WSL/adobe_cloud_downloader/src/services/aiService.js)
- **Status:** ✅ **Erledigt**
- **Umsetzung:**
  `customFetch` nutzt einen konfigurierbaren 6-Minuten-Timeout (`AI_TIMEOUT_MS = 360000`) per `AbortController` (geeignet für rechenintensive Modell-Inferenzen) mit automatischem Retry und Exponential Backoff (1s, 2s) bei temporären 503/429/Verbindungsfehlern.

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
