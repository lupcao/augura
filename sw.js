// Augura offline support for the web app and the generator pages. Same-origin only; /verify/, /press/ and range
// requests are never touched. Only the files listed in CORE and the page's precache list are stored (no runtime
// caching), so the cache holds the web app's own files and nothing else the visitor opens.
var VERSION = "augura-4a599f69318e";
var CORE = ["/assets/app.37195aea.js","/assets/app.da288156.css","/assets/site.18f15d92.js","/assets/site.3f80ce0b.css","/tools.js","/favicon.ico","/img/icon-64.png","/img/icon-128.png","/img/icon-192.png","/img/icon-512.png","/img/stars-a.svg","/img/stars-b.svg","/app.html","/r/","/r/r.js","/img/badges/de.svg","/img/badges/en.svg","/img/badges/es.svg","/img/badges/fr.svg","/img/badges/it.svg","/img/badges/ja.svg","/img/badges/ko.svg","/img/badges/nl.svg","/img/badges/pl.svg","/img/badges/pt-BR.svg","/img/badges/ru.svg","/img/badges/sv.svg","/img/badges/tr.svg","/img/badges/zh-Hans.svg","/img/badges/zh-Hant.svg"];
var LANG_PREFIXES = ["de/","fr/","it/","es/","pt-br/","nl/","sv/","pl/","tr/","ru/","ja/","ko/","zh-hans/","zh-hant/"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("augura-") === 0 && k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function allowed(path) { return typeof path === "string" && path.charAt(0) === "/" && path.charAt(1) !== "/" && path.indexOf("/verify/") !== 0; }

self.addEventListener("message", function (e) {
  var d = e.data;
  if (!d || d.type !== "precache" || !Array.isArray(d.urls)) return;
  var urls = d.urls.filter(allowed).slice(0, 64);
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(urls.map(function (u) {   // only what is not cached yet, fetched past the HTTP cache
      return c.match(u).then(function (hit) { return hit || c.add(new Request(u, { cache: "reload" })); }).catch(function () {});
    }));
  }));
});

function langApp(path) {
  for (var i = 0; i < LANG_PREFIXES.length; i++) {
    var p = LANG_PREFIXES[i];
    if (p && path.indexOf("/" + p) === 0) return "/" + p + "app.html";
  }
  return "/app.html";
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf("/verify/") === 0 || url.pathname.indexOf("/press/") === 0) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (r) {
        return r || caches.match(langApp(url.pathname)).then(function (r2) { return r2 || caches.match("/app.html"); });
      });
    }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
});
