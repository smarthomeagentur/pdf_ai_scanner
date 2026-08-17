const fs = require("fs");
const path = require("path");

class ClickUpAPI {
  constructor(apiKey, defaultListId = "901510878865", defaultCompanyFieldId = "f20f5692-fcce-4f62-9c63-1521d68f33f4") {
    this.apiKey = apiKey ? apiKey.trim() : "";
    this.defaultListId = defaultListId ? defaultListId.trim() : "901510878865";
    this.defaultCompanyFieldId = defaultCompanyFieldId ? defaultCompanyFieldId.trim() : "f20f5692-fcce-4f62-9c63-1521d68f33f4";
    this.baseUrl = "https://api.clickup.com/api/v2";
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey ? apiKey.trim() : "";
  }

  setListId(listId) {
    this.defaultListId = listId ? listId.trim() : "901510878865";
  }

  getHeaders(contentType = "application/json") {
    const headers = {
      Authorization: this.apiKey,
    };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    return headers;
  }

  /**
   * Verify token & list accessibility
   */
  async verifyConnection(listId = this.defaultListId) {
    if (!this.apiKey) {
      return { success: false, error: "Kein ClickUp API-Key hinterlegt." };
    }
    try {
      const res = await fetch(`${this.baseUrl}/list/${listId}`, {
        method: "GET",
        headers: this.getHeaders(),
      });
      if (!res.ok) {
        const errText = await res.text();
        return { success: false, status: res.status, error: `ClickUp Fehler (${res.status}): ${errText}` };
      }
      const data = await res.json();
      return {
        success: true,
        listName: data.name,
        spaceName: data.space?.name,
        folderName: data.folder?.name,
        statuses: data.statuses,
      };
    } catch (err) {
      return { success: false, error: err.message || "Netzwerkfehler bei ClickUp-Prüfung." };
    }
  }

  /**
   * Fetch all tasks from a list (with pagination)
   */
  async fetchListTasks(listId = this.defaultListId) {
    if (!this.apiKey) return [];
    let page = 0;
    const allTasks = [];

    while (true) {
      try {
        const res = await fetch(`${this.baseUrl}/list/${listId}/task?include_closed=true&page=${page}`, {
          headers: this.getHeaders(),
        });
        if (!res.ok) break;
        const data = await res.json();
        if (!data.tasks || data.tasks.length === 0) break;
        allTasks.push(...data.tasks);
        if (data.last_page) break;
        page++;
        // Safety cap to avoid infinite loops
        if (page > 50) break;
      } catch (err) {
        console.error("[CLICKUP] Fehler beim Abrufen der Tasks:", err);
        break;
      }
    }

    return allTasks;
  }

  /**
   * Format amount into EUR
   */
  formatAmount(amountInCents) {
    if (!amountInCents || amountInCents <= 0) return "";
    return (amountInCents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  /**
   * Convert DD.MM.YYYY or similar to Unix epoch milliseconds
   */
  parseDocumentDateToMs(dateStr) {
    if (!dateStr || dateStr === "unknown") return null;
    const match = dateStr.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
    if (!match) return null;
    let day = parseInt(match[1], 10);
    let month = parseInt(match[2], 10) - 1;
    let year = parseInt(match[3], 10);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return isNaN(date.getTime()) ? null : date.getTime();
  }

  /**
   * Build Rich Markdown Description & Metadata
   */
  generateMarkdownDescription(aiResult, fileName, driveLink = "") {
    const company = aiResult.company || "Unbekannt";
    const category = aiResult.category || "Dokument";
    const docDate = aiResult.documentDate && aiResult.documentDate !== "unknown" ? aiResult.documentDate : "-";
    const tagsArr = Array.isArray(aiResult.tags) ? aiResult.tags.filter((t) => t && t !== "none") : [];
    const tagsList = tagsArr.length > 0 ? tagsArr.join(", ") : "-";

    const isInvoice = !!aiResult.isInvoice;
    const invoiceNum = aiResult.invoiceNumber && aiResult.invoiceNumber !== "none" ? aiResult.invoiceNumber : "-";
    const amountStr = this.formatAmount(aiResult.invoiceAmmount);

    const hashtags = [
      category ? `#${category.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "")}` : "",
      company && company !== "Unbekannt" ? `#${company.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "")}` : "",
      ...tagsArr.map((t) => `#${t.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "")}`),
    ]
      .filter((h) => h.length > 1)
      .join(" ");

    let md = `## 📄 Dokumenten-Informationen\n\n`;
    md += `| Eigenschaft | Wert |\n`;
    md += `| :--- | :--- |\n`;
    md += `| 🏢 **Firma / Empfänger** | **${company}** |\n`;
    md += `| 📁 **Kategorie** | \`${category}\` |\n`;
    md += `| 📅 **Belegdatum** | ${docDate} |\n`;
    md += `| 🏷️ **Schlagworte** | ${tagsList} |\n`;

    if (isInvoice) {
      md += `| 🧾 **Rechnungsnummer** | \`${invoiceNum}\` |\n`;
      if (amountStr) {
        md += `| 💰 **Rechnungsbetrag** | **${amountStr}** |\n`;
      }
    }

    if (driveLink) {
      md += `| 🔗 **Google Drive** | [📁 In Google Drive öffnen](${driveLink}) |\n`;
    }

    if (fileName) {
      md += `| 📄 **Dateiname** | \`${fileName}\` |\n`;
    }

    md += `| ⏱️ **Verarbeitet am** | ${new Date().toLocaleString("de-DE")} |\n\n`;

    if (hashtags) {
      md += `---\n### 🔍 Suchbegriffe / Tags\n${hashtags}\n`;
    }

    return md;
  }

  /**
   * Generate optimal task name matching make.com blueprint format: `(Kategorie) Beschreibung`
   */
  generateTaskName(aiResult) {
    const category = aiResult.category || "Dokument";
    let desc = "";

    if (Array.isArray(aiResult.tags) && aiResult.tags.length > 0 && aiResult.tags[0] !== "none") {
      desc = aiResult.tags.slice(0, 3).join(" ");
    } else if (aiResult.full) {
      // Fallback: extract description from formatted filename
      const match = aiResult.full.match(/-\s*([^()-]+(?:\s[^()-]+)*)\s*\(/);
      if (match) desc = match[1].trim();
    }

    if (!desc) desc = "Dokument";
    return `(${category}) ${desc}`;
  }

  /**
   * Create task in ClickUp list
   */
  async createTask(listId, payload) {
    const res = await fetch(`${this.baseUrl}/list/${listId}/task`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ClickUp Task-Erstellung fehlgeschlagen (${res.status}): ${err}`);
    }

    return await res.json();
  }

  /**
   * Update existing task in ClickUp
   */
  async updateTask(taskId, payload) {
    const res = await fetch(`${this.baseUrl}/task/${taskId}`, {
      method: "PUT",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ClickUp Task-Aktualisierung fehlgeschlagen (${res.status}): ${err}`);
    }

    return await res.json();
  }

  /**
   * Set custom field on task
   */
  async setCustomField(taskId, fieldId, value) {
    if (!fieldId || value === undefined || value === null) return;
    try {
      const res = await fetch(`${this.baseUrl}/task/${taskId}/field/${fieldId}`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ value }),
      });
      return res.ok;
    } catch (e) {
      console.error(`[CLICKUP] Fehler beim Setzen des Custom Fields ${fieldId}:`, e);
      return false;
    }
  }

  /**
   * Add tag to task
   */
  async addTag(taskId, tagName) {
    if (!tagName) return;
    const cleanTag = encodeURIComponent(tagName.trim());
    try {
      const res = await fetch(`${this.baseUrl}/task/${taskId}/tag/${cleanTag}`, {
        method: "POST",
        headers: this.getHeaders(),
      });
      return res.ok;
    } catch (e) {
      console.error(`[CLICKUP] Fehler beim Hinzufügen des Tags ${tagName}:`, e);
      return false;
    }
  }

  /**
   * Upload PDF attachment to task
   */
  async uploadAttachment(taskId, fileBuffer, fileName) {
    if (!fileBuffer || !taskId) return null;
    try {
      const safeName = (fileName || "Dokument.pdf").replace(/[/\\?%*:|"<>]/g, "-");
      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: "application/pdf" });
      formData.append("attachment", blob, safeName);

      const res = await fetch(`${this.baseUrl}/task/${taskId}/attachment`, {
        method: "POST",
        headers: {
          Authorization: this.apiKey,
        },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[CLICKUP] Fehler beim Upload des Anhangs (${res.status}):`, err);
        return null;
      }

      return await res.json();
    } catch (err) {
      console.error("[CLICKUP] Fehler beim Hochladen des Anhangs:", err);
      return null;
    }
  }

  /**
   * Check if a job/document matches an existing task
   */
  findMatchingTask(job, clickupTasks = []) {
    if (!clickupTasks || clickupTasks.length === 0) return null;

    // 1. Direct match by stored ClickUp Task ID
    if (job.clickup && job.clickup.taskId) {
      const directMatch = clickupTasks.find((t) => t.id === job.clickup.taskId);
      if (directMatch) return directMatch;
    }

    const aiResult = job.result || {};
    const fullFileName = (aiResult.full || job.originalName || "").toLowerCase().trim();
    const cleanFull = fullFileName.replace(/\.pdf$/i, "").trim();

    // Expected task name
    const expectedTaskName = this.generateTaskName(aiResult).toLowerCase().trim();

    for (const task of clickupTasks) {
      const taskName = (task.name || "").toLowerCase().trim();

      // 2. Exact or very close task name match
      if (taskName === expectedTaskName && expectedTaskName.length > 5) {
        return task;
      }

      // 3. Match by Google Drive Web View Link or ID in task description
      if (aiResult.webViewLink && task.description && task.description.includes(aiResult.webViewLink)) {
        return task;
      }
      if (job.rawDriveId && task.description && task.description.includes(job.rawDriveId)) {
        return task;
      }

      // 4. Match by attachment title in ClickUp task
      if (task.attachments && Array.isArray(task.attachments)) {
        const hasMatchingAttachment = task.attachments.some((att) => {
          const attName = (att.title || att.name || "").toLowerCase().trim().replace(/\.pdf$/i, "");
          return attName === cleanFull || (cleanFull.length > 8 && attName.includes(cleanFull));
        });
        if (hasMatchingAttachment) return task;
      }
    }

    return null;
  }

  /**
   * High-level method: Create or update document task in ClickUp
   */
  async createOrUpdateDocumentTask({
    fileBuffer,
    fileName,
    aiResult = {},
    driveFile = null,
    existingTaskId = null,
    listId = this.defaultListId,
    uploadAttachment = true,
  }) {
    if (!this.apiKey) {
      throw new Error("Kein ClickUp API-Key hinterlegt.");
    }

    const driveLink = driveFile?.webViewLink || aiResult.webViewLink || "";
    const taskName = this.generateTaskName(aiResult);
    const markdownDesc = this.generateMarkdownDescription(aiResult, fileName, driveLink);
    const taskStatus = aiResult.isInvoice ? "rechnung" : "offen";
    const dueDate = this.parseDocumentDateToMs(aiResult.documentDate);

    // Tags to apply
    const tagsToApply = [];
    if (aiResult.category && aiResult.category !== "unknown") tagsToApply.push(aiResult.category);
    if (Array.isArray(aiResult.tags)) {
      aiResult.tags.forEach((t) => {
        if (t && t !== "none" && !tagsToApply.includes(t)) tagsToApply.push(t);
      });
    }
    if (aiResult.company && aiResult.company !== "Unbekannt" && !tagsToApply.includes(aiResult.company)) {
      tagsToApply.push(aiResult.company);
    }

    let task = null;
    let isUpdated = false;

    if (existingTaskId) {
      // UPDATE existing task
      const updatePayload = {
        name: taskName,
        markdown_description: markdownDesc,
        status: taskStatus,
      };
      if (dueDate) updatePayload.due_date = dueDate;

      task = await this.updateTask(existingTaskId, updatePayload);
      isUpdated = true;
    } else {
      // CREATE new task
      const createPayload = {
        name: taskName,
        markdown_description: markdownDesc,
        status: taskStatus,
        notify_all: false,
        tags: tagsToApply,
        custom_fields: [],
      };
      if (dueDate) createPayload.due_date = dueDate;

      if (aiResult.company && this.defaultCompanyFieldId) {
        createPayload.custom_fields.push({
          id: this.defaultCompanyFieldId,
          value: aiResult.company,
        });
      }

      task = await this.createTask(listId, createPayload);
      isUpdated = false;
    }

    const taskId = task.id || existingTaskId;

    // Set Custom Field "Firma" if updated
    if (aiResult.company && this.defaultCompanyFieldId && isUpdated) {
      await this.setCustomField(taskId, this.defaultCompanyFieldId, aiResult.company);
    }

    // Add tags if updated
    if (isUpdated && tagsToApply.length > 0) {
      for (const tag of tagsToApply) {
        await this.addTag(taskId, tag);
      }
    }

    // Upload attachment if buffer provided
    let attachmentData = null;
    if (uploadAttachment && fileBuffer && taskId) {
      attachmentData = await this.uploadAttachment(taskId, fileBuffer, fileName || "Dokument.pdf");
    }

    const taskUrl = task.url || `https://app.clickup.com/t/${taskId}`;

    return {
      success: true,
      taskId: taskId,
      taskUrl: taskUrl,
      taskName: taskName,
      status: taskStatus,
      isUpdated: isUpdated,
      attachment: attachmentData,
    };
  }
}

module.exports = ClickUpAPI;
