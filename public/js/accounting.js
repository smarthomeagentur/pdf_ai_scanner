/**
 * Accounting Integration (Lexoffice & BuchhaltungsButler)
 */
import { escapeHtml, formatCurrency, formatDateDisplay, showToast } from "./utils.js";
import { apiRequest } from "./api.js";
import { getAllClientCredentials } from "./state.js";

export async function openAccountingModal(jobId, companyKey = null) {
  const modalEl = document.getElementById("accounting-modal");
  const modalBody = document.getElementById("accounting-modal-body");
  if (!modalEl || !modalBody) return;

  modalBody.innerHTML = `<div class="p-5 text-center"><span class="spinner-border spinner-border-sm me-2"></span>Prüfe Buchhaltungsstatus...</div>`;
  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();

  try {
    const creds = getAllClientCredentials();
    const data = await apiRequest("/api/accounting/check", {
      method: "POST",
      body: JSON.stringify({ jobId, companyKey, credentials: creds }),
    });

    renderAccountingView(modalBody, data, jobId);
  } catch (err) {
    modalBody.innerHTML = `<div class="p-4 alert alert-danger">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAccountingView(container, data, jobId) {
  const topMatch = data.topMatch;
  const isMatched = data.hasMatch;

  container.innerHTML = `
    <div class="p-3">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h6 class="fw-bold mb-0">Firma: ${escapeHtml(data.providerName)} (${escapeHtml(data.selectedCompany)})</h6>
        <span class="badge ${isMatched ? "bg-success" : "bg-warning text-dark"}">${isMatched ? "Beleg zugeordnet" : "Nicht synchronisiert"}</span>
      </div>

      <div class="card mb-3 p-3 bg-light border-0">
        <div class="row">
          <div class="col-6 small"><strong>Beleg:</strong> ${escapeHtml(data.documentDetails.title)}</div>
          <div class="col-6 small"><strong>Datum:</strong> ${escapeHtml(data.documentDetails.documentDate)}</div>
          <div class="col-6 small mt-2"><strong>Betrag:</strong> ${formatCurrency(data.documentDetails.invoiceAmmount)}</div>
          <div class="col-6 small mt-2"><strong>Rechnungs-Nr:</strong> ${escapeHtml(data.documentDetails.invoiceNumber)}</div>
        </div>
      </div>

      ${
        topMatch
          ? `
        <div class="alert alert-success d-flex justify-content-between align-items-center">
          <div>
            <strong>Gefundener Beleg in ${escapeHtml(data.providerName)}:</strong><br>
            Nr: ${escapeHtml(topMatch.voucherNumber)} | Betrag: ${formatCurrency(topMatch.totalAmount)} | Status: ${escapeHtml(topMatch.voucherStatus)}
          </div>
          <button class="btn btn-sm btn-outline-success" onclick="window.markSynced('${jobId}', '${data.selectedCompany}', '${topMatch.id}')">Zuordnen</button>
        </div>`
          : `<div class="alert alert-secondary">Kein identischer Beleg in ${escapeHtml(data.providerName)} gefunden.</div>`
      }

      <div class="d-flex justify-content-end gap-2 mt-4">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Schließen</button>
        <button class="btn btn-primary" onclick="window.transferToAccounting('${jobId}', '${data.selectedCompany}')">Jetzt zu ${escapeHtml(data.providerName)} übertragen</button>
      </div>
    </div>`;
}
