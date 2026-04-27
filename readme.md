# Smart Cloud Scanner

Eine leistungsstarke, webbasierte PWA-Scanner-Anwendung, die es Benutzern ermöglicht, Dokumente via Kamera zu erfassen, automatisch zuzuschneiden und mit KI-Unterstützung zu verarbeiten. Die Lösung nutzt Google Drive als primären Speicherort und ermöglicht eine nahtlose und passwortgeschützte Benutzung.

## ✨ Funktionen & Feature-Übersicht

- **Live-Kantenerkennung & Auto-Capture:** Nutzt OpenCV.js im Browser, um A4-Dokumente in Echtzeit zu erkennen, automatisch zu fokussieren und bei Stabilität selbstständig Aufnahmen zu triggern.
- **Progressive Web App (PWA):** Kann als native App auf Smartphones (iOS/Android) installiert werden und bietet Full-Screen-Bedienung.
- **KI-gestützte Weiterverarbeitung:** (Z.B. via Ollama) für automatische Benennungen, OCR oder inhaltliche Beschlagwortung direkt auf dem Host-System.
- **Sicherer Zugriff (JWT):** Die App lässt sich mit einem Master-Passwort absichern. Login-Sessions werden über JSON Web Tokens verwaltet.
- **Google Drive Integration:** Gescannte und verarbeitete Dokumente / PDFs werden direkt im verknüpften Google Drive-Konto hochgeladen.

## 🛠 Verwendete Technologien

- **Frontend:** HTML5, CSS3 (Bootstrap 5), JavaScript (OpenCV.js für Bildverarbeitung).
- **Backend:** Node.js, Express.js.
- **PDF & Bildverarbeitung:** `pdf-lib`, `pdf-parse`, `pdf2pic`, `multer`.
- **Authentifizierung:** `jsonwebtoken`, `cookie-parser`.
- **Cloud Storage:** `googleapis` (für Google Drive API).
- **AI / LLM:** `ollama` (lokale KI-Schnittstelle).

---

## ⚙️ Umgebungsvariablen (Environment Variables)

Vor dem Start muss eine `.env`-Datei im Root-Verzeichnis erstellt werden. Folgende Variablen steuern das Verhalten der Anwendung:

| Variable | Beschreibung |
| :--- | :--- |
| `AUTH_ENABLED` | Schaltet den Passwortschutz ein (`true`) oder aus (`false`). Standardmäßig empfohlen: `true`. |
| `APP_PASSWORD` | Das Master-Passwort, mit dem sich Nutzer auf der Webseite einloggen müssen. |
| `JWT_SECRET` | Ein sicherer, zufälliger String (z.B. ein langer Hash), der genutzt wird, um die Login-Tokens digital zu signieren. Verhindert Manipulation der Sessions. |
| `LOCAL_AI_HOST` | Die URL zur lokalen KI-Instanz (z. B. Ollama-Server). Beispiel: `http://localhost:11434`. Hierüber kommuniziert das Backend zur KI-Auswertung der Scans. |

---

## 🤖 Lokale KI mit Ollama konfigurieren

Die App übermittelt die gescannten Dokumente an ein lokales KI-Modell, welches in der Standardkonfiguration **Gemma (2B Parameter)** oder ähnliche kleine Modelle wie `gemma:2b` / `gemma2:2b` verwendet.

### Eingesetztes KI-Modell
Wir verwenden hierbei leichtgewichtige Modelle (wie z.B. Gemma 2B), da diese **schnell in der Textverarbeitung** sind, **weniger Halluzinationen** bei reiner Datenextraktion aufweisen und den Server nicht überlasten. Der Zweck des Modells besteht darin, das rohe OCR-Gekritzel des Scans zu analysieren und ein sauberes JSON mit Kategorien, Dokumenten-Typ (Rechnung etc.) und automatischen Dateinamen zu generieren.

### Ressourcen-Verbrauch
- **RAM / VRAM**: Für Modelle der 2B-bis-4B-Klasse werden in der Regel nur **ca. 6 GB Arbeitsspeicher** (idealerweise VRAM auf einer GPU) benötigt.
- **CPU**: Falls keine kompatible Grafikkarte vorhanden ist, laufen diese Modelle auch sehr passabel auf modernen CPUs (brauchen dann meist 1-4 Sekunden für eine Antwort).

### Ollama im Netzwerk erreichbar machen
Standardmäßig lauscht Ollama nur auf `localhost` (127.0.0.1). Wenn deine App im Docker/Coolify-Container auf einem Server läuft, aber Ollama auf deinem Heim-PC oder einem anderen Host betrieben wird, musst du Ollama anweisen, netzwerkweit Verbindungen anzunehmen:

1. **Unter Linux / bei Systemd-Diensten:**
   Ergänze in der Service-Datei (`systemctl edit ollama.service`) im Block `[Service]` die Umgebungsvariable:
   `Environment="OLLAMA_HOST=0.0.0.0"`
   Danach `systemctl daemon-reload` und `systemctl restart ollama`.
2. **Unter Windows:**
   Öffne die Systemumgebungsvariablen und lege eine neue Variable `OLLAMA_HOST` mit dem Wert `0.0.0.0` an. Danach Ollama (und das Terminal) neu starten.
3. **Bei Docker-Containern (Ollama):**
   Mappe einfach den Port: `-p 11434:11434` (Ollama lauscht im Docker-Image standardmäßig schon auf allen Interfaces).

*Hinweis:* Achte darauf, dass Port 11434 in deiner Firewall freigegeben ist, wenn die beiden Systeme nicht im selben lokalen Netz liegen.

---

## ☁️ Google API Key erstellen und einbinden

Damit die App Dokumente auf Google Drive hochladen kann, benötigst du eigene Zugangsdaten.

**Schritt-für-Schritt-Anleitung:**
1. Gehe zur [Google Cloud Console](https://console.cloud.google.com/).
2. Erstelle ein neues Projekt.
3. Gehe zu **APIs & Dienste** > **Bibliothek** und suche nach **Google Drive API**. Klicke auf **Aktivieren**.
4. Navigiere zu **APIs & Dienste** > **OAuth-Zustimmungsbildschirm** und konfiguriere ihn (Nutzerart "Extern" o. "Intern", App-Name vergeben, Testnutzer hinzufügen, falls Status "Testing").
5. Gehe zu **Anmeldedaten** > **Anmeldedaten erstellen** > **OAuth-Client-ID**.
6. Wähle als Anwendungstyp **Webanwendung** oder **Desktop-App** (je nach genauer Auth-Implementierung im Backend, in der Regel wird Desktop für den initialen Token-Generierungs-Flow genutzt).
7. Lade die Datei herunter und benenne sie in `gdrive_secret.json` um. Lege sie ins Root-Verzeichnis des Projekts.
8. Beim **allersten Start** der App wird ein Login-Flow ausgelöst (oft im Terminal per Link). Nach der Bestätigung wird eine `token.json` generiert, mit der das Backend fortan autonom Dokumente hochladen kann. *Diese Datei sicher aufbewahren!*

---

## 🚀 Installation & lokaler Start

1. Repository klonen oder herunterladen.
2. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
3. Umgebungsvariablen (`.env`), `gdrive_secret.json` und `token.json` (falls bereits vorhanden) im Hauptverzeichnis ablegen.
4. Server starten:
   ```bash
   npm start
   ```
   *(Für Development: `npm run debug`)*
5. Die App ist nun unter `http://localhost:3000` (oder dem in der App konfigurierten Port) erreichbar.

---

## 🐳 Deployment mit Coolify

Dank des vorhandenen `Dockerfile` lässt sich die Anwendung spielend leicht mit [Coolify](https://coolify.io/) hosten.

1. **Service in Coolify erstellen:**
   - Verbinde dein GitHub/GitLab-Repository oder wähle "Public Repository" in Coolify.
   - Wähle als Build Pack **Docker** oder **Nixpacks** (Docker wird empfohlen, da das `Dockerfile` bereitliegt).
2. **Environment Variables setzen:**
   - Gehe im Coolify-Dashboard auf den Tab **Environment Variables** für diesen Service.
   - Trage dort `AUTH_ENABLED`, `APP_PASSWORD`, `JWT_SECRET` und `LOCAL_AI_HOST` ein (für `LOCAL_AI_HOST` verwende die interne oder externe IP deines Ollama/AI-Containers).
3. **Google Drive Credentials hinterlegen:**
   - Da `.json`-Dateien nicht ins Git-Repo gehören, kannst du die generierte `gdrive_secret.json` und `token.json` über das Tab **Volumes / Persistent Storage** bereitstellen oder die Secrets direkt mit `docker exec` / Shell in deinen Coolify-Container legen.
4. **Deploy:**
   - Klicke auf `Deploy`. Coolify baut das Image und veröffentlicht die Anwendung samt automatisch eingerichtetem SSL-Zertifikat.

---
