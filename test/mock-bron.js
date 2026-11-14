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
  const s = server(); team(s);
  window.__downloads = (window.__downloads || 0) + 1;
  const b64 = s.bestanden[pad];
  if (b64 == null) throw new BronFout('niet gevonden');
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
