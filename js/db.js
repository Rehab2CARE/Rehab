// Lokale opslag op het toestel (IndexedDB). Geen server.
// - store "instellingen": de structuur (onderdelen, regio's, categorieën, fiche-titels)
// - store "fiches": de inhoud van elke fiche (bestand als ArrayBuffer, of tekst)

const DB_NAAM = 'praktijkfiches';
const DB_VERSIE = 1;
let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAAM, DB_VERSIE);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('instellingen')) db.createObjectStore('instellingen');
        if (!db.objectStoreNames.contains('fiches')) db.createObjectStore('fiches', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(stores, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    const req = fn(t);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  getStructuur: () => tx('instellingen', 'readonly', t => t.objectStore('instellingen').get('structuur')),
  setStructuur: s => tx('instellingen', 'readwrite', t => t.objectStore('instellingen').put(s, 'structuur')),
  getFiche: id => tx('fiches', 'readonly', t => t.objectStore('fiches').get(id)),
  putFiche: f => tx('fiches', 'readwrite', t => t.objectStore('fiches').put(f)),
  deleteFiches: ids => tx('fiches', 'readwrite', t => {
    const s = t.objectStore('fiches');
    ids.forEach(id => s.delete(id));
  }),
  alleFiches: () => tx('fiches', 'readonly', t => t.objectStore('fiches').getAll()),
  vervangAlles: (structuur, fiches) => tx(['instellingen', 'fiches'], 'readwrite', t => {
    const f = t.objectStore('fiches');
    f.clear();
    fiches.forEach(x => f.put(x));
    t.objectStore('instellingen').put(structuur, 'structuur');
  })
};
