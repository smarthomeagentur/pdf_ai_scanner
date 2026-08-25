# Document Pipeline & Smart Cloud Scanner

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/database-SQLite%20(WASM)-blue.svg)](https://sql.js.org/)
[![Security](https://img.shields.io/badge/security-Zero--Trust%20Client--Side-orange.svg)]()
[![Docker](https://img.shields.io/badge/deployment-Docker%20%7C%20Coolify-2496ED.svg)](https://coolify.io/)

A modern, high-performance document capture, AI analysis, and multi-accounting pipeline. The application provides client-side edge detection, local AI metadata extraction (via Ollama), zero-trust third-party API integration, and automated accounting synchronization for **Lexoffice** and **BuchhaltungsButler**.

---

## Architecture Overview

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      Client-Side (Browser PWA)                         │
 │                                                                        │
 │  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
 │  │ Camera Edge Detection │  │ Google GIS &    │  │ LocalStorage     │  │
 │  │ (ONNX WebAssembly)    │  │ Drive Picker    │  │ Zero-Trust Keys  │  │
 │  └───────────┬───────────┘  └────────┬────────┘  └────────┬─────────┘  │
 └──────────────┼───────────────────────┼────────────────────┼────────────┘
                │                       │                    │
                ▼                       ▼                    ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      Node.js / Express Backend                         │
 │                                                                        │
 │  ┌────────────────────────┐  ┌──────────────────────────────────────┐  │
 │  │ Multi-Engine Renderer  │  │ Local AI Document Analysis           │  │
 │  │ (PyMuPDF, Poppler, GS) │  │ (Ollama LLM with 6-Min Timeout)      │  │
 │  └───────────┬────────────┘  └──────────────────┬───────────────────┘  │
 │              │                                  │                      │
 │              ▼                                  ▼                      │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │ SQLite WASM Embedded Database (database.sqlite, ACID, Zero-Lock) │  │
 │  └──────────────────────────────────────────────────────────────────┘  │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### 📷 Smart Document Scanner & Edge Detection
* **Real-time Corner Detection:** Uses client-side WebAssembly models (`doc_corner_net.onnx`) for real-time document boundary detection.
* **Auto-Cropping & Perspective Correction:** Automatically deskews and crops receipts and invoices.
* **Multi-Page Merging:** Scan multi-page documents directly from mobile devices and merge them into a single PDF.

### 🤖 Local AI Extraction & Metadata Pipeline
* **Ollama LLM Integration:** Automatically extracts company name, category, invoice number, gross amount, and document date.
* **Smart Duplication Scoring:** Multi-factor duplicate prevention comparing amounts, document dates, partner names, and invoice numbers.
* **ExifTool Metadata Embedding:** Automatically writes extracted metadata into PDF Exif headers for permanent offline indexing.

### 💼 Modular Accounting (Lexoffice & BuchhaltungsButler)
* **Unlimited Tenant Accounts:** Connect any number of separate Lexoffice and BuchhaltungsButler accounts.
* **Live Connection Test:** Test credentials and connection status directly within the configuration modal.
* **1-Click Transfer:** Directly upload receipts and invoices to the target accounting provider with automatic duplicate checks.

### 🔒 Zero-Trust Privacy & Security Architecture
* **Client-Only Secrets:** Third-party credentials (Lexoffice API keys, BuchhaltungsButler secrets, ClickUp tokens, Gmail OAuth tokens) are stored **only in the user's browser `localStorage`**. No third-party keys are ever written to server configuration files.
* **Least-Privilege Drive Scope:** Uses `https://www.googleapis.com/auth/drive.file` and the Google Drive Picker dialog. The app only accesses files explicitly chosen by the user.
* **Brute-Force Protection:** Rate-limiting middleware (`express-rate-limit`) enforces a 60-second lockout after 5 incorrect login attempts.
* **HTTP Security Headers:** Protected by `helmet` with custom Content Security Policy (CSP) allowing Google GIS, Drive Picker, and WebAssembly execution.

### 💾 High-Performance SQLite Storage
* **WASM Embedded Database:** Powered by `sql.js` (WebAssembly-based SQLite) for platform independence, zero native compilation (`node-gyp`), and crash-proof deployments.
* **Indexed Queries:** Fast filtering by date, status, company, and category.
* **Atomic Transactions:** Prevents file corruption during unexpected server restarts.

---

## Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Vanilla ES Modules, Bootstrap 5, Material Symbols, Google Fonts |
| **Image & AI Processing** | ONNX Runtime Web (WASM), OpenCV.js, Tesseract.js |
| **Backend Runtime** | Node.js 20+ (Express 5) |
| **Database** | SQLite (via `sql.js` WASM engine) |
| **Document Processing** | Python 3 (PyMuPDF, OpenCV), Poppler (`pdftoppm`), Ghostscript (`gs`), ExifTool |
| **Authentication** | JSON Web Tokens (JWT), HTTP-Only Cookies, Client GIS OAuth 2.0 |
| **Deployment** | Docker (Debian Bookworm), Coolify |

---

## Getting Started

### Prerequisites
* **Node.js**: Version 20.0.0 or higher
* **Python**: Version 3.10+ (for backend PDF renderers)
* **System Utilities**: `poppler-utils`, `ghostscript`, `graphicsmagick`, `exiftool`
* **Ollama**: Running locally or reachable over the network (e.g. `http://localhost:11434`)

### Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/smarthomeagentur/adobe_cloud_downloader.git
   cd adobe_cloud_downloader
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Set up the Python virtual environment:**
   ```bash
   python3 -m venv venv
   # On Linux / macOS / WSL:
   source venv/bin/activate
   pip install opencv-python-headless numpy pytesseract pymupdf

   # On Windows (PowerShell):
   .\venv\Scripts\Activate.ps1
   pip install opencv-python-headless numpy pytesseract pymupdf
   ```

4. **Configure Environment Variables:**
   Copy the example environment file and customize your passwords:
   ```bash
   cp .env.example .env
   ```

5. **Start the application:**
   ```bash
   npm start
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deployment with Docker & Coolify

The repository includes an optimized `Dockerfile` tailored for containerized environments and [Coolify](https://coolify.io/).

### Persistent Storage Volumes
To persist your database, settings, and downloaded files across deployments, configure the following persistent volume mounts in Coolify:

| Container Path | Purpose |
| :--- | :--- |
| `/app/store` | SQLite database (`database.sqlite`), Google OAuth tokens |
| `/app/downloads` | Temporary and processed PDF documents |

### Coolify Configuration Notes
* **Port:** Set the application port to `3000`.
* **Reverse Proxy:** The server has `trust proxy` enabled out-of-the-box to work seamlessly with Traefik and Caddy.
* **Zero C++ Compilation:** Uses WebAssembly SQLite, eliminating segmentation faults across different Linux kernel and architecture configurations.

---

## Environment Configuration Reference

All server-side configuration is managed via environment variables in `.env`:

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | `number` | `3000` | Port for the HTTP server. |
| `AUTH_ENABLED` | `boolean` | `true` | Enables or disables the password gate. |
| `APP_PASSWORD` | `string` | - | Password required for standard user access. |
| `ADMIN_PASSWORD` | `string` | - | Password required for administrative settings and actions. |
| `JWT_SECRET` | `string` | - | Cryptographic secret for signing session cookies (min. 32 chars). |
| `LOCAL_AI_HOST` | `string` | `http://localhost:11434` | URL to the Ollama AI instance. |
| `LOCAL_AI_MODEL` | `string` | `gemma4:e2b` | Ollama model identifier for document processing. |
| `AI_TIMEOUT_MS` | `number` | `360000` | AI inference timeout in milliseconds (6 minutes). |
| `GOOGLE_CLIENT_ID` | `string` | - | Google OAuth Client ID for GIS authentication. |

---

## API Endpoints Reference

### Authentication & Config
* `POST /api/login` - Authenticate standard user session.
* `POST /api/admin-login` - Authenticate admin session.
* `GET /api/config` - Get public client configuration (Google Client ID, Auth status).

### Document Processing & Jobs
* `POST /api/upload` - Upload new PDF documents for processing.
* `POST /api/scan` - Process camera-scanned images into merged PDF.
* `POST /api/preview` - Generate image enhancement preview.
* `GET /api/jobs` - Retrieve all processed document jobs.
* `POST /api/jobs/:id/hide` - Hide document from active list.
* `POST /api/jobs/:id/unhide` - Restore hidden document.
* `GET /api/jobs/:id/file` - Download original document file.
* `GET /api/jobs/:id/thumb` - Retrieve document thumbnail image.

### Search & Google Drive
* `GET /api/search` - Live deep search across document metadata and OCR text.
* `GET /api/drive/sync-preview` - Preview files in Google Drive available for import.
* `POST /api/drive/sync-execute` - Trigger batch import of selected Drive documents.
* `POST /api/drive/import-file` - Import a single Google Drive file into the pipeline.

### Accounting Integration
* `POST /api/accounting/test-connection` - Test credentials for Lexoffice or BuchhaltungsButler.
* `POST /api/accounting/check` - Check for duplicate invoices in the selected accounting account.
* `POST /api/accounting/transfer` - Upload receipt/invoice to the selected accounting provider.

---

## License

ISC License. Copyright (c) 2026 smarthomeagentur.
