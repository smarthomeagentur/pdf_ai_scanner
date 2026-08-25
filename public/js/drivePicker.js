/**
 * Google Drive Picker API Integration with Z-Index management
 */
import { apiRequest } from "./api.js";
import { showToast } from "./utils.js";

export function initGooglePickerApi() {
  if (window.gapi && window.gapi.load) {
    window.gapi.load("picker", () => {});
  } else {
    window.addEventListener("load", () => {
      if (window.gapi && window.gapi.load) {
        window.gapi.load("picker", () => {});
      }
    });
  }
}

export async function openGooglePicker(target = "raw") {
  try {
    const tokenData = await apiRequest("/api/drive/picker-token");
    if (!tokenData.success || !tokenData.token) {
      alert(tokenData.error || "Fehler beim Laden des Picker-Tokens. Bitte Google Drive Verbindung prüfen.");
      return;
    }

    function createAndShowPicker() {
      try {
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
            if (data[window.google.picker.Response.ACTION] === window.google.picker.Action.PICKED) {
              const doc = data[window.google.picker.Response.DOCUMENTS][0];
              const folderId = doc[window.google.picker.Document.ID];
              const folderName = doc[window.google.picker.Document.NAME];

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
            }
          })
          .build();

        picker.setVisible(true);

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
      window.gapi.load("picker", { callback: createAndShowPicker });
    } else {
      alert("Google API-Bibliothek wird geladen. Bitte in wenigen Sekunden erneut versuchen.");
    }
  } catch (err) {
    console.error("Google Picker Error", err);
    alert("Fehler beim Öffnen des Google Drive Pickers: " + err.message);
  }
}
