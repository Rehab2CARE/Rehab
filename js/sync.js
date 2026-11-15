// Gedeelde fiches ophalen uit Supabase en lokaal bewaren (offline kopie).
// Werkwijze: alle rijen (structuur + fiche-gegevens) ophalen, dat zijn er hoogstens enkele duizenden en gaat snel.
// Bestanden worden enkel gedownload als ze nieuw of gewijzigd zijn ("versie" = bijgewerkt).

import { db } from './db.js';
import * as bron from './bron.js';

const volgens = (a, b) => (a.volgorde - b.volgorde) || a.titel.localeCompare(b.titel, 'nl', { numeric: true });

// Zet de platte lijsten om naar de boom die de app gebruikt.
export function bouwStructuur(knopen, fiches, vorige = {}) {
  const kinderenVan = new Map();
  knopen.forEach(k => {
    const lijst = kinderenVan.get(k.ouder_id ?? null) || [];
    lijst.push(k);
    kinderenVan.set(k.ouder_id ?? null, lijst);
  });
  const fichesVan = new Map();
  fiches.forEach(f => {
    const lijst = fichesVan.get(f.categorie_id) || [];
    lijst.push(f);
    fichesVan.set(f.categorie_id, lijst);
  });

  const knoop = (k, niveau) => {
    const uit = { id: k.id, titel: k.titel, omschrijving: k.omschrijving || '', volgorde: k.volgorde };
    if (niveau < 2) {
      uit.kinderen = (kinderenVan.get(k.id) || []).sort(volgens).map(c => knoop(c, niveau + 1));
    } else {
      uit.fiches = (fichesVan.get(k.id) || []).sort(volgens).map(f => ({
        id: f.id, titel: f.titel, omschrijving: f.omschrijving || '', soort: f.soort,
        volgorde: f.volgorde, versie: f.bijgewerkt, pad: f.bestand_pad || null
      }));
    }
    return uit;
  };

  return {
    versie: 1,
    bron: 'gedeeld',
    appTitel: vorige.appTitel && vorige.appTitel !== 'Praktijkfiches' ? vorige.appTitel : 'Rehab',
    niveauNamen: ['Onderdeel', 'Regio', 'Categorie'],
    secties: (kinderenVan.get(null) || []).filter(k => k.niveau === 0).sort(volgens).map(k => knoop(k, 0))
  };
}

let bezig = null;

// Haalt alles op. Geeft { nieuw, gewist, mislukt } terug. Eén synchronisatie tegelijk.
export function synchroniseer(opVoortgang = () => {}) {
  if (!bezig) bezig = doeSync(opVoortgang).finally(() => { bezig = null; });
  return bezig;
}

async function doeSync(opVoortgang) {
  const { knopen, fiches } = await bron.alles();
  const vorige = (await db.getStructuur()) || {};
  const structuur = bouwStructuur(knopen, fiches, vorige);

  // Welke inhoud ontbreekt of is verouderd?
  const lokaalIds = new Set(await db.ficheIds());
  const teHalen = [];
  for (const f of fiches) {
    const lokaal = lokaalIds.has(f.id) ? await db.getFiche(f.id) : null;
    if (!lokaal || lokaal.versie !== f.bijgewerkt) teHalen.push(f);
  }

  let mislukt = 0;
  for (let i = 0; i < teHalen.length; i++) {
    const f = teHalen[i];
    opVoortgang(i + 1, teHalen.length);
    try {
      if (f.soort === 'tekst') {
        await db.putFiche({ id: f.id, tekst: f.tekst || '', versie: f.bijgewerkt });
      } else {
        const data = await bron.download(f.bestand_pad);
        await db.putFiche({ id: f.id, mime: f.mime, bestandsnaam: f.bestandsnaam, data, versie: f.bijgewerkt });
      }
    } catch {
      mislukt++; // volgende keer opnieuw proberen
    }
  }

  // Inhoud van fiches die niet meer bestaan opruimen
  const bestaand = new Set(fiches.map(f => f.id));
  const weg = [...lokaalIds].filter(id => !bestaand.has(id));
  if (weg.length) await db.deleteFiches(weg);

  await db.setStructuur(structuur);
  await db.put('laatsteSync', new Date().toISOString());
  return { structuur, nieuw: teHalen.length - mislukt, gewist: weg.length, mislukt };
}
