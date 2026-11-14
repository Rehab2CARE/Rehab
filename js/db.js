// Lokale opslag op het toestel (IndexedDB). Geen server.
// - store "instellingen": de structuur (onderdelen, regio's, categorieën, fiche-titels), pincode, ...
// - store "fiches": de inhoud van elke fiche (bestand als ArrayBuffer, of tekst)
//
// Twee databanken:
// - "praktijkfiches"         = lokale modus (zonder Supabase), zoals vroeger
// - "praktijkfiches-gedeeld" = lokale kopie van de gedeelde fiches (met Supabase)
// Zo blijven de oude lokale fiches onaangeroerd staan tot ze naar de gedeelde verzameling gekopieerd zijn.

const DB_VERSIE = 1;

export function maakDb(naam) {
  let dbPromise;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(naam, DB_VERSIE);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('instellingen')) d.createObjectStore('instellingen');
          if (!d.objectStoreNames.contains('fiches')) d.createObjectStore('fiches', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function tx(stores, mode, fn) {
    return openDb().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode);
      let result;
      const req = fn(t);
      if (req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const get = sleutel => tx('instellingen', 'readonly', t => t.objectStore('instellingen').get(sleutel));
  const put = (sleutel, w) => tx('instellingen', 'readwrite', t => t.objectStore('instellingen').put(w, sleutel));
  const del = sleutel => tx('instellingen', 'readwrite', t => t.objectStore('instellingen').delete(sleutel));

  return {
    naam,
    getStructuur: () => get('structuur'),
    setStructuur: s => put('structuur', s),
    getFiche: id => tx('fiches', 'readonly', t => t.objectStore('fiches').get(id)),
    putFiche: f => tx('fiches', 'readwrite', t => t.objectStore('fiches').put(f)),
    deleteFiches: ids => tx('fiches', 'readwrite', t => {
      const s = t.objectStore('fiches');
      ids.forEach(id => s.delete(id));
    }),
    // Pincode voor Beheer: enkel een gezouten hash, nooit de code zelf. Zit niet in de back-up.
    getPin: () => get('pin'),
    setPin: p => put('pin', p),
    wisPin: () => del('pin'),
    // Vrije instellingen (bv. laatste profiel, laatste synchronisatie)
    get, put, del,
    alleFiches: () => tx('fiches', 'readonly', t => t.objectStore('fiches').getAll()),
    ficheIds: () => tx('fiches', 'readonly', t => t.objectStore('fiches').getAllKeys()),
    vervangAlles: (structuur, fiches) => tx(['instellingen', 'fiches'], 'readwrite', t => {
      const f = t.objectStore('fiches');
      f.clear();
      fiches.forEach(x => f.put(x));
      t.objectStore('instellingen').put(structuur, 'structuur');
    })
  };
}

// De databank die de app op dit moment gebruikt. app.js kiest bij het opstarten welke (db.gebruik).
let huidige = maakDb('praktijkfiches');

export const db = new Proxy({}, {
  get(_, sleutel) {
    if (sleutel === 'gebruik') return naam => { huidige = maakDb(naam); };
    return huidige[sleutel];
  }
});
