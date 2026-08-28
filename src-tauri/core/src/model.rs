//! Shared data models used by the ingest saga and the Postgres persistence
//! layer. Kept separate from `saga`/`db` to avoid a dependency cycle.

/// A single extracted entity (populated by the Python NLP engine, Backlog #3).
#[derive(Debug, Clone)]
pub struct ExtractedEntity {
    pub id: String,
    pub etype: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub role: String,
}

/// An identifier (phone / vehicle / account / IMEI / NAFIS) tied to an entity.
#[derive(Debug, Clone)]
pub struct ExtractedIdentifier {
    pub id: String,
    pub entity_id: Option<String>,
    pub itype: String,
    pub value: String,
}

/// A resolvable evidence snippet (the spans that drive the explainability
/// panel). Exactly one of `relationship_id` / `entity_id` is set.
#[derive(Debug, Clone)]
pub struct ExtractedEvidence {
    pub relationship_id: Option<String>,
    pub entity_id: Option<String>,
    pub kind: String,
    pub snippet: String,
    pub char_start: Option<i64>,
    pub char_end: Option<i64>,
}

/// A relationship between two entities.
#[derive(Debug, Clone)]
pub struct ExtractedRelation {
    pub id: String,
    pub src: String,
    pub dst: String,
    pub rtype: String,
    pub weight: f64,
    pub evidence_count: i64,
}

/// The full extraction result from the Python engine for one document.
#[derive(Debug, Clone, Default)]
pub struct Extraction {
    /// D11 quarantine: the LLM output failed schema validation after repair.
    pub needs_review: bool,
    pub engine: String,
    pub attempts: i32,
    pub text: String,
    pub page_map: Option<serde_json::Value>,
    pub entities: Vec<ExtractedEntity>,
    pub identifiers: Vec<ExtractedIdentifier>,
    pub relations: Vec<ExtractedRelation>,
    pub evidence: Vec<ExtractedEvidence>,
}
