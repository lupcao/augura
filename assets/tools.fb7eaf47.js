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

// Browser tools on eight guide pages: name picker, Secret Santa, tournament bracket, bingo caller, scoreboard (39.10), and
// truth or dare / would you rather, password and PIN, food picker (39.11). The last three read their data from a script of their
// own that loads with the page (window.auguraToolData, scripts/site/pages/webtools.py): no request is made by the tool.
// Every random choice comes from randInt / shuffle (rand.js is placed in front of this file by the build; both use
// crypto.getRandomValues without modulo bias). Nothing is sent anywhere and nothing is written to browser storage: the state
// lives in this page until it is closed or reloaded. Text the visitor types goes into the page with textContent only.
// The limits are read from data-* attributes that scripts/site/pages/webtools.py also prints in the words under each tool.
var wt = {};

// ---------- small helpers
function elt(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function textLines(s) {
  return String(s).split(/\r?\n/).map(function (x) { return x.replace(/\s+/g, " ").trim(); }).filter(function (x) { return x !== ""; });
}
function intAttr(root, name) { return parseInt(root.getAttribute("data-" + name), 10); }
function showError(id, msg) { var e = $(id); e.textContent = msg || ""; }
function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

// A button that needs a second press within 5 seconds when `needs()` says something would be lost.
function guarded(btn, armedText, needs, action) {
  var plain = btn.textContent, timer = 0;
  function disarm() { if (timer) clearTimeout(timer); timer = 0; btn.textContent = plain; btn.removeAttribute("data-armed"); }
  btn.addEventListener("click", function () {
    if (btn.getAttribute("data-armed")) { disarm(); action(); return; }
    if (!needs()) { action(); return; }
    btn.setAttribute("data-armed", "1"); btn.textContent = armedText;
    timer = setTimeout(disarm, 5000);
  });
}

// ---------- shared: the list of names
// o = { min, max, len, distinct, minMsg }; returns { names } or { error }
wt.parseNames = function (text, o) {
  var names = textLines(text), seen = Object.create(null), i, key;
  if (names.length < o.min) return { error: o.minMsg };
  if (names.length > o.max) return { error: "Please keep to " + o.max + " names or fewer. You typed " + names.length + "." };
  for (i = 0; i < names.length; i++) {
    if (names[i].length > o.len) return { error: "“" + names[i].slice(0, 20) + "…” is longer than " + o.len + " characters." };
    if (o.distinct) {
      key = names[i].toLowerCase();
      if (seen[key]) return { error: "“" + names[i] + "” is in the list twice. Use different names (add an initial if two people share one)." };
      seen[key] = true;
    }
  }
  return { names: names };
};

// ---------- 1. name picker
wt.pickNames = function (names, k) {            // k different lines, in the order drawn
  var idx = [], i;
  for (i = 0; i < names.length; i++) idx.push(i);
  shuffle(idx);
  return idx.slice(0, k).map(function (j) { return names[j]; });
};

function initName(root) {
  var go = $("wt-name-go"), out = $("wt-name-out");
  go.addEventListener("click", function () {
    clearNode(out); showError("wt-name-err", "");
    var r = wt.parseNames($("wt-name-list").value, { min: 1, max: intAttr(root, "max"), len: intAttr(root, "len"), distinct: false,
      minMsg: "Type at least one name, one per line." });
    if (r.error) { showError("wt-name-err", r.error); return; }
    var raw = $("wt-name-k").value.trim(), k = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (!(k >= 1 && k <= r.names.length)) { showError("wt-name-err", "Choose a whole number from 1 to " + r.names.length + "."); return; }
    var picked = wt.pickNames(r.names, k), ol = elt("ol", "wt-picked");
    picked.forEach(function (n) { ol.appendChild(elt("li", null, n)); });
    out.appendChild(elt("p", "wt-meta", "Picked " + k + " of " + plural(r.names.length, "name", "names") + ", in the order drawn:"));
    out.appendChild(ol);
  });
}

// ---------- 2. Secret Santa
// rules text -> { bad: n x n matrix of forbidden givers->recipients } or { error }
wt.parseRules = function (text, names) {
  var index = Object.create(null), bad = [], i, j, lines = textLines(text), line, kind, parts, a, b;
  for (i = 0; i < names.length; i++) { index[names[i].toLowerCase()] = i; bad.push([]); for (j = 0; j < names.length; j++) bad[i].push(false); }
  for (i = 0; i < lines.length; i++) {
    line = lines[i];
    kind = line.indexOf(">") >= 0 ? ">" : (line.indexOf("=") >= 0 ? "=" : "");
    parts = kind ? line.split(kind) : [];
    if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
      return { error: "Rule “" + line + "” should look like  Ana > Ben  (Ana cannot draw Ben) or  Ana = Ben  (neither can draw the other)." };
    }
    a = index[parts[0].trim().toLowerCase().replace(/\s+/g, " ")]; b = index[parts[1].trim().toLowerCase().replace(/\s+/g, " ")];
    if (a === undefined) return { error: "Rule “" + line + "”: “" + parts[0].trim() + "” is not in the list of names." };
    if (b === undefined) return { error: "Rule “" + line + "”: “" + parts[1].trim() + "” is not in the list of names." };
    bad[a][b] = true;
    if (kind === "=") bad[b][a] = true;
  }
  return { bad: bad };
};

// Randomized augmenting-path matching (the same idea as the app's draw): returns to[giver] = recipient, or null when the rules
// leave no valid draw. Terminates always: each giver tries each recipient at most once per search.
wt.santaDraw = function (n, bad) {
  var cand = [], givers = [], owner = [], g, r, c, i, seen;
  for (g = 0; g < n; g++) {
    c = [];
    for (r = 0; r < n; r++) if (r !== g && !(bad[g] && bad[g][r])) c.push(r);
    shuffle(c); cand.push(c); givers.push(g); owner.push(-1);
  }
  shuffle(givers);
  function assign(giver) {
    var list = cand[giver], k, rec;
    for (k = 0; k < list.length; k++) {
      rec = list[k];
      if (seen[rec]) continue;
      seen[rec] = true;
      if (owner[rec] < 0 || assign(owner[rec])) { owner[rec] = giver; return true; }
    }
    return false;
  }
  for (i = 0; i < givers.length; i++) {
    seen = [];
    if (!assign(givers[i])) return null;
  }
  var to = [];
  for (r = 0; r < n; r++) to[owner[r]] = r;
  return to;
};

function initSanta(root) {
  var setup = $("wt-santa-setup"), play = $("wt-santa-play"), people = $("wt-santa-people"), card = $("wt-santa-card"),
      line = $("wt-santa-line"), progress = $("wt-santa-progress"), names = [], to = [], seen = [], current = -1;
  function hideCard() {
    var was = current;
    current = -1; card.hidden = true; clearNode(line); people.hidden = false;
    if (was >= 0) { var b = people.children[was] && people.children[was].firstChild; if (b && b.focus) b.focus(); }
  }
  function showFor(i) {
    current = i; seen[i] = true;
    line.textContent = names[i] + ", you give to " + names[to[i]] + ".";
    people.hidden = true; card.hidden = false; $("wt-santa-hide").focus();
    updateProgress();
  }
  function updateProgress() {
    var done = seen.filter(Boolean).length;
    progress.textContent = done + " of " + names.length + " have seen their match.";
    for (var i = 0; i < people.children.length; i++) people.children[i].firstChild.className = "wt-person" + (seen[i] ? " done" : "");
  }
  $("wt-santa-go").addEventListener("click", function () {
    showError("wt-santa-err", "");
    var lo = intAttr(root, "min"), hi = intAttr(root, "max");
    var r = wt.parseNames($("wt-santa-names").value, { min: lo, max: hi, len: intAttr(root, "len"), distinct: true,
      minMsg: "Secret Santa needs at least " + lo + " names, one per line." });
    if (r.error) { showError("wt-santa-err", r.error); return; }
    for (var i = 0; i < r.names.length; i++) {
      if (/[>=]/.test(r.names[i])) { showError("wt-santa-err", "“" + r.names[i] + "” contains > or =, which are used for rules. Please rename it."); return; }
    }
    var rules = wt.parseRules($("wt-santa-rules").value, r.names);
    if (rules.error) { showError("wt-santa-err", rules.error); return; }
    var result = wt.santaDraw(r.names.length, rules.bad);
    if (!result) {
      showError("wt-santa-err", "No draw can follow these rules: someone would have nobody left to give to. Remove a rule or add a person, then press Draw again.");
      return;
    }
    names = r.names; to = result; seen = names.map(function () { return false; }); current = -1;
    clearNode(people);
    names.forEach(function (n, idx) {
      var li = elt("li"), b = elt("button", "wt-person", n);
      b.type = "button";
      b.addEventListener("click", function () { showFor(idx); });
      li.appendChild(b); people.appendChild(li);
    });
    updateProgress(); hideCard();
    setup.hidden = true; play.hidden = false;
    var first = people.firstChild && people.firstChild.firstChild; if (first) first.focus();
  });
  $("wt-santa-hide").addEventListener("click", hideCard);
  guarded($("wt-santa-reset"), "Press again to discard this draw", function () { return names.length > 0; }, function () {
    names = []; to = []; seen = []; current = -1; hideCard(); clearNode(people);
    play.hidden = true; setup.hidden = false; $("wt-santa-go").focus();
  });
  // leaving the tab or app hides a shown match
  document.addEventListener("visibilitychange", function () { if (document.hidden && current >= 0) hideCard(); });
}

// ---------- 3. tournament bracket (single elimination)
// seed order of a bracket of `size` places (a power of two): 1 meets size, 2 meets size-1, ... the usual layout
wt.seedOrder = function (size) {
  var order = [1, 2], next, m;
  while (order.length < size) {
    next = []; m = order.length * 2 + 1;
    order.forEach(function (s) { next.push(s, m - s); });
    order = next;
  }
  return order;
};
// names are already in random seed order. A match is { a, b, w }: positions in names (null = not known yet, or a bye), w = winner or null.
wt.makeBracket = function (names) {
  var n = names.length, size = 2, order, rounds = [], first = [], i, len, round;
  while (size < n) size *= 2;
  order = wt.seedOrder(size);
  for (i = 0; i < size / 2; i++) {
    var a = order[2 * i] - 1, b = order[2 * i + 1] - 1;
    first.push({ a: a < n ? a : null, b: b < n ? b : null, w: null });
  }
  rounds.push(first);
  for (len = size / 4; len >= 1; len /= 2) {
    round = [];
    for (i = 0; i < len; i++) round.push({ a: null, b: null, w: null });
    rounds.push(round);
  }
  var br = { names: names, size: size, rounds: rounds };
  wt.settle(br);
  return br;
};
// fill in who plays whom from the winners so far; a bye wins by itself; a winner who no longer plays is cleared
wt.settle = function (br) {
  var r, i, m, prev;
  for (r = 0; r < br.rounds.length; r++) {
    for (i = 0; i < br.rounds[r].length; i++) {
      m = br.rounds[r][i];
      if (r > 0) { prev = br.rounds[r - 1]; m.a = prev[2 * i].w; m.b = prev[2 * i + 1].w; }
      if (m.w !== null && m.w !== m.a && m.w !== m.b) m.w = null;
      if (r === 0 && (m.a === null) !== (m.b === null)) m.w = m.a !== null ? m.a : m.b;
    }
  }
};
// tap a name: it becomes the match's winner; tap the winner again to undo. Returns true when something changed.
wt.choose = function (br, r, i, who) {
  var m = br.rounds[r][i];
  if (who === null || (who !== m.a && who !== m.b)) return false;
  if (r === 0 && (m.a === null || m.b === null)) return false;      // a bye is not a choice
  m.w = m.w === who ? null : who;
  wt.settle(br);
  return true;
};
wt.champion = function (br) { var last = br.rounds[br.rounds.length - 1][0]; return last.w; };
wt.roundName = function (r, total) {
  if (r === total - 1) return "Final";
  if (r === total - 2) return "Semifinals";
  if (r === total - 3) return "Quarterfinals";
  return "Round " + (r + 1);
};

function initBracket(root) {
  var out = $("wt-br-out"), br = null;
  function started() {
    if (!br) return false;
    return br.rounds.some(function (round, r) {
      return round.some(function (m) { return m.w !== null && !(r === 0 && (m.a === null || m.b === null)); });
    });
  }
  function render(focusKey) {
    clearNode(out);
    br.rounds.forEach(function (round, r) {
      var sec = elt("section", "wt-round"), ol = elt("ol", "wt-matches");
      sec.appendChild(elt("h3", null, wt.roundName(r, br.rounds.length)));
      round.forEach(function (m, i) {
        var li = elt("li", "wt-match");
        if (r === 0 && (m.a === null || m.b === null)) {
          li.appendChild(elt("span", "wt-bye", br.names[m.w] + " has a bye and goes straight through."));
        } else {
          li.appendChild(side(m, r, i, m.a)); li.appendChild(elt("span", "wt-vs", "vs")); li.appendChild(side(m, r, i, m.b));
        }
        ol.appendChild(li);
      });
      sec.appendChild(ol); out.appendChild(sec);
    });
    var champ = wt.champion(br);
    $("wt-br-champ").textContent = champ === null ? "" : "Champion: " + br.names[champ];
    if (focusKey) { var f = out.querySelector('[data-key="' + focusKey + '"]'); if (f) f.focus(); }
  }
  function side(m, r, i, who) {
    var b;
    if (who === null) { b = elt("button", "wt-side tbd", "To be decided"); b.type = "button"; b.disabled = true; return b; }
    b = elt("button", "wt-side" + (m.w === who ? " win" : (m.w !== null ? " lose" : "")), br.names[who]);
    b.type = "button"; b.setAttribute("aria-pressed", m.w === who ? "true" : "false");
    var key = r + "-" + i + "-" + who;
    b.setAttribute("data-key", key);
    b.addEventListener("click", function () { if (wt.choose(br, r, i, who)) render(key); });
    return b;
  }
  var go = $("wt-br-go");
  guarded(go, "Press again to start a new bracket", started, function () {
    showError("wt-br-err", "");
    var lo = intAttr(root, "min");
    var r = wt.parseNames($("wt-br-names").value, { min: lo, max: intAttr(root, "max"), len: intAttr(root, "len"), distinct: true,
      minMsg: "A bracket needs at least " + lo + " names, one per line." });
    if (r.error) { showError("wt-br-err", r.error); return; }
    br = wt.makeBracket(shuffle(r.names.slice()));
    var byes = br.size - br.names.length;
    $("wt-br-sum").textContent = plural(br.names.length, "name", "names") + " in a bracket of " + br.size + " places, " +
      (byes === 0 ? "no byes" : plural(byes, "bye", "byes")) + ". Seeds were drawn at random. Tap the winner of each match.";
    render("");
  });
}

// ---------- 4. bingo caller
wt.bingoLetter = function (n) { return "BINGO".charAt(Math.floor((n - 1) / 15)); };
wt.bingoPool = function (size) { var a = [], i; for (i = 1; i <= size; i++) a.push(i); return a; };
wt.bingoCall = function (remaining) { return remaining.splice(randInt(remaining.length), 1)[0]; };

function initBingo(root) {
  var pools = root.getAttribute("data-pools").split(",").map(Number), size = pools[0], remaining, called, cells;
  var last = $("wt-bingo-last"), count = $("wt-bingo-count"), recent = $("wt-bingo-recent"), board = $("wt-bingo-board"), go = $("wt-bingo-go");
  var seg = $("wt-bingo-pool"), segBtns = seg.querySelectorAll("button");
  function label(n) { return size === 75 ? wt.bingoLetter(n) + " " + n : String(n); }
  function reset() {
    remaining = wt.bingoPool(size); called = []; cells = {};
    clearNode(board);
    for (var n = 1; n <= size; n++) { var li = elt("li", null, String(n)); cells[n] = li; board.appendChild(li); }
    last.textContent = "Press Call next ball"; recent.textContent = "";
    refresh();
  }
  function refresh() {
    count.textContent = called.length + " of " + size + " called";
    go.disabled = remaining.length === 0;
    for (var i = 0; i < segBtns.length; i++) {
      segBtns[i].setAttribute("aria-pressed", String(parseInt(segBtns[i].getAttribute("data-v"), 10) === size));
      segBtns[i].disabled = called.length > 0;
    }
  }
  go.addEventListener("click", function () {
    if (!remaining.length) return;
    var n = wt.bingoCall(remaining);             // chosen first; the display only shows it
    called.push(n);
    cells[n].className = "on"; cells[n].appendChild(elt("span", "wt-sr", " called"));
    last.textContent = label(n);
    recent.textContent = called.length > 1 ? "Before that: " + called.slice(-6, -1).reverse().map(label).join(", ") : "";
    if (!remaining.length) last.textContent = label(n) + " – that was the last number";
    refresh();
  });
  for (var i = 0; i < segBtns.length; i++) {
    segBtns[i].addEventListener("click", function () {
      var v = parseInt(this.getAttribute("data-v"), 10);
      if (called.length || v === size || pools.indexOf(v) < 0) return;
      size = v; reset();
    });
  }
  guarded($("wt-bingo-new"), "Press again to clear the board", function () { return called.length > 0; }, reset);
  reset();
}

// ---------- 5. scoreboard
function initScore(root) {
  var min = intAttr(root, "min"), max = intAttr(root, "max"), undoMax = intAttr(root, "undo");
  var list = $("wt-score-list"), nOut = $("wt-score-n"), firstOut = $("wt-score-first");
  var names = [], scores = [], undo = [], rows = [], first = -1;
  function nameOf(i) { return names[i] && names[i].trim() ? names[i].trim() : "Player " + (i + 1); }
  function snapshot() { undo.push(scores.slice()); if (undo.length > undoMax) undo.shift(); refreshUndo(); }
  function refreshUndo() { $("wt-score-undo").disabled = undo.length === 0; }
  function paint() {
    for (var i = 0; i < rows.length; i++) {
      rows[i].score.textContent = String(scores[i]);
      rows[i].li.className = "wt-player" + (first === i ? " first" : "");
      rows[i].btns.forEach(function (b) { b.btn.setAttribute("aria-label", b.text + " for " + nameOf(i)); });
    }
    nOut.textContent = String(scores.length);
    $("wt-score-minus").disabled = scores.length <= min;
    $("wt-score-plus").disabled = scores.length >= max;
    firstOut.textContent = first >= 0 ? nameOf(first) + " goes first." : "";
  }
  function build() {
    clearNode(list); rows = [];
    scores.forEach(function (s, i) {
      var li = elt("li"), input = elt("input", "wt-name"), score = elt("output", "wt-score"), btns = [];
      input.type = "text"; input.value = names[i]; input.maxLength = 40; input.autocomplete = "off"; input.spellcheck = false;
      input.setAttribute("aria-label", "Name of player " + (i + 1));
      input.addEventListener("input", function () { names[i] = input.value; paint(); });
      li.appendChild(input); li.appendChild(score);
      [["−1", -1], ["+1", 1], ["+5", 5]].forEach(function (d) {
        var b = elt("button", "wt-delta", d[0]);
        b.type = "button";
        b.addEventListener("click", function () { snapshot(); scores[i] += d[1]; paint(); });
        btns.push({ btn: b, text: d[0] === "−1" ? "Minus 1" : "Plus " + d[1] }); li.appendChild(b);
      });
      list.appendChild(li); rows.push({ li: li, score: score, btns: btns });
    });
    paint();
  }
  for (var i = 0; i < 4; i++) { names.push("Player " + (i + 1)); scores.push(0); }
  $("wt-score-plus").addEventListener("click", function () {
    if (scores.length >= max) return;
    names.push("Player " + (scores.length + 1)); scores.push(0); undo = []; refreshUndo(); build();
  });
  $("wt-score-minus").addEventListener("click", function () {
    if (scores.length <= min) return;
    names.pop(); scores.pop(); undo = []; if (first >= scores.length) first = -1; refreshUndo(); build();
  });
  $("wt-score-undo").addEventListener("click", function () { if (undo.length) { scores = undo.pop(); refreshUndo(); paint(); } });
  $("wt-score-first-go").addEventListener("click", function () { first = randInt(scores.length); paint(); });
  $("wt-score-reset").addEventListener("click", function () { snapshot(); scores = scores.map(function () { return 0; }); paint(); });
  refreshUndo(); build();
}

// ---------- 6. truth or dare and would you rather (39.11)
// A deck is shuffled once and walked through; when every card has been used it is shuffled again, and its first card is never the
// one just seen. nextCard returns the position of the card in deck.items.
wt.makeDeck = function (items) { return { items: items, order: [], pos: 0, last: -1 }; };
wt.nextCard = function (deck) {
  var n = deck.items.length, i, j, t;
  if (deck.pos >= deck.order.length) {
    deck.order = [];
    for (i = 0; i < n; i++) deck.order.push(i);
    shuffle(deck.order);
    if (n > 1 && deck.order[0] === deck.last) { j = 1 + randInt(n - 1); t = deck.order[0]; deck.order[0] = deck.order[j]; deck.order[j] = t; }
    deck.pos = 0;
  }
  deck.last = deck.order[deck.pos++];
  return deck.last;
};
wt.cardsLeft = function (deck) { return deck.order.length - deck.pos; };

function initParty(root, data) {
  var decks = {}, nouns = { "truth": "Truth", "dare": "Dare", "would-you-rather": "Would you rather" };
  var card = $("wt-party-card"), kind = $("wt-party-kind"), line = $("wt-party-line"), left = $("wt-party-left");
  Object.keys(nouns).forEach(function (id) {
    decks[id] = wt.makeDeck(data[id]);
    $("wt-party-" + id).addEventListener("click", function () {
      var d = decks[id], i = wt.nextCard(d);          // chosen first; the display only shows it
      kind.textContent = nouns[id]; line.textContent = d.items[i]; card.hidden = false;
      var n = wt.cardsLeft(d);
      left.textContent = n === 0 ? "That was the last card of this deck: the next press shuffles it again."
                                 : plural(n, "card", "cards") + " left in this deck before it shuffles again.";
    });
  });
}

// ---------- 7. password, PIN, passphrase, UUID (39.11)
wt.passphrase = function (words, n) { var out = [], i; for (i = 0; i < n; i++) out.push(words[randInt(words.length)]); return out.join("-"); };
wt.pin = function (n) { var out = "", i; for (i = 0; i < n; i++) out += String(randInt(10)); return out; };
wt.password = function (chars, n) { var out = "", i; for (i = 0; i < n; i++) out += chars.charAt(randInt(chars.length)); return out; };
wt.uuid = function () {                     // version 4: 122 random bits, the version and variant bits are fixed
  var b = [], i, h = "";
  for (i = 0; i < 16; i++) b.push(randInt(256));
  b[6] = 0x40 | (b[6] & 0x0f); b[8] = 0x80 | (b[8] & 0x3f);
  for (i = 0; i < 16; i++) { h += (b[i] < 16 ? "0" : "") + b[i].toString(16); if (i === 3 || i === 5 || i === 7 || i === 9) h += "-"; }
  return h;
};
wt.codeLength = function (raw, min, max) {  // a whole number from min to max, or null
  var t = String(raw).trim();
  if (!/^\d+$/.test(t)) return null;
  var n = parseInt(t, 10);
  return n >= min && n <= max ? n : null;
};

function initCodes(root, data) {
  var min = intAttr(root, "min"), max = intAttr(root, "max");
  var lens = { passphrase: intAttr(root, "default-passphrase"), pin: intAttr(root, "default-pin"), password: intAttr(root, "default-password") };
  var labels = { passphrase: "Number of words", pin: "Number of digits", password: "Number of characters" };
  var kind = "passphrase", seg = $("wt-code-kind"), btns = seg.querySelectorAll("button"), len = $("wt-code-len"), out = $("wt-code-out");
  function sync() {
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-pressed", String(btns[i].getAttribute("data-v") === kind));
    $("wt-code-lenrow").hidden = kind === "uuid";
    if (kind !== "uuid") { $("wt-code-lenlabel").textContent = labels[kind]; len.value = String(lens[kind]); }
    showError("wt-code-err", "");
  }
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener("click", function () {
      if (kind !== "uuid") { var keep = wt.codeLength(len.value, min, max); if (keep !== null) lens[kind] = keep; }
      kind = this.getAttribute("data-v"); sync();
    });
  }
  $("wt-code-go").addEventListener("click", function () {
    showError("wt-code-err", "");
    var n = 0;
    if (kind !== "uuid") {
      n = wt.codeLength(len.value, min, max);
      if (n === null) { showError("wt-code-err", "Choose a whole number from " + min + " to " + max + "."); return; }
      lens[kind] = n;
    }
    out.value = kind === "passphrase" ? wt.passphrase(data.words, n) : kind === "pin" ? wt.pin(n) : kind === "password" ? wt.password(data.chars, n) : wt.uuid();
    out.focus(); out.select();
  });
  out.addEventListener("focus", function () { out.select(); });
  $("wt-code-clear").addEventListener("click", function () { out.value = ""; showError("wt-code-err", ""); });
  sync();
}

// ---------- 8. food picker (39.11)
wt.foodPool = function (items, diets, diet, group) {
  var allowed = diets[diet] || [];
  return items.filter(function (f) { return allowed.indexOf(f.group) >= 0 && (group === "all" || f.group === group); });
};
wt.pickFood = function (pool, avoidId) {      // every eligible food is equally likely; the previous one is skipped when another is left
  var eligible = pool.length > 1 ? pool.filter(function (f) { return f.id !== avoidId; }) : pool;
  return eligible.length ? eligible[randInt(eligible.length)] : null;
};

function initFood(root, data) {
  var diet = $("wt-food-diet"), group = $("wt-food-group"), card = $("wt-food-card"), count = $("wt-food-count"), last = "";
  var label = {};
  data.groups.forEach(function (g) { label[g[0]] = g[1]; });
  function pool() { return wt.foodPool(data.items, data.diets, diet.value, group.value); }
  function refresh() {
    var p = pool(), dietName = diet.options[diet.selectedIndex].text.toLowerCase();
    showError("wt-food-err", "");
    count.textContent = p.length ? "Choosing from " + p.length + " of " + data.items.length + " foods." : "";
    if (!p.length) showError("wt-food-err", "No food in that category fits a " + dietName + " choice. Choose another category or ingredients.");
  }
  diet.addEventListener("change", refresh); group.addEventListener("change", refresh);
  $("wt-food-go").addEventListener("click", function () {
    var p = pool(), f;
    refresh();
    if (!p.length) { card.hidden = true; return; }
    f = wt.pickFood(p, last); last = f.id;
    $("wt-food-name").textContent = f.name; $("wt-food-cat").textContent = "Category: " + label[f.group];
    card.hidden = false;
  });
  refresh();
}

// ---------- start whatever tool this page has
(function () {
  var root = document.querySelector("section.wtool[data-wt]");
  if (!root) return;
  var ui = root.querySelector(".wt-ui"), key = root.getAttribute("data-wt");
  var init = { name: initName, secretSanta: initSanta, bracket: initBracket, bingo: initBingo, scoreboard: initScore,
               party: initParty, codes: initCodes, food: initFood }[key];
  if (!init || !ui) return;
  var data = (window.auguraToolData || {})[key];
  if (key === "party" || key === "codes" || key === "food") {       // these three need their data script
    if (!data) { root.insertBefore(elt("p", "wt-err", "This tool's data did not load. Reload the page to try again."), ui); return; }
  }
  init(root, data);
  ui.hidden = false;
})();
window.auguraTools = wt;      // the pure logic, for scripts/site's browser tests

})();
