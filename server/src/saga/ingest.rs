//! Ingest saga steps 7-9: extraction, review gate, persistence (M4-T2,
//! ARCHITECTURE.md §4.3). Steps 1-6 exist upstream; this module starts
//! where the docs-lane hands back confirmed text.
//!
//! Ordering is the entire point (D4): Postgres commits first and is the
//! source of truth; Neo4j is a derived index written afterwards through
//! the single server-side writer (D10). A Neo4j failure marks rows
//! `sync_state='pending'` for the reconciler -- it never rolls back
//! Postgres. Every persisted row carries the source file's provenance
//! explicitly (rule 7); every evidence row carries its source span
//! (rule 8). Nothing here reads system time: relationship timestamps
//! arrive as case-clock-or-null from the extractor (rule 3, D16).
//!
//! Testability without live infrastructure: all side effects go through
//! the `ExtractionClient`, `CaseDb`, `GraphWriter` and `LedgerAnchor`
//! traits. Tests use fakes; the real sqlx/neo4rs/HTTP impls land with
//! the service wiring (same precedent as M2's in-memory stores).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use uuid::Uuid;

/// Weight params version pinned by D27: version 1 carries the
/// prototype's unvalidated constants. S5 replaces them; nothing here
/// invents a version.
pub const WEIGHT_PARAMS_VERSION: i32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provenance {
    Benchmark,
    Collected,
    Synthetic,
}

impl Provenance {
    /// Baseline `provenance` enum label, for SQL casts. Matches the
    /// serde spelling by construction — a fork here breaks persistence.
    pub fn as_str(self) -> &'static str {
        match self {
            Provenance::Benchmark => "benchmark",
            Provenance::Collected => "collected",
            Provenance::Synthetic => "synthetic",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Received,
    Hashing,
    Stored,
    Recognising,
    AwaitingReview,
    Extracting,
    Committed,
    NeedsReview,
    Failed,
}

impl FileStatus {
    /// Baseline `ingest_status` enum label, for SQL casts. Matches the
    /// serde spelling by construction.
    pub fn as_str(self) -> &'static str {
        match self {
            FileStatus::Received => "received",
            FileStatus::Hashing => "hashing",
            FileStatus::Stored => "stored",
            FileStatus::Recognising => "recognising",
            FileStatus::AwaitingReview => "awaiting_review",
            FileStatus::Extracting => "extracting",
            FileStatus::Committed => "committed",
            FileStatus::NeedsReview => "needs_review",
            FileStatus::Failed => "failed",
        }
    }
}

/// Review disposition of the text handed to step 7. Only human-resolved
/// text (`Corrected`/`Accepted`) is extractable; `Rejected` items never
/// reach the extractor (FR-2.7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewDisposition {
    Corrected,
    Accepted,
    Rejected,
}

/// One entity as returned by the docs-lane D11 schema (spans mandatory).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEntity {
    pub typ: String,
    pub canonical_name: String,
    pub char_start: i64,
    pub char_end: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawIdentifier {
    pub typ: String,
    pub value: String,
    pub entity_index: usize,
    pub char_start: i64,
    pub char_end: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawRelationship {
    pub src_index: usize,
    pub dst_index: usize,
    pub typ: String,
    pub occurred_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractionResult {
    pub entities: Vec<RawEntity>,
    pub identifiers: Vec<RawIdentifier>,
    pub relationships: Vec<RawRelationship>,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum ExtractionFailure {
    #[error("extraction quarantined: {reason}")]
    Quarantined { reason: String },
}

/// Step 7 calls the docs-lane extraction endpoint with confirmed review
/// text. The real implementation POSTs to the lane's HTTP service when
/// it serves one (follow-up); tests stub this trait.
///
/// D33: async — the saga runs as a background task and every
/// implementation here is I/O (HTTP, Postgres, Bolt).
///
/// `&self` throughout (not `&mut self`): the saga holds these behind
/// `Arc` across `tokio::spawn`, which cannot yield `&mut`. Implementors
/// use interior mutability (`Mutex`, pools, HTTP clients are all
/// `&self`-ready); the step-7-to-9 tests prove ordering on a shared log
/// rather than on exclusive borrows.
#[async_trait::async_trait]
pub trait ExtractionClient: Send + Sync {
    async fn extract(
        &self,
        confirmed_text: &str,
        source_ts: Option<OffsetDateTime>,
    ) -> Result<ExtractionResult, ExtractionFailure>;
}

#[derive(Debug, Clone)]
pub struct NewEvidence {
    pub kind: String,
    pub snippet: Option<String>,
    pub char_start: i64,
    pub char_end: i64,
    pub page_no: Option<i32>,
    pub occurred_at: Option<OffsetDateTime>,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Default)]
pub struct PersistBatch {
    pub entities: Vec<RawEntity>,
    pub identifiers: Vec<RawIdentifier>,
    pub relationships: Vec<RawRelationship>,
    pub evidence: Vec<NewEvidence>,
}

#[derive(Debug, Clone, Default)]
pub struct PersistedIds {
    pub entity_ids: Vec<Uuid>,
    pub relationship_ids: Vec<Uuid>,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum PersistError {
    #[error("persist failed: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum WeightError {
    /// Mirrors the baseline migration's
    /// `RAISE EXCEPTION 'weight_params version % not found'`.
    #[error("weight_params version {0} not found")]
    UnknownVersion(i32),
    #[error("weight computation failed: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum GraphError {
    #[error("graph write failed: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum LedgerError {
    #[error("ledger unavailable: {0}")]
    Unavailable(String),
}

/// Postgres access for steps 7-9. The real implementation runs
/// `persist_extraction` as ONE transaction (step 9) and
/// `recompute_weight` as `SELECT recompute_weight($1, $2)` (M4-T4: the
/// baseline function is called, never rewritten).
///
/// D33: async — see [`ExtractionClient`].
#[async_trait::async_trait]
pub trait CaseDb: Send + Sync {
    async fn persist_extraction(
        &self,
        file_id: Uuid,
        case_id: Uuid,
        provenance: Provenance,
        batch: PersistBatch,
    ) -> Result<PersistedIds, PersistError>;
    async fn set_file_status(&self, file_id: Uuid, status: FileStatus);
    async fn recompute_weight(&self, rel_id: Uuid, version: i32) -> Result<f64, WeightError>;
    async fn mark_sync_pending(&self, entity_ids: &[Uuid], relationship_ids: &[Uuid]);
    async fn record_ledger(&self, file_id: Uuid, outcome: &LedgerOutcome);
}

/// The single Neo4j writer (D10). Real implementation issues Cypher
/// `MERGE` for nodes and edges; `rebuild_graph()` regenerates the whole
/// graph from Postgres (D4).
///
/// D33: async — see [`ExtractionClient`].
#[async_trait::async_trait]
pub trait GraphWriter: Send + Sync {
    async fn merge_case_graph(
        &self,
        nodes: &[GraphNode],
        edges: &[GraphEdge],
    ) -> Result<(), GraphError>;
}

#[derive(Debug, Clone)]
pub struct GraphNode {
    pub entity_id: Uuid,
    pub label: String,
    pub typ: String,
}

#[derive(Debug, Clone)]
pub struct GraphEdge {
    pub relationship_id: Uuid,
    pub src_entity_id: Uuid,
    pub dst_entity_id: Uuid,
    pub typ: String,
    pub weight: f64,
}

/// Ledger anchor for the extraction result hash (D5, saga step 11).
///
/// D33: async — see [`ExtractionClient`].
#[async_trait::async_trait]
pub trait LedgerAnchor: Send + Sync {
    async fn anchor_extraction(
        &self,
        file_id: Uuid,
        result_hash: &str,
    ) -> Result<String, LedgerError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LedgerOutcome {
    Anchored(String),
    PendingRetry(String),
}

#[derive(Debug, Clone)]
pub struct IngestInput {
    pub file_id: Uuid,
    pub case_id: Uuid,
    pub confirmed_text: String,
    pub disposition: ReviewDisposition,
    pub source_ts: Option<OffsetDateTime>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone)]
pub enum StepOutcome {
    Committed {
        entity_ids: Vec<Uuid>,
        relationship_ids: Vec<Uuid>,
        graph_synced: bool,
        ledger: LedgerOutcome,
    },
    NeedsReview {
        reason: String,
    },
}

/// Step 8: human review gate. No-op while S3 is blocked: no script has a
/// measured CER gate, so every input reaching the saga already passed
/// through M3's review queue (FR-2.7) and confirmed text proceeds to
/// step 9.
// TODO(S3): when the per-script status table lands, branch here --
/// gated-script output with a clean gate proceeds, anything else stays
/// in review. Until then this function intentionally decides nothing.
fn step8_review_gate() -> bool {
    true
}

/// Canonical hash of the extraction result for the ledger anchor (D5):
/// SHA-256 over the stable JSON encoding. Deterministic field order
/// comes from the struct definitions, so equal extractions hash equal.
pub fn extraction_hash(result: &ExtractionResult) -> String {
    let canonical =
        serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string());
    let digest = Sha256::digest(canonical.as_bytes());
    format!("{digest:x}")
}

/// Saga steps 7-9. See module docs for ordering guarantees.
///
/// D33: async — every side effect here is I/O in production.
pub async fn run_steps_7_to_9(
    client: &dyn ExtractionClient,
    db: &dyn CaseDb,
    graph: &dyn GraphWriter,
    ledger: &dyn LedgerAnchor,
    input: IngestInput,
) -> StepOutcome {
    if input.disposition == ReviewDisposition::Rejected {
        db.set_file_status(input.file_id, FileStatus::NeedsReview).await;
        return StepOutcome::NeedsReview {
            reason: "rejected review text is never extracted (FR-2.7)".to_string(),
        };
    }
    if !step8_review_gate() {
        db.set_file_status(input.file_id, FileStatus::NeedsReview).await;
        return StepOutcome::NeedsReview {
            reason: "review gate held the document (TODO S3)".to_string(),
        };
    }

    let extraction = match client.extract(&input.confirmed_text, input.source_ts).await {
        Ok(result) => result,
        Err(ExtractionFailure::Quarantined { reason }) => {
            db.set_file_status(input.file_id, FileStatus::NeedsReview).await;
            return StepOutcome::NeedsReview { reason };
        }
    };
    if let Err(reason) = check_extraction(&extraction, &input.confirmed_text) {
        db.set_file_status(input.file_id, FileStatus::NeedsReview).await;
        return StepOutcome::NeedsReview { reason };
    }

    let batch = to_batch(&extraction);
    let persisted = match db
        .persist_extraction(input.file_id, input.case_id, input.provenance, batch)
        .await
    {
        Ok(ids) => ids,
        Err(PersistError::Failed(reason)) => {
            db.set_file_status(input.file_id, FileStatus::NeedsReview).await;
            return StepOutcome::NeedsReview { reason };
        }
    };

    let nodes: Vec<GraphNode> = extraction
        .entities
        .iter()
        .zip(persisted.entity_ids.iter())
        .map(|(entity, id)| GraphNode {
            entity_id: *id,
            label: entity.canonical_name.clone(),
            typ: entity.typ.clone(),
        })
        .collect();
    let edges: Vec<GraphEdge> = extraction
        .relationships
        .iter()
        .zip(persisted.relationship_ids.iter())
        .map(|(rel, id)| GraphEdge {
            relationship_id: *id,
            src_entity_id: persisted.entity_ids[rel.src_index],
            dst_entity_id: persisted.entity_ids[rel.dst_index],
            typ: rel.typ.clone(),
            weight: 0.0,
        })
        .collect();
    let mut graph_synced = true;
    if let Err(GraphError::Failed(_)) = graph.merge_case_graph(&nodes, &edges).await {
        // D4: Neo4j is a derived index. Mark pending for the reconciler;
        // Postgres rows stand -- never roll back a commit (the single most
        // important property of this step).
        db.mark_sync_pending(&persisted.entity_ids, &persisted.relationship_ids).await;
        graph_synced = false;
    }

    // M4-T4: wire the baseline function, version pinned by D27.
    let mut weights_pending = false;
    for rel_id in &persisted.relationship_ids {
        if db.recompute_weight(*rel_id, WEIGHT_PARAMS_VERSION).await.is_err() {
            weights_pending = true;
        }
    }
    if weights_pending {
        db.mark_sync_pending(&[], &persisted.relationship_ids).await;
    }

    let hash = extraction_hash(&extraction);
    let ledger_outcome = match ledger.anchor_extraction(input.file_id, &hash).await {
        Ok(tx_id) => LedgerOutcome::Anchored(tx_id),
        Err(LedgerError::Unavailable(reason)) => LedgerOutcome::PendingRetry(reason),
    };
    db.record_ledger(input.file_id, &ledger_outcome).await;
    db.set_file_status(input.file_id, FileStatus::Committed).await;
    StepOutcome::Committed {
        entity_ids: persisted.entity_ids,
        relationship_ids: persisted.relationship_ids,
        graph_synced: graph_synced && !weights_pending,
        ledger: ledger_outcome,
    }
}

/// Defense in depth at the saga boundary: indices resolve, spans are
/// ordered and inside the text. docs-lane validated already; this keeps
/// a malformed payload from ever reaching the transaction -- routed to
/// the visible queue instead of a crash (rule 9).
fn check_extraction(extraction: &ExtractionResult, text: &str) -> Result<(), String> {
    let count = extraction.entities.len();
    for entity in &extraction.entities {
        if entity.char_end < entity.char_start {
            return Err(format!("entity {:?} has an inverted span", entity.canonical_name));
        }
        if entity.char_end as usize > text.len() {
            return Err(format!("entity {:?} span exceeds source text", entity.canonical_name));
        }
    }
    for identifier in &extraction.identifiers {
        if identifier.entity_index >= count {
            return Err(format!(
                "identifier {:?} points at missing entity {}",
                identifier.value, identifier.entity_index
            ));
        }
        if identifier.char_end < identifier.char_start
            || identifier.char_end as usize > text.len()
        {
            return Err(format!("identifier {:?} has a bad span", identifier.value));
        }
    }
    for rel in &extraction.relationships {
        if rel.src_index >= count || rel.dst_index >= count {
            return Err(format!(
                "relationship {} points outside {count} entities",
                rel.typ
            ));
        }
    }
    Ok(())
}

/// Every evidence row carries source span, page and provenance (rule 8);
/// provenance is the file's value on every row (rule 7, explicit).
fn to_batch(extraction: &ExtractionResult) -> PersistBatch {
    let evidence = extraction
        .entities
        .iter()
        .map(|entity| NewEvidence {
            kind: "fir_text".to_string(),
            snippet: None,
            char_start: entity.char_start,
            char_end: entity.char_end,
            page_no: None,
            occurred_at: None,
            confidence: None,
        })
        .collect();
    PersistBatch {
        entities: extraction.entities.clone(),
        identifiers: extraction.identifiers.clone(),
        relationships: extraction.relationships.clone(),
        evidence,
    }
}

/// Weight math shared with the S5 calibration harness
/// (`eval/metrics/graph.py`): base score per evidence type times
/// exponential decay against the newest evidence on the edge. Kept next
/// to its caller so the parity requirement is visible; the SQL function
/// in the baseline migration is authoritative for production.
pub fn decay_contribution(base: f64, age_days: f64, half_life_days: f64) -> f64 {
    base * (-std::f64::consts::LN_2 * age_days / half_life_days).exp()
}

/// Look up one relationship type's base score in a versioned params map.
/// Unknown types score 0 rather than failing the batch (matches the SQL
/// `COALESCE(..., 0)`).
pub fn base_score(params: &HashMap<String, f64>, rel_type: &str) -> f64 {
    params.get(rel_type).copied().unwrap_or(0.0)
}
