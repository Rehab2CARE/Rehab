// Verkeerslicht (groen – oranje – rood): hoe reageert de knie (of enkel) op de oefeningen?
// Gebaseerd op het "ACL Rehab Traffic Light System" (M. Hughes): kijk naar pijn en zwelling, en naar
// stijfheid (minder strekken of plooien), en hoe dat evolueert over 24–48 uur. De app kleurt enkel op basis van wat de patiënt zelf ingeeft;
// de kinesitherapeut beslist wat er met het programma gebeurt.
//
// Grenswaarden: hier aanpassen (klinische inhoud, te valideren door de kinesitherapeut).
export const GRENZEN = {
  pijnGroenMax: 2,  // pijn 0–2/10: groen
  pijnRoodMin: 5,   // pijn 5/10 of meer: rood (3–4 = oranje)
  venster: 2,       // ingaven die hoogstens zoveel dagen uit elkaar liggen, tellen als "blijft hangen"
  recent: 3         // het verkeerslicht bovenaan tonen als de laatste feedback hoogstens zoveel dagen oud is
};

export const LICHT = {
  groen: { naam: 'Groen', kort: 'goed verdragen' },
  oranje: { naam: 'Oranje', kort: 'licht signaal' },
  rood: { naam: 'Rood', kort: 'te veel belasting' }
};

const dag = d => new Date(d + 'T00:00:00');
const dagenTussen = (a, b) => Math.round((dag(b) - dag(a)) / 86400000);

// Kleur van één ingave op zich, zonder te kijken naar de vorige dagen.
function basis(s) {
  const pijn = s.pijn;
  const zwelling = s.zwelling || '';
  const stijfheid = s.stijfheid || '';
  if (pijn == null && !zwelling && !stijfheid) return null;
  const redenen = [];
  let kleur = 'groen';
  if (pijn != null && pijn >= GRENZEN.pijnRoodMin) { kleur = 'rood'; redenen.push(`pijn ${pijn}/10`); }
  else if (pijn != null && pijn > GRENZEN.pijnGroenMax) { kleur = 'oranje'; redenen.push(`pijn ${pijn}/10`); }
  if (zwelling === 'meer') { if (kleur === 'groen') kleur = 'oranje'; redenen.push('meer zwelling'); }
  if (stijfheid === 'stijver') { if (kleur === 'groen') kleur = 'oranje'; redenen.push('stijver'); }
  return { kleur, redenen };
}

// Map datum → { kleur, redenen } voor alle ingaven met pijn of zwelling.
// Bovenop de kleur per dag: rood als een signaal blijft hangen (twee keer na elkaar oranje of erger
// binnen GRENZEN.venster dagen) of als de pijn drie ingaven na elkaar stijgt.
export function kleuren(sessies) {
  const lijst = [...sessies].filter(s => basis(s)).sort((a, b) => a.datum.localeCompare(b.datum));
  const uit = new Map();
  lijst.forEach((s, i) => {
    const b = basis(s);
    const v = lijst[i - 1];
    const vv = lijst[i - 2];
    const kort = (x, y) => x && dagenTussen(x.datum, y.datum) <= GRENZEN.venster;
    if (b.kleur === 'oranje' && kort(v, s) && basis(v).kleur !== 'groen') {
      b.kleur = 'rood'; b.redenen.push('blijft hangen');
    }
    if (b.kleur !== 'groen' && s.pijn != null && kort(v, s) && kort(vv, v) && v.pijn != null && vv.pijn != null
      && s.pijn > v.pijn && v.pijn > vv.pijn) {
      b.kleur = 'rood'; if (!b.redenen.includes('pijn stijgt')) b.redenen.push('pijn stijgt');
    }
    uit.set(s.datum, b);
  });
  return uit;
}

// Laatste kleur (als die recent genoeg is), voor het verkeerslicht bovenaan.
export function huidigLicht(sessies, vandaag) {
  const k = kleuren(sessies);
  const laatste = [...k.keys()].sort().pop();
  if (!laatste || dagenTussen(laatste, vandaag) > GRENZEN.recent) return null;
  return { datum: laatste, ...k.get(laatste) };
}

// Teksten voor de patiënt: beschrijvend, zonder behandeladvies.
export function patientTekst(kleur, deel = 'knie') {
  const je = `je ${deel}`;
  const Je = `Je ${deel}`;
  return {
    groen: { titel: `${Je} verdraagt de oefeningen goed`, uitleg: `Weinig of geen pijn (0–${GRENZEN.pijnGroenMax}/10), geen extra zwelling en niet stijver.` },
    oranje: { titel: `${Je} geeft een licht signaal`, uitleg: `Wat meer pijn (${GRENZEN.pijnGroenMax + 1}–${GRENZEN.pijnRoodMin - 1}/10), wat meer zwelling, of ${je} is stijver. Kijk morgen opnieuw hoe ${je} reageert. Je kinesitherapeut leest mee.` },
    rood: { titel: `${Je} krijgt te veel belasting`, uitleg: `Veel pijn (${GRENZEN.pijnRoodMin}/10 of meer), of pijn, zwelling of stijfheid die blijft hangen of toeneemt. Neem contact op met je kinesitherapeut.` }
  }[kleur];
}

// Redenen in patiënttaal, bv. "pijn 4/10 · meer zwelling · al de tweede keer na elkaar"
export function redenenPatient(redenen) {
  const taal = { 'blijft hangen': 'al de tweede keer na elkaar', 'pijn stijgt': 'de pijn neemt toe', stijver: 'stijver dan de vorige keer' };
  return redenen.map(r => taal[r] || r).join(' · ');
}
