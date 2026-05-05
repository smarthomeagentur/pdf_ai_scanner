const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SCOPES = ["https://www.googleapis.com/auth/drive"];

class DriveAPI {
  constructor(tokenPath, credentialsPath) {
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

module.exports = DriveAPI;
