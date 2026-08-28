"""NLP extraction orchestrator (architecture §5.2 / §6.1 step 7).

``run_extraction`` is the single entry point the Rust saga calls over
``POST /nlp/extract``. It:

  1. Gets text from the file (OCR for scanned PDFs/images, text layer for
     digital PDFs, plain read for text) — see ``text.py``.
  2. Runs the chosen engine:
       * ``ollama``  -> real LLM extraction with the D11 repair loop
       * ``mock``    -> deterministic rule-based FIR parser
       * ``auto``    -> try ollama, fall back to mock on a transport error
  3. Binds stable ids (``ids.py``), rewrites relation endpoints to entity ids,
     and builds resolvable evidence snippets (the spans that drive the
     explainability panel).

The returned dict is engine-agnostic so the Rust side never knows which
backend produced it.
"""
import asyncio
import os

from . import text as text_mod
from . import ollama_client, mock as mock_mod
from .ids import entity_id, identifier_id, relation_id
from .schemas import Entity, Identifier, Location, Incident, Relation, EvidenceItem

DEFAULT_MODEL = os.environ.get("RAVEN_LLM_MODEL", "phi3:mini")


def _norm(name: str) -> str:
    return (name or "").strip().lower()


def _slice(text: str, span):
    if not text:
        return ""
    if not span or len(span) != 2:
        return ""
    return text[span[0]:span[1]]


async def run_extraction(
    file_path: str,
    mime: str,
    doc_id: str,
    dpi: int = 300,
    model: str | None = None,
    mode: str | None = None,
) -> dict:
    model = model or DEFAULT_MODEL
    mode = (mode or os.environ.get("RAVEN_NLP_MODE", "auto")).lower()

    # Resolve relative paths robustly against repo root if not found as-is
    if not os.path.exists(file_path):
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        cand = os.path.join(repo_root, file_path.lstrip("/\\"))
        if os.path.exists(cand):
            file_path = cand
        else:
            clean = file_path.replace("..\\", "").replace("../", "")
            cand2 = os.path.join(repo_root, clean)
            if os.path.exists(cand2):
                file_path = cand2

    # --- 1. text -----------------------------------------------------------
    if mime == "application/pdf" or mime.startswith("image/"):
        text, page_map = await asyncio.to_thread(text_mod.extract_text, file_path, mime, dpi)
    else:
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except Exception:
            text = ""
        page_map = [{"page": 1, "char_start": 0, "char_end": max(len(text), 1)}]

    if not text.strip():
        return {
            "status": "ok", "engine": "none", "model": model,
            "text": "", "page_map": page_map, "attempts": 0,
            "entities": [], "identifiers": [], "locations": [],
            "incident": None, "relations": [], "evidence": [],
            "errors": ["no extractable text"],
        }

    # --- 2. engine ---------------------------------------------------------
    raw = None
    engine_name = mode
    attempts = 0
    errors: list[str] = []

    if mode == "mock":
        raw = mock_mod.extract(text, doc_id)
        engine_name = "mock"
    elif mode == "ollama":
        try:
            raw = await ollama_client.extract_with_ollama(text, doc_id, model)
            attempts = 2
        except ollama_client.NeedsReview as e:
            return _review(text, page_map, "ollama", model, [str(e)])
        except ollama_client.OllamaError as e:
            return _review(text, page_map, "ollama", model, [str(e)])
    else:  # auto
        try:
            raw = await ollama_client.extract_with_ollama(text, doc_id, model)
            engine_name = "ollama"
            attempts = 2
        except ollama_client.NeedsReview as e:
            return _review(text, page_map, "ollama", model, [str(e)])
        except ollama_client.OllamaError:
            raw = mock_mod.extract(text, doc_id)
            engine_name = "mock(fallback)"

    # --- 3. bind ids + evidence -------------------------------------------
    return _bind(raw, text, page_map, engine_name, model, attempts, errors)


def _review(text, page_map, engine, model, errors):
    return {
        "status": "needs_review", "engine": engine, "model": model,
        "text": text, "page_map": page_map, "attempts": 0,
        "entities": [], "identifiers": [], "locations": [],
        "incident": None, "relations": [], "evidence": [], "errors": errors,
    }


def _bind(raw, text, page_map, engine, model, attempts, errors):
    entities_raw = raw.get("entities", [])
    ent_map: dict[str, tuple[str, list[int]]] = {}
    entities = []
    for e in entities_raw:
        eid = entity_id(e.get("type", "PERSON"), e.get("name", ""))
        ent_map[_norm(e.get("name", ""))] = (eid, e.get("span", [0, 0]))
        ee = dict(e)
        ee["id"] = eid
        entities.append(ee)

    identifiers = []
    for i in raw.get("identifiers", []):
        owner = i.get("belongs_to", "")
        eid = ent_map.get(_norm(owner), (None,))[0]
        idd = identifier_id(eid or "", i.get("type", "PHONE"), i.get("value", ""))
        ii = dict(i)
        ii["id"] = idd
        ii["entity_id"] = eid
        identifiers.append(ii)

    relations = []
    for r in raw.get("relations", []):
        s = ent_map.get(_norm(r.get("src", "")), (None,))[0]
        d = ent_map.get(_norm(r.get("dst", "")), (None,))[0]
        if not s or not d:
            continue
        rid = relation_id(s, d, r.get("type", "CO_LOCATED"))
        rr = dict(r)
        rr["id"] = rid
        rr["src"] = s
        rr["dst"] = d
        relations.append(rr)

    evidence = []
    for e in entities:
        span = e.get("span") or [0, 0]
        s, en = (span[0], span[1]) if len(span) == 2 else (0, 0)
        evidence.append(EvidenceItem(
            entity_id=e["id"], kind="fir_text",
            snippet=_slice(text, [s, en]), char_start=s, char_end=en,
        ).model_dump())
    for r in relations:
        span = r.get("evidence_span") or [0, 0]
        s, en = (span[0], span[1]) if len(span) == 2 else (0, 0)
        evidence.append(EvidenceItem(
            relationship_id=r["id"], kind="fir_text",
            snippet=_slice(text, [s, en]), char_start=s, char_end=en,
        ).model_dump())

    inc = raw.get("incident")
    if inc and entities:
        first = entities[0]["id"]
        summary = "FIR {} dated {}, PS {}, sections {}".format(
            inc.get("fir_number", ""), inc.get("date", ""),
            inc.get("police_station", ""), ", ".join(inc.get("sections", [])),
        ).strip()
        if summary:
            evidence.append(EvidenceItem(
                entity_id=first, kind="fir_text", snippet=summary,
                char_start=0, char_end=0,
            ).model_dump())

    return {
        "status": "ok", "engine": engine, "model": model,
        "text": text, "page_map": page_map, "attempts": attempts,
        "entities": entities, "identifiers": identifiers,
        "locations": raw.get("locations", []), "incident": inc,
        "relations": relations, "evidence": evidence, "errors": errors,
    }


# --------------------------------------------------------------------------
# Legacy single-call helpers (kept for ad-hoc testing; the saga uses
# ``run_extraction`` via ``/nlp/extract``).
# --------------------------------------------------------------------------
async def ocr_extract(file_path: str, dpi: int = 300) -> dict:
    text, page_map = text_mod.extract_text(file_path, "application/octet-stream", dpi)
    return {"text": text, "page_map": page_map, "ms": 0}


async def extract_entities(text: str, doc_id: str, attempts: int = 0) -> dict:
    try:
        raw = await ollama_client.extract_with_ollama(text, doc_id)
        return {"entities": raw["entities"], "attempts": attempts + 2, "ms": 0}
    except Exception as e:
        return {"entities": [], "attempts": attempts + 1, "ms": 0, "error": str(e)}


async def extract_relations(text: str, doc_id: str, entities: list) -> dict:
    return {"relations": []}


async def summarize_edge(evidence: list) -> dict:
    return {"summary": ""}
