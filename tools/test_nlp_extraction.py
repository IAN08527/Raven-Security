"""Self-test for the Raven NLP extraction pipeline (Backlog #3).

Run from anywhere:
    python tools/test_nlp_extraction.py

It exercises the engine-agnostic ``extract.run_extraction`` directly (no
FastAPI / GPU needed) in three modes and asserts the contract the Rust saga
consumes: stable entity/relation ids, normalized enum types, span-resolved
evidence snippets, and the D11 ``needs_review`` quarantine on LLM failure.
"""
import asyncio
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from engine.nlp import extract as extract_mod  # noqa: E402

SAMPLE = os.path.join(ROOT, "tools", "sample_fir.txt")


def _check(cond, msg):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {msg}")
    if not cond:
        _check.failed = True


_check.failed = False


async def run_one(mode: str):
    print(f"\n=== mode={mode} ===")
    out = await extract_mod.run_extraction(SAMPLE, "text/plain", "test-doc-001", mode=mode)

    print(f"  status={out['status']} engine={out['engine']} "
          f"attempts={out['attempts']}")
    print(f"  entities={len(out['entities'])} identifiers={len(out['identifiers'])} "
          f"relations={len(out['relations'])} evidence={len(out['evidence'])}")
    for e in out["entities"]:
        print(f"    ENT {e['type']:<12} {e['name']:<24} role={e.get('role','')} id={e['id'][:8]}")
    for i in out["identifiers"]:
        owner = (i.get("entity_id") or "")[:8]
        print(f"    ID  {i['type']:<10} {i['value']:<18} owner={owner}")
    for r in out["relations"]:
        print(f"    REL {r['type']:<12} {r['src'][:8]} -> {r['dst'][:8]} id={r['id'][:8]}")
    if out["incident"]:
        print(f"    FIR {out['incident']['fir_number']} dated {out['incident']['date']} "
              f"PS {out['incident']['police_station']} sec {out['incident']['sections']}")
    return out


async def main():
    # Default = "auto": no Ollama running -> falls back to mock automatically.
    auto = await run_one("auto")
    _check(auto["status"] == "ok", "auto mode produces a usable extraction")
    _check(len(auto["entities"]) >= 3, "auto extracts >=3 entities (complainant + accused)")
    _check(any(e["role"] == "ACCUSED" for e in auto["entities"]), "at least one ACCUSED entity")
    _check(any(e["type"] == "PERSON" for e in auto["entities"]), "entity types normalized to enum")
    _check(all("id" in e and e["id"] for e in auto["entities"]), "entities carry stable ids")
    _check(len(auto["relations"]) >= 1, "relations extracted (CO_ACCUSED pairs)")
    _check(all("id" in r and r["src"] and r["dst"] for r in auto["relations"]),
           "relations reference entity ids, not names")
    _check(any(i["type"] == "PHONE" for i in auto["identifiers"]), "phone identifier found")
    _check(any(i["type"] == "VEHICLE" for i in auto["identifiers"]), "vehicle identifier found")
    _check(auto["incident"] and auto["incident"]["fir_number"] == "124/2026",
           "incident FIR number parsed (=124/2026)")
    _check(len(auto["evidence"]) >= 1, "evidence snippets built")
    _check(all(ev.get("snippet") for ev in auto["evidence"]), "evidence snippets are non-empty")
    _check(any(ev.get("relationship_id") for ev in auto["evidence"])
           or any(ev.get("entity_id") for ev in auto["evidence"]),
           "evidence carries a resolvable anchor (rel/entity id)")

    # Explicit mock mode should behave identically.
    mock = await run_one("mock")
    _check(mock["engine"] == "mock", "mock mode flagged as engine=mock")

    # Explicit ollama mode with no server -> D11 transport -> needs_review.
    rev = await run_one("ollama")
    _check(rev["status"] == "needs_review", "ollama-unavailable triggers needs_review (D11)")

    print()
    if _check.failed:
        print("RESULT: FAIL")
        sys.exit(1)
    print("RESULT: PASS — NLP extraction pipeline verified.")


if __name__ == "__main__":
    asyncio.run(main())
