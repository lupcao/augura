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

// Pure helpers (no DOM), also loaded by site-src/dev/rand-test.html.
var SHARE_BASE = "https://augura.fyi/r/#";
// Same characters as the app's encoder for ASCII (alphanumerics and -._~ stay, everything else is %XX).
function enc(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
}
function fmt(s, values) {
  return String(s).replace(/\{([a-z_][a-z0-9_]*)\}/g, function (m, k) {
    return Object.prototype.hasOwnProperty.call(values, k) ? String(values[k]) : m;
  });
}
function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
// I Ching: r in [0, 16) through the method's counts for 6, 7, 8 and 9 (coins 2/6/6/2, yarrow 1/5/7/3).
function ichingValue(r, counts) {
  var acc = 0;
  for (var i = 0; i < 4; i++) { acc += counts[i]; if (r < acc) return 6 + i; }
  throw new RangeError("ichingValue: counts must add up to more than r");
}
// lines: bottom line first, "1" = yang (7, 9). Returns the relating lines (6 -> yang, 9 -> yin).
function ichingLines(values) {
  var lines = "", moved = "", changing = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i], yang = v === 7 || v === 9;
    lines += yang ? "1" : "0";
    moved += v === 6 ? "1" : v === 9 ? "0" : (yang ? "1" : "0");
    if (v === 6 || v === 9) changing.push(i + 1);
  }
  return { lines: lines, moved: moved, changing: changing };
}
function hexByLines(hexes, lines) { for (var i = 0; i < hexes.length; i++) if (hexes[i][2] === lines) return hexes[i]; return null; }
// Deal shuffled names round-robin into k teams: sizes differ by at most one.
function deal(names, k) {
  var teams = [], i;
  for (i = 0; i < k; i++) teams.push([]);
  for (i = 0; i < names.length; i++) teams[i % k].push(names[i]);
  return teams;
}
// Contrast ratio helpers (WCAG) for the label on a random color.
function luminance(r, g, b) {
  var c = [r, g, b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(l1, l2) { var a = Math.max(l1, l2), b = Math.min(l1, l2); return (a + 0.05) / (b + 0.05); }
// "YYYY-MM-DD" -> UTC milliseconds, or NaN.
function utcDay(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return NaN;
  var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : NaN;
}
function isoDay(d) { function p(n) { return (n < 10 ? "0" : "") + n; } return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }

// Core of the web app: strings, data, results, history, sharing. Text only ever goes in with textContent.
var MAIN = document.getElementById("main");
var I18N = JSON.parse(document.getElementById("i18n").textContent);
var S = I18N.s, LANG = I18N.lang, P = I18N.prefix;
var FIXED = MAIN.getAttribute("data-fixed") || "";
var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
var GEN = {};
var DATA = null, dataWaiting = [];
var state = { current: "", busy: false, last: null, count: 0, nudged: false, keep: false, history: [], storage: true };
var HKEY = "augura.webapp.v1", UI_KEY = "augura.ui.v1";

function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function svgEl(tag, attrs) { var e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]); return e; }
function icon(id, cls) { var s = svgEl("svg", { "class": cls || "ic", "aria-hidden": "true" }); s.appendChild(svgEl("use", { href: "#" + id })); return s; }
function tile(id) { var t = el("span", "tile m-" + id); t.appendChild(icon("g-" + id)); return t; }
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function g$(id, part) { return document.getElementById("g-" + id + "-" + part); }
function later(fn, ms) { return setTimeout(fn, reduceMotion ? 0 : ms); }
function replay(node, cls) { if (reduceMotion || !node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
var NF = new Intl.NumberFormat(LANG);

// ---------- segmented controls: <div class="seg"> with <button data-v aria-pressed>
function segValue(seg) { var b = seg.querySelector('[aria-pressed="true"]'); return b ? b.getAttribute("data-v") : null; }
function segSet(seg, v) { var bs = seg.querySelectorAll("button"); for (var i = 0; i < bs.length; i++) bs[i].setAttribute("aria-pressed", String(bs[i].getAttribute("data-v") === String(v))); }
function segWire(seg, onChange) {
  seg.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || state.busy) return;
    segSet(seg, b.getAttribute("data-v")); onChange(b.getAttribute("data-v")); savePrefs();
  });
}

// ---------- data (letters, card decks, oracles), fetched once when a route needs it
// Only a failed request or unreadable JSON shows the offline text; the callbacks run outside the promise
// chain, so an error in a generator can never be mistaken for "no connection" (or swallow a queued draw).
function needData(cb) {
  if (DATA) { cb(); return; }
  dataWaiting.push(cb);
  if (dataWaiting.length > 1) return;
  setGoLabel(S.loading);
  fetch(MAIN.getAttribute("data-src"), { credentials: "same-origin" }).then(function (r) {
    if (!r.ok) throw new Error(String(r.status)); return r.json();
  }).then(function (d) {
    if (!d || d.v !== 1) throw new Error("data");
    setTimeout(function () { dataArrived(d); }, 0);
  }).catch(function () { dataWaiting = []; updateGo(); showError(state.current, S.offline); });
}
function dataArrived(d) {
  DATA = d; var w = dataWaiting; dataWaiting = []; updateGo();
  for (var k in GEN) if (inited[k] && GEN[k].dataReady) GEN[k].dataReady();   // the others check their state in init/restore
  w.forEach(function (f) { f(); });
}

// ---------- meaning links (§8.5): this language's page if it exists, otherwise the English one
function meaningLink(file, hasPage) {
  var a = el("a");
  if (hasPage) a.href = "/" + P + "meanings/" + file;
  else { a.href = "/meanings/" + file; a.hreflang = "en"; }
  a.textContent = S.read_meaning + (hasPage ? "" : S.join_space + S.english_only);
  return a;
}

// ---------- results
function showResult(id, res) {
  var out = g$(id, "out"), det = g$(id, "detail");
  out.textContent = res.main;
  var n = String(res.main).length;
  out.classList.toggle("long", n > 12 && n <= 40);
  out.classList.toggle("xlong", n > 40);
  clear(det); det.classList.remove("res-err");
  if (res.build) res.build(det);
  else if (res.detail) det.textContent = res.detail;
  bringIntoView(out);
}
// Phones: the fixed button bar (and the sticky header above) must never hide the answer just drawn.
function bringIntoView(node) {
  var bar = document.querySelector(".actions");
  if (!node || !bar || getComputedStyle(bar).position !== "fixed") return;
  var r = node.getBoundingClientRect(), top = 0, bottom = Math.min(window.innerHeight, bar.getBoundingClientRect().top);
  Array.prototype.forEach.call(document.querySelectorAll(".top, .chiprail"), function (s) {
    if (getComputedStyle(s).position === "sticky") top = Math.max(top, s.getBoundingClientRect().bottom);
  });
  if (r.bottom + 24 > bottom || r.top < top) {             // + the first line of the detail under it
    node.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }
}
function showError(id, msg) {
  if (!id) return;
  var out = g$(id, "out"), det = g$(id, "detail");
  out.textContent = ""; clear(det); det.textContent = msg; det.classList.add("res-err");
}
function clearResult(id) { var out = g$(id, "out"), det = g$(id, "detail"); out.textContent = ""; clear(det); det.classList.remove("res-err"); }

// ---------- primary button
var GO = document.getElementById("act-go");
function setGoLabel(text) { document.getElementById("act-go-label").textContent = text; }
function updateGo() {
  var id = state.current;
  setGoLabel(id ? I18N.verbs[id] : "");
  document.getElementById("act-go-use").setAttribute("href", "#g-" + (id || "dice"));
  GO.disabled = !id;
}
function setBusy(b) { state.busy = b; if (b) GO.setAttribute("aria-disabled", "true"); else GO.removeAttribute("aria-disabled"); }

function run() {
  var id = state.current, g = GEN[id];
  if (!id || !g || state.busy) return;
  if (g.needsData && !DATA) { needData(run); return; }
  var res = g.draw();                                   // the result is drawn first ...
  if (!res) return;
  if (res.error) { showError(id, res.error); return; }
  setBusy(true); clearResult(id);
  var finish = function () {                            // ... and the animation only reveals it
    showResult(id, res); record(id, res); setBusy(false);
  };
  if (g.reveal) g.reveal(res, finish, reduceMotion); else finish();
}

// ---------- history (memory by default; kept in this browser only if the visitor turns it on)
// Reading only: nothing is written until the visitor turns "Keep history" on (setKeep checks that the write works).
function storageOk() { try { localStorage.getItem(HKEY); return true; } catch (e) { return false; } }
function record(id, res) {
  state.last = { id: id, res: res, q: questionOf(id) };
  state.history.unshift({ m: id, r: cut(res.main, 200), d: cut(res.hist != null ? res.hist : (res.detail || ""), 300), t: Date.now() });
  if (state.history.length > 200) state.history.length = 200;
  if (GEN[id].tally) GEN[id].tally(res);
  renderHistory(); persist();
  state.count++;
  if (state.count === 3) maybeNudge(id);
}
function questionOf(id) { var q = g$(id, "q"); return q ? q.value.trim().slice(0, 140) : ""; }
function renderHistory() {
  var list = document.getElementById("hist-list"), empty = document.getElementById("hist-empty");
  if (!list) return;
  clear(list);
  var today = new Date().toDateString();
  var tf = new Intl.DateTimeFormat(LANG, { timeStyle: "short" }), df = new Intl.DateTimeFormat(LANG, { dateStyle: "medium" });
  state.history.slice(0, 50).forEach(function (e) {
    if (!I18N.names[e.m]) return;
    var li = el("li"), mid = el("div"), d = new Date(e.t);
    li.appendChild(tile(e.m));
    mid.appendChild(el("b", null, e.r));
    mid.appendChild(el("small", null, I18N.names[e.m] + (e.d ? " · " + e.d : "")));
    li.appendChild(mid);
    var time = el("time", null, (d.toDateString() === today ? "" : df.format(d) + " ") + tf.format(d));
    time.dateTime = d.toISOString(); li.appendChild(time);
    list.appendChild(li);
  });
  empty.hidden = state.history.length > 0;
  document.getElementById("hist-clear").hidden = state.history.length === 0;
}
function prefsAll() {   // generators not opened yet keep the preferences stored earlier
  var p = {}, old = (kept && kept.prefs) || {};
  for (var k in GEN) {
    if (inited[k] && GEN[k].prefs) p[k] = GEN[k].prefs();
    else if (old[k]) p[k] = old[k];
  }
  return p;
}
function persist() {
  if (!state.keep) return true;
  try { localStorage.setItem(HKEY, JSON.stringify({ v: 1, history: state.history, prefs: prefsAll() })); return true; } catch (e) { return false; }
}
function savePrefs() { persist(); }
function loadKept() {
  try {
    var raw = localStorage.getItem(HKEY); if (!raw) return null;
    var d = JSON.parse(raw); return d && d.v === 1 ? d : null;
  } catch (e) { return null; }
}
function setKeep(on) {
  state.keep = on;
  var sw = document.getElementById("keep"), note = document.getElementById("keep-note");
  if (on && !persist()) {                               // storage blocked or full: stay off and say so
    state.keep = false; on = false;
    if (sw) sw.disabled = true;
    if (note) note.textContent = S.storage_off;
  } else if (note) note.textContent = on ? S.keep_on : S.keep_off;
  if (sw) sw.setAttribute("aria-checked", String(on));
  if (!on) { try { if (localStorage.getItem(HKEY) !== null) localStorage.removeItem(HKEY); } catch (e) { /* ignore */ } }
}

// ---------- the "Get the app" card after the third result (never modal, at most once per session)
function uiGet() { try { var v = JSON.parse(localStorage.getItem(UI_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
function uiSet(patch) { try { var v = uiGet(); for (var k in patch) v[k] = patch[k]; localStorage.setItem(UI_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } }
function maybeNudge(id) {
  var box = document.getElementById("nudge");
  if (!box || state.nudged) return;
  var until = uiGet().nudgeUntil || 0;
  if (until > Date.now()) return;
  state.nudged = true;
  document.getElementById("nudge-text").textContent = S.nudge[id] || S.nudge["default"];
  box.hidden = false;
}

// ---------- share and copy
function toast(msg) {
  var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.classList.remove("on"); }, 1800);
}
function shareData() {
  var last = state.last;
  if (!last || last.id !== state.current) {
    var id = state.current || "";
    return { title: "Augura", text: (I18N.names[id] || "Augura"), url: "https://augura.fyi/" + P + "app.html" + (id ? "#" + id : "") };
  }
  var res = last.res, q = last.q, name = I18N.names[last.id];
  var url = last.id === "list" && res.items ? SHARE_BASE + "list/" + res.items.map(enc).join(",")
    : SHARE_BASE + last.id + "/" + enc(res.headline || res.main) + (q ? "/" + enc(q) : "");
  var verb = I18N.shareVerb[last.id] || fmt(S.share_used, { name: name });
  var head = res.headline || res.main;
  var text = (q ? fmt(S.share_question, { verb: verb, question: q, result: head }) : fmt(S.share_plain, { verb: verb, result: head })) + " " + S.share_from;
  return { title: "Augura", text: text, url: url };
}
function share() {
  var d = shareData();
  if (navigator.share) {
    navigator.share(d).catch(function (e) { if (e && e.name !== "AbortError") fallbackCopy(d.url); });
    return;
  }
  fallbackCopy(d.url);
}
function fallbackCopy(url) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () { toast(S.link_copied); }, function () { showLinkBox(url); });
  } else showLinkBox(url);
}
function showLinkBox(url) {
  var box = document.getElementById("linkbox"), inp = document.getElementById("linkbox-url");
  if (!box || !inp) return;
  inp.value = url; box.hidden = false; inp.focus(); inp.select();
}
function copyResult() {
  var last = state.last; if (!last) return;
  var det = last.res.copy != null ? last.res.copy : (last.res.detail || "");
  var text = last.res.main + (det ? " — " + det : "");
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(S.copied); }, function () { showLinkBox(text); });
  else showLinkBox(text);
}

// Decide generators: coin, dice, yes or no, number, list, letter, card, rock-paper-scissors, color, date, teams.

// ---------- coin
GEN.coin = (function () {
  var seg, box, coins, rots = [0, 0, 0], tally = { h: 0, t: 0 };
  function n() { return +segValue(seg) || 1; }
  function layout() {
    var k = n(); box.className = "coins n" + k;
    for (var i = 0; i < coins.length; i++) coins[i].hidden = i >= k;
  }
  function showTally() { g$("coin", "tally").textContent = tally.h + tally.t ? fmt(S.coin_tally, { heads: S.heads, h: tally.h, tails: S.tails, t: tally.t }) : ""; }
  return {
    init: function () { seg = g$("coin", "n"); box = g$("coin", "coins"); coins = box.querySelectorAll(".coin3d"); segWire(seg, layout); layout(); },
    draw: function () {
      var faces = [], k = n();
      for (var i = 0; i < k; i++) faces.push(randInt(2) === 0);
      var words = faces.map(function (h) { return h ? S.heads : S.tails; });
      return { faces: faces, main: words.join(" · "), headline: words.join(" · ") };
    },
    reveal: function (res, done, instant) {
      res.faces.forEach(function (heads, i) {
        var base = Math.floor(rots[i] / 360) * 360 + (instant ? 360 : 360 * 5);
        rots[i] = base + (heads ? 0 : 180);
        coins[i].style.setProperty("--rot", rots[i] + "deg");
      });
      if (instant) done(); else later(done, 1000);
    },
    tally: function (res) { res.faces.forEach(function (h) { if (h) tally.h++; else tally.t++; }); showTally(); },
    reset: function () { tally = { h: 0, t: 0 }; showTally(); },
    prefs: function () { return { n: n() }; },
    restore: function (p) { if (p && p.n >= 1 && p.n <= 3) { segSet(seg, p.n); layout(); } }
  };
})();

// ---------- dice
GEN.dice = (function () {
  var count = 2, sides = 6, rolls = 0, box, out;
  var PIPS = { 1: ["mc"], 2: ["tl", "br"], 3: ["tl", "mc", "br"], 4: ["tl", "tr", "bl", "br"], 5: ["tl", "tr", "mc", "bl", "br"], 6: ["tl", "tr", "ml", "mr", "bl", "br"] };
  var FACE = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };
  var TILTS = [[-22, 30, 3], [-26, -26, -5], [-18, 22, 6], [-28, -32, -2], [-20, 36, 4], [-24, -20, -6]];
  function pips(node, v) { PIPS[v].forEach(function (p) { node.appendChild(el("i", "p " + p)); }); }
  function cube(i) {
    var d = el("div", "die" + (i % 2 ? " blue" : ""));
    ["c1", "c2", "c3"].forEach(function (c) { d.appendChild(el("span", "core " + c)); });
    for (var v = 1; v <= 6; v++) { var f = el("span", "f f" + v); pips(f, v); d.appendChild(f); }
    d._spin = 0; setCube(d, i, 6);
    return d;
  }
  function setCube(d, i, v) {
    var t = TILTS[i % TILTS.length], r = FACE[v];
    d.style.setProperty("--rx", t[0] + "deg"); d.style.setProperty("--ry", t[1] + "deg"); d.style.setProperty("--rz", t[2] + "deg");
    d.style.setProperty("--fx", (r[0] + d._spin * 360) + "deg"); d.style.setProperty("--fy", (r[1] + d._spin * 360) + "deg");
  }
  function mode() { return sides === 6 ? (count <= 6 ? "cube" : "flat") : "gem"; }
  function build(vals) {
    clear(box);
    var m = mode(), row;
    if (m === "cube") {
      row = el("div", "dice-row" + (count > 3 ? " many" : ""));
      for (var i = 0; i < count; i++) { var h = el("div", "die-hold"); h.appendChild(cube(i)); row.appendChild(h); }
    } else {
      row = el("div", m === "gem" && count <= 6 ? "gems" : "flat");
      for (var j = 0; j < count; j++) {
        var v = vals ? vals[j] : null, node;
        if (m === "flat") { node = el("div", "pipt"); pips(node, v || 6); }
        else { node = el("div", "gem", v == null ? "?" : String(v)); if (count <= 6) node.appendChild(el("small", null, "d" + sides)); }
        row.appendChild(node);
      }
    }
    box.appendChild(row);
  }
  function showCount() { out.textContent = String(count); }
  function showTally() { g$("dice", "tally").textContent = rolls ? fmt(S.dice_rolls, { n: rolls }) : ""; }
  return {
    init: function () {
      box = g$("dice", "box"); out = g$("dice", "n");
      g$("dice", "minus").addEventListener("click", function () { if (state.busy) return; count = Math.max(1, count - 1); showCount(); build(); savePrefs(); });
      g$("dice", "plus").addEventListener("click", function () { if (state.busy) return; count = Math.min(20, count + 1); showCount(); build(); savePrefs(); });
      segWire(g$("dice", "s"), function (v) { sides = +v; build(); });
      showCount(); build();
    },
    draw: function () {
      var vals = [], sum = 0;
      for (var i = 0; i < count; i++) { var v = randInt(sides) + 1; vals.push(v); sum += v; }
      return { vals: vals, main: String(sum), detail: count > 1 ? vals.join(" + ") + " = " + sum : "",
        headline: count > 1 ? sum + " (" + vals.join(" + ") + ")" : String(sum), hist: count + "d" + sides };
    },
    reveal: function (res, done, instant) {
      if (mode() === "cube") {
        var dice = box.querySelectorAll(".die");
        for (var i = 0; i < dice.length; i++) {
          dice[i]._spin += instant ? 0 : 1; setCube(dice[i], i, res.vals[i]);
          if (!instant) replay(dice[i].parentNode, "toss");
        }
        if (instant) done(); else later(done, 950);
      } else {
        build(res.vals);
        if (!instant) replay(box.firstChild, "pop");
        if (instant) done(); else later(done, 380);
      }
    },
    tally: function () { rolls++; showTally(); },
    reset: function () { rolls = 0; showTally(); },
    prefs: function () { return { n: count, s: sides }; },
    restore: function (p) {
      if (!p) return;
      if (p.n >= 1 && p.n <= 20) count = p.n;
      if ([4, 6, 8, 10, 12, 20, 100].indexOf(p.s) >= 0) { sides = p.s; segSet(g$("dice", "s"), sides); }
      showCount(); build();
    }
  };
})();

// ---------- yes or no
GEN.yesNo = (function () {
  var orb;
  return {
    init: function () { orb = g$("yesNo", "orb"); },
    draw: function () { var w = randInt(2) === 0 ? S.yes : S.no; return { main: w, headline: w }; },
    reveal: function (res, done, instant) {
      if (instant) { orb.textContent = res.main; done(); return; }
      orb.textContent = "?"; replay(orb, "pop");
      later(function () { orb.textContent = res.main; replay(orb, "pop"); done(); }, 520);
    }
  };
})();

// ---------- number
GEN.number = (function () {
  var from, to, orb;
  function parse(v) { v = String(v).trim().replace(/−/g, "-"); return /^-?\d+$/.test(v) ? Number(v) : NaN; }
  return {
    init: function () {
      from = g$("number", "from"); to = g$("number", "to"); orb = g$("number", "orb");
      from.addEventListener("change", savePrefs); to.addEventListener("change", savePrefs);
    },
    draw: function () {
      var a = parse(from.value), b = parse(to.value);
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return { error: S.need_numbers };
      if (a > b) { var t = a; a = b; b = t; }
      if (b - a + 1 > 4294967296) return { error: fmt(S.range_too_large, { max: NF.format(4294967296) }) };
      var v = a + randInt(b - a + 1), shown = NF.format(v);
      return { value: v, main: shown, headline: shown, hist: NF.format(a) + " – " + NF.format(b) };
    },
    reveal: function (res, done, instant) {
      orb.textContent = res.main; orb.classList.toggle("small-text", res.main.length > 5);
      if (!instant) replay(orb, "pop");
      if (instant) done(); else later(done, 380);
    },
    prefs: function () { return { a: from.value, b: to.value }; },
    restore: function (p) { if (p) { if (typeof p.a === "string") from.value = p.a.slice(0, 20); if (typeof p.b === "string") to.value = p.b.slice(0, 20); } }
  };
})();

// ---------- list (decision wheel, drawn as SVG)
GEN.list = (function () {
  var ta, rot, angle = 0, items = [], timer;
  var C = 160, R = 150;
  function options() {
    return ta.value.split("\n").map(function (s) { return s.trim().slice(0, 80); }).filter(Boolean).slice(0, 100);
  }
  function pt(a, r) { var rad = a * Math.PI / 180; return [(C + r * Math.sin(rad)).toFixed(2), (C - r * Math.cos(rad)).toFixed(2)]; }
  function wheel() {
    items = options(); clear(rot);
    var k = Math.max(items.length, 1), step = 360 / k;
    for (var i = 0; i < k; i++) {
      var a0 = i * step, a1 = (i + 1) * step, p0 = pt(a0, R), p1 = pt(a1, R);
      var fill = i % 2 ? "#0A6BA8" : "#4CC9F0";
      if (k % 2 && i === k - 1 && k > 1) fill = "#2B93C9";
      var d = k === 1 ? "M" + C + "," + (C - R) + " A" + R + "," + R + " 0 1 1 " + (C - 0.01) + "," + (C - R) + " Z"
        : "M" + C + "," + C + " L" + p0[0] + "," + p0[1] + " A" + R + "," + R + " 0 " + (step > 180 ? 1 : 0) + " 1 " + p1[0] + "," + p1[1] + " Z";
      rot.appendChild(svgEl("path", { d: d, fill: fill, stroke: "rgba(3,5,11,.35)", "stroke-width": "1" }));
      if (items[i]) {
        var mid = a0 + step / 2, label = items[i].length > 18 ? items[i].slice(0, 17) + "…" : items[i];
        var t = svgEl("text", { x: String(C + R - 14), y: String(C + 4.5), "text-anchor": "end", transform: "rotate(" + (mid - 90).toFixed(3) + " " + C + " " + C + ")" });
        if (k > 12) t.setAttribute("font-size", k > 24 ? "8" : "10");
        t.textContent = label; rot.appendChild(t);
      }
    }
    rot.appendChild(svgEl("circle", { cx: String(C), cy: String(C), r: "16", fill: "#03050b", stroke: "rgba(255,255,255,.5)", "stroke-width": "2" }));
  }
  return {
    init: function () {
      ta = g$("list", "items"); rot = g$("list", "rot");
      ta.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { if (!state.busy) { wheel(); savePrefs(); } }, 200); });
      wheel();
    },
    draw: function () {
      var opts = options();
      if (opts.length < 2) return { error: S.list_need_two };
      if (opts.join("\n") !== items.join("\n")) wheel();
      var k = opts.length, win = randInt(k), turns = 4 + randInt(3), step = 360 / k, centre = (win + 0.5) * step;
      var target = angle + turns * 360 + ((((-centre - angle) % 360) + 360) % 360);
      return { win: win, target: target, items: opts, main: opts[win], headline: opts[win], hist: "" };
    },
    reveal: function (res, done, instant) {
      angle = res.target;
      rot.classList.toggle("spin", !instant);
      rot.style.setProperty("--rot", angle + "deg");
      if (instant) done(); else later(done, 3200);
    },
    prefs: function () { return { text: ta.value.slice(0, 9000) }; },
    restore: function (p) { if (p && typeof p.text === "string") { ta.value = p.text; wheel(); } }
  };
})();

// ---------- letter
GEN.letter = (function () {
  var sel, glyph;
  function alphabet() { var id = sel.value; for (var i = 0; i < DATA.letters.length; i++) if (DATA.letters[i].id === id) return DATA.letters[i]; return DATA.letters[0]; }
  return {
    needsData: true,
    init: function () { sel = g$("letter", "set"); glyph = g$("letter", "glyph"); sel.addEventListener("change", savePrefs); },
    draw: function () {
      var a = alphabet(), it = pick(a.items), ch = it[0], name = it[1];
      var detail = name && name !== ch && name.toLowerCase() !== ch.toLowerCase() ? name : "";
      return { main: ch, headline: ch, detail: detail, hist: a.name };
    },
    reveal: function (res, done, instant) {
      glyph.textContent = res.main; glyph.classList.toggle("wide", res.main.length > 1);
      if (!instant) replay(glyph, "pop");
      if (instant) done(); else later(done, 380);
    },
    prefs: function () { return { set: sel.value }; },
    restore: function (p) { if (p && p.set && sel.querySelector('option[value="' + String(p.set).replace(/[^a-z-]/g, "") + '"]')) sel.value = p.set; }
  };
})();

// ---------- playing card (without replacement until shuffled)
GEN.card = (function () {
  var jok, face, left = null;
  function deckId() { return jok.checked ? "french54" : "french52"; }
  function deck() { return DATA.decks[deckId()]; }
  function full() {
    var d = deck(), cards = [];
    for (var s = 0; s < d.suits.length; s++) for (var r = 0; r < d.ranks.length; r++) cards.push([s, r]);
    (d.extras || []).forEach(function (x, xi) { for (var c = 0; c < x.count; c++) cards.push([-1, xi]); });
    return cards;
  }
  function valid(c) { var d = deck(); return Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1]) &&
    (c[0] >= 0 ? c[0] < d.suits.length && c[1] >= 0 && c[1] < d.ranks.length : c[0] === -1 && !!(d.extras && d.extras[c[1]])); }
  function back() { face.className = "pcard back"; face.querySelectorAll("span").forEach(function (s) { s.textContent = ""; }); }
  function reset() { left = full(); back(); }
  return {
    needsData: true,
    init: function () {
      jok = g$("card", "jokers"); face = g$("card", "face");
      jok.addEventListener("change", function () { if (DATA) reset(); else left = null; savePrefs(); });
      g$("card", "shuffle").addEventListener("click", function () {
        if (state.busy) return;
        needData(function () { reset(); clearResult("card"); savePrefs(); toast(fmt(S.card_left, { n: left.length })); });
      });
    },
    dataReady: function () { if (!jok) return; left = left ? left.filter(valid) : full(); },
    draw: function () {
      left = left ? left.filter(valid) : full();         // stored or old-format entries never reach the draw
      if (!left.length) return { error: S.card_empty };
      var c = left.splice(randInt(left.length), 1)[0], d = deck(), main, info;
      if (c[0] < 0) { var x = d.extras[c[1]]; main = x.name; info = { joker: true, name: x.name }; }
      else {
        var suit = d.suits[c[0]], rank = d.ranks[c[1]];
        main = fmt(S.card_name_format, { rank: rank.name, suit: suit.name });
        info = { short: rank.short, sym: suit.symbol, red: suit.color === "red" };
      }
      return { info: info, main: main, headline: main, detail: fmt(S.card_left, { n: left.length }), hist: "" };
    },
    reveal: function (res, done, instant) {
      var i = res.info, sp = face.querySelectorAll("span");
      if (i.joker) { face.className = "pcard joker"; sp[0].textContent = "★"; sp[1].textContent = i.name; sp[2].textContent = "★"; }
      else { face.className = "pcard" + (i.red ? " red" : ""); sp[0].textContent = i.short + i.sym; sp[1].textContent = i.sym; sp[2].textContent = i.short + i.sym; }
      if (!instant) replay(face, "pop");
      if (instant) done(); else later(done, 380);
    },
    prefs: function () { return { jokers: jok.checked, left: left }; },
    restore: function (p) {
      if (!p) return;
      jok.checked = !!p.jokers;
      if (Array.isArray(p.left) && p.left.length <= 54) left = DATA ? p.left.filter(valid) : p.left;   // else dataReady filters
    }
  };
})();

// ---------- rock-paper-scissors
GEN.rps = (function () {
  var orb, use, ICONS = ["i-rock", "i-paper", "i-scissors"];
  return {
    init: function () { orb = g$("rps", "orb"); use = g$("rps", "use"); },
    draw: function () { var i = randInt(3), w = [S.rock, S.paper, S.scissors][i]; return { i: i, main: w, headline: w }; },
    reveal: function (res, done, instant) {
      use.setAttribute("href", "#" + ICONS[res.i]);
      if (!instant) replay(orb, "pop");
      if (instant) done(); else later(done, 380);
    }
  };
})();

// ---------- color
GEN.color = (function () {
  var sw;
  function hex2(n) { return (n < 16 ? "0" : "") + n.toString(16).toUpperCase(); }
  return {
    init: function () { sw = g$("color", "sw"); },
    draw: function () {
      var n = randInt(16777216), r = n >> 16, g = (n >> 8) & 255, b = n & 255, hex = "#" + hex2(r) + hex2(g) + hex2(b);
      var L = luminance(r, g, b), dark = contrast(L, luminance(11, 15, 26)) > contrast(L, 1);
      return { hex: hex, dark: dark, main: hex, headline: hex, detail: fmt(S.color_rgb, { r: r, g: g, b: b }) };
    },
    reveal: function (res, done, instant) {
      sw.style.setProperty("--sw", res.hex); sw.textContent = res.hex;
      sw.className = "swatch " + (res.dark ? "dark-label" : "light-label");
      if (!instant) replay(sw, "pop");
      if (instant) done(); else later(done, 380);
    }
  };
})();

// ---------- date
GEN.date = (function () {
  var from, to, leaf;
  var full = new Intl.DateTimeFormat(LANG, { dateStyle: "full", timeZone: "UTC" });
  var mon = new Intl.DateTimeFormat(LANG, { month: "short", timeZone: "UTC" });
  return {
    init: function () {
      from = g$("date", "from"); to = g$("date", "to"); leaf = g$("date", "leaf");
      var now = new Date();
      if (!from.value) from.value = isoDay(now);
      if (!to.value) to.value = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 364));
    },
    draw: function () {
      var a = utcDay(from.value), b = utcDay(to.value);
      if (isNaN(a) || isNaN(b)) return { error: S.date_invalid };
      if (a > b) { var t = a; a = b; b = t; }
      var days = Math.round((b - a) / 864e5);
      if (days > 36525) return { error: S.date_too_long };
      var d = new Date(a + randInt(days + 1) * 864e5), main = full.format(d);
      return { d: d, main: main, headline: main, hist: "" };
    },
    reveal: function (res, done, instant) {
      var parts = leaf.children;
      parts[0].textContent = mon.format(res.d); parts[1].textContent = String(res.d.getUTCDate()); parts[2].textContent = String(res.d.getUTCFullYear());
      if (!instant) replay(leaf, "pop");
      if (instant) done(); else later(done, 380);
    }
  };
})();

// ---------- teams
GEN.groups = (function () {
  var ta, seg, out, box, k = { count: 2, size: 3 };
  var LIMIT = { count: [2, 20], size: [1, 50] };
  function names() { return ta.value.split("\n").map(function (s) { return s.trim().slice(0, 80); }).filter(Boolean).slice(0, 200); }
  function mode() { return segValue(seg) || "count"; }
  function show() { out.textContent = String(k[mode()]); g$("groups", "step").setAttribute("aria-label", mode() === "count" ? S.groups_by_count : S.groups_by_size); }
  function step(d) { var m = mode(); k[m] = Math.min(LIMIT[m][1], Math.max(LIMIT[m][0], k[m] + d)); show(); savePrefs(); }
  return {
    init: function () {
      ta = g$("groups", "names"); seg = g$("groups", "mode"); out = g$("groups", "k"); box = g$("groups", "box");
      segWire(seg, show);
      g$("groups", "minus").addEventListener("click", function () { if (!state.busy) step(-1); });
      g$("groups", "plus").addEventListener("click", function () { if (!state.busy) step(1); });
      ta.addEventListener("change", savePrefs);
      show();
    },
    draw: function () {
      var list = names();
      if (list.length < 2) return { error: S.groups_need_names };
      var teamsN = mode() === "count" ? k.count : Math.ceil(list.length / k.size);
      if (mode() === "count" && teamsN > list.length) return { error: S.groups_need_more };
      var teams = deal(shuffle(list.slice()), teamsN);
      var head = cut(teams.map(function (t, i) { return fmt(S.groups_team, { n: i + 1 }) + ": " + t.join(", "); }).join(" · "), 500);
      return { teams: teams, main: fmt(S.groups_result, { n: teamsN }), headline: head, detail: head, copy: head, hist: cut(head, 300) };
    },
    reveal: function (res, done, instant) {
      clear(box);
      var ul = el("ul", "teams");
      res.teams.forEach(function (t, i) { var li = el("li"); li.appendChild(el("b", null, fmt(S.groups_team, { n: i + 1 }))); t.forEach(function (n) { li.appendChild(el("span", null, n)); }); ul.appendChild(li); });
      box.appendChild(ul);
      if (!instant) replay(ul, "pop");
      if (instant) done(); else later(done, 380);
    },
    prefs: function () { return { text: ta.value.slice(0, 12000), mode: mode(), count: k.count, size: k.size }; },
    restore: function (p) {
      if (!p) return;
      if (typeof p.text === "string") ta.value = p.text;
      if (p.mode === "count" || p.mode === "size") segSet(seg, p.mode);
      if (p.count >= 2 && p.count <= 20) k.count = p.count;
      if (p.size >= 1 && p.size <= 50) k.size = p.size;
      show();
    }
  };
})();

// Oracle generators: tarot, I Ching, runes, Lenormand, omikuji. For reflection and entertainment.

function drawDistinct(n, k) {   // k different positions out of n, in draw order
  var pool = [], out = [];
  for (var i = 0; i < n; i++) pool.push(i);
  for (var j = 0; j < k; j++) out.push(pool.splice(randInt(pool.length), 1)[0]);
  return out;
}
function para(text) { return el("p", null, text); }
function cardItems(det, items) {   // several cards: one row per card with its text and meaning link
  var ul = el("ul", "res-list");
  items.forEach(function (it) {
    var li = el("li"); li.appendChild(el("b", null, it.title));
    if (it.text) li.appendChild(document.createTextNode(it.text + " "));
    if (it.link) li.appendChild(it.link);
    ul.appendChild(li);
  });
  det.appendChild(ul);
}
function oracleCard(num, ornament, name, rev, cls) {   // the card (turned when reversed) with a label under it
  var w = el("div", "ow"), c = el("div", "ocard" + (cls ? " " + cls : "") + (rev ? " rev" : ""));
  c.appendChild(el("span", "n", num));
  var o = el("span", "orn");
  if (typeof ornament === "string") o.textContent = ornament; else o.appendChild(ornament);
  c.appendChild(o);
  c.appendChild(el("span", "nm", name));
  w.appendChild(c);
  if (rev) w.appendChild(el("span", "rv", S.reversed));
  return w;
}
function revealCards(box, nodes, done, instant) {
  clear(box); nodes.forEach(function (n) { box.appendChild(n); });
  if (!instant) nodes.forEach(function (n) { replay(n, "pop"); });
  if (instant) done(); else later(done, 420);
}

// ---------- tarot: [name, numeral, upright, reversed, file, hasPage, major]
GEN.tarot = (function () {
  var seg, rev, box;
  return {
    needsData: true,
    init: function () { seg = g$("tarot", "n"); rev = g$("tarot", "rev"); box = g$("tarot", "spread"); segWire(seg, function () {}); rev.addEventListener("change", savePrefs); },
    draw: function () {
      var k = +segValue(seg) || 1, cards = drawDistinct(DATA.tarot.length, k).map(function (i) {
        var c = DATA.tarot[i], r = rev.checked && randInt(2) === 1;
        return { c: c, rev: r, label: c[0] + (r ? " (" + S.reversed + ")" : "") };
      });
      var main = k === 1 ? cards[0].c[0] + (cards[0].rev ? " · " + S.reversed : "") : cards.map(function (x) { return x.label; }).join(" · ");
      var res = { cards: cards, main: main, headline: main, k: k };
      if (k === 1) {
        var one = cards[0], text = one.rev ? one.c[3] : one.c[2];
        res.hist = text; res.copy = text;
        res.build = function (det) { var p = para(text + " "); p.appendChild(meaningLink(one.c[4], one.c[5])); det.appendChild(p); };
      } else {
        res.hist = ""; res.copy = cards.map(function (x) { return x.label + ": " + (x.rev ? x.c[3] : x.c[2]); }).join(" | ");
        res.build = function (det) { cardItems(det, cards.map(function (x) { return { title: x.label, text: x.rev ? x.c[3] : x.c[2], link: meaningLink(x.c[4], x.c[5]) }; })); };
      }
      return res;
    },
    reveal: function (res, done, instant) {
      box.className = "spread n" + res.k;
      revealCards(box, res.cards.map(function (x) { return oracleCard(x.c[1], icon(x.c[6] ? "i-star4" : "g-tarot"), x.c[0], x.rev); }), done, instant);
    },
    prefs: function () { return { n: +segValue(seg) || 1, rev: rev.checked }; },
    restore: function (p) { if (!p) return; if (p.n === 1 || p.n === 3) segSet(seg, p.n); if (typeof p.rev === "boolean") rev.checked = p.rev; }
  };
})();

// ---------- I Ching: hex = [number, name, lines (bottom first), summary, file, hasPage]
GEN.iChing = (function () {
  var seg, bars;
  return {
    needsData: true,
    init: function () { seg = g$("iChing", "m"); bars = g$("iChing", "hexa"); segWire(seg, function () {}); },
    draw: function () {
      var method = segValue(seg) === "yarrow" ? "yarrow" : "coins", counts = DATA.iching.odds[method], values = [];
      for (var i = 0; i < 6; i++) values.push(ichingValue(randInt(16), counts));
      var L = ichingLines(values), h = hexByLines(DATA.iching.hex, L.lines);
      var m = L.changing.length ? hexByLines(DATA.iching.hex, L.moved) : null;
      var main = fmt(S.iching_result, { n: h[0], name: h[1] });
      var change = m ? fmt(S.iching_changing, { list: L.changing.join(", "), m: m[0], name: m[1] }) : "";
      return { values: values, main: main, headline: main, hist: h[3], copy: h[3] + (change ? " " + change : ""),
        build: function (det) {
          var p = para(h[3] + " "); p.appendChild(meaningLink(h[4], h[5])); det.appendChild(p);
          if (m) { var p2 = para(change + " "); p2.appendChild(meaningLink(m[4], m[5])); det.appendChild(p2); }
        } };
    },
    reveal: function (res, done, instant) {
      clear(bars); bars.className = "hexa";
      res.values.forEach(function (v, i) {
        var line = el("i", (v === 7 || v === 9 ? "yang" : "yin") + (v === 6 || v === 9 ? " chg" : ""));
        line.style.setProperty("--i", String(i)); bars.appendChild(line);
      });
      if (instant) { done(); return; }
      replay(bars, "cast"); later(done, 6 * 180 + 320);
    },
    prefs: function () { return { m: segValue(seg) }; },
    restore: function (p) { if (p && (p.m === "coins" || p.m === "yarrow")) segSet(seg, p.m); }
  };
})();

// ---------- runes: [name, glyph, strokes, reversible, upright, reversed, file, hasPage]
GEN.runes = (function () {
  var seg, rev, box;
  function stone(r, isRev) {
    var s = el("div", "stone" + (isRev ? " rev" : "")), svg = svgEl("svg", { viewBox: "-0.1 -0.1 1.2 1.2", "aria-hidden": "true" });
    (r[2] || []).forEach(function (st) { svg.appendChild(svgEl("line", { x1: String(st[0]), y1: String(st[1]), x2: String(st[2]), y2: String(st[3]) })); });
    s.appendChild(svg); return s;
  }
  return {
    needsData: true,
    init: function () { seg = g$("runes", "n"); rev = g$("runes", "rev"); box = g$("runes", "stones"); segWire(seg, function () {}); rev.addEventListener("change", savePrefs); },
    draw: function () {
      var k = +segValue(seg) || 1, picks = drawDistinct(DATA.runes.length, k).map(function (i) {
        var r = DATA.runes[i], isRev = rev.checked && r[3] && randInt(2) === 1;
        return { r: r, rev: isRev, label: r[0] + (isRev ? " (" + S.reversed + ")" : ""), text: isRev ? r[5] : r[4] };
      });
      var main = k === 1 ? picks[0].r[0] + (picks[0].rev ? " · " + S.reversed : "") : picks.map(function (x) { return x.label; }).join(" · ");
      var res = { picks: picks, k: k, main: main, headline: main };
      if (k === 1) {
        res.hist = picks[0].text; res.copy = picks[0].text;
        res.build = function (det) { var p = para(picks[0].text + " "); p.appendChild(meaningLink(picks[0].r[6], picks[0].r[7])); det.appendChild(p); };
      } else {
        res.hist = ""; res.copy = picks.map(function (x) { return x.label + ": " + x.text; }).join(" | ");
        res.build = function (det) { cardItems(det, picks.map(function (x) { return { title: x.label, text: x.text, link: meaningLink(x.r[6], x.r[7]) }; })); };
      }
      return res;
    },
    reveal: function (res, done, instant) {
      box.className = "stones n" + res.k;
      revealCards(box, res.picks.map(function (x) { return stone(x.r, x.rev); }), done, instant);
    },
    prefs: function () { return { n: +segValue(seg) || 1, rev: rev.checked }; },
    restore: function (p) { if (!p) return; if (p.n === 1 || p.n === 3) segSet(seg, p.n); if (typeof p.rev === "boolean") rev.checked = p.rev; }
  };
})();

// ---------- Lenormand: [number, name, insert, keywords, meaning, file, hasPage]
GEN.lenormand = (function () {
  var seg, box;
  return {
    needsData: true,
    init: function () { seg = g$("lenormand", "n"); box = g$("lenormand", "spread"); segWire(seg, function () {}); },
    draw: function () {
      var k = +segValue(seg) || 1, cards = drawDistinct(DATA.lenormand.length, k).map(function (i) { return DATA.lenormand[i]; });
      var main = cards.map(function (c) { return c[1]; }).join(" · ");
      var res = { cards: cards, k: k, main: main, headline: main };
      if (k === 1) {
        var c = cards[0];
        res.hist = c[3]; res.copy = c[3] + ". " + c[4];
        res.build = function (det) { det.appendChild(el("p", "muted", c[3])); var p = para(c[4] + " "); p.appendChild(meaningLink(c[5], c[6])); det.appendChild(p); };
      } else {
        res.hist = ""; res.copy = cards.map(function (x) { return x[1] + ": " + x[3]; }).join(" | ");
        res.build = function (det) { cardItems(det, cards.map(function (x) { return { title: x[1], text: x[3] + ". " + x[4], link: meaningLink(x[5], x[6]) }; })); };
      }
      return res;
    },
    reveal: function (res, done, instant) {
      box.className = "spread n" + res.k;
      revealCards(box, res.cards.map(function (c) { return oracleCard(String(c[0]), c[2], c[1], false, "len"); }), done, instant);
    },
    prefs: function () { return { n: +segValue(seg) || 1 }; },
    restore: function (p) { if (p && (p.n === 1 || p.n === 3)) segSet(seg, p.n); }
  };
})();

// ---------- omikuji: levels [id, kanji, name, weight, summary]; sections [title, {levelId: [lines]}]
GEN.omikuji = (function () {
  var slip;
  return {
    needsData: true,
    init: function () { slip = g$("omikuji", "slip"); },
    draw: function () {
      var lv = weighted(DATA.omikuji.levels, function (l) { return l[3]; });
      var lines = DATA.omikuji.sections.map(function (s) { return [s[0], pick(s[1][lv[0]] || [""])]; });
      return { lv: lv, main: lv[2], headline: lv[2], hist: lv[4], copy: lv[4],
        build: function (det) {
          det.appendChild(para(lv[4]));
          var ul = el("ul", "res-list");
          lines.forEach(function (x) { var li = el("li"); li.appendChild(el("b", null, x[0])); li.appendChild(document.createTextNode(x[1])); ul.appendChild(li); });
          det.appendChild(ul);
        } };
    },
    reveal: function (res, done, instant) {
      slip.textContent = res.lv[1]; slip.className = "slip";
      if (!instant) replay(slip, "pop");
      if (instant) done(); else later(done, 520);
    }
  };
})();

// Routing (hash = the app's mode id), keyboard, sheet, storage switch, offline precache.
var inited = {};
var PANELS = {};
Array.prototype.forEach.call(document.querySelectorAll("section.gen[data-gen]"), function (s) { PANELS[s.getAttribute("data-gen")] = s; });

function ensureInit(id) { if (!inited[id] && GEN[id]) { inited[id] = true; GEN[id].init(); if (kept && kept.prefs && GEN[id].restore) GEN[id].restore(kept.prefs[id]); } }

function select(id, byUser) {
  if (id && !PANELS[id]) return;
  state.current = id;
  for (var k in PANELS) PANELS[k].hidden = k !== id;
  var pickBox = document.getElementById("pick");
  if (pickBox) pickBox.hidden = !!id;
  var acts = document.querySelectorAll(".needs-gen");
  for (var i = 0; i < acts.length; i++) acts[i].hidden = !id;
  var links = document.querySelectorAll("a[data-route]");
  for (var j = 0; j < links.length; j++) {
    if (links[j].getAttribute("data-route") === id) links[j].setAttribute("aria-current", "page"); else links[j].removeAttribute("aria-current");
  }
  if (id) {
    ensureInit(id);
    if (!FIXED) document.title = I18N.names[id] + " · " + S.title_suffix;
    var chip = document.querySelector('.chiprail a[data-route="' + id + '"]');
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ inline: "center", block: "nearest" });
    if (byUser) { var h = document.getElementById("g-" + id + "-h"); if (h) h.focus({ preventScroll: false }); }
    if (GEN[id].needsData && !DATA) needData(function () {});
  } else if (!FIXED) {
    document.title = I18N.title;
    if (byUser) { var ph = document.getElementById("pick-h"); if (ph) ph.focus(); }
  }
  updateGo();
}

// ---------- history storage switch
var kept = null;
state.storage = storageOk();
(function () {
  var sw = document.getElementById("keep");
  if (!sw) return;
  if (!state.storage) { sw.disabled = true; document.getElementById("keep-note").textContent = S.storage_off; return; }
  kept = loadKept();
  if (kept) { state.history = Array.isArray(kept.history) ? kept.history.filter(function (e) { return e && typeof e.m === "string" && typeof e.r === "string" && Number.isFinite(e.t) && (e.d == null || typeof e.d === "string"); }).slice(0, 200) : []; setKeep(true); }
  else setKeep(false);
  sw.addEventListener("click", function () { setKeep(!state.keep); });
})();
renderHistory();

// ---------- buttons
GO.addEventListener("click", run);
document.getElementById("act-share").addEventListener("click", share);
var copyBtn = document.getElementById("act-copy");
if (copyBtn) copyBtn.addEventListener("click", copyResult);
document.getElementById("act-hist").addEventListener("click", function () {
  var h = document.getElementById("hist");
  if (h) { h.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }); document.getElementById("hist-h").focus({ preventScroll: true }); }
});
document.getElementById("hist-clear").addEventListener("click", function () {
  state.history = []; for (var k in GEN) if (GEN[k].reset) GEN[k].reset(); renderHistory(); persist();
});
var nx = document.getElementById("nudge-close");
if (nx) nx.addEventListener("click", function () { document.getElementById("nudge").hidden = true; uiSet({ nudgeUntil: Date.now() + 30 * 864e5 }); });
var lbx = document.getElementById("linkbox-close");
if (lbx) lbx.addEventListener("click", function () { document.getElementById("linkbox").hidden = true; });

// ---------- keyboard: Space or Enter draws (not while typing or on a control); "/" finds; Escape closes the sheet
document.addEventListener("keydown", function (e) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  var a = document.activeElement, tag = a ? a.tagName : "";
  var typing = /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(tag) || (a && a.isContentEditable);
  if ((e.key === " " || e.key === "Enter") && !typing && state.current && !document.querySelector("dialog[open]")) { e.preventDefault(); run(); }
  else if (e.key === "/" && !typing) { var f = document.getElementById("find"); if (f && f.offsetParent) { e.preventDefault(); f.focus(); } }
});

// ---------- filter in the sidebar
(function () {
  var f = document.getElementById("find");
  if (!f) return;
  f.addEventListener("input", function () {
    var q = f.value.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll(".rail li[data-route]"), function (li) {
      var id = li.getAttribute("data-route"), name = (I18N.names[id] || "").toLowerCase();
      li.hidden = !!q && name.indexOf(q) < 0 && id.toLowerCase().indexOf(q) < 0;
    });
  });
  f.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { var li = document.querySelector(".rail li[data-route]:not([hidden]) a"); if (li) { e.preventDefault(); location.hash = li.getAttribute("href"); } }
  });
})();

// ---------- "All generators" sheet (phones)
(function () {
  var dlg = document.getElementById("sheet"), open = document.getElementById("open-sheet");
  if (!dlg || !open) return;
  open.addEventListener("click", function () { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); });
  dlg.addEventListener("click", function (e) { var a = e.target.closest("a[data-route]"); if (a || e.target === dlg) dlg.close(); });
  document.getElementById("sheet-close").addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("close", function () { open.focus(); });
})();

// ---------- phones: the fixed button bar slides away while the generator itself is scrolled out of view
(function () {
  var panel = document.querySelector(".stage-panel");
  if (!panel || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { document.body.classList.toggle("bar-off", !e.isIntersecting); });
  }).observe(panel);
})();

// ---------- routes
function fromHash() { var h = location.hash.replace(/^#/, ""); return h; }
if (FIXED) select(FIXED, false);
else {
  var first = fromHash();
  select(PANELS[first] ? first : "", false);
  window.addEventListener("hashchange", function () {
    var h = fromHash();
    if (h === "") select("", true);
    else if (PANELS[h]) select(h, true);          // unknown hashes (#main, typos) keep the current state
  });
}

// ---------- offline: no install prompt (the iPhone app is the thing to install); precache this language
window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); });
if ("serviceWorker" in navigator && navigator.serviceWorker.ready &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.ready.then(function (reg) {
    if (reg.active) reg.active.postMessage({ type: "precache", urls: I18N.precache });
  }).catch(function () {});
}

})();
