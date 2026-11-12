import { db } from './db.js';

// ---------------------------------------------------------------------------
// Structuur (boom):
//   structuur.secties[]            = onderdelen (Oefenfiches, Informatiefiches, ...)
//     .kinderen[]                  = regio's (Nek, Knie, ...)
//       .kinderen[]                = categorieën (Algemeen, ...)
//         .fiches[]                = { id, titel, omschrijving, soort }
// De inhoud van een fiche (PDF, afbeelding of tekst) staat apart in db.fiches.
// Navigatie via de URL: #/<onderdeel>/<regio>/<categorie>/<fiche>
// ---------------------------------------------------------------------------

const $ = sel => document.querySelector(sel);
const inhoud = $('#inhoud');
let structuur = null;
let beheer = false;
let actieveUrl = null; // blob-URL van de geopende fiche (vrijgeven bij wisselen)

const SOORT_LABEL = { pdf: 'PDF', afbeelding: 'Afbeelding', tekst: 'Tekst' };

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

// Alle fiche-id's onder een knoop (om mee te wissen)
function ficheIdsOnder(knoop) {
  const ids = (knoop.fiches || []).map(f => f.id);
  (knoop.kinderen || []).forEach(k => ids.push(...ficheIdsOnder(k)));
  return ids;
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
    const el = document.createElement(v.soort === 'tekstvak' ? 'textarea' : 'input');
    el.name = v.naam;
    if (v.soort !== 'tekstvak') el.type = 'text';
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
    const eerste = box.querySelector('input, textarea');
    if (eerste) setTimeout(() => eerste.focus(), 50);
  });
}

const vraagNaam = (titel, waarde = '') =>
  dialoog({ titel, velden: [{ naam: 'naam', label: 'Naam', waarde, verplicht: true }] }).then(r => r && r.naam);

const bevestig = (titel, tekst, okTekst = 'Verwijderen') =>
  dialoog({ titel, velden: [{ soort: 'uitleg', tekst }], okTekst, gevaar: true }).then(r => r !== null);

// ---------- Opstarten ----------

async function standaardStructuur() {
  const res = await fetch('data/structuur.json', { cache: 'no-cache' });
  const cfg = await res.json();
  const maakCat = titel => ({ id: nieuwId(), titel, fiches: [] });
  const maakRegio = titel => ({ id: nieuwId(), titel, kinderen: (cfg.standaardCategorieen || []).map(maakCat) });
  return {
    versie: cfg.versie || 1,
    appTitel: cfg.appTitel || 'Praktijkfiches',
    niveauNamen: cfg.niveauNamen,
    secties: cfg.secties.map(s => ({
      id: nieuwId(),
      titel: s.titel,
      omschrijving: s.omschrijving || '',
      kinderen: (s.regios || cfg.standaardRegios || []).map(maakRegio)
    }))
  };
}

async function start() {
  structuur = await db.getStructuur();
  if (!structuur) {
    structuur = await standaardStructuur();
    await bewaar();
  }
  try { beheer = sessionStorage.getItem('beheer') === '1'; } catch { /* privémodus */ }
  $('#dialoog-annuleer').addEventListener('click', () => $('#dialoog').close('annuleer'));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  $('#beheer').addEventListener('click', () => {
    beheer = !beheer;
    try { sessionStorage.setItem('beheer', beheer ? '1' : '0'); } catch { /* */ }
    if (!beheer && location.hash === '#/instellingen') location.hash = '#/';
    else toon();
  });
  $('#instellingen').addEventListener('click', () => { location.hash = '#/instellingen'; });
  $('#terug').addEventListener('click', () => {
    const delen = pad();
    if (delen[0] === 'instellingen') location.hash = '#/';
    else location.hash = '#/' + delen.slice(0, -1).join('/');
  });
  window.addEventListener('hashchange', toon);
  toon();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
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

async function toon() {
  if (actieveUrl) { URL.revokeObjectURL(actieveUrl); actieveUrl = null; }
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

  const keten = zoek(delen);
  if (!keten) { location.hash = '#/'; return; }
  $('#terug').hidden = delen.length === 0;
  toonKruimels(keten, delen);

  if (delen.length === 4) return toonFiche(keten, delen);
  if (delen.length === 3) return toonFicheLijst(keten, delen);
  return toonTegels(keten, delen);
}

// ---------- Tegels: onderdelen, regio's, categorieën ----------

function toonTegels(keten, ids) {
  const diepte = ids.length;          // 0 = onderdelen, 1 = regio's, 2 = categorieën
  const ouder = keten[diepte - 1];
  const lijst = diepte === 0 ? structuur.secties : ouder.kinderen;
  const naam = niveauNaam(diepte);

  const titel = diepte === 0 ? structuur.appTitel : ouder.titel;
  const sub = diepte === 0 ? 'Kies een onderdeel.' : (diepte === 1 ? 'Kies een regio.' : 'Kies een categorie.');

  const tegels = lijst.map((k, i) => {
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
  }).join('');

  inhoud.innerHTML = `
    <h1>${esc(titel)}</h1>
    <p class="ondertitel">${sub}</p>
    ${!lijst.length && !beheer ? `<div class="leeg">Hier staat nog niets. Zet <b>Beheer</b> aan om iets toe te voegen.</div>` : ''}
    <div class="tegels ${diepte === 0 ? 'groot' : ''}">
      ${tegels}
      ${beheer ? `<button class="tegel-nieuw" data-actie="nieuw">+ ${esc(naam)} toevoegen</button>` : ''}
    </div>`;

  koppelBeheer(lijst, naam, diepte);
}

function beheerKnoppen(i, n) {
  return `
    <div class="tegel-acties">
      <button data-actie="op" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Naar voren">◀</button>
      <button data-actie="neer" data-i="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Naar achteren">▶</button>
      <button data-actie="hernoem" data-i="${i}">Wijzig</button>
      <button data-actie="weg" data-i="${i}" class="weg">Wis</button>
    </div>`;
}

function koppelBeheer(lijst, naam, diepte) {
  inhoud.querySelectorAll('[data-actie]').forEach(knop => {
    knop.addEventListener('click', async () => {
      const i = Number(knop.dataset.i);
      const actie = knop.dataset.actie;
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

// ---------- Fiches in een categorie ----------

function toonFicheLijst(keten, ids) {
  const cat = keten[2];
  const fiches = cat.fiches;

  const tegels = fiches.map((f, i) => `
    <div class="tegel">
      <a class="tegel-link" href="${link([...ids, f.id])}">
        <span class="tegel-soort">${SOORT_LABEL[f.soort] || ''}</span>
        <span class="tegel-titel">${esc(f.titel)}</span>
        ${f.omschrijving ? `<span class="tegel-sub">${esc(f.omschrijving)}</span>` : ''}
      </a>
      ${beheer ? beheerKnoppen(i, fiches.length) : ''}
    </div>`).join('');

  inhoud.innerHTML = `
    <h1>${esc(cat.titel)}</h1>
    <p class="ondertitel">${esc(keten[0].titel)} · ${esc(keten[1].titel)}</p>
    ${beheer ? `
      <div class="beheer-balk">
        <label class="knop knop-hoofd">
          Bestanden toevoegen (PDF of foto)
          <input type="file" id="upload" accept="application/pdf,image/*" multiple hidden>
        </label>
        <button class="knop knop-plat" id="nieuwe-tekst">Tekstfiche schrijven</button>
      </div>` : ''}
    ${!fiches.length ? `<div class="leeg">Nog geen fiches in deze categorie.${beheer ? '' : ' Zet <b>Beheer</b> aan om fiches toe te voegen.'}</div>` : ''}
    <div class="tegels">${tegels}</div>`;

  if (!beheer) return;

  $('#upload').addEventListener('change', async e => {
    const bestanden = [...e.target.files];
    let ok = 0;
    for (const b of bestanden) {
      const soort = b.type === 'application/pdf' ? 'pdf' : b.type.startsWith('image/') ? 'afbeelding' : null;
      if (!soort) { melding(`${b.name}: enkel PDF of afbeeldingen.`); continue; }
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

const HULP_TEKST = 'Lege regel = nieuwe alinea. "# " vooraan = tussentitel. "- " vooraan = opsomming.';

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
  let vlak = '<div class="leeg">Deze fiche is niet gevonden.</div>';
  let volledig = '';
  if (inh && f.soort === 'tekst') {
    vlak = `<div class="viewer-vlak viewer-tekst">${tekstNaarHtml(inh.tekst)}</div>`;
  } else if (inh && inh.data) {
    actieveUrl = URL.createObjectURL(new Blob([inh.data], { type: inh.mime }));
    if (f.soort === 'afbeelding') {
      vlak = `<div class="viewer-vlak"><img src="${actieveUrl}" alt="${esc(f.titel)}"></div>`;
    } else {
      vlak = `<div class="viewer-vlak"><iframe src="${actieveUrl}" title="${esc(f.titel)}"></iframe></div>`;
    }
    volledig = `<a class="knop knop-plat" href="${actieveUrl}" target="_blank" rel="noopener">Volledig scherm</a>`;
  }

  inhoud.innerHTML = `
    <div class="viewer">
      <div class="viewer-kop">
        <h1>${esc(f.titel)}</h1>
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

  inhoud.innerHTML = `
    <h1>Instellingen</h1>
    <p class="ondertitel">${fiches.length} fiches, samen ongeveer ${mb} MB. Blijvende opslag: ${blijvend}.</p>

    <div class="paneel">
      <h2>App-naam</h2>
      <p>De titel bovenaan de app.</p>
      <div class="knoppen"><button class="knop knop-plat" id="app-naam">Wijzig naam (nu: ${esc(structuur.appTitel)})</button></div>
    </div>

    <div class="paneel">
      <h2>Back-up maken</h2>
      <p>Bewaart alle onderdelen, categorieën en fiches in één bestand. Doe dit regelmatig en bewaar het bestand op een veilige plek.</p>
      <div class="knoppen"><button class="knop knop-hoofd" id="exporteer">Back-up downloaden</button></div>
    </div>

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
    </div>`;

  $('#app-naam').addEventListener('click', async () => {
    const n = await vraagNaam('App-naam wijzigen', structuur.appTitel);
    if (!n) return;
    structuur.appTitel = n;
    await bewaar();
    toon();
  });

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

start();
