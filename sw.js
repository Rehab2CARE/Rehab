// Offline-cache. Verhoog CACHE_VERSIE bij elke wijziging aan de app-bestanden.
const CACHE_VERSIE = 'fiches-v38';
const BESTANDEN = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/db.js', 'js/delen.js',
  'js/bron.js', 'js/sync.js', 'js/config.js', 'js/vendor/supabase.js', 'js/vendor/qrcode.js', 'js/patienten.js', 'js/protocollen.js', 'js/testen.js', 'js/sessies.js', 'js/verkeerslicht.js', 'js/vendor/chart.umd.js',
  'data/structuur.json', 'data/games.json', 'manifest.webmanifest',
  'games/spel.css', 'games/spel.js', 'games/ballen.html', 'games/cijfers.html', 'games/trainthebrain.html',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' = altijd vers van de server, niet uit de tijdelijke opslag van de browser
  e.waitUntil(caches.open(CACHE_VERSIE)
    .then(c => c.addAll(BESTANDEN.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSIE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
