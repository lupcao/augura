// Node 22 fixture test: the checked-in bundle (../verifier.js, the file the page loads) must agree with
// Tests/Fixtures/drand/* (the same fixtures the native XCTests read).
//   cd site/verify/source && npm ci && npm run build && npm test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const verifyDir = join(here, "..", "..");
const drand = join(verifyDir, "..", "..", "Tests", "Fixtures", "drand");
const fixture = (name) => JSON.parse(readFileSync(join(drand, name), "utf8"));
const v = await import(join(verifyDir, "verifier.js"));

const vector = fixture("fair-draw-v1-vector.json");
const receipts = fixture("fair-draw-v1-receipts.json");
const beacon = fixture("quicknet-round-1.json");
// The app's own screen draw: link, tampers and shared receipt texts, checked against the app in FairDrawTests.
const app = JSON.parse(readFileSync(join(here, "fair-draw-app-screen.json"), "utf8"));

test("bundle matches its recorded SHA-256", () => {
  const recorded = readFileSync(join(verifyDir, "verifier.js.sha256"), "utf8").split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(join(verifyDir, "verifier.js"))).digest("hex");
  assert.equal(actual, recorded);
});

test("page code has no network calls", () => {
  for (const file of ["verifier.js", "ui.js"]) {
    const text = readFileSync(join(verifyDir, file), "utf8");
    for (const api of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "importScripts", "import("])
      assert.ok(!text.includes(api), `${file} contains ${api}`);
  }
  const html = readFileSync(join(verifyDir, "index.html"), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.ok(!/<script>/.test(html), "no inline scripts");
  assert.ok(!/<script[^>]+src="(https?:)?\/\//i.test(html), "no remote script");
  // Only stylesheets count as remote code; the canonical <link> is just the page's address.
  for (const link of html.match(/<link[^>]*>/gi) ?? [])
    if (/rel="stylesheet"/i.test(link)) assert.ok(!/href="(https?:)?\/\//i.test(link), `remote stylesheet: ${link}`);
});

test("pinned beacon constants", () => {
  assert.equal(v.CHAIN, beacon.chainHash);
  assert.equal(v.VERSION, vector.protocol);
  assert.equal(v.DST, "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_");
});

test("selection vector is recomputed, not copied", () => {
  const list = v.encodeList(vector.list);
  assert.equal(v.toHex(list), vector.canonicalListBytesHex);
  assert.equal(v.toHex(createHash("sha256").update(list).digest()), vector.listHash);
  assert.equal(v.toHex(v.beaconMessage(1)), vector.beaconVerificationMessageHex);
  const seed = v.seedFor(beacon.signature, vector.listHash);
  assert.equal(v.toHex(seed), vector.seed);
  assert.deepEqual(v.selectWinners(seed, 3, 3), vector.winnerIndicesForThreeWinners);
  assert.deepEqual(v.decodeList(list), vector.list.map((e) => ({ id: e.id, label: e.label.normalize("NFC") })));
});

test("drand beacon fixtures", () => {
  assert.equal(v.verifyBeacon(beacon.round, beacon.signature), true);
  for (const name of ["quicknet-round-1-invalid-signature.json", "quicknet-round-1-invalid-round.json"]) {
    const f = fixture(name);
    assert.equal(f.expectValid, false);
    assert.equal(v.verifyBeacon(f.round, f.signature), false, name);
  }
  assert.equal(v.verifyBeacon(0, beacon.signature), false);
  assert.equal(v.verifyBeacon(1, "00".repeat(48)), false);
  assert.equal(v.verifyBeacon(1, "ff".repeat(48)), false);
  assert.equal(v.verifyBeacon(1, "c0" + "00".repeat(47)), false);
  assert.equal(v.verifyBeacon(1, beacon.signature.toUpperCase()), false);
});

test("receipt payload is byte-identical to the shared fixture", () => {
  const receipt = JSON.parse(receipts.validReceiptCanonicalJSON);
  assert.equal(v.canonicalReceipt(receipt), receipts.validReceiptCanonicalJSON);
  assert.equal(
    v.verifierLink(receipt, vector.list),
    `${receipts.verifierURL}#r=${receipts.validReceiptB64url}&l=${receipts.listBytesB64url}`,
  );
  assert.equal(v.VERIFY_URL, receipts.verifierURL);
});

for (const c of receipts.cases) {
  test(`fixture case ${c.name}`, () => {
    const result = v.verifyLink(c.fragment);
    if (c.expect === "valid") {
      assert.equal(result.ok, true, `${result.error}: ${result.detail}`);
      assert.deepEqual(result.winners.map((w) => w.index), c.winnerIndices);
      assert.deepEqual(result.receipt.winnerIndices, c.winnerIndices);
      // Same result for the full link, with or without '#'.
      assert.equal(v.verifyLink(receipts.verifierURL + "#" + c.fragment).ok, true);
      assert.equal(v.verifyLink("#" + c.fragment).ok, true);
    } else {
      assert.equal(result.ok, false);
      assert.equal(result.error, c.error, result.detail);
      assert.equal(result.winners, undefined, "no winners for a failed link");
    }
  });
}

test("every receipt field and the list are covered by a failing case", () => {
  const tampered = new Set(receipts.cases.filter((c) => c.expect === "invalid").map((c) => c.tamperedField));
  for (const field of ["chain", "listHash", "round", "signature", "v", "winnerCount", "winnerIndices", "list"])
    assert.ok(tampered.has(field), field);
});

test("one-character tampering anywhere in the valid link fails", () => {
  const valid = receipts.cases.find((c) => c.name === "valid-three-winners").fragment;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let i = 0; i < valid.length; i++) {
    if (valid[i] === "=" || valid[i] === "&") continue;
    const ch = alphabet[(alphabet.indexOf(valid[i]) + 1) % 64];
    const result = v.verifyLink(valid.slice(0, i) + ch + valid.slice(i + 1));
    assert.equal(result.ok, false, `position ${i}`);
  }
});

const expectAppWinners = (result, what) => {
  assert.equal(result.ok, true, `${what}: ${result.error}: ${result.detail}`);
  assert.deepEqual(result.winners.map((w) => w.index), app.winners.map((w) => w.index), what);
  assert.deepEqual(result.winners.map((w) => w.label), app.winners.map((w) => w.label), what);
  assert.equal(result.receipt.round, 33342764, what);
};

test("the app's screen link verifies and its tampers fail with the expected code", () => {
  expectAppWinners(v.verifyLink(app.link), "link");
  expectAppWinners(v.verifyLink(app.link.split("#")[1]), "bare code");
  assert.equal(app.tampered.length, 4);
  for (const t of app.tampered) {
    const result = v.verifyLink(t.link);
    assert.equal(result.ok, false, t.name);
    assert.equal(result.error, t.error, `${t.name}: ${result.detail}`);
  }
});

test("a pasted receipt text verifies in any language, offline or online", () => {
  const langs = new Set(app.receiptTexts.map((t) => t.lang));
  for (const lang of ["en", "de"]) assert.ok(langs.has(lang), lang);
  for (const t of app.receiptTexts) {
    const what = `${t.lang} receipt${t.verifierOnline ? " with link" : ""}`;
    // The receipt's winners line ("#5 Echo") comes before the code: the first '#' must not decide.
    assert.ok(t.text.indexOf("#") < t.text.indexOf("r="), what);
    expectAppWinners(v.verifyLink(t.text), what);
    // Only the last line, as copied from a chat, with the translated label and surrounding whitespace.
    const last = t.text.trim().split("\n").at(-1);
    expectAppWinners(v.verifyLink("  " + last + "\n"), what + ", last line");
    if (t.verifierOnline) assert.ok(last.startsWith(v.VERIFY_URL + "#r="), what);
  }
});

test("a pasted receipt with a tampered code is still rejected", () => {
  const english = app.receiptTexts.find((t) => t.lang === "en" && !t.verifierOnline).text;
  const code = app.link.split("#")[1];
  for (const t of app.tampered) {
    const pasted = english.replace(code, t.link.split("#")[1]);
    assert.notEqual(pasted, english);
    const result = v.verifyLink(pasted);
    assert.equal(result.ok, false, t.name);
    assert.equal(result.error, t.error, t.name);
  }
  // The last code counts: a valid code followed by a tampered one fails.
  const result = v.verifyLink(english + "\n" + app.tampered[0].link);
  assert.equal(result.error, app.tampered[0].error);
  // Glued to other parameters or padded, the code is not taken.
  for (const bad of [english + "&x=1", english.replace("Verifier code: r=", "Verifier code: x=1&r="), english + "="])
    assert.equal(v.verifyLink(bad).error, "malformed-link");
});

test("malformed and oversized input fails gracefully", () => {
  const junk = [undefined, null, 42, {}, "", "#", "r=&l=", "r=a&l=a", "&&&", "r=" + "\u0000".repeat(10) + "&l=x",
    "r=" + "A".repeat(v.MAX_RECEIPT_CHARS + 1) + "&l=A", "x".repeat(2_000_000), "r=%41&l=%41",
    "r=" + v.b64urlEncode(new TextEncoder().encode('{"v":1}')) + "&l=AA"];
  for (const input of junk) {
    const result = v.verifyLink(input);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
  }
  assert.equal(v.verifyLink("x".repeat(2_000_000)).error, "too-large");
  // A list claiming MAX_ENTRIES + 1 entries is rejected before any entry is read.
  const big = new Uint8Array(29);
  big.set(new TextEncoder().encode("augura/fair-draw/list/v1"));
  new DataView(big.buffer).setUint32(25, v.MAX_ENTRIES + 1);
  assert.throws(() => v.decodeList(big), (e) => e.code === "too-large");
});

test("list encoding rules", () => {
  assert.throws(() => v.encodeList([{ id: "a", label: "x" }, { id: "a", label: "y" }]), (e) => e.code === "invalid-list");
  assert.throws(() => v.encodeList([{ id: "", label: "x" }]), (e) => e.code === "invalid-list");
  assert.throws(() => v.encodeList([{ id: "\ud800", label: "x" }]), (e) => e.code === "invalid-list");
  // NFC: a decomposed label encodes exactly like the composed one; duplicate labels are fine.
  const nfd = v.encodeList([{ id: "a", label: "Alfa" }, { id: "b", label: "Bravo" }, { id: "c", label: "Čar" }]);
  assert.equal(v.toHex(nfd), vector.canonicalListBytesHex);
  assert.doesNotThrow(() => v.encodeList([{ id: "1", label: "Same" }, { id: "2", label: "Same" }]));
});

test("base64url is strict", () => {
  assert.deepEqual([...v.b64urlDecode("AQID")], [1, 2, 3]);
  assert.equal(v.b64urlDecode("AQI="), null);
  assert.equal(v.b64urlDecode("AQJ"), null); // non-zero unused bits
  assert.equal(v.b64urlDecode("A"), null);
  assert.equal(v.b64urlDecode("+/8"), null);
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    assert.deepEqual([...v.b64urlDecode(v.b64urlEncode(bytes))], [...bytes]);
    assert.equal(v.b64urlEncode(bytes), Buffer.from(bytes).toString("base64url"));
  }
});
