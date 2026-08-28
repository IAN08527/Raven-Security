"""Pydantic schemas for the Raven NLP extraction contract (architecture §5.2).

The LLM is given one job per call with a hard schema (D11). ``ExtractionResult``
is the Call-1 (entity/identifier/location/incident) payload; ``RelationsResult``
is the Call-2 (relationships) payload. ``ExtractionPayload`` is what the engine
returns to the Rust saga over ``/nlp/extract`` after ids + evidence are bound.
"""
from pydantic import BaseModel, Field, field_validator


class Entity(BaseModel):
    type: str = "PERSON"
    name: str
    aliases: list[str] = Field(default_factory=list)
    role: str = ""
    span: list[int] = Field(default_factory=list)
    confidence: float = 0.0

    @field_validator("type")
    @classmethod
    def _upper_type(cls, v: str) -> str:
        return v.strip().upper() if v else "PERSON"


class Identifier(BaseModel):
    type: str = "PHONE"
    value: str
    belongs_to: str = ""
    span: list[int] = Field(default_factory=list)

    @field_validator("type")
    @classmethod
    def _upper_type(cls, v: str) -> str:
        return v.strip().upper() if v else "PHONE"


class Location(BaseModel):
    name: str
    span: list[int] = Field(default_factory=list)


class Incident(BaseModel):
    fir_number: str = ""
    date: str = ""
    sections: list[str] = Field(default_factory=list)
    police_station: str = ""


class Relation(BaseModel):
    src: str
    dst: str
    type: str = "CO_LOCATED"
    evidence_span: list[int] = Field(default_factory=list)
    confidence: float = 0.0

    @field_validator("type")
    @classmethod
    def _upper_type(cls, v: str) -> str:
        return v.strip().upper() if v else "CO_LOCATED"


class ExtractionResult(BaseModel):
    """Call-1 payload: entities + identifiers + locations + the FIR incident."""

    entities: list[Entity] = Field(default_factory=list)
    identifiers: list[Identifier] = Field(default_factory=list)
    locations: list[Location] = Field(default_factory=list)
    incident: Incident | None = None


class RelationsResult(BaseModel):
    """Call-2 payload: relationships referencing the Call-1 entity names."""

    relations: list[Relation] = Field(default_factory=list)


class EvidenceItem(BaseModel):
    relationship_id: str | None = None
    entity_id: str | None = None
    kind: str = "fir_text"
    snippet: str = ""
    char_start: int | None = None
    char_end: int | None = None


class ExtractionPayload(BaseModel):
    """What ``/nlp/extract`` returns to the Rust saga (after id binding)."""

    status: str = "ok"  # "ok" | "needs_review"
    engine: str = "ollama"  # "ollama" | "mock" | "mock(fallback)"
    model: str = "phi3:mini"
    text: str = ""
    page_map: list[dict] = Field(default_factory=list)
    attempts: int = 1
    entities: list[Entity] = Field(default_factory=list)
    identifiers: list[Identifier] = Field(default_factory=list)
    locations: list[Location] = Field(default_factory=list)
    incident: Incident | None = None
    relations: list[Relation] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
