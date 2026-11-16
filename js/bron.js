// Alle contact met Supabase zit in dit bestand: aanmelden, structuur, fiches, bestanden, gebruikers.
// De rest van de app praat enkel met deze functies.
// De bibliotheek staat lokaal in js/vendor/supabase.js (global "supabase"), zodat de app ook offline opstart.

import { SUPABASE } from './config.js';

// Een patiënt meldt zich aan met een code (bv. PT-7K3M9Q). Achter de schermen is dat een intern e-mailadres.
export const codeNaarEmail = code => `${String(code).trim().toLowerCase()}@${SUPABASE.PATIENT_DOMEIN || 'patienten.praktijkfiches.invalid'}`;
export const isPatientCode = t => /^pt-[a-z0-9]{4,}$/i.test(String(t).trim());

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

// ---------- Patiënten en programma's (fase 3) ----------

// Patiëntaccounts aanmaken, nieuwe code of verwijderen gaat via de Edge Function "patient-account".
async function patientFunctie(body) {
  const { data, error } = await sb.functions.invoke('patient-account', { body });
  if (error) {
    let m = error.message || '';
    try { const j = await error.context.json(); if (j?.fout) m = j.fout; } catch { /* geen JSON */ }
    if (/Failed to send a request|not found|404/i.test(m)) m = 'De functie "patient-account" staat nog niet in Supabase (zie README, fase 3).';
    throw new BronFout(m);
  }
  if (data?.fout) throw new BronFout(data.fout);
  return data;
}
export const maakPatient = naam => patientFunctie({ actie: 'maak', naam });
export const nieuweCode = id => patientFunctie({ actie: 'nieuwe-code', id });
export const verwijderPatient = id => patientFunctie({ actie: 'verwijder', id });

export async function patienten() {
  return ok(await sb.from('patienten').select('id, code, naam, aangemaakt, programmas(id, actief), patient_trajecten(protocol_id, huidige_fase, actief)').order('aangemaakt', { ascending: false }));
}

export async function wijzigPatient(id, velden) {
  return ok(await sb.from('patienten').update(velden).eq('id', id).select().single());
}

const ITEM_VELDEN = 'id, fiche_id, sets, herhalingen, frequentie, notitie, volgorde';
const FICHE_VELDEN = 'id, titel, omschrijving, soort, bestand_pad, mime, bestandsnaam, tekst, bijgewerkt';

// Alle programma's van één patiënt (voor de therapeut)
export async function programmasVan(patientId) {
  return ok(await sb.from('programmas')
    .select(`id, titel, opmerking, actief, aangemaakt, programma_items(${ITEM_VELDEN})`)
    .eq('patient_id', patientId).order('aangemaakt'));
}

export async function programma(id) {
  return ok(await sb.from('programmas')
    .select(`id, patient_id, titel, opmerking, actief, programma_items(${ITEM_VELDEN}, fiche:fiches(id, titel))`).eq('id', id).single());
}

export async function maakProgramma(velden) {
  return ok(await sb.from('programmas').insert(velden).select().single());
}
export async function wijzigProgramma(id, velden) {
  return ok(await sb.from('programmas').update(velden).eq('id', id).select().single());
}
export async function wisProgramma(id) {
  ok(await sb.from('programmas').delete().eq('id', id));
}
export async function voegItemsToe(rijen) {
  return ok(await sb.from('programma_items').insert(rijen).select());
}
export async function wijzigItem(id, velden) {
  ok(await sb.from('programma_items').update(velden).eq('id', id));
}
export async function wisItem(id) {
  ok(await sb.from('programma_items').delete().eq('id', id));
}

// Voor de aangemelde patiënt: zijn actieve programma's met de fiches erin (RLS laat niets anders door)
export async function mijnProgrammas() {
  return ok(await sb.from('programmas')
    .select(`id, titel, opmerking, aangemaakt, traject_id, fase_nummer, programma_items(${ITEM_VELDEN}, fiche:fiches(${FICHE_VELDEN}))`)
    .eq('actief', true).order('aangemaakt'));
}

// ---------- Protocollen (opvolging stap 1, enkel het team) ----------

export async function protocollen() {
  return ok(await sb.from('protocollen')
    .select('id, naam, versie, status, volgorde, instellingen, knoop_id, protocol_fasen(id, nummer, titel, titel_patient, ondergrens_weken, zichtbaar, doel_concept, protocol_criteria(id, patient_concept), fase_oefeningen(id))')
    .order('volgorde'));
}

export async function protocolFase(protocolId, nummer) {
  return ok(await sb.from('protocol_fasen')
    .select('*, protocol:protocollen(id, naam, knoop_id), protocol_criteria(*), fase_oefeningen(*, fiche:fiches(id, titel))')
    .eq('protocol_id', protocolId).eq('nummer', nummer).single());
}

export async function maakProtocol(velden) {
  return ok(await sb.from('protocollen').insert(velden).select().single());
}
export async function wijzigProtocol(id, velden) {
  ok(await sb.from('protocollen').update(velden).eq('id', id));
}
export async function maakFase(velden) {
  return ok(await sb.from('protocol_fasen').insert(velden).select().single());
}
export async function wisFase(id) {
  ok(await sb.from('protocol_fasen').delete().eq('id', id));
}
// Actieve trajecten van een protocol (om te weten of een fase nog in gebruik is)
export async function trajectenMetProtocol(protocolId) {
  return ok(await sb.from('patient_trajecten').select('id, huidige_fase').eq('protocol_id', protocolId).eq('actief', true));
}
export async function wijzigFase(id, velden) {
  ok(await sb.from('protocol_fasen').update(velden).eq('id', id));
}
export async function wijzigCriterium(id, velden) {
  ok(await sb.from('protocol_criteria').update(velden).eq('id', id));
}
export async function maakCriterium(velden) {
  return ok(await sb.from('protocol_criteria').insert(velden).select().single());
}
export async function wisCriterium(id) {
  ok(await sb.from('protocol_criteria').delete().eq('id', id));
}
export async function keurCriteriaGoed(faseId) {
  ok(await sb.from('protocol_criteria').update({ patient_concept: false }).eq('fase_id', faseId).eq('patient_concept', true));
}
export async function faseOefeningen(faseId) {
  return ok(await sb.from('fase_oefeningen').select('id, fiche_id, volgorde').eq('fase_id', faseId));
}
export async function voegFaseOefeningenToe(rijen) {
  return ok(await sb.from('fase_oefeningen').insert(rijen).select());
}
export async function wijzigFaseOefening(id, velden) {
  ok(await sb.from('fase_oefeningen').update(velden).eq('id', id));
}
export async function wisFaseOefening(id) {
  ok(await sb.from('fase_oefeningen').delete().eq('id', id));
}

// ---------- Trajecten: een patiënt volgt een protocol (opvolging stap 2) ----------

export async function trajectenVan(patientId) {
  return ok(await sb.from('patient_trajecten').select('*, traject_fasen(nummer, vrijgegeven)').eq('patient_id', patientId).order('aangemaakt'));
}
export async function maakTraject(velden) {
  return ok(await sb.from('patient_trajecten').insert(velden).select().single());
}
export async function wijzigTraject(id, velden) {
  ok(await sb.from('patient_trajecten').update(velden).eq('id', id));
}
export async function logFase(trajectId, nummer, door) {
  ok(await sb.from('traject_fasen').insert({ traject_id: trajectId, nummer, door }));
}
// Programma's van andere fasen van dit traject stopzetten
export async function stopFaseProgrammas(trajectId, behalveNummer) {
  ok(await sb.from('programmas').update({ actief: false }).eq('traject_id', trajectId).neq('fase_nummer', behalveNummer));
}
export async function programmaVoorFase(trajectId, nummer) {
  const rijen = ok(await sb.from('programmas').select('id').eq('traject_id', trajectId).eq('fase_nummer', nummer).limit(1));
  return rijen[0] || null;
}
export async function faseMetOefeningen(protocolId, nummer) {
  return ok(await sb.from('protocol_fasen')
    .select('id, titel, titel_patient, fase_oefeningen(fiche_id, sets, herhalingen, frequentie, notitie, volgorde)')
    .eq('protocol_id', protocolId).eq('nummer', nummer).single());
}
// ---------- Criteria afvinken per patiënt (opvolging stap 3) ----------
export async function criteriumStatussen(trajectId) {
  return ok(await sb.from('criterium_status').select('criterium_id, status, datum, notitie').eq('traject_id', trajectId));
}
export async function zetCriteriumStatus(trajectId, criteriumId, velden) {
  ok(await sb.from('criterium_status').upsert({ traject_id: trajectId, criterium_id: criteriumId, ...velden }, { onConflict: 'traject_id,criterium_id' }));
}
export async function wisCriteriumStatus(trajectId, criteriumId) {
  ok(await sb.from('criterium_status').delete().eq('traject_id', trajectId).eq('criterium_id', criteriumId));
}

// ---------- Testresultaten (opvolging stap 4) ----------
export async function tests() {
  return ok(await sb.from('tests').select('*').eq('actief', true).order('volgorde'));
}
export async function testmomentenVan(trajectId) {
  return ok(await sb.from('testmomenten').select('*, metingen(*)').eq('traject_id', trajectId).order('datum'));
}
export async function maakTestmoment(velden) {
  return ok(await sb.from('testmomenten').insert(velden).select().single());
}
export async function wijzigTestmoment(id, velden) {
  ok(await sb.from('testmomenten').update(velden).eq('id', id));
}
export async function wisTestmoment(id) {
  ok(await sb.from('testmomenten').delete().eq('id', id));
}
export async function zetMeting(testmomentId, testId, velden) {
  ok(await sb.from('metingen').upsert({ testmoment_id: testmomentId, test_id: testId, ...velden }, { onConflict: 'testmoment_id,test_id' }));
}
export async function wisMeting(testmomentId, testId) {
  ok(await sb.from('metingen').delete().eq('testmoment_id', testmomentId).eq('test_id', testId));
}
export async function mijnTestresultaten() {
  return ok(await sb.rpc('mijn_testresultaten')) || [];
}

// ---------- Oefensessies met feedback van de patiënt ----------
export async function sessiesVan(patientId) {
  return ok(await sb.from('oefensessies').select('*, programma:programmas(titel)').eq('patient_id', patientId)
    .order('datum', { ascending: false }).order('aangemaakt', { ascending: false }).limit(90));
}
export async function mijnSessies() {
  return ok(await sb.from('oefensessies').select('id, programma_id, datum, gedaan, pijn, zwelling, stijfheid, goed, moeilijk, aangemaakt')
    .order('datum', { ascending: false }).limit(120));
}
// Eén ingave per patiënt per dag: bestaat de dag al, dan wordt ze aangepast
export async function bewaarSessie(velden) {
  return ok(await sb.from('oefensessies').upsert(velden, { onConflict: 'patient_id,datum' }).select().single());
}
export async function wisSessie(id) {
  ok(await sb.from('oefensessies').delete().eq('id', id));
}

// ---------- Oefenschema's (bv. quadriceps): inhoud aanpasbaar in de app ----------
export async function oefenschemas() {
  return ok(await sb.from('oefenschemas').select('id, inhoud, bijgewerkt'));
}
export async function bewaarOefenschema(id, inhoud, door) {
  ok(await sb.from('oefenschemas').upsert({ id, inhoud, bijgewerkt_door: door || null }, { onConflict: 'id' }));
}

// Voor de aangemelde patiënt: enkel patiëntteksten en wat zichtbaar staat (functie in de databank)
export async function mijnOpvolging() {
  return ok(await sb.rpc('mijn_opvolging')) || [];
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
