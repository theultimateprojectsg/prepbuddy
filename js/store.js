// Small key-value store on the student's device (IndexedDB), with an in-memory fallback.

const DB = 'prepbuddy', STORE = 'kv';
let dbPromise = null;
const memory = new Map();
// Values already read or written this session, so screens that read every chapter (mastery %, progress)
// don't go back to the database each time. Every write goes through set/del below, so it stays in step.
// Objects are handed out as copies, exactly as the database would, so changing one never changes the cache.
const cache = new Map();
const out = (v, fallback) => (v === undefined ? fallback : v !== null && typeof v === 'object' ? structuredClone(v) : v);

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
  if (cache.has(key)) return out(cache.get(key), fallback);
  const db = await open();
  if (!db) return memory.has(key) ? memory.get(key) : fallback;
  const v = await tx(db, 'readonly', (s) => s.get(key));
  cache.set(key, v);
  return out(v, fallback);
}

// Many keys in one go (one database transaction for everything not cached yet).
export async function getMany(keys, fallback = null) {
  const res = new Array(keys.length), miss = [];
  keys.forEach((k, i) => { if (cache.has(k)) res[i] = out(cache.get(k), fallback); else miss.push(i); });
  if (!miss.length) return res;
  const db = await open();
  if (!db) { miss.forEach((i) => { res[i] = memory.has(keys[i]) ? memory.get(keys[i]) : fallback; }); return res; }
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly'), s = t.objectStore(STORE);
    for (const i of miss) { const r = s.get(keys[i]); r.onsuccess = () => { cache.set(keys[i], r.result); res[i] = out(r.result, fallback); }; }
    t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
  return res;
}

export async function set(key, value) {
  const db = await open();
  if (!db) { memory.set(key, value); return; }
  await tx(db, 'readwrite', (s) => s.put(value, key));
  cache.set(key, value !== null && typeof value === 'object' ? structuredClone(value) : value);
}

export async function del(key) {
  const db = await open();
  if (!db) { memory.delete(key); return; }
  await tx(db, 'readwrite', (s) => s.delete(key));
  cache.set(key, undefined);
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
