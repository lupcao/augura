"""Write Tests/Fixtures/drand/fair-draw-v1-receipts.json: verifier links (valid and tampered) shared by the
browser verifier tests (site/verify/source/test/) and the native tests (Tests/FairDrawReceiptFixtureTests.swift).

This is an independent Python encoder (hashlib, no JavaScript): it builds canonical receipts and listBytes as
docs/fair-draw-protocol.md describes, and every case states the expected outcome by hand. It never runs BLS.
    python3 site/verify/source/make_receipt_fixtures.py
"""
import base64, hashlib, json, pathlib, struct, unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[3]
DRAND = ROOT / "Tests/Fixtures/drand"
vector = json.loads((DRAND / "fair-draw-v1-vector.json").read_text())
beacon = json.loads((DRAND / "quicknet-round-1.json").read_text())
bad_sig = json.loads((DRAND / "quicknet-round-1-invalid-signature.json").read_text())["signature"]

CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"
SIG = beacon["signature"]
VERSION = "augura.fair-draw.v1"
ORDER = ["chain", "listHash", "round", "signature", "v", "winnerCount", "winnerIndices"]


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def list_bytes(entries, normalize=True):
    out = b"augura/fair-draw/list/v1\x00" + struct.pack(">I", len(entries))
    for e in entries:
        for field in (e["id"], e["label"]):
            text = unicodedata.normalize("NFC", field) if normalize else field
            raw = text.encode("utf-8")
            out += struct.pack(">I", len(raw)) + raw
    return out


def canonical(receipt) -> bytes:
    # RFC 8785 for this fixed shape: keys in UTF-16 order, no spaces, integers and ASCII strings only.
    parts = []
    for key in sorted(receipt):
        parts.append(json.dumps(key) + ":" + json.dumps(receipt[key], separators=(",", ":")))
    return ("{" + ",".join(parts) + "}").encode()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


L = list_bytes(vector["list"])
assert L.hex() == vector["canonicalListBytesHex"]
LH = sha(L)
assert LH == vector["listHash"]
SEED = hashlib.sha256(bytes.fromhex(SIG) + bytes.fromhex(LH)).digest()
assert SEED.hex() == vector["seed"]


def select_winners(seed: bytes, count: int, winners: int):
    remaining, out = list(range(count)), []
    for k in range(winners):
        n = len(remaining)
        limit = (2 ** 256 // n) * n
        attempt = 0
        while True:
            x = int.from_bytes(hashlib.sha256(b"augura/fair-draw/winner/v1\x00" + seed +
                                              struct.pack(">II", k, attempt)).digest(), "big")
            if x < limit:
                out.append(remaining.pop(x % n))
                break
            attempt += 1
    return out


assert select_winners(SEED, 3, 3) == vector["winnerIndicesForThreeWinners"]
assert select_winners(SEED, 3, 1) == [1] and select_winners(SEED, 3, 2) == [1, 2]


def receipt(**changes):
    r = {"chain": CHAIN, "listHash": LH, "round": 1, "signature": SIG, "v": VERSION,
         "winnerCount": 3, "winnerIndices": [1, 2, 0]}
    r.update(changes)
    return r


def frag(r_bytes: bytes, l_bytes: bytes = L) -> str:
    return f"r={b64(r_bytes)}&l={b64(l_bytes)}"


cases = []


def add(name, fragment, error=None, winners=None, field=None, note=None, bls=None, list_hash_matches=None):
    case = {"name": name, "fragment": fragment, "expect": "valid" if error is None else "invalid"}
    if error:
        case["error"] = error
    if winners is not None:
        case["winnerIndices"] = winners
    if field:
        case["tamperedField"] = field
    if note:
        case["note"] = note
    if bls is not None:
        case["nativeBLS"] = bls
    if list_hash_matches is not None:
        case["nativeListHashMatches"] = list_hash_matches
    cases.append(case)


def receipt_case(name, r, error=None, winners=None, field=None, note=None, bls=None, lhm=None, l_bytes=L):
    add(name, frag(canonical(r), l_bytes), error, winners, field, note, bls, lhm)
    if bls is not None:
        cases[-1]["round"] = r["round"]
        cases[-1]["signature"] = r["signature"]
    if lhm is not None:
        cases[-1]["listHash"] = r["listHash"]


# Valid links: the three-winner vector and its one- and two-winner prefixes (selection removes each winner).
receipt_case("valid-three-winners", receipt(), winners=[1, 2, 0], bls=True, lhm=True)
receipt_case("valid-one-winner", receipt(winnerCount=1, winnerIndices=[1]), winners=[1], bls=True, lhm=True)
receipt_case("valid-two-winners", receipt(winnerCount=2, winnerIndices=[1, 2]), winners=[1, 2], bls=True, lhm=True)

# One tampered receipt field at a time.
receipt_case("tampered-v", receipt(v="augura.fair-draw.v2"), "unsupported-version", field="v")
receipt_case("tampered-chain", receipt(chain="8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce"),
             "wrong-chain", field="chain")
receipt_case("tampered-round", receipt(round=2), "bad-signature", field="round",
             note="round 1 signature checked against SHA256(uint64be(2))", bls=False, lhm=True)
receipt_case("tampered-round-zero", receipt(round=0), "invalid-receipt", field="round")
receipt_case("tampered-signature-byte", receipt(signature=bad_sig), "bad-signature", field="signature",
             note="signature of quicknet-round-1-invalid-signature.json", bls=False, lhm=True)
receipt_case("tampered-signature-length", receipt(signature=SIG[:-2]), "invalid-receipt", field="signature")
flipped = ("0" if LH[0] != "0" else "1") + LH[1:]
receipt_case("tampered-listHash", receipt(listHash=flipped), "list-hash-mismatch", field="listHash", bls=True, lhm=False)
receipt_case("tampered-winnerCount-two", receipt(winnerCount=2), "invalid-receipt", field="winnerCount",
             note="winnerCount differs from the number of winnerIndices")
receipt_case("tampered-winnerCount-zero", receipt(winnerCount=0, winnerIndices=[]), "invalid-receipt", field="winnerCount")
receipt_case("tampered-winnerCount-excessive", receipt(winnerCount=4, winnerIndices=[1, 2, 0, 3]), "invalid-receipt",
             field="winnerCount", note="more winners than list entries")
receipt_case("tampered-winnerIndices-order", receipt(winnerIndices=[2, 1, 0]), "result-mismatch", field="winnerIndices", bls=True, lhm=True)
receipt_case("tampered-winnerIndices-value", receipt(winnerCount=1, winnerIndices=[0]), "result-mismatch",
             field="winnerIndices", bls=True, lhm=True)
receipt_case("tampered-winnerIndices-duplicate", receipt(winnerIndices=[1, 1, 0]), "invalid-receipt", field="winnerIndices")
receipt_case("tampered-winnerIndices-range", receipt(winnerIndices=[1, 2, 3]), "invalid-receipt", field="winnerIndices")

# Tampered list bytes (the receipt is the valid one).
alt = [dict(e) for e in vector["list"]]
alt[0]["label"] = "Alfb"
receipt_case("tampered-list-label", receipt(), "list-hash-mismatch", field="list", l_bytes=list_bytes(alt))
receipt_case("tampered-list-order", receipt(), "list-hash-mismatch", field="list",
             l_bytes=list_bytes([vector["list"][1], vector["list"][0], vector["list"][2]]))
receipt_case("tampered-list-truncated", receipt(), "list-hash-mismatch", field="list", l_bytes=L[:-1])

# Lists whose hash the receipt matches, but whose encoding is invalid.
def list_case(name, raw, note):
    receipt_case(name, receipt(listHash=sha(raw)), "invalid-list", field="list", note=note, l_bytes=raw)

decomposed = [dict(e) for e in vector["list"]]
decomposed[2]["label"] = "Čar"
list_case("list-not-nfc", list_bytes(decomposed, normalize=False), "label in NFD form")
list_case("list-duplicate-id", list_bytes([vector["list"][0], vector["list"][0], vector["list"][2]]), "id a twice")
list_case("list-empty-id", list_bytes([{"id": "", "label": "x"}, vector["list"][1], vector["list"][2]]), "empty id")
list_case("list-trailing-byte", L + b"\x00", "one byte after the last entry")
list_case("list-wrong-prefix", b"augura/fair-draw/list/v2" + L[24:], "unknown list version")
list_case("list-count-too-large", L[:25] + struct.pack(">I", 4) + L[29:], "count says 4 entries, 3 present")
list_case("list-invalid-utf8", L[:-1] + b"\xff", "last label byte is not UTF-8")

# Non-canonical receipt payloads with otherwise correct values.
valid = canonical(receipt())
text = valid.decode()
add("noncanonical-whitespace", frag(json.dumps(receipt(), indent=1).encode()), "non-canonical-receipt")
add("noncanonical-key-order", frag(json.dumps({k: receipt()[k] for k in reversed(ORDER)}, separators=(",", ":")).encode()),
    "non-canonical-receipt")
add("noncanonical-float-round", frag(text.replace('"round":1', '"round":1.0').encode()), "non-canonical-receipt")
add("noncanonical-duplicate-key", frag(text.replace('{"chain"', '{"chain":"x","chain"').encode()), "non-canonical-receipt")
add("noncanonical-extra-key", frag(json.dumps(dict(receipt(), note="hi"), sort_keys=True, separators=(",", ":")).encode()),
    "invalid-receipt")
add("noncanonical-uppercase-signature", frag(canonical(receipt(signature=SIG.upper()))), "invalid-receipt")
add("noncanonical-padded-base64", f"r={b64(valid)}==&l={b64(L)}", "malformed-link")
add("noncanonical-standard-base64", "r=" + b64(valid)[:10] + "+" + b64(valid)[11:] + "&l=" + b64(L), "malformed-link",
    note="'+' is standard base64, not base64url")
assert len(valid) % 3 != 0, "the unused-bits case needs a partial final group"
last = b64(valid)[-1]
alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
add("noncanonical-trailing-bits", f"r={b64(valid)[:-1]}{alphabet[alphabet.index(last) + 1]}&l={b64(L)}", "malformed-link",
    note="last base64url character carries non-zero unused bits")

# Malformed links.
add("link-empty", "", "malformed-link")
add("link-missing-list", f"r={b64(valid)}", "malformed-link")
add("link-missing-receipt", f"l={b64(L)}", "malformed-link")
add("link-extra-parameter", frag(valid) + "&x=1", "malformed-link")
add("link-not-json", f"r={b64(b'not json')}&l={b64(L)}", "invalid-receipt")
add("link-receipt-array", f"r={b64(b'[1,2,3]')}&l={b64(L)}", "invalid-receipt")
add("link-oversized-receipt", f"r={'A' * 200000}&l={b64(L)}", "too-large")
add("link-oversized-list", f"r={b64(valid)}&l={'A' * 600000}", "too-large")

valid_r = b64(valid)
out = {
    "protocol": VERSION,
    "generatedBy": "site/verify/source/make_receipt_fixtures.py (Python hashlib; independent of the JavaScript verifier)",
    "verifierURL": "https://augura.fyi/verify/",
    "payloadFormat": "https://augura.fyi/verify/#r=<receipt b64url>&l=<canonical listBytes b64url>",
    "validReceiptCanonicalJSON": text,
    "validReceiptB64url": valid_r,
    "listBytesB64url": b64(L),
    "nativeChecks": "nativeBLS: QuicknetVerifier result for (round, signature); nativeListHashMatches: SHA256(l) == listHash",
    "cases": cases,
}
(DRAND / "fair-draw-v1-receipts.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
print("wrote", len(cases), "cases; valid receipt", valid_r)
