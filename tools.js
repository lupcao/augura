// Shared helpers for the free generators. Randomness comes from crypto.getRandomValues.
function randInt(n) {
  // Uniform integer in [0, n) without modulo bias.
  var limit = Math.floor(4294967296 / n) * n;
  var buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}
function randRange(min, max) { return min + randInt(max - min + 1); }
function $(id) { return document.getElementById(id); }
