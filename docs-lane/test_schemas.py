"""M4-T1 + D11-A. Extraction contract tests: resolved spans are mandatory
and code-owned; model output carries surfaces only and rejects spans."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import schemas  # noqa: E402

TEXT = "Ravi Kumar called Suresh Yadav on 9822012345."


def _entity(name: str = "Ravi Kumar", start: int = 0, end: int = 10) -> dict[str, object]:
    return {"type": "PERSON", "canonical_name": name, "char_start": start, "char_end": end}


def test_valid_schema_output_passes() -> None:
    payload = {
        "entities": [_entity(), _entity("Suresh Yadav", 18, 30)],
        "identifiers": [
            {
                "type": "PHONE",
                "value": "9822012345",
                "entity_index": 1,
                "char_start": 34,
                "char_end": 44,
            }
        ],
        "relationships": [
            {"src_index": 0, "dst_index": 1, "type": "CALLED", "occurred_at": None}
        ],
    }
    extraction = schemas.parse_extraction(payload)
    assert len(extraction.entities) == 2
    assert schemas.check_spans_against_text(extraction, TEXT) == []


def test_output_missing_char_start_fails_validation() -> None:
    payload = {"entities": [{"type": "PERSON", "canonical_name": "Ravi Kumar", "char_end": 10}]}
    with pytest.raises(ValidationError):
        schemas.parse_extraction(payload)


def test_output_missing_char_end_fails_validation() -> None:
    payload = {
        "identifiers": [
            {"type": "PHONE", "value": "9822012345", "entity_index": 0, "char_start": 34}
        ],
        "entities": [_entity()],
    }
    with pytest.raises(ValidationError):
        schemas.parse_extraction(payload)


def test_dangling_entity_index_fails_validation() -> None:
    payload = {
        "entities": [_entity()],
        "relationships": [{"src_index": 0, "dst_index": 7, "type": "CALLED"}],
    }
    with pytest.raises(ValidationError, match="dst_index|outside"):
        schemas.parse_extraction(payload)


def test_self_loop_relationship_fails_validation() -> None:
    payload = {
        "entities": [_entity()],
        "relationships": [{"src_index": 0, "dst_index": 0, "type": "CALLED"}],
    }
    with pytest.raises(ValidationError, match="self-loop"):
        schemas.parse_extraction(payload)


def test_span_beyond_text_is_reported_not_silent() -> None:
    extraction = schemas.parse_extraction({"entities": [_entity(end=9999)]})
    violations = schemas.check_spans_against_text(extraction, TEXT)
    assert len(violations) == 1
    assert "exceeds text length" in violations[0]


def test_empty_span_is_reported() -> None:
    extraction = schemas.parse_extraction({"entities": [_entity("X", start=4, end=4)]})
    violations = schemas.check_spans_against_text(extraction, "ab  cd")
    assert any("covers no text" in violation for violation in violations)


# ---------------------------------------------------------------------------
# D11-A: model output is surfaces only; spans are code's job.
# ---------------------------------------------------------------------------


def test_model_output_without_spans_passes_validation() -> None:
    payload = {
        "entities": [
            {"type": "PERSON", "value": "Ravi Kumar"},
            {"type": "PERSON", "value": "Suresh Yadav"},
        ],
        "identifiers": [{"type": "PHONE", "value": "9822012345", "entity_index": 1}],
        "relationships": [{"src_index": 0, "dst_index": 1, "type": "CALLED"}],
    }
    output = schemas.parse_model_output(payload)
    assert len(output.entities) == 2
    assert output.entities[0].value == "Ravi Kumar"


def test_model_output_with_spans_fails_validation() -> None:
    payload = {
        "entities": [
            {"type": "PERSON", "value": "Ravi Kumar", "char_start": 0, "char_end": 10}
        ]
    }
    with pytest.raises(ValidationError):
        schemas.parse_model_output(payload)


def test_model_identifier_with_spans_fails_validation() -> None:
    payload = {
        "entities": [{"type": "PERSON", "value": "Ravi Kumar"}],
        "identifiers": [
            {
                "type": "PHONE",
                "value": "9822012345",
                "entity_index": 0,
                "char_start": 34,
                "char_end": 44,
            }
        ],
    }
    with pytest.raises(ValidationError):
        schemas.parse_model_output(payload)


# ---------------------------------------------------------------------------
# D11-A: SpanResolver.
# ---------------------------------------------------------------------------


def test_span_resolver_exact_match() -> None:
    resolver = schemas.SpanResolver()
    resolved = resolver.resolve(TEXT, [{"type": "PERSON", "value": "Ravi Kumar"}])
    assert len(resolved) == 1
    assert resolved[0].found is True
    assert resolved[0].char_start == 0
    assert resolved[0].char_end == 10
    assert TEXT[resolved[0].char_start : resolved[0].char_end] == "Ravi Kumar"


def test_span_resolver_duplicate_surface_resolution() -> None:
    text = "Ravi met Ravi at the gate."
    resolver = schemas.SpanResolver()
    resolved = resolver.resolve(
        text,
        [
            {"type": "PERSON", "value": "Ravi"},
            {"type": "PERSON", "value": "Ravi"},
        ],
    )
    assert len(resolved) == 2
    first, second = resolved
    assert first.found and second.found
    assert first.char_start == 0
    assert second.char_start == 9
    assert first.occurrence_index == 0
    assert second.occurrence_index == 1
    assert first.char_start != second.char_start


def test_span_resolver_not_found_goes_to_review_not_crash() -> None:
    resolver = schemas.SpanResolver()
    resolved = resolver.resolve(TEXT, [{"type": "PERSON", "value": "Nobody Here"}])
    assert len(resolved) == 1
    assert resolved[0].found is False
    assert resolved[0].char_start is None
    assert resolved[0].char_end is None


def test_resolve_model_output_flags_unfound_for_review() -> None:
    resolver = schemas.SpanResolver()
    output = schemas.parse_model_output(
        {
            "entities": [
                {"type": "PERSON", "value": "Ravi Kumar"},
                {"type": "PERSON", "value": "Nobody Here"},
            ],
            "relationships": [{"src_index": 0, "dst_index": 1, "type": "CALLED"}],
        }
    )
    extraction, unfound = resolver.resolve_model_output(TEXT, output)
    assert len(extraction.entities) == 1
    assert extraction.entities[0].canonical_name == "Ravi Kumar"
    assert len(unfound) == 1
    assert unfound[0].value == "Nobody Here"
    # Dangling edge (endpoint unfound) is dropped, not persisted.
    assert extraction.relationships == []
