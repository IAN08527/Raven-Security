"""NER over confirmed review-queue text, spans resolved by code (pipeline
step 8, D11 + D11-A, FR-3.1/FR-3.2).

INPUT CONTRACT (S3-blocked posture): `extract()` receives text a human
already verified through the review queue (FR-2.7, statuses
`corrected`/`accepted`). Rejected items never reach this module -- the
saga (step 7) filters them. Raw recogniser output is not accepted here:
until S3 resolves, there is no machine-trusted text in the system.

LLM lane: a 1.5B-2B Q4 model via Ollama (STACK.md §5), sized by what the
VRAM ceiling leaves after the resident CV lane. Default model
`qwen2.5:1.5b`. Transport is plain `urllib` to loopback -- docs-lane
carries no HTTP client dependency and loopback never leaves the
premises (rule 6).

D11-A flow per call (surface-then-resolve): constrained decode
(`format: json`, temperature 0) returns {type, value} surfaces only --
spans are FORBIDDEN in model output -- then `SpanResolver` grounds each
surface via str.find() with occurrence-index disambiguation. Pydantic
validation + span check follow, one repair retry per failure feeding the
validation error back into the prompt, quarantine to `needs_review`
after the third consecutive failure -- never a raise, never a silent
drop (rule 9). Unfound surfaces become review_items with reason
'span_not_found'. `occurred_at` is always the source case clock (or
null), never a model-invented timestamp (rule 3, D16).

Transport vs validation retries are SEPARATE budgets: a transport
timeout retries up to 3 attempts with exponential backoff (1s, 2s, 4s)
before it becomes a quarantine; a timeout is never counted as a
validation failure. Raw model output is persisted to
eval/outputs/{file_id}_{attempt}.json on EVERY attempt (audit trail),
not just on failure.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # never executed at runtime (see packaging note below)
    from schemas import ExtractionModel

# NOTE (packaging): `docs-lane` is a hyphenated directory, not an
# importable package, so production modules take NO top-level sibling
# imports -- the egress import scan (`eval/test_no_egress.py`) executes
# each file with only the repo root on `sys.path`, and a top-level
# `from schemas import ...` would fail there. Sibling imports live
# function-locally (resolved at call time, when tests and the service
# entrypoint have the lane directory importable).

OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_MODEL = "qwen2.5:1.5b"
MAX_ATTEMPTS = 3  # initial attempt plus bounded repairs; third failure quarantines (D11)
TRANSPORT_ATTEMPTS = 3  # transport budget, separate from validation (D11-A)
TRANSPORT_BACKOFF_S = (1.0, 2.0, 4.0)  # exponential backoff between transport tries

SYSTEM_PROMPT = (
    "You extract named entities for a law-enforcement case file. "
    "Return JSON ONLY, exactly matching this schema: "
    '{"entities": [{"type": "PERSON|ORGANIZATION|LOCATION|VEHICLE|ACCOUNT", '
    '"value": string}], '
    '"identifiers": [{"type": "PHONE|VEHICLE|ACCOUNT|IMEI|NAFIS", "value": string, '
    '"entity_index": int}], '
    '"relationships": [{"src_index": int, "dst_index": int, '
    '"type": "CALLED|TRANSFERRED_TO|CO_ACCUSED|CO_LOCATED|RESIDES_WITH|SEEN_WITH", '
    '"occurred_at": string|null}]}. '
    "Return text surfaces ONLY -- no char_start, no char_end, no spans of any kind; "
    "character offsets are resolved by code, not by you (D11-A). "
    "Set occurred_at to null; timestamps come from the case clock, not from you. "
    "No prose, no markdown, JSON only."
)

logger = logging.getLogger(__name__)


def _outputs_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "eval" / "outputs"


def _safe_file_id(file_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in file_id) or "adhoc"


class LlmError(RuntimeError):
    """Transport or protocol failure talking to the LLM lane."""


class LlmBackend(ABC):
    """One task per model call (FR-3.1). Implementations return the raw
    model string for exactly one prompt; validation lives here, not in
    the backend."""

    @abstractmethod
    def complete(self, messages: list[dict[str, str]]) -> str:
        raise NotImplementedError


class OllamaBackend(LlmBackend):
    """Production backend: Ollama chat API on loopback with JSON
    constrained decode (D11). No hosted APIs, no credentials, no egress
    past localhost (rule 6)."""

    def __init__(
        self, model: str = DEFAULT_MODEL, host: str = OLLAMA_HOST, warmup: bool = True
    ) -> None:
        self.model = model
        self.host = host
        if warmup:
            self.warmup()

    def warmup(self, timeout_s: float = 5.0) -> None:
        """One throwaway prompt at startup so a cold Ollama instance
        (model load to GPU) does not stall the first real extraction
        past its timeout (Session 9: three consecutive stalls on a cold
        server, each surfacing as a transport quarantine). Best effort:
        any failure is logged and swallowed -- the real call carries its
        own budget and error path, so a failed warmup must never prevent
        construction. Unit tests pass `warmup=False` to stay hermetic."""
        body = json.dumps({"model": self.model, "prompt": "ping", "stream": False}).encode(
            "utf-8"
        )
        request = urllib.request.Request(
            f"{self.host}/api/generate", data=body, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_s):
                pass
        except Exception as exc:
            logger.warning(
                "ollama warmup ping failed (model=%s host=%s): %s; "
                "continuing -- first extraction absorbs the cold start",
                self.model,
                self.host,
                exc,
            )

    def complete(self, messages: list[dict[str, str]]) -> str:
        body = json.dumps(
            {
                "model": self.model,
                "messages": messages,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0},
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self.host}/api/chat", data=body, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            raise LlmError(f"ollama {self.model} unreachable at {self.host}: {exc}") from exc
        try:
            return str(payload["message"]["content"])
        except (KeyError, TypeError) as exc:
            raise LlmError(f"ollama {self.model} returned an unexpected envelope: {exc}") from exc


class ScriptedStubBackend(LlmBackend):
    """TEST DOUBLE. Replays canned model strings in order and records
    every prompt it receives (so tests can assert the validation error
    was fed back). Never a measurement of model quality."""

    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)
        self.prompts: list[list[dict[str, str]]] = []

    def complete(self, messages: list[dict[str, str]]) -> str:
        self.prompts.append([dict(message) for message in messages])
        if not self._responses:
            raise LlmError("stub backend exhausted: no more canned responses")
        return self._responses.pop(0)


@dataclass(frozen=True)
class Extracted:
    extraction: ExtractionModel
    attempts: int
    review_items: list[dict[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class Quarantined:
    reason: str
    attempts: int
    last_error: str


@dataclass
class EntityExtractor:
    """D11 + D11-A orchestrator. `source_ts` is the source document's
    case-clock timestamp (RFC 3339) or None when the source has none: it
    becomes every relationship's `occurred_at`, overwriting any
    model-provided value, because decay must run on one authoritative
    clock (D16)."""

    backend: LlmBackend
    source_ts: str | None = None
    failures: list[str] = field(default_factory=list)
    sleep: Callable[[float], None] = time.sleep

    def extract(self, text: str, file_id: str = "adhoc") -> Extracted | Quarantined:
        """Run the D11-A loop over confirmed text. Returns -- never raises
        for model-side problems (rule 9); caller bugs (empty text) raise
        `ValueError` because that is a programming error, not a model
        failure.

        `file_id` names the raw-output audit files
        (eval/outputs/{file_id}_{attempt}.json); it is metadata, never
        case data.
        """
        from pydantic import ValidationError

        from schemas import (
            SpanResolver,
            check_spans_against_text,
            parse_model_output,
        )

        if not text.strip():
            raise ValueError("extract: refusing empty text (caller bug, fail loud)")
        safe_id = _safe_file_id(file_id)
        resolver = SpanResolver()
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ]
        last_error = ""
        pending_review: list[dict[str, str]] = []
        for attempt in range(1, MAX_ATTEMPTS + 1):
            raw: str | None = None
            # -- Transport budget (D11-A): timeouts retry with backoff,
            # -- separate from validation retries. Durations logged per
            # -- attempt; a transport failure is never a validation error.
            for transport_try in range(1, TRANSPORT_ATTEMPTS + 1):
                started = time.monotonic()
                try:
                    raw = self.backend.complete(messages)
                except LlmError as exc:
                    elapsed = time.monotonic() - started
                    last_error = str(exc)
                    logger.warning(
                        "extraction transport attempt %d/%d (validation attempt %d) "
                        "failed after %.2fs: %s",
                        transport_try,
                        TRANSPORT_ATTEMPTS,
                        attempt,
                        elapsed,
                        last_error,
                    )
                    if transport_try < TRANSPORT_ATTEMPTS:
                        self.sleep(TRANSPORT_BACKOFF_S[transport_try - 1])
                        continue
                    self.failures.append(last_error)
                    break
                else:
                    elapsed = time.monotonic() - started
                    logger.info(
                        "extraction transport attempt %d/%d (validation attempt %d) "
                        "succeeded in %.2fs",
                        transport_try,
                        TRANSPORT_ATTEMPTS,
                        attempt,
                        elapsed,
                    )
                    break
            if raw is None:
                # Transport budget exhausted for this validation attempt.
                # A transport timeout is not a validation failure: stop the
                # loop and quarantine with the transport reason stated.
                break
            self._persist_raw(safe_id, attempt, raw)
            try:
                model_output = parse_model_output(raw)
                extraction, unfound = resolver.resolve_model_output(text, model_output)
                for span in unfound:
                    pending_review.append(
                        {
                            "reason": "span_not_found",
                            "type": span.type,
                            "value": span.value,
                            "file_id": safe_id,
                        }
                    )
                    logger.warning(
                        "span_not_found: surface %r (type=%s) absent from "
                        "source text; flagged for review (file_id=%s)",
                        span.value,
                        span.type,
                        safe_id,
                    )
                violations = check_spans_against_text(extraction, text)
                if violations:
                    raise ValueError("; ".join(violations))
            except (ValidationError, ValueError) as exc:
                last_error = str(exc)
                self.failures.append(last_error)
                messages.append({"role": "assistant", "content": raw})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "That output failed validation with this error:\n"
                            f"{last_error}\n"
                            "Return corrected JSON only, same surfaces-only schema, "
                            "no spans of any kind."
                        ),
                    }
                )
                continue
            return Extracted(
                extraction=self._stamp_clock(extraction),
                attempts=attempt,
                review_items=list(pending_review),
            )
        reason = f"extraction quarantined after {len(self.failures)} failure(s): {last_error}"
        return Quarantined(reason=reason, attempts=len(self.failures), last_error=last_error)

    def _persist_raw(self, safe_file_id: str, attempt: int, raw: str) -> None:
        """Persist raw model output on EVERY attempt (D11-A audit trail).
        Best effort: a failed write is logged, never raised (rule 9)."""
        try:
            outputs = _outputs_dir()
            outputs.mkdir(parents=True, exist_ok=True)
            path = outputs / f"{safe_file_id}_{attempt}.json"
            path.write_text(
                json.dumps({"file_id": safe_file_id, "attempt": attempt, "raw": raw}),
                encoding="utf-8",
            )
        except Exception as exc:  # noqa: BLE001 - audit write must never crash extraction
            logger.warning("raw output persist failed (file_id=%s): %s", safe_file_id, exc)

    def _stamp_clock(self, extraction: ExtractionModel) -> ExtractionModel:
        """Overwrite every relationship timestamp with the source case
        clock (or null). Model-provided timestamps are discarded: decay
        correctness depends on one clock (D16), and an LLM inventing
        dates is `now()` by proxy (rule 3)."""
        for relationship in extraction.relationships:
            relationship.occurred_at = self.source_ts
        return extraction
