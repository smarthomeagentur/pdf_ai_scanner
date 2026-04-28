async function downloadDriveFile(drive, fileId, destPath) {
  return new Promise(async (resolve, reject) => {
    try {
      const dest = fs.createWriteStream(destPath);
      const res = await drive.files.get({ fileId: fileId, alt: "media" }, { responseType: "stream" });
      res.data
        .on("end", () => {
          resolve();
        })
        .on("error", (err) => {
          reject(err);
        })
        .pipe(dest);
    } catch (e) {
      reject(e);
    }
  });
}

async function checkDriveForNewFiles() {
  if (!appSettings.MONITOR_DRIVE || !appSettings.FOLDER_ID) return;
  if (!fs.existsSync(TOKEN_PATH)) return;

  try {
    const authClient = await authorize();
    const drive = google.drive({ version: "v3", auth: authClient });

    let folderId;
    if (isValidGoogleDriveId(appSettings.FOLDER_ID)) {
      folderId = appSettings.FOLDER_ID;
    } else {
      folderId = await findFolderId(drive, appSettings.FOLDER_ID);
    }
    if (!folderId) return;

    if (debug) console.log("[MONITOR] Lade Dateien aus Roh-Ordner...");
    let newFound = 0;

    let nextPageToken = null;
    do {
      const res = await drive.files.list({
        // Nutze nur Dateien (keine Ordner), ggf. PDF + Images
        q: `mimeType != 'application/vnd.google-apps.folder' and trashed = false and '${folderId}' in parents`,
        fields: "nextPageToken, files(id, name, mimeType)",
        pageToken: nextPageToken,
      });

      const files = res.data.files || [];
      for (const file of files) {
        if (!processedDriveFiles.includes(file.id)) {
          // Gefundene, noch nicht verarbeitete Datei
          newFound++;
          if (debug) console.log(`[MONITOR] Neue Datei gefunden: ${file.name} (${file.id})`);

          processedDriveFiles.push(file.id);
          saveJobs(); // Sofort markieren, um Paralleldownloads zu verhindern

          const localPath = path.join(localDownloadFolder, `${Date.now()}_${file.name}`);
          await downloadDriveFile(drive, file.id, localPath);

          // Job anlegen und der Queue übergeben
          const jobId = Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
          const job = {
            id: jobId,
            originalName: file.name,
            status: "pending",
            result: null,
            error: null,
            filePath: localPath,
            uploadDate: new Date().toISOString(),
          };

          uploadJobs[jobId] = job;
          uploadQueue.push(jobId);
          saveJobs();
        }
      }
      nextPageToken = res.data.nextPageToken;
    } while (nextPageToken);

    if (newFound > 0) {
      console.log(`[MONITOR] ${newFound} neue Dateien in Pipeline gestellt.`);
      processQueue();
    }
  } catch (error) {
    console.error("[MONITOR] Fehler bei Ordner-Überwachung:", error);
  }
}
