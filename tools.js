// Shared helpers for augura.fyi (also used by older pages). Randomness: crypto.getRandomValues,
// no modulo bias. Generated from site-src/js/rand.js by scripts/site/build.py.
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
