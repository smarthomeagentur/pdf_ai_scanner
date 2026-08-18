const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

class ClickUpAPI {
  constructor(
    apiKey = process.env.CLICKUP_API_KEY,
    defaultListId = process.env.CLICKUP_LIST_ID,
    customFields = {},
    statusInvoice = process.env.CLICKUP_STATUS_INVOICE,
    statusDefault = process.env.CLICKUP_STATUS_DEFAULT
  ) {
    this.apiKey = apiKey ? apiKey.trim() : (process.env.CLICKUP_API_KEY || "").trim();
    this.defaultListId = defaultListId ? defaultListId.trim() : (process.env.CLICKUP_LIST_ID || "").trim();
    
    // Support either a single company field id string (legacy) or an object with all custom fields
    const cfObj = typeof customFields === "string" ? { company: customFields } : (customFields || {});
    this.customFields = {
      company: cfObj.company || process.env.CLICKUP_CUSTOM_FIELD_COMPANY_ID || "f20f5692-fcce-4f62-9c63-1521d68f33f4",
      category: cfObj.category || process.env.CLICKUP_CUSTOM_FIELD_CATEGORY_ID || "c0284d2c-60bb-4493-85c1-3937312166cf",
      documentDate: cfObj.documentDate || process.env.CLICKUP_CUSTOM_FIELD_DATE_ID || "acb913e6-c01e-4a1b-a141-974172b44c05",
      tags: cfObj.tags || process.env.CLICKUP_CUSTOM_FIELD_TAGS_ID || "4c0fbada-c66b-4f72-b2de-f253c0cf30af",
      invoiceNumber: cfObj.invoiceNumber || process.env.CLICKUP_CUSTOM_FIELD_INVOICE_NUM_ID || "e9698a25-31c8-4347-a197-3b6d227acb7c",
      invoiceAmount: cfObj.invoiceAmount || process.env.CLICKUP_CUSTOM_FIELD_AMOUNT_ID || "60f538dd-f66f-4128-a983-ea915ec1fc58",
      driveLink: cfObj.driveLink || process.env.CLICKUP_CUSTOM_FIELD_DRIVE_LINK_ID || "1d7faae3-dc9b-46cd-b6ca-eda891869d64",
    };
    this.defaultCompanyFieldId = this.customFields.company;

    this.statusInvoice = statusInvoice ? statusInvoice.trim() : (process.env.CLICKUP_STATUS_INVOICE || "rechnung").trim();
    this.statusDefault = statusDefault ? statusDefault.trim() : (process.env.CLICKUP_STATUS_DEFAULT || "offen").trim();
    this.baseUrl = "https://api.clickup.com/api/v2";
  }

  setApiKey(apiKey) {
    this.apiKey = apiKey ? apiKey.trim() : (process.env.CLICKUP_API_KEY || "").trim();
  }

  setListId(listId) {
    this.defaultListId = listId ? listId.trim() : (process.env.CLICKUP_LIST_ID || "").trim();
  }

  setCompanyFieldId(fieldId) {
    this.customFields.company = fieldId ? fieldId.trim() : (process.env.CLICKUP_CUSTOM_FIELD_COMPANY_ID || "").trim();
    this.defaultCompanyFieldId = this.customFields.company;
  }

  setCustomFields(customFields = {}) {
    Object.assign(this.customFields, customFields);
    if (this.customFields.company) this.defaultCompanyFieldId = this.customFields.company;
  }

  setStatusInvoice(status) {
    this.statusInvoice = status ? status.trim() : (process.env.CLICKUP_STATUS_INVOICE || "rechnung").trim();
  }

  setStatusDefault(status) {
    this.statusDefault = status ? status.trim() : (process.env.CLICKUP_STATUS_DEFAULT || "offen").trim();
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
   * Check if a matching ClickUp task is already up-to-date with the job's AI data
   */
  isTaskUpToDate(job, matchingTask) {
    if (!job || !matchingTask) return false;

    // 1. If job was already transferred to this task and no new AI analysis ran since
    if (job.clickup && job.clickup.taskId === matchingTask.id && job.clickup.transferredAt) {
      if (job.aiPipelineCompletedAt) {
        const transferredTime = new Date(job.clickup.transferredAt).getTime();
        const enrichedTime = new Date(job.aiPipelineCompletedAt).getTime();
        if (transferredTime >= enrichedTime) {
          return true;
        }
      } else {
        return true;
      }
    }

    // 2. If task is already closed / done / bezahlt / erledigt
    const statusStr = (matchingTask.status?.status || "").toLowerCase();
    if (matchingTask.status?.type === "closed" || ["closed", "erledigt", "bezahlt", "done", "abgeschlossen"].includes(statusStr)) {
      return true;
    }

    const aiResult = job.result || {};

    // 3. Name check
    const expectedName = this.generateTaskName(aiResult).toLowerCase().trim();
    const currentName = (matchingTask.name || "").toLowerCase().trim();
    if (expectedName && currentName && expectedName !== currentName && expectedName !== "(dokument) dokument") {
      return false;
    }

    // 4. Custom fields check (if custom fields are returned in task)
    if (matchingTask.custom_fields && Array.isArray(matchingTask.custom_fields)) {
      const getFieldValue = (fieldId) => {
        const f = matchingTask.custom_fields.find((cf) => cf.id === fieldId);
        return f ? f.value : null;
      };

      // Check invoice number
      if (aiResult.invoiceNumber && aiResult.invoiceNumber !== "none") {
        const currInv = getFieldValue(this.customFields.invoiceNumber);
        if (currInv && String(currInv).trim() !== String(aiResult.invoiceNumber).trim()) {
          return false;
        }
      }

      // Check invoice amount
      if (aiResult.invoiceAmmount && aiResult.invoiceAmmount > 0) {
        const currAmount = getFieldValue(this.customFields.invoiceAmount);
        const expectedFloat = aiResult.invoiceAmmount / 100;
        if (currAmount !== null && currAmount !== undefined) {
          const parsedCurr = parseFloat(currAmount);
          if (!isNaN(parsedCurr) && Math.abs(parsedCurr - expectedFloat) > 0.01) {
            return false;
          }
        }
      }

      // Check company
      if (aiResult.company && aiResult.company !== "Unbekannt") {
        const currComp = getFieldValue(this.customFields.company);
        if (currComp && String(currComp).trim().toLowerCase() !== String(aiResult.company).trim().toLowerCase()) {
          return false;
        }
      }
    }

    // If matchingTask already exists, has matching name and no conflicting fields
    if (currentName && expectedName && (currentName === expectedName || currentName.includes(expectedName) || expectedName.includes(currentName))) {
      return true;
    }

    return false;
  }

  /**
   * Build array of custom field values for task creation/update
   */
  buildCustomFieldsPayload(aiResult = {}, driveLink = "") {
    const fields = [];
    const addField = (fieldId, value) => {
      if (fieldId && value !== undefined && value !== null && value !== "") {
        fields.push({ id: fieldId, value });
      }
    };

    // 1. Firma (short_text)
    if (aiResult.company && aiResult.company !== "Unbekannt") {
      addField(this.customFields.company, aiResult.company);
    }
    // 2. Kategorie (short_text)
    if (aiResult.category && aiResult.category !== "unknown") {
      addField(this.customFields.category, aiResult.category);
    }
    // 3. Belegdatum (short_text)
    if (aiResult.documentDate && aiResult.documentDate !== "unknown") {
      addField(this.customFields.documentDate, aiResult.documentDate);
    }
    // 4. Schlagworte (short_text)
    if (aiResult.tags) {
      const tagsStr = Array.isArray(aiResult.tags)
        ? aiResult.tags.filter((t) => t && t !== "none").join(", ")
        : String(aiResult.tags);
      if (tagsStr) addField(this.customFields.tags, tagsStr);
    }
    // 5. Rechnungsnummer (short_text)
    if (aiResult.invoiceNumber && aiResult.invoiceNumber !== "none") {
      addField(this.customFields.invoiceNumber, aiResult.invoiceNumber);
    }
    // 6. Rechnungsbetrag (currency / number float e.g. 19.99)
    if (aiResult.invoiceAmmount !== undefined && aiResult.invoiceAmmount !== null && aiResult.invoiceAmmount > 0) {
      const amountFloat =
        typeof aiResult.invoiceAmmount === "number"
          ? aiResult.invoiceAmmount / 100
          : parseFloat(aiResult.invoiceAmmount);
      if (!isNaN(amountFloat) && amountFloat > 0) {
        addField(this.customFields.invoiceAmount, amountFloat);
      }
    }
    // 7. Google Drive Link (url)
    if (driveLink) {
      addField(this.customFields.driveLink, driveLink);
    }

    return fields;
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
    const taskStatus = aiResult.isInvoice ? this.statusInvoice : this.statusDefault;
    const dueDate = this.parseDocumentDateToMs(aiResult.documentDate);
    const customFieldsPayload = this.buildCustomFieldsPayload(aiResult, driveLink);

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
        custom_fields: customFieldsPayload,
      };
      if (dueDate) createPayload.due_date = dueDate;

      task = await this.createTask(listId, createPayload);
      isUpdated = false;
    }

    const taskId = task.id || existingTaskId;

    // Set / update all Custom Fields if task was updated
    if (isUpdated && customFieldsPayload.length > 0) {
      for (const cf of customFieldsPayload) {
        await this.setCustomField(taskId, cf.id, cf.value);
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
