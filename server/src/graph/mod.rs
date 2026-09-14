//! Graph queries and endpoints (M4-T3, D23, FR-4.1/FR-4.2/FR-4.3/FR-4.4).
//!
//! Person-centric (D23): every query defaults to person-to-person.
//! Other types are returned only when explicitly requested via `types`.
//! Traversal is pure functions over a `GraphSnapshot`; the `GraphStore`
//! trait serves snapshots, entity detail and edge evidence. The
//! in-memory implementation backs tests (including the seeded 100k-node
//! p95 measurement); the real implementation reads the Neo4j projection
//! over Bolt (reads are fine -- D10 restricts WRITES to the server saga,
//! which lives in `crate::saga`).
//!
//! Defaults state no policy, only predictability: absent `hops` means 2
//! (the contract example), absent `min_weight` means 0.0 (no floor --
//! the contract's `min_weight=5` is an example, not a measured optimum,
//! and hardcoding it would enshrine an example as policy), absent
//! `types` means person-only (D23). `RESULT_LIMIT` is a transport guard
//! against unbounded responses, not a relevance judgment.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Transport guard: BFS stops adding nodes beyond this many. Pagination
/// is the follow-up; silently truncating relevance-ranked results would
/// be worse than a stated cap, so the cap is a constant, documented.
pub const RESULT_LIMIT: usize = 500;

/// Baseline `entity_type` spellings. `Organisation` (contract §2.4 task
/// text) is accepted on input and normalised to `ORGANIZATION`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum EntityType {
    Person,
    Organization,
    Location,
    Vehicle,
    Account,
}

impl EntityType {
    pub fn parse(input: &str) -> Option<Self> {
        match input.trim().to_ascii_uppercase().as_str() {
            "PERSON" => Some(Self::Person),
            "ORGANIZATION" | "ORGANISATION" => Some(Self::Organization),
            "LOCATION" => Some(Self::Location),
            "VEHICLE" => Some(Self::Vehicle),
            "ACCOUNT" => Some(Self::Account),
            _ => None,
        }
    }

    pub fn default_set() -> HashSet<Self> {
        HashSet::from([Self::Person])
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub typ: EntityType,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphEdge {
    pub id: Uuid,
    pub src: Uuid,
    pub dst: Uuid,
    #[serde(rename = "type")]
    pub typ: String,
    pub weight: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphPayload {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TamperState {
    Verified,
    Pending,
    Tampered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceItem {
    pub id: i64,
    pub kind: String,
    pub snippet: Option<String>,
    pub char_start: Option<i64>,
    pub char_end: Option<i64>,
    pub page_no: Option<i32>,
    pub source_file_id: Uuid,
    pub provenance: String,
    pub tamper_state: TamperState,
    #[serde(with = "time::serde::rfc3339::option")]
    pub occurred_at: Option<OffsetDateTime>,
    /// Ledger anchor hash vs recomputed content hash (FR-7.2): both are
    /// shown on tampered rows. `None` until verification runs.
    pub ledger_hash: Option<String>,
    pub computed_hash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredNode {
    pub typ: EntityType,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct StoredEdge {
    pub id: Uuid,
    pub src: Uuid,
    pub dst: Uuid,
    pub typ: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Default)]
pub struct GraphSnapshot {
    pub nodes: HashMap<Uuid, StoredNode>,
    pub edges: Vec<StoredEdge>,
    adjacency: HashMap<Uuid, Vec<usize>>,
}

impl GraphSnapshot {
    /// Build a snapshot, indexing adjacency once up front (like a
    /// database index): queries traverse the index instead of scanning
    /// all edges per request. The index covers every edge; the per-query
    /// `min_weight` floor still applies during traversal.
    pub fn new(nodes: HashMap<Uuid, StoredNode>, edges: Vec<StoredEdge>) -> Self {
        let mut adjacency: HashMap<Uuid, Vec<usize>> = HashMap::new();
        for (index, edge) in edges.iter().enumerate() {
            adjacency.entry(edge.src).or_default().push(index);
            adjacency.entry(edge.dst).or_default().push(index);
        }
        Self { nodes, edges, adjacency }
    }
}

#[derive(Debug, Clone)]
pub struct StoredEvidence {
    pub id: i64,
    pub edge_id: Uuid,
    pub kind: String,
    pub snippet: Option<String>,
    pub char_start: Option<i64>,
    pub char_end: Option<i64>,
    pub page_no: Option<i32>,
    pub source_file_id: Uuid,
    pub provenance: String,
    pub occurred_at: Option<OffsetDateTime>,
    pub ledger_hash: Option<String>,
    pub computed_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredIdentifier {
    pub typ: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerificationState {
    Verified,
    Pending,
    Tampered,
}

/// Snapshot + detail + evidence access. Reads only; writes go through
/// the saga (D10).
pub trait GraphStore: Send + Sync {
    fn snapshot(&self, case_id: Uuid) -> Option<GraphSnapshot>;
    fn entity_detail(&self, entity_id: Uuid) -> Option<EntityDetail>;
    fn edge_evidence(&self, edge_id: Uuid) -> Vec<StoredEvidence>;
    fn file_verification(&self, file_id: Uuid) -> VerificationState;
}

#[derive(Debug, Clone)]
pub struct EntityDetail {
    pub node: GraphNode,
    pub identifiers: Vec<StoredIdentifier>,
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum QueryError {
    #[error("hops must be 1 or 2, got {0}")]
    TooManyHops(u8),
    #[error("unknown entity type: {0}")]
    UnknownType(String),
    #[error("entity not found")]
    NotFound,
}

/// Ego graph (FR-4.2): center plus neighbours out to `hops` (1 or 2 --
/// anything higher is rejected, not silently clamped). Only edges at or
/// above `min_weight` are followed. The types filter applies to
/// neighbours; the center is always included (an ego query excluding
/// its own center is meaningless).
pub fn ego_graph(
    snapshot: &GraphSnapshot,
    entity_id: Uuid,
    hops: u8,
    min_weight: f64,
    types: &HashSet<EntityType>,
) -> Result<GraphPayload, QueryError> {
    if !(1..=2).contains(&hops) {
        return Err(QueryError::TooManyHops(hops));
    }
    let center = snapshot.nodes.get(&entity_id).ok_or(QueryError::NotFound)?;

    let mut seen: HashMap<Uuid, u8> = HashMap::from([(entity_id, 0)]);
    let mut queue = VecDeque::from([entity_id]);
    let mut kept_edges: Vec<usize> = Vec::new();
    while let Some(current) = queue.pop_front() {
        let depth = seen[&current];
        if depth >= hops {
            continue;
        }
        if let Some(incident) = snapshot.adjacency.get(&current) {
            for &index in incident {
                let edge = &snapshot.edges[index];
                if edge.weight < min_weight {
                    continue;
                }
                let neighbour = if edge.dst == current { edge.src } else { edge.dst };
                if let std::collections::hash_map::Entry::Vacant(entry) = seen.entry(neighbour) {
                    entry.insert(depth + 1);
                    queue.push_back(neighbour);
                }
                if !kept_edges.contains(&index) {
                    kept_edges.push(index);
                }
                if seen.len() >= RESULT_LIMIT {
                    break;
                }
            }
        }
        if seen.len() >= RESULT_LIMIT {
            break;
        }
    }

    let mut nodes = vec![GraphNode {
        id: entity_id,
        typ: center.typ,
        label: center.label.clone(),
    }];
    for (id, stored) in &snapshot.nodes {
        if *id != entity_id && seen.contains_key(id) && types.contains(&stored.typ) {
            nodes.push(GraphNode { id: *id, typ: stored.typ, label: stored.label.clone() });
        }
    }
    let wanted: HashSet<Uuid> = nodes.iter().map(|node| node.id).collect();
    let mut edges = Vec::new();
    for &index in &kept_edges {
        let edge = &snapshot.edges[index];
        if wanted.contains(&edge.src) && wanted.contains(&edge.dst) {
            edges.push(GraphEdge {
                id: edge.id,
                src: edge.src,
                dst: edge.dst,
                typ: edge.typ.clone(),
                weight: edge.weight,
            });
        }
    }
    Ok(GraphPayload { nodes, edges })
}

/// Macro graph (FR-4.3): the full case network above the weight floor,
/// nodes restricted to the requested types (person-only by default).
pub fn macro_graph(
    snapshot: &GraphSnapshot,
    min_weight: f64,
    types: &HashSet<EntityType>,
) -> GraphPayload {
    let mut nodes = Vec::new();
    for (id, stored) in &snapshot.nodes {
        if types.contains(&stored.typ) {
            nodes.push(GraphNode { id: *id, typ: stored.typ, label: stored.label.clone() });
        }
    }
    let wanted: HashSet<Uuid> = nodes.iter().map(|node| node.id).collect();
    let mut edges = Vec::new();
    for edge in &snapshot.edges {
        if edge.weight >= min_weight && wanted.contains(&edge.src) && wanted.contains(&edge.dst) {
            edges.push(GraphEdge {
                id: edge.id,
                src: edge.src,
                dst: edge.dst,
                typ: edge.typ.clone(),
                weight: edge.weight,
            });
        }
    }
    nodes.truncate(RESULT_LIMIT);
    GraphPayload { nodes, edges }
}

/// In-memory store: empty by default, seedable in tests. Production
/// reads come from the Neo4j projection (follow-up); the traversal
/// above is backend-agnostic and already measured (see
/// `server/tests/graph_p95.rs`).
#[derive(Debug, Clone, Default)]
pub struct InMemoryGraphStore {
    inner: Arc<Mutex<InMemoryGraph>>,
}

#[derive(Debug, Default)]
struct InMemoryGraph {
    cases: HashMap<Uuid, GraphSnapshot>,
    details: HashMap<Uuid, EntityDetail>,
    evidence: HashMap<Uuid, Vec<StoredEvidence>>,
    verification: HashMap<Uuid, VerificationState>,
}

impl InMemoryGraphStore {
    fn lock(&self) -> MutexGuard<'_, InMemoryGraph> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn seed_case(&self, case_id: Uuid, snapshot: GraphSnapshot) {
        self.lock().cases.insert(case_id, snapshot);
    }

    pub fn seed_detail(&self, entity_id: Uuid, detail: EntityDetail) {
        self.lock().details.insert(entity_id, detail);
    }

    pub fn seed_evidence(&self, edge_id: Uuid, rows: Vec<StoredEvidence>) {
        self.lock().evidence.insert(edge_id, rows);
    }

    pub fn seed_verification(&self, file_id: Uuid, state: VerificationState) {
        self.lock().verification.insert(file_id, state);
    }
}

impl GraphStore for InMemoryGraphStore {
    fn snapshot(&self, case_id: Uuid) -> Option<GraphSnapshot> {
        self.lock().cases.get(&case_id).cloned()
    }

    fn entity_detail(&self, entity_id: Uuid) -> Option<EntityDetail> {
        self.lock().details.get(&entity_id).cloned()
    }

    fn edge_evidence(&self, edge_id: Uuid) -> Vec<StoredEvidence> {
        self.lock().evidence.get(&edge_id).cloned().unwrap_or_default()
    }

    fn file_verification(&self, file_id: Uuid) -> VerificationState {
        self.lock().verification.get(&file_id).copied().unwrap_or(VerificationState::Pending)
    }
}

fn tamper_state(state: VerificationState) -> TamperState {
    match state {
        VerificationState::Verified => TamperState::Verified,
        VerificationState::Pending => TamperState::Pending,
        VerificationState::Tampered => TamperState::Tampered,
    }
}

// --- HTTP surface (API_CONTRACTS.md §2.4) ---------------------------------

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
    detail: serde_json::Value,
    retryable: bool,
    trace_id: String,
}

fn error(code: &'static str, status: StatusCode, message: impl Into<String>) -> impl IntoResponse {
    (
        status,
        Json(ErrorEnvelope {
            error: ErrorBody {
                code,
                message: message.into(),
                detail: serde_json::json!({}),
                retryable: false,
                trace_id: ulid::Ulid::new().to_string(),
            },
        }),
    )
}

/// Bearer presence check (mirrors `api::review`; consolidated when auth
/// wiring lands -- duplicated, not shared, so M2/M3 files stay untouched).
fn require_session(headers: &HeaderMap) -> Option<axum::response::Response> {
    let authorised = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value.strip_prefix("Bearer ").is_some_and(|token| !token.trim().is_empty())
        });
    if authorised {
        None
    } else {
        Some(
            error(
                "UNAUTHENTICATED",
                StatusCode::UNAUTHORIZED,
                "valid session required (Bearer token)",
            )
            .into_response(),
        )
    }
}

fn parse_types(raw: Option<String>) -> Result<HashSet<EntityType>, String> {
    let Some(raw) = raw else {
        return Ok(EntityType::default_set());
    };
    let mut types = HashSet::new();
    for part in raw.split(',') {
        match EntityType::parse(part) {
            Some(typ) => {
                types.insert(typ);
            }
            None => {
                return Err(format!("unknown entity type: {part}"));
            }
        }
    }
    Ok(types)
}

#[derive(Clone)]
struct GraphState {
    store: InMemoryGraphStore,
}

pub fn router(store: InMemoryGraphStore) -> Router {
    let state = GraphState { store };
    Router::new()
        .route("/cases/:case_id/graph/ego", get(ego_handler))
        .route("/cases/:case_id/graph/macro", get(macro_handler))
        .route("/edges/:id/evidence", get(evidence_handler))
        .with_state(state)
        // NOTE: GET /entities/:id is NOT served here. It briefly lived in
        // both this router and api::entities, which is a boot panic once
        // merged (axum rejects same-path+method overlaps) or a silent
        // shadow. The canonical owner is api::entities: verified GoTrue
        // identity, assignment enforcement, audit row, and the full §2.5
        // shape (associated cases + provenance), which the projection
        // detail below never had.
}

#[derive(Debug, Deserialize)]
struct EgoQuery {
    entity_id: Option<Uuid>,
    hops: Option<u8>,
    min_weight: Option<f64>,
    types: Option<String>,
}

/// GET /cases/{id}/graph/ego (FR-4.2). `entity_id` is required;
/// `hops` defaults to 2, `min_weight` to 0.0, `types` to person-only.
async fn ego_handler(
    State(state): State<GraphState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Query(query): Query<EgoQuery>,
) -> impl IntoResponse {
    if let Some(unauthorised) = require_session(&headers) {
        return unauthorised;
    }
    let Some(entity_id) = query.entity_id else {
        return error(
            "VALIDATION_FAILED",
            StatusCode::UNPROCESSABLE_ENTITY,
            "entity_id is required",
        )
        .into_response();
    };
    let types = match parse_types(query.types) {
        Ok(types) => types,
        Err(message) => {
            return error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, message)
                .into_response()
        }
    };
    let Some(snapshot) = state.store.snapshot(case_id) else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, "case graph not found").into_response();
    };
    match ego_graph(&snapshot, entity_id, query.hops.unwrap_or(2), query.min_weight.unwrap_or(0.0), &types) {
        Ok(payload) => (StatusCode::OK, Json(serde_json::to_value(payload).unwrap_or_default()))
            .into_response(),
        Err(QueryError::TooManyHops(_)) => error(
            "VALIDATION_FAILED",
            StatusCode::UNPROCESSABLE_ENTITY,
            "hops must be 1 or 2",
        )
        .into_response(),
        Err(QueryError::NotFound) => {
            error("NOT_FOUND", StatusCode::NOT_FOUND, "entity not found").into_response()
        }
        Err(QueryError::UnknownType(_)) => error(
            "VALIDATION_FAILED",
            StatusCode::UNPROCESSABLE_ENTITY,
            "unknown entity type",
        )
        .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct MacroQuery {
    min_weight: Option<f64>,
    types: Option<String>,
}

/// GET /cases/{id}/graph/macro (FR-4.3): full case network above the
/// floor, person-to-person unless `types` says otherwise.
async fn macro_handler(
    State(state): State<GraphState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Query(query): Query<MacroQuery>,
) -> impl IntoResponse {
    if let Some(unauthorised) = require_session(&headers) {
        return unauthorised;
    }
    let types = match parse_types(query.types) {
        Ok(types) => types,
        Err(message) => {
            return error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, message)
                .into_response()
        }
    };
    let Some(snapshot) = state.store.snapshot(case_id) else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, "case graph not found").into_response();
    };
    let payload = macro_graph(&snapshot, query.min_weight.unwrap_or(0.0), &types);
    (StatusCode::OK, Json(payload)).into_response()
}

/// GET /edges/{id}/evidence (FR-4.4): separate call by design -- it
/// never triggers a graph re-query or layout reflow. Each row carries
/// `tamper_state` (FR-4.6): a failed ledger verification marks the row
/// tampered, pending verification marks it pending.
async fn evidence_handler(
    State(state): State<GraphState>,
    headers: HeaderMap,
    Path(edge_id): Path<Uuid>,
) -> impl IntoResponse {
    if let Some(unauthorised) = require_session(&headers) {
        return unauthorised;
    }
    let items: Vec<EvidenceItem> = state
        .store
        .edge_evidence(edge_id)
        .iter()
        .map(|row| EvidenceItem {
            id: row.id,
            kind: row.kind.clone(),
            snippet: row.snippet.clone(),
            char_start: row.char_start,
            char_end: row.char_end,
            page_no: row.page_no,
            source_file_id: row.source_file_id,
            provenance: row.provenance.clone(),
            tamper_state: tamper_state(state.store.file_verification(row.source_file_id)),
            occurred_at: row.occurred_at,
            ledger_hash: row.ledger_hash.clone(),
            computed_hash: row.computed_hash.clone(),
        })
        .collect();
    (StatusCode::OK, Json(items)).into_response()
}
