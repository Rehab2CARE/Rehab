// Oefenschema's die meegaan met de weken na de operatie (eerst: het quadricepsschema).
//
// De klinische inhoud staat in data/schema-<id>.json, niet in de code.
// Welk blok de patiënt ziet: automatisch volgens de weken na de operatie, tenzij de therapeut
// het per traject vastzet of verbergt (kolom patient_trajecten.schemas, zie 018_oefenschemas.sql).
//
//   Therapeut:  #/schema/<id>[/<blok-id>]           alle blokken bekijken (patiënttekst + vaktekst)
//   Patiënt:    #/schema/<id>/<oefening-nr>          één oefening uit het huidige blok

import * as bron from './bron.js';

export const SCHEMA_IDS = ['quadriceps'];
const geladen = {};
let ctx = null;
const $ = sel => document.querySelector(sel);

export function initSchemas(hulp) { ctx = hulp; }

export async function laadSchema(id) {
  if (geladen[id]) return geladen[id];
  const res = await fetch(`data/schema-${id}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Schema ${id} niet gevonden.`);
  geladen[id] = await res.json();
  return geladen[id];
}

export async function laadSchemas() {
  const uit = [];
  for (const id of SCHEMA_IDS) { try { uit.push(await laadSchema(id)); } catch { /* offline en nog niet bewaard */ } }
  return uit;
}

// Het blok dat bij een week hoort (week 0 = de eerste week na de operatie)
export function blokVoorWeek(schema, week) {
  if (week == null || week < 0) return null;
  return schema.blokken.find(b => week >= b.van && (b.tot == null || week < b.tot)) || null;
}

// Wat de patiënt ziet: { blok, wijze: 'auto' | 'vast' | 'uit' | 'geen-datum' }
export function huidigBlok(schema, week, instelling) {
  if (instelling?.uit) return { blok: null, wijze: 'uit' };
  if (instelling?.blok) {
    const b = schema.blokken.find(x => x.id === instelling.blok);
    if (b) return { blok: b, wijze: 'vast' };
  }
  if (week == null) return { blok: null, wijze: 'geen-datum' };
  return { blok: blokVoorWeek(schema, week), wijze: 'auto' };
}

export const hoortBij = (schema, protocolId) => (schema.protocollen || []).includes(protocolId);

function doseringRegels(o) {
  return [o.frequentie, o.intensiteit, o.volume, o.hoek, o.bereik, o.opmerking].filter(Boolean);
}

// Thuis of in de praktijk: een regel in een blok kan de standaard van de oefening overschrijven
export const plaatsVan = (schema, o) => o.plaats || schema.oefeningen[o.oefening]?.plaats || 'thuis';

// Oefeningen van een blok, opgesplitst in thuis en in de praktijk (met het nummer binnen het blok)
function perPlaats(schema, blok) {
  const lijst = blok.oefeningen.map((o, i) => ({ o, i, def: schema.oefeningen[o.oefening] || {} }));
  return { thuis: lijst.filter(x => plaatsVan(schema, x.o) !== 'praktijk'), praktijk: lijst.filter(x => plaatsVan(schema, x.o) === 'praktijk') };
}

// ---------- Patiënt ----------

// Sectie op de pagina "Oefenprogramma": de kaarten van het huidige blok
export function patientSectie(schema, blok, esc) {
  const { thuis, praktijk } = perPlaats(schema, blok);
  const kaart = ({ o, i, def }) => `
    <li><a class="kaart" href="#/schema/${encodeURIComponent(schema.id)}/${i}">
      <span class="kaart-titel">${esc(def.naam || o.vak.naam)}</span>
      <span class="kaart-dosering">${esc([o.frequentie, o.volume].filter(Boolean).join(' · '))}</span>
      ${o.hoek ? `<span class="kaart-notitie">${esc(o.hoek)}</span>` : ''}
    </a></li>`;
  return `
    <section class="programma schema" data-schema="${esc(schema.id)}">
      <h2>${esc(schema.titel)}</h2>
      <p class="schema-stap">Stap ${schema.blokken.indexOf(blok) + 1} van ${schema.blokken.length}</p>
      ${schema.uitleg ? `<p class="programma-opmerking">${esc(schema.uitleg)}</p>` : ''}
      ${thuis.length ? `<h3 class="schema-plaats">Thuis</h3><ol class="kaarten">${thuis.map(kaart).join('')}</ol>` : ''}
      ${praktijk.length ? `<h3 class="schema-plaats">Samen met je kine in de praktijk</h3>
        <ol class="kaarten kaarten-praktijk">${praktijk.map(kaart).join('')}</ol>` : ''}
      ${schema.pijnregel ? `<p class="hulp schema-pijn">${esc(schema.pijnregel)}</p>` : ''}
    </section>`;
}

// Inhoud van één oefening (patiënttaal). Gebruikt door de patiënt én in het overzicht van de therapeut.
export function oefeningHtml(schema, o, esc, { kop = 'h1' } = {}) {
  const def = schema.oefeningen[o.oefening] || {};
  const praktijk = plaatsVan(schema, o) === 'praktijk';
  return `
    <${kop}>${esc(def.naam || o.vak.naam)}</${kop}>
    <p><span class="label ${praktijk ? 'label-praktijk' : 'label-aan'}">${praktijk ? 'Samen met je kine in de praktijk' : 'Thuis'}</span></p>
    <div class="dosering-groot schema-dosering">
      ${doseringRegels(o).map((r, n) => n === 0 ? `<b>${esc(r)}</b>` : `<span>${esc(r)}</span>`).join('')}
    </div>
    ${def.uitvoering?.length ? `<h2 class="schema-kop">Zo doe je het</h2><ol class="schema-stappen">${def.uitvoering.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${o.progressie ? `<h2 class="schema-kop">Moeilijker maken</h2><p>Als je kinesitherapeut zegt dat het mag: ${esc(o.progressie.charAt(0).toLowerCase() + o.progressie.slice(1))}</p>` : ''}`;
}

export function patientOefening(schema, blok, nr, esc) {
  const o = blok.oefeningen[nr];
  if (!o) return null;
  const vorige = nr > 0 ? nr - 1 : null;
  const volgende = nr < blok.oefeningen.length - 1 ? nr + 1 : null;
  const link = (n, tekst) => n == null ? '<span></span>' : `<a class="knop knop-plat" href="#/schema/${encodeURIComponent(schema.id)}/${n}">${tekst}</a>`;
  return `
    <div class="viewer schema-oefening">
      ${oefeningHtml(schema, o, esc)}
      ${schema.pijnregel ? `<p class="hulp schema-pijn">${esc(schema.pijnregel)}</p>` : ''}
      <div class="viewer-nav">${link(vorige, '‹ Vorige oefening')}${link(volgende, 'Volgende oefening ›')}</div>
      <div class="patient-voet"><a class="knop knop-plat" href="#/oefenen">‹ Terug naar je oefeningen</a></div>
    </div>`;
}

// ---------- Therapeut: paneel bij de opvolging van een patiënt ----------

export async function schemaPanelen(box, t, herlaad) {
  const { esc } = ctx;
  const schemas = (await laadSchemas()).filter(s => hoortBij(s, t.protocol_id));
  if (!schemas.length) { box.innerHTML = ''; return; }
  const weken = t.startdatum ? Math.floor((Date.now() - new Date(t.startdatum + 'T00:00:00').getTime()) / (7 * 864e5)) : null;
  box.innerHTML = schemas.map(s => {
    const inst = (t.schemas || {})[s.id];
    const auto = blokVoorWeek(s, weken);
    const { blok, wijze } = huidigBlok(s, weken, inst);
    const ziet = wijze === 'uit' ? 'niets (verborgen)'
      : blok ? `${blok.titel} (${blok.poort})${wijze === 'vast' ? ' · <b>vastgezet</b>' : ' · automatisch'}`
      : wijze === 'geen-datum' ? 'niets: er is geen operatiedatum ingevuld' : 'niets: de operatie is nog niet voorbij';
    return `
      <div class="paneel schema-paneel">
        <h2>${esc(s.titel_therapeut || s.titel)}${s.status === 'concept' ? ' <span class="label label-concept">concept</span>' : ''}</h2>
        <p>Volgens de datum: ${weken != null ? `week ${weken} → <b>${esc(auto ? `${auto.titel} (${auto.poort})` : '—')}</b>` : 'geen operatiedatum'}<br>
          De patiënt ziet: ${ziet}</p>
        <div class="knoppen">
          <button class="knop knop-hoofd" data-bijsturen="${esc(s.id)}">Bijsturen</button>
          <a class="knop knop-plat" href="#/schema/${encodeURIComponent(s.id)}${blok ? '/' + encodeURIComponent(blok.id) : ''}">Schema bekijken</a>
        </div>
      </div>`;
  }).join('');
  box.querySelectorAll('[data-bijsturen]').forEach(k => k.addEventListener('click', async () => {
    const s = schemas.find(x => x.id === k.dataset.bijsturen);
    const inst = (t.schemas || {})[s.id] || {};
    const auto = blokVoorWeek(s, weken);
    const r = await ctx.dialoog({
      titel: `${s.titel}: bijsturen`, okTekst: 'Bewaren',
      velden: [
        { soort: 'uitleg', tekst: 'Standaard volgt de patiënt de weken na de operatie. Bij een bijkomende ingreep of tragere progressie zet je hier zelf een blok vast.' },
        { naam: 'keuze', label: 'Wat ziet deze patiënt?', soort: 'keuze', waarde: inst.uit ? 'uit' : inst.blok || '', opties: [
          { waarde: '', label: `Automatisch volgens de datum${auto ? ` (nu ${auto.titel})` : ''}` },
          ...s.blokken.map(b => ({ waarde: b.id, label: `Vastzetten op ${b.titel} (${b.poort})` })),
          { waarde: 'uit', label: 'Niet tonen aan de patiënt' }
        ] }
      ]
    });
    if (!r) return;
    const nieuw = { ...(t.schemas || {}) };
    if (r.keuze === '') delete nieuw[s.id];
    else if (r.keuze === 'uit') nieuw[s.id] = { uit: true };
    else nieuw[s.id] = { blok: r.keuze };
    try { await bron.wijzigTraject(t.id, { schemas: nieuw }); ctx.melding('Bewaard.'); herlaad(); }
    catch (e) {
      ctx.melding(/schemas/i.test(e.message || '') ? 'Voer eerst 018_oefenschemas.sql uit in Supabase.' : (e.message || 'Er liep iets mis.'));
    }
  }));
}

// ---------- Therapeut: overzicht van alle blokken ----------

export async function toonSchema(delen) {
  const { esc, inhoud } = ctx;
  $('#terug').hidden = false;
  const thuis = `<a href="#/">${esc(ctx.appTitel())}</a> <span class="sep">›</span>`;
  let s;
  try { s = await laadSchema(delen[0]); } catch (e) {
    $('#kruimels').innerHTML = `${thuis} <span class="huidig">Schema</span>`;
    inhoud.innerHTML = `<h1>Schema</h1><div class="leeg">${esc(e.message)}</div>`;
    return;
  }
  const blok = s.blokken.find(b => b.id === delen[1]) || s.blokken[0];
  $('#kruimels').innerHTML = `${thuis} <a href="#/protocollen">Protocollen</a> <span class="sep">›</span> <span class="huidig">${esc(s.titel)}</span>`;
  document.title = s.titel_therapeut || s.titel;
  const { thuis: th, praktijk } = perPlaats(s, blok);
  const kaart = ({ o }) => `
    <li class="paneel schema-vak">
      ${oefeningHtml(s, o, esc, { kop: 'h3' })}
      <details class="schema-vaktekst"><summary>Vaktekst (werkboek)</summary>
        <dl>
          <dt>Oefening</dt><dd>${esc(o.vak.naam)}</dd>
          <dt>Frequentie</dt><dd>${esc(o.vak.frequentie)}</dd>
          <dt>Intensiteit</dt><dd>${esc(o.vak.intensiteit)}</dd>
          <dt>Volume</dt><dd>${esc(o.vak.volume)}</dd>
          <dt>Progressie</dt><dd>${esc(o.vak.progressie)}</dd>
          ${o.vak.bereik ? `<dt>Bereik</dt><dd>${esc(o.vak.bereik)}</dd>` : ''}
        </dl>
      </details>
    </li>`;
  inhoud.innerHTML = `
    <h1>${esc(s.titel_therapeut || s.titel)}${s.status === 'concept' ? ' <span class="label label-concept">concept</span>' : ''}</h1>
    <p class="ondertitel">De patiënt ziet enkel het blok dat bij zijn week hoort (of het blok dat je vastzet), in patiënttaal.</p>
    <nav class="schema-blokken" aria-label="Blokken">${s.blokken.map(b => `
      <a class="knop ${b.id === blok.id ? 'knop-hoofd' : 'knop-plat'} klein" href="#/schema/${encodeURIComponent(s.id)}/${encodeURIComponent(b.id)}"
        ${b.id === blok.id ? 'aria-current="page"' : ''}>${esc(b.titel)}</a>`).join('')}</nav>
    <h2>${esc(blok.titel)} <span class="hulp">· ${esc(blok.poort)}</span></h2>
    ${th.length ? `<h3 class="schema-plaats">Thuis</h3><ul class="schema-lijst">${th.map(kaart).join('')}</ul>` : ''}
    ${praktijk.length ? `<h3 class="schema-plaats">Samen met je kine in de praktijk</h3><ul class="schema-lijst">${praktijk.map(kaart).join('')}</ul>` : ''}
    <details class="paneel schema-bron"><summary>Bron en afspraken</summary>
      <p>${esc(s.bron)}</p>
      <ul>${(s.notitie_therapeut || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    </details>`;
}
