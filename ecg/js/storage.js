// IndexedDB persistence: session metadata + summary in `sessions`,
// heavy payload (EDF bytes + analysis result) in `data`.
const DB_NAME = 'ecgAnalyser';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('startTime', 'startTime');
      }
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqToPromise = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function listSessions() {
  const db = await openDB();
  const all = await reqToPromise(db.transaction('sessions').objectStore('sessions').getAll());
  all.sort((a, b) => a.startTime - b.startTime);
  return all;
}
export async function getSessionMeta(id) {
  const db = await openDB();
  return reqToPromise(db.transaction('sessions').objectStore('sessions').get(id));
}
export async function getSessionData(id) {
  const db = await openDB();
  return reqToPromise(db.transaction('data').objectStore('data').get(id));
}
export async function saveSession(meta, data) {
  const db = await openDB();
  await tx(db, ['sessions', 'data'], 'readwrite', (t) => {
    t.objectStore('sessions').put(meta);
    t.objectStore('data').put({ id: meta.id, ...data });
  });
}
export async function updateSessionMeta(meta) {
  const db = await openDB();
  await tx(db, ['sessions'], 'readwrite', (t) => { t.objectStore('sessions').put(meta); });
}
export async function deleteSession(id) {
  const db = await openDB();
  await tx(db, ['sessions', 'data'], 'readwrite', (t) => {
    t.objectStore('sessions').delete(id);
    t.objectStore('data').delete(id);
  });
}
export function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// settings in localStorage
const SETTINGS_KEY = 'ecg.settings';
export const DEFAULT_SETTINGS = { age: null, sex: null, hrMax: null, qtcFormula: 'bazett', tachyBpm: 100, bradyBpm: 60 };
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
