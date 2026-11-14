// Alle contact met Supabase zit in dit bestand: aanmelden, structuur, fiches, bestanden, gebruikers.
// De rest van de app praat enkel met deze functies.
// De bibliotheek staat lokaal in js/vendor/supabase.js (global "supabase"), zodat de app ook offline opstart.

import { SUPABASE } from './config.js';

const BUCKET = 'fiches';
let sb = null;

export const isIngesteld = () => !!(SUPABASE.URL && SUPABASE.ANON_KEY);

// Leesbare foutmeldingen in plaats van technische
function vertaal(fout) {
  const m = String(fout?.message || fout || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mailadres of wachtwoord klopt niet.';
  if (/Email not confirmed/i.test(m)) return 'Je e-mailadres is nog niet bevestigd. Kijk in je mailbox.';
  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(m)) return 'Geen verbinding met de server. Ben je online?';
  if (/row-level security|permission denied|not authorized|Unauthorized/i.test(m)) return 'Je hebt hiervoor geen toestemming.';
  if (/Password should be at least/i.test(m)) return 'Het wachtwoord is te kort (minstens 8 tekens).';
  if (/rate limit/i.test(m)) return 'Te veel pogingen. Wacht even en probeer opnieuw.';
  if (/Payload too large|exceeded the maximum allowed size/i.test(m)) return 'Dit bestand is te groot voor de opslag.';
  return m || 'Er liep iets mis.';
}

export class BronFout extends Error {
  constructor(fout) { super(vertaal(fout)); this.name = 'BronFout'; this.origineel = fout; }
}

function ok({ data, error }) {
  if (error) throw new BronFout(error);
  return data;
}

// ---------- Opstarten en aanmelden ----------

// Geeft { sessie, linkType, linkFout } terug.
// linkType = 'invite' of 'recovery' als de gebruiker binnenkomt via een uitnodigings- of herstelmail.
export async function start() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const linkType = hash.get('access_token') ? hash.get('type') : null;
  const linkFout = hash.get('error_description');

  sb = window.supabase.createClient(SUPABASE.URL, SUPABASE.ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });

  let sessie = null;
  try {
    const { data } = await sb.auth.getSession();
    sessie = data.session;
  } catch { /* offline: geen sessie op te halen */ }

  // Tokens of fouten uit de link niet in de adresbalk laten staan (de app gebruikt de # voor navigatie)
  if (hash.has('access_token') || linkFout) history.replaceState(null, '', location.pathname + location.search + '#/');
  return { sessie, linkType, linkFout: linkFout ? linkFout.replace(/\+/g, ' ') : null };
}

export async function aanmelden(email, wachtwoord) {
  return ok(await sb.auth.signInWithPassword({ email, password: wachtwoord })).session;
}

export async function wachtwoordVergeten(email) {
  ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
}

export async function nieuwWachtwoord(wachtwoord) {
  ok(await sb.auth.updateUser({ password: wachtwoord }));
}

export async function afmelden() {
  try { await sb.auth.signOut(); } catch { /* offline: lokaal toch afmelden */ }
}

export function bijSessieWijziging(fn) {
  sb.auth.onAuthStateChange((event, sessie) => fn(event, sessie));
}

export async function mijnProfiel(gebruikerId) {
  return ok(await sb.from('profielen').select('id, email, naam, rol').eq('id', gebruikerId).single());
}

// ---------- Gebruikers (enkel beheerder) ----------

export async function profielen() {
  return ok(await sb.from('profielen').select('id, email, naam, rol, aangemaakt').order('aangemaakt'));
}

export async function zetRol(id, rol) {
  const rijen = ok(await sb.from('profielen').update({ rol: rol || null }).eq('id', id).select('id'));
  if (!rijen.length) throw new BronFout('Je hebt hiervoor geen toestemming.');
}

// ---------- Structuur en fiches ----------

export async function alles() {
  const [knopen, fiches] = await Promise.all([
    sb.from('knopen').select('id, ouder_id, niveau, titel, omschrijving, volgorde, bijgewerkt'),
    sb.from('fiches').select('id, categorie_id, titel, omschrijving, soort, bestand_pad, mime, bestandsnaam, grootte, tekst, volgorde, bijgewerkt')
  ]);
  return { knopen: ok(knopen), fiches: ok(fiches) };
}

export async function maakKnoop(velden) {
  return ok(await sb.from('knopen').insert(velden).select().single());
}

export async function wijzigKnoop(id, velden) {
  return ok(await sb.from('knopen').update(velden).eq('id', id).select().single());
}

// Wist een knoop met alles eronder. De bestanden in de opslag eerst (de databank wist de rijen via cascade).
export async function wisKnoop(id, bestandPaden = []) {
  await wisBestanden(bestandPaden);
  ok(await sb.from('knopen').delete().eq('id', id));
}

export async function zetVolgorde(tabel, items) {
  // items: [{ id, volgorde }]
  for (const it of items) ok(await sb.from(tabel).update({ volgorde: it.volgorde }).eq('id', it.id));
}

// Nieuwe fiche. Met een bestand: eerst uploaden, dan de rij. Mislukt de rij, dan het bestand terug weg.
export async function maakFiche(velden, bestand) {
  if (bestand) {
    ok(await sb.storage.from(BUCKET).upload(velden.bestand_pad, bestand, { contentType: velden.mime, upsert: false }));
  }
  try {
    return ok(await sb.from('fiches').insert(velden).select().single());
  } catch (e) {
    if (bestand) await wisBestanden([velden.bestand_pad]);
    throw e;
  }
}

export async function wijzigFiche(id, velden) {
  return ok(await sb.from('fiches').update(velden).eq('id', id).select().single());
}

export async function wisFiche(id, pad) {
  if (pad) await wisBestanden([pad]);
  ok(await sb.from('fiches').delete().eq('id', id));
}

// ---------- Favorieten (enkel die van de aangemelde gebruiker, via RLS) ----------

export async function favorieten() {
  return ok(await sb.from('favorieten').select('fiche_id')).map(r => r.fiche_id);
}

export async function voegFavorietToe(profielId, ficheId) {
  ok(await sb.from('favorieten').upsert({ profiel_id: profielId, fiche_id: ficheId },
    { onConflict: 'profiel_id,fiche_id', ignoreDuplicates: true }));
}

export async function wisFavoriet(profielId, ficheId) {
  ok(await sb.from('favorieten').delete().eq('profiel_id', profielId).eq('fiche_id', ficheId));
}

export async function download(pad) {
  const blob = ok(await sb.storage.from(BUCKET).download(pad));
  return blob.arrayBuffer();
}

async function wisBestanden(paden) {
  const lijst = paden.filter(Boolean);
  for (let i = 0; i < lijst.length; i += 100) {
    const { error } = await sb.storage.from(BUCKET).remove(lijst.slice(i, i + 100));
    if (error) throw new BronFout(error);
  }
}
