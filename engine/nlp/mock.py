"""Deterministic, rule-based FIR extractor used when Ollama is unavailable
(mock mode / ``auto`` fallback). It produces the same shaped output as
``ollama_client.extract_with_ollama`` (entities/identifiers/locations/incident/
relations with character spans) so the rest of the pipeline is engine-agnostic.

This lets the product be demonstrated and end-to-end tested on a machine
without a GPU/pulled model, and provides a baseline the LLM path is measured
against. Relation ``src``/``dst`` are entity *names* here; ``extract.run_extraction``
rewrites them to stable entity ids.
"""
import re

PHONE_RE = re.compile(r"\b[6-9]\d{9}\b")
VEHICLE_RE = re.compile(r"\b[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}\b")
ACCOUNT_RE = re.compile(r"(?:a/c|account|acct)\s*(?:no\.?|number)?\s*[:#]?\s*(\d{9,18})", re.I)
FIR_RE = re.compile(r"FIR\s*(?:No\.?|number|No)?\s*[:#]?\s*(\d{1,4}/\d{2,4})", re.I)
DATE_RE = re.compile(r"(?:dated?|on)\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})", re.I)
ISO_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
PS_RE = re.compile(r"(?:Police Station|PS|P\.S\.)\s*[:\-]?\s+([A-Za-z][A-Za-z \-]+?)(?:,|\.|under|on|in|\(|$)", re.I)
SECTION_RE = re.compile(r"(?:sections?|u/s|under section|sec\.?)\s*[:#]?\s*([0-9,\s/]+(?:IPC|CrPC|IT)?)", re.I)

PERSON_PATTERNS = [
    ("COMPLAINANT", re.compile(r"(?i:complainant|informant)\s*[:\-]?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})")),
    ("ACCUSED", re.compile(r"(?i:accused|accd\.?)\s*\d*[\.\)]?\s*[:\-]?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})")),
    ("WITNESS", re.compile(r"(?i:witness)\s*(?:no\.?)?\s*\d*[\.\)]?\s*[:\-]?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})")),
    ("VICTIM", re.compile(r"(?i:victim|deceased|missing)\s*[:\-]?\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})")),
    ("PERSON", re.compile(r"\b(?i:shri|smt|sri|mr\.?|mrs\.?)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})")),
]


def _norm(name: str) -> str:
    return name.strip().lower()


def extract(text: str, doc_id: str) -> dict:
    entities: list[dict] = []
    seen: dict[str, int] = {}  # norm name -> index in entities
    order: list[str] = []

    def add_person(name: str, role: str, start: int):
        name = name.strip()
        if len(name) < 3:
            return
        key = _norm(name)
        if key in seen:
            # upgrade role if more specific (ACCUSED > PERSON etc.)
            idx = seen[key]
            if role != "PERSON" and entities[idx]["role"] == "PERSON":
                entities[idx]["role"] = role
            return
        entities.append({
            "type": "PERSON",
            "name": name,
            "aliases": [],
            "role": role,
            "span": [start, start + len(name)],
            "confidence": 0.9,
        })
        seen[key] = len(entities) - 1
        order.append(key)

    for role, rx in PERSON_PATTERNS:
        for m in rx.finditer(text):
            add_person(m.group(1), role, m.start(1))

    # Accused clause: "Accused: (1) Name A, (2) Name B, (3) M/s Org Pvt Ltd"
    acc_m = re.search(r"Accused\s*[:\-]?\s*([^\n]+)", text, re.I)
    if acc_m:
        clause = acc_m.group(1)
        for part in re.split(r",", clause):
            part = re.sub(r"^\s*\(?\d+\)?\s*", "", part).strip()
            if not part:
                continue
            nm = re.match(r"(?:M/s\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})", part)
            if nm:
                add_person(nm.group(1), "ACCUSED", acc_m.start(1))

    # ---- identifiers ------------------------------------------------------
    identifiers: list[dict] = []
    for m in PHONE_RE.finditer(text):
        val = m.group(0)
        start = m.start()
        owner = _nearest_person_before(text, start, seen)
        identifiers.append({"type": "PHONE", "value": val, "belongs_to": owner, "span": [start, m.end()]})
    for m in VEHICLE_RE.finditer(text):
        identifiers.append({"type": "VEHICLE", "value": m.group(0), "belongs_to": "", "span": [m.start(), m.end()]})
    for m in ACCOUNT_RE.finditer(text):
        identifiers.append({"type": "ACCOUNT", "value": m.group(1), "belongs_to": "", "span": [m.start(), m.end()]})

    # ---- incident ---------------------------------------------------------
    incident = None
    fir_m = FIR_RE.search(text)
    date_m = DATE_RE.search(text) or ISO_DATE_RE.search(text)
    ps_m = PS_RE.search(text)
    sec_m = SECTION_RE.search(text)
    if fir_m or date_m or ps_m or sec_m:
        sections = []
        if sec_m:
            sections = [s for s in re.split(r"[\s,/]+", sec_m.group(1)) if s.isdigit()]
        incident = {
            "fir_number": fir_m.group(1) if fir_m else "",
            "date": (date_m.group(1) if date_m else ""),
            "sections": sections,
            "police_station": ps_m.group(1).strip() if ps_m else "",
        }

    # ---- locations --------------------------------------------------------
    locations: list[dict] = []
    if incident and incident["police_station"]:
        ps = incident["police_station"]
        sm = re.search(re.escape(ps), text)
        locations.append({"name": ps, "span": [sm.start(), sm.end()] if sm else [0, 0]})

    # ---- relations (CO_ACCUSED among accused pairs) -----------------------
    accused = [e for e in entities if e["role"] == "ACCUSED"]
    relations: list[dict] = []
    for i in range(len(accused)):
        for j in range(i + 1, len(accused)):
            a, b = accused[i], accused[j]
            s = min(a["span"][0], b["span"][0])
            e = max(a["span"][1], b["span"][1])
            relations.append({
                "src": a["name"], "dst": b["name"],
                "type": "CO_ACCUSED", "evidence_span": [s, e], "confidence": 0.9,
            })

    return {
        "entities": entities,
        "identifiers": identifiers,
        "locations": locations,
        "incident": incident,
        "relations": relations,
    }


def _nearest_person_before(text: str, pos: int, seen: dict[str, int]) -> str:
    """Find the most recently mentioned person name before ``pos``."""
    best_name = ""
    best_start = -1
    for name, idx in seen.items():
        span = None  # we don't have spans here; approximate by searching
        # search last occurrence of name before pos
        for m in re.finditer(re.escape(name.title()), text[:pos]):
            if m.start() > best_start:
                best_start = m.start()
                best_name = name.title()
    return best_name
