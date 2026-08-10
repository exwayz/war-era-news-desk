const DB_NAME = "wa-nd-library";
const DB_VERSION = 2;
const OBJ = "articles";
const OBJ_BOOKMARKS = "bookmarks";
const META_KEY = "wa-nd-library-meta";

let dbPromise = null;

export function getMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveMeta(patch) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ ...getMeta(), ...patch }));
  } catch {}
}

function openDB() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OBJ)) {
          db.createObjectStore(OBJ, { keyPath: "_id" });
        }
        if (!db.objectStoreNames.contains(OBJ_BOOKMARKS)) {
          db.createObjectStore(OBJ_BOOKMARKS, { keyPath: "_id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("open failed"));
      req.onblocked = () => reject(new Error("indexeddb blocked"));
    });
  }
  return dbPromise;
}

export async function loadAll() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(OBJ, "readonly").objectStore(OBJ).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("getAll failed"));
    });
  } catch {
    return [];
  }
}

export async function saveMany(records) {
  if (!records.length) return true;
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OBJ, "readwrite");
      const store = tx.objectStore(OBJ);
      for (const r of records) store.put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("tx failed"));
      tx.onabort = () => reject(tx.error || new Error("tx aborted"));
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearStore() {
  try {
    localStorage.removeItem(META_KEY);
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OBJ, "readwrite");
      tx.objectStore(OBJ).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("clear failed"));
    });
    return true;
  } catch {
    return false;
  }
}

export async function getBookmarks() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(OBJ_BOOKMARKS, "readonly").objectStore(OBJ_BOOKMARKS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("getBookmarks failed"));
    });
  } catch {
    return [];
  }
}

export async function saveBookmark(record) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OBJ_BOOKMARKS, "readwrite");
      tx.objectStore(OBJ_BOOKMARKS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("saveBookmark failed"));
      tx.onabort = () => reject(tx.error || new Error("saveBookmark aborted"));
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteBookmark(id) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OBJ_BOOKMARKS, "readwrite");
      tx.objectStore(OBJ_BOOKMARKS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("deleteBookmark failed"));
      tx.onabort = () => reject(tx.error || new Error("deleteBookmark aborted"));
    });
    return true;
  } catch {
    return false;
  }
}
