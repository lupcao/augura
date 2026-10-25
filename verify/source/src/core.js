// Augura Fair Draw verifier, protocol augura.fair-draw.v1 (docs/fair-draw-protocol.md in the app repository).
// Pure functions, no DOM and no network: the page (../../ui.js) and the Node fixture tests import the same
// bundle built from this file. Nothing here fetches anything; the beacon key and chain are compiled in.
import { bls12_381 } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const VERSION = "augura.fair-draw.v1";
export const CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
export const PUBLIC_KEY =
  "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a";
export const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
export const GENESIS = 1692803367;
export const PERIOD = 3;
export const VERIFY_URL = "https://augura.fyi/verify/";

// Verifier limits (larger links fail as "too-large" before anything is decoded).
export const MAX_RECEIPT_CHARS = 131072;
export const MAX_LIST_CHARS = 524288;
export const MAX_ENTRIES = 10000;

const LIST_PREFIX = "augura/fair-draw/list/v1";
const WINNER_PREFIX = "augura/fair-draw/winner/v1";
const KEYS = ["chain", "listHash", "round", "signature", "v", "winnerCount", "winnerIndices"];
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const utf8 = new TextEncoder();

export class VerifyError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}
const fail = (code, detail) => { throw new VerifyError(code, detail); };

// ---- bytes ----

export function toHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Strict lowercase hex of an exact byte length. */
export function fromHex(text, length) {
  if (typeof text !== "string" || text.length !== length * 2 || !/^[0-9a-f]*$/.test(text)) return null;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = parseInt(text.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function uint32be(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

export function b64urlEncode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

/** Unpadded base64url; rejects padding, other alphabets and non-zero unused bits (one spelling per value). */
export function b64urlDecode(text) {
  if (typeof text !== "string" || text.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0, value = 0, at = 0;
  for (const ch of text) {
    value = (value << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[at++] = (value >> bits) & 255; }
  }
  if ((value & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

// ---- list ----

/** listBytes for entries [{id, label}] (NFC-normalized, user order kept). */
export function encodeList(entries) {
  if (!Array.isArray(entries) || entries.length > 0xffffffff) fail("invalid-list");
  const parts = [utf8.encode(LIST_PREFIX), new Uint8Array([0]), uint32be(entries.length)];
  const seen = new Set();
  for (const e of entries) {
    const id = String(e.id).normalize("NFC"), label = String(e.label).normalize("NFC");
    if (!id || seen.has(id)) fail("invalid-list", "empty or duplicate id");
    seen.add(id);
    for (const field of [id, label]) {
      if (!field.isWellFormed()) fail("invalid-list", "invalid Unicode");
      const raw = utf8.encode(field);
      parts.push(uint32be(raw.length), raw);
    }
  }
  return concat(...parts);
}

/** Decode canonical listBytes; rejects anything encodeList would not produce. */
export function decodeList(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prefix = utf8.encode(LIST_PREFIX);
  if (bytes.length < prefix.length + 5) fail("invalid-list", "too short");
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) fail("invalid-list", "unknown list version");
  if (bytes[prefix.length] !== 0) fail("invalid-list", "unknown list version");
  let at = prefix.length + 1;
  const count = view.getUint32(at);
  at += 4;
  if (count < 1) fail("invalid-list", "empty list");
  if (count > MAX_ENTRIES) fail("too-large", "too many entries");
  const readField = () => {
    if (at + 4 > bytes.length) fail("invalid-list", "truncated");
    const length = view.getUint32(at);
    at += 4;
    if (length > bytes.length - at) fail("invalid-list", "truncated");
    let value;
    try { value = text.decode(bytes.subarray(at, at + length)); } catch { fail("invalid-list", "not UTF-8"); }
    at += length;
    if (value.normalize("NFC") !== value) fail("invalid-list", "not NFC");
    return value;
  };
  const entries = [], seen = new Set();
  for (let i = 0; i < count; i++) {
    const id = readField(), label = readField();
    if (!id) fail("invalid-list", "empty id");
    if (seen.has(id)) fail("invalid-list", "duplicate id");
    seen.add(id);
    entries.push({ id, label });
  }
  if (at !== bytes.length) fail("invalid-list", "bytes after the last entry");
  return entries;
}

// ---- receipt ----

/** RFC 8785 serialization of a receipt v1 object (fixed key order, integers, ASCII strings). */
export function canonicalReceipt(r) {
  const value = (k) => (k === "winnerIndices" ? "[" + r[k].map((n) => String(n)).join(",") + "]" : JSON.stringify(r[k]));
  return "{" + KEYS.map((k) => JSON.stringify(k) + ":" + value(k)).join(",") + "}";
}

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** Parse a receipt from its bytes; field checks first, then byte-for-byte canonical form. */
export function parseReceipt(bytes) {
  let json, object;
  try { json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail("invalid-receipt", "not UTF-8"); }
  try { object = JSON.parse(json); } catch { fail("invalid-receipt", "not JSON"); }
  if (!object || typeof object !== "object" || Array.isArray(object)) fail("invalid-receipt", "not an object");
  const keys = Object.keys(object).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) fail("invalid-receipt", "unexpected fields");
  if (object.v !== VERSION) fail("unsupported-version", String(object.v));
  if (object.chain !== CHAIN) fail("wrong-chain");
  if (!fromHex(object.listHash, 32)) fail("invalid-receipt", "listHash");
  if (!fromHex(object.signature, 48)) fail("invalid-receipt", "signature");
  if (!isCount(object.round) || object.round < 1) fail("invalid-receipt", "round");
  if (!isCount(object.winnerCount) || object.winnerCount < 1) fail("invalid-receipt", "winnerCount");
  const w = object.winnerIndices;
  if (!Array.isArray(w) || w.length !== object.winnerCount || !w.every(isCount) || new Set(w).size !== w.length)
    fail("invalid-receipt", "winnerIndices");
  if (canonicalReceipt(object) !== json) fail("non-canonical-receipt");
  return object;
}

// Room for the receipt's other lines (round, list hash, signature, winners) around the code.
const MAX_PASTE_EXTRA = 65536;
// "r=…&l=…" standing on its own: not glued to another parameter or base64url run on either side, so
// "x=1&r=…", "r=…&l=…&x=1", padded or standard base64 never match.
const CODE = /(?<![A-Za-z0-9_\-=&%])r=([A-Za-z0-9_-]+)&l=([A-Za-z0-9_-]+)(?![A-Za-z0-9_\-=&%])/g;

/**
 * The verifier code in a link, a bare fragment or a pasted receipt text → {r, l} strings. The last
 * "r=…&l=…" pair counts, wherever it stands and whatever (translated) label comes before it.
 */
export function splitFragment(input) {
  const text = typeof input === "string" ? input : "";
  if (text.length > MAX_RECEIPT_CHARS + MAX_LIST_CHARS + MAX_PASTE_EXTRA) fail("too-large");
  let found = null;
  for (const match of text.matchAll(CODE)) found = { r: match[1], l: match[2] };
  if (!found) fail("malformed-link", "needs exactly one r and one l");
  if (found.r.length > MAX_RECEIPT_CHARS || found.l.length > MAX_LIST_CHARS) fail("too-large");
  return found;
}

/** The link the app shares for a receipt object and its entries. */
export function verifierLink(receipt, entries) {
  return VERIFY_URL + "#r=" + b64urlEncode(utf8.encode(canonicalReceipt(receipt))) + "&l=" + b64urlEncode(encodeList(entries));
}

// ---- beacon and selection ----

/** Quicknet message: SHA-256 of the round as uint64 big-endian. */
export function beaconMessage(round) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(round));
  return sha256(bytes);
}

/** BLS check of a Quicknet signature against the compiled-in key; malformed points are false. */
export function verifyBeacon(round, signatureHex) {
  const signature = fromHex(signatureHex, 48);
  if (!signature || !Number.isSafeInteger(round) || round < 1) return false;
  try {
    const sigs = bls12_381.shortSignatures;
    return sigs.verify(signature, sigs.hash(beaconMessage(round), DST), fromHex(PUBLIC_KEY, 96)) === true;
  } catch {
    return false;
  }
}

export function seedFor(signatureHex, listHashHex) {
  return sha256(concat(fromHex(signatureHex, 48), fromHex(listHashHex, 32)));
}

const TWO_256 = 1n << 256n;

/** Original indices of winnerCount winners, by rejection sampling without replacement. */
export function selectWinners(seed, entryCount, winnerCount) {
  const remaining = Array.from({ length: entryCount }, (_, i) => i);
  const prefix = concat(utf8.encode(WINNER_PREFIX), new Uint8Array([0]), seed);
  const winners = [];
  for (let k = 0; k < winnerCount; k++) {
    const n = BigInt(remaining.length);
    const limit = (TWO_256 / n) * n;
    for (let attempt = 0; ; attempt++) {
      const x = BigInt("0x" + toHex(sha256(concat(prefix, uint32be(k), uint32be(attempt)))));
      if (x >= limit) continue;
      const index = Number(x % n);
      winners.push(remaining[index]);
      remaining.splice(index, 1);
      break;
    }
  }
  return winners;
}

export function roundTime(round) {
  return new Date((GENESIS + (round - 1) * PERIOD) * 1000);
}

// ---- whole link ----

/**
 * Verify a shared link, fragment or pasted receipt text. Returns {ok: true, …} only after the receipt is canonical, the list
 * matches listHash, the drand signature verifies and the recomputed winners equal the receipt's.
 * Otherwise {ok: false, error: code, detail}. Never throws.
 */
export function verifyLink(input) {
  try {
    const { r, l } = splitFragment(input);
    const receiptBytes = b64urlDecode(r), listBytes = b64urlDecode(l);
    if (!receiptBytes || !listBytes) fail("malformed-link", "not unpadded base64url");
    const receipt = parseReceipt(receiptBytes);
    const listHash = toHex(sha256(listBytes));
    if (listHash !== receipt.listHash) fail("list-hash-mismatch");
    const entries = decodeList(listBytes);
    if (receipt.winnerCount > entries.length || receipt.winnerIndices.some((i) => i >= entries.length))
      fail("invalid-receipt", "more winners or higher indices than entries");
    if (!verifyBeacon(receipt.round, receipt.signature)) fail("bad-signature");
    const winners = selectWinners(seedFor(receipt.signature, receipt.listHash), entries.length, receipt.winnerCount);
    if (winners.some((w, i) => w !== receipt.winnerIndices[i])) fail("result-mismatch");
    return {
      ok: true,
      receipt,
      listHash,
      entries,
      winners: winners.map((index) => ({ index, ...entries[index] })),
      roundTime: roundTime(receipt.round),
    };
  } catch (error) {
    if (error instanceof VerifyError) return { ok: false, error: error.code, detail: error.message };
    return { ok: false, error: "malformed-link", detail: String(error && error.message) };
  }
}
