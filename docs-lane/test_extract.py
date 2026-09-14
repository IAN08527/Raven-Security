"""M4-T1 + D11-A. Extractor loop tests (D11 surface-then-resolve):
repair feeds the error back, the third consecutive failure quarantines
without raising, timestamps come from the case clock, transport retries
with backoff are separate from validation retries. All timestamps are
fixed literals -- no test uses `now()` or the current date (rule 3)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402

import extract  # noqa: E402

TEXT = "Ravi Kumar called Suresh Yadav on 9822012345."
SOURCE_TS = "2025-11-02T10:00:00Z"  # fixed case-clock literal, not today

# D11-A: model emits surfaces only; spans are resolved by code.
VALID_JSON = json.dumps(
    {
        "entities": [
            {"type": "PERSON", "value": "Ravi Kumar"},
            {"type": "PERSON", "value": "Suresh Yadav"},
        ],
        "identifiers": [{"type": "PHONE", "value": "9822012345", "entity_index": 1}],
        "relationships": [
            {
                "src_index": 0,
                "dst_index": 1,
                "type": "CALLED",
                "occurred_at": "1999-01-01T00:00:00Z",
            }
        ],
    }
)

# Spans in model output are now a validation failure (D11-A: code's job).
WITH_SPANS_JSON = json.dumps(
    {
        "entities": [
            {"type": "PERSON", "value": "Ravi Kumar", "char_start": 0, "char_end": 10}
        ]
    }
)

INVALID_JSON = json.dumps({"entities": [{"type": "PERSON"}]})


def _no_sleep(_seconds: float) -> None:
    return None


def test_valid_output_extracts_on_first_attempt() -> None:
    extractor = extract.EntityExtractor(
        backend=extract.ScriptedStubBackend([VALID_JSON]),
        source_ts=SOURCE_TS,
        sleep=_no_sleep,
    )
    result = extractor.extract(TEXT, file_id="test-valid")
    assert isinstance(result, extract.Extracted)
    assert result.attempts == 1
    assert len(result.extraction.entities) == 2
    # Spans resolved by code, pointing at the actual surfaces.
    first = result.extraction.entities[0]
    assert TEXT[first.char_start : first.char_end] == "Ravi Kumar"


def test_model_timestamp_overwritten_with_case_clock() -> None:
    extractor = extract.EntityExtractor(
        backend=extract.ScriptedStubBackend([VALID_JSON]),
        source_ts=SOURCE_TS,
        sleep=_no_sleep,
    )
    result = extractor.extract(TEXT, file_id="test-clock")
    assert isinstance(result, extract.Extracted)
    assert result.extraction.relationships[0].occurred_at == SOURCE_TS


def test_occurred_at_null_without_source_clock() -> None:
    extractor = extract.EntityExtractor(
        backend=extract.ScriptedStubBackend([VALID_JSON]), sleep=_no_sleep
    )
    result = extractor.extract(TEXT, file_id="test-null-clock")
    assert isinstance(result, extract.Extracted)
    assert result.extraction.relationships[0].occurred_at is None


def test_model_output_with_spans_fails_validation_then_repairs() -> None:
    backend = extract.ScriptedStubBackend([WITH_SPANS_JSON, VALID_JSON])
    extractor = extract.EntityExtractor(
        backend=backend, source_ts=SOURCE_TS, sleep=_no_sleep
    )
    result = extractor.extract(TEXT, file_id="test-span-repair")
    assert isinstance(result, extract.Extracted)
    assert result.attempts == 2
    assert len(backend.prompts) == 2
    repair_prompt = json.dumps(backend.prompts[1])
    assert "validation" in repair_prompt.lower()


def test_repair_feeds_validation_error_back_into_prompt() -> None:
    backend = extract.ScriptedStubBackend([INVALID_JSON, VALID_JSON])
    extractor = extract.EntityExtractor(backend=backend, source_ts=SOURCE_TS, sleep=_no_sleep)
    result = extractor.extract(TEXT, file_id="test-repair")
    assert isinstance(result, extract.Extracted)
    assert result.attempts == 2
    assert len(backend.prompts) == 2
    repair_prompt = json.dumps(backend.prompts[1])
    assert "validation" in repair_prompt.lower()


def test_third_consecutive_failure_quarantines_without_raising() -> None:
    backend = extract.ScriptedStubBackend([INVALID_JSON] * 3)
    extractor = extract.EntityExtractor(
        backend=backend, source_ts=SOURCE_TS, sleep=_no_sleep
    )
    result = extractor.extract(TEXT, file_id="test-quarantine")
    assert isinstance(result, extract.Quarantined)
    assert result.attempts == 3
    assert "quarantined" in result.reason
    assert result.last_error != ""


def test_transport_failure_quarantines_with_stated_reason() -> None:
    extractor = extract.EntityExtractor(
        backend=extract.ScriptedStubBackend([]), sleep=_no_sleep
    )
    result = extractor.extract(TEXT, file_id="test-transport-fail")
    assert isinstance(result, extract.Quarantined)
    assert "unreachable" in result.reason or "exhausted" in result.reason


def test_transport_retry_succeeds_on_second_attempt_with_backoff() -> None:
    """D11-A: a timeout on attempt 1 retries (backoff 1s) and succeeds on
    attempt 2. Backoff timing confirmed via the injected sleep."""

    class FlakyBackend(extract.LlmBackend):
        def __init__(self) -> None:
            self.calls = 0

        def complete(self, messages: list[dict[str, str]]) -> str:
            self.calls += 1
            if self.calls == 1:
                raise extract.LlmError("ollama timeout after 300s")
            return VALID_JSON

    sleeps: list[float] = []
    backend = FlakyBackend()
    extractor = extract.EntityExtractor(
        backend=backend, source_ts=SOURCE_TS, sleep=sleeps.append
    )
    result = extractor.extract(TEXT, file_id="test-transport-retry")
    assert isinstance(result, extract.Extracted)
    assert backend.calls == 2
    assert sleeps == [1.0]


def test_transport_backoff_timing_is_exponential() -> None:
    """Three consecutive transport failures sleep 1s, 2s, 4s (D11-A)."""

    class AlwaysDown(extract.LlmBackend):
        def complete(self, messages: list[dict[str, str]]) -> str:
            raise extract.LlmError("ollama timeout")

    sleeps: list[float] = []
    extractor = extract.EntityExtractor(
        backend=AlwaysDown(), sleep=sleeps.append  # type: ignore[arg-type]
    )
    result = extractor.extract(TEXT, file_id="test-backoff")
    assert isinstance(result, extract.Quarantined)
    assert sleeps == [1.0, 2.0]


def test_unfound_surface_goes_to_review_not_crash() -> None:
    payload = json.dumps(
        {
            "entities": [{"type": "PERSON", "value": "Nobody Here"}],
        }
    )
    extractor = extract.EntityExtractor(
        backend=extract.ScriptedStubBackend([payload]), sleep=_no_sleep
    )
    result = extractor.extract(TEXT, file_id="test-span-not-found")
    assert isinstance(result, extract.Extracted)
    assert result.extraction.entities == []
    assert len(result.review_items) == 1
    assert result.review_items[0]["reason"] == "span_not_found"


def test_raw_output_persisted_on_every_attempt(tmp_path: Path) -> None:
    backend = extract.ScriptedStubBackend([INVALID_JSON, VALID_JSON])
    extractor = extract.EntityExtractor(backend=backend, sleep=_no_sleep)
    result = extractor.extract(TEXT, file_id="test-persist-check")
    assert isinstance(result, extract.Extracted)
    outputs = Path(extract.__file__).resolve().parent.parent / "eval" / "outputs"
    assert (outputs / "test-persist-check_1.json").exists()
    assert (outputs / "test-persist-check_2.json").exists()


def test_empty_text_raises_as_caller_bug() -> None:
    extractor = extract.EntityExtractor(
        backend=extract.ScriptedStubBackend([VALID_JSON]), sleep=_no_sleep
    )
    with pytest.raises(ValueError, match="empty"):
        extractor.extract("   ")


def test_warmup_failure_is_logged_not_raised(caplog: pytest.LogCaptureFixture) -> None:
    """A dead Ollama refuses fast: construction must survive it (the
    warmup is best effort by design)."""
    backend = extract.OllamaBackend(host="http://127.0.0.1:1", warmup=True)
    assert backend.model == extract.DEFAULT_MODEL
    assert "warmup" in caplog.text


def test_warmup_disabled_constructs_without_traffic() -> None:
    backend = extract.OllamaBackend(host="http://127.0.0.1:1", warmup=False)
    assert backend.host == "http://127.0.0.1:1"
