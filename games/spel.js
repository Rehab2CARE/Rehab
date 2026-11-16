// Gedeelde hulpfuncties voor alle spellen: instellingen (localStorage), keuzeknoppen,
// schermwissel, aftellen en een piep via WebAudio (start pas na een tik, zoals iOS vraagt).

export function laadInstellingen(sleutel, standaard) {
  try {
    const opgeslagen = JSON.parse(localStorage.getItem(sleutel) || '{}');
    return { ...standaard, ...opgeslagen };
  } catch { return { ...standaard }; }
}

export function bewaarInstellingen(sleutel, waarden) {
  try { localStorage.setItem(sleutel, JSON.stringify(waarden)); } catch { /* privévenster: niet erg */ }
}

// Bouwt keuzeknoppen in elk element met data-instelling="naam".
// opties: { naam: [{ waarde, label }, ...] }
export function bouwKeuzes(opties, waarden, bijWijziging) {
  for (const [naam, lijst] of Object.entries(opties)) {
    const vak = document.querySelector(`[data-instelling="${naam}"]`);
    if (!vak) continue;
    vak.innerHTML = '';
    for (const optie of lijst) {
      const knop = document.createElement('button');
      knop.type = 'button';
      knop.textContent = optie.label;
      knop.setAttribute('aria-pressed', String(waarden[naam] === optie.waarde));
      knop.addEventListener('click', () => {
        waarden[naam] = optie.waarde;
        vak.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === knop)));
        bijWijziging?.(waarden, naam);
      });
      vak.appendChild(knop);
    }
  }
}

// Volledig scherm tijdens het spelen: aan bij Start of Opnieuw, uit zodra je terug op het startscherm van het spel komt
// (Stoppen of Instellingen). Bij voorkeur de hele app (het spel draait in een iframe), anders enkel het spel.
// Moet starten vanuit een tik; lukt het niet (bv. iPhone), dan gewoon verder.
const isVol = d => d && (d.fullscreenElement || d.webkitFullscreenElement);
function bovenDoc() { try { return window.top.document; } catch { return null; } }

export function volScherm() {
  const boven = bovenDoc();
  if (isVol(document) || isVol(boven)) return;
  const vraag = el => { const f = el.requestFullscreen || el.webkitRequestFullscreen; return f ? Promise.resolve(f.call(el)) : Promise.reject(); };
  try {
    (boven ? vraag(boven.documentElement) : Promise.reject())
      .catch(() => vraag(document.documentElement)).catch(() => {});
  } catch { /* niet ondersteund */ }
}

export function volSchermUit() {
  for (const d of [document, bovenDoc()]) {
    if (!isVol(d)) continue;
    try { Promise.resolve((d.exitFullscreen || d.webkitExitFullscreen)?.call(d)).catch(() => {}); } catch { /* niet ondersteund */ }
  }
}

export function toonScherm(id) {
  if (id === 'start') volSchermUit();
  document.querySelectorAll('.scherm').forEach(s => { s.hidden = s.id !== id; });
}

let audio = null;
export function startGeluid() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}

export function piep(aan, hoogte = 880, duur = 0.12) {
  if (!aan || !audio) return;
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.frequency.value = hoogte;
  vol.gain.setValueAtTime(0.25, audio.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duur);
  osc.connect(vol).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duur);
}

export const wacht = ms => new Promise(r => setTimeout(r, ms));

// Toont 3-2-1 in het element met id "aftel-getal" (scherm "aftellen").
export async function aftellen(geluid) {
  toonScherm('aftellen');
  const getal = document.getElementById('aftel-getal');
  for (let i = 3; i >= 1; i--) {
    getal.textContent = i;
    piep(geluid, 660);
    await wacht(800);
  }
}
