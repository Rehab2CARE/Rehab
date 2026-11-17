import { db, maakDb } from './db.js';
import { startDelen, kiesKnop, koppelKiesKnoppen } from './delen.js';
import * as bron from './bron.js';
import { synchroniseer } from './sync.js';
import { initPatienten, toonTherapeut, startPatient, patientenTegel, werkKiesbalkBij } from './patienten.js';
import { initProtocollen, toonProtocollen } from './protocollen.js';
import { initTesten } from './testen.js';
import { initSessies } from './sessies.js';
import { initNotities } from './notities.js';
import { initSchemas, toonSchema } from './schemas.js';

// Twee modi:
// - 'lokaal'  : zonder Supabase (js/config.js leeg). Alles staat enkel op dit toestel, zoals vroeger.
// - 'gedeeld' : met Supabase. Het team deelt één verzameling; dit toestel houdt een offline kopie bij.
let modus = 'lokaal';
let profiel = null;   // { id, email, naam, rol } van de aangemelde gebruiker (gedeelde modus)
let offline = false;  // gedeelde modus zonder verbinding: enkel bekijken
const gedeeld = () => modus === 'gedeeld';
const isTeam = () => !gedeeld() || ['therapeut', 'beheerder'].includes(profiel?.rol);
const isBeheerder = () => gedeeld() && profiel?.rol === 'beheerder';
const SYNC_INTERVAL_MIN = 5;

// ---------------------------------------------------------------------------
// Structuur (boom):
//   structuur.secties[]            = onderdelen (Oefenfiches, Informatiefiches, ...)
//     .kinderen[]                  = regio's (Lage rug, Knie, ...)
//       .kinderen[]                = categorieën (Algemeen, ...)
//         .fiches[]                = { id, titel, omschrijving, soort }
// De inhoud van een fiche (PDF, afbeelding of tekst) staat apart in db.fiches.
// Navigatie via de URL: #/<onderdeel>/<regio>/<categorie>/<fiche>
// ---------------------------------------------------------------------------

const $ = sel => document.querySelector(sel);
const inhoud = $('#inhoud');
let structuur = null;
let games = { titel: 'Games', games: [] }; // uit data/games.json (vast, niet via Beheer)
let hulp = null; // gedeelde hulpmiddelen voor patienten.js, protocollen.js en testen.js
let beheer = false;
let actieveUrl = null; // blob-URL van de geopende fiche (vrijgeven bij wisselen)

const SOORT_LABEL = { pdf: 'PDF', afbeelding: 'Afbeelding', video: 'Video', tekst: 'Tekst' };
const UPLOAD_TYPES = 'application/pdf,image/*,video/mp4,video/quicktime';
const MAX_UPLOAD_MB = 50; // limiet per bestand in de gedeelde opslag (gratis plan Supabase)

// ---------- Hulpfuncties ----------

const nieuwId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function melding(tekst) {
  const m = $('#melding');
  m.textContent = tekst;
  m.classList.add('zichtbaar');
  clearTimeout(melding.t);
  melding.t = setTimeout(() => m.classList.remove('zichtbaar'), 2600);
}

function niveauNaam(diepte) {
  return (structuur.niveauNamen || ['Onderdeel', 'Regio', 'Categorie'])[diepte] || 'Item';
}

async function bewaar() {
  await db.setStructuur(structuur);
}

// Alle fiches onder een knoop (om mee te wissen)
function fichesOnder(knoop) {
  const lijst = [...(knoop.fiches || [])];
  (knoop.kinderen || []).forEach(k => lijst.push(...fichesOnder(k)));
  return lijst;
}
const ficheIdsOnder = knoop => fichesOnder(knoop).map(f => f.id);

// Alle fiches met hun plaats: [{ f, ids: [onderdeel, regio, categorie], pad: 'Onderdeel › Regio › Categorie' }]
function alleFichesMetPlaats() {
  const uit = [];
  structuur.secties.forEach(s => (s.kinderen || []).forEach(r => (r.kinderen || []).forEach(c =>
    (c.fiches || []).forEach(f => uit.push({ f, ids: [s.id, r.id, c.id], pad: `${s.titel} › ${r.titel} › ${c.titel}` })))));
  return uit;
}

// Plaats van een categorie in de boom: { keten: [onderdeel, regio, categorie], ids } of null
function knoopPad(id) {
  for (const s of structuur.secties) for (const r of s.kinderen || []) for (const c of r.kinderen || [])
    if (c.id === id) return { keten: [s, r, c], ids: [s.id, r.id, c.id] };
  return null;
}

// Alle categorieën, bv. om een fiche naar te verplaatsen
function alleCategorieen() {
  const uit = [];
  structuur.secties.forEach(s => (s.kinderen || []).forEach(r => (r.kinderen || []).forEach(c =>
    uit.push({ cat: c, pad: `${s.titel} › ${r.titel} › ${c.titel}` }))));
  return uit;
}

// Zoeken zonder rekening te houden met hoofdletters en accenten (é = e)
const zoekNormaal = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('nl');

// Fichetegel met de plaats eronder (voor zoekresultaten, favorieten, laatst bekeken)
function ficheTegel({ f, ids, pad }) {
  return `
    <div class="tegel tegel-fiche">
      ${kiesKnop(f)}
      <a class="tegel-link" href="${link([...ids, f.id])}">
        <span class="tegel-soort">${SOORT_LABEL[f.soort] || ''}</span>
        <span class="tegel-titel">${esc(f.titel)}</span>
        ${f.omschrijving ? `<span class="tegel-sub">${esc(f.omschrijving)}</span>` : ''}
        <span class="tegel-pad">${esc(pad)}</span>
      </a>
    </div>`;
}

// ---------- Favorieten (per therapeut) en laatst bekeken (per toestel) ----------
// Lokale modus: favorieten op dit toestel. Gedeelde modus: per account in Supabase, met een kopie op het toestel.

let favorieten = new Set();
const favSleutel = () => (gedeeld() && profiel ? `favorieten-${profiel.id}` : 'favorieten');

async function laadFavorieten() {
  try { favorieten = new Set((await db.get(favSleutel())) || []); } catch { favorieten = new Set(); }
}

async function vernieuwFavorieten() {
  if (!gedeeld() || !navigator.onLine) return;
  try {
    const ids = await bron.favorieten();
    favorieten = new Set(ids);
    await db.put(favSleutel(), ids);
  } catch { /* volgende keer opnieuw */ }
}

async function wisselFavoriet(id) {
  const aan = !favorieten.has(id);
  if (gedeeld()) {
    if (!navigator.onLine) { melding('Geen internet: favorieten aanpassen kan nu niet.'); return false; }
    try {
      if (aan) await bron.voegFavorietToe(profiel.id, id);
      else await bron.wisFavoriet(profiel.id, id);
    } catch (e) { melding(e.message); return false; }
  }
  if (aan) favorieten.add(id); else favorieten.delete(id);
  await db.put(favSleutel(), [...favorieten]);
  return true;
}

const LAATST_MAX = 8;

function laatstBekeken() {
  try { return JSON.parse(localStorage.getItem('laatstBekeken') || '[]'); } catch { return []; }
}

function onthoudBekeken(id) {
  try {
    localStorage.setItem('laatstBekeken', JSON.stringify([id, ...laatstBekeken().filter(x => x !== id)].slice(0, LAATST_MAX)));
  } catch { /* privémodus: niet onthouden */ }
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

const volgendeVolgorde = lijst => lijst.reduce((m, x) => Math.max(m, (x.volgorde ?? -1) + 1), lijst.length);

const veiligeBestandsnaam = naam => String(naam || 'bestand')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-100) || 'bestand';

function soortVan(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'afbeelding';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

// Gedeelde modus: een wijziging naar Supabase sturen en daarna de lokale kopie bijwerken.
// Geeft true terug als het lukte.
async function schrijf(actie) {
  if (!navigator.onLine) { melding('Geen internet: wijzigen kan nu niet.'); return false; }
  try {
    await actie();
  } catch (e) {
    melding(e.message || 'Er liep iets mis.');
    return false;
  }
  try {
    structuur = (await synchroniseer()).structuur;
  } catch { /* de wijziging is gelukt; bijwerken lukt de volgende keer */ }
  return true;
}

// Volgorde na ◀ ▶ opnieuw nummeren (enkel de items die veranderen)
function nieuweVolgorde(lijst, i, j) {
  const kopie = [...lijst];
  [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
  return kopie.map((k, idx) => ({ id: k.id, volgorde: idx, oud: k.volgorde })).filter(x => x.oud !== x.volgorde)
    .map(({ id, volgorde }) => ({ id, volgorde }));
}

// ---------- Dialogen ----------

function dialoog({ titel, velden, okTekst = 'OK', gevaar = false }) {
  const dlg = $('#dialoog');
  $('#dialoog-titel').textContent = titel;
  const ok = $('#dialoog-ok');
  ok.textContent = okTekst;
  ok.className = 'knop ' + (gevaar ? 'knop-gevaar' : 'knop-hoofd');
  const box = $('#dialoog-velden');
  box.innerHTML = '';
  (velden || []).forEach(v => {
    if (v.soort === 'uitleg') {
      const p = document.createElement('p');
      p.className = 'hulp';
      p.style.fontSize = '1rem';
      p.textContent = v.tekst;
      box.appendChild(p);
      return;
    }
    const label = document.createElement('label');
    label.textContent = v.label;
    const el = document.createElement(v.soort === 'tekstvak' ? 'textarea' : v.soort === 'keuze' ? 'select' : 'input');
    el.name = v.naam;
    if (v.soort === 'keuze') {
      (v.opties || []).forEach(o => {
        const optie = document.createElement('option');
        optie.value = o.waarde;
        optie.textContent = o.label;
        el.appendChild(optie);
      });
    } else if (v.soort !== 'tekstvak') {
      el.type = v.type || 'text';
    }
    if (v.inputmode) el.inputMode = v.inputmode;
    if (v.rijen) el.style.minHeight = v.rijen * 1.6 + 'em';
    if (v.autocomplete) el.autocomplete = v.autocomplete;
    el.value = v.waarde || '';
    if (v.verplicht) el.required = true;
    if (v.placeholder) el.placeholder = v.placeholder;
    label.appendChild(el);
    if (v.hulp) {
      const h = document.createElement('p');
      h.className = 'hulp';
      h.textContent = v.hulp;
      label.appendChild(h);
    }
    box.appendChild(label);
  });
  return new Promise(resolve => {
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      const uit = {};
      box.querySelectorAll('[name]').forEach(el => { uit[el.name] = el.value.trim(); });
      resolve(uit);
    };
    dlg.returnValue = '';
    dlg.showModal();
    const eerste = box.querySelector('input, textarea, select');
    if (eerste) setTimeout(() => eerste.focus(), 50);
  });
}

const vraagNaam = (titel, waarde = '') =>
  dialoog({ titel, velden: [{ naam: 'naam', label: 'Naam', waarde, verplicht: true }] }).then(r => r && r.naam);

const bevestig = (titel, tekst, okTekst = 'Verwijderen') =>
  dialoog({ titel, velden: [{ soort: 'uitleg', tekst }], okTekst, gevaar: true }).then(r => r !== null);

// ---------- Pincode voor Beheer ----------
// Een kinderslot: een patiënt kan niets wijzigen zonder de code.
// Bewaard als gezouten SHA-256-hash op het toestel, nooit de code zelf.

const PIN_MIN = 4, PIN_MAX = 8;
const AUTO_SLOT_MIN = 5; // na zoveel minuten zonder aanraken gaat Beheer vanzelf dicht
let pinActief = false;
let slotTimer = null;

async function hashPin(pin, zout) {
  const data = new TextEncoder().encode(zout + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

const pinVeld = (naam, label) => ({
  naam, label, type: 'password', inputmode: 'numeric', autocomplete: 'off', verplicht: true
});

const geldigePin = p => new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(p);

async function pinKlopt(pin) {
  const opgeslagen = await db.getPin();
  if (!opgeslagen) return true;
  return (await hashPin(pin, opgeslagen.zout)) === opgeslagen.hash;
}

async function vraagPin() {
  const r = await dialoog({
    titel: 'Pincode voor Beheer',
    velden: [pinVeld('pin', 'Pincode')],
    okTekst: 'Openen'
  });
  if (!r) return false;
  if (await pinKlopt(r.pin)) return true;
  melding('Verkeerde pincode.');
  return false;
}

async function stelPinIn() {
  const r = await dialoog({
    titel: pinActief ? 'Pincode wijzigen' : 'Pincode instellen',
    velden: [
      { soort: 'uitleg', tekst: `Kies ${PIN_MIN} tot ${PIN_MAX} cijfers. Onthoud de code goed: er is geen manier om ze op te vragen.` },
      pinVeld('pin1', 'Nieuwe pincode'),
      pinVeld('pin2', 'Nog eens dezelfde pincode')
    ],
    okTekst: 'Bewaren'
  });
  if (!r) return;
  if (!geldigePin(r.pin1)) { melding(`De pincode moet uit ${PIN_MIN} tot ${PIN_MAX} cijfers bestaan.`); return; }
  if (r.pin1 !== r.pin2) { melding('De twee pincodes zijn niet gelijk.'); return; }
  const zout = nieuwId() + nieuwId();
  await db.setPin({ zout, hash: await hashPin(r.pin1, zout) });
  pinActief = true;
  melding('Pincode bewaard.');
  toon();
}

async function zetPinUit() {
  if (!await bevestig('Pincode uitzetten?', 'Iedereen kan dan Beheer openen en fiches wijzigen of wissen.', 'Uitzetten')) return;
  await db.wisPin();
  pinActief = false;
  melding('Pincode uitgezet.');
  toon();
}

function zetBeheer(aan) {
  beheer = aan;
  try { sessionStorage.setItem('beheer', beheer ? '1' : '0'); } catch { /* */ }
  herstartSlotTimer();
  if (!beheer && location.hash === '#/instellingen') location.hash = '#/';
  else toon();
}

// Beheer gaat vanzelf dicht na een tijd zonder aanraken, of als de app naar de achtergrond gaat.
function herstartSlotTimer() {
  clearTimeout(slotTimer);
  if (beheer && pinActief) slotTimer = setTimeout(() => sluitBeheer(), AUTO_SLOT_MIN * 60 * 1000);
}

function sluitBeheer() {
  if (!beheer || !pinActief) return;
  if ($('#dialoog').open) $('#dialoog').close('annuleer');
  zetBeheer(false);
}

// ---------- Opstarten ----------

// Eenmalige opruiming (november 2026): Nek en Bovenrug zijn geen standaardregio's meer.
// Enkel lege regio's worden gewist; staat er een fiche in, dan blijft de regio staan.
const OPRUIMING = { id: 'zonder-nek-bovenrug', regios: ['Nek', 'Bovenrug'] };

async function ruimRegiosOp() {
  const gedaan = structuur.opruimingen || [];
  if (gedaan.includes(OPRUIMING.id)) return;
  structuur.secties.forEach(s => {
    s.kinderen = (s.kinderen || []).filter(r => !(OPRUIMING.regios.includes(r.titel) && ficheIdsOnder(r).length === 0));
  });
  structuur.opruimingen = [...gedaan, OPRUIMING.id];
  await bewaar();
}

async function standaardStructuur() {
  const res = await fetch('data/structuur.json', { cache: 'no-cache' });
  const cfg = await res.json();
  const maakCat = titel => ({ id: nieuwId(), titel, fiches: [] });
  const maakRegio = titel => ({ id: nieuwId(), titel, kinderen: (cfg.standaardCategorieen || []).map(maakCat) });
  return {
    versie: cfg.versie || 1,
    appTitel: cfg.appTitel || 'Rehab',
    niveauNamen: cfg.niveauNamen,
    secties: cfg.secties.map(s => ({
      id: nieuwId(),
      titel: s.titel,
      omschrijving: s.omschrijving || '',
      kinderen: (s.regios || cfg.standaardRegios || []).map(maakRegio)
    }))
  };
}

// De app heette vroeger Praktijkfiches: een bewaarde oude naam wordt Rehab (een zelf gekozen naam blijft)
const nieuweNaam = s => { if (s && (!s.appTitel || s.appTitel === 'Praktijkfiches')) s.appTitel = 'Rehab'; return s; };

const LEGE_STRUCTUUR = () => ({ versie: 1, bron: 'gedeeld', appTitel: 'Rehab', niveauNamen: ['Onderdeel', 'Regio', 'Categorie'], secties: [] });

async function start() {
  $('#dialoog-annuleer').addEventListener('click', () => $('#dialoog').close('annuleer'));
  if ('serviceWorker' in navigator) {
    // Staat er een nieuwe versie klaar, dan herlaadt de app zichzelf één keer (niet bij de allereerste installatie).
    // Zo draait een toestel nooit lang oude code naast nieuwe gegevens uit de databank.
    const hadVersie = !!navigator.serviceWorker.controller;
    let herladen = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadVersie || herladen) return;
      herladen = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      // Een app op het beginscherm laadt zelden opnieuw: kijk bij elke terugkeer naar de app of er een update is.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  hulp = {
    esc, melding, dialoog, bevestig, link, pad, inhoud, toon, ficheVlak, alleFichesMetPlaats, knoopPad,
    appTitel: () => structuur?.appTitel || 'Rehab', profielId: () => profiel?.id || null,
    spellen: () => games.games.filter(g => g.bestand)
  };
  initPatienten(hulp);
  initProtocollen(hulp);
  initTesten(hulp);
  initSessies(hulp);
  initNotities(hulp);
  initSchemas(hulp);

  let linkMelding = null;
  if (bron.isIngesteld()) {
    modus = 'gedeeld';
    db.gebruik('praktijkfiches-gedeeld');
    // QR-code van een patiënt: #/aanmelden/<code>/<wachtwoord> (meteen uit de adresbalk halen)
    let qr = null;
    if (pad()[0] === 'aanmelden') {
      const [, code, ww] = pad();
      if (code && ww) qr = { code, ww };
      history.replaceState(null, '', location.pathname + location.search + '#/');
    }
    const { sessie, linkType, linkFout } = await bron.start();
    if (linkFout) linkMelding = 'De link uit je mail werkt niet (meer). Vraag een nieuwe aan.';
    profiel = await laadProfiel(sessie);
    if (!profiel) {
      structuur = nieuweNaam(await db.getStructuur()) || LEGE_STRUCTUUR();
      toonAanmelden(linkMelding, qr);
      return;
    }
    if (profiel.rol === 'patient') {
      structuur = nieuweNaam(await db.getStructuur()) || LEGE_STRUCTUUR();
      bron.bijSessieWijziging(event => { if (event === 'SIGNED_OUT') location.reload(); });
      await startPatient();
      return;
    }
    if (linkType === 'invite' || linkType === 'recovery') await vraagNieuwWachtwoord(linkType);
    bron.bijSessieWijziging(event => { if (event === 'SIGNED_OUT') location.reload(); });
  }

  structuur = nieuweNaam(await db.getStructuur());
  if (!structuur) {
    structuur = gedeeld() ? LEGE_STRUCTUUR() : await standaardStructuur();
    await bewaar();
  }
  if (!gedeeld()) await ruimRegiosOp();

  if (!isTeam()) { toonGeenToegang(); return; }

  try {
    const res = await fetch('data/games.json', { cache: 'no-cache' });
    if (res.ok) games = await res.json();
  } catch { /* offline zonder cache: geen games */ }
  pinActief = !!(await db.getPin());
  await laadFavorieten();
  // Een teamlid start standaard in Beheer.
  // Met een pincode enkel net na het aanmelden met wachtwoord; bij een volgende start eerst de pincode.
  let netAangemeld = false;
  try { netAangemeld = sessionStorage.getItem('netAangemeld') === '1'; sessionStorage.removeItem('netAangemeld'); } catch { /* privémodus */ }
  if (pinActief) beheer = netAangemeld;
  else {
    try { beheer = sessionStorage.getItem('beheer') !== '0'; } catch { beheer = true; }
  }
  startDelen(melding);

  $('#beheer').addEventListener('click', async () => {
    if (!beheer && pinActief && !await vraagPin()) return;
    zetBeheer(!beheer);
  });
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, herstartSlotTimer, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sluitBeheer();
    else if (gedeeld()) werkBij();
  });
  window.addEventListener('online', () => { if (gedeeld()) werkBij(true); });
  $('#instellingen').addEventListener('click', () => { location.hash = '#/instellingen'; });
  $('#terug').addEventListener('click', () => {
    const delen = pad();
    if (delen[0] === 'instellingen' || delen[0] === 'zoeken') location.hash = '#/';
    else location.hash = '#/' + delen.slice(0, -1).join('/');
  });
  window.addEventListener('hashchange', toon);
  toon();
  herstartSlotTimer();
  if (linkMelding) melding(linkMelding);

  if (gedeeld()) werkBij(true);
}

// ---------- Gedeelde modus: aanmelden, profiel, bijwerken ----------

// Profiel van de aangemelde gebruiker. Zonder verbinding: het laatst gekende profiel (enkel bekijken).
async function laadProfiel(sessie) {
  const bewaard = await db.get('profiel');
  if (!sessie) {
    // Geen geldige sessie op te halen. Offline met een eerder profiel? Dan toch de lokale kopie tonen.
    if (bewaard && !navigator.onLine) { offline = true; return bewaard; }
    return null;
  }
  try {
    const p = await bron.mijnProfiel(sessie.user.id);
    await db.put('profiel', p);
    return p;
  } catch {
    if (bewaard && bewaard.id === sessie.user.id) { offline = true; return bewaard; }
    return { id: sessie.user.id, email: sessie.user.email, rol: null };
  }
}

let laatsteBijwerk = 0;
async function werkBij(meteen = false) {
  if (!navigator.onLine) return;
  if (!meteen && Date.now() - laatsteBijwerk < SYNC_INTERVAL_MIN * 60 * 1000) return;
  laatsteBijwerk = Date.now();
  try {
    const r = await synchroniseer((n, totaal) => { if (totaal > 3) melding(`Fiches ophalen… ${n}/${totaal}`); });
    structuur = r.structuur;
    await vernieuwFavorieten();
    if (offline) offline = false;
    // Scherm vernieuwen, behalve als er net een venster open staat of een fiche/spel bekeken wordt
    const delen = pad();
    const bezig = $('#dialoog').open || $('#mand-dialoog').open || delen.length === 4 || delen[0] === 'games';
    if (!bezig) toon();
    if (r.mislukt) melding(`${r.mislukt} ${r.mislukt === 1 ? 'fiche kon' : 'fiches konden'} niet opgehaald worden. Later opnieuw.`);
    else if (r.nieuw > 3) melding(`${r.nieuw} fiches bijgewerkt.`);
  } catch {
    // Geen verbinding of server onbereikbaar: gewoon de lokale kopie blijven tonen
  }
}

function toonAanmelden(foutTekst, qr = null) {
  document.title = structuur.appTitel;
  $('#beheer').hidden = true;
  $('#instellingen').hidden = true;
  $('#terug').hidden = true;
  $('#kruimels').innerHTML = `<span class="huidig">${esc(structuur.appTitel)}</span>`;
  inhoud.innerHTML = `
    <div class="aanmelden">
      <h1>Aanmelden</h1>
      <p class="ondertitel">Meld je aan met je account van de praktijk, of met de patiëntcode van je kinesitherapeut.</p>
      <form id="aanmeld-form" class="paneel">
        <label>E-mailadres of patiëntcode<input type="text" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
        <label>Wachtwoord<input type="password" name="wachtwoord" autocomplete="current-password" required></label>
        <p class="fout" id="aanmeld-fout" ${foutTekst ? '' : 'hidden'}>${esc(foutTekst || '')}</p>
        <div class="knoppen">
          <button class="knop knop-hoofd" type="submit">Aanmelden</button>
          <button class="knop knop-plat" type="button" id="vergeten">Wachtwoord vergeten?</button>
        </div>
      </form>
      ${navigator.onLine ? '' : '<p class="hulp">Je bent offline. Aanmelden lukt pas met internet.</p>'}
    </div>`;
  const form = $('#aanmeld-form');
  const fout = $('#aanmeld-fout');
  if (qr) setTimeout(() => {
    form.email.value = qr.code;
    form.wachtwoord.value = qr.ww;
    form.requestSubmit();
  }, 0);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const knop = form.querySelector('[type=submit]');
    knop.disabled = true;
    fout.hidden = true;
    try {
      const id = form.email.value.trim();
      await bron.aanmelden(bron.isPatientCode(id) ? bron.codeNaarEmail(id) : id, form.wachtwoord.value.trim());
      try { sessionStorage.setItem('netAangemeld', '1'); } catch { /* privémodus */ }
      location.reload();
    } catch (err) {
      fout.textContent = err.message;
      fout.hidden = false;
      knop.disabled = false;
    }
  });
  $('#vergeten').addEventListener('click', async () => {
    if (bron.isPatientCode(form.email.value)) { melding('Vraag je kinesitherapeut om een nieuwe toegangscode.'); return; }
    const r = await dialoog({
      titel: 'Wachtwoord vergeten',
      velden: [
        { soort: 'uitleg', tekst: 'Je krijgt een mail met een link om een nieuw wachtwoord te kiezen.' },
        { naam: 'email', label: 'E-mailadres', type: 'email', inputmode: 'email', waarde: form.email.value, verplicht: true }
      ],
      okTekst: 'Mail versturen'
    });
    if (!r) return;
    try {
      await bron.wachtwoordVergeten(r.email);
      melding('Mail verstuurd. Kijk in je mailbox (ook bij ongewenste mail).');
    } catch (err) { melding(err.message); }
  });
}

async function vraagNieuwWachtwoord(linkType) {
  const welkom = linkType === 'invite';
  for (;;) {
    const r = await dialoog({
      titel: welkom ? 'Welkom! Kies een wachtwoord' : 'Nieuw wachtwoord kiezen',
      velden: [
        { soort: 'uitleg', tekst: 'Minstens 8 tekens. Hiermee meld je je voortaan aan.' },
        { naam: 'w1', label: 'Wachtwoord', type: 'password', autocomplete: 'new-password', verplicht: true },
        { naam: 'w2', label: 'Nog eens hetzelfde wachtwoord', type: 'password', autocomplete: 'new-password', verplicht: true }
      ],
      okTekst: 'Bewaren'
    });
    if (!r) { if (welkom) melding('Je kan later een wachtwoord kiezen via "Wachtwoord vergeten?".'); return; }
    if (r.w1.length < 8) { melding('Het wachtwoord moet minstens 8 tekens hebben.'); continue; }
    if (r.w1 !== r.w2) { melding('De twee wachtwoorden zijn niet gelijk.'); continue; }
    try {
      await bron.nieuwWachtwoord(r.w1);
      melding('Wachtwoord bewaard.');
      return;
    } catch (e) { melding(e.message); }
  }
}

function toonGeenToegang() {
  document.title = structuur.appTitel;
  $('#beheer').hidden = true;
  $('#instellingen').hidden = true;
  $('#terug').hidden = true;
  $('#kruimels').innerHTML = `<span class="huidig">${esc(structuur.appTitel)}</span>`;
  const patient = profiel.rol === 'patient';
  inhoud.innerHTML = `
    <div class="aanmelden">
      <h1>${patient ? 'Mijn programma' : 'Nog geen toegang'}</h1>
      <div class="paneel">
        <p>${patient
          ? 'Je oefenprogramma verschijnt hier binnenkort.'
          : /@patienten\./.test(profiel.email || '')
            ? `Je account met code <b>${esc(profiel.email.split('@')[0].toUpperCase())}</b> is nog niet klaar. Vraag je kinesitherapeut om het na te kijken en open de app daarna opnieuw.`
            : `Je bent aangemeld als <b>${esc(profiel.email)}</b>, maar je account is nog niet geactiveerd. Vraag de beheerder van de praktijk om je toegang te geven en open de app daarna opnieuw.`}</p>
        <div class="knoppen"><button class="knop knop-plat" id="afmelden">Afmelden</button></div>
      </div>
    </div>`;
  $('#afmelden').addEventListener('click', async () => { await bron.afmelden(); await db.del('profiel'); location.reload(); });
}

// ---------- Navigatie ----------

function pad() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

// Zoek de knopen langs het pad. Geeft [onderdeel, regio, categorie, fiche] terug (zo ver als bestaat).
function zoek(delen) {
  const keten = [];
  let lijst = structuur.secties;
  for (let i = 0; i < delen.length && i < 3; i++) {
    const k = (lijst || []).find(x => x.id === delen[i]);
    if (!k) return null;
    keten.push(k);
    lijst = k.kinderen;
  }
  if (delen.length === 4) {
    const f = (keten[2].fiches || []).find(x => x.id === delen[3]);
    if (!f) return null;
    keten.push(f);
  }
  return keten;
}

function link(ids) {
  return '#/' + ids.map(encodeURIComponent).join('/');
}

function toonKruimels(keten, ids) {
  const nav = $('#kruimels');
  const stukken = [`<a href="#/">${esc(structuur.appTitel)}</a>`];
  keten.forEach((k, i) => {
    stukken.push('<span class="sep">›</span>');
    if (i === keten.length - 1) stukken.push(`<span class="huidig">${esc(k.titel)}</span>`);
    else stukken.push(`<a href="${link(ids.slice(0, i + 1))}">${esc(k.titel)}</a>`);
  });
  if (!keten.length) stukken[0] = `<span class="huidig">${esc(structuur.appTitel)}</span>`;
  nav.innerHTML = stukken.join(' ');
}

// Volledig scherm voor de spellen: het spel zet het aan bij Start (games/spel.js); de app zet het uit als je het spel verlaat
function volScherm(aan) {
  const d = document, el = d.documentElement;
  const actief = d.fullscreenElement || d.webkitFullscreenElement;
  try {
    if (aan && !actief) Promise.resolve((el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)).catch(() => {});
    else if (!aan && actief) Promise.resolve((d.exitFullscreen || d.webkitExitFullscreen)?.call(d)).catch(() => {});
  } catch { /* niet ondersteund (bv. iPhone) */ }
}

async function toon() {
  if (actieveUrl) { URL.revokeObjectURL(actieveUrl); actieveUrl = null; }
  if (!(pad()[0] === 'games' && pad()[1])) volScherm(false);
  document.body.classList.remove('spel-modus');
  werkKiesbalkBij(gedeeld() && beheer);
  $('#beheer').setAttribute('aria-pressed', String(beheer));
  $('#instellingen').hidden = !beheer;
  document.title = structuur.appTitel;

  const delen = pad();
  if (delen[0] === 'instellingen') {
    if (!beheer) { location.hash = '#/'; return; }
    $('#terug').hidden = false;
    $('#kruimels').innerHTML = `<a href="#/">${esc(structuur.appTitel)}</a> <span class="sep">›</span> <span class="huidig">Instellingen</span>`;
    return toonInstellingen();
  }

  if (delen[0] === 'games') return toonGames(delen[1]);
  if (delen[0] === 'zoeken') return toonZoeken(delen[1] || '');
  if (delen[0] === 'patienten') {
    if (!gedeeld() || !beheer) { location.hash = '#/'; return; } // patiëntgegevens enkel in Beheer (achter de pincode)
    return toonTherapeut(delen.slice(1));
  }
  if (delen[0] === 'protocollen') {
    if (!gedeeld() || !beheer) { location.hash = '#/'; return; }
    return toonProtocollen(delen.slice(1));
  }
  if (delen[0] === 'schema') {
    if (!gedeeld() || !beheer) { location.hash = '#/'; return; }
    return toonSchema(delen.slice(1));
  }

  const keten = zoek(delen);
  if (!keten) { location.hash = '#/'; return; }
  $('#terug').hidden = delen.length === 0;
  toonKruimels(keten, delen);

  if (delen.length === 4) return toonFiche(keten, delen);
  if (delen.length === 3) return toonFicheLijst(keten, delen);
  return toonTegels(keten, delen);
}

// ---------- Games ----------
// De spellen staan in data/games.json, de spelbestanden zelf in de map games/.
// Een spel zonder "bestand" verschijnt als "Binnenkort".

function gamesTegel() {
  return `
      <div class="tegel tegel-games">
        <a class="tegel-link" href="#/games">
          <span class="tegel-titel">${esc(games.titel)}</span>
          ${games.omschrijving ? `<span class="tegel-sub">${esc(games.omschrijving)}</span>` : ''}
        </a>
        ${beheer ? '<div class="tegel-acties"><button disabled>Vast onderdeel (data/games.json)</button></div>' : ''}
      </div>`;
}

function toonGames(spelId) {
  $('#terug').hidden = false;
  const thuis = `<a href="#/">${esc(structuur.appTitel)}</a> <span class="sep">›</span>`;

  if (spelId) {
    const spel = games.games.find(g => g.id === spelId && g.bestand);
    if (!spel) { location.hash = '#/games'; return; }
    $('#kruimels').innerHTML = `${thuis} <a href="#/games">${esc(games.titel)}</a> <span class="sep">›</span> <span class="huidig">${esc(spel.titel)}</span>`;
    document.body.classList.add('spel-modus');
    inhoud.innerHTML = `<iframe class="spel" src="${esc(spel.bestand)}" title="${esc(spel.titel)}" allow="fullscreen"></iframe>`;
    return;
  }

  $('#kruimels').innerHTML = `${thuis} <span class="huidig">${esc(games.titel)}</span>`;
  const tegels = games.games.map(g => g.bestand
    ? `<div class="tegel"><a class="tegel-link" href="#/games/${encodeURIComponent(g.id)}">
         <span class="tegel-titel">${esc(g.titel)}</span>
         ${g.omschrijving ? `<span class="tegel-sub">${esc(g.omschrijving)}</span>` : ''}
       </a></div>`
    : `<div class="tegel tegel-binnenkort"><div class="tegel-link">
         <span class="tegel-soort">Binnenkort</span>
         <span class="tegel-titel">${esc(g.titel)}</span>
         ${g.omschrijving ? `<span class="tegel-sub">${esc(g.omschrijving)}</span>` : ''}
       </div></div>`
  ).join('');
  inhoud.innerHTML = `
    <h1>${esc(games.titel)}</h1>
    <p class="ondertitel">Kies een spel.</p>
    <div class="tegels groot">${tegels}</div>`;
}

// Een spel (in het iframe) kan zijn score laten bewaren bij een patiënt, als dubbeltaak bij een test.
// Het spel kent geen patiënten: het stuurt enkel zijn resultaat, de app vraagt patiënt, testmoment en test.
const magSpelBewaren = () => gedeeld() && isTeam() && profiel?.rol !== 'patient';

window.addEventListener('message', async e => {
  if (e.origin !== location.origin) return;
  const frame = document.querySelector('iframe.spel');
  if (!frame || e.source !== frame.contentWindow) return;
  const m = e.data || {};
  const antwoord = bericht => e.source.postMessage(bericht, location.origin);
  if (m.soort === 'spel-geladen') antwoord({ soort: 'spel-context', kanBewaren: magSpelBewaren() });
  if (m.soort === 'spel-bewaar' && magSpelBewaren() && m.resultaat) {
    let uit;
    try { uit = await bewaarSpelBijPatient(m.resultaat); }
    catch (fout) { uit = { ok: false, tekst: /dubbeltaak/i.test(fout.message || '') ? 'De dubbeltaak staat nog niet in Supabase (015_dubbeltaak.sql).' : (fout.message || 'Er liep iets mis.') }; }
    antwoord({ soort: 'spel-bewaard', ...uit });
  }
});

async function bewaarSpelBijPatient(r) {
  const naamVan = p => p.naam ? `${p.naam} (${p.code})` : p.code;
  const lijst = (await bron.patienten()).sort((a, b) => naamVan(a).localeCompare(naamVan(b), 'nl'));
  if (!lijst.length) return { ok: false, tekst: 'Er zijn nog geen patiënten.' };
  const scoreTekst = `${r.spel_titel}: ${r.score}/${r.max}${r.niveau === 'eigen' ? ', eigen niveau' : `, niveau ${r.niveau}`}`;

  const stap1 = await dialoog({
    titel: 'Score toevoegen aan patiënt', okTekst: 'Verder',
    velden: [
      { soort: 'uitleg', tekst: scoreTekst },
      { naam: 'patient', label: 'Patiënt', soort: 'keuze', waarde: lijst[0].id, opties: lijst.map(p => ({ waarde: p.id, label: naamVan(p) })) }
    ]
  });
  if (!stap1) return { ok: false, tekst: 'Niet bewaard.' };
  const p = lijst.find(x => x.id === stap1.patient);
  const traject = (await bron.trajectenVan(p.id)).find(x => x.actief);
  if (!traject) return { ok: false, tekst: `${naamVan(p)} heeft nog geen protocol. Wijs eerst een protocol toe bij Opvolging.` };
  const [momenten, tests] = await Promise.all([bron.testmomentenVan(traject.id), bron.tests()]);
  if (!tests.length) return { ok: false, tekst: 'Er staan nog geen tests in de testlijst.' };

  const d = new Date();
  const vandaagIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const datumTekst = iso => new Date(iso + 'T00:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
  const vanVandaag = [...momenten].reverse().find(tm => tm.datum === vandaagIso);
  const stap2 = await dialoog({
    titel: 'Bij welke test hoort de dubbeltaak?', okTekst: 'Bewaren',
    velden: [
      { soort: 'uitleg', tekst: `${naamVan(p)} · ${scoreTekst}` },
      { naam: 'moment', label: 'Testmoment', soort: 'keuze', waarde: vanVandaag?.id || 'nieuw',
        opties: [{ waarde: 'nieuw', label: 'Nieuw testmoment vandaag' },
          ...[...momenten].reverse().map(tm => ({ waarde: tm.id, label: datumTekst(tm.datum) + (tm.notitie ? ` · ${tm.notitie}` : '') }))] },
      { naam: 'test', label: 'Test (motorische taak)', soort: 'keuze', waarde: tests[0]?.id,
        opties: tests.map(x => ({ waarde: x.id, label: `${x.groep} · ${x.naam}` })),
        hulp: 'De score van het spel komt bij deze test als dubbeltaak. De waarden van de test zelf vul je in bij het testmoment.' }
    ]
  });
  if (!stap2) return { ok: false, tekst: 'Niet bewaard.' };

  let tm = momenten.find(x => x.id === stap2.moment);
  const test = tests.find(x => x.id === stap2.test);
  const metingVan = moment => moment?.metingen?.find(x => x.test_id === test.id);
  // Gewone waarden (zonder dubbeltaak) van deze test op dit testmoment?
  const heeftWaarden = m => !!m && ([m.links, m.rechts, m.waarde].some(v => v != null) || !!m.tekst);
  let bestaand = metingVan(tm);
  if (heeftWaarden(bestaand) && !bestaand.dubbeltaak) {
    // Per testmoment heeft een test één meting. De score hier bijzetten zou de gewone meting omzetten naar een
    // meting met dubbeltaak. Daarom komt de dubbeltaak in een apart testmoment.
    if (!await bevestig('Apart testmoment voor de dubbeltaak?',
      `Op ${datumTekst(tm.datum)} staat bij ${test.naam} al een gewone meting, zonder dubbeltaak. Die blijft zoals ze is. ` +
      'De score komt in een apart testmoment van vandaag ("Dubbeltaak"). Daar vul je de waarden van de test met dubbeltaak in.', 'Apart bewaren')) {
      return { ok: false, tekst: 'Niet bewaard.' };
    }
    // Een eerder dubbeltaak-testmoment van vandaag waar deze test nog vrij is (of al een dubbeltaak heeft), anders een nieuw
    tm = [...momenten].reverse().find(x => x.datum === vandaagIso && x.id !== tm.id && x.notitie === 'Dubbeltaak'
      && (!metingVan(x) || metingVan(x).dubbeltaak)) || null;
    bestaand = metingVan(tm);
  }
  if (bestaand?.dubbeltaak && !await bevestig('Dubbeltaak vervangen?',
    `Bij ${test.naam} staat al een dubbeltaak (${bestaand.dubbeltaak.spel_titel || 'spel'}). Die wordt vervangen.`, 'Vervangen')) {
    return { ok: false, tekst: 'Niet bewaard.' };
  }
  if (!tm) tm = await bron.maakTestmoment({ traject_id: traject.id, datum: vandaagIso, notitie: 'Dubbeltaak', door: profiel?.id || null });

  const { spel, spel_titel, niveau, omschrijving, score, max, perfecte_rondes, kleur, eindtempo, datum } = r;
  await bron.zetMeting(tm.id, test.id, { dubbeltaak: { spel, spel_titel, niveau, omschrijving, score, max, perfecte_rondes, kleur, eindtempo, datum } });
  melding('Bewaard.');
  return { ok: true, tekst: `Bewaard bij ${naamVan(p)}: ${test.naam}, testmoment ${datumTekst(tm.datum)}.` };
}

// ---------- Zoeken ----------

function zoekbalk(term) {
  return `
    <form class="zoekbalk" id="zoek-form" role="search">
      <input type="search" name="q" value="${esc(term)}" placeholder="Zoek een fiche, bv. knie of kracht"
        aria-label="Zoek een fiche" enterkeyhint="search" autocomplete="off">
      <button class="knop knop-hoofd" type="submit">Zoeken</button>
    </form>`;
}

// live = op de zoekpagina zelf (resultaten bijwerken tijdens het typen)
function koppelZoekbalk(live, bijTypen) {
  const form = $('#zoek-form');
  const veld = form.querySelector('[name=q]');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (live) { veld.blur(); return; } // klavier wegdoen
    if (veld.value.trim()) location.hash = '#/zoeken/' + encodeURIComponent(veld.value.trim());
  });
  if (live) veld.addEventListener('input', () => {
    history.replaceState(null, '', '#/zoeken/' + encodeURIComponent(veld.value));
    bijTypen(veld.value);
  });
  return veld;
}

async function toonZoeken(term) {
  $('#terug').hidden = false;
  $('#kruimels').innerHTML = `<a href="#/">${esc(structuur.appTitel)}</a> <span class="sep">›</span> <span class="huidig">Zoeken</span>`;
  inhoud.innerHTML = `
    <h1>Zoeken</h1>
    <p class="ondertitel">Zoekt in de titel, de omschrijving, de map en de tekst van tekstfiches.</p>
    ${zoekbalk(term)}
    <div id="zoek-resultaten"></div>`;

  const alle = alleFichesMetPlaats();
  const teksten = new Map(); // tekst van tekstfiches, ingeladen zodra de pagina opent

  const toonResultaten = q => {
    const box = $('#zoek-resultaten');
    if (!box) return;
    const woorden = zoekNormaal(q).split(/\s+/).filter(Boolean);
    if (!woorden.length) { box.innerHTML = ''; return; }
    const hits = alle.filter(x => {
      const hooiberg = zoekNormaal(`${x.f.titel} ${x.f.omschrijving} ${x.pad}`) + ' ' + (teksten.get(x.f.id) || '');
      return woorden.every(w => hooiberg.includes(w));
    });
    box.innerHTML = `<p class="ondertitel">${hits.length ? `${hits.length} ${hits.length === 1 ? 'fiche' : 'fiches'} gevonden.` : 'Niets gevonden. Probeer een ander woord.'}</p>
      ${hits.length ? `<div class="tegels">${hits.map(ficheTegel).join('')}</div>` : ''}`;
    koppelKiesKnoppen(box);
  };

  const veld = koppelZoekbalk(true, toonResultaten);
  toonResultaten(term);
  if (!term) veld.focus();

  await Promise.all(alle.filter(x => x.f.soort === 'tekst').map(async x => {
    const inh = await db.getFiche(x.f.id);
    teksten.set(x.f.id, zoekNormaal(inh?.tekst));
  }));
  if (pad()[0] === 'zoeken' && veld.isConnected) toonResultaten(veld.value);
}

// Rijen onderaan het startscherm: favorieten en laatst bekeken
function startRijen() {
  const alle = alleFichesMetPlaats();
  const perId = new Map(alle.map(x => [x.f.id, x]));
  const fav = alle.filter(x => favorieten.has(x.f.id));
  const recent = laatstBekeken().map(id => perId.get(id)).filter(Boolean);
  const rij = (titel, lijst) => lijst.length
    ? `<h2 class="rij-titel">${titel}</h2><div class="tegels">${lijst.map(ficheTegel).join('')}</div>` : '';
  return rij('★ Favorieten', fav) + rij('Laatst bekeken', recent);
}

// ---------- Tegels: onderdelen, regio's, categorieën ----------

function toonTegels(keten, ids) {
  const diepte = ids.length;          // 0 = onderdelen, 1 = regio's, 2 = categorieën
  const ouder = keten[diepte - 1];
  const lijst = diepte === 0 ? structuur.secties : ouder.kinderen;
  const naam = niveauNaam(diepte);

  const titel = diepte === 0 ? structuur.appTitel : ouder.titel;
  const sub = diepte === 0 ? 'Kies een onderdeel.' : (diepte === 1 ? 'Kies een regio.' : 'Kies een categorie.');

  const tegelVoor = (k, i) => {
    const aantal = diepte === 2 ? (k.fiches || []).length : null;
    const onder = diepte === 0 && k.omschrijving ? k.omschrijving
      : aantal !== null ? `${aantal} ${aantal === 1 ? 'fiche' : 'fiches'}` : '';
    return `
      <div class="tegel">
        <a class="tegel-link" href="${link([...ids, k.id])}">
          <span class="tegel-titel">${esc(k.titel)}</span>
          ${onder ? `<span class="tegel-sub">${esc(onder)}</span>` : ''}
        </a>
        ${beheer ? beheerKnoppen(i, lijst.length) : ''}
      </div>`;
  };
  const nieuwKnop = beheer ? `<button class="tegel-nieuw" data-actie="nieuw">+ ${esc(naam)} toevoegen</button>` : '';

  if (diepte === 0 && gedeeld() && beheer) {
    // Startscherm van het team: Patiënten, Revalidatieprotocols en Games bovenaan, fiches eronder
    const isProtocolMap = k => /revalidatieprotocol/i.test(k.titel || '');
    const boven = lijst.map((k, i) => isProtocolMap(k) ? tegelVoor(k, i) : '').join('');
    const onder = lijst.map((k, i) => isProtocolMap(k) ? '' : tegelVoor(k, i)).join('');
    inhoud.innerHTML = `
    <h1>${esc(titel)}</h1>
    <div class="tegels groot">
      ${patientenTegel()}
      ${boven}
      ${games.games.length ? gamesTegel() : ''}
    </div>
    <h2 class="rij-titel">Fiches</h2>
    ${zoekbalk('')}
    <div class="tegels groot">
      ${onder}
      ${nieuwKnop}
    </div>
    ${startRijen()}`;
  } else {
    inhoud.innerHTML = `
    <h1>${esc(titel)}</h1>
    <p class="ondertitel">${sub}</p>
    ${diepte === 0 ? zoekbalk('') : ''}
    ${!lijst.length && !beheer ? `<div class="leeg">Hier staat nog niets. Zet <b>Beheer</b> aan om iets toe te voegen.</div>` : ''}
    <div class="tegels ${diepte === 0 ? 'groot' : ''}">
      ${lijst.map(tegelVoor).join('')}
      ${diepte === 0 && games.games.length ? gamesTegel() : ''}
      ${nieuwKnop}
    </div>
    ${diepte === 0 ? startRijen() : ''}`;
  }

  if (diepte === 0) {
    koppelZoekbalk(false);
    koppelKiesKnoppen(inhoud);
  }
  koppelBeheer(lijst, naam, diepte, ouder);
}

function beheerKnoppen(i, n, metVerplaats = false) {
  return `
    <div class="tegel-acties">
      <button data-actie="op" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Naar voren">◀</button>
      <button data-actie="neer" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Naar achteren">▶</button>
      <button data-actie="hernoem" data-i="${i}">Wijzig</button>
      ${metVerplaats ? `<button data-actie="verplaats" data-i="${i}" aria-label="Verplaats naar een andere categorie">Naar…</button>` : ''}
      <button data-actie="weg" data-i="${i}" class="weg">Wis</button>
    </div>`;
}

function koppelBeheer(lijst, naam, diepte, ouder) {
  inhoud.querySelectorAll('[data-actie]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const i = Number(knop.dataset.i);
      const actie = knop.dataset.actie;
      if (gedeeld()) {
        if (await beheerGedeeld(actie, lijst, i, naam, diepte, ouder)) toon();
        return;
      }
      if (actie === 'nieuw') {
        const n = await vraagNaam(`${naam} toevoegen`);
        if (!n) return;
        const k = { id: nieuwId(), titel: n };
        if (diepte === 0) { k.omschrijving = ''; k.kinderen = []; }
        else if (diepte === 1) k.kinderen = [];
        else k.fiches = [];
        lijst.push(k);
      } else if (actie === 'op' || actie === 'neer') {
        const j = actie === 'op' ? i - 1 : i + 1;
        [lijst[i], lijst[j]] = [lijst[j], lijst[i]];
      } else if (actie === 'hernoem') {
        const velden = [{ naam: 'naam', label: 'Naam', waarde: lijst[i].titel, verplicht: true }];
        if (diepte === 0) velden.push({ naam: 'omschrijving', label: 'Korte omschrijving (optioneel)', waarde: lijst[i].omschrijving });
        const r = await dialoog({ titel: `${naam} wijzigen`, velden });
        if (!r || !r.naam) return;
        lijst[i].titel = r.naam;
        if (diepte === 0) lijst[i].omschrijving = r.omschrijving;
      } else if (actie === 'weg') {
        const ids = ficheIdsOnder(lijst[i]);
        const extra = ids.length ? ` Ook ${ids.length} ${ids.length === 1 ? 'fiche wordt' : 'fiches worden'} gewist.` : '';
        if (!await bevestig(`"${lijst[i].titel}" wissen?`, `Dit kan je niet ongedaan maken.${extra}`)) return;
        await db.deleteFiches(ids);
        lijst.splice(i, 1);
      }
      await bewaar();
      toon();
    });
  });
}

// Beheer van onderdelen, regio's en categorieën in de gedeelde modus (rechtstreeks in Supabase)
async function beheerGedeeld(actie, lijst, i, naam, diepte, ouder) {
  const k = lijst[i];
  if (actie === 'nieuw') {
    const n = await vraagNaam(`${naam} toevoegen`);
    if (!n) return false;
    return schrijf(() => bron.maakKnoop({
      ouder_id: diepte === 0 ? null : ouder.id, niveau: diepte, titel: n, volgorde: volgendeVolgorde(lijst)
    }));
  }
  if (actie === 'op' || actie === 'neer') {
    return schrijf(() => bron.zetVolgorde('knopen', nieuweVolgorde(lijst, i, actie === 'op' ? i - 1 : i + 1)));
  }
  if (actie === 'hernoem') {
    const velden = [{ naam: 'naam', label: 'Naam', waarde: k.titel, verplicht: true }];
    if (diepte === 0) velden.push({ naam: 'omschrijving', label: 'Korte omschrijving (optioneel)', waarde: k.omschrijving });
    const r = await dialoog({ titel: `${naam} wijzigen`, velden });
    if (!r || !r.naam) return false;
    return schrijf(() => bron.wijzigKnoop(k.id, diepte === 0 ? { titel: r.naam, omschrijving: r.omschrijving } : { titel: r.naam }));
  }
  if (actie === 'weg') {
    const fiches = fichesOnder(k);
    const extra = fiches.length ? ` Ook ${fiches.length} ${fiches.length === 1 ? 'fiche wordt' : 'fiches worden'} gewist, voor het hele team.` : ' Dit geldt voor het hele team.';
    if (!await bevestig(`"${k.titel}" wissen?`, `Dit kan je niet ongedaan maken.${extra}`)) return false;
    return schrijf(() => bron.wisKnoop(k.id, fiches.map(f => f.pad)));
  }
  return false;
}

// ---------- Fiches in een categorie ----------

function toonFicheLijst(keten, ids) {
  const cat = keten[2];
  const fiches = cat.fiches;

  const tegels = fiches.map((f, i) => `
    <div class="tegel tegel-fiche">
      ${kiesKnop(f)}
      <a class="tegel-link" href="${link([...ids, f.id])}">
        <span class="tegel-soort">${SOORT_LABEL[f.soort] || ''}</span>
        <span class="tegel-titel">${esc(f.titel)}</span>
        ${f.omschrijving ? `<span class="tegel-sub">${esc(f.omschrijving)}</span>` : ''}
      </a>
      ${beheer ? beheerKnoppen(i, fiches.length, true) : ''}
    </div>`).join('');

  inhoud.innerHTML = `
    <h1>${esc(cat.titel)}</h1>
    <p class="ondertitel">${esc(keten[0].titel)} · ${esc(keten[1].titel)}</p>
    <div id="protocol-vak"></div>
    ${beheer ? `
      <div class="beheer-balk">
        <label class="knop knop-hoofd">
          Bestanden toevoegen (PDF, foto of video)
          <input type="file" id="upload" accept="${UPLOAD_TYPES}" multiple hidden>
        </label>
        <button class="knop knop-plat" id="nieuwe-tekst">Tekstfiche schrijven</button>
      </div>` : ''}
    ${!fiches.length ? `<div class="leeg">Nog geen fiches in deze categorie.${beheer ? '' : ' Zet <b>Beheer</b> aan om fiches toe te voegen.'}</div>` : ''}
    <div class="tegels">${tegels}</div>`;
  koppelKiesKnoppen(inhoud);
  // Revalidatieprotocol dat bij deze categorie hoort (gedeelde modus)
  if (gedeeld() && hulp?.protocolInCategorie) hulp.protocolInCategorie($('#protocol-vak'), keten, ids, beheer);

  if (!beheer) return;
  if (gedeeld()) return koppelFicheBeheerGedeeld(cat, fiches);

  $('#upload').addEventListener('change', async e => {
    const bestanden = [...e.target.files];
    let ok = 0;
    for (const b of bestanden) {
      const soort = soortVan(b.type);
      if (!soort) { melding(`${b.name}: enkel PDF, foto of video.`); continue; }
      const id = nieuwId();
      await db.putFiche({ id, mime: b.type, bestandsnaam: b.name, data: await b.arrayBuffer() });
      fiches.push({ id, titel: b.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), omschrijving: '', soort });
      ok++;
    }
    await bewaar();
    if (ok) melding(`${ok} ${ok === 1 ? 'fiche' : 'fiches'} toegevoegd.`);
    toon();
  });

  $('#nieuwe-tekst').addEventListener('click', async () => {
    const r = await tekstDialoog('Tekstfiche schrijven');
    if (!r) return;
    const id = nieuwId();
    await db.putFiche({ id, tekst: r.tekst });
    fiches.push({ id, titel: r.titel, omschrijving: r.omschrijving, soort: 'tekst' });
    await bewaar();
    toon();
  });

  inhoud.querySelectorAll('[data-actie]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const i = Number(knop.dataset.i);
      const f = fiches[i];
      const actie = knop.dataset.actie;
      if (actie === 'op' || actie === 'neer') {
        const j = actie === 'op' ? i - 1 : i + 1;
        [fiches[i], fiches[j]] = [fiches[j], fiches[i]];
      } else if (actie === 'hernoem') {
        if (!await bewerkFiche(f)) return;
      } else if (actie === 'verplaats') {
        const doel = await kiesDoelCategorie(f, cat);
        if (!doel) return;
        fiches.splice(i, 1);
        (doel.fiches = doel.fiches || []).push(f);
        melding(`"${f.titel}" verplaatst.`);
      } else if (actie === 'weg') {
        if (!await bevestig(`"${f.titel}" wissen?`, 'Dit kan je niet ongedaan maken.')) return;
        await db.deleteFiches([f.id]);
        fiches.splice(i, 1);
      }
      await bewaar();
      toon();
    });
  });
}

function koppelFicheBeheerGedeeld(cat, fiches) {
  $('#upload').addEventListener('change', async e => {
    const bestanden = [...e.target.files];
    e.target.value = '';
    let ok = 0;
    const gelukt = await schrijf(async () => {
      let volgorde = volgendeVolgorde(fiches);
      for (const [n, b] of bestanden.entries()) {
        const soort = soortVan(b.type);
        if (!soort) { melding(`${b.name}: enkel PDF, foto of video.`); continue; }
        if (b.size > MAX_UPLOAD_MB * 1024 * 1024) { melding(`${b.name}: groter dan ${MAX_UPLOAD_MB} MB, te groot voor de gedeelde opslag.`); continue; }
        melding(`Uploaden… ${n + 1}/${bestanden.length}`);
        const id = uuid();
        const rij = await bron.maakFiche({
          id, categorie_id: cat.id, soort, volgorde: volgorde++,
          titel: b.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Fiche',
          bestand_pad: `${id}/${veiligeBestandsnaam(b.name)}`, mime: b.type, bestandsnaam: b.name, grootte: b.size
        }, b);
        // Meteen in de lokale kopie, zodat het niet opnieuw gedownload moet worden
        await db.putFiche({ id, mime: b.type, bestandsnaam: b.name, data: await b.arrayBuffer(), versie: rij.bijgewerkt });
        ok++;
      }
    });
    if (ok) melding(`${ok} ${ok === 1 ? 'fiche' : 'fiches'} toegevoegd voor het hele team.`);
    if (gelukt || ok) toon();
  });

  $('#nieuwe-tekst').addEventListener('click', async () => {
    const r = await tekstDialoog('Tekstfiche schrijven');
    if (!r) return;
    if (await schrijf(() => bron.maakFiche({
      id: uuid(), categorie_id: cat.id, soort: 'tekst', titel: r.titel, omschrijving: r.omschrijving,
      tekst: r.tekst, volgorde: volgendeVolgorde(fiches)
    }))) toon();
  });

  inhoud.querySelectorAll('[data-actie]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const i = Number(knop.dataset.i);
      const f = fiches[i];
      const actie = knop.dataset.actie;
      let gelukt = false;
      if (actie === 'op' || actie === 'neer') {
        gelukt = await schrijf(() => bron.zetVolgorde('fiches', nieuweVolgorde(fiches, i, actie === 'op' ? i - 1 : i + 1)));
      } else if (actie === 'hernoem') {
        gelukt = await bewerkFiche(f);
      } else if (actie === 'verplaats') {
        const doel = await kiesDoelCategorie(f, cat);
        if (!doel) return;
        gelukt = await schrijf(() => bron.wijzigFiche(f.id, { categorie_id: doel.id, volgorde: volgendeVolgorde(doel.fiches || []) }));
        if (gelukt) melding(`"${f.titel}" verplaatst voor het hele team.`);
      } else if (actie === 'weg') {
        if (!await bevestig(`"${f.titel}" wissen?`, 'Dit kan je niet ongedaan maken. De fiche verdwijnt voor het hele team.')) return;
        gelukt = await schrijf(() => bron.wisFiche(f.id, f.pad));
      }
      if (gelukt) toon();
    });
  });
}

async function kiesDoelCategorie(f, huidige) {
  const opties = alleCategorieen();
  const r = await dialoog({
    titel: `"${f.titel}" verplaatsen`,
    okTekst: 'Verplaatsen',
    velden: [{ naam: 'doel', label: 'Naar categorie', soort: 'keuze', waarde: huidige.id,
      opties: opties.map(o => ({ waarde: o.cat.id, label: o.pad })) }]
  });
  if (!r || r.doel === huidige.id) return null;
  return opties.find(o => o.cat.id === r.doel)?.cat || null;
}

const HULP_TEKST ='Lege regel = nieuwe alinea. "# " vooraan = tussentitel. "- " vooraan = opsomming.';

function tekstDialoog(titel, f = {}, tekst = '') {
  return dialoog({
    titel,
    okTekst: 'Bewaren',
    velden: [
      { naam: 'titel', label: 'Titel', waarde: f.titel, verplicht: true },
      { naam: 'omschrijving', label: 'Korte omschrijving (optioneel)', waarde: f.omschrijving },
      { naam: 'tekst', label: 'Tekst', soort: 'tekstvak', waarde: tekst, hulp: HULP_TEKST }
    ]
  });
}

async function bewerkFiche(f) {
  if (gedeeld()) {
    let r;
    if (f.soort === 'tekst') {
      const inh = await db.getFiche(f.id);
      r = await tekstDialoog('Fiche wijzigen', f, inh?.tekst || '');
    } else {
      r = await dialoog({
        titel: 'Fiche wijzigen', okTekst: 'Bewaren',
        velden: [
          { naam: 'titel', label: 'Titel', waarde: f.titel, verplicht: true },
          { naam: 'omschrijving', label: 'Korte omschrijving (optioneel)', waarde: f.omschrijving }
        ]
      });
    }
    if (!r) return false;
    const velden = { titel: r.titel, omschrijving: r.omschrijving };
    if (f.soort === 'tekst') velden.tekst = r.tekst;
    return schrijf(() => bron.wijzigFiche(f.id, velden));
  }
  if (f.soort === 'tekst') {
    const inh = await db.getFiche(f.id);
    const r = await tekstDialoog('Fiche wijzigen', f, inh?.tekst || '');
    if (!r) return false;
    f.titel = r.titel; f.omschrijving = r.omschrijving;
    await db.putFiche({ id: f.id, tekst: r.tekst });
    return true;
  }
  const r = await dialoog({
    titel: 'Fiche wijzigen',
    okTekst: 'Bewaren',
    velden: [
      { naam: 'titel', label: 'Titel', waarde: f.titel, verplicht: true },
      { naam: 'omschrijving', label: 'Korte omschrijving (optioneel)', waarde: f.omschrijving }
    ]
  });
  if (!r) return false;
  f.titel = r.titel; f.omschrijving = r.omschrijving;
  return true;
}

// ---------- Eén fiche bekijken ----------

function tekstNaarHtml(tekst) {
  const blokken = String(tekst || '').replace(/\r/g, '').split(/\n\s*\n/);
  return blokken.map(b => {
    const regels = b.split('\n').filter(r => r.trim());
    if (!regels.length) return '';
    if (regels.every(r => /^\s*[-•]\s+/.test(r))) {
      return '<ul>' + regels.map(r => `<li>${esc(r.replace(/^\s*[-•]\s+/, ''))}</li>`).join('') + '</ul>';
    }
    let html = '';
    let rest = regels;
    if (/^#\s+/.test(rest[0])) { html += `<h2>${esc(rest[0].replace(/^#\s+/, ''))}</h2>`; rest = rest.slice(1); }
    if (rest.length && rest.every(r => /^\s*[-•]\s+/.test(r))) {
      html += '<ul>' + rest.map(r => `<li>${esc(r.replace(/^\s*[-•]\s+/, ''))}</li>`).join('') + '</ul>';
    } else if (rest.length) {
      html += `<p>${rest.map(esc).join('<br>')}</p>`;
    }
    return html;
  }).join('');
}

// Inhoud van een fiche als HTML. Geeft { html, url } terug (url = blob-URL, later vrijgeven).
function ficheVlak(f, inh) {
  if (inh && f.soort === 'tekst') return { html: `<div class="viewer-vlak viewer-tekst">${tekstNaarHtml(inh.tekst)}</div>`, url: null };
  if (inh && inh.data) {
    const url = URL.createObjectURL(new Blob([inh.data], { type: inh.mime }));
    let html;
    if (f.soort === 'afbeelding') html = `<div class="viewer-vlak"><img src="${url}" alt="${esc(f.titel)}"></div>`;
    else if (f.soort === 'video') html = `<div class="viewer-vlak"><video src="${url}" controls playsinline preload="metadata"></video></div>`;
    else html = `<div class="viewer-vlak"><iframe src="${url}" title="${esc(f.titel)}"></iframe></div>`;
    return { html, url };
  }
  return { html: '<div class="leeg">Deze fiche is niet gevonden.</div>', url: null };
}

async function toonFiche(keten, ids) {
  const cat = keten[2];
  const f = keten[3];
  const i = cat.fiches.indexOf(f);
  const vorige = cat.fiches[i - 1];
  const volgende = cat.fiches[i + 1];
  const catIds = ids.slice(0, 3);

  const pagina = location.hash;
  const inh = await db.getFiche(f.id);
  if (location.hash !== pagina) return; // intussen naar elders genavigeerd
  const { html: vlak, url } = ficheVlak(f, inh);
  actieveUrl = url;
  const volledig = url ? `<a class="knop knop-plat" href="${url}" target="_blank" rel="noopener">Volledig scherm</a>` : '';

  inhoud.innerHTML = `
    <div class="viewer">
      <div class="viewer-kop">
        <h1>${esc(f.titel)}</h1>
        ${inh ? kiesKnop(f, true) : ''}
        <button class="knop knop-plat ster" id="favoriet" aria-pressed="${favorieten.has(f.id)}">${favorieten.has(f.id) ? '★' : '☆'} Favoriet</button>
        ${volledig}
        ${beheer ? '<button class="knop knop-plat" id="wijzig">Wijzig</button>' : ''}
      </div>
      ${f.omschrijving ? `<p class="viewer-omschrijving">${esc(f.omschrijving)}</p>` : ''}
      ${vlak}
      <div class="viewer-nav">
        ${vorige ? `<a class="knop knop-plat" href="${link([...catIds, vorige.id])}">‹ ${esc(vorige.titel)}</a>` : '<span></span>'}
        ${volgende ? `<a class="knop knop-plat" href="${link([...catIds, volgende.id])}">${esc(volgende.titel)} ›</a>` : '<span></span>'}
      </div>
    </div>`;
  inhoud.focus();
  koppelKiesKnoppen(inhoud);
  onthoudBekeken(f.id);

  const ster = $('#favoriet');
  ster.addEventListener('click', async () => {
    if (!await wisselFavoriet(f.id)) return;
    const aan = favorieten.has(f.id);
    ster.setAttribute('aria-pressed', String(aan));
    ster.textContent = `${aan ? '★' : '☆'} Favoriet`;
  });

  const wijzig = $('#wijzig');
  if (wijzig) wijzig.addEventListener('click', async () => {
    if (await bewerkFiche(f)) { await bewaar(); toon(); }
  });
}

// ---------- Instellingen: back-up en herstel ----------

function naarBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function vanBase64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

async function toonInstellingen() {
  const fiches = await db.alleFiches();
  const bytes = fiches.reduce((t, f) => t + (f.data ? f.data.byteLength : (f.tekst || '').length), 0);
  const mb = (bytes / 1024 / 1024).toFixed(1);
  let blijvend = 'onbekend';
  if (navigator.storage && navigator.storage.persisted) {
    blijvend = (await navigator.storage.persisted()) ? 'ja' : 'nee (zet de app op je beginscherm)';
  }

  const laatsteSync = gedeeld() ? await db.get('laatsteSync') : null;
  const oudeFiches = gedeeld() ? await telOudeFiches() : 0;

  inhoud.innerHTML = `
    <h1>Instellingen</h1>
    <p class="ondertitel">${fiches.length} fiches op dit toestel, samen ongeveer ${mb} MB. Blijvende opslag: ${blijvend}.</p>

    ${gedeeld() ? `
    <div class="paneel">
      <h2>Account</h2>
      <p>Aangemeld als <b>${esc(profiel.email)}</b> (${esc(profiel.rol)}).
        ${offline ? 'Je bent offline: je ziet de laatst opgehaalde fiches.' : ''}
        Laatst bijgewerkt: ${laatsteSync ? new Date(laatsteSync).toLocaleString('nl-BE') : 'nog nooit'}.</p>
      <div class="knoppen">
        <button class="knop knop-hoofd" id="sync-nu">Nu bijwerken</button>
        <button class="knop knop-plat" id="wachtwoord">Wachtwoord wijzigen</button>
        <button class="knop knop-plat" id="afmelden">Afmelden</button>
      </div>
    </div>

    ${isBeheerder() ? `
    <div class="paneel" id="gebruikers-paneel">
      <h2>Gebruikers</h2>
      <p>Nieuwe collega? Nodig die uit in Supabase (Authentication → Users → Invite user). Daarna verschijnt die hier en geef je de rol <b>therapeut</b>.</p>
      <div id="gebruikers"><p class="hulp">Laden…</p></div>
    </div>` : ''}

    ${oudeFiches ? `
    <div class="paneel">
      <h2>Fiches van dit toestel kopiëren</h2>
      <p>Op dit toestel staan nog ${oudeFiches} fiches van vóór de gedeelde verzameling. Kopieer ze om ze met het team te delen.
        Onderdelen, regio's en categorieën met dezelfde naam worden samengevoegd; een fiche met dezelfde titel in dezelfde categorie wordt overgeslagen.</p>
      <div class="knoppen"><button class="knop knop-hoofd" id="kopieer-oud">${oudeFiches} fiches kopiëren</button></div>
    </div>` : ''}
    ` : ''}

    <div class="paneel">
      <h2>App-naam</h2>
      <p>De titel bovenaan de app.</p>
      <div class="knoppen"><button class="knop knop-plat" id="app-naam">Wijzig naam (nu: ${esc(structuur.appTitel)})</button></div>
    </div>

    <div class="paneel">
      <h2>Pincode voor Beheer</h2>
      <p>${pinActief
        ? `Aan. Beheer vraagt de pincode en gaat vanzelf dicht na ${AUTO_SLOT_MIN} minuten zonder aanraken, of als je de app verlaat.`
        : 'Uit. Iedereen kan Beheer openen. Zet een pincode als patiënten zelf de iPad gebruiken.'}</p>
      <div class="knoppen">
        <button class="knop knop-hoofd" id="pin-instellen">${pinActief ? 'Pincode wijzigen' : 'Pincode instellen'}</button>
        ${pinActief ? '<button class="knop knop-plat" id="pin-uit">Pincode uitzetten</button>' : ''}
      </div>
    </div>

    <div class="paneel">
      <h2>Back-up maken</h2>
      <p>${gedeeld()
        ? 'De fiches staan veilig op de server van de praktijk. Hier download je een kopie van alles wat op dit toestel staat, als extra zekerheid.'
        : 'Bewaart alle onderdelen, categorieën en fiches in één bestand. Doe dit regelmatig en bewaar het bestand op een veilige plek.'}</p>
      <div class="knoppen"><button class="knop knop-hoofd" id="exporteer">Back-up downloaden</button></div>
    </div>

    ${gedeeld() ? `
    <div class="paneel">
      <h2>Lokale kopie opnieuw ophalen</h2>
      <p>Wist de kopie op dit toestel en haalt alles opnieuw op van de server. Handig als er iets niet klopt. Er gaat niets verloren voor het team.</p>
      <div class="knoppen"><button class="knop knop-plat" id="herlaad-kopie">Opnieuw ophalen</button></div>
    </div>` : `
    <div class="paneel">
      <h2>Back-up terugzetten</h2>
      <p>Vervangt alles in de app door de inhoud van een back-upbestand. Ook handig om de fiches naar een ander toestel over te zetten.</p>
      <div class="knoppen">
        <label class="knop knop-plat">Back-up kiezen<input type="file" id="importeer" accept="application/json,.json" hidden></label>
      </div>
    </div>

    <div class="paneel">
      <h2>Opnieuw beginnen</h2>
      <p>Wist alles en zet de standaardstructuur uit <code>data/structuur.json</code> terug.</p>
      <div class="knoppen"><button class="knop knop-gevaar" id="reset">Alles wissen</button></div>
    </div>`}`;

  if (gedeeld()) koppelInstellingenGedeeld();

  $('#app-naam').addEventListener('click', async () => {
    const n = await vraagNaam('App-naam wijzigen', structuur.appTitel);
    if (!n) return;
    structuur.appTitel = n;
    await bewaar();
    toon();
  });

  $('#pin-instellen').addEventListener('click', stelPinIn);
  if (pinActief) $('#pin-uit').addEventListener('click', zetPinUit);

  $('#exporteer').addEventListener('click', async () => {
    const alle = await db.alleFiches();
    const data = {
      app: 'praktijkfiches',
      versie: 1,
      gemaakt: new Date().toISOString(),
      structuur,
      fiches: alle.map(f => ({ ...f, data: f.data ? naarBase64(f.data) : undefined }))
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const naam = `praktijkfiches-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const bestand = new File([blob], naam, { type: 'application/json' });
    // Op iPad: deelvenster (bewaar in Bestanden). Anders: gewone download.
    if (navigator.canShare && navigator.canShare({ files: [bestand] })) {
      try { await navigator.share({ files: [bestand], title: naam }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = naam;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  if (gedeeld()) return;

  $('#importeer').addEventListener('change', async e => {
    const b = e.target.files[0];
    if (!b) return;
    let data;
    try { data = JSON.parse(await b.text()); } catch { melding('Dit is geen geldig back-upbestand.'); return; }
    if (data.app !== 'praktijkfiches' || !data.structuur || !Array.isArray(data.fiches)) {
      melding('Dit is geen back-up van deze app.');
      return;
    }
    const tekst = `Alles in de app wordt vervangen door de back-up van ${new Date(data.gemaakt).toLocaleDateString('nl-BE')} (${data.fiches.length} fiches).`;
    if (!await bevestig('Back-up terugzetten?', tekst, 'Terugzetten')) return;
    const fiches = data.fiches.map(f => ({ ...f, data: f.data ? vanBase64(f.data) : undefined }));
    await db.vervangAlles(data.structuur, fiches);
    structuur = data.structuur;
    melding('Back-up teruggezet.');
    location.hash = '#/';
    toon();
  });

  $('#reset').addEventListener('click', async () => {
    if (!await bevestig('Alles wissen?', 'Alle fiches en categorieën worden gewist. Maak eerst een back-up als je twijfelt.', 'Alles wissen')) return;
    structuur = await standaardStructuur();
    await db.vervangAlles(structuur, []);
    melding('Alles gewist.');
    location.hash = '#/';
    toon();
  });
}

// ---------- Instellingen in de gedeelde modus ----------

function koppelInstellingenGedeeld() {
  $('#sync-nu').addEventListener('click', async () => {
    if (!navigator.onLine) { melding('Geen internet.'); return; }
    try {
      const r = await synchroniseer((n, t) => melding(`Fiches ophalen… ${n}/${t}`));
      structuur = r.structuur;
      offline = false;
      melding(r.mislukt ? `Bijgewerkt, maar ${r.mislukt} fiches lukten niet.` : 'Alles is bijgewerkt.');
      toon();
    } catch (e) { melding(e.message || 'Bijwerken lukte niet.'); }
  });
  $('#wachtwoord').addEventListener('click', () => vraagNieuwWachtwoord('wijzig'));
  $('#afmelden').addEventListener('click', async () => {
    if (!await bevestig('Afmelden?', 'De fiches op dit toestel blijven staan. Om opnieuw bij te werken moet je je weer aanmelden.', 'Afmelden')) return;
    await bron.afmelden();
    await db.del('profiel');
    location.hash = '#/';
    location.reload();
  });
  $('#herlaad-kopie').addEventListener('click', async () => {
    if (!navigator.onLine) { melding('Geen internet: eerst online gaan.'); return; }
    if (!await bevestig('Opnieuw ophalen?', 'De kopie op dit toestel wordt gewist en opnieuw opgehaald.', 'Opnieuw ophalen')) return;
    await db.vervangAlles({ ...LEGE_STRUCTUUR(), appTitel: structuur.appTitel }, []);
    try {
      structuur = (await synchroniseer((n, t) => melding(`Fiches ophalen… ${n}/${t}`))).structuur;
      melding('Alles opnieuw opgehaald.');
    } catch (e) { melding(e.message); }
    toon();
  });
  const kopieer = $('#kopieer-oud');
  if (kopieer) kopieer.addEventListener('click', kopieerOudeFiches);
  if (isBeheerder()) toonGebruikers();
}

const ROLLEN = [['', 'Geen toegang'], ['therapeut', 'Therapeut'], ['beheerder', 'Beheerder']];

async function toonGebruikers() {
  const box = $('#gebruikers');
  let lijst;
  try { lijst = await bron.profielen(); } catch (e) { box.innerHTML = `<p class="hulp">${esc(e.message)}</p>`; return; }
  lijst = lijst.filter(p => p.rol !== 'patient'); // patiënten staan onder Patiënten
  box.innerHTML = `<ul class="gebruikers">${lijst.map(p => `
    <li>
      <span class="gebruiker-naam"><b>${esc(p.naam || p.email)}</b><br><span class="hulp">${esc(p.email)}</span></span>
      ${p.rol === 'patient' ? '<span class="hulp">Patiënt</span>' : `
      <select data-rol="${esc(p.id)}" ${p.id === profiel.id ? 'disabled' : ''} aria-label="Rol van ${esc(p.email)}">
        ${ROLLEN.map(([w, l]) => `<option value="${w}" ${(p.rol || '') === w ? 'selected' : ''}>${l}</option>`).join('')}
      </select>`}
    </li>`).join('')}</ul>`;
  box.querySelectorAll('[data-rol]').forEach(sel => sel.addEventListener('change', async () => {
    try {
      await bron.zetRol(sel.dataset.rol, sel.value);
      melding('Rol aangepast. De collega moet de app opnieuw openen.');
    } catch (e) {
      melding(e.message);
      toonGebruikers();
    }
  }));
}

// Fiches uit de oude, lokale databank (van vóór Supabase) naar de gedeelde verzameling kopiëren.
const oudeDb = () => maakDb('praktijkfiches');

async function telOudeFiches() {
  try {
    if (indexedDB.databases) {
      const lijst = await indexedDB.databases();
      if (!lijst.some(d => d.name === 'praktijkfiches')) return 0;
    }
    const s = await oudeDb().getStructuur();
    return s ? fichesOnder({ kinderen: s.secties }).length : 0;
  } catch { return 0; }
}

async function kopieerOudeFiches() {
  if (!navigator.onLine) { melding('Geen internet.'); return; }
  const oud = oudeDb();
  const s = await oud.getStructuur();
  if (!s) return;
  const totaal = fichesOnder({ kinderen: s.secties }).length;
  if (!await bevestig('Fiches kopiëren?', `${totaal} fiches worden naar de gedeelde verzameling gekopieerd en zijn daarna zichtbaar voor het hele team.`, 'Kopiëren')) return;

  let gedaan = 0, overgeslagen = 0, mislukt = 0;
  const zelfde = (a, b) => a.trim().toLocaleLowerCase('nl') === b.trim().toLocaleLowerCase('nl');
  try {
    let { knopen, fiches } = await bron.alles();
    // Zoek een knoop met dezelfde naam onder dezelfde ouder, of maak er een
    const knoopVoor = async (titel, niveau, ouderId, omschrijving = '') => {
      const broers = knopen.filter(k => k.niveau === niveau && (k.ouder_id ?? null) === (ouderId ?? null));
      const bestaand = broers.find(k => zelfde(k.titel, titel));
      if (bestaand) return bestaand;
      const nieuw = await bron.maakKnoop({ ouder_id: ouderId, niveau, titel, omschrijving, volgorde: volgendeVolgorde(broers) });
      knopen = [...knopen, nieuw];
      return nieuw;
    };
    for (const sectie of s.secties) {
      const sk = await knoopVoor(sectie.titel, 0, null, sectie.omschrijving || '');
      for (const regio of sectie.kinderen || []) {
        const rk = await knoopVoor(regio.titel, 1, sk.id);
        for (const cat of regio.kinderen || []) {
          const ck = await knoopVoor(cat.titel, 2, rk.id);
          let volgorde = volgendeVolgorde(fiches.filter(f => f.categorie_id === ck.id));
          for (const f of cat.fiches || []) {
            melding(`Kopiëren… ${gedaan + overgeslagen + mislukt + 1}/${totaal}`);
            if (fiches.some(x => x.categorie_id === ck.id && zelfde(x.titel, f.titel))) { overgeslagen++; continue; }
            try {
              const inh = await oud.getFiche(f.id);
              if (!inh) { mislukt++; continue; }
              const id = uuid();
              const velden = { id, categorie_id: ck.id, titel: f.titel, omschrijving: f.omschrijving || '', soort: f.soort, volgorde: volgorde++ };
              let bestand = null;
              if (f.soort === 'tekst') {
                velden.tekst = inh.tekst || '';
              } else {
                const naam = inh.bestandsnaam || `${f.titel}.${(inh.mime || '').split('/')[1] || 'bin'}`;
                bestand = new Blob([inh.data], { type: inh.mime });
                Object.assign(velden, { bestand_pad: `${id}/${veiligeBestandsnaam(naam)}`, mime: inh.mime, bestandsnaam: naam, grootte: bestand.size });
              }
              const rij = await bron.maakFiche(velden, bestand);
              fiches = [...fiches, rij];
              gedaan++;
            } catch { mislukt++; }
          }
        }
      }
    }
  } catch (e) {
    melding(e.message || 'Kopiëren lukte niet.');
  }
  try { structuur = (await synchroniseer()).structuur; } catch { /* later */ }
  melding(`${gedaan} gekopieerd${overgeslagen ? `, ${overgeslagen} overgeslagen (bestond al)` : ''}${mislukt ? `, ${mislukt} mislukt` : ''}.`);
  if (!mislukt && (gedaan || overgeslagen) && await bevestig('Oude kopie wissen?',
    'Alles staat nu in de gedeelde verzameling. Wil je de oude, lokale fiches van dit toestel wissen? (Ze staan nog in je back-ups.)', 'Wissen')) {
    await new Promise(r => { const q = indexedDB.deleteDatabase('praktijkfiches'); q.onsuccess = q.onerror = q.onblocked = r; });
  }
  toon();
}

start();
