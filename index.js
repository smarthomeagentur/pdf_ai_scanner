const { authenticate } = require("@google-cloud/local-auth");
const unzipper = require("unzipper");
const fs = require("fs");
const path = require("path");
const process = require("process");
const dotenv = require("dotenv");
var aiAgent = require("./app/aiAgent.js");
const { google } = require("googleapis");

dotenv.config();

var debug = false;
var testrun = false;
var firststart = true;

const localDownloadFolder = path.join(__dirname, "downloads"); // Path to your "downloads" folder

//this needs a setup
const INTERVALL = 300; //Interval in seconds
const FILE_FOLDER_NAME = "Adobe Scan";
const ADOBE_USERNAME = process.env.ADOBE_USERNAME;
const ADOBE_PASSWORD = process.env.ADOBE_PASSWORD;
const CREDENTIALS_PATH = path.join(process.cwd(), "gdrive_secret.json");
const FOLDER_ID = process.env.DRIVE_FOLDER_ID; //ID of drive folder to sync to
const FOLDER_ID_SORTED = process.env.DRIVE_FOLDER_ID_SORTED; //ID to Upload renamed sorted files

//dont need setup here
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const COOKIES_FILE = "./cookies.json"; // Define path for where you will store the cookies
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function init() {
  console.log("starting script");

  if (firststart) {
    firststart = false;
    const args = process.argv.slice(2);
    console.log(args);
    if (args.includes("--debug")) {
      debug = true;
      console.log("[START] Debug mode enabled");
    }
    if (args.includes("--test")) {
      testrun = true;
      console.log("[START] Test mode enabled");
    }
    if (args.includes("--login")) {
      console.log("[START] Do Adobe Login Script");
      var isLoggedIn = await checkIfFileExists(COOKIES_FILE);
      if (isLoggedIn) {
        console.log("[START] Cookies already exist. Resetting them...");
        await fs.promises.unlink(COOKIES_FILE);
      }
      await adobeLogin();
      return true;
    }
    aiAgent.init(HUGGING_FACE_API_KEY, debug);
  }

  if (testrun) {
    for (var i = 1; i <= 1; i++) {
      var sortedName = await aiAgent.getPdfName(i + ".pdf");
      console.log(sortedName);
    }
    var filesDownloaded = ["a"]; //DEBUG
    return;
  }

  var isLoggedIn = await checkIfFileExists(COOKIES_FILE);

  if (isLoggedIn) {
    var googleClient = await authorize();

    var driveData = await listNewestFiles(googleClient, FOLDER_ID, 50);
    const fileNamesDrive = driveData.map((file) => file.name);
    var filesDownloaded = await adobeDownloadFile(fileNamesDrive);

    if (filesDownloaded?.length > 0) {
      var success = await uploadFilesFromLocalFolder(googleClient, localDownloadFolder, FOLDER_ID);
      if (!success) {
        return sleep(INTERVALL * 1000).then(() => {
          init();
        });
      }
      await emptyFolder(localDownloadFolder);
    }

    console.log("next run in " + INTERVALL + " seconds");
    return sleep(INTERVALL * 1000).then(() => {
      init();
    });
  } else {
    console.log("No credentials found. Do Adobe login via --login parameter");
  }
} //

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.promises.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.promises.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.promises.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

async function uploadFile(drive, filePath, folderId, name = undefined) {
  try {
    let filename = name || path.basename(filePath);
    const fileMetadata = {
      name: filename,
      parents: [folderId],
    };
    const media = {
      mimeType: null,
      body: fs.createReadStream(filePath), // Create a readable stream from the file path
    };
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });
    if (debug) console.log(`Uploaded ${filename} (ID: ${file.data.id})`);
  } catch (error) {
    console.error(`Error uploading file ${filePath}:`, error);
  }
}

async function uploadFilesFromLocalFolder(authClient, localFolderPath, driveFolderIdentifier) {
  const drive = google.drive({ version: "v3", auth: authClient });
  let folderId;
  if (isValidGoogleDriveId(driveFolderIdentifier)) {
    folderId = driveFolderIdentifier;
  } else {
    const folderName = driveFolderIdentifier;
    folderId = await findFolderId(drive, folderName);
    if (!folderId) {
      console.log(`Folder "${folderName}" not found.`);
      return { success: false, message: `Folder "${folderName}" not found.` };
    }
  }

  try {
    const files = await fs.promises.readdir(localFolderPath);
    var uploadCount = 0;
    for (const file of files) {
      const filePath = path.join(localFolderPath, file);
      const fileStat = await fs.promises.stat(filePath);
      if (fileStat.isFile()) {
        if (FOLDER_ID_SORTED) {
          var sortedName = await aiAgent.getPdfName(filePath);
          console.log(sortedName);
          if (sortedName.success == false) return false;
          await uploadFile(drive, filePath, FOLDER_ID_SORTED, sortedName.full);
        }
        await uploadFile(drive, filePath, folderId);
        uploadCount++;
      } else if (fileStat.isDirectory()) {
        console.log(`Skipping folder ${file}`);
      }
    }
    console.log(
      `All (${uploadCount}) files from ${localFolderPath} uploaded to Google Drive folder with ID ${folderId}`
    );
    return true;
  } catch (error) {
    console.error(`Error reading local folder or uploading files:`, error);
    return false;
  }
}

async function listNewestFiles(authClient, folderIdentifier, limit = 20) {
  const drive = google.drive({ version: "v3", auth: authClient });
  let folderId;
  if (isValidGoogleDriveId(folderIdentifier)) {
    folderId = folderIdentifier;
  } else {
    const folderName = folderIdentifier;
    folderId = await findFolderId(drive, folderName);
    if (!folderId) {
      console.log(`Folder "${folderName}" not found.`);
      return [];
    }
  }

  let nextPageToken = null;
  let allFiles = [];

  do {
    const res = await drive.files.list({
      pageSize: 100, // Increased page size for efficiency
      fields: "nextPageToken, files(id, name, modifiedTime)",
      q: `'${folderId}' in parents`,
      orderBy: "modifiedTime desc",
      pageToken: nextPageToken,
    });

    if (res.data.files && res.data.files.length > 0) {
      allFiles = allFiles.concat(res.data.files);
    }

    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);

  allFiles.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  const newestFiles = allFiles.slice(0, limit);

  return newestFiles;
}

async function findFolderId(drive, folderName) {
  let nextPageToken = null;
  do {
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}'`,
      fields: "nextPageToken, files(id, name)",
      pageToken: nextPageToken,
    });
    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }
    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);
  return null;
}

function isValidGoogleDriveId(str) {
  // A Google Drive ID is a string of alphanumeric characters and some special symbols
  return typeof str === "string" && /^[a-zA-Z0-9_-]+$/.test(str) && str.length > 10;
}

async function emptyFolder(folderPath) {
  try {
    const folderExists = await fs.promises
      .access(folderPath)
      .then(() => true)
      .catch(() => false);
    if (!folderExists) {
      console.error("Folder does not exist:", folderPath);
      return;
    }

    // Read the contents of the folder
    const files = await fs.promises.readdir(folderPath);

    for (const file of files) {
      const filePath = path.join(folderPath, file);
      const stat = await fs.promises.lstat(filePath);

      if (stat.isDirectory()) {
        // Recursively remove subdirectory contents
        await emptyFolder(filePath);
        // Remove the directory itself
        await fs.promises.rmdir(filePath);
      } else {
        // Delete the file
        await fs.promises.unlink(filePath);
      }
    }

    if (debug) console.log(`Emptied folder: ${folderPath}`);
  } catch (error) {
    console.error(`Error emptying folder: ${folderPath}`, error);
  }
}

async function checkIfFileExists(filePath) {
  try {
    await fs.promises.access(filePath); // Check if the file is accessible
    if (debug) console.log(`${filePath} exists.`);
    return true;
  } catch (error) {
    if (debug) console.log(`${filePath} does not exist.`);
    return false;
  }
}

async function waitLoad(page) {
  return new Promise(async (resolve) => {
    try {
      await page.waitForLoadState("domcontentloaded");
      //await page.waitForLoadState("networkidle");
      await sleep(1000);
      resolve(true);
    } catch (error) {
      console.warn("timeout error");
      resolve(false);
    }
  });
}

async function adobeLogin() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: false }); // Set to false to see the browser
  const context = await browser.newContext();
  const page = await context.newPage();
  let cookiesLoad = [];

  try {
    //const cookiesString = await fs.promises.readFile(COOKIES_FILE, "utf-8");
    //cookiesLoad = JSON.parse(cookiesString);
    //await context.addCookies(cookiesLoad);

    // Navigate to Adobe Sign-in
    await page.goto("https://account.adobe.com");
    await waitLoad(page);
    //await page.waitForSelector("#notificationIconOnEngine > svg", { timeout: 10000 }); // Wait for 10 seconds

    var checkUserLogin;
    try {
      // Wait for the specific element to be available on the page, if not found it will throw an exception.
      await page.waitForSelector("#notificationIconOnEngine > svg", { timeout: 20000 }); // Wait for 10 seconds
      checkUserLogin = await page.locator("#notificationIconOnEngine > svg").count();
    } catch (error) {
      console.warn("[LOGIN] Not logged in, continuing with login procedure");
    }

    if (checkUserLogin > 0) return { login: true, loadedLogin: true };

    // fill username
    await page.waitForSelector("#EmailPage-EmailField");
    await page.fill("#EmailPage-EmailField", ADOBE_USERNAME);
    await page.click('[data-id="EmailPage-ContinueButton"]');

    // fill password if asked
    var isPasswordPage = false;
    try {
      await page.waitForSelector("#PasswordPage-PasswordField", { timeout: 20000 });
      isPasswordPage = true;
    } catch (error) {
      isPasswordPage = false;
    }
    await sleep(5000);
    if (isPasswordPage) {
      console.log("[LOGIN] insert password no auth code");
      await page.fill("#PasswordPage-PasswordField", ADOBE_PASSWORD);
      await page.click('[data-id="PasswordPage-ContinueButton"]');
      waitLoad(page);
    } else {
      console.log("[LOGIN] No password page found, continuing without. Please fill email code");
      await page.click('[data-id="Page-PrimaryButton"]');
      waitLoad(page);
      await page.waitForSelector("#PasswordPage-PasswordField", { timeout: 60000 });
      console.log("[LOGIN] insert password auth code");
      await sleep(2000);
      await page.fill("#PasswordPage-PasswordField", ADOBE_PASSWORD);
      await page.click('[data-id="PasswordPage-ContinueButton"]');
    }
    await sleep(10000);
    const cookies = await context.cookies();
    await fs.promises.writeFile(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`[LOGIN] Cookies saved to: ${COOKIES_FILE}`);
  } catch (error) {
    console.error("[LOGIN] An error occurred:", error);
  } finally {
    await browser.close();
  }
}
async function adobeDownloadFile(filesArrayDrive) {
  const { chromium } = require("playwright");
  var settings;
  if (debug) {
    settings = { headless: false };
  } else {
    settings = { headless: true };
  }
  const browser = await chromium.launch(settings); // Set to false to see the browser
  const context = await browser.newContext({
    viewport: { width: 1500, height: 800 }, // Specify the browser viewport size
  });
  const page = await context.newPage();
  let cookiesLoad = [];

  try {
    const cookiesString = await fs.promises.readFile(COOKIES_FILE, "utf-8");
    cookiesLoad = JSON.parse(cookiesString);
    await context.addCookies(cookiesLoad);

    console.log("update files from adobe cloud");

    // Navigate to Adobe Files and click Scan folder
    await page.goto("https://acrobat.adobe.com/link/documents/files");
    sleep(5000);

    await waitLoad(page);

    try {
      await page.waitForSelector("#onetrust-accept-btn-handler", { timeout: 5000 }); //check for cookie notification
      await page.click("#onetrust-accept-btn-handler");
    } catch (error) {
      if (debug) console.log("Skip Cookie notification");
    }

    try {
      await page.waitForSelector('div[data-test-id="' + FILE_FOLDER_NAME + '"]', { timeout: 20000 }); //search file folder
    } catch (error) {
      console.warn("Error loading page, skipping download procedure. This may cause issues");
      return;
    }

    await waitLoad(page);

    if (debug) console.log("adobe files loaded");
    const adobeScanFolder = page.locator('div[data-test-id="' + FILE_FOLDER_NAME + '"]').first();
    if ((await adobeScanFolder.count()) > 0) {
      if (debug) console.log(FILE_FOLDER_NAME + " folder found");
      //You can do something with this folder, for instance click the folder to navigate inside
      await adobeScanFolder.click();
    } else {
      console.warn(FILE_FOLDER_NAME + " folder not found.");
    }
    await waitLoad(page);

    // Load the Files list and get the newest files
    try {
      await page.waitForSelector(
        'div[data-scrollable="true"][role="rowgroup"] div[role="presentation"] div[role="presentation"]',
        {
          timeout: 20000,
        }
      );
    } catch (error) {
      console.warn("Error loading list of files in the folder, skipping download procedure. This may cause issues");
      return;
    }
    if (debug) console.log("Files List loaded");

    await page.evaluate(() => {
      document.body.style.transform = "scale(0.75)";
    });

    await waitLoad(page);
    await sleep(4000);

    const sortArrow = await page
      .locator(
        'div[data-test-id="table-view-wrapper"] div[role="row"] div[role="columnheader"][style*="display: flex;"][class*="spectrum-Table-headCell is-sortable"]:is([class*="is-sorted-asc"],[class*="is-sorted-desc"])'
      )
      .all();

    const classNames = await sortArrow[0].evaluate((el) => el.className);

    if (classNames.includes("is-sorted-asc")) {
      console.log("The files are sorted in ascending order. Changing it");
      //sortArrow.click();
      await page.click('div[role="columnheader"] div[data-test-id="modified-table-header"]');
      await waitLoad(page);
      await page.click('div[role="presentation"] div[role="menuitem"][data-test-id="modified"]');
      await waitLoad(page);
    } else {
      if (debug) console.log("The files are sorted in descending order. OK");
    }

    const items = await page.$$(
      'div[data-scrollable="true"][role="rowgroup"] div[role="presentation"] div[role="presentation"] div[data-test-id][role="link"]'
    );
    var filesArrayAdobe = [];
    for (const item of items.slice(0, 8)) {
      let downloadFile = false;
      const fileName = await item.getAttribute("data-test-id");

      var isUpload = filesArrayDrive.indexOf(fileName);
      if (isUpload < 0) downloadFile = true;

      filesArrayAdobe.push({ fileName, isDownloaded: downloadFile });
      if (debug) console.log(`File name: ${fileName} is download: ${downloadFile}`);
    }

    await waitLoad(page);

    const checkboxes = await page
      .locator(
        'div[data-scrollable="true"][role="rowgroup"] div[role="presentation"] div[role="presentation"] input[type="checkbox"][class="spectrum-Checkbox-input"]'
      )
      .all();

    const maxItemsToCheck = Math.min(checkboxes.length, filesArrayAdobe.length);
    if (debug) console.log("Files Count: " + maxItemsToCheck);

    //add logic to download the files

    var downloadedFilesArray = [];
    if (checkboxes.length > 0) {
      for (let index = 0; index < filesArrayAdobe.length; index++) {
        if (filesArrayAdobe[index].isDownloaded) {
          downloadedFilesArray.push(filesArrayAdobe[index].fileName);
          await checkboxes[index].click();
          if (debug) console.log("File " + index + " Selected");
          await waitLoad(page);
        }
      }
    } else {
      console.warn("Could not find the checkboxes");
    }

    if (downloadedFilesArray.length > 0) {
      console.log("Files to Download: " + downloadedFilesArray.length);
      await page.waitForSelector(
        'div[data-test-id="context-board-wrapper"] button[data-test-id="download-action-button"]',
        { timeout: 10000 }
      );
      await waitLoad(page);
      const downloadButton = await page
        .locator('div[data-test-id="context-board-wrapper"] button[data-test-id="download-action-button"]')
        .all();

      const [download] = await Promise.all([page.waitForEvent("download"), downloadButton[0].click()]);
      const suggestedFilename = download.suggestedFilename();
      const downloadPath = localDownloadFolder + `/${suggestedFilename}`;
      await download.saveAs(downloadPath);
      if (debug) console.log(`Downloaded: ${downloadPath}`);

      if (suggestedFilename.endsWith(".zip")) {
        if (debug) console.log("The filename ends with .zip. Doing a decompression first.");
        await decompressAndMove(downloadPath);
        fs.unlinkSync(downloadPath);
      }
    }
    await browser.close();
    return downloadedFilesArray;
  } catch (error) {
    console.error("An error occurred:", error);
    await browser.close();
  }
}

async function decompressFile(inputPath, outputPath) {
  return new Promise((resolve) => {
    fs.createReadStream(inputPath)
      .pipe(unzipper.Extract({ path: outputPath }))
      .on("close", () => {
        console.log("Files unzipped successfully");
        resolve(true);
      });
  });
}

async function decompressAndMove(inputPath) {
  // Get the directory where the .zip file is located
  const outputPath = path.dirname(inputPath);

  return new Promise((resolve, reject) => {
    fs.createReadStream(inputPath)
      .pipe(unzipper.Parse()) // Parse each entry in the zip file
      .on("entry", async (entry) => {
        const entryName = entry.path;
        const isInsideFolder = entryName.startsWith("Document Cloud/"); // Check if entry is inside "Document Cloud"

        if (entry.type === "File" && isInsideFolder) {
          const fileName = path.basename(entryName); // Extract file name
          const outputFilePath = path.join(outputPath, fileName);
          entry.pipe(fs.createWriteStream(outputFilePath));
        } else {
          entry.autodrain(); // Skip entries not in "Document Cloud"
        }
      })
      .on("close", () => {
        console.log("Files successfully extracted and moved.");
        resolve(true);
      })
      .on("error", (err) => {
        console.error("Error during extraction:", err);
        reject(err);
      });
  });
}

init();
