"""M3-5. Gate tests: the numeric read raises with the exact message;
routing degrades to review, never to a crash or a silent accept."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402

import gate  # noqa: E402


def test_numeric_gate_raises_with_exact_message() -> None:
    with pytest.raises(gate.CERGateNotRecorded, match="cer gate unmeasured, complete S3 first"):
        gate.cer_gate_for("Deva")


def test_low_confidence_routes_to_review_on_threshold() -> None:
    decision = gate.route("Latn", 0.4, 0.8)
    assert not decision.auto_extract
    assert "below threshold" in decision.reason


def test_unmeasured_gate_routes_to_review_not_crash() -> None:
    decision = gate.route("Deva", 0.99, 0.8)
    assert not decision.auto_extract
    assert "not gated" in decision.reason


def test_invalid_confidence_raises() -> None:
    with pytest.raises(ValueError, match="confidence"):
        gate.route("Latn", 1.5, 0.8)
