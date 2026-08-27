/**
 * Mock data fixtures for unit and integration testing.
 * Provides sample jobs, invoices, JWT payloads, and test configurations.
 */

const sampleJob1 = {
  id: "job-test-001",
  originalName: "Rechnung_Telekom_2026_01.pdf",
  status: "completed",
  source: "upload",
  isPrivate: false,
  filePath: "downloads/sample_telekom.pdf",
  uploadDate: "2026-01-15T10:00:00.000Z",
  result: {
    company: "Telekom Deutschland",
    category: "Rechnungen",
    invoiceNumber: "RE-2026-9912",
    invoiceAmmount: 4999, // in cents (49.99 EUR)
    documentDate: "15.01.2026",
    full: "2026-01-15 Telekom Deutschland RE-2026-9912",
  },
};

const sampleJobDuplicate = {
  id: "job-test-002",
  originalName: "Scan_Telekom_Kopie.pdf",
  status: "pending",
  source: "scanner",
  isPrivate: false,
  filePath: "downloads/sample_telekom_copy.pdf",
  uploadDate: "2026-01-16T14:30:00.000Z",
  result: {
    company: "Telekom Deutschland",
    category: "Rechnungen",
    invoiceNumber: "RE-2026-9912",
    invoiceAmmount: 4999,
    documentDate: "15.01.2026",
    full: "2026-01-15 Telekom Deutschland RE-2026-9912",
  },
};

const sampleJobPrivate = {
  id: "job-test-private",
  originalName: "Gehaltsabrechnung_Vertraulich.pdf",
  status: "completed",
  source: "upload",
  isPrivate: true,
  filePath: "downloads/gehalt.pdf",
  uploadDate: "2026-02-01T09:00:00.000Z",
  result: {
    company: "Musterfirma GmbH",
    category: "Personal",
    invoiceNumber: "-",
    invoiceAmmount: 0,
    documentDate: "01.02.2026",
    full: "2026-02-01 Personal Gehaltsabrechnung",
  },
};

module.exports = {
  sampleJob1,
  sampleJobDuplicate,
  sampleJobPrivate,
};
