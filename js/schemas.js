// Oefenschema's die meegaan met de weken na de operatie (eerst: het quadricepsschema).
//
// De klinische inhoud staat niet in de code. Ze komt uit de tabel oefenschemas in Supabase (aanpasbaar in de app,
// zie 019_oefenschemas_bewerken.sql). Zolang een schema daar niet staat, of zonder verbinding en zonder kopie,
// gebruikt de app de startinhoud uit data/schema-<id>.json.
// Welk blok de patiënt ziet: automatisch volgens de weken na de operatie, tenzij de therapeut
// het per traject vastzet of verbergt (kolom patient_trajecten.schemas, zie 018_oefenschemas.sql).
//
//   Therapeut:  #/schema/<id>[/<blok-id>]           alle blokken bekijken en aanpassen
//   Patiënt:    #/schema/<id>/<oefening-nr>          één oefening uit het huidige blok

import * as bron from './bron.js';
import { db } from './db.js';

export const SCHEMA_IDS = ['quadriceps'];
let geladen = null; // [{ ...inhoud, id, _bron: 'databank' | 'bestand', _bijgewerkt }]
let ctx = null;
const $ = sel => document.querySelector(sel);

export function initSchemas(hulp) { ctx = hulp; }

// Rijen uit de databank, met een kopie op het toestel voor offline gebruik
async function rijenUitBron() {
  try {
    const rijen = await bron.oefenschemas();
    await db.put('oefenschemas', rijen);
    return rijen;
  } catch {
    try { return (await db.get('oefenschemas')) || []; } catch { return []; }
  }
}

async function uitBestand(id) {
  const res = await fetch(`data/schema-${id}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Schema ${id} niet gevonden.`);
  return res.json();
}

// vers = opnieuw ophalen (na een wijziging, of als de patiënt de app opent)
export async function laadSchemas({ vers = false } = {}) {
  if (geladen && !vers) return geladen;
  const rijen = await rijenUitBron();
  const uit = [];
  for (const id of SCHEMA_IDS) {
    const rij = rijen.find(r => r.id === id);
    if (rij?.inhoud?.blokken) { uit.push({ ...rij.inhoud, id, _bron: 'databank', _bijgewerkt: rij.bijgewerkt }); continue; }
    try { uit.push({ ...(await uitBestand(id)), id, _bron: 'bestand' }); } catch { /* offline en nog niet bewaard */ }
  }
  geladen = uit;
  return uit;
}

export async function laadSchema(id, opties) {
  const s = (await laadSchemas(opties)).find(x => x.id === id);
  if (!s) throw new Error(`Schema ${id} niet gevonden.`);
  return s;
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

// ---------- Therapeut: overzicht van alle blokken, met aanpassen ----------

const blokTitel = b => b.tot == null ? `Week ${b.van} en verder` : `Week ${b.van}–${b.tot}`;
const regels = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
const slug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'oefening';

// Bewaar een gewijzigde kopie van het schema in de databank en teken het scherm opnieuw
async function bewaar(s, wijzig, blokId) {
  const { _bron, _bijgewerkt, ...inhoud } = s;
  const kopie = structuredClone(inhoud);
  if (wijzig(kopie) === false) return;
  kopie.blokken.sort((a, b) => a.van - b.van);
  try {
    await bron.bewaarOefenschema(s.id, kopie, ctx.profielId());
    await laadSchemas({ vers: true });
    ctx.melding('Bewaard.');
    toonSchema([s.id, blokId || '']);
  } catch (e) {
    ctx.melding(/oefenschemas|relation|schema cache/i.test(e.message || '') ? 'Voer eerst 019_oefenschemas_bewerken.sql uit in Supabase.' : (e.message || 'Er liep iets mis.'));
  }
}

// Velden voor één regel in een blok (dosering in patiënttaal + vaktekst)
function regelVelden(s, o) {
  const def = s.oefeningen[o.oefening] || {};
  const v = o.vak || {};
  return [
    { naam: 'plaats', label: 'Waar?', soort: 'keuze', waarde: o.plaats || '', opties: [
      { waarde: '', label: `Standaard van de oefening (${def.plaats === 'praktijk' ? 'praktijk' : 'thuis'})` },
      { waarde: 'thuis', label: 'Thuis' }, { waarde: 'praktijk', label: 'Samen met je kine in de praktijk' }] },
    { soort: 'uitleg', tekst: 'Wat de patiënt leest. Korte zinnen, zonder vakjargon.' },
    { naam: 'frequentie', label: 'Hoe vaak', waarde: o.frequentie || '' },
    { naam: 'intensiteit', label: 'Hoe zwaar', waarde: o.intensiteit || '' },
    { naam: 'volume', label: 'Hoeveel', waarde: o.volume || '' },
    { naam: 'hoek', label: 'Hoek (optioneel)', waarde: o.hoek || '' },
    { naam: 'bereik', label: 'Bereik en tempo (optioneel)', waarde: o.bereik || '' },
    { naam: 'opmerking', label: 'Opmerking (optioneel)', waarde: o.opmerking || '' },
    { naam: 'progressie', label: 'Moeilijker maken', soort: 'tekstvak', rijen: 2, waarde: o.progressie || '', hulp: 'De app zet er "Als je kinesitherapeut zegt dat het mag:" voor.' },
    { soort: 'uitleg', tekst: 'Vaktekst (enkel voor het team).' },
    { naam: 'vak_naam', label: 'Oefening (vakterm)', waarde: v.naam || '' },
    { naam: 'vak_frequentie', label: 'Frequentie', waarde: v.frequentie || '' },
    { naam: 'vak_intensiteit', label: 'Intensiteit', waarde: v.intensiteit || '' },
    { naam: 'vak_volume', label: 'Volume', waarde: v.volume || '' },
    { naam: 'vak_progressie', label: 'Progressie', soort: 'tekstvak', rijen: 2, waarde: v.progressie || '' },
    { naam: 'vak_bereik', label: 'Bereik (optioneel)', waarde: v.bereik || '' }
  ];
}
function regelUit(r, oefening) {
  const o = { oefening, vak: { naam: r.vak_naam, frequentie: r.vak_frequentie, intensiteit: r.vak_intensiteit, volume: r.vak_volume, progressie: r.vak_progressie } };
  if (r.vak_bereik) o.vak.bereik = r.vak_bereik;
  ['frequentie', 'intensiteit', 'volume', 'progressie'].forEach(k => { o[k] = r[k] || ''; });
  ['hoek', 'bereik', 'opmerking', 'plaats'].forEach(k => { if (r[k]) o[k] = r[k]; });
  return o;
}
const oefeningVelden = def => [
  { naam: 'naam', label: 'Naam voor de patiënt', waarde: def.naam || '', verplicht: true },
  { naam: 'plaats', label: 'Standaard: waar?', soort: 'keuze', waarde: def.plaats || 'thuis', opties: [
    { waarde: 'thuis', label: 'Thuis' }, { waarde: 'praktijk', label: 'Samen met je kine in de praktijk' }] },
  { naam: 'uitvoering', label: 'Zo doe je het', soort: 'tekstvak', rijen: 6, waarde: (def.uitvoering || []).join('\n'), hulp: 'Eén stap per regel.' }
];

export async function toonSchema(delen) {
  const { esc, inhoud } = ctx;
  $('#terug').hidden = false;
  const thuis = `<a href="#/">${esc(ctx.appTitel())}</a> <span class="sep">›</span>`;
  let s;
  try { s = await laadSchema(delen[0], { vers: true }); } catch (e) {
    $('#kruimels').innerHTML = `${thuis} <span class="huidig">Schema</span>`;
    inhoud.innerHTML = `<h1>Schema</h1><div class="leeg">${esc(e.message)}</div>`;
    return;
  }
  const blok = s.blokken.find(b => b.id === delen[1]) || s.blokken[0];
  const online = navigator.onLine;
  $('#kruimels').innerHTML = `${thuis} <a href="#/protocollen">Protocollen</a> <span class="sep">›</span> <span class="huidig">${esc(s.titel)}</span>`;
  document.title = s.titel_therapeut || s.titel;
  const { thuis: th, praktijk } = perPlaats(s, blok);
  const knop = (actie, i, tekst, { extra = '', uit = false, label = '' } = {}) =>
    `<button class="knop knop-plat klein ${extra}" data-actie="${actie}" data-i="${i}" ${label ? `aria-label="${label}"` : ''} ${online && !uit ? '' : 'disabled'}>${tekst}</button>`;
  const kaart = ({ o, i }) => `
    <li class="paneel schema-vak">
      ${oefeningHtml(s, o, esc, { kop: 'h3' })}
      <details class="schema-vaktekst"><summary>Vaktekst (werkboek)</summary>
        <dl>
          <dt>Oefening</dt><dd>${esc(o.vak?.naam || '')}</dd>
          <dt>Frequentie</dt><dd>${esc(o.vak?.frequentie || '')}</dd>
          <dt>Intensiteit</dt><dd>${esc(o.vak?.intensiteit || '')}</dd>
          <dt>Volume</dt><dd>${esc(o.vak?.volume || '')}</dd>
          <dt>Progressie</dt><dd>${esc(o.vak?.progressie || '')}</dd>
          ${o.vak?.bereik ? `<dt>Bereik</dt><dd>${esc(o.vak.bereik)}</dd>` : ''}
        </dl>
      </details>
      <div class="knoppen schema-acties">
        ${knop('regel', i, 'Dosering wijzigen')}
        ${knop('oefening', i, 'Oefening wijzigen')}
        ${knop('op', i, '↑', { uit: i === 0, label: 'Naar boven' })}
        ${knop('neer', i, '↓', { uit: i === blok.oefeningen.length - 1, label: 'Naar onder' })}
        ${knop('weg', i, 'Uit dit blok', { extra: 'knop-gevaar' })}
      </div>
    </li>`;
  inhoud.innerHTML = `
    <h1>${esc(s.titel_therapeut || s.titel)}${s.status === 'concept' ? ' <span class="label label-concept">concept</span>' : ''}</h1>
    <p class="ondertitel">De patiënt ziet enkel het blok dat bij zijn week hoort (of het blok dat je vastzet), in patiënttaal.</p>
    <p class="hulp">${s._bron === 'databank'
      ? `Aangepast in de app${s._bijgewerkt ? ` · laatst bewaard op ${new Date(s._bijgewerkt).toLocaleString('nl-BE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : ''}.`
      : 'Dit is nog de startinhoud uit het werkboek. Je eerste wijziging bewaart het schema in de databank; vanaf dan geldt jouw versie, ook voor de patiënt.'}
      ${online ? '' : ' <b>Zonder internet kan je niets wijzigen.</b>'}</p>
    <div class="beheer-balk">
      <button class="knop knop-plat" id="schema-algemeen" ${online ? '' : 'disabled'}>Algemene teksten</button>
    </div>
    <nav class="schema-blokken" aria-label="Blokken">${s.blokken.map(b => `
      <a class="knop ${b.id === blok.id ? 'knop-hoofd' : 'knop-plat'} klein" href="#/schema/${encodeURIComponent(s.id)}/${encodeURIComponent(b.id)}"
        ${b.id === blok.id ? 'aria-current="page"' : ''}>${esc(b.titel)}</a>`).join('')}</nav>
    <div class="strook-kop">
      <h2>${esc(blok.titel)} <span class="hulp">· ${esc(blok.poort || '')}</span></h2>
      <button class="knop knop-plat klein" id="blok-wijzig" ${online ? '' : 'disabled'}>Weken en poort wijzigen</button>
    </div>
    ${th.length ? `<h3 class="schema-plaats">Thuis</h3><ul class="schema-lijst">${th.map(kaart).join('')}</ul>` : ''}
    ${praktijk.length ? `<h3 class="schema-plaats">Samen met je kine in de praktijk</h3><ul class="schema-lijst">${praktijk.map(kaart).join('')}</ul>` : ''}
    ${blok.oefeningen.length ? '' : '<div class="leeg">Nog geen oefeningen in dit blok.</div>'}
    <div class="knoppen"><button class="knop knop-hoofd" id="regel-nieuw" ${online ? '' : 'disabled'}>+ Oefening toevoegen aan dit blok</button></div>
    <details class="paneel schema-bron"><summary>Bron en afspraken</summary>
      <p>${esc(s.bron || '')}</p>
      <ul>${(s.notitie_therapeut || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    </details>`;

  const bi = s.blokken.indexOf(blok);
  const metBlok = fn => kopie => fn(kopie.blokken[bi], kopie);

  $('#schema-algemeen')?.addEventListener('click', async () => {
    const r = await ctx.dialoog({ titel: 'Algemene teksten', okTekst: 'Bewaren', velden: [
      { naam: 'titel', label: 'Titel voor de patiënt', waarde: s.titel || '', verplicht: true },
      { naam: 'uitleg', label: 'Uitleg voor de patiënt', soort: 'tekstvak', rijen: 3, waarde: s.uitleg || '' },
      { naam: 'pijnregel', label: 'Pijnregel voor de patiënt', soort: 'tekstvak', rijen: 3, waarde: s.pijnregel || '' },
      { naam: 'status', label: 'Status', soort: 'keuze', waarde: s.status || 'concept', opties: [
        { waarde: 'concept', label: 'Concept (nog na te kijken)' }, { waarde: 'goedgekeurd', label: 'Goedgekeurd' }] },
      { naam: 'notities', label: 'Afspraken voor het team', soort: 'tekstvak', rijen: 4, waarde: (s.notitie_therapeut || []).join('\n'), hulp: 'Eén afspraak per regel.' }
    ] });
    if (!r) return;
    bewaar(s, k => { k.titel = r.titel; k.uitleg = r.uitleg; k.pijnregel = r.pijnregel; k.status = r.status; k.notitie_therapeut = regels(r.notities); }, blok.id);
  });

  $('#blok-wijzig')?.addEventListener('click', async () => {
    const r = await ctx.dialoog({ titel: `${blok.titel}: weken en poort`, okTekst: 'Bewaren', velden: [
      { soort: 'uitleg', tekst: 'Week 0 is de eerste week na de operatie. De patiënt ziet dit blok vanaf de week "van" tot vóór de week "tot".' },
      { naam: 'van', label: 'Van week', type: 'number', inputmode: 'numeric', waarde: blok.van, verplicht: true },
      { naam: 'tot', label: 'Tot week', type: 'number', inputmode: 'numeric', waarde: blok.tot ?? '', hulp: 'Leeg = en verder.' },
      { naam: 'poort', label: 'Poort (enkel voor het team)', waarde: blok.poort || '' }
    ] });
    if (!r) return;
    const van = Number(r.van), tot = r.tot === '' ? null : Number(r.tot);
    if (!Number.isFinite(van) || van < 0 || (tot != null && !(tot > van))) { ctx.melding('"Tot" moet groter zijn dan "van".'); return; }
    bewaar(s, metBlok(b => { b.van = van; b.tot = tot; b.poort = r.poort; b.titel = blokTitel(b); }), blok.id);
  });

  $('#regel-nieuw')?.addEventListener('click', async () => {
    const opties = Object.entries(s.oefeningen).sort((a, b) => a[1].naam.localeCompare(b[1].naam, 'nl'))
      .map(([id, d]) => ({ waarde: id, label: `${d.naam} (${d.plaats === 'praktijk' ? 'praktijk' : 'thuis'})` }));
    const k = await ctx.dialoog({ titel: 'Oefening toevoegen', okTekst: 'Verder', velden: [
      { naam: 'oefening', label: 'Welke oefening?', soort: 'keuze', waarde: opties[0]?.waarde || '__nieuw', opties: [...opties, { waarde: '__nieuw', label: '+ Nieuwe oefening…' }] }
    ] });
    if (!k) return;
    let id = k.oefening, nieuweDef = null;
    if (id === '__nieuw') {
      const d = await ctx.dialoog({ titel: 'Nieuwe oefening', okTekst: 'Verder', velden: oefeningVelden({}) });
      if (!d) return;
      id = slug(d.naam); let n = 2; while (s.oefeningen[id]) id = `${slug(d.naam)}-${n++}`;
      nieuweDef = { naam: d.naam, plaats: d.plaats, uitvoering: regels(d.uitvoering) };
    }
    const r = await ctx.dialoog({ titel: `Dosering in ${blok.titel}`, okTekst: 'Toevoegen', velden: regelVelden({ ...s, oefeningen: { ...s.oefeningen, ...(nieuweDef ? { [id]: nieuweDef } : {}) } }, { oefening: id }) });
    if (!r) return;
    bewaar(s, (kopie) => { if (nieuweDef) kopie.oefeningen[id] = nieuweDef; kopie.blokken[bi].oefeningen.push(regelUit(r, id)); }, blok.id);
  });

  inhoud.querySelectorAll('[data-actie]').forEach(el => el.addEventListener('click', async () => {
    const i = Number(el.dataset.i), o = blok.oefeningen[i], def = s.oefeningen[o.oefening] || {};
    if (el.dataset.actie === 'regel') {
      const r = await ctx.dialoog({ titel: `${def.naam || o.vak?.naam}: dosering in ${blok.titel}`, okTekst: 'Bewaren', velden: regelVelden(s, o) });
      if (r) bewaar(s, metBlok(b => { b.oefeningen[i] = regelUit(r, o.oefening); }), blok.id);
    } else if (el.dataset.actie === 'oefening') {
      const aantal = s.blokken.filter(b => b.oefeningen.some(x => x.oefening === o.oefening)).length;
      const r = await ctx.dialoog({ titel: 'Oefening wijzigen', okTekst: 'Bewaren', velden: [
        { soort: 'uitleg', tekst: `Geldt voor ${aantal === 1 ? 'het ene blok' : `alle ${aantal} blokken`} waarin deze oefening staat. De dosering wijzig je per blok.` },
        ...oefeningVelden(def)] });
      if (r) bewaar(s, k => { k.oefeningen[o.oefening] = { ...def, naam: r.naam, plaats: r.plaats, uitvoering: regels(r.uitvoering) }; }, blok.id);
    } else if (el.dataset.actie === 'op' || el.dataset.actie === 'neer') {
      const j = el.dataset.actie === 'op' ? i - 1 : i + 1;
      bewaar(s, metBlok(b => { [b.oefeningen[i], b.oefeningen[j]] = [b.oefeningen[j], b.oefeningen[i]]; }), blok.id);
    } else if (el.dataset.actie === 'weg') {
      if (!await ctx.bevestig('Uit dit blok halen?', `"${def.naam || o.vak?.naam}" verdwijnt uit ${blok.titel}. De andere blokken blijven zoals ze zijn.`, 'Verwijderen')) return;
      bewaar(s, metBlok(b => { b.oefeningen.splice(i, 1); }), blok.id);
    }
  }));
}
