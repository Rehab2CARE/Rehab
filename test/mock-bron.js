// TEST: nagebootste versie van js/bron.js (geen echte Supabase). Gebruikt door test/test_app.py.
// De "server" leeft in localStorage (sleutel mock-server), zodat hij een herlading overleeft.

const lees = () => JSON.parse(localStorage.getItem('mock-server') || 'null');
const schrijfServer = s => localStorage.setItem('mock-server', JSON.stringify(s));
const nu = () => new Date(Date.now() + Math.floor(Math.random() * 1000)).toISOString();
const id = () => crypto.randomUUID();

export class BronFout extends Error { constructor(m) { super(typeof m === 'string' ? m : m.message); this.name = 'BronFout'; } }

function server() {
  if (window.__mockOffline || localStorage.getItem('mock-offline') === '1') throw new BronFout('Geen verbinding met de server. Ben je online?');
  return lees();
}
function sessie() { return JSON.parse(localStorage.getItem('mock-sessie') || 'null'); }
function mijnRol(s) { const u = sessie(); return u && s.profielen.find(p => p.id === u.user.id)?.rol; }
function team(s) {
  if (!['therapeut', 'beheerder'].includes(mijnRol(s))) throw new BronFout('Je hebt hiervoor geen toestemming.');
}

export const isIngesteld = () => true;

export async function start() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const linkType = hash.get('access_token') ? hash.get('type') : null;
  const linkFout = hash.get('error_description');
  if (linkType) {
    const s = lees();
    const p = s.profielen.find(x => x.email === hash.get('email'));
    if (p) localStorage.setItem('mock-sessie', JSON.stringify({ user: { id: p.id, email: p.email } }));
  }
  if (hash.has('access_token') || linkFout) history.replaceState(null, '', location.pathname + location.search + '#/');
  const offline = window.__mockOffline || localStorage.getItem('mock-offline') === '1';
  return { sessie: offline && localStorage.getItem('mock-geen-sessie-offline') === '1' ? null : sessie(), linkType, linkFout };
}

export async function aanmelden(email, wachtwoord) {
  const s = server();
  const p = s.profielen.find(x => x.email === email);
  if (!p || s.wachtwoorden[email] !== wachtwoord) throw new BronFout('E-mailadres of wachtwoord klopt niet.');
  const ses = { user: { id: p.id, email } };
  localStorage.setItem('mock-sessie', JSON.stringify(ses));
  return ses;
}
export async function wachtwoordVergeten() { server(); }
export async function nieuwWachtwoord(w) {
  const s = server(); s.wachtwoorden[sessie().user.email] = w; schrijfServer(s);
}
export async function afmelden() { localStorage.removeItem('mock-sessie'); }
export function bijSessieWijziging() {}

export async function mijnProfiel(uid) {
  const s = server();
  const p = s.profielen.find(x => x.id === uid);
  if (!p) throw new BronFout('niet gevonden');
  return { ...p };
}
export async function profielen() {
  const s = server();
  if (mijnRol(s) !== 'beheerder') return s.profielen.filter(p => p.id === sessie().user.id);
  return s.profielen;
}
export async function zetRol(pid, rol) {
  const s = server();
  if (mijnRol(s) !== 'beheerder') throw new BronFout('Je hebt hiervoor geen toestemming.');
  s.profielen.find(p => p.id === pid).rol = rol || null; schrijfServer(s);
}

export async function alles() {
  const s = server(); team(s);
  return { knopen: structuredClone(s.knopen), fiches: s.fiches.map(f => ({ ...f })) };
}
export async function maakKnoop(v) {
  const s = server(); team(s);
  const k = { id: id(), omschrijving: '', volgorde: 0, ouder_id: null, ...v, bijgewerkt: nu() };
  s.knopen.push(k); schrijfServer(s); return k;
}
export async function wijzigKnoop(kid, v) {
  const s = server(); team(s);
  const k = s.knopen.find(x => x.id === kid); Object.assign(k, v, { bijgewerkt: nu() }); schrijfServer(s); return k;
}
export async function wisKnoop(kid, paden = []) {
  const s = server(); team(s);
  paden.forEach(p => { delete s.bestanden[p]; s.gewisteBestanden = (s.gewisteBestanden || 0) + 1; });
  const weg = new Set([kid]);
  let gegroeid = true;
  while (gegroeid) { gegroeid = false; s.knopen.forEach(k => { if (k.ouder_id && weg.has(k.ouder_id) && !weg.has(k.id)) { weg.add(k.id); gegroeid = true; } }); }
  s.knopen = s.knopen.filter(k => !weg.has(k.id));
  s.fiches = s.fiches.filter(f => !weg.has(f.categorie_id));
  schrijfServer(s);
}
export async function zetVolgorde(tabel, items) {
  const s = server(); team(s);
  items.forEach(it => { const r = s[tabel].find(x => x.id === it.id); r.volgorde = it.volgorde; r.bijgewerkt = nu(); });
  schrijfServer(s);
}
export async function maakFiche(v, bestand) {
  const s = server(); team(s);
  if (bestand) {
    const buf = new Uint8Array(await bestand.arrayBuffer());
    let bin = ''; buf.forEach(b => { bin += String.fromCharCode(b); });
    s.bestanden[v.bestand_pad] = btoa(bin);
  }
  const f = { omschrijving: '', tekst: null, bestand_pad: null, mime: null, bestandsnaam: null, grootte: null, ...v, bijgewerkt: nu() };
  s.fiches.push(f); schrijfServer(s); return { ...f };
}
export async function wijzigFiche(fid, v) {
  const s = server(); team(s);
  const f = s.fiches.find(x => x.id === fid); Object.assign(f, v, { bijgewerkt: nu() }); schrijfServer(s); return { ...f };
}
export async function wisFiche(fid, pad) {
  const s = server(); team(s);
  if (pad) delete s.bestanden[pad];
  s.fiches = s.fiches.filter(f => f.id !== fid); schrijfServer(s);
}
export async function download(pad) {
  const s = server();
  if (mijnRol(s) === 'patient') { // patiënt: enkel bestanden van fiches in een eigen actief programma
    const uid = sessie().user.id;
    const mijn = new Set((s.items || []).filter(i => (s.programmas || []).some(g => g.id === i.programma_id && g.patient_id === uid && g.actief)).map(i => i.fiche_id));
    if (!s.fiches.some(f => f.bestand_pad === pad && mijn.has(f.id))) throw new BronFout('Je hebt hiervoor geen toestemming.');
  } else team(s);
  window.__downloads = (window.__downloads || 0) + 1;
  const b64 = s.bestanden[pad];
  if (b64 == null) throw new BronFout('niet gevonden');
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

// Favorieten: per aangemelde gebruiker (zoals RLS in de echte databank)
export async function favorieten() {
  const s = server(); team(s);
  return (s.favorieten || []).filter(r => r.profiel_id === sessie().user.id).map(r => r.fiche_id);
}
export async function voegFavorietToe(pid, fid) {
  const s = server(); team(s);
  if (pid !== sessie().user.id) throw new BronFout('Je hebt hiervoor geen toestemming.');
  s.favorieten = s.favorieten || [];
  if (!s.favorieten.some(r => r.profiel_id === pid && r.fiche_id === fid)) s.favorieten.push({ profiel_id: pid, fiche_id: fid });
  schrijfServer(s);
}
export async function wisFavoriet(pid, fid) {
  const s = server(); team(s);
  s.favorieten = (s.favorieten || []).filter(r => !(r.profiel_id === pid && r.fiche_id === fid));
  schrijfServer(s);
}

// ---------- Fase 3: patiënten en programma's (nagebootst, met dezelfde regels als de RLS) ----------
export const codeNaarEmail = code => `${String(code).trim().toLowerCase()}@patienten.praktijkfiches.invalid`;
export const isPatientCode = t => /^pt-[a-z0-9]{4,}$/i.test(String(t).trim());
const ALF = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const willekeurig = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALF[b % ALF.length]).join('');

export async function maakPatient(naam = '') {
  const s = server(); team(s);
  const code = 'PT-' + willekeurig(6), wachtwoord = willekeurig(10), pid = id();
  s.profielen.push({ id: pid, email: codeNaarEmail(code), naam: naam || code, rol: 'patient' });
  s.wachtwoorden[codeNaarEmail(code)] = wachtwoord;
  s.patienten = s.patienten || [];
  s.patienten.push({ id: pid, code, naam: String(naam).trim(), aangemaakt: nu() });
  schrijfServer(s);
  return { id: pid, code, wachtwoord };
}
export async function nieuweCode(pid) {
  const s = server(); team(s);
  const p = (s.patienten || []).find(x => x.id === pid);
  if (!p) throw new BronFout('Patiënt niet gevonden.');
  const wachtwoord = willekeurig(10);
  s.wachtwoorden[codeNaarEmail(p.code)] = wachtwoord; schrijfServer(s);
  return { code: p.code, wachtwoord };
}
export async function verwijderPatient(pid) {
  const s = server(); team(s);
  const p = (s.patienten || []).find(x => x.id === pid);
  if (!p) throw new BronFout('Patiënt niet gevonden.');
  const progIds = new Set((s.programmas || []).filter(g => g.patient_id === pid).map(g => g.id));
  s.programmas = (s.programmas || []).filter(g => g.patient_id !== pid);
  s.items = (s.items || []).filter(i => !progIds.has(i.programma_id));
  s.patienten = s.patienten.filter(x => x.id !== pid);
  s.profielen = s.profielen.filter(x => x.id !== pid);
  delete s.wachtwoorden[codeNaarEmail(p.code)];
  schrijfServer(s);
  return { ok: true };
}
export async function patienten() {
  const s = server(); team(s);
  return (s.patienten || []).slice().reverse().map(p => ({ ...p, programmas: (s.programmas || []).filter(g => g.patient_id === p.id).map(g => ({ id: g.id, actief: g.actief })),
    patient_trajecten: (s.trajecten || []).filter(t => t.patient_id === p.id).map(t => ({ protocol_id: t.protocol_id, huidige_fase: t.huidige_fase, actief: t.actief })) }));
}
export async function wijzigPatient(pid, v) {
  const s = server(); team(s);
  const p = s.patienten.find(x => x.id === pid); Object.assign(p, v); schrijfServer(s); return { ...p };
}
const metItems = (s, g, metFiche = false) => ({
  ...g,
  programma_items: (s.items || []).filter(i => i.programma_id === g.id).map(i => metFiche ? { ...i, fiche: s.fiches.find(f => f.id === i.fiche_id) || null } : { ...i })
});
export async function programmasVan(pid) {
  const s = server(); team(s);
  return (s.programmas || []).filter(g => g.patient_id === pid).map(g => metItems(s, g));
}
export async function programma(gid) {
  const s = server(); team(s);
  const g = (s.programmas || []).find(x => x.id === gid);
  if (!g) throw new BronFout('niet gevonden');
  return metItems(s, g, true);
}
export async function maakProgramma(v) {
  const s = server(); team(s);
  const g = { id: id(), opmerking: '', actief: true, ...v, aangemaakt: nu(), bijgewerkt: nu() };
  s.programmas = s.programmas || []; s.programmas.push(g); schrijfServer(s); return { ...g };
}
export async function wijzigProgramma(gid, v) {
  const s = server(); team(s);
  const g = s.programmas.find(x => x.id === gid); Object.assign(g, v, { bijgewerkt: nu() }); schrijfServer(s); return { ...g };
}
export async function wisProgramma(gid) {
  const s = server(); team(s);
  s.programmas = s.programmas.filter(x => x.id !== gid);
  s.items = (s.items || []).filter(i => i.programma_id !== gid); schrijfServer(s);
}
export async function voegItemsToe(rijen) {
  const s = server(); team(s);
  s.items = s.items || [];
  const nieuw = rijen.map(r => ({ id: id(), sets: '', herhalingen: '', frequentie: '', notitie: '', volgorde: 0, ...r }));
  s.items.push(...nieuw); schrijfServer(s); return nieuw;
}
export async function wijzigItem(iid, v) {
  const s = server(); team(s);
  Object.assign(s.items.find(x => x.id === iid), v); schrijfServer(s);
}
export async function wisItem(iid) {
  const s = server(); team(s);
  s.items = s.items.filter(x => x.id !== iid); schrijfServer(s);
}
// Patiënt: enkel eigen actieve programma's (zoals de RLS)
export async function mijnProgrammas() {
  const s = server();
  const u = sessie();
  if (!u) throw new BronFout('Je hebt hiervoor geen toestemming.');
  return (s.programmas || []).filter(g => g.patient_id === u.user.id && g.actief).map(g => metItems(s, g, true));
}

// ---------- Protocollen (nagebootst, enkel team) ----------
// s.protocollen, s.fasen, s.criteria, s.fase_oef: platte tabellen zoals in de databank
export async function protocollen() {
  const s = server(); team(s);
  return (s.protocollen || []).slice().sort((a, b) => a.volgorde - b.volgorde).map(p => ({
    ...p,
    protocol_fasen: (s.fasen || []).filter(f => f.protocol_id === p.id).map(f => ({
      ...f,
      protocol_criteria: (s.criteria || []).filter(c => c.fase_id === f.id).map(c => ({ id: c.id, patient_concept: c.patient_concept })),
      fase_oefeningen: (s.fase_oef || []).filter(o => o.fase_id === f.id).map(o => ({ id: o.id }))
    }))
  }));
}
export async function protocolFase(pid, nummer) {
  const s = server(); team(s);
  const f = (s.fasen || []).find(x => x.protocol_id === pid && x.nummer === Number(nummer));
  if (!f) throw new BronFout('niet gevonden');
  const p = s.protocollen.find(x => x.id === pid);
  return { ...f, protocol: { id: p.id, naam: p.naam },
    protocol_criteria: (s.criteria || []).filter(c => c.fase_id === f.id).map(c => ({ ...c })),
    fase_oefeningen: (s.fase_oef || []).filter(o => o.fase_id === f.id).map(o => ({ ...o, fiche: (() => { const x = s.fiches.find(y => y.id === o.fiche_id); return x ? { id: x.id, titel: x.titel } : null; })() })) };
}
export async function wijzigFase(fid, v) { const s = server(); team(s); Object.assign(s.fasen.find(x => x.id === fid), v); schrijfServer(s); }
export async function wijzigCriterium(cid, v) { const s = server(); team(s); Object.assign(s.criteria.find(x => x.id === cid), v); schrijfServer(s); }
export async function keurCriteriaGoed(fid) { const s = server(); team(s); s.criteria.filter(c => c.fase_id === fid).forEach(c => { c.patient_concept = false; }); schrijfServer(s); }
export async function faseOefeningen(fid) { const s = server(); team(s); return (s.fase_oef || []).filter(o => o.fase_id === fid).map(o => ({ id: o.id, fiche_id: o.fiche_id, volgorde: o.volgorde })); }
export async function voegFaseOefeningenToe(rijen) {
  const s = server(); team(s); s.fase_oef = s.fase_oef || [];
  const nieuw = rijen.map(r => ({ id: id(), sets: '', herhalingen: '', frequentie: '', notitie: '', volgorde: 0, ...r }));
  s.fase_oef.push(...nieuw); schrijfServer(s); return nieuw;
}
export async function wijzigFaseOefening(oid, v) { const s = server(); team(s); Object.assign(s.fase_oef.find(x => x.id === oid), v); schrijfServer(s); }
export async function wisFaseOefening(oid) { const s = server(); team(s); s.fase_oef = s.fase_oef.filter(x => x.id !== oid); schrijfServer(s); }

// ---------- Trajecten (nagebootst) ----------
export async function trajectenVan(pid) {
  const s = server(); team(s);
  return (s.trajecten || []).filter(t => t.patient_id === pid).map(t => ({ ...t, traject_fasen: (s.traject_fasen || []).filter(v => v.traject_id === t.id) }));
}
export async function maakTraject(v) {
  const s = server(); team(s);
  const t = { id: id(), startdatum: null, zijde: '', graft: '', ingreep: '', sportprofiel: '', meniscus_zijde: '', meniscus_letsel: '', huidige_fase: 1, zichtbaar: {}, actief: true, ...v, aangemaakt: nu() };
  s.trajecten = s.trajecten || []; s.trajecten.push(t); schrijfServer(s); return { ...t };
}
export async function wijzigTraject(tid, v) { const s = server(); team(s); Object.assign(s.trajecten.find(x => x.id === tid), v); schrijfServer(s); }
export async function logFase(tid, nummer, door) { const s = server(); team(s); s.traject_fasen = s.traject_fasen || []; s.traject_fasen.push({ id: id(), traject_id: tid, nummer, door, vrijgegeven: nu() }); schrijfServer(s); }
export async function stopFaseProgrammas(tid, n) { const s = server(); team(s); (s.programmas || []).filter(g => g.traject_id === tid && g.fase_nummer !== n).forEach(g => { g.actief = false; }); schrijfServer(s); }
export async function programmaVoorFase(tid, n) { const s = server(); team(s); const g = (s.programmas || []).find(x => x.traject_id === tid && x.fase_nummer === n); return g ? { id: g.id } : null; }
export async function faseMetOefeningen(pid, n) {
  const s = server(); team(s);
  const f = s.fasen.find(x => x.protocol_id === pid && x.nummer === n);
  return { id: f.id, titel: f.titel, titel_patient: f.titel_patient, fase_oefeningen: (s.fase_oef || []).filter(o => o.fase_id === f.id).map(o => ({ ...o })) };
}
// Zoals de functie mijn_opvolging() in de databank: enkel patiëntteksten en wat zichtbaar staat
export async function mijnOpvolging() {
  const s = server(); const u = sessie();
  if (!u) throw new BronFout('Je hebt hiervoor geen toestemming.');
  return (s.trajecten || []).filter(t => t.patient_id === u.user.id && t.actief).map(t => {
    const f = s.fasen.find(x => x.protocol_id === t.protocol_id && x.nummer === t.huidige_fase);
    const std = f.zichtbaar || {};
    const z = {};
    ['oefeningen', 'doel', 'criteria', 'testresultaten'].forEach(k => { z[k] = t.zichtbaar?.[k] ?? std[k] ?? (k !== 'testresultaten'); });
    return {
      traject_id: t.id, protocol: s.protocollen.find(p => p.id === t.protocol_id).naam, fase: t.huidige_fase,
      aantal_fasen: s.fasen.filter(x => x.protocol_id === t.protocol_id).length, zichtbaar: z,
      titel: z.doel ? f.titel_patient : null, doel: z.doel ? f.doel_patient : null,
      ...(() => {
        if (!z.criteria) return { criteria: null, voldaan: null, totaal: null };
        const st = cid => (s.criterium_status || []).find(x => x.traject_id === t.id && x.criterium_id === cid)?.status || '';
        const lijst = s.criteria.filter(c => c.fase_id === f.id && c.patient_tekst && st(c.id) !== 'nvt').sort((a, b) => a.volgorde - b.volgorde);
        return { criteria: lijst.map(c => ({ tekst: c.patient_tekst, voldaan: st(c.id) === 'voldaan' })), voldaan: lijst.filter(c => st(c.id) === 'voldaan').length, totaal: lijst.length };
      })()
    };
  });
}

// ---------- Criteriumstatus (nagebootst) ----------
export async function criteriumStatussen(tid) { const s = server(); team(s); return (s.criterium_status || []).filter(x => x.traject_id === tid).map(x => ({ ...x })); }
export async function zetCriteriumStatus(tid, cid, v) {
  const s = server(); team(s); s.criterium_status = s.criterium_status || [];
  const r = s.criterium_status.find(x => x.traject_id === tid && x.criterium_id === cid);
  if (r) Object.assign(r, v); else s.criterium_status.push({ id: id(), traject_id: tid, criterium_id: cid, notitie: '', ...v });
  schrijfServer(s);
}
export async function wisCriteriumStatus(tid, cid) { const s = server(); team(s); s.criterium_status = (s.criterium_status || []).filter(x => !(x.traject_id === tid && x.criterium_id === cid)); schrijfServer(s); }

export async function maakCriterium(v) { const s = server(); team(s); const c = { id: id(), testmethode: '', drempel: '', niveau: '', bron: '', bij_niet_halen: '', patient_tekst: '', patient_concept: true, ...v }; s.criteria.push(c); schrijfServer(s); return { ...c }; }
export async function wisCriterium(cid) { const s = server(); team(s); s.criteria = s.criteria.filter(c => c.id !== cid); s.criterium_status = (s.criterium_status || []).filter(x => x.criterium_id !== cid); schrijfServer(s); }
