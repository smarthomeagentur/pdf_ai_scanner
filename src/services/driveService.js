const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const { TOKEN_FILE, CREDENTIALS_FILE } = require("../config/paths");

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

class DriveAPI {
  constructor(tokenPath = TOKEN_FILE, credentialsPath = CREDENTIALS_FILE) {
    this.tokenPath = tokenPath;
    this.credentialsPath = credentialsPath;
  }

  async loadSavedCredentialsIfExist() {
    try {
      const content = await fs.promises.readFile(this.tokenPath);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

  async saveCredentials(client) {
    const content = await fs.promises.readFile(this.credentialsPath);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.promises.writeFile(this.tokenPath, payload);
  }

  async getExistingRefreshToken() {
    try {
      if (fs.existsSync(this.tokenPath)) {
        const data = JSON.parse(await fs.promises.readFile(this.tokenPath, "utf8"));
        return data.refresh_token || null;
      }
    } catch (e) {}
    return null;
  }

  async exchangeCodeForTokens(code) {
    const content = await fs.promises.readFile(this.credentialsPath, "utf8");
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    if (!key) throw new Error("Ungültiges gdrive_secret.json Format");

    const oauth2Client = new google.auth.OAuth2(
      key.client_id,
      key.client_secret,
      "postmessage"
    );

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens) {
      throw new Error("Keine Tokens von Google erhalten.");
    }

    const existingRefreshToken = await this.getExistingRefreshToken();
    const refreshToken = tokens.refresh_token || existingRefreshToken;

    const payload = JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: refreshToken,
      access_token: tokens.access_token,
      expiry_date: tokens.expiry_date,
    }, null, 2);

    await fs.promises.writeFile(this.tokenPath, payload, "utf8");
    return tokens;
  }

  async authorize() {
    let client = await this.loadSavedCredentialsIfExist();
    if (client) return client;
    client = await authenticate({ scopes: SCOPES, keyfilePath: this.credentialsPath });
    if (client.credentials) await this.saveCredentials(client);
    return client;
  }

  async getClient() {
    const authClient = await this.authorize();
    return google.drive({ version: "v3", auth: authClient });
  }

  async uploadFile(filePath, folderId, fileOptions = {}, debug = false) {
    try {
      if (!fs.existsSync(filePath)) {
        console.error(`[DRIVE] Datei existiert nicht und wird übersprungen: ${filePath}`);
        return null;
      }

      const drive = await this.getClient();

      let resource = { parents: [folderId] };
      if (typeof fileOptions === "string") {
        resource.name = fileOptions || path.basename(filePath);
      } else {
        resource.name = fileOptions.name || path.basename(filePath);
        if (fileOptions.description) resource.description = fileOptions.description;
        if (fileOptions.appProperties) resource.appProperties = fileOptions.appProperties;
      }

      const file = await drive.files.create({
        resource: resource,
        media: { mimeType: null, body: fs.createReadStream(filePath) },
        fields: "id, webViewLink, thumbnailLink, webContentLink",
      });
      if (debug) console.log(`[DRIVE] Uploaded ${resource.name} (ID: ${file.data.id})`);
      return file.data;
    } catch (error) {
      console.error(`Error uploading file ${filePath}:`, error);
      return null;
    }
  }

  async updateFileProperties(fileId, appProperties) {
    try {
      const drive = await this.getClient();
      await drive.files.update({
        fileId: fileId,
        resource: { appProperties }
      });
      return true;
    } catch (error) {
      console.error(`Error updating properties for file ${fileId}:`, error);
      return false;
    }
  }

  async findFolderId(folderName) {
    const drive = await this.getClient();
    let nextPageToken = null;
    do {
      const res = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}'`,
        fields: "nextPageToken, files(id, name)",
        pageToken: nextPageToken,
      });
      if (res.data.files && res.data.files.length > 0) return res.data.files[0].id;
      nextPageToken = res.data.nextPageToken;
    } while (nextPageToken);
    return null;
  }

  isValidGoogleDriveId(str) {
    return typeof str === "string" && /^[a-zA-Z0-9_-]+$/.test(str) && str.length > 10;
  }
}

const driveApi = new DriveAPI(TOKEN_FILE, CREDENTIALS_FILE);

async function getPickerToken() {
  let clientId = "";
  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const keys = JSON.parse(await fs.promises.readFile(CREDENTIALS_FILE, "utf8"));
      const key = keys.installed || keys.web;
      clientId = key ? key.client_id : "";
    } catch (e) {}
  }

  try {
    const authClient = await driveApi.authorize();
    if (!authClient) {
      throw new Error("Google Drive ist noch nicht verbunden. Bitte zuerst verbinden.");
    }

    const tokenRes = await authClient.getAccessToken();
    const token = typeof tokenRes === "string" ? tokenRes : (tokenRes ? tokenRes.token : null);
    if (!token) {
      throw new Error("Kein gültiges Google Drive Access Token vorhanden.");
    }

    return { token, clientId };
  } catch (err) {
    if (err.message && err.message.includes("invalid_grant")) {
      if (fs.existsSync(TOKEN_FILE)) {
        try { fs.unlinkSync(TOKEN_FILE); } catch (e) {}
      }
      throw new Error("Google Drive Sitzung abgelaufen. Bitte erneut 'Mit Google Anmelden' klicken.");
    }
    throw err;
  }
}

async function resolveFolder(folderIdOrUrl) {
  let input = (folderIdOrUrl || "").trim();
  if (!input) throw new Error("Keine Ordner-ID oder Link angegeben.");
  const parenMatch = input.match(/\(([a-zA-Z0-9_-]{10,})\)$/);
  if (parenMatch) input = parenMatch[1];
  const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  const folderId = urlMatch ? urlMatch[1] : input;

  const drive = await driveApi.getClient();
  const result = await drive.files.get({ fileId: folderId, fields: "id, name, mimeType" });
  return result.data;
}

async function createFolder(name, parentId) {
  if (!name || !name.trim()) throw new Error("Ordnername ist erforderlich.");
  const drive = await driveApi.getClient();
  const fileMetadata = {
    name: name.trim(),
    mimeType: "application/vnd.google-apps.folder",
    parents: parentId && parentId !== "root" ? [parentId] : undefined,
  };
  const file = await drive.files.create({
    resource: fileMetadata,
    fields: "id, name",
  });
  return file.data;
}

async function listFolders(parentId = "root") {
  const drive = await driveApi.getClient();
  const result = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`,
    fields: "files(id, name, parents)",
    orderBy: "name",
    pageSize: 1000,
  });
  return result.data.files || [];
}

async function getFolder(folderId) {
  const drive = await driveApi.getClient();
  const result = await drive.files.get({ fileId: folderId, fields: "id, name" });
  return result.data;
}

module.exports = {
  DriveAPI,
  driveApi,
  getPickerToken,
  resolveFolder,
  createFolder,
  listFolders,
  getFolder,
};
