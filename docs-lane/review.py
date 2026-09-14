"""Review queue item models (pipeline step 7, FR-2.7).

Any field below the confidence threshold, and every field from a
non-gated script, lands here with its source crop beside the
transcription. Corrections are stored and attributed; no entity derived
from an unreviewed low-confidence field ever enters the graph.

This module owns the queue ENTRY shape only -- status mutation happens
exclusively through the server's `POST /review/{id}` endpoint (the M2
`POST /candidates/{id}/decide` discipline transferred: one mutating
path, no auto-accept). Field names mirror the baseline `review_items`
table and the `GET /cases/{id}/review` contract list.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ReviewItem(BaseModel):
    """One row awaiting human review. `reason` is the stated cause that
    put it here (gate, confidence, constraint, or recognition failure) --
    rule 9 forbids unexplained queue entries."""

    source_file_id: str = Field(min_length=1)
    page_no: int | None = None
    line_no: int | None = None
    field_name: str | None = None  # null for free-text lines
    script: str = Field(min_length=1)  # ISO 15924, e.g. Latn, Deva, Taml
    crop_path: str = Field(min_length=1)  # the pixels the reviewer sees
    recognised_text: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    reason: str = Field(min_length=1)


class ReviewDecision(BaseModel):
    """Human resolution, matching the `POST /review/{id}` contract body:
    corrected text plus the new status. `corrected` carries the human's
    transcription; `accepted` confirms the machine text as-is; `rejected`
    discards it. All three remain visible as audit evidence."""

    corrected_text: str | None = None
    status: str = Field(pattern="^(corrected|accepted|rejected)$")


def queue_item(
    source_file_id: str,
    script: str,
    crop_path: str,
    reason: str,
    recognised_text: str | None = None,
    confidence: float | None = None,
    page_no: int | None = None,
    line_no: int | None = None,
    field_name: str | None = None,
) -> ReviewItem:
    """Build a queue entry with its stated reason. The reason is required
    positionally-by-keyword (no default): callers must say why."""
    return ReviewItem(
        source_file_id=source_file_id,
        page_no=page_no,
        line_no=line_no,
        field_name=field_name,
        script=script,
        crop_path=crop_path,
        recognised_text=recognised_text,
        confidence=confidence,
        reason=reason,
    )
