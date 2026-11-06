/* オフラインでも開けるようにする。更新したら VERSION を上げる */
var VERSION = 'v11';
var SHELL = 'shell-' + VERSION;
var FONTS = 'fonts-v1';
var FILES = [
  './',
  './index.html',
  './style.css',
  './logic.js',
  './sound.js',
  './fx.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== FONTS; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // フォント：一度とったら端末に置いておく
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        });
      });
    }));
    return;
  }

  // アプリ本体：端末のものをすぐ出し、裏で新しいものに入れかえる
  if (url.origin === self.location.origin) {
    var isPage = req.mode === 'navigate' &&
      (/\/$/.test(url.pathname) || /\/index\.html$/.test(url.pathname));
    var key = isPage ? './index.html' : req;
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(key, { ignoreSearch: isPage }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res.ok) c.put(key, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
  // それ以外（Apps Script など）はそのまま通す
});
