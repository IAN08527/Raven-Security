"""Unit tests for the S4 metric math plus the fixture loader (M4-T6).

The math tests use hand-made mentions (M2 `test_reid_metrics.py`
precedent): they verify formulas, not the system. The loader test
resolves every annotated surface in `extraction_fixture.json` to a
span, failing loudly on ambiguity or drift -- so the fixture stays an
honest, reproducible annotation set. None of this is a result
(rule 10); the fixture is synthetic and the harness refuses it (D19).
"""

from __future__ import annotations

import json
from pathlib import Path

from eval.metrics.extraction import (
    Mention,
    bcubed,
    entity_prf_by_type,
    pairwise_prf,
    span_exact_match_rate,
)

FIXTURE = Path(__file__).resolve().parent / "splits" / "extraction_fixture.json"


def resolve_fixture() -> list[dict[str, object]]:
    """Resolve annotated surfaces to spans. Each surface must occur
    exactly once in its text -- ambiguity or drift fails loudly rather
    than silently shifting an offset."""
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert fixture["provenance"] == "synthetic", "S4 fixture must stay synthetic (D19)"
    resolved = []
    for item in fixture["items"]:
        text = item["text"]
        entities = []
        for entity in item["entities"]:
            first = text.find(entity["surface"])
            assert first != -1, f"{item['id']}: surface {entity['surface']!r} not found"
            assert text.find(entity["surface"], first + 1) == -1, (
                f"{item['id']}: surface {entity['surface']!r} is ambiguous"
            )
            entities.append(
                {"type": entity["type"], "start": first, "end": first + len(entity["surface"])}
            )
        resolved.append({"id": item["id"], "entities": entities})
    return resolved


def test_fixture_has_twenty_items_and_all_surfaces_resolve() -> None:
    resolved = resolve_fixture()
    assert len(resolved) == 20
    total = sum(len(item["entities"]) for item in resolved)
    assert total > 40, "fixture should carry real annotation density"


def test_perfect_extraction_scores_one() -> None:
    gold: list[Mention] = [("PERSON", 0, 10), ("LOCATION", 40, 45)]
    table = entity_prf_by_type(gold, list(gold))
    assert table["PERSON"]["f1"] == 1.0
    assert table["LOCATION"]["recall"] == 1.0
    assert span_exact_match_rate(gold, list(gold)) == 1.0


def test_wrong_span_is_a_miss_not_a_partial_hit() -> None:
    gold: list[Mention] = [("PERSON", 0, 10)]
    predicted: list[Mention] = [("PERSON", 0, 9)]
    table = entity_prf_by_type(gold, predicted)
    assert table["PERSON"]["precision"] == 0.0
    assert table["PERSON"]["recall"] == 0.0
    assert span_exact_match_rate(gold, predicted) == 0.0


def test_wrong_type_is_a_miss() -> None:
    gold: list[Mention] = [("PERSON", 0, 10)]
    predicted: list[Mention] = [("LOCATION", 0, 10)]
    assert entity_prf_by_type(gold, predicted)["PERSON"]["recall"] == 0.0
    assert span_exact_match_rate(gold, predicted) == 0.0


def test_pairwise_and_bcubed_agree_on_perfect_clustering() -> None:
    gold = [{"a", "b"}, {"c"}]
    assert pairwise_prf(gold, [{"a", "b"}, {"c"}])["f1"] == 1.0
    assert bcubed(gold, [{"a", "b"}, {"c"}])["f1"] == 1.0


def test_false_merge_hurts_pairwise_precision_not_recall() -> None:
    gold = [{"a", "b"}, {"c", "d"}]
    predicted = [{"a", "b", "c", "d"}]  # incorrectly fused two people
    scores = pairwise_prf(gold, predicted)
    assert scores["recall"] == 1.0
    assert scores["precision"] < 1.0
    assert bcubed(gold, predicted)["precision"] < 1.0
