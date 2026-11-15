// Fase 3: patiëntaccounts en oefenprogramma's (enkel in de gedeelde modus, met Supabase).
//
// Therapeut (in Beheer):  #/patienten                      lijst + patiënt toevoegen
//                         #/patienten/<id>                 programma's van één patiënt
//                         #/patienten/<id>/programma/<pid> programma samenstellen (fiches + dosering)
// Patiënt (eigen login):  #/                               Mijn programma
//                         #/oefening/<itemId>              één oefening met de fiche
//
// Minimale gegevens: een code (PT-…) en eventueel een voornaam of initialen. Geen medische gegevens.

import { db } from './db.js';
import * as bron from './bron.js';
import { gekozenFiches, leegSelectie, bijSelectieWijziging } from './delen.js';

let ctx = null;          // hulpmiddelen uit app.js (zie initPatienten)
let blobUrl = null;      // blob-URL van de geopende fiche in de patiëntweergave

const $ = sel => document.querySelector(sel);

export function initPatienten(hulp) { ctx = hulp; }

// ---------- Kiesmodus: fiches kiezen voor een programma, vanaf de startpagina ----------
// Vanuit een programma tik je op "Toevoegen": de app gaat naar de startpagina en onderaan verschijnt een balk.
// Je kiest fiches met het knopje +, en met "Toevoegen" komen ze in het programma.

const KIES = 'kiesVoorProgramma';
let kiesActief = false;

const kiesModus = () => { try { return JSON.parse(sessionStorage.getItem(KIES) || 'null'); } catch { return null; } };
function zetKiesModus(info) {
  try { if (info) sessionStorage.setItem(KIES, JSON.stringify(info)); else sessionStorage.removeItem(KIES); } catch { /* privémodus */ }
}

// actief = de therapeut is in Beheer (gedeelde modus). Wordt opgeroepen bij elk scherm en bij elke keuze.
export function werkKiesbalkBij(actief = kiesActief) {
  kiesActief = actief;
  const balk = $('#kiesbalk');
  if (!balk || !ctx) return;
  const m = actief ? kiesModus() : null;
  document.body.classList.toggle('kiesmodus', !!m);
  if (!m) { balk.hidden = true; balk.innerHTML = ''; return; }
  const n = gekozenFiches().length;
  balk.hidden = false;
  balk.innerHTML = `
    <div class="kiesbalk-tekst">
      <span>Fiches kiezen voor <b>${ctx.esc(m.titel)}</b>${m.sub ? ' · ' + ctx.esc(m.sub) : ''}</span>
      <span class="hulp">Tik op <b>+</b> bij elke fiche. Je kan ook zoeken.</span>
    </div>
    <button type="button" class="knop knop-plat" id="kies-annuleer">Annuleren</button>
    <button type="button" class="knop knop-hoofd" id="kies-klaar" ${n ? '' : 'disabled'}>Toevoegen (${n})</button>`;
  $('#kies-annuleer').addEventListener('click', () => {
    zetKiesModus(null);
    leegSelectie();
    location.hash = m.terug;
  });
  $('#kies-klaar').addEventListener('click', () => kiesKlaar(m));
}

// Waar kunnen gekozen fiches naartoe? soort → async (id, gekozen) => aantal toegevoegd
const kiesDoelen = {
  programma: async (progId, gekozen) => {
    const g = await bron.programma(progId);
    const items = g.programma_items || [];
    const bestaand = new Set(items.map(it => it.fiche_id));
    let volgorde = items.reduce((mx, it) => Math.max(mx, it.volgorde + 1), 0);
    const nieuw = gekozen.filter(x => !bestaand.has(x.id));
    if (nieuw.length) await bron.voegItemsToe(nieuw.map(x => ({ programma_id: progId, fiche_id: x.id, volgorde: volgorde++ })));
    return nieuw.length;
  }
};
export function registreerKiesDoel(soort, fn) { kiesDoelen[soort] = fn; }

// Start de kiesmodus: info = { soort, id, titel, sub, terug }
export function startKiesModus(info) {
  leegSelectie(); // een eventuele selectie om door te sturen niet per ongeluk meenemen
  zetKiesModus(info);
  location.hash = '#/';
}

async function kiesKlaar(m) {
  const knop = $('#kies-klaar');
  if (knop) knop.disabled = true;
  try {
    const n = await kiesDoelen[m.soort](m.id, gekozenFiches());
    zetKiesModus(null);
    leegSelectie();
    ctx.melding(`${n} ${n === 1 ? 'oefening' : 'oefeningen'} toegevoegd aan ${m.titel}.`);
    location.hash = m.terug;
  } catch (e) {
    ctx.melding(e.message);
    if (knop) knop.disabled = false;
  }
}

bijSelectieWijziging(() => werkKiesbalkBij());

const doseringTekst = it => {
  const delen = [];
  if (it.sets && it.herhalingen) delen.push(`${it.sets} × ${it.herhalingen}`);
  else if (it.sets) delen.push(`${it.sets} sets`);
  else if (it.herhalingen) delen.push(it.herhalingen);
  if (it.frequentie) delen.push(it.frequentie);
  return delen.join(' · ');
};

const naamVan = p => p.naam ? `${p.naam} (${p.code})` : p.code;

// ===================================================================================
// Therapeut
// ===================================================================================

export function patientenTegel(esc) {
  return `
      <div class="tegel tegel-patienten">
        <a class="tegel-link" href="#/patienten">
          <span class="tegel-titel">Patiënten</span>
          <span class="tegel-sub">Accounts en oefenprogramma's</span>
        </a>
      </div>`;
}

export async function toonTherapeut(delen) {
  const { esc, inhoud } = ctx;
  $('#terug').hidden = false;
  const thuis = `<a href="#/">${esc(ctx.appTitel())}</a> <span class="sep">›</span>`;
  inhoud.innerHTML = '<p class="ondertitel">Even geduld…</p>';
  if (!navigator.onLine) {
    $('#kruimels').innerHTML = `${thuis} <span class="huidig">Patiënten</span>`;
    inhoud.innerHTML = '<h1>Patiënten</h1><div class="leeg">Zonder internet kan je de patiënten niet bekijken.</div>';
    return;
  }
  try {
    if (!delen.length) return await lijst(thuis);
    if (delen[1] === 'programma' && delen[2]) return await programmaScherm(delen[0], delen[2], thuis);
    if (delen[1]) { location.hash = `#/patienten/${delen[0]}`; return; }
    return await patientScherm(delen[0], thuis);
  } catch (e) {
    inhoud.innerHTML = `<h1>Patiënten</h1><div class="leeg">${esc(e.message || 'Er liep iets mis.')}</div>`;
  }
}

async function lijst(thuis) {
  const { esc, inhoud } = ctx;
  $('#kruimels').innerHTML = `${thuis} <span class="huidig">Patiënten</span>`;
  const rijen = await bron.patienten();
  inhoud.innerHTML = `
    <h1>Patiënten</h1>
    <p class="ondertitel">Elke patiënt krijgt een code en een wachtwoord om thuis zijn programma te bekijken.</p>
    <div class="beheer-balk"><button class="knop knop-hoofd" id="nieuwe-patient">+ Patiënt toevoegen</button></div>
    ${rijen.length ? `<ul class="lijst">${rijen.map(p => {
      const actief = (p.programmas || []).filter(x => x.actief).length;
      return `<li><a href="#/patienten/${encodeURIComponent(p.id)}">
        <span class="lijst-titel">${esc(p.naam || p.code)}</span>
        <span class="lijst-sub">${esc(p.code)} · ${actief} ${actief === 1 ? 'actief programma' : "actieve programma's"}</span>
      </a></li>`;
    }).join('')}</ul>` : '<div class="leeg">Nog geen patiënten.</div>'}`;

  $('#nieuwe-patient').addEventListener('click', async () => {
    const r = await ctx.dialoog({
      titel: 'Patiënt toevoegen',
      okTekst: 'Aanmaken',
      velden: [
        { soort: 'uitleg', tekst: 'De app maakt een patiëntcode en een wachtwoord. Die geef je mee op papier of als QR-code.' },
        { naam: 'naam', label: 'Voornaam of initialen (optioneel)', hulp: 'Geen achternaam, geboortedatum of diagnose. De volledige gegevens blijven in je praktijksoftware.' }
      ]
    });
    if (!r) return;
    try {
      ctx.melding('Patiënt aanmaken…');
      const uit = await bron.maakPatient(r.naam);
      await toonToegangskaart({ code: uit.code, wachtwoord: uit.wachtwoord, naam: r.naam, nieuw: true });
      location.hash = `#/patienten/${encodeURIComponent(uit.id)}`;
    } catch (e) { ctx.melding(e.message); }
  });
}

async function patientScherm(pid, thuis) {
  const { esc, inhoud } = ctx;
  const p = (await bron.patienten()).find(x => x.id === pid);
  if (!p) { location.hash = '#/patienten'; return; }
  const progs = await bron.programmasVan(pid);
  $('#kruimels').innerHTML = `${thuis} <a href="#/patienten">Patiënten</a> <span class="sep">›</span> <span class="huidig">${esc(p.naam || p.code)}</span>`;
  inhoud.innerHTML = `
    <h1>${esc(p.naam || p.code)}</h1>
    <p class="ondertitel">Code ${esc(p.code)}</p>
    <div class="beheer-balk">
      <button class="knop knop-hoofd" id="nieuw-programma">+ Nieuw programma</button>
      <button class="knop knop-plat" id="wijzig-naam">Naam wijzigen</button>
      <button class="knop knop-plat" id="nieuwe-code">Nieuwe toegangscode</button>
      <button class="knop knop-gevaar" id="verwijder">Patiënt verwijderen</button>
    </div>
    ${progs.length ? `<ul class="lijst">${progs.map(g => `
      <li><a href="#/patienten/${encodeURIComponent(pid)}/programma/${encodeURIComponent(g.id)}">
        <span class="lijst-titel">${esc(g.titel)} <span class="label ${g.actief ? 'label-aan' : ''}">${g.actief ? 'Actief' : 'Gestopt'}</span></span>
        <span class="lijst-sub">${(g.programma_items || []).length} ${(g.programma_items || []).length === 1 ? 'oefening' : 'oefeningen'}${g.opmerking ? ' · ' + esc(g.opmerking) : ''}</span>
      </a></li>`).join('')}</ul>` : '<div class="leeg">Nog geen programma. Maak er een aan.</div>'}`;

  $('#nieuw-programma').addEventListener('click', async () => {
    const r = await ctx.dialoog({
      titel: 'Nieuw programma', okTekst: 'Aanmaken',
      velden: [
        { naam: 'titel', label: 'Titel', waarde: 'Oefenprogramma', verplicht: true },
        { naam: 'opmerking', label: 'Algemene opmerking voor de patiënt (optioneel)', placeholder: 'bv. Stop als de pijn boven 3/10 gaat.' }
      ]
    });
    if (!r) return;
    try {
      const g = await bron.maakProgramma({ patient_id: pid, titel: r.titel, opmerking: r.opmerking, actief: true, aangemaakt_door: ctx.profielId() });
      location.hash = `#/patienten/${encodeURIComponent(pid)}/programma/${encodeURIComponent(g.id)}`;
    } catch (e) { ctx.melding(e.message); }
  });

  $('#wijzig-naam').addEventListener('click', async () => {
    const r = await ctx.dialoog({
      titel: 'Naam wijzigen', okTekst: 'Bewaren',
      velden: [{ naam: 'naam', label: 'Voornaam of initialen (optioneel)', waarde: p.naam, hulp: 'Geen achternaam, geboortedatum of diagnose.' }]
    });
    if (!r) return;
    try { await bron.wijzigPatient(pid, { naam: r.naam.slice(0, 60) }); ctx.toon(); } catch (e) { ctx.melding(e.message); }
  });

  $('#nieuwe-code').addEventListener('click', async () => {
    if (!await ctx.bevestig('Nieuwe toegangscode?', 'De patiënt krijgt een nieuw wachtwoord. Het oude werkt dan niet meer, ook niet op zijn gsm.', 'Nieuw wachtwoord maken')) return;
    try {
      const uit = await bron.nieuweCode(pid);
      await toonToegangskaart({ code: uit.code, wachtwoord: uit.wachtwoord, naam: p.naam });
    } catch (e) { ctx.melding(e.message); }
  });

  $('#verwijder').addEventListener('click', async () => {
    if (!await ctx.bevestig(`${naamVan(p)} verwijderen?`, "Het account en alle programma's van deze patiënt worden definitief gewist. Dit kan je niet ongedaan maken.", 'Definitief verwijderen')) return;
    try {
      await bron.verwijderPatient(pid);
      ctx.melding('Patiënt verwijderd.');
      location.hash = '#/patienten';
    } catch (e) { ctx.melding(e.message); }
  });
}

async function programmaScherm(pid, progId, thuis) {
  const { esc, inhoud } = ctx;
  const g = await bron.programma(progId);
  const p = (await bron.patienten()).find(x => x.id === pid);
  if (!g || !p || g.patient_id !== pid) { location.hash = `#/patienten/${encodeURIComponent(pid)}`; return; }
  const items = [...(g.programma_items || [])].sort((a, b) => a.volgorde - b.volgorde);
  const perId = new Map(ctx.alleFichesMetPlaats().map(x => [x.f.id, x]));

  $('#kruimels').innerHTML = `${thuis} <a href="#/patienten">Patiënten</a> <span class="sep">›</span>
    <a href="#/patienten/${encodeURIComponent(pid)}">${esc(p.naam || p.code)}</a> <span class="sep">›</span> <span class="huidig">${esc(g.titel)}</span>`;

  inhoud.innerHTML = `
    <h1>${esc(g.titel)} <span class="label ${g.actief ? 'label-aan' : ''}">${g.actief ? 'Actief' : 'Gestopt'}</span></h1>
    <p class="ondertitel">${esc(naamVan(p))}${g.opmerking ? ' · ' + esc(g.opmerking) : ''}</p>
    <div class="beheer-balk">
      <button class="knop knop-plat" id="wijzig-prog">Titel en opmerking</button>
      <button class="knop knop-plat" id="actief">${g.actief ? 'Stopzetten' : 'Opnieuw activeren'}</button>
      <button class="knop knop-gevaar" id="wis-prog">Programma wissen</button>
    </div>

    <div class="paneel">
      <h2>Oefeningen toevoegen</h2>
      <p>Kies fiches uit de oefen- en informatiefiches. Je komt daarna vanzelf hier terug.</p>
      <div class="knoppen">
        <button class="knop knop-hoofd" id="kies-fiches">+ Toevoegen</button>
      </div>
    </div>

    ${items.length ? `<ol class="oefeningen">${items.map((it, i) => {
      const x = perId.get(it.fiche_id);
      return `<li class="oefening" data-item="${esc(it.id)}">
        <div class="oefening-kop">
          <span class="oefening-titel">${x ? `<a href="${ctx.link([...x.ids, x.f.id])}">${esc(x.f.titel)}</a>` : it.fiche ? esc(it.fiche.titel) : '<i>Fiche niet meer gevonden</i>'}</span>
          <span class="oefening-acties">
            <button class="knop knop-plat klein" data-actie="op" ${i === 0 ? 'disabled' : ''} aria-label="Naar boven">▲</button>
            <button class="knop knop-plat klein" data-actie="neer" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Naar onder">▼</button>
            <button class="knop knop-plat klein weg" data-actie="weg" aria-label="Weghalen">✕</button>
          </span>
        </div>
        <div class="dosering">
          <label>Sets<input name="sets" value="${esc(it.sets)}" inputmode="numeric" placeholder="3"></label>
          <label>Herhalingen<input name="herhalingen" value="${esc(it.herhalingen)}" placeholder="10 of 30 s"></label>
          <label>Hoe vaak<input name="frequentie" value="${esc(it.frequentie)}" placeholder="2× per dag"></label>
          <label class="breed">Notitie<input name="notitie" value="${esc(it.notitie)}" placeholder="bv. traag naar beneden"></label>
        </div>
      </li>`;
    }).join('')}</ol>` : '<div class="leeg">Nog geen oefeningen in dit programma.</div>'}`;

  const opnieuw = () => programmaScherm(pid, progId, thuis);

  $('#kies-fiches').addEventListener('click', () => startKiesModus({
    soort: 'programma', id: progId, titel: g.titel, sub: p.naam || p.code,
    terug: `#/patienten/${encodeURIComponent(pid)}/programma/${encodeURIComponent(progId)}`
  }));

  $('#wijzig-prog').addEventListener('click', async () => {
    const r = await ctx.dialoog({
      titel: 'Programma wijzigen', okTekst: 'Bewaren',
      velden: [
        { naam: 'titel', label: 'Titel', waarde: g.titel, verplicht: true },
        { naam: 'opmerking', label: 'Algemene opmerking voor de patiënt (optioneel)', waarde: g.opmerking }
      ]
    });
    if (!r) return;
    try { await bron.wijzigProgramma(progId, { titel: r.titel, opmerking: r.opmerking }); opnieuw(); } catch (e) { ctx.melding(e.message); }
  });

  $('#actief').addEventListener('click', async () => {
    try {
      await bron.wijzigProgramma(progId, { actief: !g.actief });
      ctx.melding(g.actief ? 'Programma stopgezet: de patiënt ziet het niet meer.' : 'Programma opnieuw actief.');
      opnieuw();
    } catch (e) { ctx.melding(e.message); }
  });

  $('#wis-prog').addEventListener('click', async () => {
    if (!await ctx.bevestig(`"${g.titel}" wissen?`, 'Het programma verdwijnt ook bij de patiënt. De fiches zelf blijven bestaan.')) return;
    try { await bron.wisProgramma(progId); location.hash = `#/patienten/${encodeURIComponent(pid)}`; } catch (e) { ctx.melding(e.message); }
  });

  // Dosering: bewaren zodra je een veld verlaat
  inhoud.querySelectorAll('.oefening').forEach(li => {
    const itemId = li.dataset.item;
    const it = items.find(x => x.id === itemId);
    li.querySelectorAll('.dosering input').forEach(inp => inp.addEventListener('change', async () => {
      const waarde = inp.value.trim().slice(0, 200);
      try { await bron.wijzigItem(itemId, { [inp.name]: waarde }); it[inp.name] = waarde; ctx.melding('Bewaard.'); }
      catch (e) { ctx.melding(e.message); }
    }));
    li.querySelectorAll('[data-actie]').forEach(knop => knop.addEventListener('click', async () => {
      const i = items.indexOf(it);
      try {
        if (knop.dataset.actie === 'weg') {
          await bron.wisItem(itemId);
        } else {
          const j = knop.dataset.actie === 'op' ? i - 1 : i + 1;
          const a = items[i], b = items[j];
          await bron.wijzigItem(a.id, { volgorde: j });
          await bron.wijzigItem(b.id, { volgorde: i });
          // overige volgnummers netjes houden
          for (const [k, x] of items.entries()) if (k !== i && k !== j && x.volgorde !== k) await bron.wijzigItem(x.id, { volgorde: k });
        }
        opnieuw();
      } catch (e) { ctx.melding(e.message); }
    }));
  });
}

// Kaartje met code, wachtwoord en QR-code om aan de patiënt te geven
function toonToegangskaart({ code, wachtwoord, naam, nieuw = false }) {
  const { esc } = ctx;
  const url = `${location.origin}${location.pathname}#/aanmelden/${encodeURIComponent(code)}/${encodeURIComponent(wachtwoord)}`;
  let qrSvg = '';
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    qrSvg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR-code om aan te melden' });
  } catch { /* zonder QR: code en wachtwoord volstaan */ }

  const kaart = `
    <div class="kaart-inhoud">
      <h2>${esc(ctx.appTitel())}: je oefenprogramma</h2>
      ${naam ? `<p>Voor: <b>${esc(naam)}</b></p>` : ''}
      <div class="kaart-qr">${qrSvg}</div>
      <p>Scan de QR-code met de camera van je gsm, of ga naar<br><b>${esc(location.origin + location.pathname)}</b></p>
      <dl class="kaart-gegevens">
        <dt>Patiëntcode</dt><dd>${esc(code)}</dd>
        <dt>Wachtwoord</dt><dd>${esc(wachtwoord)}</dd>
      </dl>
      <p class="hulp">Tip: zet de app op het beginscherm van je gsm (Deel → Zet op beginscherm).</p>
    </div>`;

  let dlg = $('#kaart-dialoog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'kaart-dialoog';
    dlg.className = 'kaart-dialoog';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `
    ${kaart}
    <p class="hulp kaart-let-op">${nieuw ? 'Patiënt aangemaakt. ' : ''}Noteer of druk dit nu af: het wachtwoord wordt nergens bewaard en is later niet meer te zien.</p>
    <div class="dialoog-knoppen">
      <button type="button" class="knop knop-plat" id="kaart-print">Afdrukken</button>
      <button type="button" class="knop knop-hoofd" id="kaart-sluit">Klaar</button>
    </div>`;
  return new Promise(resolve => {
    dlg.onclose = () => { dlg.innerHTML = ''; resolve(); }; // wachtwoord niet laten rondslingeren
    $('#kaart-sluit').addEventListener('click', () => dlg.close());
    $('#kaart-print').addEventListener('click', () => {
      const vak = $('#printvak');
      vak.innerHTML = kaart;
      document.body.classList.add('print-kaart');
      const klaar = () => { document.body.classList.remove('print-kaart'); vak.innerHTML = ''; window.removeEventListener('afterprint', klaar); };
      window.addEventListener('afterprint', klaar);
      window.print();
      setTimeout(klaar, 60000); // vangnet als 'afterprint' niet komt
    });
    dlg.showModal();
  });
}

// ===================================================================================
// Patiënt: Mijn programma
// ===================================================================================

let programmas = [];

export async function startPatient() {
  const knop = id => { const k = $(id); if (k) k.hidden = true; };
  knop('#beheer'); knop('#instellingen');
  document.body.classList.add('patient-modus');
  programmas = (await db.get('mijnProgrammas')) || [];
  window.addEventListener('hashchange', toonPatient);
  $('#terug').addEventListener('click', () => { location.hash = '#/'; });
  toonPatient();
  await werkPatientBij();
  window.addEventListener('online', werkPatientBij);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) werkPatientBij(); });
}

let bezig = false;
async function werkPatientBij() {
  if (bezig || !navigator.onLine) return;
  bezig = true;
  try {
    const nieuw = await bron.mijnProgrammas();
    // Bestanden van de fiches lokaal bewaren, zodat het programma ook zonder internet werkt
    const nodig = new Set();
    for (const g of nieuw) for (const it of g.programma_items || []) {
      const f = it.fiche;
      if (!f) continue;
      nodig.add(f.id);
      const lokaal = await db.getFiche(f.id);
      if (lokaal && lokaal.versie === f.bijgewerkt) continue;
      try {
        if (f.soort === 'tekst') await db.putFiche({ id: f.id, tekst: f.tekst || '', versie: f.bijgewerkt });
        else await db.putFiche({ id: f.id, mime: f.mime, bestandsnaam: f.bestandsnaam, data: await bron.download(f.bestand_pad), versie: f.bijgewerkt });
      } catch { /* later opnieuw */ }
    }
    const weg = (await db.ficheIds()).filter(id => !nodig.has(id));
    if (weg.length) await db.deleteFiches(weg);
    programmas = nieuw;
    await db.put('mijnProgrammas', nieuw);
    if (!$('#dialoog').open) toonPatient();
  } catch { /* offline of server onbereikbaar: laatst gekende programma tonen */ }
  bezig = false;
}

function toonPatient() {
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  const delen = ctx.pad();
  if (delen[0] === 'oefening' && delen[1]) return toonOefening(delen[1]);
  if (delen.length) { history.replaceState(null, '', '#/'); }
  toonMijnProgramma();
}

function toonMijnProgramma() {
  const { esc, inhoud } = ctx;
  $('#terug').hidden = true;
  $('#kruimels').innerHTML = `<span class="huidig">Mijn programma</span>`;
  document.title = 'Mijn programma';
  inhoud.innerHTML = `
    <h1>Mijn programma</h1>
    ${programmas.length ? programmas.map(g => {
      const items = [...(g.programma_items || [])].filter(it => it.fiche).sort((a, b) => a.volgorde - b.volgorde);
      return `<section class="programma">
        <h2>${esc(g.titel)}</h2>
        ${g.opmerking ? `<p class="programma-opmerking">${esc(g.opmerking)}</p>` : ''}
        <ol class="kaarten">${items.map(it => `
          <li><a class="kaart" href="#/oefening/${encodeURIComponent(it.id)}">
            <span class="kaart-titel">${esc(it.fiche.titel)}</span>
            ${doseringTekst(it) ? `<span class="kaart-dosering">${esc(doseringTekst(it))}</span>` : ''}
            ${it.notitie ? `<span class="kaart-notitie">${esc(it.notitie)}</span>` : ''}
          </a></li>`).join('')}</ol>
      </section>`;
    }).join('') : `<div class="leeg">Je therapeut heeft nog geen programma voor je klaargezet.</div>`}
    <div class="patient-voet">
      <button class="knop knop-plat" id="afmelden">Afmelden</button>
    </div>`;
  $('#afmelden').addEventListener('click', async () => {
    if (!await ctx.bevestig('Afmelden?', 'Je hebt daarna je code en wachtwoord nodig om opnieuw aan te melden.', 'Afmelden')) return;
    try { await bron.afmelden(); } catch { /* offline */ }
    await db.del('profiel');
    await db.del('mijnProgrammas');
    location.replace(location.pathname + '#/');
    location.reload();
  });
}

async function toonOefening(itemId) {
  const { esc, inhoud } = ctx;
  let it = null, g = null;
  for (const p of programmas) for (const x of p.programma_items || []) if (x.id === itemId) { it = x; g = p; }
  if (!it || !it.fiche) { location.hash = '#/'; return; }
  $('#terug').hidden = false;
  $('#kruimels').innerHTML = `<a href="#/">Mijn programma</a> <span class="sep">›</span> <span class="huidig">${esc(it.fiche.titel)}</span>`;
  const pagina = location.hash;
  const inh = await db.getFiche(it.fiche.id);
  if (location.hash !== pagina) return;
  const { html, url } = ctx.ficheVlak(it.fiche, inh);
  blobUrl = url;
  inhoud.innerHTML = `
    <div class="viewer">
      <div class="viewer-kop"><h1>${esc(it.fiche.titel)}</h1></div>
      ${doseringTekst(it) || it.notitie ? `<div class="dosering-groot">
        ${doseringTekst(it) ? `<b>${esc(doseringTekst(it))}</b>` : ''}
        ${it.notitie ? `<span>${esc(it.notitie)}</span>` : ''}
      </div>` : ''}
      ${it.fiche.omschrijving ? `<p class="viewer-omschrijving">${esc(it.fiche.omschrijving)}</p>` : ''}
      ${inh ? html : '<div class="leeg">Deze fiche is nog niet binnengehaald. Open de app eens met internet.</div>'}
      <div class="viewer-nav"><a class="knop knop-plat" href="#/">‹ Terug naar ${esc(g.titel)}</a><span></span></div>
    </div>`;
}
