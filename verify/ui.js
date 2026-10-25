// Page wiring for the Fair Draw verifier. All checks live in verifier.js (built from source/src/core.js).
// textContent only, never innerHTML: names in a shared list cannot inject markup.
import { verifyLink } from "./verifier.js";

const $ = (id) => document.getElementById(id);

const messages = {
  "malformed-link": "This is not a complete Fair Draw link. It needs both the receipt (r=) and the list (l=).",
  "too-large": "This link is too large to verify here.",
  "invalid-receipt": "The receipt is damaged or incomplete.",
  "non-canonical-receipt": "The receipt was altered: it is not in the exact form the app writes.",
  "unsupported-version": "This receipt uses a Fair Draw version this page does not know. Try updating the page.",
  "wrong-chain": "This receipt names a different randomness beacon. Only drand quicknet is accepted.",
  "list-hash-mismatch": "The list does not match the receipt: an entry was added, removed, renamed or reordered.",
  "invalid-list": "The list in this link is damaged.",
  "bad-signature": "The drand signature is not valid for this round. The randomness cannot be trusted.",
  "result-mismatch": "The winners written in the receipt are not the ones this draw produces.",
};

let verifiedLabels = null;

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function item(list, text, detail) {
  const li = document.createElement("li");
  li.textContent = text;
  if (detail) {
    const small = document.createElement("span");
    small.className = "muted";
    small.textContent = " " + detail;
    li.appendChild(small);
  }
  list.appendChild(li);
}

function show(input) {
  const status = $("status");
  $("proof").hidden = true;
  verifiedLabels = null;
  if (!input.replace(/^#/, "").trim()) {
    status.className = "status";
    status.textContent = "Open a Fair Draw link from the Augura app, or paste a link or receipt below.";
    compareClaim();
    return;
  }
  const result = verifyLink(input);
  if (!result.ok) {
    status.className = "status bad";
    status.textContent = "Not verified. " + (messages[result.error] || messages["malformed-link"]);
    compareClaim();
    return;
  }
  const r = result.receipt;
  status.className = "status good";
  status.textContent = result.winners.length === 1 ? "Verified. The winner is:" : "Verified. The winners, in order:";
  const winners = $("winners");
  clear(winners);
  for (const w of result.winners) item(winners, w.label || w.id, w.label ? "(id " + w.id + ")" : "");
  const entries = $("entries");
  clear(entries);
  for (const e of result.entries) item(entries, e.label || e.id, "(id " + e.id + ")");
  $("round").textContent = String(r.round);
  $("round-again").textContent = String(r.round);
  $("round-time").textContent = result.roundTime.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
  $("entry-count").textContent = String(result.entries.length);
  $("list-hash").textContent = result.listHash;
  $("signature").textContent = r.signature;
  $("proof").hidden = false;
  verifiedLabels = result.winners.map((w) => [w.label.trim(), w.id.trim()]);
  compareClaim();
}

function compareClaim() {
  const out = $("claim-status");
  const lines = $("claim").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!lines.length) {
    out.className = "claim-status";
    out.textContent = "";
    return;
  }
  if (!verifiedLabels) {
    out.className = "claim-status bad";
    out.textContent = "Nothing verified above, so this claim cannot be checked.";
    return;
  }
  const same = lines.length === verifiedLabels.length &&
    lines.every((line, i) => verifiedLabels[i].includes(line.normalize("NFC")));
  out.className = same ? "claim-status good" : "claim-status bad";
  out.textContent = same
    ? "The claim matches the verified winners, in the same order."
    : "The claim does not match the verified winners above.";
}

$("check").addEventListener("click", () => show($("link").value));
$("claim").addEventListener("input", compareClaim);
window.addEventListener("hashchange", () => show(location.hash));
show(location.hash);
