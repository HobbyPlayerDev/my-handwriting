/* my-handwriting - service worker: makes the app work offline after the first visit (only over http/https,
 * e.g. GitHub Pages). Network first, so a new version is used as soon as it is online; the cache is the
 * fallback when offline. Bump VERSION when files are added. */
var VERSION = 'my-handwriting-v1.5.1';
var FILES = ['./', 'index.html', 'css/app.css', 'js/i18n.js', 'js/lang/en.js', 'js/lang/de.js', 'js/lang/fr.js', 'js/lang/es.js',
             'js/lang/it.js', 'js/lang/pl.js', 'js/charsets.js', 'js/fallback-font.js', 'js/render.js', 'js/zip.js', 'js/ui-select.js', 'js/skill-bundle.js', 'js/app.js', 'icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
             'manifest.webmanifest'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(e.request, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
  }));
});
