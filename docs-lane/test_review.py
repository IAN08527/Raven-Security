"""M3-6. Review queue model tests: entries require a stated reason;
decisions accept only the three terminal statuses."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import review  # noqa: E402


def test_queue_item_requires_a_reason() -> None:
    item = review.queue_item(
        source_file_id="file-1",
        script="Deva",
        crop_path="crops/p1/l3.png",
        reason="script 'Deva' not gated: CER gate unmeasured",
        recognised_text="????",
        confidence=0.31,
        page_no=1,
        line_no=3,
    )
    assert item.reason
    assert item.page_no == 1
    assert item.confidence == pytest.approx(0.31)


def test_valid_decisions_parse() -> None:
    for status in ("corrected", "accepted", "rejected"):
        decision = review.ReviewDecision(corrected_text="fixed", status=status)
        assert decision.status == status


def test_non_terminal_status_rejected() -> None:
    with pytest.raises(ValidationError):
        review.ReviewDecision(corrected_text=None, status="pending")


def test_empty_reason_rejected() -> None:
    with pytest.raises(ValidationError):
        review.queue_item(
            source_file_id="file-1", script="Latn", crop_path="c.png", reason=""
        )
