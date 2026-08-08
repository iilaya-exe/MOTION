import { defaultState, sanitizeState } from "./defaults.js";

/* Persistence. IndexedDB is the primary store because it has no practical size
   cap for notes; localStorage is the fallback for private-mode browsers where
   IndexedDB is blocked. Data from the original single-file version of the app
   lives under LS_KEY and is migrated across on first run. */

const LS_KEY = "myNotionCloneData_v1";
const DB_NAME = "MyNotionCloneDB";
const DB_VERSION = 1;
const STORE_NAME = "appState";
const STATE_KEY = "state";

let usingIndexedDB = true;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function idbGet(key) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

function idbSet(key, value) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : defaultState();
  } catch (e) {
    console.warn("Saved data could not be read, starting with a fresh workspace.", e);
    return defaultState();
  }
}

function saveToLocalStorage(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Could not save to localStorage.", e);
  }
}

export function loadState() {
  return idbGet(STATE_KEY)
    .then((existing) => {
      if (existing) return sanitizeState(existing);

      // First run on IndexedDB: migrate any data from the old localStorage build.
      let legacyRaw = null;
      try {
        legacyRaw = localStorage.getItem(LS_KEY);
      } catch {
        /* storage unavailable — nothing to migrate */
      }

      const initial = legacyRaw ? sanitizeState(JSON.parse(legacyRaw)) : defaultState();

      return idbSet(STATE_KEY, initial).then(() => {
        if (legacyRaw) {
          try {
            localStorage.removeItem(LS_KEY);
          } catch {
            /* ignore */
          }
        }
        return initial;
      });
    })
    .catch((err) => {
      console.warn("IndexedDB unavailable, falling back to localStorage.", err);
      usingIndexedDB = false;
      return loadFromLocalStorage();
    });
}

export function saveState(state) {
  if (!usingIndexedDB) {
    saveToLocalStorage(state);
    return;
  }

  idbSet(STATE_KEY, state).catch((err) => {
    console.error("Could not save to IndexedDB, falling back to localStorage.", err);
    usingIndexedDB = false;
    saveToLocalStorage(state);
  });
}
