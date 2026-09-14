"""Per-script CER gate (pipeline step 6, D17, FR-2.6).

The honesty mechanism: a script is auto-extract only after its CER on
held-out in-domain data clears the gate (operative reading: S3's
in-domain set, not benchmark word crops -- D17's bare "held-out data"
wording is tightened to "held-out in-domain data" separately). Until S3
measures and records per-script CER, there is no gate value to read.

Two functions, two strictness levels, deliberately:

- `cer_gate_for(script)` is the numeric read. It raises
  `CERGateNotRecorded` -- any measurement or status-table code that needs
  the number must fail loud rather than invent one (rule 10, same
  discipline as D14's `QualityFloorNotRecorded`).
- `route(...)` is the pipeline behavior. It never raises on an
  unmeasured gate: unmeasurable means unroutable-to-auto, so the field
  goes to the review queue with a stated reason (rule 9). Catching the
  exception one frame down is intentional -- crashing the pipeline on
  unmeasured gates would turn every page into an error instead of
  assisted transcription.

`confidence_threshold` is an explicit parameter with no default (the M2
`base_threshold` pattern): no measured per-field confidence cut exists
yet either, so callers state the comparison point they used.
"""

from __future__ import annotations

from dataclasses import dataclass


class CERGateNotRecorded(RuntimeError):
    """Raised when D17's per-script CER gate is read before S3 measures
    it. Guessing a CER cut here would silently auto-extract text the
    system has not earned the right to trust (FR-2.6)."""


def cer_gate_for(script: str) -> float:
    """Numeric CER gate for one ISO 15924 script. Raises until S3
    records per-script CER on held-out in-domain data."""
    raise CERGateNotRecorded(
        "cer gate unmeasured, complete S3 first — see D17 "
        f"(no recorded gate for script {script!r}; refusing to guess)"
    )


@dataclass(frozen=True)
class RouteDecision:
    auto_extract: bool
    reason: str


def route(script: str, confidence: float, confidence_threshold: float) -> RouteDecision:
    """Decide auto-extract vs review queue for one recognised field."""
    if not 0.0 <= confidence <= 1.0:
        raise ValueError(f"confidence {confidence!r} must be within [0, 1]")
    if confidence < confidence_threshold:
        return RouteDecision(
            auto_extract=False,
            reason=(
                f"confidence {confidence:.3f} below threshold "
                f"{confidence_threshold:.3f} (FR-2.7)"
            ),
        )
    try:
        gate = cer_gate_for(script)
    except CERGateNotRecorded:
        return RouteDecision(
            auto_extract=False,
            reason=(
                f"script {script!r} not gated: CER gate unmeasured, "
                "complete S3 first — see D17 (FR-2.6, assisted transcription)"
            ),
        )
    return RouteDecision(
        auto_extract=True,
        reason=f"script {script!r} cleared its CER gate of {gate:.3f}",
    )
