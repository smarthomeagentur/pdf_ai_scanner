/**
 * Google Drive Picker API Integration with Z-Index management & Debug Logging
 */
import { apiRequest } from "./api.js";
import { showToast, debugLog, extractCleanFolderId } from "./utils.js";

export function initGooglePickerApi() {
  debugLog("PICKER", "Initializing Google Picker API listener...");
  if (window.gapi && window.gapi.load) {
    window.gapi.load("picker", () => {
      debugLog("PICKER", "window.gapi.load('picker') completed successfully.");
    });
  } else {
    window.addEventListener("load", () => {
      if (window.gapi && window.gapi.load) {
        window.gapi.load("picker", () => {
          debugLog("PICKER", "window.gapi.load('picker') completed after window load.");
        });
      }
    });
  }
}

export async function openGooglePicker(target = "raw") {
  debugLog("PICKER", `openGooglePicker invoked for target: '${target}'`);
  try {
    const tokenData = await apiRequest("/api/drive/picker-token");
    debugLog("PICKER", "Received picker token payload:", {
      hasToken: !!tokenData?.token,
      clientId: tokenData?.clientId,
      success: tokenData?.success,
    });

    if (!tokenData.success || !tokenData.token) {
      alert(tokenData.error || "Fehler beim Laden des Picker-Tokens. Bitte Google Drive Verbindung prüfen.");
      return;
    }

    function createAndShowPicker() {
      try {
        debugLog("PICKER", "Constructing DocsView and PickerBuilder...");
        const view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true);

        const origin = window.location.protocol + "//" + window.location.host;
        let builder = new window.google.picker.PickerBuilder()
          .addView(view)
          .setOAuthToken(tokenData.token)
          .setOrigin(origin)
          .setTitle("Google Drive Ordner auswählen");

        if (tokenData.clientId) {
          builder = builder.setAppId(tokenData.clientId);
        }

        const picker = builder
          .setCallback((data) => {
            debugLog("PICKER", "Picker Callback received event:", data);
            const action = data?.action || data?.[window.google?.picker?.Response?.ACTION];

            if (action === "picked" || action === window.google?.picker?.Action?.PICKED) {
              const docs = data.docs || data[window.google.picker.Response.DOCUMENTS] || [];
              const doc = docs[0] || {};
              const folderId = doc.id || doc[window.google.picker.Document.ID];
              const folderName = doc.name || doc[window.google.picker.Document.NAME] || "Google Drive Ordner";

              debugLog("PICKER", `Picked Folder: Name='${folderName}', ID='${folderId}' for target='${target}'`);

              if (!folderId) {
                console.error("[PICKER] Could not resolve folderId from doc:", doc);
                return;
              }

              if (target === "raw" || target === "raw-folder-display") {
                const disp = document.getElementById("raw-folder-display");
                const idEl = document.getElementById("raw-folder-id");
                if (disp) disp.value = `${folderName} (${folderId})`;
                if (idEl) idEl.value = folderId;
              } else if (target === "ai" || target === "ai-folder-display") {
                const disp = document.getElementById("ai-folder-display");
                const idEl = document.getElementById("ai-folder-id");
                if (disp) disp.value = `${folderName} (${folderId})`;
                if (idEl) idEl.value = folderId;
              }

              showToast(`Ordner ausgewählt: ${folderName}`, "success");
            } else if (action === "cancel" || action === window.google?.picker?.Action?.CANCEL) {
              debugLog("PICKER", "User cancelled folder selection dialog.");
            }
          })
          .build();

        picker.setVisible(true);
        debugLog("PICKER", "Picker visibility set to true.");

        // Force picker dialog elements to top z-index above settings modal
        const fixPickerZIndex = () => {
          document
            .querySelectorAll(
              ".picker-dialog, .picker-dialog-bg, .picker-modal-dialog, .picker-modal-dialog-bg, div[class*='picker-dialog'], div[class*='picker-modal']"
            )
            .forEach((el) => {
              el.style.setProperty("z-index", "99999", "important");
            });
        };
        fixPickerZIndex();
        setTimeout(fixPickerZIndex, 50);
        setTimeout(fixPickerZIndex, 200);
        setTimeout(fixPickerZIndex, 500);
      } catch (pickerErr) {
        console.error("PickerBuilder error:", pickerErr);
        alert("Google Picker Dialog konnte nicht initialisiert werden: " + pickerErr.message);
      }
    }

    if (window.google && window.google.picker) {
      createAndShowPicker();
    } else if (window.gapi && window.gapi.load) {
      debugLog("PICKER", "Loading 'picker' library dynamically...");
      window.gapi.load("picker", { callback: createAndShowPicker });
    } else {
      alert("Google API-Bibliothek wird geladen. Bitte in wenigen Sekunden erneut versuchen.");
    }
  } catch (err) {
    console.error("Google Picker Error", err);
    alert("Fehler beim Öffnen des Google Drive Pickers: " + err.message);
  }
}
