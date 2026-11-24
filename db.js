// IndexedDB wrapper. Two stores: pills and doses. All data stays on device.
const DB_NAME = 'pill-tracker';
const DB_VERSION = 1;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('pills', { keyPath: 'id' });
        const doses = db.createObjectStore('doses', { keyPath: 'id' });
        doses.createIndex('pillId', 'pillId');
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function getAll() {
  const db = await open();
  const tx = db.transaction(['pills', 'doses'], 'readonly');
  const [pills, doses] = await Promise.all([
    reqP(tx.objectStore('pills').getAll()),
    reqP(tx.objectStore('doses').getAll()),
  ]);
  return { pills, doses };
}

export async function putPill(pill) {
  const db = await open();
  const tx = db.transaction('pills', 'readwrite');
  tx.objectStore('pills').put(pill);
  await done(tx);
}

export async function deletePill(id) {
  const db = await open();
  const tx = db.transaction(['pills', 'doses'], 'readwrite');
  tx.objectStore('pills').delete(id);
  const idx = tx.objectStore('doses').index('pillId');
  idx.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
    const c = e.target.result;
    if (c) { tx.objectStore('doses').delete(c.primaryKey); c.continue(); }
  };
  await done(tx);
}

export async function putDose(dose) {
  const db = await open();
  const tx = db.transaction('doses', 'readwrite');
  tx.objectStore('doses').put(dose);
  await done(tx);
}

export async function deleteDose(id) {
  const db = await open();
  const tx = db.transaction('doses', 'readwrite');
  tx.objectStore('doses').delete(id);
  await done(tx);
}

// Merge imported records. Same id overwrites, new ids are added, nothing is removed.
export async function merge({ pills, doses }) {
  const db = await open();
  const tx = db.transaction(['pills', 'doses'], 'readwrite');
  for (const p of pills) tx.objectStore('pills').put(p);
  for (const d of doses) tx.objectStore('doses').put(d);
  await done(tx);
}

export async function getMeta(key) {
  const db = await open();
  const row = await reqP(db.transaction('meta').objectStore('meta').get(key));
  return row ? row.value : undefined;
}

export async function setMeta(key, value) {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  await done(tx);
}
