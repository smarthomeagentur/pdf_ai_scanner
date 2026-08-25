const fs = require("fs");
const DriveAPI = require("../../app/driveApi");
const { TOKEN_FILE, CREDENTIALS_FILE } = require("../config/paths");

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
  driveApi,
  getPickerToken,
  resolveFolder,
  createFolder,
  listFolders,
  getFolder,
};
