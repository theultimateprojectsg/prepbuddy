// Small key-value store on the student's device (IndexedDB), with an in-memory fallback.

const DB = 'prepbuddy', STORE = 'kv';
let dbPromise = null;
const memory = new Map();

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function get(key, fallback = null) {
  const db = await open();
  if (!db) return memory.has(key) ? memory.get(key) : fallback;
  const v = await tx(db, 'readonly', (s) => s.get(key));
  return v === undefined ? fallback : v;
}

export async function set(key, value) {
  const db = await open();
  if (!db) { memory.set(key, value); return; }
  await tx(db, 'readwrite', (s) => s.put(value, key));
}

export async function del(key) {
  const db = await open();
  if (!db) { memory.delete(key); return; }
  await tx(db, 'readwrite', (s) => s.delete(key));
}

export async function keys(prefix) {
  const db = await open();
  const all = db ? await tx(db, 'readonly', (s) => s.getAllKeys()) : [...memory.keys()];
  return all.filter((k) => String(k).startsWith(prefix));
}

// Ask the browser not to clear our data when space is low (best effort).
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
}
