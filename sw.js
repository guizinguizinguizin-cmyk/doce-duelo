// Service worker do Doce Duelo.
//
// Estrategia por tipo de recurso, em vez de uma so para tudo:
//
//  - Codigo do app (HTML/JS/CSS): rede primeiro. O jogo precisa de internet
//    para partidas online de qualquer forma, e servir codigo velho de cache
//    quebra a compatibilidade entre dois jogadores em versoes diferentes —
//    o pior tipo de bug, porque so aparece na partida.
//  - Icones e o PeerJS (que tem versao no nome): cache primeiro, sao estaveis.
//
// Trocar CACHE_NAME a cada versao publicada: o activate limpa os antigos.

const CACHE_NAME = 'doce-duelo-v4';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './vendor/peerjs.min.js',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './src/main.js',
  './src/storage.js',
  './src/core/rng.js',
  './src/core/board.js',
  './src/render/renderer.js',
  './src/render/gems.js',
  './src/render/backdrop.js',
  './src/render/icons.js',
  './src/render/particles.js',
  './src/audio/audio.js',
  './src/game/session.js',
  './src/game/bot.js',
  './src/game/balance.js',
  './src/game/pressure.js',
  './src/game/attack.js',
  './src/game/match.js',
  './src/game/replay.js',
  './src/game/rating.js',
  './src/game/ranks.js',
  './src/net/peer.js',
  './src/net/leaderboard.js',
  './src/leaderboard-config.js',
];

const CACHE_FIRST = /\.(png|svg|jpg|jpeg|webp|woff2?)$|vendor\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll falha inteiro se UM arquivo faltar, deixando o app sem cache
      // nenhum. Adicionar um a um mantem o que deu certo.
      .then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Nunca interceptar sinalizacao do PeerJS nem STUN/TURN.
  if (url.origin !== self.location.origin) return;

  if (CACHE_FIRST.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetchAndCache(request))
    );
    return;
  }

  event.respondWith(
    fetchAndCache(request).catch(() =>
      caches.match(request).then((hit) => hit || caches.match('./index.html'))
    )
  );
});

function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}
