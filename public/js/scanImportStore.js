/**
 * Hands uploaded image files from the main page over to scanner.html (edge detection + review).
 * IndexedDB is used because Files/Blobs survive the page navigation there, unlike sessionStorage.
 */
const DB_NAME = "scan-import";
const STORE = "pending";
const KEY = "files";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(result.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

export function saveImportFiles(files, options = {}) {
  const entries = files.map((file) => ({ blob: file, name: file.name, type: file.type }));
  return withStore("readwrite", (store) => store.put({ entries, options, createdAt: Date.now() }, KEY));
}

/** Returns { entries, options } once and removes it from the store. */
export async function takeImportFiles() {
  const data = await withStore("readonly", (store) => store.get(KEY));
  await withStore("readwrite", (store) => store.delete(KEY));
  return data || { entries: [], options: {} };
}

export function isImageFile(file) {
  return /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "");
}
