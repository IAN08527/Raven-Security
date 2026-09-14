"""Pydantic models for the extraction contract (D11, D11-A, FR-3.1/FR-3.2):
hard schema, character spans into confirmed source text, confidence.

D11-A (surface-then-resolve, supersedes span-from-model): the model returns
{type, value} pairs only. Character spans are resolved deterministically by
`SpanResolver` via str.find() with occurrence-index disambiguation. The
model's job is surface identification, not offset arithmetic.

Two schemas:
- `ModelOutput` — what the model may emit. Spans are FORBIDDEN here
  (`extra="forbid"`): a model payload carrying char_start/char_end fails
  validation because spans are code's job, not the model's.
- `ExtractionModel` — what the pipeline persists. Spans are MANDATORY here,
  produced by `SpanResolver`, never by the model.

Every resolved entity, identifier and relationship carries `char_start`/
`char_end` into the confirmed review-queue text it was extracted from
(rule 8). An extraction that cannot point at its source span is not
shippable: unfound surfaces go to the review queue (rule 9), never a crash.
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

logger = logging.getLogger(__name__)

ENTITY_TYPES = ("PERSON", "ORGANIZATION", "LOCATION", "VEHICLE", "ACCOUNT")
IDENTIFIER_TYPES = ("PHONE", "VEHICLE", "ACCOUNT", "IMEI", "NAFIS")
REL_TYPES = ("CALLED", "TRANSFERRED_TO", "CO_ACCUSED", "CO_LOCATED", "RESIDES_WITH", "SEEN_WITH")


class SpanModel(BaseModel):
    """Inclusive-start, exclusive-end offsets into the confirmed source
    text, exactly the baseline `evidence` column semantics."""

    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)

    @model_validator(mode="after")
    def _ordered(self) -> SpanModel:
        if self.char_end < self.char_start:
            raise ValueError(
                f"char_end ({self.char_end}) precedes char_start ({self.char_start})"
            )
        return self


# ---------------------------------------------------------------------------
# Model output schema (D11-A): surfaces only, spans forbidden.
# ---------------------------------------------------------------------------


class ModelEntity(BaseModel):
    """One surface the model identified. No spans: spans are resolved by
    code (`SpanResolver`), never emitted by the model."""

    model_config = ConfigDict(extra="forbid")

    type: str = Field(pattern="^(PERSON|ORGANIZATION|LOCATION|VEHICLE|ACCOUNT)$")
    value: str = Field(min_length=1)


class ModelIdentifier(BaseModel):
    """One identifier surface. No spans for the same reason."""

    model_config = ConfigDict(extra="forbid")

    type: str = Field(pattern="^(PHONE|VEHICLE|ACCOUNT|IMEI|NAFIS)$")
    value: str = Field(min_length=1)
    entity_index: int = Field(ge=0)


class ModelRelationship(BaseModel):
    model_config = ConfigDict(extra="forbid")

    src_index: int = Field(ge=0)
    dst_index: int = Field(ge=0)
    type: str = Field(
        pattern="^(CALLED|TRANSFERRED_TO|CO_ACCUSED|CO_LOCATED|RESIDES_WITH|SEEN_WITH)$"
    )
    occurred_at: str | None = None  # case-clock RFC 3339 from the source, else null (rule 3)


class ModelOutput(BaseModel):
    """What the model may emit (D11-A): {type, value} pairs only. Any
    payload carrying char_start/char_end fails validation here."""

    model_config = ConfigDict(extra="forbid")

    entities: list[ModelEntity] = Field(default_factory=list)
    identifiers: list[ModelIdentifier] = Field(default_factory=list)
    relationships: list[ModelRelationship] = Field(default_factory=list)

    @model_validator(mode="after")
    def _indices_resolve(self) -> ModelOutput:
        count = len(self.entities)
        for identifier in self.identifiers:
            if identifier.entity_index >= count:
                raise ValueError(
                    f"identifier {identifier.value!r} points at missing "
                    f"entity_index {identifier.entity_index} ({count} entities)"
                )
        for relationship in self.relationships:
            if relationship.src_index >= count or relationship.dst_index >= count:
                raise ValueError(
                    f"relationship {relationship.type} points outside "
                    f"{count} entities "
                    f"(src {relationship.src_index}, dst {relationship.dst_index})"
                )
            if relationship.src_index == relationship.dst_index:
                raise ValueError(
                    f"relationship {relationship.type} is a self-loop on "
                    f"entity {relationship.src_index}: social relations are "
                    "binary, a self-loop is always a model error"
                )
        return self


def parse_model_output(payload: Any) -> ModelOutput:
    """Constrained-decode entry point for raw model JSON (D11-A). Raises
    `pydantic.ValidationError` on anything else — including any payload
    carrying spans — which is what the repair loop feeds back (D11)."""
    if isinstance(payload, str):
        return ModelOutput.model_validate_json(payload)
    return ModelOutput.model_validate(payload)


# ---------------------------------------------------------------------------
# Resolved schema: what the pipeline persists (spans mandatory, code-owned).
# ---------------------------------------------------------------------------


class EntityModel(BaseModel):
    type: str = Field(pattern="^(PERSON|ORGANIZATION|LOCATION|VEHICLE|ACCOUNT)$")
    canonical_name: str = Field(min_length=1)
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)

    @model_validator(mode="after")
    def _span_ordered(self) -> EntityModel:
        if self.char_end < self.char_start:
            raise ValueError(
                f"entity {self.canonical_name!r}: char_end precedes char_start"
            )
        return self


class IdentifierModel(BaseModel):
    type: str = Field(pattern="^(PHONE|VEHICLE|ACCOUNT|IMEI|NAFIS)$")
    value: str = Field(min_length=1)
    entity_index: int = Field(ge=0)
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)

    @model_validator(mode="after")
    def _span_ordered(self) -> IdentifierModel:
        if self.char_end < self.char_start:
            raise ValueError(
                f"identifier {self.value!r}: char_end precedes char_start"
            )
        return self


class RelationshipModel(BaseModel):
    src_index: int = Field(ge=0)
    dst_index: int = Field(ge=0)
    type: str = Field(
        pattern="^(CALLED|TRANSFERRED_TO|CO_ACCUSED|CO_LOCATED|RESIDES_WITH|SEEN_WITH)$"
    )
    occurred_at: str | None = None  # case-clock RFC 3339 from the source, else null (rule 3)


class ExtractionModel(BaseModel):
    """Resolved extraction (D11-A output): indices reference the sibling
    `entities` array; the validator rejects dangling references so the saga
    can never persist them. Constructed by code from `ModelOutput` +
    `SpanResolver`, never directly from model JSON."""

    entities: list[EntityModel] = Field(default_factory=list)
    identifiers: list[IdentifierModel] = Field(default_factory=list)
    relationships: list[RelationshipModel] = Field(default_factory=list)

    @model_validator(mode="after")
    def _indices_resolve(self) -> ExtractionModel:
        count = len(self.entities)
        for identifier in self.identifiers:
            if identifier.entity_index >= count:
                raise ValueError(
                    f"identifier {identifier.value!r} points at missing "
                    f"entity_index {identifier.entity_index} ({count} entities)"
                )
        for relationship in self.relationships:
            if relationship.src_index >= count or relationship.dst_index >= count:
                raise ValueError(
                    f"relationship {relationship.type} points outside "
                    f"{count} entities "
                    f"(src {relationship.src_index}, dst {relationship.dst_index})"
                )
            if relationship.src_index == relationship.dst_index:
                raise ValueError(
                    f"relationship {relationship.type} is a self-loop on "
                    f"entity {relationship.src_index}: social relations are "
                    "binary, a self-loop is always a model error"
                )
        return self


# ---------------------------------------------------------------------------
# SpanResolver (D11-A): deterministic surface -> span resolution.
# ---------------------------------------------------------------------------


class ResolvedSpan(BaseModel):
    """One resolved surface. `char_start`/`char_end` are None when the
    surface was not found in text: the caller routes those to the review
    queue (rule 9), never a crash."""

    type: str
    value: str
    char_start: int | None = None
    char_end: int | None = None
    occurrence_index: int = 0
    found: bool = True


class SpanResolver:
    """Deterministic surface-then-resolve (D11-A).

    The model identifies surfaces; code finds offsets via `str.find()`
    with occurrence-index disambiguation so duplicate surface values
    resolve to the correct instance (first unseen occurrence per value,
    in surface order).

    Never raises for unfound surfaces: logs a warning, sets spans to
    None, marks `found=False` so the caller flags the item for review
    (CLAUDE.md rule 9 — fail into a visible queue, never a silent drop).
    """

    def resolve(
        self, text: str, surfaces: list[dict[str, Any]]
    ) -> list[ResolvedSpan]:
        """Resolve each surface dict ({type, value} — accepts
        `canonical_name` as a `value` alias for call-site convenience)
        to its span in `text`."""
        resolved: list[ResolvedSpan] = []
        # Next search offset per distinct surface value: duplicates advance
        # past the previously claimed occurrence.
        next_offset: dict[str, int] = {}
        seen_count: dict[str, int] = {}
        for surface in surfaces:
            typ = str(surface.get("type", ""))
            raw_value = surface.get("value", surface.get("canonical_name", ""))
            value = str(raw_value)
            occurrence = seen_count.get(value, 0)
            seen_count[value] = occurrence + 1
            start_from = next_offset.get(value, 0)
            found_at = text.find(value, start_from) if value else -1
            if not value or found_at < 0:
                logger.warning(
                    "span_not_found: surface %r (type=%s, occurrence=%d) "
                    "absent from %d-char source text; routing to review",
                    value,
                    typ,
                    occurrence,
                    len(text),
                )
                resolved.append(
                    ResolvedSpan(
                        type=typ,
                        value=value,
                        char_start=None,
                        char_end=None,
                        occurrence_index=occurrence,
                        found=False,
                    )
                )
                continue
            end_at = found_at + len(value)
            next_offset[value] = end_at
            resolved.append(
                ResolvedSpan(
                    type=typ,
                    value=value,
                    char_start=found_at,
                    char_end=end_at,
                    occurrence_index=occurrence,
                    found=True,
                )
            )
        return resolved

    def resolve_model_output(
        self, text: str, output: ModelOutput
    ) -> tuple[ExtractionModel, list[ResolvedSpan]]:
        """Resolve a validated `ModelOutput` into an `ExtractionModel`.

        Returns (extraction, unfound): `extraction` carries only found
        spans; `unfound` lists every surface absent from text so the
        caller can emit review_items with reason 'span_not_found'.
        """
        entity_surfaces = [
            {"type": entity.type, "value": entity.value} for entity in output.entities
        ]
        identifier_surfaces = [
            {"type": identifier.type, "value": identifier.value}
            for identifier in output.identifiers
        ]
        entity_spans = self.resolve(text, entity_surfaces)
        identifier_spans = self.resolve(text, identifier_surfaces)

        entities: list[EntityModel] = []
        entity_index_map: dict[int, int | None] = {}
        unfound: list[ResolvedSpan] = []
        for index, (surface, span) in enumerate(zip(entity_surfaces, entity_spans, strict=True)):
            if not span.found or span.char_start is None or span.char_end is None:
                unfound.append(span)
                entity_index_map[index] = None
                continue
            entities.append(
                EntityModel(
                    type=surface["type"],
                    canonical_name=surface["value"],
                    char_start=span.char_start,
                    char_end=span.char_end,
                )
            )
            entity_index_map[index] = len(entities) - 1

        identifiers: list[IdentifierModel] = []
        for identifier, span in zip(output.identifiers, identifier_spans, strict=True):
            remapped = entity_index_map.get(identifier.entity_index)
            if remapped is None:
                # Owning entity unfound: the identifier cannot be grounded.
                unfound.append(span)
                continue
            if not span.found or span.char_start is None or span.char_end is None:
                unfound.append(span)
                continue
            identifiers.append(
                IdentifierModel(
                    type=identifier.type,
                    value=identifier.value,
                    entity_index=remapped,
                    char_start=span.char_start,
                    char_end=span.char_end,
                )
            )

        relationships: list[RelationshipModel] = []
        for relationship in output.relationships:
            src = entity_index_map.get(relationship.src_index)
            dst = entity_index_map.get(relationship.dst_index)
            if src is None or dst is None:
                # Endpoint unfound: drop the edge, keep the audit trail via
                # `unfound` (the endpoint span is already listed there).
                continue
            if src == dst:
                # Remapping collapsed two model indices onto one resolved
                # entity (duplicate surfaces): a self-loop is always a
                # model error, drop it rather than persist it.
                continue
            relationships.append(
                RelationshipModel(
                    src_index=src,
                    dst_index=dst,
                    type=relationship.type,
                    occurred_at=relationship.occurred_at,
                )
            )
        return ExtractionModel(
            entities=entities, identifiers=identifiers, relationships=relationships
        ), unfound


def check_spans_against_text(extraction: ExtractionModel, text: str) -> list[str]:
    """Verify every resolved span lies inside `text` and covers non-empty
    content. Returns a list of violation messages (empty when clean)."""
    violations: list[str] = []
    length = len(text)
    spots: list[tuple[str, int, int]] = [
        (f"entity {entity.canonical_name!r}", entity.char_start, entity.char_end)
        for entity in extraction.entities
    ]
    spots.extend(
        (f"identifier {identifier.value!r}", identifier.char_start, identifier.char_end)
        for identifier in extraction.identifiers
    )
    for label, start, end in spots:
        if end > length:
            violations.append(f"{label}: span [{start}, {end}) exceeds text length {length}")
        elif not text[start:end].strip():
            violations.append(f"{label}: span [{start}, {end}) covers no text")
    return violations


def parse_extraction(payload: Any) -> ExtractionModel:
    """Resolved-schema entry point: strict JSON object straight into the
    code-owned schema. Raises `pydantic.ValidationError` on anything else.

    NOTE (D11-A): raw model JSON goes through `parse_model_output` first;
    this entry point is for already-resolved payloads (tests, saga repair
    paths). Model payloads carrying spans fail here only if they also fail
    the resolved shape; span rejection lives in `parse_model_output`."""
    if isinstance(payload, str):
        return ExtractionModel.model_validate_json(payload)
    return ExtractionModel.model_validate(payload)
