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
// The texts of the lines that changed: changing counts 1 to 6 from the bottom, line_texts is bottom first.
function changedLines(lineTexts, changing) {
  return changing.map(function (n) { return [n, lineTexts[n - 1]]; }).filter(function (x) { return !!x[1]; });
}
function hexByLines(hexes, lines) { for (var i = 0; i < hexes.length; i++) if (hexes[i][2] === lines) return hexes[i]; return null; }
function hexIndexByLines(hexes, lines) { for (var i = 0; i < hexes.length; i++) if (hexes[i][2] === lines) return i; return -1; }
// The relating hexagram's lines: every changing line (1 to 6 from the bottom) turned over.
function flipLines(lines, changing) {
  var out = lines.split("");
  changing.forEach(function (n) { out[n - 1] = out[n - 1] === "1" ? "0" : "1"; });
  return out.join("");
}

// ---------- share code: the hidden last part of a share link (format: docs/website.md, "Share links").
// #<mode>/<result>/<question>/!1-<payload>. Positions in the content files only, never text, so any language
// can show the reading. The selections are { items: [{ i, rev }] } (tarot, runes, Lenormand),
// { hex, changing: [1..6] } (I Ching) and { level, lines: [one position per section] } (omikuji).
var CODE_MODES = ["tarot", "iChing", "runes", "lenormand", "omikuji"];
var CODE_NUM = "(?:0|[1-9][0-9]{0,3})";
var CODE_RE = {
  tarot: new RegExp("^" + CODE_NUM + "r?(?:," + CODE_NUM + "r?){0,11}$"),
  runes: new RegExp("^" + CODE_NUM + "r?(?:," + CODE_NUM + "r?){0,11}$"),
  lenormand: new RegExp("^" + CODE_NUM + "(?:," + CODE_NUM + "){0,11}$"),
  iChing: new RegExp("^" + CODE_NUM + "(?:c[1-6]{1,6})?$"),
  omikuji: new RegExp("^" + CODE_NUM + "(?:\\." + CODE_NUM + "){1,23}$")
};
function shareCode(mode, sel) {
  var body;
  if (mode === "iChing") body = sel.hex + (sel.changing.length ? "c" + sel.changing.join("") : "");
  else if (mode === "omikuji") body = [sel.level].concat(sel.lines).join(".");
  else body = sel.items.map(function (p) { return p.i + (p.rev ? "r" : ""); }).join(",");
  return "!1-" + body;
}
// Is this last part of a link a code (valid or not)? Questions never contain a bare "!" (both encoders write %21).
function isShareCodePart(s) { return /^!\d+-/.test(s); }
// Syntax only (no data needed): the selection, or null. Positions are checked against the data by checkShareSelection.
function parseShareCode(mode, code) {
  var m = /^!1-([0-9a-z,.]+)$/.exec(String(code));
  if (!m || !CODE_RE[mode] || !CODE_RE[mode].test(m[1])) return null;
  var body = m[1], at;
  if (mode === "iChing") {
    at = body.indexOf("c");
    var ch = at < 0 ? [] : body.slice(at + 1).split("").map(Number);
    for (var i = 1; i < ch.length; i++) if (ch[i] <= ch[i - 1]) return null;       // ascending, no repeats
    return { hex: +(at < 0 ? body : body.slice(0, at)), changing: ch };
  }
  if (mode === "omikuji") { var n = body.split(".").map(Number); return { level: n[0], lines: n.slice(1) }; }
  return { items: body.split(",").map(function (s) { return s.slice(-1) === "r" ? { i: +s.slice(0, -1), rev: true } : { i: +s, rev: false }; }) };
}
// Positions inside the data, no repeats, "reversed" only where it exists.
function checkShareSelection(mode, sel, DATA) {
  if (!sel || !DATA) return false;
  if (mode === "iChing") {
    var hexes = DATA.iching.hex;
    return sel.hex < hexes.length && (!sel.changing.length || !!hexByLines(hexes, flipLines(hexes[sel.hex][2], sel.changing)));
  }
  if (mode === "omikuji") {
    var lv = DATA.omikuji.levels[sel.level];
    if (!lv || sel.lines.length !== DATA.omikuji.sections.length) return false;
    return sel.lines.every(function (x, j) { return x < (DATA.omikuji.sections[j][1][lv[0]] || [""]).length; });
  }
  var list = DATA[mode], seen = {};
  if (!list) return false;
  return sel.items.every(function (p) {
    if (p.i >= list.length || seen[p.i]) return false;
    seen[p.i] = true;
    return !p.rev || (mode === "tarot" ? true : mode === "runes" ? !!list[p.i][3] : false);
  });
}

// The result of one oracle from its selection, as the app shows it and as /r/ shows it (the same words in both).
// T = the language's strings, DATA = data/oracles.<code>.json, READ = { tarot, iching, runes, lenormand } long texts (may be
// missing: then the blocks hold the short lines only). Returns main/headline (the live result), hist, copy, lines
// (short paragraphs under it), blocks (the reading, see showReading) and the draw's own pieces (cards, picks, hex, moved).
function oracleResult(mode, sel, T, DATA, READ) {
  var rd = function (key, i) { return (READ && READ[key] && READ[key][i]) || null; };
  var o = { sel: sel, lines: [], hist: "" }, k;
  if (mode === "tarot") {
    k = sel.items.length;
    o.k = k;
    o.cards = sel.items.map(function (p) {
      var c = DATA.tarot[p.i];
      return { c: c, i: p.i, rev: p.rev, label: c[0] + (p.rev ? " (" + T.reversed + ")" : ""), text: p.rev ? c[3] : c[2] };
    });
    o.main = k === 1 ? o.cards[0].c[0] + (o.cards[0].rev ? " · " + T.reversed : "") : o.cards.map(function (x) { return x.label; }).join(" · ");
    o.blocks = o.cards.map(function (x) {               // one card: its short line is already in the result above
      var more = rd("tarot", x.i), parts = [];
      if (k > 1) parts.push([x.rev ? T.h_reversed : T.h_upright, x.text]);
      if (more) parts.push([T.h_card, more[0]]);
      return { title: k > 1 ? x.label : "", kw: more && more[1], parts: parts, file: x.c[4], has: x.c[5] };
    });
    if (k === 1) { o.hist = o.cards[0].text; o.copy = o.cards[0].text; o.lines = [o.cards[0].text]; }
    else o.copy = o.cards.map(function (x) { return x.label + ": " + x.text; }).join(" | ");
  } else if (mode === "runes") {
    k = sel.items.length;
    o.k = k;
    o.picks = sel.items.map(function (p) {
      var r = DATA.runes[p.i];
      return { r: r, i: p.i, rev: p.rev, label: r[0] + (p.rev ? " (" + T.reversed + ")" : ""), text: p.rev ? r[5] : r[4] };
    });
    o.main = k === 1 ? o.picks[0].r[0] + (o.picks[0].rev ? " · " + T.reversed : "") : o.picks.map(function (x) { return x.label; }).join(" · ");
    o.blocks = o.picks.map(function (x) {
      var more = rd("runes", x.i), parts = [[x.rev ? T.rune_reversed : T.h_upright, x.text]];
      if (more) parts.push([T.rune_lore, more[2]]);
      return { title: k > 1 ? x.label : "", lead: k > 1 && more ? more[0] : "", kw: more && more[1], parts: parts, file: x.r[6], has: x.r[7] };
    });
    if (k === 1) {
      var lead = rd("runes", o.picks[0].i);
      o.hist = o.picks[0].text; o.copy = o.picks[0].text;
      if (lead) o.lines = [lead[0]];                    // glyph, sound, aett, what the name means
    } else o.copy = o.picks.map(function (x) { return x.label + ": " + x.text; }).join(" | ");
  } else if (mode === "lenormand") {
    k = sel.items.length;
    o.k = k;
    o.cards = sel.items.map(function (p) { return DATA.lenormand[p.i]; });
    o.main = o.cards.map(function (c) { return c[1]; }).join(" · ");
    o.blocks = o.cards.map(function (x, j) {
      var more = rd("lenormand", sel.items[j].i), parts = [[T.len_meaning, x[4]]];
      if (more) parts.push([T.len_combination, more[0]]);
      return { title: k > 1 ? x[1] : "", kw: k > 1 ? x[3] : "", parts: parts, file: x[5], has: x[6] };
    });
    if (k === 1) { o.hist = o.cards[0][3]; o.copy = o.cards[0][3] + ". " + o.cards[0][4]; o.lines = [o.cards[0][3]]; }
    else o.copy = o.cards.map(function (x) { return x[1] + ": " + x[3] + ". " + x[4]; }).join(" | ");
  } else if (mode === "iChing") {
    var hexes = DATA.iching.hex, h = hexes[sel.hex], m = null;
    if (sel.changing.length) m = hexByLines(hexes, flipLines(h[2], sel.changing));
    o.hex = h; o.moved = m;
    o.main = fmt(T.iching_result, { n: h[0], name: h[1] });
    var change = m ? fmt(T.iching_changing, { list: sel.changing.join(", "), m: m[0], name: m[1] }) : "";
    var hexBlock = function (x, i, title, withSummary, changing) {   // the second hexagram: name, summary, judgment, image; no lines
      var more = rd("iching", i), parts = [];
      if (withSummary) parts.push(["", x[3]]);
      if (more) {
        parts.push([T.ich_judgment, more[1]], [T.ich_image, more[2]]);
        changedLines(more[3], changing).forEach(function (y) {
          var end = y[0] === 1 ? T.join_space + T.ich_bottom : y[0] === 6 ? T.join_space + T.ich_top : "";
          parts.push([fmt(T.ich_line, { n: y[0] }) + end, y[1]]);
        });
      }
      return { title: title, kw: more && more[0], parts: parts, file: x[4], has: x[5] };
    };
    o.blocks = [hexBlock(h, sel.hex, m ? o.main : "", false, sel.changing)];
    if (m) o.blocks.push(hexBlock(m, hexes.indexOf(m), fmt(T.iching_result, { n: m[0], name: m[1] }), true, []));
    o.hist = h[3]; o.copy = h[3] + (change ? " " + change : "");
    o.lines = change ? [h[3], change] : [h[3]];
  } else if (mode === "omikuji") {
    var lv = DATA.omikuji.levels[sel.level];
    var picked = DATA.omikuji.sections.map(function (s, j) { return [s[0], (s[1][lv[0]] || [""])[sel.lines[j]]]; });
    o.lv = lv; o.main = lv[2]; o.hist = lv[4]; o.lines = [lv[4]];
    o.copy = lv[4] + picked.map(function (x) { return " | " + x[0] + ": " + x[1]; }).join("");
    o.blocks = picked.map(function (x) { return { parts: [[x[0], x[1]]] }; });
  }
  o.headline = o.main;
  o.code = shareCode(mode, sel);
  return o;
}
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

// Share page /r/. Link format (all after the #, so nothing reaches a server): #<mode>/<result>/<question>
// or #list/<item>,<item>,... with every part percent-encoded (Sources/App/DecisionShare.swift). Tarot, I Ching,
// runes, Lenormand and omikuji links may end in a fourth part, a hidden result code "!1-<positions>" (language-
// independent; format in docs/website.md) from which this page shows the full reading in the visitor's language.
// Text goes in with textContent only, so a shared link cannot inject markup.
(function () {
  "use strict";
  var R = {"de":{"back":"← Alle kostenlosen Tools","badge":["/img/badges/de.svg",120,40],"data":"/data/oracles.de.6e816dd6.json","free":"kostenlos, ohne Anmeldung","get_app":"Augura für iPhone laden","list_q":"Eine Liste, aus Augura geteilt. Dreh sie!","nothing":"Noch nichts hier","rd":{"english_only":"(Englisch)","h_card":"Die Karte","h_reversed":"Umgekehrte Bedeutung","h_upright":"Aufrechte Bedeutung","ich_bottom":"(unten)","ich_image":"Das Bild","ich_judgment":"Das Urteil","ich_line":"Linie {n}","ich_top":"(oben)","iching_changing":"Wandelnde Linien {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"In Kombination","len_meaning":"Bedeutung","read_meaning":"Bedeutung lesen →","reflection":"Zur Reflexion und Unterhaltung gedacht, nicht als Vorhersage","reversed":"Umgekehrt","rune_lore":"Überlieferung","rune_reversed":"Umgekehrt (Merkstave)"},"readings":{"iching":"/data/reading-iching.de.ff46071b.json","lenormand":"/data/reading-lenormand.de.5b9b8c00.json","runes":"/data/reading-runes.de.cd11dc81.json","tarot":"/data/reading-tarot.de.18dc6761.json"},"spin":"Nochmal drehen","title_generic":"Ein Ergebnis aus Augura","titles":{"card":"Zufällige Spielkarte","coin":"Münzwurf","color":"Zufällige Farbe","date":"Zufälliges Datum","dice":"Würfeln","groups":"Teamgenerator","iChing":"I Ging","lenormand":"Lenormand-Karte ziehen","letter":"Zufälliger Buchstabe","list":"Entscheidungsrad","number":"Zufallszahl","omikuji":"Omikuji","rps":"Schere, Stein, Papier","runes":"Runen werfen","tarot":"Tarotkarte ziehen","yesNo":"Ja oder Nein"},"try":"Probier es selbst aus","ui":{"app.card_body":"All das plus 20 Orakel-Traditionen, Partyspiele, Widgets, Kontrollzentrum und Apple Watch.","app.card_title":"Augura für iPhone","badge.alt":"Laden im App Store","badge.coming_soon":"Bald im App Store","badge.coming_soon_short":"Bald verfügbar","footer.legal":"Keine Cookies, keine Analyse, keine Anfragen an Drittanbieter.","footer.support":"Support","nav.get_app":"App laden","nav.meanings":"Bedeutungen","nav.press":"Pressematerial","nav.skip":"Zum Inhalt springen","nav.tools":"Kostenlose Tools","nav.web_app":"Web-App","privacy_link":"Datenschutzerklärung (Englisch)","tagline":"Eine ruhige, private Werkzeugkiste für den Zufall. Gemacht von Luca."}},"en":{"back":"← All free tools","badge":["/img/badges/en.svg",120,40],"data":"/data/oracles.en.23b10138.json","free":"free, no sign-up","get_app":"Get Augura for iPhone","list_q":"A list shared from Augura. Spin it!","nothing":"Nothing here yet","rd":{"english_only":"(English)","h_card":"The card","h_reversed":"Reversed meaning","h_upright":"Upright meaning","ich_bottom":"(bottom)","ich_image":"The image","ich_judgment":"The judgment","ich_line":"Line {n}","ich_top":"(top)","iching_changing":"Changing lines {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"In combination","len_meaning":"Meaning","read_meaning":"Read the meaning →","reflection":"Presented for reflection and entertainment, not as prediction","reversed":"Reversed","rune_lore":"Lore","rune_reversed":"Reversed (merkstave)"},"readings":{"iching":"/data/reading-iching.en.1857342c.json","lenormand":"/data/reading-lenormand.en.20b7fc31.json","runes":"/data/reading-runes.en.653b74da.json","tarot":"/data/reading-tarot.en.d0698948.json"},"spin":"Spin again","title_generic":"A result from Augura","titles":{"card":"Random Playing Card","coin":"Coin Flip","color":"Random Color","date":"Random Date","dice":"Dice Roller","groups":"Team Generator","iChing":"I Ching","lenormand":"Lenormand Card Draw","letter":"Random Letter","list":"Decision Wheel","number":"Random Number","omikuji":"Omikuji","rps":"Rock Paper Scissors","runes":"Rune Cast","tarot":"Tarot Card Draw","yesNo":"Yes or No"},"try":"Try it yourself","ui":{"app.card_body":"All of these plus 20 oracle traditions, party games, widgets, Control Center and Apple Watch.","app.card_title":"Augura for iPhone","badge.alt":"Download on the App Store","badge.coming_soon":"Coming soon to the App Store","badge.coming_soon_short":"Coming soon","footer.legal":"No cookies, no analytics, no third-party requests.","footer.support":"Support","nav.get_app":"Get the app","nav.meanings":"Meanings","nav.press":"Press kit","nav.skip":"Skip to content","nav.tools":"Free tools","nav.web_app":"Web app","privacy_link":"Privacy Policy","tagline":"A calm, private toolbox for chance. Made by Luca."}},"es":{"back":"← Todas las herramientas gratis","badge":["/img/badges/es.svg",120,40],"data":"/data/oracles.es.7f735e83.json","free":"gratis, sin registro","get_app":"Descargar Augura para iPhone","list_q":"Una lista compartida desde Augura. ¡Gírala!","nothing":"Aún no hay nada","rd":{"english_only":"(en inglés)","h_card":"La carta","h_reversed":"Significado invertido","h_upright":"Significado derecho","ich_bottom":"(abajo)","ich_image":"La imagen","ich_judgment":"El juicio","ich_line":"Línea {n}","ich_top":"(arriba)","iching_changing":"Líneas mutantes {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"En combinación","len_meaning":"Significado","read_meaning":"Leer el significado →","reflection":"Se presenta para la reflexión y el entretenimiento, no como predicción","reversed":"Invertida","rune_lore":"Tradición","rune_reversed":"Invertida (merkstave)"},"readings":{"iching":"/data/reading-iching.es.c0807762.json","lenormand":"/data/reading-lenormand.es.b84b4012.json","runes":"/data/reading-runes.es.e5e84899.json","tarot":"/data/reading-tarot.es.ab449cbe.json"},"spin":"Girar otra vez","title_generic":"Un resultado de Augura","titles":{"card":"Carta de baraja aleatoria","coin":"Cara o cruz","color":"Color aleatorio","date":"Fecha aleatoria","dice":"Lanzador de dados","groups":"Generador de equipos","iChing":"I Ching","lenormand":"Tirada de Lenormand","letter":"Letra aleatoria","list":"Ruleta de decisión","number":"Número aleatorio","omikuji":"Omikuji","rps":"Piedra, papel o tijera","runes":"Tirada de runas","tarot":"Tirada de tarot","yesNo":"Sí o no"},"try":"Pruébalo tú","ui":{"app.card_body":"Todo esto y además 20 tradiciones de oráculos, juegos de fiesta, widgets, Centro de control y Apple Watch.","app.card_title":"Augura para iPhone","badge.alt":"Descargar en el App Store","badge.coming_soon":"Próximamente en el App Store","badge.coming_soon_short":"Próximamente","footer.legal":"Sin cookies, sin analíticas, sin peticiones a terceros.","footer.support":"Soporte","nav.get_app":"Descargar app","nav.meanings":"Significados","nav.press":"Kit de prensa","nav.skip":"Saltar al contenido","nav.tools":"Herramientas gratis","nav.web_app":"App web","privacy_link":"Política de privacidad (en inglés)","tagline":"Una caja de herramientas tranquila y privada para el azar. Creado por Luca."}},"fr":{"back":"← Tous les outils gratuits","badge":["/img/badges/fr.svg",127,40],"data":"/data/oracles.fr.01274b7b.json","free":"gratuit, sans inscription","get_app":"Obtenir Augura pour iPhone","list_q":"Une liste partagée depuis Augura. Faites-la tourner !","nothing":"Rien ici pour l’instant","rd":{"english_only":"(en anglais)","h_card":"La carte","h_reversed":"Signification inversée","h_upright":"Signification droite","ich_bottom":"(en bas)","ich_image":"L’image","ich_judgment":"Le jugement","ich_line":"Ligne {n}","ich_top":"(en haut)","iching_changing":"Lignes mobiles {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"En combinaison","len_meaning":"Signification","read_meaning":"Lire la signification →","reflection":"Proposé pour réfléchir et s’amuser, pas comme une prédiction","reversed":"Inversée","rune_lore":"Tradition","rune_reversed":"Renversée (merkstave)"},"readings":{"iching":"/data/reading-iching.fr.d07621df.json","lenormand":"/data/reading-lenormand.fr.24c9e63b.json","runes":"/data/reading-runes.fr.22b6923f.json","tarot":"/data/reading-tarot.fr.7cc5d31b.json"},"spin":"Tourner encore","title_generic":"Un résultat d’Augura","titles":{"card":"Carte à jouer aléatoire","coin":"Pile ou face","color":"Couleur aléatoire","date":"Date aléatoire","dice":"Lancer de dés","groups":"Générateur d’équipes","iChing":"Yi Jing","lenormand":"Tirage Lenormand","letter":"Lettre aléatoire","list":"Roue de décision","number":"Nombre aléatoire","omikuji":"Omikuji","rps":"Pierre-feuille-ciseaux","runes":"Tirage de runes","tarot":"Tirage de tarot","yesNo":"Oui ou non"},"try":"Essayez vous-même","ui":{"app.card_body":"Tout cela, plus 20 traditions divinatoires, des jeux de soirée, des widgets, le Centre de contrôle et l’Apple Watch.","app.card_title":"Augura pour iPhone","badge.alt":"Télécharger dans l’App Store","badge.coming_soon":"Bientôt dans l’App Store","badge.coming_soon_short":"Bientôt disponible","footer.legal":"Pas de cookies, pas d’analyse, aucune requête vers des services tiers.","footer.support":"Assistance","nav.get_app":"Obtenir l’app","nav.meanings":"Significations","nav.press":"Dossier de presse","nav.skip":"Aller au contenu","nav.tools":"Outils gratuits","nav.web_app":"App web","privacy_link":"Politique de confidentialité (en anglais)","tagline":"Une boîte à outils du hasard, calme et privée. Créé par Luca."}},"it":{"back":"← Tutti gli strumenti gratuiti","badge":["/img/badges/it.svg",120,40],"data":"/data/oracles.it.fa1fafbd.json","free":"gratis, senza registrazione","get_app":"Scarica Augura per iPhone","list_q":"Una lista condivisa da Augura. Falla girare!","nothing":"Ancora niente qui","rd":{"english_only":"(in inglese)","h_card":"La carta","h_reversed":"Significato rovesciato","h_upright":"Significato dritto","ich_bottom":"(in basso)","ich_image":"L’immagine","ich_judgment":"Il giudizio","ich_line":"Linea {n}","ich_top":"(in alto)","iching_changing":"Linee mobili {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"In combinazione","len_meaning":"Significato","read_meaning":"Leggi il significato →","reflection":"Proposti per riflettere e divertirsi, non come previsione","reversed":"Rovesciata","rune_lore":"Tradizione","rune_reversed":"Rovesciata (merkstave)"},"readings":{"iching":"/data/reading-iching.it.01e41041.json","lenormand":"/data/reading-lenormand.it.f9195742.json","runes":"/data/reading-runes.it.2103bd0e.json","tarot":"/data/reading-tarot.it.5e7ad917.json"},"spin":"Gira ancora","title_generic":"Un risultato da Augura","titles":{"card":"Carta da gioco casuale","coin":"Testa o croce","color":"Colore casuale","date":"Data casuale","dice":"Lancio di dadi","groups":"Generatore di squadre","iChing":"I Ching","lenormand":"Estrazione Lenormand","letter":"Lettera casuale","list":"Ruota delle decisioni","number":"Numero casuale","omikuji":"Omikuji","rps":"Carta, forbici, sasso","runes":"Lancio delle rune","tarot":"Estrazione dei tarocchi","yesNo":"Sì o No"},"try":"Provalo anche tu","ui":{"app.card_body":"Tutto questo più 20 tradizioni oracolari, giochi di gruppo, widget, Centro di Controllo e Apple Watch.","app.card_title":"Augura per iPhone","badge.alt":"Scarica dall’App Store","badge.coming_soon":"In arrivo sull’App Store","badge.coming_soon_short":"In arrivo","footer.legal":"Nessun cookie, nessuna analisi, nessuna richiesta a terze parti.","footer.support":"Assistenza","nav.get_app":"Scarica l’app","nav.meanings":"Significati","nav.press":"Kit stampa","nav.skip":"Vai al contenuto","nav.tools":"Strumenti gratuiti","nav.web_app":"App web","privacy_link":"Informativa sulla privacy (in inglese)","tagline":"Una cassetta degli attrezzi calma e privata per il caso. Creata da Luca."}},"ja":{"back":"← 無料ツール一覧","badge":["/img/badges/ja.svg",109,40],"data":"/data/oracles.ja.d9278a92.json","free":"無料・登録不要","get_app":"iPhone用Auguraを入手","list_q":"Auguraで共有されたリストです。回してみましょう！","nothing":"まだ何もありません","rd":{"english_only":"（英語）","h_card":"カード","h_reversed":"逆位置の意味","h_upright":"正位置の意味","ich_bottom":"（一番下）","ich_image":"象（イメージ）","ich_judgment":"判断","ich_line":"{n}爻","ich_top":"（一番上）","iching_changing":"変爻 {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":"","len_combination":"組み合わせ","len_meaning":"意味","read_meaning":"意味を読む →","reflection":"ふり返りとエンターテインメントのための内容で、予言ではありません","reversed":"逆位置","rune_lore":"伝承","rune_reversed":"逆位置（メルクスターヴ）"},"readings":{"iching":"/data/reading-iching.ja.92c64111.json","lenormand":"/data/reading-lenormand.ja.7ea180f3.json","runes":"/data/reading-runes.ja.49a01798.json","tarot":"/data/reading-tarot.ja.c398fe9c.json"},"spin":"もう一度回す","title_generic":"Auguraの結果","titles":{"card":"ランダムなトランプ","coin":"コイントス","color":"ランダムなカラー","date":"ランダムな日付","dice":"サイコロ","groups":"チーム分け","iChing":"易経","lenormand":"ルノルマンカードを引く","letter":"ランダムな文字","list":"決定ルーレット","number":"ランダムな数字","omikuji":"おみくじ","rps":"じゃんけん","runes":"ルーンを引く","tarot":"タロットカードを引く","yesNo":"はい・いいえ"},"try":"自分でも試す","ui":{"app.card_body":"ここにあるものすべてに加え、20の占いの伝統、パーティーゲーム、ウィジェット、コントロールセンター、Apple Watchにも対応。","app.card_title":"iPhone用Augura","badge.alt":"App Storeからダウンロード","badge.coming_soon":"App Storeで近日公開","badge.coming_soon_short":"近日公開","footer.legal":"Cookieなし、解析なし、外部サービスへのリクエストなし。","footer.support":"サポート","nav.get_app":"アプリを入手","nav.meanings":"意味","nav.press":"プレスキット","nav.skip":"本文へスキップ","nav.tools":"無料ツール","nav.web_app":"Webアプリ","privacy_link":"プライバシーポリシー（英語）","tagline":"偶然のための、静かでプライベートな道具箱。制作：Luca"}},"ko":{"back":"← 모든 무료 도구","badge":["/img/badges/ko.svg",130,40],"data":"/data/oracles.ko.fbbf349a.json","free":"무료, 가입 필요 없음","get_app":"iPhone용 Augura 받기","list_q":"Augura에서 공유된 목록이에요. 돌려 보세요!","nothing":"아직 아무것도 없어요","rd":{"english_only":"(영어)","h_card":"카드","h_reversed":"역방향 의미","h_upright":"정방향 의미","ich_bottom":"(맨 아래)","ich_image":"상(象)","ich_judgment":"판단","ich_line":"{n}효","ich_top":"(맨 위)","iching_changing":"변하는 효 {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"조합","len_meaning":"의미","read_meaning":"의미 읽기 →","reflection":"성찰과 재미를 위한 것이며, 예언이 아니에요","reversed":"역방향","rune_lore":"전승","rune_reversed":"역방향 (메르크스타브)"},"readings":{"iching":"/data/reading-iching.ko.c5e0319c.json","lenormand":"/data/reading-lenormand.ko.4e2785a2.json","runes":"/data/reading-runes.ko.0a189081.json","tarot":"/data/reading-tarot.ko.f826155c.json"},"spin":"다시 돌리기","title_generic":"Augura에서 나온 결과","titles":{"card":"무작위 트럼프 카드","coin":"동전 던지기","color":"무작위 색상","date":"무작위 날짜","dice":"주사위 굴리기","groups":"팀 나누기","iChing":"주역","lenormand":"르노르망 카드 뽑기","letter":"무작위 문자","list":"결정 룰렛","number":"무작위 숫자","omikuji":"오미쿠지","rps":"가위바위보","runes":"룬 뽑기","tarot":"타로 카드 뽑기","yesNo":"예 또는 아니요"},"try":"직접 해 보기","ui":{"app.card_body":"이 모든 기능에 더해 점·운세 전통 20가지, 파티 게임, 위젯, 제어 센터, Apple Watch까지 있어요.","app.card_title":"iPhone용 Augura","badge.alt":"App Store에서 다운로드","badge.coming_soon":"App Store에 곧 출시","badge.coming_soon_short":"곧 출시","footer.legal":"쿠키 없음, 분석 없음, 외부 서버 요청 없음.","footer.support":"지원","nav.get_app":"앱 받기","nav.meanings":"의미","nav.press":"보도 자료","nav.skip":"본문으로 건너뛰기","nav.tools":"무료 도구","nav.web_app":"웹 앱","privacy_link":"개인정보 처리방침 (영어)","tagline":"우연을 위한 차분하고 프라이빗한 도구 상자. 만든 사람: Luca"}},"nl":{"back":"← Alle gratis tools","badge":["/img/badges/nl.svg",120,40],"data":"/data/oracles.nl.dc432c3b.json","free":"gratis, zonder aanmelding","get_app":"Download Augura voor iPhone","list_q":"Een lijst gedeeld vanuit Augura. Draai eraan!","nothing":"Hier staat nog niets","rd":{"english_only":"(Engels)","h_card":"De kaart","h_reversed":"Omgekeerde betekenis","h_upright":"Rechtopstaande betekenis","ich_bottom":"(onderaan)","ich_image":"Het beeld","ich_judgment":"Het oordeel","ich_line":"Lijn {n}","ich_top":"(bovenaan)","iching_changing":"Veranderlijke lijnen {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"In combinatie","len_meaning":"Betekenis","read_meaning":"Lees de betekenis →","reflection":"Bedoeld voor reflectie en vermaak, niet als voorspelling","reversed":"Omgekeerd","rune_lore":"Achtergrond","rune_reversed":"Omgekeerd (merkstave)"},"readings":{"iching":"/data/reading-iching.nl.251d1caa.json","lenormand":"/data/reading-lenormand.nl.94fc5e98.json","runes":"/data/reading-runes.nl.cd94ca65.json","tarot":"/data/reading-tarot.nl.2abdcf71.json"},"spin":"Nog een keer draaien","title_generic":"Een resultaat uit Augura","titles":{"card":"Willekeurige speelkaart","coin":"Kop of munt","color":"Willekeurige kleur","date":"Willekeurige datum","dice":"Dobbelstenen rollen","groups":"Teamgenerator","iChing":"I Tjing","lenormand":"Lenormand-kaart trekken","letter":"Willekeurige letter","list":"Beslissingswiel","number":"Willekeurig getal","omikuji":"Omikuji","rps":"Steen, papier, schaar","runes":"Runen werpen","tarot":"Tarotkaart trekken","yesNo":"Ja of nee"},"try":"Probeer het zelf","ui":{"app.card_body":"Dit alles plus 20 orakeltradities, partyspellen, widgets, Bedieningspaneel en Apple Watch.","app.card_title":"Augura voor iPhone","badge.alt":"Download in de App Store","badge.coming_soon":"Binnenkort in de App Store","badge.coming_soon_short":"Binnenkort","footer.legal":"Geen cookies, geen analyse, geen verzoeken aan derden.","footer.support":"Support","nav.get_app":"Download app","nav.meanings":"Betekenissen","nav.press":"Persmap","nav.skip":"Ga naar de inhoud","nav.tools":"Gratis tools","nav.web_app":"Web-app","privacy_link":"Privacybeleid (Engels)","tagline":"Een rustige, privacyvriendelijke gereedschapskist voor het toeval. Gemaakt door Luca."}},"pl":{"back":"← Wszystkie darmowe narzędzia","badge":["/img/badges/pl.svg",120,40],"data":"/data/oracles.pl.7690fc03.json","free":"za darmo, bez rejestracji","get_app":"Pobierz aplikację Augura na iPhone’a","list_q":"Lista udostępniona z Augura. Zakręć nią!","nothing":"Na razie nic tu nie ma","rd":{"english_only":"(po angielsku)","h_card":"Karta","h_reversed":"Znaczenie w pozycji odwróconej","h_upright":"Znaczenie w pozycji prostej","ich_bottom":"(dolna)","ich_image":"Obraz","ich_judgment":"Wyrok","ich_line":"Linia {n}","ich_top":"(górna)","iching_changing":"Zmienne linie {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"W połączeniu z innymi","len_meaning":"Znaczenie","read_meaning":"Przeczytaj znaczenie →","reflection":"Do refleksji i rozrywki, nie do przepowiadania przyszłości","reversed":"Odwrócona","rune_lore":"Podania","rune_reversed":"Odwrócona (merkstave)"},"readings":{"iching":"/data/reading-iching.pl.bcb0ab55.json","lenormand":"/data/reading-lenormand.pl.b5a8ad19.json","runes":"/data/reading-runes.pl.12829b25.json","tarot":"/data/reading-tarot.pl.743594ee.json"},"spin":"Zakręć jeszcze raz","title_generic":"Wynik z Augura","titles":{"card":"Losowa karta do gry","coin":"Rzut monetą","color":"Losowy kolor","date":"Losowa data","dice":"Rzut kośćmi","groups":"Losowanie drużyn","iChing":"I Ching","lenormand":"Losowanie karty Lenormand","letter":"Losowa litera","list":"Koło decyzji","number":"Losowa liczba","omikuji":"Omikuji","rps":"Kamień, papier, nożyce","runes":"Rzut runami","tarot":"Losowanie karty tarota","yesNo":"Tak czy nie"},"try":"Wypróbuj samodzielnie","ui":{"app.card_body":"Wszystko to oraz 20 tradycji wróżebnych, gry imprezowe, widżety, Centrum sterowania i Apple Watch.","app.card_title":"Augura na iPhone’a","badge.alt":"Pobierz z App Store","badge.coming_soon":"Wkrótce w App Store","badge.coming_soon_short":"Wkrótce","footer.legal":"Bez ciasteczek, bez analityki, bez połączeń z serwerami stron trzecich.","footer.support":"Pomoc","nav.get_app":"Pobierz","nav.meanings":"Znaczenia","nav.press":"Dla prasy","nav.skip":"Przejdź do treści","nav.tools":"Darmowe narzędzia","nav.web_app":"Aplikacja webowa","privacy_link":"Polityka prywatności (po angielsku)","tagline":"Spokojny, prywatny zestaw narzędzi do zabawy z losem. Stworzył Luca."}},"pt-BR":{"back":"← Todas as ferramentas grátis","badge":["/img/badges/pt-BR.svg",120,40],"data":"/data/oracles.pt-BR.cf72a66c.json","free":"grátis, sem cadastro","get_app":"Baixar o Augura para iPhone","list_q":"Uma lista compartilhada do Augura. Gire!","nothing":"Nada aqui ainda","rd":{"english_only":"(em inglês)","h_card":"A carta","h_reversed":"Significado invertido","h_upright":"Significado em pé","ich_bottom":"(embaixo)","ich_image":"A imagem","ich_judgment":"O julgamento","ich_line":"Linha {n}","ich_top":"(em cima)","iching_changing":"Linhas mutáveis {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"Em combinação","len_meaning":"Significado","read_meaning":"Ler o significado →","reflection":"Apresentado para reflexão e entretenimento, não como previsão","reversed":"Invertida","rune_lore":"Tradição","rune_reversed":"Invertida (merkstave)"},"readings":{"iching":"/data/reading-iching.pt-BR.695b8544.json","lenormand":"/data/reading-lenormand.pt-BR.871d5ea7.json","runes":"/data/reading-runes.pt-BR.c605aab0.json","tarot":"/data/reading-tarot.pt-BR.a9a6369e.json"},"spin":"Girar de novo","title_generic":"Um resultado do Augura","titles":{"card":"Carta de baralho aleatória","coin":"Cara ou coroa","color":"Cor aleatória","date":"Data aleatória","dice":"Rolador de dados","groups":"Gerador de equipes","iChing":"I Ching","lenormand":"Tiragem de Lenormand","letter":"Letra aleatória","list":"Roleta de decisão","number":"Número aleatório","omikuji":"Omikuji","rps":"Pedra, papel e tesoura","runes":"Lançamento de runas","tarot":"Tiragem de tarô","yesNo":"Sim ou não"},"try":"Experimente você mesmo","ui":{"app.card_body":"Tudo isso e mais 20 tradições de oráculos, jogos de festa, widgets, Central de Controle e Apple Watch.","app.card_title":"Augura para iPhone","badge.alt":"Baixar na App Store","badge.coming_soon":"Em breve na App Store","badge.coming_soon_short":"Em breve","footer.legal":"Sem cookies, sem análises, sem requisições a terceiros.","footer.support":"Suporte","nav.get_app":"Baixar o app","nav.meanings":"Significados","nav.press":"Kit de imprensa","nav.skip":"Ir para o conteúdo","nav.tools":"Ferramentas grátis","nav.web_app":"App web","privacy_link":"Política de Privacidade (em inglês)","tagline":"Uma caixa de ferramentas calma e privada para o acaso. Feito por Luca."}},"ru":{"back":"← Все бесплатные инструменты","badge":["/img/badges/ru.svg",120,40],"data":"/data/oracles.ru.c23a219e.json","free":"бесплатно, без регистрации","get_app":"Скачать Augura для iPhone","list_q":"Список, отправленный из Augura. Покрути его!","nothing":"Пока здесь ничего нет","rd":{"english_only":"(на английском)","h_card":"Карта","h_reversed":"Перевёрнутое значение","h_upright":"Прямое значение","ich_bottom":"(нижняя)","ich_image":"Образ","ich_judgment":"Приговор","ich_line":"Линия {n}","ich_top":"(верхняя)","iching_changing":"Изменяющиеся линии {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"В сочетании","len_meaning":"Значение","read_meaning":"Читать значение →","reflection":"Всё это — для размышлений и развлечения, а не для предсказаний","reversed":"Перевёрнутая","rune_lore":"Предания","rune_reversed":"Перевёрнутая (merkstave)"},"readings":{"iching":"/data/reading-iching.ru.b023b024.json","lenormand":"/data/reading-lenormand.ru.636de918.json","runes":"/data/reading-runes.ru.640b2187.json","tarot":"/data/reading-tarot.ru.0d09df2f.json"},"spin":"Крутить ещё раз","title_generic":"Результат из Augura","titles":{"card":"Случайная игральная карта","coin":"Подбросить монету","color":"Случайный цвет","date":"Случайная дата","dice":"Бросок кубиков","groups":"Генератор команд","iChing":"И‑цзин","lenormand":"Карта Ленорман","letter":"Случайная буква","list":"Колесо решений","number":"Случайное число","omikuji":"Омикудзи","rps":"Камень, ножницы, бумага","runes":"Гадание на рунах","tarot":"Карта Таро","yesNo":"Да или нет"},"try":"Попробуй тоже","ui":{"app.card_body":"Всё это и ещё 20 оракульных традиций, игры для компании, виджеты, Пункт управления и Apple Watch.","app.card_title":"Augura для iPhone","badge.alt":"Загрузите в App Store","badge.coming_soon":"Скоро в App Store","badge.coming_soon_short":"Скоро","footer.legal":"Без cookie, без аналитики, без обращений к сторонним серверам.","footer.support":"Поддержка","nav.get_app":"Скачать","nav.meanings":"Значения","nav.press":"Для прессы","nav.skip":"Перейти к содержимому","nav.tools":"Бесплатные инструменты","nav.web_app":"Веб-приложение","privacy_link":"Политика конфиденциальности (на английском)","tagline":"Спокойный и приватный набор инструментов, где всё решает случай. Автор: Luca."}},"sv":{"back":"← Alla gratisverktyg","badge":["/img/badges/sv.svg",120,40],"data":"/data/oracles.sv.fdcfdb80.json","free":"gratis, utan registrering","get_app":"Hämta Augura för iPhone","list_q":"En lista delad från Augura. Snurra på den!","nothing":"Inget här än","rd":{"english_only":"(engelska)","h_card":"Kortet","h_reversed":"Omvänd betydelse","h_upright":"Upprätt betydelse","ich_bottom":"(nederst)","ich_image":"Bilden","ich_judgment":"Domen","ich_line":"Linje {n}","ich_top":"(överst)","iching_changing":"Föränderliga linjer {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"I kombination","len_meaning":"Betydelse","read_meaning":"Läs betydelsen →","reflection":"Till för eftertanke och nöje, inte för förutsägelser","reversed":"Omvänd","rune_lore":"Bakgrund","rune_reversed":"Omvänd (merkstave)"},"readings":{"iching":"/data/reading-iching.sv.3592cf37.json","lenormand":"/data/reading-lenormand.sv.71b67f76.json","runes":"/data/reading-runes.sv.b39c4cd5.json","tarot":"/data/reading-tarot.sv.e0447357.json"},"spin":"Snurra igen","title_generic":"Ett resultat från Augura","titles":{"card":"Slumpmässigt spelkort","coin":"Myntkast","color":"Slumpmässig färg","date":"Slumpmässigt datum","dice":"Tärningskast","groups":"Lagindelare","iChing":"I Ching","lenormand":"Dra Lenormand-kort","letter":"Slumpmässig bokstav","list":"Beslutshjul","number":"Slumptal","omikuji":"Omikuji","rps":"Sten, sax, påse","runes":"Runkast","tarot":"Dra tarotkort","yesNo":"Ja eller nej"},"try":"Prova själv","ui":{"app.card_body":"Allt detta plus 20 orakeltraditioner, sällskapsspel, widgets, Kontrollcenter och Apple Watch.","app.card_title":"Augura för iPhone","badge.alt":"Hämta i App Store","badge.coming_soon":"Kommer snart till App Store","badge.coming_soon_short":"Kommer snart","footer.legal":"Inga cookies, ingen analys, inga förfrågningar till tredje part.","footer.support":"Support","nav.get_app":"Hämta appen","nav.meanings":"Betydelser","nav.press":"Pressmaterial","nav.skip":"Hoppa till innehållet","nav.tools":"Gratisverktyg","nav.web_app":"Webbapp","privacy_link":"Integritetspolicy (engelska)","tagline":"En lugn och privat verktygslåda för slumpen. Gjord av Luca."}},"tr":{"back":"← Tüm ücretsiz araçlar","badge":["/img/badges/tr.svg",151,40],"data":"/data/oracles.tr.df595f94.json","free":"ücretsiz, kayıt gerekmez","get_app":"iPhone için Augura’yı al","list_q":"Augura’dan paylaşılan bir liste. Çevir!","nothing":"Burada henüz bir şey yok","rd":{"english_only":"(İngilizce)","h_card":"Kart","h_reversed":"Ters anlamı","h_upright":"Düz anlamı","ich_bottom":"(alt)","ich_image":"İmge","ich_judgment":"Hüküm","ich_line":"Çizgi {n}","ich_top":"(üst)","iching_changing":"Değişen çizgiler {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":" ","len_combination":"Kombinasyonda","len_meaning":"Anlamı","read_meaning":"Anlamını oku →","reflection":"Düşünmen ve eğlenmen için sunulur; bir öngörü değildir","reversed":"Ters","rune_lore":"Efsane","rune_reversed":"Ters (merkstave)"},"readings":{"iching":"/data/reading-iching.tr.514ed942.json","lenormand":"/data/reading-lenormand.tr.5e783ebb.json","runes":"/data/reading-runes.tr.a4c02ff4.json","tarot":"/data/reading-tarot.tr.ff6c40a8.json"},"spin":"Tekrar çevir","title_generic":"Augura’dan bir sonuç","titles":{"card":"Rastgele İskambil Kartı","coin":"Yazı Tura","color":"Rastgele Renk","date":"Rastgele Tarih","dice":"Zar Atma","groups":"Takım Oluşturucu","iChing":"I Ching","lenormand":"Lenormand Kartı Çek","letter":"Rastgele Harf","list":"Karar Çarkı","number":"Rastgele Sayı","omikuji":"Omikuji","rps":"Taş Kâğıt Makas","runes":"Rün Atma","tarot":"Tarot Kartı Çek","yesNo":"Evet mi Hayır mı"},"try":"Sen de dene","ui":{"app.card_body":"Bunların hepsi, ayrıca 20 kehanet geleneği, parti oyunları, widget’lar, Denetim Merkezi ve Apple Watch.","app.card_title":"iPhone için Augura","badge.alt":"App Store’dan indir","badge.coming_soon":"Yakında App Store’da","badge.coming_soon_short":"Yakında","footer.legal":"Çerez yok, analiz yok, üçüncü taraflara istek yok.","footer.support":"Destek","nav.get_app":"Uygulamayı al","nav.meanings":"Anlamlar","nav.press":"Basın kiti","nav.skip":"İçeriğe geç","nav.tools":"Ücretsiz araçlar","nav.web_app":"Web uygulaması","privacy_link":"Gizlilik Politikası (İngilizce)","tagline":"Şansa ayrılmış sakin ve gizliliğine saygılı bir alet çantası. Luca tarafından yapıldı."}},"zh-Hans":{"back":"← 全部免费工具","badge":["/img/badges/zh-Hans.svg",109,40],"data":"/data/oracles.zh-Hans.7e2221c3.json","free":"免费，无需注册","get_app":"获取 iPhone 版 Augura","list_q":"这是从 Augura 分享的列表。转一转吧！","nothing":"这里还没有内容","rd":{"english_only":"（英文）","h_card":"牌面","h_reversed":"逆位含义","h_upright":"正位含义","ich_bottom":"（最下）","ich_image":"象辞","ich_judgment":"卦辞","ich_line":"第 {n} 爻","ich_top":"（最上）","iching_changing":"变爻 {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":"","len_combination":"组合含义","len_meaning":"含义","read_meaning":"阅读含义 →","reflection":"内容用于自我反思与娱乐，并非预测","reversed":"逆位","rune_lore":"传说","rune_reversed":"逆位（merkstave）"},"readings":{"iching":"/data/reading-iching.zh-Hans.f23f4842.json","lenormand":"/data/reading-lenormand.zh-Hans.a17a74f8.json","runes":"/data/reading-runes.zh-Hans.06efd9d5.json","tarot":"/data/reading-tarot.zh-Hans.bee06217.json"},"spin":"再转一次","title_generic":"来自 Augura 的结果","titles":{"card":"随机扑克牌","coin":"抛硬币","color":"随机颜色","date":"随机日期","dice":"掷骰子","groups":"随机分组","iChing":"易经","lenormand":"抽雷诺曼牌","letter":"随机字母","list":"决策转盘","number":"随机数字","omikuji":"御神签","rps":"石头剪刀布","runes":"卢恩符文占卜","tarot":"抽塔罗牌","yesNo":"是或否"},"try":"你也试试","ui":{"app.card_body":"以上全部功能，外加 20 种占卜传统、派对游戏、小组件、控制中心和 Apple Watch。","app.card_title":"iPhone 版 Augura","badge.alt":"在 App Store 下载","badge.coming_soon":"即将登陆 App Store","badge.coming_soon_short":"即将上线","footer.legal":"无 Cookie、无分析、无第三方请求。","footer.support":"支持","nav.get_app":"获取 App","nav.meanings":"含义","nav.press":"媒体资料","nav.skip":"跳到正文","nav.tools":"免费工具","nav.web_app":"网页版","privacy_link":"隐私政策（英文）","tagline":"安静、私密的“随机”工具箱。由 Luca 制作。"}},"zh-Hant":{"back":"← 全部免費工具","badge":["/img/badges/zh-Hant.svg",109,40],"data":"/data/oracles.zh-Hant.8ca5aa2a.json","free":"免費，不需註冊","get_app":"取得 iPhone 版 Augura","list_q":"這是從 Augura 分享的清單。轉一轉吧！","nothing":"這裡還沒有內容","rd":{"english_only":"（英文）","h_card":"牌面","h_reversed":"逆位含義","h_upright":"正位含義","ich_bottom":"（最下）","ich_image":"象辭","ich_judgment":"卦辭","ich_line":"第 {n} 爻","ich_top":"（最上）","iching_changing":"變爻 {list} → {m} · {name}","iching_result":"{n} · {name}","join_space":"","len_combination":"組合含義","len_meaning":"含義","read_meaning":"閱讀含義 →","reflection":"內容僅供自我省思與娛樂，並非預言","reversed":"逆位","rune_lore":"傳說","rune_reversed":"逆位（merkstave）"},"readings":{"iching":"/data/reading-iching.zh-Hant.069a35cd.json","lenormand":"/data/reading-lenormand.zh-Hant.b8346b41.json","runes":"/data/reading-runes.zh-Hant.6b78d652.json","tarot":"/data/reading-tarot.zh-Hant.03919577.json"},"spin":"再轉一次","title_generic":"來自 Augura 的結果","titles":{"card":"隨機撲克牌","coin":"擲硬幣","color":"隨機顏色","date":"隨機日期","dice":"擲骰子","groups":"隨機分組","iChing":"易經","lenormand":"抽雷諾曼牌","letter":"隨機字母","list":"決策轉盤","number":"隨機數字","omikuji":"御神籤","rps":"猜拳","runes":"盧恩符文占卜","tarot":"抽塔羅牌","yesNo":"是或否"},"try":"你也試試","ui":{"app.card_body":"以上全部功能，再加上 20 種占卜傳統、派對遊戲、小工具、控制中心和 Apple Watch。","app.card_title":"iPhone 版 Augura","badge.alt":"在 App Store 下載","badge.coming_soon":"即將登陸 App Store","badge.coming_soon_short":"即將上架","footer.legal":"無 Cookie、無分析、無第三方請求。","footer.support":"支援","nav.get_app":"取得 App","nav.meanings":"含義","nav.press":"媒體資料","nav.skip":"跳到內容","nav.tools":"免費工具","nav.web_app":"網頁版","privacy_link":"隱私權政策（英文）","tagline":"安靜、注重隱私的機率工具箱。由 Luca 製作。"}}};          // {lang: {strings..., titles: {mode: title}}}
  var TOOLS = {"card":"random-card.html","coin":"coin-flip.html","color":"random-color.html","date":"random-date.html","dice":"dice-roller.html","groups":"team-generator.html","iChing":"i-ching.html","lenormand":"lenormand-card.html","letter":"random-letter.html","list":"decision-wheel.html","number":"random-number.html","omikuji":"omikuji.html","rps":"rock-paper-scissors.html","runes":"rune-cast.html","tarot":"tarot-card.html","yesNo":"yes-or-no.html"};        // {mode: landing file}
  var PREFIX = {"de":"de/","en":"","es":"es/","fr":"fr/","it":"it/","ja":"ja/","ko":"ko/","nl":"nl/","pl":"pl/","pt-BR":"pt-br/","ru":"ru/","sv":"sv/","tr":"tr/","zh-Hans":"zh-hans/","zh-Hant":"zh-hant/"};    // {lang: "de/"}
  var lang = preferredLang() || "en";
  if (!R[lang]) lang = "en";
  var S = R[lang], P = PREFIX[lang] || "";
  if (lang !== "en") {
    document.documentElement.lang = lang;
    $("title").textContent = S.title_generic;
    $("spin").textContent = S.spin;
    $("try").textContent = S.try;
    $("free").textContent = S.free;
    $("back").textContent = S.back;
    $("back").href = "/" + P + "tools.html";
    // header, app card and footer in the same language (they carry data-i18n / data-href hooks)
    var ui = S.ui || {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (e) {
      var k = e.getAttribute("data-i18n"); if (ui[k]) e.textContent = ui[k];
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-href]"), function (e) {
      e.setAttribute("href", "/" + P + e.getAttribute("data-href"));
    });
    var badge = document.querySelector(".appcard .badge img");
    if (badge && S.badge) { badge.src = S.badge[0]; badge.width = S.badge[1]; badge.height = S.badge[2]; badge.alt = ui["badge.alt"] || badge.alt; }
  }
  // a second share link opened in the same tab only changes the #hash: show that result, not the old one
  window.addEventListener("hashchange", function () { location.reload(); });
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  var parts = location.hash.replace(/^#/, "").split("/");
  var mode = dec(parts[0] || "");
  if (Object.prototype.hasOwnProperty.call(TOOLS, mode)) {
    $("title").textContent = S.titles[mode];
    $("try").href = "/" + P + TOOLS[mode];
    document.title = S.titles[mode] + " · Augura";
  } else {
    $("try").href = "/" + P + "#get-the-app";
    $("try").textContent = S.get_app;
    $("free").hidden = true;
  }
  var items = mode === "list" && parts[1] ? parts[1].split(",").map(dec).filter(Boolean) : [];
  if (items.length) {
    var spin = function () { $("out").textContent = items[randInt(items.length)]; };
    $("question").textContent = S.list_q;
    $("items").textContent = items.join(" · ");
    $("spin").hidden = false;
    $("spin").onclick = spin;
    spin();
  } else if (parts[1] && mode !== "list") {
    var rest = parts.slice(2), code = null;
    if (CODE_MODES.indexOf(mode) >= 0 && rest.length && isShareCodePart(dec(rest[rest.length - 1]))) code = dec(rest.pop());
    $("out").textContent = dec(parts[1]);
    if (rest.join("/")) $("question").textContent = dec(rest.join("/"));
    if (code) readingFromCode(code);
  } else {
    $("out").textContent = S.nothing;
  }

  // ---- the reading behind a share code (docs/website.md, "Share links"). Today's display above stays whenever
  // anything is wrong (bad code, a file that does not load, a position outside the data); body[data-r] tells which one won.
  function setState(v) { document.body.setAttribute("data-r", v); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function getJson(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .catch(function () { return null; });
  }
  function meaningLink(file, hasPage) {
    var a = el("a", "read-more");
    if (hasPage) a.href = "/" + P + "meanings/" + file;
    else { a.href = "/meanings/" + file; a.hreflang = "en"; }
    a.textContent = S.rd.read_meaning + (hasPage ? "" : S.rd.join_space + S.rd.english_only);
    return a;
  }
  function showReading(box, blocks) {        // as the web app does under a draw (10-core.js)
    box.appendChild(el("p", "read-note", S.rd.reflection));
    var ul = el("ul", "res-list");
    blocks.forEach(function (b) {
      var li = el("li");
      if (b.title) li.appendChild(el("h3", "read-title", b.title));
      if (b.lead) li.appendChild(el("p", "read-kw", b.lead));
      if (b.kw) li.appendChild(el("p", "read-kw", b.kw));
      b.parts.forEach(function (p) { if (p[0]) li.appendChild(el("b", null, p[0])); li.appendChild(el("p", null, p[1])); });
      if (b.file) li.appendChild(meaningLink(b.file, b.has));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }
  function readingFromCode(code) {
    setState("plain");
    var sel = parseShareCode(mode, code);
    if (!sel || !window.fetch) return;
    setState("loading");
    var key = ({ tarot: "tarot", iChing: "iching", runes: "runes", lenormand: "lenormand" })[mode];
    getJson(S.data).then(function (data) {
      if (!data || data.v !== 1) return null;
      return (key && S.readings[key] ? getJson(S.readings[key]) : Promise.resolve(null)).then(function (rd) {
        var READ = {};
        if (key && rd && rd.v === 1 && Array.isArray(rd.items)) READ[key] = rd.items;
        if (!checkShareSelection(mode, sel, data)) return null;
        return oracleResult(mode, sel, S.rd, data, READ);
      });
    }).then(function (o) {
      if (!o) { setState("plain"); return; }
      var out = $("out"), det = $("detail"), box = $("reading");
      out.textContent = o.headline;                // in this visitor's language, from the code
      out.classList.toggle("long", o.headline.length > 24);
      o.lines.forEach(function (t) { det.appendChild(el("p", null, t)); });
      showReading(box, o.blocks);
      setState("reading");
    }).catch(function () {
      $("detail").textContent = ""; $("reading").textContent = "";
      setState("plain");
    });
  }
})();

})();
