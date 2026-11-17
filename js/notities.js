// Opvolgnotities bij een patiënt: korte notities van de therapeut na elke sessie.
//
// Enkel zichtbaar voor de therapeut die ze schreef: de databank (RLS, 020_opvolgnotities.sql) geeft
// andere notities niet door, ook niet aan collega's of de beheerder. De patiënt ziet ze nooit.
// Strook "Opvolgnotities" op het scherm van een patiënt (patienten.js roept ctx.notitiesPaneel op).

import * as bron from './bron.js';
import { vandaag } from './sessies.js';

let ctx = null;
const MAX = 4000;
const TOON = 10; // zoveel notities meteen zichtbaar, de rest achter "Toon alle"

export function initNotities(hulp) {
  ctx = hulp;
  ctx.notitiesPaneel = (...a) => notitiesPaneel(...a);
}

const datumLang = d => new Date(d + 'T00:00:00').toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

async function notitiesPaneel(box, p, { alles = false } = {}) {
  const { esc } = ctx;
  if (!box) return;
  const kop = `<div class="strook-kop"><h2>Opvolgnotities</h2><span class="label label-prive" title="Collega's en de patiënt zien deze notities niet">🔒 Enkel voor jou</span></div>`;
  let notities;
  try { notities = await bron.notitiesVan(p.id); }
  catch (e) {
    box.innerHTML = `<div class="paneel strook-notities">${kop}<p>${/does not exist|schema cache|relation/i.test(e.message || '')
      ? 'De opvolgnotities staan nog niet in Supabase (020_opvolgnotities.sql).' : esc(e.message)}</p></div>`;
    return;
  }
  if (!box.isConnected) return;
  const herlaad = (opties = { alles }) => notitiesPaneel(box, p, opties);
  const zichtbaar = alles ? notities : notities.slice(0, TOON);

  box.innerHTML = `
    <div class="paneel strook-notities">
      ${kop}
      <form class="notitie-nieuw" autocomplete="off">
        <label>Nieuwe notitie
          <textarea name="tekst" rows="3" maxlength="${MAX}" required placeholder="bv. Squat 3×8 zonder pijn. Volgende keer: hop op twee benen."></textarea>
        </label>
        <div class="notitie-balk">
          <label class="notitie-datum">Datum<input type="date" name="datum" value="${vandaag()}" max="${vandaag()}" required></label>
          <button type="submit" class="knop knop-hoofd">Notitie bewaren</button>
        </div>
      </form>
      ${notities.length ? `<ol class="notities">${zichtbaar.map(n => `
        <li class="notitie" data-id="${esc(n.id)}">
          <div class="notitie-kop">
            <span class="notitie-wanneer">${esc(datumLang(n.datum))}</span>
            <span class="notitie-acties">
              <button type="button" class="knop knop-plat klein" data-actie="wijzig">Wijzigen</button>
              <button type="button" class="knop knop-plat klein weg" data-actie="wis" aria-label="Notitie wissen">✕</button>
            </span>
          </div>
          <p class="notitie-tekst">${esc(n.tekst)}</p>
        </li>`).join('')}</ol>
      ${!alles && notities.length > TOON ? `<button type="button" class="knop knop-plat" data-actie="alles">Toon alle ${notities.length} notities</button>` : ''}`
      : '<p class="hulp">Nog geen notities. Wat je hier schrijft, ziet enkel jij.</p>'}
    </div>`;

  const form = box.querySelector('.notitie-nieuw');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const tekst = form.tekst.value.trim();
    if (!tekst) return;
    const knop = form.querySelector('[type=submit]');
    knop.disabled = true;
    try {
      await bron.maakNotitie({ patient_id: p.id, auteur_id: ctx.profielId(), datum: form.datum.value || vandaag(), tekst: tekst.slice(0, MAX) });
      ctx.melding('Notitie bewaard.');
      herlaad();
    } catch (err) { ctx.melding(err.message); knop.disabled = false; }
  });

  box.querySelector('[data-actie=alles]')?.addEventListener('click', () => herlaad({ alles: true }));

  box.querySelectorAll('.notitie').forEach(li => {
    const n = notities.find(x => x.id === li.dataset.id);
    li.querySelector('[data-actie=wijzig]').addEventListener('click', async () => {
      const r = await ctx.dialoog({
        titel: 'Notitie wijzigen', okTekst: 'Bewaren',
        velden: [
          { naam: 'datum', label: 'Datum', type: 'date', waarde: n.datum, verplicht: true },
          { naam: 'tekst', label: 'Notitie', soort: 'tekstvak', waarde: n.tekst, verplicht: true }
        ]
      });
      if (!r || !r.tekst) return;
      try { await bron.wijzigNotitie(n.id, { datum: r.datum || n.datum, tekst: r.tekst.slice(0, MAX) }); ctx.melding('Bewaard.'); herlaad(); }
      catch (err) { ctx.melding(err.message); }
    });
    li.querySelector('[data-actie=wis]').addEventListener('click', async () => {
      if (!await ctx.bevestig('Notitie wissen?', `De notitie van ${datumLang(n.datum)} wordt definitief gewist.`, 'Wissen')) return;
      try { await bron.wisNotitie(n.id); ctx.melding('Notitie gewist.'); herlaad(); }
      catch (err) { ctx.melding(err.message); }
    });
  });
}
