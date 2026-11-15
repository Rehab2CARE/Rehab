// Opvolging stap 4: testresultaten, LSI en grafieken.
//
// Therapeut (in Beheer):
//   #/patienten/<id>/testen        overzicht: testmomenten en een grafiek per test
//   #/patienten/<id>/test/<tmId>   één testmoment ingeven (links/rechts, LSI wordt berekend)
// Patiënt: grafieken in "Mijn programma", enkel als "testresultaten" zichtbaar staat.
//
// LSI = aangedane ÷ gezonde zijde × 100. Bij tests waar lager beter is (bv. 6 m timed hop): gezonde ÷ aangedane × 100.
// De absolute waarden staan er altijd naast: een LSI van 100 % kan ook betekenen dat beide zijden zwak zijn.

import * as bron from './bron.js';

let ctx = null;
const $ = sel => document.querySelector(sel);

export function initTesten(hulp) {
  ctx = hulp;
  ctx.testenScherm = (...a) => testenScherm(...a);
  ctx.testmomentScherm = (...a) => testmomentScherm(...a);
  ctx.testenPaneel = (...a) => testenPaneel(...a);
}

// ---------- Berekeningen ----------

const getal = v => (v === null || v === undefined || v === '' ? null : Number(v));
const fmt = (v, dec = 1) => v == null || Number.isNaN(v) ? '—'
  : Number(v).toLocaleString('nl-BE', { maximumFractionDigits: dec });
const datumKort = d => new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
const datumLang = d => new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });

// Aangedane en gezonde waarde volgens de zijde van het traject (L/R)
function zijden(meting, zijde) {
  const l = getal(meting?.links), r = getal(meting?.rechts);
  if (zijde === 'L') return { aangedaan: l, gezond: r };
  if (zijde === 'R') return { aangedaan: r, gezond: l };
  return { aangedaan: null, gezond: null };
}

export function lsi(test, meting, zijde) {
  if (test.soort !== 'lr' || test.doel_lsi == null) return null;
  const { aangedaan, gezond } = zijden(meting, zijde);
  if (aangedaan == null || gezond == null || aangedaan === 0 || gezond === 0) return null;
  return test.lsi_omgekeerd ? gezond / aangedaan * 100 : aangedaan / gezond * 100;
}

// Voor tests zonder LSI (bv. extensie): verschil aangedaan − gezond
export function verschil(test, meting, zijde) {
  const { aangedaan, gezond } = zijden(meting, zijde);
  return aangedaan == null || gezond == null ? null : aangedaan - gezond;
}

const lsiKlasse = (test, w) => w == null ? '' : w >= (test.doel_lsi ?? 90) ? 'lsi-ok' : 'lsi-nog';

// Berekende uitkomst van een meting (LSI, verschil, per kg), zonder de ingevulde waarden
function uitkomst(test, m, zijde, gewicht) {
  if (!m || test.soort !== 'lr') return [];
  const delen = [];
  const w = lsi(test, m, zijde);
  if (w != null) delen.push(`LSI ${fmt(w, 0)} %`);
  else if (test.doel_lsi == null) { const v = verschil(test, m, zijde); if (v != null) delen.push(`verschil ${v > 0 ? '+' : ''}${fmt(v)} ${test.eenheid}`); }
  if (test.per_kg && gewicht) {
    const a = zijden(m, zijde).aangedaan;
    if (a != null) delen.push(`${fmt(a / gewicht, 2)} ${test.eenheid}/kg aangedaan`);
  }
  return delen;
}
const uitkomstTekst = (test, m, zijde, gewicht) => uitkomst(test, m, zijde, gewicht).join(' · ');

// Korte tekst van een meting, voor het team
export function metingTekst(test, m, zijde, gewicht) {
  if (!m) return '';
  if (test.soort === 'keuze') return m.tekst || '—';
  if (test.soort === 'enkel') return `${fmt(getal(m.waarde))} ${test.eenheid}`;
  return [`L ${fmt(getal(m.links))} · R ${fmt(getal(m.rechts))} ${test.eenheid}`, ...uitkomst(test, m, zijde, gewicht)].join(' · ');
}

// Laatste meting van een test over alle testmomenten (voor de criteria)
export function laatsteMeting(testId, momenten) {
  for (const tm of [...momenten].sort((a, b) => String(b.datum).localeCompare(String(a.datum)))) {
    const m = (tm.metingen || []).find(x => x.test_id === testId);
    if (m) return { meting: m, moment: tm };
  }
  return null;
}

// ---------- Grafiek (Chart.js, lokaal in js/vendor) ----------

// Gekleurde doelzone achter de lijn
const doelzone = {
  id: 'doelzone',
  beforeDatasetsDraw(chart, _, opties) {
    if (opties?.van == null && opties?.tot == null) return;
    const { ctx: c, chartArea: a, scales: { y } } = chart;
    const boven = opties.tot != null ? y.getPixelForValue(opties.tot) : a.top;
    const onder = opties.van != null ? y.getPixelForValue(opties.van) : a.bottom;
    c.save();
    c.fillStyle = 'rgba(47, 111, 115, 0.12)';
    c.fillRect(a.left, Math.max(a.top, boven), a.right - a.left, Math.min(a.bottom, onder) - Math.max(a.top, boven));
    c.restore();
  }
};

// punten = [{ datum, meting }]; geeft een uitleg-tekst terug (voor patiënt of therapeut)
export function tekenGrafiek(canvas, test, punten, zijde, { patient = false } = {}) {
  if (!window.Chart) return '';
  const labels = punten.map(p => datumKort(p.datum));
  let datasets, zone = {}, y = {}, uitleg = '';
  const kleur = '#2f6f73', kleur2 = '#a86b00';
  const lijn = (label, data, k) => ({ label, data, borderColor: k, backgroundColor: k, tension: .25, pointRadius: 5, spanGaps: true });

  if (test.soort === 'lr') {
    // Absolute waarden van beide benen: zo zie je vooruitgang, ook als beide benen sterker worden.
    // De LSI staat apart eronder (lsiBalkHtml) en in de tabel.
    const kant = (p, welke) => {
      const z = zijden(p.meting, zijde);
      if (zijde) return welke === 'a' ? z.aangedaan : z.gezond;
      return getal(welke === 'a' ? p.meting?.links : p.meting?.rechts);
    };
    const a = punten.map(p => kant(p, 'a')), g = punten.map(p => kant(p, 'g'));
    const namen = zijde
      ? (patient ? ['Je behandelde been', 'Je andere been'] : [`Aangedaan (${zijde})`, `Gezond (${zijde === 'L' ? 'R' : 'L'})`])
      : ['Links', 'Rechts'];
    datasets = [lijn(namen[0], a, kleur), { ...lijn(namen[1], g, '#8a9a9a'), borderDash: [6, 4], pointRadius: 4 }];
    const eenheid = test.eenheid;
    y = { suggestedMin: 0, ticks: { callback: v => `${fmt(v)} ${eenheid}` } };
    const met = a.filter(v => v != null);
    if (met.length >= 2 && met[met.length - 1] !== met[0]) {
      const [eerst, laatst] = [met[0], met[met.length - 1]];
      const beter = test.lsi_omgekeerd ? laatst < eerst : laatst > eerst;
      const wat = zijde ? (patient ? 'Je behandelde been' : 'Aangedaan') : 'Links';
      uitleg = beter
        ? `${wat}: van ${fmt(eerst)} naar ${fmt(laatst)} ${eenheid}${test.lsi_omgekeerd ? ' (sneller)' : ''}.${patient ? ' Goed bezig!' : ''}`
        : `Laatste meting: ${fmt(laatst)} ${eenheid}.`;
    } else if (met.length === 1) uitleg = `Eerste meting: ${fmt(met[0])} ${eenheid}.`;
  } else if (test.soort === 'keuze') {
    const opties = test.opties || [];
    datasets = [lijn(test.naam, punten.map(p => { const i = opties.indexOf(p.meting?.tekst); return i < 0 ? null : i; }), kleur)];
    y = { min: 0, max: Math.max(1, opties.length - 1), ticks: { stepSize: 1, callback: v => opties[v] ?? '' } };
  } else {
    const w = punten.map(p => getal(p.meting?.waarde));
    datasets = [lijn(test.naam, w, kleur)];
    if (test.doel_waarde != null) zone = test.lager_beter ? { van: null, tot: test.doel_waarde } : { van: test.doel_waarde, tot: null };
    const kort = test.eenheid.startsWith('/') || test.eenheid === '%';
    y = { suggestedMin: 0, suggestedMax: Math.max(test.doel_waarde != null ? test.doel_waarde * 1.1 : 0, ...w.filter(v => v != null)),
      ticks: { callback: v => kort ? v : v + ' ' + test.eenheid } };
    const met = w.filter(v => v != null);
    if (met.length >= 2 && met[met.length - 1] !== met[0]) {
      const beter = test.lager_beter ? met[met.length - 1] < met[0] : met[met.length - 1] > met[0];
      uitleg = beter ? `Van ${fmt(met[0])} naar ${fmt(met[met.length - 1])}${test.eenheid.startsWith('/') ? test.eenheid : ' ' + test.eenheid}.` : '';
    }
  }

  if (canvas._grafiek) canvas._grafiek.destroy();
  canvas._grafiek = new window.Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: datasets.length > 1 }, doelzone: zone, tooltip: { intersect: false, mode: 'index' } },
      scales: { y }
    },
    plugins: [doelzone]
  });
  return uitleg;
}

// LSI onder de grafiek: laatste waarde als balk met het doel (enkel bij tests met LSI)
export function lsiBalkHtml(test, punten, zijde, { patient = false } = {}) {
  if (test.soort !== 'lr' || test.doel_lsi == null) return '';
  const w = punten.map(p => lsi(test, p.meting, zijde)).filter(v => v != null);
  if (!w.length) return zijde || patient ? '' : '<p class="hulp">Vul de zijde in bij de opvolging om de LSI te berekenen.</p>';
  const nu = Math.round(w[w.length - 1]), eerst = Math.round(w[0]);
  const doel = Number(test.doel_lsi);
  const label = patient ? 'Verhouding met je andere been' : 'LSI';
  return `<div class="lsi-balk ${nu >= doel ? 'lsi-ok' : 'lsi-nog'}">
    <div class="lsi-balk-tekst"><span>${label}: <b>${nu} %</b>${w.length > 1 && nu !== eerst ? ` <span class="hulp">(was ${eerst} %)</span>` : ''}</span><span class="hulp">doel ${patient ? '' : '≥ '}${doel} %</span></div>
    <div class="voortgang-balk"><span style="width:${Math.min(100, nu)}%"></span><i style="left:${Math.min(100, doel)}%"></i></div>
  </div>`;
}

// ===================================================================================
// Therapeut
// ===================================================================================

async function laad(pid) {
  const p = (await bron.patienten()).find(x => x.id === pid);
  const t = p ? (await bron.trajectenVan(pid)).find(x => x.actief) : null;
  return { p, t };
}

// Strook "Testresultaten" op het scherm van een patiënt: per test de laatste meting, LSI en verloop
async function testenPaneel(box, p) {
  const { esc } = ctx;
  if (!box) return;
  const kop = (knoppen = '') => `<div class="strook-kop"><h2>Testresultaten</h2>${knoppen}</div>`;
  let t, testlijst, momenten;
  try { t = (await bron.trajectenVan(p.id)).find(x => x.actief); } catch { box.innerHTML = ''; return; }
  if (!t) {
    box.innerHTML = `<div class="paneel strook-testen">${kop()}<p>Wijs eerst een protocol toe bij <b>Opvolging</b> om testresultaten bij te houden.</p></div>`;
    return;
  }
  try { [testlijst, momenten] = await Promise.all([bron.tests(), bron.testmomentenVan(t.id)]); }
  catch (e) {
    box.innerHTML = `<div class="paneel strook-testen">${kop()}<p>${/does not exist|schema cache|relation/i.test(e.message || '')
      ? 'De testresultaten staan nog niet in Supabase (009_testresultaten.sql).' : esc(e.message)}</p></div>`;
    return;
  }
  if (!box.isConnected) return;
  const laatste = momenten[momenten.length - 1];
  const rijen = testlijst.map(x => {
    const reeks = momenten.filter(tm => (tm.metingen || []).some(m => m.test_id === x.id))
      .map(tm => ({ tm, m: tm.metingen.find(m => m.test_id === x.id) }));
    if (!reeks.length) return null;
    const nu = reeks[reeks.length - 1], vorig = reeks[reeks.length - 2];
    const w = lsi(x, nu.m, t.zijde), wv = vorig ? lsi(x, vorig.m, t.zijde) : null;
    let verloop = '';
    if (w != null && wv != null && Math.round(w) !== Math.round(wv)) {
      const d = Math.round(w) - Math.round(wv);
      verloop = `<span class="${d > 0 ? 'beter' : 'minder'}">${d > 0 ? '▲' : '▼'} ${d > 0 ? '+' : ''}${d} % LSI</span>`;
    } else if (vorig && (x.soort === 'enkel' || (x.soort === 'lr' && w == null))) {
      const a = x.soort === 'enkel' ? getal(nu.m.waarde) : zijden(nu.m, t.zijde).aangedaan ?? getal(nu.m.links);
      const b = x.soort === 'enkel' ? getal(vorig.m.waarde) : zijden(vorig.m, t.zijde).aangedaan ?? getal(vorig.m.links);
      if (a != null && b != null && a !== b) {
        const beter = (x.lager_beter || x.lsi_omgekeerd) ? a < b : a > b;
        verloop = `<span class="${beter ? 'beter' : 'minder'}">${a > b ? '▲' : '▼'} ${a > b ? '+' : ''}${fmt(a - b)} ${esc(x.eenheid)}</span>`;
      }
    } else if (vorig && x.soort === 'keuze' && nu.m.tekst !== vorig.m.tekst) {
      verloop = `<span class="hulp">was ${esc(vorig.m.tekst || '—')}</span>`;
    }
    return `<tr>
      <td><b>${esc(x.naam)}</b><br><span class="hulp">${esc(x.groep)}</span></td>
      <td>${esc(datumKort(nu.tm.datum))}</td>
      <td>${esc(metingTekst(x, nu.m, t.zijde, getal(nu.tm.gewicht_kg)).replace(/ · LSI \d+ %/, ''))}</td>
      <td>${w != null ? `<span class="lsi-badge ${lsiKlasse(x, w)}">${Math.round(w)} %</span>` : '—'}</td>
      <td>${verloop || '<span class="hulp">—</span>'}</td>
    </tr>`;
  }).filter(Boolean);

  const pidEnc = encodeURIComponent(p.id);
  box.innerHTML = `
    <div class="paneel strook-testen">
      ${kop(`<span class="knoppen">
        <button class="knop knop-hoofd" id="strook-nieuw-tm">+ Testmoment</button>
        ${momenten.length ? `<a class="knop knop-plat" href="#/patienten/${pidEnc}/testen">Grafieken</a>` : ''}
      </span>`)}
      ${laatste ? `<p class="hulp" style="font-size:.95rem">Laatste testmoment: <a href="#/patienten/${pidEnc}/test/${encodeURIComponent(laatste.id)}">${esc(datumLang(laatste.datum))}</a>
        · ${momenten.length} ${momenten.length === 1 ? 'testmoment' : 'testmomenten'} in totaal${t.zijde ? '' : ' · <b>zijde niet ingevuld: geen LSI</b>'}</p>` : '<p>Nog geen testmoment.</p>'}
      ${rijen.length ? `<div class="tabel-scroll"><table class="meet-tabel strook-tabel">
        <thead><tr><th>Test</th><th>Datum</th><th>Laatste meting</th><th>LSI</th><th>Verloop</th></tr></thead>
        <tbody>${rijen.join('')}</tbody>
      </table></div>` : ''}
    </div>`;
  box.querySelector('#strook-nieuw-tm').addEventListener('click', () => nieuwTestmoment(p.id, t, momenten));
}

// Overzicht: testmomenten + grafiek per gemeten test
async function testenScherm(pid, thuis) {
  const { esc, inhoud } = ctx;
  const { p, t } = await laad(pid);
  if (!p) { location.hash = '#/patienten'; return; }
  if (!t) { location.hash = `#/patienten/${encodeURIComponent(pid)}`; return; }
  const [testlijst, momenten] = await Promise.all([bron.tests(), bron.testmomentenVan(t.id)]);
  const naam = p.naam || p.code;
  const gemeten = testlijst.filter(x => momenten.some(tm => (tm.metingen || []).some(m => m.test_id === x.id)));

  $('#kruimels').innerHTML = `${thuis} <a href="#/patienten">Patiënten</a> <span class="sep">›</span>
    <a href="#/patienten/${encodeURIComponent(pid)}">${esc(naam)}</a> <span class="sep">›</span> <span class="huidig">Testresultaten</span>`;
  inhoud.innerHTML = `
    <h1>Testresultaten</h1>
    <p class="ondertitel">${esc(naam)}${t.zijde ? ` · aangedane zijde ${t.zijde === 'L' ? 'links' : 'rechts'}` : ' · <b>zijde niet ingevuld: LSI kan niet berekend worden</b>'}</p>
    <div class="beheer-balk"><button class="knop knop-hoofd" id="nieuw-testmoment">+ Testmoment</button></div>
    ${momenten.length ? `<ul class="lijst">${[...momenten].reverse().map(tm => `
      <li><a href="#/patienten/${encodeURIComponent(pid)}/test/${encodeURIComponent(tm.id)}">
        <span class="lijst-titel">${esc(datumLang(tm.datum))}</span>
        <span class="lijst-sub">${(tm.metingen || []).length} ${(tm.metingen || []).length === 1 ? 'test' : 'tests'}${tm.gewicht_kg ? ` · ${fmt(tm.gewicht_kg)} kg` : ''}${tm.notitie ? ' · ' + esc(tm.notitie) : ''}</span>
      </a></li>`).join('')}</ul>` : '<div class="leeg">Nog geen testmomenten.</div>'}
    ${gemeten.length ? `<h2 class="rij-titel">Verloop per test</h2><div class="grafieken">${gemeten.map(x => `
      <section class="grafiek-kaart" data-test="${esc(x.id)}">
        <h3>${esc(x.naam)}</h3>
        <div class="grafiek-vlak"><canvas></canvas></div>
        <p class="grafiek-uitleg hulp"></p>
        <div class="grafiek-lsi"></div>
        <table class="meet-tabel"><thead><tr><th>Datum</th><th>Meting</th></tr></thead><tbody>${momenten.filter(tm => (tm.metingen || []).some(m => m.test_id === x.id)).map(tm => {
          const m = tm.metingen.find(y => y.test_id === x.id);
          return `<tr><td>${esc(datumKort(tm.datum))}</td><td>${esc(metingTekst(x, m, t.zijde, getal(tm.gewicht_kg)))}</td></tr>`;
        }).join('')}</tbody></table>
      </section>`).join('')}</div>` : ''}`;

  inhoud.querySelectorAll('.grafiek-kaart').forEach(sec => {
    const x = gemeten.find(y => y.id === sec.dataset.test);
    const punten = momenten.map(tm => ({ datum: tm.datum, meting: (tm.metingen || []).find(m => m.test_id === x.id) })).filter(pt => pt.meting);
    sec.querySelector('.grafiek-uitleg').textContent = tekenGrafiek(sec.querySelector('canvas'), x, punten, t.zijde);
    sec.querySelector('.grafiek-lsi').innerHTML = lsiBalkHtml(x, punten, t.zijde);
  });
  $('#nieuw-testmoment').addEventListener('click', () => nieuwTestmoment(pid, t, momenten));
}

export async function nieuwTestmoment(pid, t, momenten = []) {
  const vorigGewicht = [...momenten].reverse().find(tm => tm.gewicht_kg)?.gewicht_kg ?? '';
  const r = await ctx.dialoog({
    titel: 'Nieuw testmoment', okTekst: 'Verder',
    velden: [
      { naam: 'datum', label: 'Datum', type: 'date', waarde: (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date()), verplicht: true },
      { naam: 'gewicht', label: 'Lichaamsgewicht (kg, optioneel)', type: 'number', inputmode: 'decimal', waarde: vorigGewicht, hulp: 'Nodig voor de waarden per kg.' },
      { naam: 'notitie', label: 'Notitie (optioneel)', placeholder: 'bv. Looppoortbatterij week 12' }
    ]
  });
  if (!r) return;
  try {
    const tm = await bron.maakTestmoment({ traject_id: t.id, datum: r.datum, gewicht_kg: r.gewicht === '' ? null : Number(String(r.gewicht).replace(',', '.')), notitie: r.notitie, door: ctx.profielId() });
    location.hash = `#/patienten/${encodeURIComponent(pid)}/test/${encodeURIComponent(tm.id)}`;
  } catch (e) { ctx.melding(e.message || 'Er liep iets mis.'); }
}

// Eén testmoment ingeven
async function testmomentScherm(pid, tmId, thuis) {
  const { esc, inhoud } = ctx;
  const { p, t } = await laad(pid);
  if (!p || !t) { location.hash = '#/patienten'; return; }
  const [testlijst, momenten] = await Promise.all([bron.tests(), bron.testmomentenVan(t.id)]);
  const tm = momenten.find(x => x.id === tmId);
  if (!tm) { location.hash = `#/patienten/${encodeURIComponent(pid)}/testen`; return; }
  const perTest = new Map((tm.metingen || []).map(m => [m.test_id, m]));
  const gewicht = getal(tm.gewicht_kg);
  const groepen = [...new Set(testlijst.map(x => x.groep))];
  const naam = p.naam || p.code;
  const zijdeTekst = t.zijde === 'L' ? 'links' : t.zijde === 'R' ? 'rechts' : null;

  $('#kruimels').innerHTML = `${thuis} <a href="#/patienten">Patiënten</a> <span class="sep">›</span>
    <a href="#/patienten/${encodeURIComponent(pid)}">${esc(naam)}</a> <span class="sep">›</span>
    <a href="#/patienten/${encodeURIComponent(pid)}/testen">Testresultaten</a> <span class="sep">›</span> <span class="huidig">${esc(datumKort(tm.datum))}</span>`;

  inhoud.innerHTML = `
    <h1>Testmoment ${esc(datumLang(tm.datum))}</h1>
    <p class="ondertitel">${esc(naam)} · ${zijdeTekst ? `aangedane zijde <b>${zijdeTekst}</b>` : '<b>zijde niet ingevuld</b> (LSI wordt niet berekend)'}${gewicht ? ` · ${fmt(gewicht)} kg` : ''}${tm.notitie ? ' · ' + esc(tm.notitie) : ''}</p>
    <div class="beheer-balk">
      <button class="knop knop-plat" id="tm-gegevens">Datum, gewicht, notitie</button>
      <a class="knop knop-plat" href="#/patienten/${encodeURIComponent(pid)}/testen">Grafieken</a>
      <button class="knop knop-gevaar" id="tm-wis">Testmoment wissen</button>
    </div>
    <p class="hulp">Vul enkel in wat je gemeten hebt. Elke waarde wordt meteen bewaard. De LSI berekent de app zelf.</p>
    ${groepen.map(g => {
      const lijst = testlijst.filter(x => x.groep === g);
      const ingevuld = lijst.filter(x => perTest.has(x.id)).length;
      return `<details class="paneel testgroep" ${ingevuld ? 'open' : ''}>
        <summary><b>${esc(g)}</b> <span class="hulp">${ingevuld ? `${ingevuld} ingevuld` : ''}</span></summary>
        ${lijst.map(x => {
          const m = perTest.get(x.id) || {};
          const w = lsi(x, m, t.zijde);
          let velden;
          if (x.soort === 'lr') velden = `
            <label>Links<input name="links" type="number" inputmode="decimal" step="any" value="${m.links ?? ''}"></label>
            <label>Rechts<input name="rechts" type="number" inputmode="decimal" step="any" value="${m.rechts ?? ''}"></label>`;
          else if (x.soort === 'keuze') velden = `
            <label>Waarde<select name="tekst"><option value=""></option>${(x.opties || []).map(o => `<option ${m.tekst === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
          else velden = `<label>Waarde<input name="waarde" type="number" inputmode="decimal" step="any" value="${m.waarde ?? ''}"></label>`;
          return `<div class="testrij" data-test="${esc(x.id)}">
            <div class="testrij-naam"><b>${esc(x.naam)}</b> <span class="hulp">${esc(x.eenheid)}</span></div>
            <div class="testrij-velden">${velden}</div>
            <div class="testrij-uitkomst ${lsiKlasse(x, w)}">${esc(uitkomstTekst(x, perTest.get(x.id), t.zijde, gewicht))}</div>
          </div>`;
        }).join('')}
      </details>`;
    }).join('')}`;

  const fout = e => ctx.melding(e.message || 'Er liep iets mis.');

  inhoud.querySelectorAll('.testrij').forEach(rij => {
    const x = testlijst.find(y => y.id === rij.dataset.test);
    rij.querySelectorAll('input, select').forEach(veld => veld.addEventListener('change', async () => {
      const lees = n => { const v = rij.querySelector(`[name=${n}]`)?.value; return v === undefined || v === '' ? null : Number(String(v).replace(',', '.')); };
      const velden = x.soort === 'lr' ? { links: lees('links'), rechts: lees('rechts') }
        : x.soort === 'keuze' ? { tekst: rij.querySelector('[name=tekst]').value }
        : { waarde: lees('waarde') };
      const leeg = Object.values(velden).every(v => v === null || v === '');
      try {
        if (leeg) { await bron.wisMeting(tm.id, x.id); perTest.delete(x.id); }
        else { await bron.zetMeting(tm.id, x.id, velden); perTest.set(x.id, { ...(perTest.get(x.id) || {}), test_id: x.id, ...velden }); }
        const m = perTest.get(x.id);
        const uit = rij.querySelector('.testrij-uitkomst');
        uit.textContent = m ? uitkomstTekst(x, m, t.zijde, gewicht) : '';
        uit.className = 'testrij-uitkomst ' + lsiKlasse(x, lsi(x, m || {}, t.zijde));
        ctx.melding('Bewaard.');
      } catch (e) { fout(e); }
    }));
  });

  $('#tm-gegevens').addEventListener('click', async () => {
    const r = await ctx.dialoog({
      titel: 'Testmoment', okTekst: 'Bewaren',
      velden: [
        { naam: 'datum', label: 'Datum', type: 'date', waarde: tm.datum, verplicht: true },
        { naam: 'gewicht', label: 'Lichaamsgewicht (kg)', type: 'number', inputmode: 'decimal', waarde: tm.gewicht_kg ?? '' },
        { naam: 'notitie', label: 'Notitie', waarde: tm.notitie }
      ]
    });
    if (!r) return;
    try {
      await bron.wijzigTestmoment(tm.id, { datum: r.datum, gewicht_kg: r.gewicht === '' ? null : Number(String(r.gewicht).replace(',', '.')), notitie: r.notitie });
      testmomentScherm(pid, tmId, thuis);
    } catch (e) { fout(e); }
  });

  $('#tm-wis').addEventListener('click', async () => {
    if (!await ctx.bevestig('Testmoment wissen?', `Alle metingen van ${datumLang(tm.datum)} worden gewist. Dit kan je niet ongedaan maken.`)) return;
    try { await bron.wisTestmoment(tm.id); location.hash = `#/patienten/${encodeURIComponent(pid)}/testen`; } catch (e) { fout(e); }
  });
}

// ===================================================================================
// Patiënt: grafieken in "Mijn programma"
// ===================================================================================

// resultaten = uitvoer van mijn_testresultaten(); tekent in de opgegeven container
export function toonPatientResultaten(box, resultaten) {
  const { esc } = ctx;
  const items = resultaten.flatMap(r => (r.tests || []).map(x => ({ x, zijde: r.zijde })));
  if (!items.length) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <section class="revalidatie testresultaten">
      <h2>Jouw testresultaten</h2>
      <p class="hulp">De volle lijn is je behandelde been, de stippellijn je andere been. De balk eronder toont hoe dicht je behandelde been bij je andere been zit.</p>
      <div class="grafieken">${items.map((it, i) => `
        <div class="grafiek-kaart" data-i="${i}">
          <h3>${esc(it.x.naam)}</h3>
          <div class="grafiek-vlak"><canvas></canvas></div>
          <p class="grafiek-uitleg"></p>
          <div class="grafiek-lsi"></div>
        </div>`).join('')}</div>
    </section>`;
  box.querySelectorAll('.grafiek-kaart').forEach(kaart => {
    const it = items[Number(kaart.dataset.i)];
    const punten = (it.x.metingen || []).map(m => ({ datum: m.datum, meting: m }));
    kaart.querySelector('.grafiek-uitleg').textContent = tekenGrafiek(kaart.querySelector('canvas'), it.x, punten, it.zijde, { patient: true });
    kaart.querySelector('.grafiek-lsi').innerHTML = lsiBalkHtml(it.x, punten, it.zijde, { patient: true });
  });
}
