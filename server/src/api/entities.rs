//! Entity merge proposal and decision endpoints (M4, FR-3.3, API_CONTRACTS.md §2.5).
//!
//! Rule 1 applies to merges exactly as it does to Re-ID candidates: a merge
//! is a proposal with `status='proposed'` until a person confirms it through
//! `POST /merges/{id}/decide` — the ONLY path that applies a merge. There is
//! no auto-merge path and no direct-apply flag.
//!
//! Auth→audit→anchor (M5-T3, D21, FR-7.4), mirroring `reid.rs`
//! `decide_candidate`: verified GoTrue identity, io role only (the auditor
//! is read-only and the admin's D37 read grant doesn't extend to
//! deciding), an audit row per decision, and a ledger `POST /action`
//! anchor with the actor's `profiles.ledger_id` (`skipped_no_identity`
//! when unconfigured).
//!
//! Consistency (D4): Postgres commits first and is the source of truth. The
//! Neo4j `MERGE` consolidation runs after; on graph failure the merge row
//! is marked `sync_state='pending'` and Postgres is NOT rolled back — a
//! reconciler/`rebuild_graph()` heals the projection. Stores are
//! in-memory with the same documented follow-up as `reid.rs`/`review.rs`
//! (real persistence through `entities`/`entity_merges` with per-case RLS).
//!
//! Explicit choice (flagged, not silent): proposing a merge across two
//! different cases is rejected with `CASE_ACCESS_DENIED`. A cross-case
//! merge would fuse two people's records across an access boundary, which
//! is exactly the harm RLS exists to prevent.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use ts_rs::TS;
use uuid::Uuid;

use crate::audit::{record_action, AssignmentStore, AuditStore};
use crate::auth::{authenticate_io, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::ledger::LedgerClient;

/// Postgres-side sync state (D4): the graph projection lags, never leads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum SyncState {
    Synced,
    Pending,
    Merged,
}

/// One entity row as held by this service.
#[derive(Debug, Clone, Serialize, TS)]
pub struct Entity {
    pub id: Uuid,
    pub case_id: Uuid,
    pub entity_type: String,
    pub canonical_name: String,
    pub aliases: Vec<String>,
    pub identifiers: Vec<String>,
    pub relationships: Vec<Uuid>,
    pub provenance: String,
    pub sync_state: SyncState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum MergeStatus {
    Proposed,
    Confirmed,
    Rejected,
}

/// Pre-merge state of both merge participants, captured at confirm
/// time (FR-3.3 `entity_merges.reversible_snapshot`). A wrong merge fuses
/// two people's records; the snapshot is what unwinds it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ReversibleSnapshot {
    pub surviving_aliases: Vec<String>,
    pub surviving_identifiers: Vec<String>,
    pub surviving_relationships: Vec<Uuid>,
    pub merged_aliases: Vec<String>,
    pub merged_identifiers: Vec<String>,
    pub merged_relationships: Vec<Uuid>,
}

/// One merge proposal row as held by this service.
#[derive(Debug, Clone, Serialize, TS)]
pub struct MergeProposal {
    // Wire integers are JSON numbers: ids are small sequences, never near
    // 2^53, so `number` (not ts-rs's default `bigint`, which JSON.parse
    // never produces) is the honest client type. Same on every i64 below.
    #[ts(type = "number")]
    pub id: i64,
    pub case_id: Uuid,
    pub surviving_id: Uuid,
    pub merged_id: Uuid,
    pub reason: String,
    pub status: MergeStatus,
    pub sync_state: SyncState,
    pub decided_by: Option<Uuid>,
    pub ledger_tx_id: Option<String>,
    pub reversible_snapshot: Option<ReversibleSnapshot>,
    #[serde(with = "time::serde::rfc3339::option")]
    #[ts(type = "string | null")]
    pub reverted_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Default)]
pub struct EntityStore(Arc<Mutex<Vec<Entity>>>);

#[derive(Debug, Clone, Default)]
pub struct MergeStore(Arc<Mutex<Vec<MergeProposal>>>);

/// One annotation on an entity (FR-7.4 attributable actions). `created_at`
/// is copied from the annotation's own audit row rather than read from
/// the clock a second time, so `OffsetDateTime::now_utc` keeps exactly
/// one call site in the service (the audit emitter, per rule 3).
#[derive(Debug, Clone, Serialize, TS)]
pub struct EntityNote {
    pub id: Uuid,
    pub entity_id: Uuid,
    pub text: String,
    pub created_by: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Default)]
pub struct NotesStore(Arc<Mutex<Vec<EntityNote>>>);

impl NotesStore {
    fn lock(&self) -> MutexGuard<'_, Vec<EntityNote>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn insert(&self, note: EntityNote) {
        self.lock().push(note);
    }

    pub fn notes_for(&self, entity_id: &Uuid) -> Vec<EntityNote> {
        self.lock().iter().filter(|note| &note.entity_id == entity_id).cloned().collect()
    }
}

/// Test-seeded Neo4j stand-in for the D4 consolidation step: records every
/// consolidation and fails on demand so tests prove Postgres is not rolled
/// back. Production issues Cypher `MERGE` through the saga's graph writer.
#[derive(Debug, Clone, Default)]
pub struct ConsolidateGraph(Arc<Mutex<GraphConsolidations>>);

#[derive(Debug, Default)]
struct GraphConsolidations {
    log: Vec<(Uuid, Uuid)>,
    fail: bool,
}

impl EntityStore {
    fn lock(&self) -> MutexGuard<'_, Vec<Entity>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn insert(&self, entity: Entity) {
        self.lock().push(entity);
    }

    pub fn get(&self, id: &Uuid) -> Option<Entity> {
        self.lock().iter().find(|entity| &entity.id == id).cloned()
    }

    pub fn all(&self) -> Vec<Entity> {
        self.lock().clone()
    }
}

impl MergeStore {
    fn lock(&self) -> MutexGuard<'_, Vec<MergeProposal>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn insert(&self, proposal: MergeProposal) {
        self.lock().push(proposal);
    }
}

impl ConsolidateGraph {
    fn lock(&self) -> MutexGuard<'_, GraphConsolidations> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Fail the next consolidations (test hook for the D4 path).
    pub fn set_fail(&self, fail: bool) {
        self.lock().fail = fail;
    }

    /// Consolidation calls observed, in order (test hook).
    pub fn consolidations(&self) -> Vec<(Uuid, Uuid)> {
        self.lock().log.clone()
    }

    fn consolidate(&self, surviving_id: Uuid, merged_id: Uuid) -> Result<(), String> {
        let mut guard = self.lock();
        if guard.fail {
            return Err("neo4j unavailable (injected)".to_string());
        }
        guard.log.push((surviving_id, merged_id));
        Ok(())
    }
}

#[derive(Debug, Deserialize, TS)]
pub struct ProposeMergeRequest {
    pub surviving_id: Uuid,
    pub merged_id: Uuid,
    pub reason: String,
}

#[derive(Debug, Serialize, TS)]
pub struct ProposeMergeResponse {
    #[ts(type = "number")]
    pub merge_id: i64,
    pub status: MergeStatus,
}

#[derive(Debug, Deserialize, TS)]
pub struct DecideMergeRequest {
    pub decision: DecideDecision,
    pub note: Option<String>,
}

// NOTE: reid.rs has an identical DecideDecision; both export to the
// same DecideDecision.ts (contents identical). If either shape changes,
// rename one of them instead of silently forking the generated file.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum DecideDecision {
    Confirmed,
    Rejected,
}

#[derive(Debug, Serialize, TS)]
pub struct DecideMergeResponse {
    #[ts(type = "number")]
    pub merge_id: i64,
    pub status: MergeStatus,
    pub ledger_tx_id: Option<String>,
    pub ledger_status: String,
}

#[derive(Debug, Serialize, TS)]
pub struct RevertMergeResponse {
    #[ts(type = "number")]
    pub merge_id: i64,
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub reverted_at: OffsetDateTime,
    pub ledger_tx_id: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub(crate) struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize, TS)]
pub(crate) struct ErrorBody {
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

/// M5 attribution dependencies shared with `reid.rs` (D21), plus the graph
/// consolidation step (D4/D10: the server is the sole graph writer).
#[derive(Clone)]
pub struct EntitiesDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
    pub assignments: AssignmentStore,
    pub notes: NotesStore,
    pub graph: ConsolidateGraph,
}

#[derive(Clone)]
struct EntitiesState {
    entities: EntityStore,
    merges: MergeStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
    assignments: AssignmentStore,
    notes: NotesStore,
    graph: ConsolidateGraph,
    next_merge_id: Arc<Mutex<i64>>,
}

pub fn router(entities: EntityStore, merges: MergeStore, deps: EntitiesDeps) -> Router {
    let state = EntitiesState {
        entities,
        merges,
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
        assignments: deps.assignments,
        notes: deps.notes,
        graph: deps.graph,
        next_merge_id: Arc::new(Mutex::new(1)),
    };
    Router::new()
        .route("/cases/:id/entities", get(list_entities))
        .route("/entities/:id", get(read_entity))
        .route("/entities/:id/notes", post(create_note))
        .route("/entities/merge", post(propose_merge))
        .route("/merges/:id/decide", post(decide_merge))
        .route("/merges/:id/revert", post(revert_merge))
        .with_state(state)
}

fn hex_of(hasher: Sha256) -> String {
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// POST /entities/merge (API_CONTRACTS.md §2.5): propose a merge. The
/// response status is always `proposed` — never applied directly (rule 1).
async fn propose_merge(
    State(state): State<EntitiesState>,
    headers: HeaderMap,
    Json(req): Json<ProposeMergeRequest>,
) -> Response {
    if let Err(boxed) = authenticate_io(&headers, &state.auth).await {
        return *boxed;
    }
    if req.surviving_id == req.merged_id {
        return error(
            "VALIDATION_FAILED",
            StatusCode::UNPROCESSABLE_ENTITY,
            "surviving_id and merged_id must differ: a self-merge is always a caller error",
        )
        .into_response();
    }
    let (surviving, merged) = {
        let guard = state.entities.lock();
        let surviving = guard.iter().find(|entity| entity.id == req.surviving_id).cloned();
        let merged = guard.iter().find(|entity| entity.id == req.merged_id).cloned();
        (surviving, merged)
    };
    let (Some(surviving), Some(merged)) = (surviving, merged) else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, "one or both entities not found")
            .into_response();
    };
    if surviving.case_id != merged.case_id {
        return error(
            "CASE_ACCESS_DENIED",
            StatusCode::FORBIDDEN,
            "cross-case merges are denied: a merge fuses records across an access boundary",
        )
        .into_response();
    }
    let merge_id = {
        let mut next = state.next_merge_id.lock().unwrap_or_else(|p| p.into_inner());
        let id = *next;
        *next += 1;
        id
    };
    state.merges.insert(MergeProposal {
        id: merge_id,
        case_id: surviving.case_id,
        surviving_id: surviving.id,
        merged_id: merged.id,
        reason: req.reason,
        status: MergeStatus::Proposed,
        sync_state: SyncState::Synced,
        decided_by: None,
        ledger_tx_id: None,
        reversible_snapshot: None,
        reverted_at: None,
    });
    (StatusCode::CREATED, Json(ProposeMergeResponse { merge_id, status: MergeStatus::Proposed }))
        .into_response()
}

/// POST /merges/{id}/decide: the ONLY path that applies a merge (rule 1).
/// Confirmed: the surviving entity absorbs aliases, identifiers and
/// relationships; the merged row is marked `merged`; the graph
/// consolidation runs after the Postgres change and its failure marks
/// `sync_state='pending'` without rolling anything back (D4). Rejected:
/// status only, no graph change. Both write an audit row and anchor.
async fn decide_merge(
    State(state): State<EntitiesState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<DecideMergeRequest>,
) -> impl IntoResponse {
    // M5-T1/T3: verified GoTrue identity, io role only.
    let decider = match authenticate_io(&headers, &state.auth).await {
        Ok(user_id) => user_id,
        Err(boxed) => return *boxed,
    };
    let (case_id, surviving_id, merged_id) = {
        let guard = state.merges.lock();
        match guard.iter().find(|proposal| proposal.id == id) {
            None => {
                return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("merge {id} not found"))
                    .into_response();
            }
            Some(proposal) if proposal.status != MergeStatus::Proposed => {
                return error(
                    "CONFLICT",
                    StatusCode::CONFLICT,
                    format!("merge {id} already decided"),
                )
                .into_response();
            }
            Some(proposal) => (proposal.case_id, proposal.surviving_id, proposal.merged_id),
        }
    };
    let status = match req.decision {
        DecideDecision::Confirmed => MergeStatus::Confirmed,
        DecideDecision::Rejected => MergeStatus::Rejected,
    };
    // Postgres first (D4 source of truth). Graph consolidation follows and
    // its failure only marks pending — never rolls this back.
    let (graph_outcome, confirmed_snapshot): (Option<Result<(), String>>, Option<ReversibleSnapshot>) =
        if status == MergeStatus::Confirmed {
            // Snapshot both participants BEFORE mutating: this is the
            // `reversible_snapshot` that `POST /merges/{id}/revert`
            // restores. Scoped so the lock is released before the graph
            // call below — a guard held across work it does not protect
            // is how silent deadlocks start.
            let snapshot = {
                let guard = state.entities.lock();
                let surviving = guard.iter().find(|entity| entity.id == surviving_id).cloned();
                let merged = guard.iter().find(|entity| entity.id == merged_id).cloned();
                match (surviving, merged) {
                    (Some(surviving), Some(merged)) => Some(ReversibleSnapshot {
                        surviving_aliases: surviving.aliases,
                        surviving_identifiers: surviving.identifiers,
                        surviving_relationships: surviving.relationships,
                        merged_aliases: merged.aliases,
                        merged_identifiers: merged.identifiers,
                        merged_relationships: merged.relationships,
                    }),
                    _ => None,
                }
            };
            {
                let mut guard = state.entities.lock();
                let merged_snapshot = guard.iter().find(|entity| entity.id == merged_id).cloned();
                let Some(merged) = merged_snapshot else {
                    return error(
                        "INTERNAL",
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("merge {id} points at a missing entity"),
                    )
                    .into_response();
                };
            if let Some(surviving) = guard.iter_mut().find(|entity| entity.id == surviving_id) {
                let mut aliases: HashSet<String> =
                    surviving.aliases.iter().cloned().collect();
                aliases.extend(merged.aliases);
                aliases.insert(merged.canonical_name);
                surviving.aliases = {
                    let mut sorted: Vec<String> = aliases.into_iter().collect();
                    sorted.sort();
                    sorted
                };
                let mut identifiers: HashSet<String> =
                    surviving.identifiers.iter().cloned().collect();
                identifiers.extend(merged.identifiers);
                surviving.identifiers = {
                    let mut sorted: Vec<String> = identifiers.into_iter().collect();
                    sorted.sort();
                    sorted
                };
                let mut relationships: HashSet<Uuid> =
                    surviving.relationships.iter().copied().collect();
                relationships.extend(merged.relationships);
                relationships.remove(&surviving_id);
                relationships.remove(&merged_id);
                surviving.relationships = {
                    let mut sorted: Vec<Uuid> = relationships.into_iter().collect();
                    sorted.sort();
                    sorted
                };
            }
            if let Some(merged_row) = guard.iter_mut().find(|entity| entity.id == merged_id) {
                merged_row.sync_state = SyncState::Merged;
            }
        }
        (Some(state.graph.consolidate(surviving_id, merged_id)), snapshot)
    } else {
        (None, None)
    };
    {
        let mut guard = state.merges.lock();
        if let Some(proposal) = guard.iter_mut().find(|proposal| proposal.id == id) {
            proposal.status = status;
            proposal.decided_by = Some(decider);
            if status == MergeStatus::Confirmed {
                proposal.reversible_snapshot = confirmed_snapshot;
            }
            proposal.sync_state = match &graph_outcome {
                None => SyncState::Synced,
                Some(Ok(())) => SyncState::Synced,
                Some(Err(_)) => SyncState::Pending,
            };
        }
    }
    if let Some(Err(detail)) = &graph_outcome {
        tracing::warn!(
            merge_id = id,
            detail = %detail,
            "graph consolidation failed; Postgres merge stands, row marked pending (D4)"
        );
    }
    let _note = req.note;
    let decision_digest = {
        let mut hasher = Sha256::new();
        hasher.update(id.to_be_bytes());
        hasher.update(format!("{status:?}").as_bytes());
        hasher.update(decider.as_bytes());
        hex_of(hasher)
    };
    let row = record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id,
            user_id: decider,
            user_role: crate::auth::AppRole::Io,
            action: if status == MergeStatus::Confirmed {
                "merge.confirm".to_string()
            } else {
                "merge.reject".to_string()
            },
            object_type: "entity_merge".to_string(),
            object_id: id.to_string(),
            payload_hash: decision_digest,
        },
    )
    .await;
    {
        let mut guard = state.merges.lock();
        if let Some(proposal) = guard.iter_mut().find(|proposal| proposal.id == id) {
            proposal.ledger_tx_id = row.ledger_tx_id.clone();
        }
    }
    let response = DecideMergeResponse {
        merge_id: id,
        status,
        ledger_tx_id: row.ledger_tx_id,
        ledger_status: row.ledger_status,
    };
    (StatusCode::OK, Json(response)).into_response()
}

/// POST /merges/{id}/revert (API_CONTRACTS.md §2.5): unwind a confirmed
/// merge by restoring both participants from the `reversible_snapshot`
/// captured at confirm time (FR-3.3). Only a confirmed, not-yet-reverted
/// merge can be reverted: a pending or rejected merge has nothing to
/// unwind (409), and an already-reverted merge cannot be reverted twice
/// (409). Both entities go back to `sync_state='pending'` so the
/// reconciler re-syncs the derived Neo4j projection (D4 — Postgres is the
/// source of truth). Status returns to `proposed` so the merge stays
/// visible in history as reverted rather than vanishing. The revert is
/// audit-logged (`merge.revert`) and ledger-anchored like every other
/// merge decision.
async fn revert_merge(
    State(state): State<EntitiesState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    // M5-T1/T3: verified GoTrue identity, io role only — the auditor is
    // read-only and the admin's D37 read grant doesn't extend to
    // reverting, same as decide.
    let reverter = match authenticate_io(&headers, &state.auth).await {
        Ok(user_id) => user_id,
        Err(boxed) => return *boxed,
    };
    let (case_id, surviving_id, merged_id, snapshot) = {
        let guard = state.merges.lock();
        let Some(proposal) = guard.iter().find(|proposal| proposal.id == id) else {
            return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("merge {id} not found"))
                .into_response();
        };
        if proposal.status != MergeStatus::Confirmed {
            return error(
                "CONFLICT",
                StatusCode::CONFLICT,
                format!("merge {id} is not confirmed: only a confirmed merge can be reverted"),
            )
            .into_response();
        }
        if proposal.reverted_at.is_some() {
            return error(
                "CONFLICT",
                StatusCode::CONFLICT,
                format!("merge {id} was already reverted"),
            )
            .into_response();
        }
        let Some(snapshot) = proposal.reversible_snapshot.clone() else {
            // Confirm always stores a snapshot: a confirmed merge without
            // one is corrupt state, failed loud rather than half-unwound.
            return error(
                "INTERNAL",
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("merge {id} has no reversible snapshot"),
            )
            .into_response();
        };
        (proposal.case_id, proposal.surviving_id, proposal.merged_id, snapshot)
    };
    // Postgres first (D4 source of truth): restore both participants to
    // their pre-merge state and mark them pending for the reconciler.
    // Scoped so the lock is released before the audit call below.
    {
        let mut guard = state.entities.lock();
        if let Some(surviving) = guard.iter_mut().find(|entity| entity.id == surviving_id) {
            surviving.aliases = snapshot.surviving_aliases.clone();
            surviving.identifiers = snapshot.surviving_identifiers.clone();
            surviving.relationships = snapshot.surviving_relationships.clone();
            surviving.sync_state = SyncState::Pending;
        }
        if let Some(merged) = guard.iter_mut().find(|entity| entity.id == merged_id) {
            merged.aliases = snapshot.merged_aliases.clone();
            merged.identifiers = snapshot.merged_identifiers.clone();
            merged.relationships = snapshot.merged_relationships.clone();
            merged.sync_state = SyncState::Pending;
        }
    }
    // now() correct here: revert is a system event timestamp, not a case clock event
    let reverted_at = OffsetDateTime::now_utc();
    {
        let mut guard = state.merges.lock();
        if let Some(proposal) = guard.iter_mut().find(|proposal| proposal.id == id) {
            proposal.status = MergeStatus::Proposed;
            proposal.reverted_at = Some(reverted_at);
        }
    }
    let revert_digest = {
        let mut hasher = Sha256::new();
        hasher.update(id.to_be_bytes());
        hasher.update(b"revert");
        hasher.update(reverter.as_bytes());
        hex_of(hasher)
    };
    let row = record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id,
            user_id: reverter,
            user_role: crate::auth::AppRole::Io,
            action: "merge.revert".to_string(),
            object_type: "entity_merge".to_string(),
            object_id: id.to_string(),
            payload_hash: revert_digest,
        },
    )
    .await;
    {
        let mut guard = state.merges.lock();
        if let Some(proposal) = guard.iter_mut().find(|proposal| proposal.id == id) {
            proposal.ledger_tx_id = row.ledger_tx_id.clone();
        }
    }
    let response = RevertMergeResponse { merge_id: id, reverted_at, ledger_tx_id: row.ledger_tx_id };
    (StatusCode::OK, Json(response)).into_response()
}

/// Default page size for the entity list. Explicit choice, stated here
/// rather than guessed per request: 50 rows default, 100 hard cap, so a
/// case with thousands of entities cannot balloon one response.
const DEFAULT_LIST_LIMIT: usize = 50;
const MAX_LIST_LIMIT: usize = 100;

#[derive(Debug, Deserialize)]
pub struct ListEntitiesQuery {
    #[serde(rename = "type")]
    pub entity_type: Option<String>,
    pub search: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct EntityListItem {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub entity_type: String,
    pub canonical_name: String,
    pub identifiers: Vec<String>,
    pub case_count: usize,
    pub provenance: String,
    pub sync_state: SyncState,
}

#[derive(Debug, Serialize, TS)]
pub struct ListEntitiesResponse {
    pub results: Vec<EntityListItem>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, TS)]
pub struct EntityDetailResponse {
    pub id: Uuid,
    pub case_id: Uuid,
    #[serde(rename = "type")]
    pub entity_type: String,
    pub canonical_name: String,
    pub aliases: Vec<String>,
    pub identifiers: Vec<String>,
    pub relationships: Vec<Uuid>,
    pub associated_cases: Vec<Uuid>,
    pub case_count: usize,
    pub provenance: String,
    pub sync_state: SyncState,
    pub notes: Vec<EntityNote>,
}

/// Any assigned role may read (mirrors `files.rs`: io, analyst, auditor),
/// plus the administrator unconditionally (D37 amends D21: admin has
/// unrestricted read access to case content, but still no write/confirm
/// path here). Callers assigned to no case here get `CASE_ACCESS_DENIED`,
/// never an empty list: an empty list would let a caller probe which
/// cases exist.
async fn authorize_case(
    headers: &HeaderMap,
    state: &EntitiesState,
    case_id: &Uuid,
) -> Result<AuthContext, Box<Response>> {
    crate::audit::authenticate_case_reader(
        headers,
        &state.auth,
        &state.assignments,
        case_id,
        &[AppRole::Io, AppRole::Analyst, AppRole::Auditor, AppRole::Admin],
    )
    .await
}

/// GET /cases/{id}/entities (API_CONTRACTS.md §2.5): filtered, searched,
/// paginated entity listing. `type` filters to one `entity_type` and
/// defaults to all types; `search` is a case-insensitive substring match
/// over `canonical_name` and `entity_aliases`. One `entities.list` audit
/// row per call (FR-7.4), ledger-anchored like every other read.
async fn list_entities(
    State(state): State<EntitiesState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Query(query): Query<ListEntitiesQuery>,
) -> Response {
    let context = match authorize_case(&headers, &state, &case_id).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let wanted_type: Option<String> = match query.entity_type {
        None => None,
        // Canonical parser (crate::graph::EntityType): ORGANISATION is
        // accepted and normalised, anything else fails loud rather than
        // returning a misleading empty list.
        Some(raw) => match crate::graph::EntityType::parse(&raw) {
            None => {
                return error(
                    "VALIDATION_FAILED",
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("unknown entity type: {raw}"),
                )
                .into_response()
            }
            Some(parsed) => Some(format!("{parsed:?}").to_ascii_uppercase()),
        },
    };
    let needle = query.search.map(|s| s.to_lowercase()).filter(|s| !s.is_empty());
    let limit = query.limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
    let offset: usize = match query.cursor {
        None => 0,
        Some(cursor) => match cursor.parse() {
            Ok(offset) => offset,
            Err(_) => {
                return error(
                    "VALIDATION_FAILED",
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "cursor is not a valid list offset",
                )
                .into_response()
            }
        },
    };
    let matching: Vec<Entity> = {
        let guard = state.entities.lock();
        guard
            .iter()
            .filter(|entity| entity.case_id == case_id)
            .filter(|entity| match &wanted_type {
                None => true,
                Some(t) => entity.entity_type.to_uppercase() == *t,
            })
            .filter(|entity| match &needle {
                None => true,
                Some(n) => {
                    entity.canonical_name.to_lowercase().contains(n.as_str())
                        || entity.aliases.iter().any(|a| a.to_lowercase().contains(n.as_str()))
                }
            })
            .cloned()
            .collect()
    };
    let page: Vec<EntityListItem> = matching
        .iter()
        .skip(offset)
        .take(limit)
        .map(|entity| EntityListItem {
            id: entity.id,
            entity_type: entity.entity_type.clone(),
            canonical_name: entity.canonical_name.clone(),
            identifiers: entity.identifiers.clone(),
            // Single-case model: every entity belongs to exactly its case
            // (cross-case merges are denied, see `propose_merge`). The
            // count is computed, not stored, so it cannot drift.
            case_count: 1,
            provenance: entity.provenance.clone(),
            sync_state: entity.sync_state,
        })
        .collect();
    let next_cursor =
        if offset + page.len() < matching.len() { Some((offset + page.len()).to_string()) } else { None };
    let digest_input = page.iter().map(|item| item.id.to_string()).collect::<Vec<_>>().join(",");
    let mut hasher = Sha256::new();
    hasher.update(case_id.as_bytes());
    hasher.update(digest_input.as_bytes());
    let payload_hash = hex_of(hasher);
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id,
            user_id: context.user_id,
            user_role: context.role,
            action: "entities.list".to_string(),
            object_type: "case".to_string(),
            object_id: case_id.to_string(),
            payload_hash,
        },
    )
    .await;
    (StatusCode::OK, Json(ListEntitiesResponse { results: page, next_cursor })).into_response()
}

/// GET /entities/{id} (API_CONTRACTS.md §2.5): full detail — identifiers,
/// aliases, associated cases and provenance. Lookup precedes
/// authorization, matching `files.rs`: a missing id is 404, an
/// unassigned case is 403. The read is audit-logged (`entity.read`).
async fn read_entity(
    State(state): State<EntitiesState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let Some(entity) = state.entities.get(&id) else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("entity {id} not found"))
            .into_response();
    };
    let context = match authorize_case(&headers, &state, &entity.case_id).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let mut hasher = Sha256::new();
    hasher.update(entity.id.as_bytes());
    hasher.update(entity.canonical_name.as_bytes());
    let payload_hash = hex_of(hasher);
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id: entity.case_id,
            user_id: context.user_id,
            user_role: context.role,
            action: "entity.read".to_string(),
            object_type: "entity".to_string(),
            object_id: entity.id.to_string(),
            payload_hash,
        },
    )
    .await;
    let response = EntityDetailResponse {
        id: entity.id,
        case_id: entity.case_id,
        entity_type: entity.entity_type.clone(),
        canonical_name: entity.canonical_name.clone(),
        aliases: entity.aliases.clone(),
        identifiers: entity.identifiers.clone(),
        relationships: entity.relationships.clone(),
        // Single-case model (see `list_entities`): the associated set is
        // exactly the owning case until merges ever span cases, which
        // `propose_merge` currently denies.
        associated_cases: vec![entity.case_id],
        case_count: 1,
        provenance: entity.provenance.clone(),
        sync_state: entity.sync_state,
        notes: state.notes.notes_for(&entity.id),
    };
    (StatusCode::OK, Json(response)).into_response()
}

/// Transport guard for annotation text (API_CONTRACTS.md §2.5).
const MAX_NOTE_CHARS: usize = 2000;

#[derive(Debug, Deserialize, TS)]
pub struct CreateNoteRequest {
    pub text: String,
}

/// POST /entities/{id}/notes (API_CONTRACTS.md §2.5): io-only annotation
/// on an entity in the caller's case. Attributed, audit-logged
/// (`entity.annotate`) and ledger-anchored (FR-7.4) — an annotation is an
/// evidentiary act, not a side comment.
async fn create_note(
    State(state): State<EntitiesState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateNoteRequest>,
) -> Response {
    let Some(entity) = state.entities.get(&id) else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("entity {id} not found"))
            .into_response();
    };
    let author = match authenticate_io(&headers, &state.auth).await {
        Ok(user_id) => user_id,
        Err(boxed) => return *boxed,
    };
    if !state.assignments.is_assigned(&entity.case_id, &author) {
        return error(
            "CASE_ACCESS_DENIED",
            StatusCode::FORBIDDEN,
            format!("no assignment for this user on case {}", entity.case_id),
        )
        .into_response();
    }
    let text = req.text.trim();
    if text.is_empty() {
        return error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, "note text must be non-empty")
            .into_response();
    }
    if text.chars().count() > MAX_NOTE_CHARS {
        return error(
            "VALIDATION_FAILED",
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("note text exceeds {MAX_NOTE_CHARS} characters"),
        )
        .into_response();
    }
    let note_id = Uuid::new_v4();
    let mut hasher = Sha256::new();
    hasher.update(note_id.as_bytes());
    hasher.update(text.as_bytes());
    let row = record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id: entity.case_id,
            user_id: author,
            user_role: crate::auth::AppRole::Io,
            action: "entity.annotate".to_string(),
            object_type: "entity_note".to_string(),
            object_id: note_id.to_string(),
            payload_hash: hex_of(hasher),
        },
    )
    .await;
    let note = EntityNote {
        id: note_id,
        entity_id: id,
        text: text.to_string(),
        created_by: author,
        created_at: row.created_at,
    };
    state.notes.insert(note.clone());
    (StatusCode::CREATED, Json(note)).into_response()
}
