"""Ollama client for entity + relation extraction with the D11 repair loop.

D11 (architecture §6.1 step 7 / decision table): grammar-constrained decode via
Ollama ``format: json`` plus a Pydantic model. If the model returns JSON that
fails schema validation, we feed the validation error back into ONE bounded
repair retry. A second failure raises ``NeedsReview`` so the document is
quarantined into ``ingest_jobs.status='needs_review'`` rather than crashing or
silently dropping the output.
"""
import json
import os

import httpx

from .prompts import ENTITY_PROMPT, RELATION_PROMPT
from .schemas import ExtractionResult, RelationsResult

OLLAMA_URL = os.environ.get("RAVEN_OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
MODEL = os.environ.get("RAVEN_LLM_MODEL", "phi3:mini")
MAX_REPAIR = 1  # one bounded repair retry (D11)


class OllamaError(Exception):
    """Transport-level failure (Ollama not running / unreachable)."""


class NeedsReview(Exception):
    """Schema validation failed after the D11 repair retry."""


def _parse_json(text: str):
    t = (text or "").strip()
    if t.startswith("```"):
        # strip ```json ... ``` fences
        t = t.strip("`")
        if t.lstrip().lower().startswith("json"):
            t = t.lstrip()[4:]
    return json.loads(t)


async def _generate(prompt: str, model: str) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "format": "json",
        "keep_alive": -1,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=180) as c:
            r = await c.post(OLLAMA_URL, json=payload)
            r.raise_for_status()
            return r.json().get("response", "")
    except httpx.HTTPError as e:
        raise OllamaError(f"ollama unreachable: {e}") from e


async def extract_with_ollama(text: str, doc_id: str, model: str = MODEL) -> dict:
    """Run Call-1 (entities) and Call-2 (relations) with the D11 repair loop.

    Returns a plain dict with keys: entities, identifiers, locations, incident,
    relations. Raises ``NeedsReview`` on repeated validation failure or
    ``OllamaError`` on transport failure.
    """
    # ---- Call 1: entities / identifiers / locations / incident -------------
    prompt1 = f"{ENTITY_PROMPT}\n\nTEXT:\n{text}"
    raw1 = await _generate(prompt1, model)
    result: ExtractionResult | None = None
    for attempt in range(1 + MAX_REPAIR):
        try:
            obj = _parse_json(raw1)
            result = ExtractionResult.model_validate(obj)
            break
        except Exception as e:
            if attempt < MAX_REPAIR:
                raw1 = await _generate(
                    f"{prompt1}\n\nYour previous answer failed schema validation: {e}. "
                    "Return ONLY valid JSON matching the schema.", model)
            else:
                raise NeedsReview(f"entity extraction invalid after {1 + MAX_REPAIR} attempts: {e}")
    assert result is not None

    # ---- Call 2: relationships (given the entity list) --------------------
    ent_summary = [
        {"name": e.name, "type": e.type, "role": e.role} for e in result.entities
    ]
    prompt2 = (
        f"{RELATION_PROMPT}\n\nENTITIES:\n{json.dumps(ent_summary)}\n\nTEXT:\n{text}"
    )
    raw2 = await _generate(prompt2, model)
    rels: RelationsResult | None = None
    for attempt in range(1 + MAX_REPAIR):
        try:
            obj2 = _parse_json(raw2)
            rels = RelationsResult.model_validate(obj2)
            break
        except Exception as e:
            if attempt < MAX_REPAIR:
                raw2 = await _generate(
                    f"{prompt2}\n\nPrevious answer failed validation: {e}. "
                    "Return ONLY valid JSON matching the schema.", model)
            else:
                raise NeedsReview(f"relation extraction invalid after {1 + MAX_REPAIR} attempts: {e}")
    assert rels is not None

    return {
        "entities": [e.model_dump() for e in result.entities],
        "identifiers": [i.model_dump() for i in result.identifiers],
        "locations": [l.model_dump() for l in result.locations],
        "incident": result.incident.model_dump() if result.incident else None,
        "relations": [r.model_dump() for r in rels.relations],
    }
