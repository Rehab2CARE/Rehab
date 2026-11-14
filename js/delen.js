// Fiches aanduiden en samen doorsturen naar een patiënt.
// - Elke fiche heeft een rond knopje (+ / ✓) om ze aan de selectie toe te voegen.
// - Rechtsonder verschijnt de mini-knop "Verzenden" met het aantal gekozen fiches.
// - Verzenden opent het deelvenster van de iPad (Mail, WhatsApp, AirDrop, ...).
// - Een tekstfiche wordt eerst omgezet naar een PDF.
// Er gaat niets naar een server: de bestanden gaan rechtstreeks van de iPad naar de gekozen app.

import { db } from './db.js';

const $ = sel => document.querySelector(sel);
let selectie = [];          // [{ id, titel, soort }]
let melding = () => {};
let klaargezet = null;      // Promise<File[]> die klaarstaat zodra het venster opent

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bewaarSelectie() {
  try { sessionStorage.setItem('selectie', JSON.stringify(selectie)); } catch { /* privémodus */ }
  werkMandBij();
}

export const isGekozen = id => selectie.some(x => x.id === id);

// HTML voor het ronde knopje op een fichetegel of bij een geopende fiche
export function kiesKnop(f, metTekst = false) {
  const aan = isGekozen(f.id);
  const label = aan ? 'Gekozen om te verzenden' : 'Kiezen om te verzenden';
  return `<button type="button" class="kies${metTekst ? ' kies-tekst' : ''}" data-kies="${esc(f.id)}"
    data-titel="${esc(f.titel)}" data-soort="${esc(f.soort)}" aria-pressed="${aan}" aria-label="${label}">
    <span class="kies-teken" aria-hidden="true">${aan ? '✓' : '+'}</span>${metTekst ? `<span>${aan ? 'Gekozen' : 'Kiezen om te verzenden'}</span>` : ''}
  </button>`;
}

export function koppelKiesKnoppen(root) {
  root.querySelectorAll('[data-kies]').forEach(knop => {
    knop.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const id = knop.dataset.kies;
      if (isGekozen(id)) selectie = selectie.filter(x => x.id !== id);
      else selectie.push({ id, titel: knop.dataset.titel, soort: knop.dataset.soort });
      bewaarSelectie();
      vernieuwKnoppen();
    });
  });
}

function werkMandBij() {
  const mand = $('#mand');
  const n = selectie.length;
  mand.hidden = n === 0;
  mand.querySelector('.mand-aantal').textContent = n;
  mand.setAttribute('aria-label', `${n} ${n === 1 ? 'fiche' : 'fiches'} verzenden`);
}

// ---------- Venster met de gekozen fiches ----------

function toonMandVenster() {
  const dlg = $('#mand-dialoog');
  const lijst = selectie.map(x => `
    <li>
      <span class="mand-titel">${esc(x.titel)}</span>
      <button type="button" class="knop knop-plat mand-weg" data-weg="${esc(x.id)}" aria-label="${esc(x.titel)} weghalen">✕</button>
    </li>`).join('');
  dlg.innerHTML = `
    <div class="mand-inhoud">
      <h2>Fiches verzenden</h2>
      <p class="hulp" style="font-size:1rem">Kies daarna Mail, WhatsApp, Berichten of AirDrop. Tekstfiches worden als PDF verstuurd.</p>
      <ul class="mand-lijst">${lijst}</ul>
      <div class="dialoog-knoppen">
        <button type="button" class="knop knop-plat" id="mand-leeg">Alles weghalen</button>
        <span style="flex:1"></span>
        <button type="button" class="knop knop-plat" id="mand-sluit">Sluiten</button>
        <button type="button" class="knop knop-hoofd" id="mand-verzend" disabled>Even geduld…</button>
      </div>
    </div>`;

  dlg.querySelectorAll('[data-weg]').forEach(k => k.addEventListener('click', () => {
    selectie = selectie.filter(x => x.id !== k.dataset.weg);
    bewaarSelectie();
    vernieuwKnoppen();
    if (!selectie.length) dlg.close(); else toonMandVenster();
  }));
  $('#mand-leeg').addEventListener('click', () => {
    selectie = [];
    bewaarSelectie();
    vernieuwKnoppen();
    dlg.close();
  });
  $('#mand-sluit').addEventListener('click', () => dlg.close());
  $('#mand-verzend').addEventListener('click', verzend);

  if (!dlg.open) dlg.showModal();

  // Bestanden nu al klaarzetten: de iPad laat het deelvenster enkel open gaan
  // als het meteen na de tik gebeurt, zonder te wachten.
  klaargezet = maakBestanden();
  klaargezet.then(bestanden => {
    const knop = $('#mand-verzend');
    if (!knop) return;
    knop.disabled = !bestanden.length;
    const n = bestanden.length;
    knop.textContent = `Verzenden (${n})`;
    knop._bestanden = bestanden;
  }).catch(() => {
    melding('De fiches konden niet klaargezet worden.');
  });
}

function vernieuwKnoppen() {
  document.querySelectorAll('[data-kies]').forEach(knop => {
    const aan = isGekozen(knop.dataset.kies);
    knop.setAttribute('aria-pressed', String(aan));
    knop.setAttribute('aria-label', aan ? 'Gekozen om te verzenden' : 'Kiezen om te verzenden');
    knop.querySelector('.kies-teken').textContent = aan ? '✓' : '+';
    const t = knop.querySelector('span:not(.kies-teken)');
    if (t) t.textContent = aan ? 'Gekozen' : 'Kiezen om te verzenden';
  });
}

async function verzend() {
  const knop = $('#mand-verzend');
  const bestanden = knop._bestanden || [];
  if (!bestanden.length) return;

  if (navigator.canShare && navigator.canShare({ files: bestanden })) {
    try {
      await navigator.share({ files: bestanden });
      klaar(bestanden.length);
    } catch (e) {
      if (e.name !== 'AbortError') melding('Verzenden lukte niet. Probeer opnieuw.');
    }
    return;
  }
  // Toestel zonder deelvenster (bv. sommige computers): gewoon downloaden.
  bestanden.forEach((b, i) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = b.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, i * 400));
  klaar(bestanden.length, true);
}

function klaar(n, gedownload = false) {
  selectie = [];
  bewaarSelectie();
  vernieuwKnoppen();
  $('#mand-dialoog').close();
  melding(gedownload
    ? `${n} ${n === 1 ? 'fiche' : 'fiches'} gedownload.`
    : `${n} ${n === 1 ? 'fiche' : 'fiches'} verstuurd.`);
}

// ---------- Bestanden maken ----------

const EXTENSIE = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

function veiligeNaam(titel) {
  return String(titel || 'fiche').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'fiche';
}

async function maakBestanden() {
  const uit = [];
  const namen = new Set();
  const uniek = (basis, ext) => {
    let naam = `${basis}.${ext}`;
    for (let i = 2; namen.has(naam.toLowerCase()); i++) naam = `${basis} (${i}).${ext}`;
    namen.add(naam.toLowerCase());
    return naam;
  };
  for (const x of selectie) {
    const inh = await db.getFiche(x.id);
    if (!inh) continue; // intussen gewist
    const basis = veiligeNaam(x.titel);
    if (inh.data) {
      const ext = EXTENSIE[inh.mime] || (inh.bestandsnaam || '').split('.').pop() || 'bin';
      uit.push(new File([inh.data], uniek(basis, ext), { type: inh.mime }));
    } else {
      uit.push(new File([tekstNaarPdf(x.titel, inh.tekst || '')], uniek(basis, 'pdf'), { type: 'application/pdf' }));
    }
  }
  return uit;
}

// ---------- Eenvoudige PDF voor tekstfiches ----------
// Zelfde opmaak als in de app: "# " = tussentitel, "- " = opsomming, lege regel = nieuwe alinea.

const BREEDTE = [ // Helvetica, tekens 32 t.e.m. 126 (per 1000 eenheden)
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
const WINANSI = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };

function tekenBreedte(c, vet) {
  const basis = c.normalize('NFD')[0];
  const code = basis.charCodeAt(0);
  const w = code >= 32 && code <= 126 ? BREEDTE[code - 32] : (c === '•' ? 350 : 600);
  return vet ? w * 1.08 : w;
}

const tekstBreedte = (s, grootte, vet) => [...s].reduce((t, c) => t + tekenBreedte(c, vet), 0) * grootte / 1000;

function pdfTekst(s) {
  let uit = '';
  for (const c of s) {
    let code = WINANSI[c] ?? c.charCodeAt(0);
    if (code > 255) code = 63; // '?'
    if (c === '(' || c === ')' || c === '\\') uit += '\\' + c;
    else if (code < 32 || code > 126) uit += '\\' + code.toString(8).padStart(3, '0');
    else uit += c;
  }
  return uit;
}

function breek(tekst, maxBreedte, grootte, vet) {
  const regels = [];
  let huidig = '';
  for (const woord of tekst.split(/\s+/).filter(Boolean)) {
    const poging = huidig ? huidig + ' ' + woord : woord;
    if (tekstBreedte(poging, grootte, vet) <= maxBreedte) { huidig = poging; continue; }
    if (huidig) regels.push(huidig);
    huidig = woord;
    while (tekstBreedte(huidig, grootte, vet) > maxBreedte) { // heel lang woord: hard afbreken
      let i = huidig.length - 1;
      while (i > 1 && tekstBreedte(huidig.slice(0, i), grootte, vet) > maxBreedte) i--;
      regels.push(huidig.slice(0, i));
      huidig = huidig.slice(i);
    }
  }
  if (huidig) regels.push(huidig);
  return regels;
}

export function tekstNaarPdf(titel, tekst) {
  const B = 595, H = 842, MARGE = 60, BREED = B - 2 * MARGE;
  const paginas = [];
  let ops = [];
  let y = H - MARGE;

  const nieuwePagina = () => { paginas.push(ops); ops = []; y = H - MARGE; };
  const regel = (s, { grootte = 12, vet = false, x = MARGE, grijs = false, voor = 0 } = {}) => {
    const hoogte = grootte * 1.35;
    if (y - voor - hoogte < MARGE) nieuwePagina(); else y -= voor;
    y -= hoogte;
    ops.push(`BT ${grijs ? '0.4 g ' : '0 g '}/${vet ? 'F2' : 'F1'} ${grootte} Tf ${x.toFixed(1)} ${(y + grootte * 0.3).toFixed(1)} Td (${pdfTekst(s)}) Tj ET`);
  };

  breek(titel, BREED, 20, true).forEach(r => regel(r, { grootte: 20, vet: true }));
  y -= 10;

  const blokken = String(tekst).replace(/\r/g, '').split(/\n\s*\n/);
  for (const blok of blokken) {
    let regels = blok.split('\n').filter(r => r.trim());
    if (!regels.length) continue;
    if (/^#\s+/.test(regels[0])) {
      if (y - 10 - 15 * 1.35 - 2 * 12 * 1.35 < MARGE) nieuwePagina(); // titel nooit alleen onderaan
      breek(regels[0].replace(/^#\s+/, ''), BREED, 15, true).forEach((r, i) => regel(r, { grootte: 15, vet: true, voor: i ? 0 : 10 }));
      regels = regels.slice(1);
    }
    let eerste = true;
    for (const r of regels) {
      const opsom = /^\s*[-•]\s+/.test(r);
      const inhoud = r.replace(/^\s*[-•]\s+/, '');
      const inspring = opsom ? 18 : 0;
      breek(inhoud, BREED - inspring, 12, false).forEach((stuk, i) => {
        if (opsom && i === 0) {
          regel('•', { voor: eerste ? 6 : 0 });
          y += 12 * 1.35; // zelfde regel als het opsommingsteken
        }
        regel(stuk, { x: MARGE + inspring, voor: eerste && !(opsom && i === 0) ? 6 : 0 });
        eerste = false;
      });
    }
  }
  paginas.push(ops);

  // PDF opbouwen (alles ASCII, dus lengte = aantal bytes)
  const objecten = [];
  const voegToe = s => { objecten.push(s); return objecten.length; };
  const catalogus = voegToe(null);
  const pagesId = voegToe(null);
  const f1 = voegToe('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = voegToe('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kinderen = paginas.map(p => {
    const stroom = p.join('\n');
    const inhoudId = voegToe(`<< /Length ${stroom.length} >>\nstream\n${stroom}\nendstream`);
    return voegToe(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${B} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${inhoudId} 0 R >>`);
  });
  objecten[catalogus - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objecten[pagesId - 1] = `<< /Type /Pages /Kids [${kinderen.map(k => `${k} 0 R`).join(' ')}] /Count ${kinderen.length} >>`;

  let pdf = '%PDF-1.4\n';
  const posities = objecten.map((o, i) => {
    const pos = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return pos;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objecten.length + 1}\n0000000000 65535 f \n`;
  pdf += posities.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objecten.length + 1} /Root ${catalogus} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

// ---------- Opstarten ----------

export function startDelen(meldingFn) {
  melding = meldingFn;
  try { selectie = JSON.parse(sessionStorage.getItem('selectie') || '[]'); } catch { selectie = []; }
  $('#mand').addEventListener('click', toonMandVenster);
  $('#mand-dialoog').addEventListener('click', e => { if (e.target.id === 'mand-dialoog') e.target.close(); });
  werkMandBij();
}
