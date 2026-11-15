// Opvolging stap 1: overzicht van de protocollen (VKB, enkel) met hun fasen.
// Enkel voor het team, in Beheer (gedeelde modus).
//
//   #/protocollen                     lijst van protocollen
//   #/protocollen/<id>                de fasen van één protocol
//   #/protocollen/<id>/fase/<nummer>  één fase: zichtbaarheid, patiëntteksten, standaardoefeningen, criteria
//
// De klinische inhoud (fasen, criteria, drempels) staat in de databank, niet in de code.

import * as bron from './bron.js';
import { startKiesModus, registreerKiesDoel } from './patienten.js';

let ctx = null;
const $ = sel => document.querySelector(sel);

const ZICHTBAAR = [
  ['oefeningen', 'Oefeningen', 'De standaardoefeningen van deze fase, met dosering.'],
  ['doel', 'Doel en uitleg', 'De titel en het doel van de fase in patiënttaal.'],
  ['criteria', 'Criteria en voortgang', 'De patiëntteksten van de criteria en hoeveel er behaald zijn.'],
  ['testresultaten', 'Testresultaten', 'Metingen en LSI-grafieken (komt in stap 4).']
];

export function initProtocollen(hulp) {
  ctx = hulp;
  ctx.opvolgingVoor = (...a) => opvolgingVoor(...a); // gebruikt op het scherm van een patiënt
  // Gekozen fiches toevoegen aan de standaardoefeningen van een fase
  registreerKiesDoel('fase', async (faseId, gekozen) => {
    const items = await bron.faseOefeningen(faseId);
    const bestaand = new Set(items.map(it => it.fiche_id));
    let volgorde = items.reduce((mx, it) => Math.max(mx, it.volgorde + 1), 0);
    const nieuw = gekozen.filter(x => !bestaand.has(x.id));
    if (nieuw.length) await bron.voegFaseOefeningenToe(nieuw.map(x => ({ fase_id: faseId, fiche_id: x.id, volgorde: volgorde++ })));
    return nieuw.length;
  });
}

export function protocollenTegel() {
  return `
      <div class="tegel tegel-protocollen">
        <a class="tegel-link" href="#/protocollen">
          <span class="tegel-titel">Protocollen</span>
          <span class="tegel-sub">Fasen, criteria en wat de patiënt ziet</span>
        </a>
      </div>`;
}

export async function toonProtocollen(delen) {
  const { esc, inhoud } = ctx;
  $('#terug').hidden = false;
  const thuis = `<a href="#/">${esc(ctx.appTitel())}</a> <span class="sep">›</span>`;
  inhoud.innerHTML = '<p class="ondertitel">Even geduld…</p>';
  if (!navigator.onLine) {
    $('#kruimels').innerHTML = `${thuis} <span class="huidig">Protocollen</span>`;
    inhoud.innerHTML = '<h1>Protocollen</h1><div class="leeg">Zonder internet kan je de protocollen niet bekijken.</div>';
    return;
  }
  try {
    if (!delen.length) return await lijst(thuis);
    if (delen[1] === 'fase' && delen[2]) return await faseScherm(delen[0], Number(delen[2]), thuis);
    if (delen[1]) { location.hash = `#/protocollen/${encodeURIComponent(delen[0])}`; return; }
    return await protocolScherm(delen[0], thuis);
  } catch (e) {
    const m = /does not exist|schema cache|relation/i.test(e.message || '')
      ? 'De protocoltabellen staan nog niet in Supabase. Voer eerst 004_protocollen.sql en de protocolinhoud uit (zie README).'
      : (e.message || 'Er liep iets mis.');
    inhoud.innerHTML = `<h1>Protocollen</h1><div class="leeg">${esc(m)}</div>`;
  }
}

const tel = p => {
  const fasen = p.protocol_fasen || [];
  const criteria = fasen.flatMap(f => f.protocol_criteria || []);
  return {
    fasen: fasen.length,
    criteria: criteria.length,
    concepten: criteria.filter(c => c.patient_concept).length + fasen.filter(f => f.doel_concept).length,
    oefeningen: fasen.reduce((t, f) => t + (f.fase_oefeningen || []).length, 0)
  };
};

async function lijst(thuis) {
  const { esc, inhoud } = ctx;
  $('#kruimels').innerHTML = `${thuis} <span class="huidig">Protocollen</span>`;
  const rijen = await bron.protocollen();
  inhoud.innerHTML = `
    <h1>Protocollen</h1>
    <p class="ondertitel">Per fase stel je de standaardoefeningen in en kies je wat de patiënt te zien krijgt.</p>
    ${rijen.length ? `<ul class="lijst">${rijen.map(p => {
      const t = tel(p);
      return `<li><a href="#/protocollen/${encodeURIComponent(p.id)}">
        <span class="lijst-titel">${esc(p.naam)} ${t.concepten ? `<span class="label label-concept">${t.concepten} te keuren</span>` : ''}</span>
        <span class="lijst-sub">${t.fasen} fasen · ${t.criteria} criteria · ${t.oefeningen} standaardoefeningen${p.status ? ' · ' + esc(p.status) : ''}</span>
      </a></li>`;
    }).join('')}</ul>` : '<div class="leeg">Nog geen protocollen. Voer de protocolinhoud uit in Supabase (zie README).</div>'}`;
}

async function protocolScherm(pid, thuis) {
  const { esc, inhoud } = ctx;
  const p = (await bron.protocollen()).find(x => x.id === pid);
  if (!p) { location.hash = '#/protocollen'; return; }
  const fasen = [...(p.protocol_fasen || [])].sort((a, b) => a.nummer - b.nummer);
  $('#kruimels').innerHTML = `${thuis} <a href="#/protocollen">Protocollen</a> <span class="sep">›</span> <span class="huidig">${esc(p.naam)}</span>`;
  inhoud.innerHTML = `
    <h1>${esc(p.naam)}</h1>
    <p class="ondertitel">${esc(p.versie || '')}${p.status ? ' · ' + esc(p.status) : ''}</p>
    <ul class="lijst">${fasen.map(f => {
      const crit = f.protocol_criteria || [];
      const concepten = crit.filter(c => c.patient_concept).length + (f.doel_concept ? 1 : 0);
      const aan = ZICHTBAAR.filter(([k]) => f.zichtbaar?.[k]).map(([, l]) => l);
      return `<li><a href="#/protocollen/${encodeURIComponent(pid)}/fase/${f.nummer}">
        <span class="lijst-titel">Fase ${f.nummer}: ${esc(f.titel)} ${concepten ? `<span class="label label-concept">${concepten} te keuren</span>` : ''}</span>
        <span class="lijst-sub">Patiënt: ${esc(f.titel_patient || '—')}${f.ondergrens_weken != null ? ` · vanaf week ${String(f.ondergrens_weken).replace('.', ',')}` : ''}
          · ${crit.length} criteria · ${(f.fase_oefeningen || []).length} oefeningen</span>
        <span class="lijst-sub">Zichtbaar voor de patiënt: ${aan.length ? esc(aan.join(', ')) : 'niets'}</span>
      </a></li>`;
    }).join('')}</ul>`;
}

async function faseScherm(pid, nummer, thuis) {
  const { esc, inhoud } = ctx;
  const f = await bron.protocolFase(pid, nummer);
  const crit = [...(f.protocol_criteria || [])].sort((a, b) => a.volgorde - b.volgorde);
  const oef = [...(f.fase_oefeningen || [])].sort((a, b) => a.volgorde - b.volgorde);
  const perId = new Map(ctx.alleFichesMetPlaats().map(x => [x.f.id, x]));
  const zichtbaar = { oefeningen: true, doel: true, criteria: true, testresultaten: false, ...(f.zichtbaar || {}) };
  const concepten = crit.filter(c => c.patient_concept).length;
  const hier = `#/protocollen/${encodeURIComponent(pid)}/fase/${nummer}`;

  $('#kruimels').innerHTML = `${thuis} <a href="#/protocollen">Protocollen</a> <span class="sep">›</span>
    <a href="#/protocollen/${encodeURIComponent(pid)}">${esc(f.protocol?.naam || pid)}</a> <span class="sep">›</span> <span class="huidig">Fase ${nummer}</span>`;

  inhoud.innerHTML = `
    <h1>Fase ${nummer}: ${esc(f.titel)}</h1>
    <p class="ondertitel">${esc(f.wanneer || '')}${f.ondergrens_weken != null ? ` · biologische ondergrens week ${String(f.ondergrens_weken).replace('.', ',')}` : ''}</p>

    <div class="paneel">
      <h2>Zichtbaar voor de patiënt</h2>
      <p>Standaard voor iedereen in deze fase. Per patiënt kan je dit later nog aanpassen.</p>
      <div class="schakelaars">${ZICHTBAAR.map(([k, l, uitleg]) => `
        <label class="schakelaar">
          <input type="checkbox" data-zichtbaar="${k}" ${zichtbaar[k] ? 'checked' : ''}>
          <span><b>${l}</b><br><span class="hulp">${uitleg}</span></span>
        </label>`).join('')}</div>
    </div>

    <div class="paneel">
      <h2>Wat de patiënt leest ${f.doel_concept ? '<span class="label label-concept">concept</span>' : ''}</h2>
      <p class="patient-titel"><b>${esc(f.titel_patient || '—')}</b></p>
      <p>${esc(f.doel_patient || '—')}</p>
      <div class="knoppen">
        <button class="knop knop-plat" id="wijzig-doel">Wijzigen</button>
        ${f.doel_concept ? '<button class="knop knop-hoofd" id="keur-doel">Goedkeuren</button>' : ''}
      </div>
    </div>

    <div class="paneel">
      <h2>Standaardoefeningen</h2>
      <p>Deze oefeningen neem je over als een patiënt in deze fase start. Daar kan je ze nog aanpassen.</p>
      <div class="knoppen"><button class="knop knop-hoofd" id="kies-fiches">+ Toevoegen</button></div>
    </div>
    ${oef.length ? `<ol class="oefeningen">${oef.map((it, i) => {
      const x = perId.get(it.fiche_id);
      return `<li class="oefening" data-item="${esc(it.id)}">
        <div class="oefening-kop">
          <span class="oefening-titel">${x ? `<a href="${ctx.link([...x.ids, x.f.id])}">${esc(x.f.titel)}</a>` : it.fiche ? esc(it.fiche.titel) : '<i>Fiche niet meer gevonden</i>'}</span>
          <span class="oefening-acties">
            <button class="knop knop-plat klein" data-actie="op" ${i === 0 ? 'disabled' : ''} aria-label="Naar boven">▲</button>
            <button class="knop knop-plat klein" data-actie="neer" ${i === oef.length - 1 ? 'disabled' : ''} aria-label="Naar onder">▼</button>
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
    }).join('')}</ol>` : '<div class="leeg">Nog geen standaardoefeningen in deze fase.</div>'}

    <div class="paneel paneel-ruimte">
      <h2>Criteria om deze fase af te ronden (${crit.length})</h2>
      ${concepten ? `<p>${concepten} patiëntteksten zijn nog een <b>concept</b>. Lees ze na en keur ze goed.</p>
        <div class="knoppen"><button class="knop knop-plat" id="keur-alle">Alle ${concepten} goedkeuren</button></div>` : '<p>Alle patiëntteksten zijn goedgekeurd.</p>'}
    </div>
    <ol class="criteria">${crit.map(c => `
      <li class="criterium" data-crit="${esc(c.id)}">
        <div class="criterium-kop">
          <b>${esc(c.criterium)}</b>
          <span class="criterium-meta">${esc(c.drempel)}${c.niveau ? ` · niveau ${esc(c.niveau)}` : ''}${c.bron ? ` · ${esc(c.bron)}` : ''}</span>
        </div>
        ${c.testmethode ? `<div class="hulp">Test: ${esc(c.testmethode)}</div>` : ''}
        ${c.bij_niet_halen ? `<div class="criterium-actie">Bij niet halen: ${esc(c.bij_niet_halen)}</div>` : ''}
        <div class="criterium-patient">
          <span>Patiënt leest: “${esc(c.patient_tekst || '—')}” ${c.patient_concept ? '<span class="label label-concept">concept</span>' : ''}</span>
          <span class="criterium-knoppen">
            <button class="knop knop-plat klein" data-crit-actie="wijzig">Wijzigen</button>
            ${c.patient_concept ? '<button class="knop knop-plat klein" data-crit-actie="keur">Goedkeuren</button>' : ''}
          </span>
        </div>
      </li>`).join('')}</ol>

    ${f.scope || f.opmerkingen ? `<details class="paneel">
      <summary><b>Scope en opmerkingen (enkel voor de therapeut)</b></summary>
      ${f.scope ? `<p>${esc(f.scope)}</p>` : ''}
      ${(f.opmerkingen || '').split(/\n\n+/).filter(Boolean).map(o => `<p>${esc(o)}</p>`).join('')}
    </details>` : ''}`;

  const opnieuw = () => faseScherm(pid, nummer, thuis);
  const fout = e => ctx.melding(e.message || 'Er liep iets mis.');

  // Zichtbaarheid: meteen bewaren
  inhoud.querySelectorAll('[data-zichtbaar]').forEach(cb => cb.addEventListener('change', async () => {
    zichtbaar[cb.dataset.zichtbaar] = cb.checked;
    try { await bron.wijzigFase(f.id, { zichtbaar }); ctx.melding('Bewaard.'); }
    catch (e) { cb.checked = !cb.checked; zichtbaar[cb.dataset.zichtbaar] = cb.checked; fout(e); }
  }));

  $('#wijzig-doel').addEventListener('click', async () => {
    const r = await ctx.dialoog({
      titel: `Fase ${nummer}: wat de patiënt leest`, okTekst: 'Bewaren en goedkeuren',
      velden: [
        { naam: 'titel_patient', label: 'Titel voor de patiënt', waarde: f.titel_patient, verplicht: true },
        { naam: 'doel_patient', label: 'Doel voor de patiënt', soort: 'tekstvak', waarde: f.doel_patient,
          hulp: 'Korte zinnen, positief, zonder vakjargon.' }
      ]
    });
    if (!r) return;
    try { await bron.wijzigFase(f.id, { titel_patient: r.titel_patient, doel_patient: r.doel_patient, doel_concept: false }); opnieuw(); } catch (e) { fout(e); }
  });
  const keurDoel = $('#keur-doel');
  if (keurDoel) keurDoel.addEventListener('click', async () => {
    try { await bron.wijzigFase(f.id, { doel_concept: false }); opnieuw(); } catch (e) { fout(e); }
  });

  $('#kies-fiches').addEventListener('click', () => startKiesModus({
    soort: 'fase', id: f.id, titel: `Fase ${nummer}: ${f.titel_patient || f.titel}`, sub: f.protocol?.naam || '', terug: hier
  }));

  const keurAlle = $('#keur-alle');
  if (keurAlle) keurAlle.addEventListener('click', async () => {
    if (!await ctx.bevestig(`Alle ${concepten} goedkeuren?`, 'Je verklaart dat je alle patiëntteksten van deze fase nagelezen hebt.', 'Goedkeuren')) return;
    try { await bron.keurCriteriaGoed(f.id); opnieuw(); } catch (e) { fout(e); }
  });

  // Criteria: patiënttekst wijzigen of goedkeuren
  inhoud.querySelectorAll('.criterium').forEach(li => {
    const c = crit.find(x => x.id === li.dataset.crit);
    li.querySelectorAll('[data-crit-actie]').forEach(knop => knop.addEventListener('click', async () => {
      try {
        if (knop.dataset.critActie === 'keur') {
          await bron.wijzigCriterium(c.id, { patient_concept: false });
        } else {
          const r = await ctx.dialoog({
            titel: 'Patiënttekst', okTekst: 'Bewaren en goedkeuren',
            velden: [
              { soort: 'uitleg', tekst: `Criterium: ${c.criterium} (${c.drempel})` },
              { naam: 'tekst', label: 'Wat de patiënt leest', waarde: c.patient_tekst, verplicht: true, hulp: 'Eén korte zin, positief, zonder vakjargon.' }
            ]
          });
          if (!r) return;
          await bron.wijzigCriterium(c.id, { patient_tekst: r.tekst, patient_concept: false });
        }
        opnieuw();
      } catch (e) { fout(e); }
    }));
  });

  // Standaardoefeningen: dosering bewaren bij het verlaten van een veld, volgorde, weghalen
  inhoud.querySelectorAll('.oefening').forEach(li => {
    const it = oef.find(x => x.id === li.dataset.item);
    li.querySelectorAll('.dosering input').forEach(inp => inp.addEventListener('change', async () => {
      const waarde = inp.value.trim().slice(0, 200);
      try { await bron.wijzigFaseOefening(it.id, { [inp.name]: waarde }); it[inp.name] = waarde; ctx.melding('Bewaard.'); } catch (e) { fout(e); }
    }));
    li.querySelectorAll('[data-actie]').forEach(knop => knop.addEventListener('click', async () => {
      const i = oef.indexOf(it);
      try {
        if (knop.dataset.actie === 'weg') {
          await bron.wisFaseOefening(it.id);
        } else {
          const j = knop.dataset.actie === 'op' ? i - 1 : i + 1;
          await bron.wijzigFaseOefening(oef[i].id, { volgorde: j });
          await bron.wijzigFaseOefening(oef[j].id, { volgorde: i });
          for (const [k, x] of oef.entries()) if (k !== i && k !== j && x.volgorde !== k) await bron.wijzigFaseOefening(x.id, { volgorde: k });
        }
        opnieuw();
      } catch (e) { fout(e); }
    }));
  });
}

// ===================================================================================
// Opvolging bij een patiënt (stap 2): protocol toewijzen, fase vrijgeven, zichtbaarheid per patiënt
// Wordt getoond op het scherm van een patiënt (patienten.js roept ctx.opvolgingVoor op).
// ===================================================================================

const DAG = 24 * 60 * 60 * 1000;
const datumTekst = d => d ? new Date(d).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const wekenSinds = start => start ? Math.floor((Date.now() - new Date(start + 'T00:00:00').getTime()) / (7 * DAG)) : null;

// Ondergrens (in weken) van een fase, met de verschuiving van de bijkomende ingreep
function ondergrens(prot, fase, ingreep) {
  if (!fase || fase.ondergrens_weken == null) return null;
  const extra = prot.instellingen?.verschuivingen?.[ingreep || 'Geen']?.[fase.nummer - 1] || 0;
  return Number(fase.ondergrens_weken) + extra;
}

async function opvolgingVoor(box, p, herlaad) {
  const { esc } = ctx;
  let trajecten, prots;
  try {
    [trajecten, prots] = await Promise.all([bron.trajectenVan(p.id), bron.protocollen()]);
  } catch (e) {
    box.innerHTML = /does not exist|schema cache|relation/i.test(e.message || '')
      ? '<div class="paneel"><h2>Opvolging</h2><p>De opvolging staat nog niet in Supabase. Voer eerst <code>005_trajecten.sql</code> uit (zie README).</p></div>'
      : `<div class="paneel"><h2>Opvolging</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  const t = trajecten.find(x => x.actief);
  if (!t) {
    box.innerHTML = `
      <div class="paneel">
        <h2>Opvolging</h2>
        <p>Deze patiënt volgt nog geen protocol. Wijs een protocol toe om fase per fase op te volgen.</p>
        <div class="knoppen"><button class="knop knop-hoofd" id="wijs-toe" ${prots.length ? '' : 'disabled'}>Protocol toewijzen</button></div>
        ${prots.length ? '' : '<p class="hulp">Er staan nog geen protocollen in Supabase.</p>'}
      </div>`;
    box.querySelector('#wijs-toe')?.addEventListener('click', () => toewijzen(p, prots, herlaad));
    return;
  }

  const prot = prots.find(x => x.id === t.protocol_id);
  const fasen = [...(prot?.protocol_fasen || [])].sort((a, b) => a.nummer - b.nummer);
  const huidig = fasen.find(f => f.nummer === t.huidige_fase);
  const volgende = fasen.find(f => f.nummer === t.huidige_fase + 1);
  const vorige = fasen.find(f => f.nummer === t.huidige_fase - 1);
  const weken = wekenSinds(t.startdatum);
  const grens = ondergrens(prot, volgende, t.ingreep);
  const grensDatum = grens != null && t.startdatum ? new Date(new Date(t.startdatum + 'T00:00:00').getTime() + grens * 7 * DAG) : null;
  const sinds = (t.traject_fasen || []).filter(v => v.nummer === t.huidige_fase).map(v => v.vrijgegeven).sort().pop();
  const startLabel = prot?.id === 'enkel' ? 'Letsel' : 'Operatie';
  const details = [
    t.startdatum ? `${startLabel} ${datumTekst(t.startdatum)}${weken != null ? ` (week ${weken})` : ''}` : `${startLabel}datum niet ingevuld`,
    t.zijde ? (t.zijde === 'L' ? 'links' : 'rechts') : '', t.graft, t.ingreep && t.ingreep !== 'Geen' ? t.ingreep : '', t.sportprofiel
  ].filter(Boolean);
  const afwijkend = Object.keys(t.zichtbaar || {}).length;

  box.innerHTML = `
    <div class="paneel opvolging">
      <h2>Opvolging: ${esc(prot?.naam || t.protocol_id)}</h2>
      <p class="hulp" style="font-size:.95rem">${esc(details.join(' · '))}</p>
      <ol class="fasebalk" aria-label="Fasen">${fasen.map(f => `
        <li class="${f.nummer < t.huidige_fase ? 'klaar' : f.nummer === t.huidige_fase ? 'huidig' : ''}" title="Fase ${f.nummer}: ${esc(f.titel)}">
          <a href="#/protocollen/${encodeURIComponent(t.protocol_id)}/fase/${f.nummer}">${f.nummer}</a>
        </li>`).join('')}</ol>
      <p class="opvolging-fase"><b>Fase ${t.huidige_fase}: ${esc(huidig?.titel || '')}</b><br>
        <span class="hulp">De patiënt leest: “${esc(huidig?.titel_patient || '')}”${sinds ? ` · vrijgegeven op ${datumTekst(sinds)}` : ''}</span></p>
      ${volgende ? `<p class="opvolging-volgende">Volgende: <b>fase ${volgende.nummer}</b> (${esc(volgende.titel)})${grens != null
        ? ` · ten vroegste vanaf <b>week ${String(grens).replace('.', ',')}</b>${grensDatum ? ` (${datumTekst(grensDatum)})` : ''}${weken != null ? (weken >= grens ? ' · <span class="ok">ondergrens bereikt</span>' : ` · <span class="nog">nog ${Math.ceil(grens - weken)} weken</span>`) : ''}`
        : ''}</p>` : '<p class="opvolging-volgende">Dit is de laatste fase.</p>'}
      <div class="knoppen">
        ${volgende ? `<button class="knop knop-hoofd" id="fase-vrij">Fase ${volgende.nummer} vrijgeven</button>` : ''}
        ${vorige ? `<button class="knop knop-plat" id="fase-terug">Terug naar fase ${vorige.nummer}</button>` : ''}
        <button class="knop knop-plat" id="zichtbaar-patient">Zichtbaar voor deze patiënt${afwijkend ? ` (${afwijkend} aangepast)` : ''}</button>
        <button class="knop knop-plat" id="traject-gegevens">Gegevens</button>
        <button class="knop knop-gevaar" id="traject-stop">Opvolging stoppen</button>
      </div>
    </div>`;

  const fout = e => ctx.melding(e.message || 'Er liep iets mis.');

  box.querySelector('#fase-vrij')?.addEventListener('click', async () => {
    let tekst = `De patiënt ziet daarna fase ${volgende.nummer}: “${volgende.titel_patient || volgende.titel}”, met de standaardoefeningen van die fase.`;
    if (grens != null && weken != null && weken < grens) {
      tekst = `Let op: de biologische ondergrens voor fase ${volgende.nummer} is week ${String(grens).replace('.', ',')}. De patiënt zit nu in week ${weken}. ` + tekst;
    } else if (grens != null && weken == null) {
      tekst = `Er is geen ${startLabel.toLowerCase()}datum ingevuld, dus de ondergrens (week ${String(grens).replace('.', ',')}) kan niet nagekeken worden. ` + tekst;
    }
    if (!await ctx.bevestig(`Fase ${volgende.nummer} vrijgeven?`, tekst, 'Vrijgeven')) return;
    try { await zetFase(t, volgende.nummer); ctx.melding(`Fase ${volgende.nummer} vrijgegeven.`); herlaad(); } catch (e) { fout(e); }
  });

  box.querySelector('#fase-terug')?.addEventListener('click', async () => {
    if (!await ctx.bevestig(`Terug naar fase ${vorige.nummer}?`, `De patiënt ziet weer fase ${vorige.nummer} en het oefenprogramma van die fase. Het programma van fase ${t.huidige_fase} wordt stopgezet (niet gewist).`, 'Terugzetten')) return;
    try { await zetFase(t, vorige.nummer); herlaad(); } catch (e) { fout(e); }
  });

  box.querySelector('#zichtbaar-patient').addEventListener('click', async () => {
    const z = t.zichtbaar || {};
    const std = huidig?.zichtbaar || {};
    const opties = k => [
      { waarde: '', label: `Standaard van de fase (${std[k] ?? (k === 'testresultaten' ? false : true) ? 'aan' : 'uit'})` },
      { waarde: 'aan', label: 'Aan voor deze patiënt' },
      { waarde: 'uit', label: 'Uit voor deze patiënt' }
    ];
    const r = await ctx.dialoog({
      titel: 'Zichtbaar voor deze patiënt', okTekst: 'Bewaren',
      velden: [
        { soort: 'uitleg', tekst: 'Standaard volgt de patiënt de instelling van de fase. Hier kan je dat voor deze patiënt anders zetten.' },
        ...ZICHTBAAR.map(([k, l]) => ({ naam: k, label: l, soort: 'keuze', opties: opties(k), waarde: z[k] === true ? 'aan' : z[k] === false ? 'uit' : '' }))
      ]
    });
    if (!r) return;
    const nieuw = {};
    ZICHTBAAR.forEach(([k]) => { if (r[k] === 'aan') nieuw[k] = true; else if (r[k] === 'uit') nieuw[k] = false; });
    try { await bron.wijzigTraject(t.id, { zichtbaar: nieuw }); ctx.melding('Bewaard.'); herlaad(); } catch (e) { fout(e); }
  });

  box.querySelector('#traject-gegevens').addEventListener('click', async () => {
    const r = await ctx.dialoog({ titel: 'Gegevens van de opvolging', okTekst: 'Bewaren', velden: gegevensVelden(prot, t) });
    if (!r) return;
    try { await bron.wijzigTraject(t.id, gegevensUit(r)); herlaad(); } catch (e) { fout(e); }
  });

  box.querySelector('#traject-stop').addEventListener('click', async () => {
    if (!await ctx.bevestig('Opvolging stoppen?', 'De patiënt ziet zijn fase niet meer. Oefenprogramma\'s blijven bestaan; die kan je apart stopzetten.', 'Stoppen')) return;
    try { await bron.wijzigTraject(t.id, { actief: false }); herlaad(); } catch (e) { fout(e); }
  });
}

// Velden voor de gegevens van een traject (startdatum, zijde, graft, ingreep, sportprofiel)
function gegevensVelden(prot, t = {}) {
  const ins = prot?.instellingen || {};
  const keuze = (lijst, leeg = '—') => [{ waarde: '', label: leeg }, ...lijst.map(x => ({ waarde: x, label: x }))];
  const velden = [
    { naam: 'startdatum', label: prot?.id === 'enkel' ? 'Datum van het letsel' : 'Datum van de operatie', type: 'date', waarde: t.startdatum || '' },
    { naam: 'zijde', label: 'Zijde', soort: 'keuze', waarde: t.zijde || '', opties: [{ waarde: '', label: '—' }, { waarde: 'L', label: 'Links' }, { waarde: 'R', label: 'Rechts' }] }
  ];
  if (ins.grafttypes?.length) velden.push({ naam: 'graft', label: 'Grafttype', soort: 'keuze', waarde: t.graft || '', opties: keuze(ins.grafttypes) });
  if (ins.verschuivingen) velden.push({ naam: 'ingreep', label: 'Bijkomende ingreep (verschuift de ondergrenzen)', soort: 'keuze', waarde: t.ingreep || 'Geen', opties: Object.keys(ins.verschuivingen).map(x => ({ waarde: x, label: x })) });
  if (ins.sportprofielen?.length) velden.push({ naam: 'sportprofiel', label: 'Sportprofiel', soort: 'keuze', waarde: t.sportprofiel || '', opties: keuze(ins.sportprofielen.map(s => s.naam)) });
  return velden;
}
const gegevensUit = r => {
  const uit = { startdatum: r.startdatum || null, zijde: r.zijde || '' };
  ['graft', 'ingreep', 'sportprofiel'].forEach(k => { if (k in r) uit[k] = r[k] || ''; });
  return uit;
};

async function toewijzen(p, prots, herlaad) {
  const r1 = await ctx.dialoog({
    titel: 'Protocol toewijzen', okTekst: 'Verder',
    velden: [{ naam: 'protocol', label: 'Welk protocol volgt deze patiënt?', soort: 'keuze', waarde: prots[0].id, opties: prots.map(x => ({ waarde: x.id, label: x.naam })) }]
  });
  if (!r1) return;
  const prot = prots.find(x => x.id === r1.protocol);
  const fasen = [...(prot.protocol_fasen || [])].sort((a, b) => a.nummer - b.nummer);
  const r2 = await ctx.dialoog({
    titel: `${prot.naam}: gegevens`, okTekst: 'Toewijzen',
    velden: [
      ...gegevensVelden(prot),
      { naam: 'fase', label: 'Start in fase', soort: 'keuze', waarde: '1', opties: fasen.map(f => ({ waarde: String(f.nummer), label: `Fase ${f.nummer}: ${f.titel}` })) },
      { soort: 'uitleg', tekst: 'Enkel wat nodig is voor de opvolging. Geen naam of medische notities.' }
    ]
  });
  if (!r2) return;
  try {
    const t = await bron.maakTraject({ patient_id: p.id, protocol_id: prot.id, ...gegevensUit(r2), huidige_fase: Number(r2.fase), aangemaakt_door: ctx.profielId() });
    await zetFase(t, Number(r2.fase));
    ctx.melding(`${prot.naam} toegewezen. Fase ${r2.fase} is vrijgegeven.`);
    herlaad();
  } catch (e) { ctx.melding(e.message || 'Er liep iets mis.'); }
}

// Een fase vrijgeven (of terugzetten): huidige fase aanpassen, loggen, en het oefenprogramma van die fase klaarzetten.
// Bestaat er al een programma voor die fase, dan wordt dat opnieuw actief; anders komt er een nieuw uit de standaardoefeningen.
async function zetFase(t, nummer) {
  await bron.wijzigTraject(t.id, { huidige_fase: nummer });
  await bron.logFase(t.id, nummer, ctx.profielId());
  await bron.stopFaseProgrammas(t.id, nummer);
  const bestaand = await bron.programmaVoorFase(t.id, nummer);
  if (bestaand) { await bron.wijzigProgramma(bestaand.id, { actief: true }); return; }
  const f = await bron.faseMetOefeningen(t.protocol_id, nummer);
  const g = await bron.maakProgramma({
    patient_id: t.patient_id, titel: `Fase ${nummer}: ${f.titel_patient || f.titel}`, opmerking: '', actief: true,
    aangemaakt_door: ctx.profielId(), traject_id: t.id, fase_nummer: nummer
  });
  const oef = [...(f.fase_oefeningen || [])].sort((a, b) => a.volgorde - b.volgorde);
  if (oef.length) await bron.voegItemsToe(oef.map((o, i) => ({
    programma_id: g.id, fiche_id: o.fiche_id, sets: o.sets, herhalingen: o.herhalingen, frequentie: o.frequentie, notitie: o.notitie, volgorde: i
  })));
}
