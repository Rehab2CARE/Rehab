// Oefenkalender met feedback van de patiënt.
//
// Patiënt: in een kalender tikt hij op een dag (vandaag of eerder) en duidt aan of hij geoefend heeft
//          (alles, een deel, niet), met kort feedback: pijn, zwelling, wat ging goed, wat was moeilijk.
//          Eén ingave per dag; een dag kan hij nog aanpassen. Geen reeks of druk om elke dag te oefenen.
// Therapeut: strook "Oefensessies" bij de patiënt: dezelfde kalender met verkeerslicht (zie verkeerslicht.js),
//            een pijngrafiek en de feedback. De app geeft geen advies: de kinesitherapeut beslist.

import * as bron from './bron.js';
import { kleuren, LICHT, GRENZEN } from './verkeerslicht.js';

let ctx = null;

export function initSessies(hulp) {
  ctx = hulp;
  ctx.sessiesPaneel = (...a) => sessiesPaneel(...a);
}

export const GEDAAN = { alles: 'Alles gedaan', deel: 'Een deel gedaan', niet: 'Niet geoefend' };
export const STIJFHEID = { beter: 'Soepeler dan de vorige keer', zelfde: 'Zoals de vorige keer', stijver: 'Stijver: minder goed strekken of plooien' };
export const ZWELLING = { geen: 'Geen zwelling', minder: 'Minder dan de vorige keer', zelfde: 'Zoals de vorige keer', meer: 'Meer dan de vorige keer' };
const TEKEN = { alles: '✓', deel: '◐', niet: '✕' };
const WEKEN = 5;
const KLEURCODE = { groen: '#2e8b57', oranje: '#e0a100', rood: '#c8372d' };

// Lokale datum (niet UTC: middernacht in België is in UTC nog de vorige dag)
const isoDag = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const vandaag = () => isoDag(new Date());
const datumKort = d => new Date(d + 'T00:00:00').toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
const datumLang = d => new Date(d + 'T00:00:00').toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });

// Kalender van WEKEN weken (maandag tot zondag), de huidige week onderaan. verschuiving = aantal blokken terug.
export function kalenderHtml(sessies, { verschuiving = 0, klikbaar = false } = {}) {
  const perDag = new Map(sessies.map(s => [s.datum, s]));
  const licht = kleuren(sessies);
  const nu = new Date(vandaag() + 'T00:00:00');
  const maandag = new Date(nu); maandag.setDate(nu.getDate() - ((nu.getDay() + 6) % 7));
  const start = new Date(maandag); start.setDate(maandag.getDate() - 7 * (WEKEN - 1 + verschuiving * WEKEN));
  const cellen = [];
  for (let i = 0; i < WEKEN * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const sleutel = isoDag(d);
    const s = perDag.get(sleutel);
    const toekomst = d > nu;
    const l = licht.get(sleutel);
    const klassen = ['kal-dag', s ? `kal-${s.gedaan}` : '', l ? `kal-${l.kleur}` : '', sleutel === vandaag() ? 'kal-vandaag' : '', toekomst ? 'kal-toekomst' : ''].filter(Boolean).join(' ');
    const label = `${datumLang(sleutel)}${s ? ': ' + GEDAAN[s.gedaan] : toekomst ? '' : ': nog niet ingevuld'}${l ? `, ${LICHT[l.kleur].naam.toLowerCase()} (${l.redenen.join(', ') || LICHT[l.kleur].kort})` : ''}`;
    const inhoud = `<span class="kal-nr">${d.getDate()}</span><span class="kal-teken">${s ? TEKEN[s.gedaan] : ''}</span>${l ? '<span class="kal-licht" aria-hidden="true"></span>' : ''}`;
    cellen.push(klikbaar && !toekomst
      ? `<button type="button" class="${klassen}" data-dag="${sleutel}" aria-label="${label}">${inhoud}</button>`
      : `<div class="${klassen}" title="${label}">${inhoud}</div>`);
  }
  const eind = new Date(start); eind.setDate(start.getDate() + WEKEN * 7 - 1);
  const periode = `${start.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} – ${eind.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}`;
  return `<div class="kalender">
    <div class="kal-balk">
      <button type="button" class="knop knop-plat klein" data-kal="terug" aria-label="Vorige weken">‹</button>
      <span class="kal-periode">${periode}</span>
      <button type="button" class="knop knop-plat klein" data-kal="verder" aria-label="Volgende weken" ${verschuiving === 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="kal-raster">${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map(d => `<div class="kal-kop">${d}</div>`).join('')}${cellen.join('')}</div>
    <p class="kal-legende hulp"><span>✓ alles gedaan</span><span>◐ een deel</span><span>✕ niet geoefend</span></p>
    <p class="kal-legende hulp"><span><i class="licht-bol licht-groen"></i> goed verdragen</span><span><i class="licht-bol licht-oranje"></i> licht signaal</span><span><i class="licht-bol licht-rood"></i> te veel belasting</span></p>
  </div>`;
}

// Koppelt de pijltjes (en voor de patiënt het tikken op een dag). opDag(datum) wordt opgeroepen bij een tik.
export function koppelKalender(box, sessies, opties, opDag) {
  const teken = () => {
    box.innerHTML = kalenderHtml(sessies(), opties);
    box.querySelector('[data-kal="terug"]').addEventListener('click', () => { opties.verschuiving++; teken(); });
    box.querySelector('[data-kal="verder"]').addEventListener('click', () => { opties.verschuiving = Math.max(0, opties.verschuiving - 1); teken(); });
    box.querySelectorAll('[data-dag]').forEach(k => k.addEventListener('click', () => opDag(k.dataset.dag)));
  };
  teken();
}

// ===================================================================================
// Patiënt: een dag aanduiden
// ===================================================================================

// Geeft true terug als bewaard. programmas = actieve programma's van de patiënt.
export async function dagAanduiden(patientId, datum, bestaand, programmas, deel = 'knie') {
  if (!navigator.onLine) { ctx.melding('Geen internet: probeer het straks opnieuw.'); return false; }
  const velden = [
    { naam: 'gedaan', label: 'Heb je geoefend?', soort: 'keuze', waarde: bestaand?.gedaan || 'alles',
      opties: [{ waarde: 'alles', label: 'Ja, alles gedaan' }, { waarde: 'deel', label: 'Ja, een deel' }, { waarde: 'niet', label: 'Nee, niet geoefend' }] }
  ];
  if (programmas.length > 1) velden.push({ naam: 'programma', label: 'Welk programma?', soort: 'keuze',
    waarde: bestaand?.programma_id || programmas[0].id, opties: programmas.map(g => ({ waarde: g.id, label: g.titel })) });
  velden.push(
    { naam: 'pijn', label: 'Pijn tijdens de oefeningen (0 = geen, 10 = ergst denkbaar)', soort: 'keuze', waarde: bestaand?.pijn != null ? String(bestaand.pijn) : '',
      opties: [{ waarde: '', label: '—' }, ...Array.from({ length: 11 }, (_, i) => ({ waarde: String(i), label: `${i}` }))] },
    { naam: 'zwelling', label: 'Zwelling na het oefenen', soort: 'keuze', waarde: bestaand?.zwelling || '',
      opties: [{ waarde: '', label: '—' }, ...Object.entries(ZWELLING).map(([w, l]) => ({ waarde: w, label: l }))] },
    { naam: 'stijfheid', label: `Hoe soepel is je ${deel}? (strekken en plooien)`, soort: 'keuze', waarde: bestaand?.stijfheid || '',
      opties: [{ waarde: '', label: '—' }, ...Object.entries(STIJFHEID).map(([w, l]) => ({ waarde: w, label: l }))] },
    { naam: 'goed', label: 'Wat ging goed? (optioneel)', soort: 'tekstvak', rijen: 2, waarde: bestaand?.goed || '' },
    { naam: 'moeilijk', label: 'Wat was moeilijk of kan beter? (optioneel)', soort: 'tekstvak', rijen: 2, waarde: bestaand?.moeilijk || '' }
  );
  const r = await ctx.dialoog({ titel: datumLang(datum).replace(/^./, c => c.toUpperCase()), okTekst: 'Bewaren', velden });
  if (!r) return false;
  try {
    await bron.bewaarSessie({
      patient_id: patientId, datum, gedaan: r.gedaan,
      programma_id: r.programma || programmas[0]?.id || null,
      pijn: r.pijn === '' ? null : Number(r.pijn), zwelling: r.zwelling, stijfheid: r.stijfheid, goed: r.goed.slice(0, 500), moeilijk: r.moeilijk.slice(0, 500)
    });
    const pijn = r.pijn === '' ? null : Number(r.pijn);
    const zorg = (pijn != null && pijn > GRENZEN.pijnGroenMax) || r.zwelling === 'meer' || r.stijfheid === 'stijver';
    ctx.melding(zorg ? `Bedankt. Je kinesitherapeut ziet hoe je ${deel} reageert en houdt er rekening mee.`
      : r.gedaan === 'niet' ? 'Bewaard. Bedankt om het aan te duiden.' : 'Goed gedaan! Bewaard.');
    return true;
  } catch (e) { ctx.melding(e.message || 'Bewaren lukte niet.'); return false; }
}

// ===================================================================================
// Therapeut: strook "Oefensessies"
// ===================================================================================

async function sessiesPaneel(box, p) {
  const { esc } = ctx;
  if (!box) return;
  const kop = `<div class="strook-kop"><h2>Oefensessies</h2></div>`;
  let sessies;
  try { sessies = await bron.sessiesVan(p.id); }
  catch (e) {
    box.innerHTML = `<div class="paneel strook-sessies">${kop}<p>${/does not exist|schema cache|relation/i.test(e.message || '')
      ? 'De oefensessies staan nog niet in Supabase (013_oefensessies.sql).' : esc(e.message)}</p></div>`;
    return;
  }
  if (!box.isConnected) return;

  const grens = new Date(vandaag() + 'T00:00:00'); grens.setDate(grens.getDate() - 13);
  const recent = sessies.filter(s => new Date(s.datum + 'T00:00:00') >= grens);
  const geoefend = recent.filter(s => s.gedaan !== 'niet').length;
  const niet = recent.filter(s => s.gedaan === 'niet').length;
  const metPijn = recent.filter(s => s.pijn != null);
  const gemPijn = metPijn.length ? metPijn.reduce((t, s) => t + s.pijn, 0) / metPijn.length : null;
  const licht = kleuren(sessies);
  const signalen = recent.filter(s => licht.get(s.datum) && licht.get(s.datum).kleur !== 'groen');
  const tel = k => recent.filter(s => licht.get(s.datum)?.kleur === k).length;
  const pijnpunten = [...sessies].filter(s => s.pijn != null).slice(0, 30).reverse();

  box.innerHTML = `
    <div class="paneel strook-sessies">
      ${kop}
      ${!sessies.length ? '<p>Nog niets ingevuld. De patiënt duidt in zijn oefenkalender aan of hij geoefend heeft.</p>' : `
      <p class="hulp" style="font-size:.95rem">Laatste 14 dagen: <b>${geoefend} ${geoefend === 1 ? 'dag' : 'dagen'} geoefend</b>${niet ? ` · ${niet} niet geoefend` : ''}
        ${gemPijn != null ? ` · gemiddelde pijn <b>${gemPijn.toLocaleString('nl-BE', { maximumFractionDigits: 1 })}/10</b>` : ''}</p>
      ${licht.size ? `<p class="licht-telling">${['groen', 'oranje', 'rood'].map(k => `<span><i class="licht-bol licht-${k}"></i> ${tel(k)} ${LICHT[k].naam.toLowerCase()}</span>`).join('')}<span class="hulp">laatste 14 dagen</span></p>` : ''}
      ${signalen.length ? `<div class="signaal ${signalen.some(s => licht.get(s.datum).kleur === 'rood') ? 'signaal-rood' : ''}"><b>Let op:</b> ${signalen.slice(0, 4).map(s => {
        const l = licht.get(s.datum);
        return `<i class="licht-bol licht-${l.kleur}"></i> ${esc(datumKort(s.datum))}: ${esc(l.redenen.join(', '))}`;
      }).join(' · ')}
        <span class="hulp">(verkeerslicht: zie de stopregels van het protocol)</span></div>` : ''}`}
      <div class="sessie-raster">
        <div class="kal-vak"></div>
        ${pijnpunten.length >= 2 ? '<div><div class="grafiek-vlak grafiek-klein"><canvas id="pijn-grafiek"></canvas></div><p class="hulp">Pijn (0–10) bij het oefenen</p></div>' : ''}
      </div>
      ${sessies.length ? `<div class="tabel-scroll"><table class="meet-tabel strook-tabel">
        <thead><tr><th>Datum</th><th>Geoefend</th><th>Pijn</th><th>Zwelling</th><th>Stijfheid</th><th>Feedback</th></tr></thead>
        <tbody>${sessies.slice(0, 12).map(s => `<tr class="${licht.get(s.datum) ? `rij-${licht.get(s.datum).kleur}` : ''}">
          <td>${licht.get(s.datum) ? `<i class="licht-bol licht-${licht.get(s.datum).kleur}" title="${LICHT[licht.get(s.datum).kleur].naam}"></i> ` : ''}${esc(datumKort(s.datum))}${s.programma?.titel ? `<br><span class="hulp">${esc(s.programma.titel)}</span>` : ''}</td>
          <td>${TEKEN[s.gedaan]} ${esc(GEDAAN[s.gedaan] || s.gedaan)}</td>
          <td>${s.pijn != null ? `<b>${s.pijn}</b>/10` : '—'}</td>
          <td>${esc(ZWELLING[s.zwelling] || '—')}</td>
          <td>${s.stijfheid === 'stijver' ? '<b>Stijver</b>' : esc({ beter: 'Soepeler', zelfde: 'Zoals vorige keer' }[s.stijfheid] || '—')}</td>
          <td>${s.goed ? `<div><span class="beter">Goed:</span> ${esc(s.goed)}</div>` : ''}${s.moeilijk ? `<div><span class="minder">Moeilijk:</span> ${esc(s.moeilijk)}</div>` : ''}${!s.goed && !s.moeilijk ? '<span class="hulp">—</span>' : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${sessies.length > 12 ? `<p class="hulp">${sessies.length - 12} oudere ingaven niet getoond.</p>` : ''}` : ''}
    </div>`;

  koppelKalender(box.querySelector('.kal-vak'), () => sessies, { verschuiving: 0, klikbaar: false });

  const canvas = box.querySelector('#pijn-grafiek');
  if (canvas && window.Chart) {
    new window.Chart(canvas, {
      type: 'line',
      data: { labels: pijnpunten.map(s => datumKort(s.datum)), datasets: [{ label: 'Pijn (0–10)', data: pijnpunten.map(s => s.pijn), borderColor: '#7a8a8a', tension: .25, pointRadius: 5,
        pointBackgroundColor: pijnpunten.map(s => KLEURCODE[licht.get(s.datum)?.kleur] || '#7a8a8a'), pointBorderColor: pijnpunten.map(s => KLEURCODE[licht.get(s.datum)?.kleur] || '#7a8a8a') }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 10, ticks: { stepSize: 2 } } } }
    });
  }
}
