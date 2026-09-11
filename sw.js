// Service worker mínimo: existe SOLO para que Chrome/Android considere la
// app "instalable" (beforeinstallprompt exige un service worker registrado
// con un listener de fetch). No cachea nada a propósito — cada deploy nuevo
// pasa por el pipeline de build a gh-pages, y un service worker con caché
// serviría versiones viejas de index.html hasta que alguien lo purgara a
// mano. Todo pasa directo a la red, como si no existiera.
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
