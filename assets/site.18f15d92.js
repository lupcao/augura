(function () {
"use strict";
// Shared randomness helpers for augura.fyi. Every result comes from crypto.getRandomValues, without modulo bias.
function randInt(n) {            // uniform integer in [0, n), no modulo bias
  if (!(Number.isInteger(n) && n >= 1 && n <= 4294967296)) throw new RangeError("randInt: n must be an integer in [1, 2^32]");
  var limit = Math.floor(4294967296 / n) * n, buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}
function randRange(min, max) { return min + randInt(max - min + 1); }          // caller guarantees max-min+1 <= 2^32
function pick(a) { return a[randInt(a.length)]; }
function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = randInt(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }  // Fisher-Yates
function weighted(items, w) { var total = 0, i; for (i = 0; i < items.length; i++) total += w(items[i]);
  var r = randInt(total); for (i = 0; i < items.length; i++) { r -= w(items[i]); if (r < 0) return items[i]; } }
function $(id) { return document.getElementById(id); }

// Browser language tag -> site language code (only published languages count). Never redirects.
var SITE_LANGS = ["en","de","fr","it","es","pt-BR","nl","sv","pl","tr","ru","ja","ko","zh-Hans","zh-Hant"];
function mapLang(tag) {
  tag = String(tag || "").toLowerCase();
  var code = null;
  if (tag.indexOf("pt") === 0) code = "pt-BR";
  else if (tag.indexOf("zh") === 0) code = (/^zh-(tw|hk|mo)\b/.test(tag) || tag.indexOf("hant") >= 0) ? "zh-Hant" : "zh-Hans";
  else {
    var p = tag.split("-")[0];
    for (var i = 0; i < SITE_LANGS.length; i++) if (SITE_LANGS[i].toLowerCase() === p) code = SITE_LANGS[i];
  }
  return code && SITE_LANGS.indexOf(code) >= 0 ? code : null;
}
function preferredLang() {
  var tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (var i = 0; i < tags.length; i++) { var c = mapLang(tags[i]); if (c) return c; }
  return null;
}

// Site chrome: language switcher, language suggestion banner, service worker, home page coin and strip.
// Nothing is sent anywhere. Browser storage: augura.ui.v1 is written only when the visitor clicks a choice (a
// language, closing the banner or the app nudge); the web app's history (augura.webapp.v1) only after "Keep history
// on this device" is turned on. The offline cache is used only by the web app and the generator pages.
var UI_KEY = "augura.ui.v1";
var BANNER = {"de":["Diese Seite gibt es auch auf Deutsch.","Auf Deutsch lesen","Schließen"],"en":["This page is also available in English.","Read in English","Close"],"es":["Esta página también está disponible en español.","Leer en español","Cerrar"],"fr":["Cette page existe aussi en français.","Lire en français","Fermer"],"it":["Questa pagina è disponibile anche in italiano.","Leggi in italiano","Chiudi"],"ja":["このページは日本語でも読めます。","日本語で読む","閉じる"],"ko":["이 페이지는 한국어로도 볼 수 있어요.","한국어로 보기","닫기"],"nl":["Deze pagina is er ook in het Nederlands.","Lees in het Nederlands","Sluiten"],"pl":["Ta strona jest dostępna także po polsku.","Czytaj po polsku","Zamknij"],"pt-BR":["Esta página também está disponível em português.","Ler em português","Fechar"],"ru":["Эта страница есть и на русском.","Читать по-русски","Закрыть"],"sv":["Den här sidan finns även på svenska.","Läs på svenska","Stäng"],"tr":["Bu sayfa Türkçe olarak da mevcut.","Türkçe oku","Kapat"],"zh-Hans":["本页面也提供简体中文版。","阅读简体中文版","关闭"],"zh-Hant":["本頁面也提供繁體中文版。","閱讀繁體中文版","關閉"]};
function uiGet() { try { var v = JSON.parse(localStorage.getItem(UI_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
function uiSet(patch) {
  try { var v = uiGet(); for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) v[k] = patch[k];
    localStorage.setItem(UI_KEY, JSON.stringify(v)); } catch (e) { /* storage off: fine */ }
}
var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
var page = document.body.getAttribute("data-page") || "";

// ---------- language switchers (work without JS; this adds closing and remembers a choice)
var switchers = document.querySelectorAll("details.lang");
function closeSwitchers(except) { for (var i = 0; i < switchers.length; i++) if (switchers[i] !== except) switchers[i].open = false; }
document.addEventListener("click", function (e) {
  var d = e.target.closest ? e.target.closest("details.lang") : null;
  closeSwitchers(d);
  var a = e.target.closest ? e.target.closest("a[data-lang]") : null;
  if (a) uiSet({ lang: a.getAttribute("data-lang") });
});
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  for (var i = 0; i < switchers.length; i++) if (switchers[i].open) { switchers[i].open = false; switchers[i].querySelector("summary").focus(); }
});

// ---------- "This page is also available in ..." banner
(function () {
  if (page === "r" || page === "404") return;
  var ui = uiGet();
  if (ui.langBanner === "dismissed" || ui.lang) return;
  var want = preferredLang(), here = document.documentElement.lang;
  if (!want || want === here || !BANNER[want]) return;
  var alt = document.querySelector('link[rel="alternate"][hreflang="' + want + '"]');
  var box = $("lbanner");
  if (!alt || !box) return;
  var s = BANNER[want];
  var p = box.querySelector("p"), a = box.querySelector("a"), x = box.querySelector("button");
  p.textContent = s[0]; p.setAttribute("lang", want);
  a.textContent = s[1]; a.setAttribute("lang", want); a.setAttribute("hreflang", want);
  a.href = new URL(alt.getAttribute("href")).pathname;
  a.addEventListener("click", function () { uiSet({ lang: want }); });
  x.setAttribute("aria-label", s[2]);
  x.addEventListener("click", function () { box.hidden = true; uiSet({ langBanner: "dismissed" }); });
  box.hidden = false;
})();

// ---------- offline support: only the web app and the generator pages (never from file://)
if ("serviceWorker" in navigator && (page === "app" || page === "landing") &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {});
}

// ---------- home: the little coin
(function () {
  var go = $("mini-go"), disc = $("mini-coin"), out = $("mini-out");
  if (!go || !disc || !out) return;
  var use = disc.querySelector("use"), busy = false;
  go.hidden = false;
  go.addEventListener("click", function () {
    if (busy) return;
    var heads = randInt(2) === 0;                       // drawn first; the animation only reveals it
    var word = go.getAttribute(heads ? "data-heads" : "data-tails");
    function show() { use.setAttribute("href", heads ? "#e-heads" : "#e-tails"); out.textContent = word; busy = false; go.removeAttribute("aria-disabled"); }
    if (reduceMotion) { show(); return; }
    busy = true; go.setAttribute("aria-disabled", "true"); out.textContent = "";
    disc.classList.remove("spin"); void disc.offsetWidth; disc.classList.add("spin");
    setTimeout(show, 600);
  });
})();

// ---------- home: screenshot strip arrows (desktop; touch and trackpads scroll natively)
(function () {
  var strip = $("strip"), prev = $("strip-prev"), next = $("strip-next");
  if (!strip || !prev || !next) return;
  function step() { var li = strip.querySelector("li"); if (!li) return strip.clientWidth; var gap = parseFloat(getComputedStyle(strip).columnGap) || 18; return 3 * (li.getBoundingClientRect().width + gap); }
  function update() { prev.disabled = strip.scrollLeft <= 2; next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2; }
  prev.addEventListener("click", function () { strip.scrollBy({ left: -step(), behavior: reduceMotion ? "auto" : "smooth" }); });
  next.addEventListener("click", function () { strip.scrollBy({ left: step(), behavior: reduceMotion ? "auto" : "smooth" }); });
  strip.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
})();

})();
