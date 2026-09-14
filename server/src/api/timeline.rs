//! Case timeline endpoint (API_CONTRACTS.md §2.10).
//!
//! Merges every dateable event in a case into one chronological stream,
//! newest first by default (`order=asc` reverses):
//!
//! | Source | Event | Clock | Time |
//! |:---|:---|:---|:---|
//! | `source_files` | `file_ingested` | system | `ingested_at` |
//! | `evidence` | `evidence_committed` | case | `occurred_at` |
//! | Re-ID candidates | `candidate_proposed` | case | candidate `ts` |
//! | `audit_log` | `audit_action` | system | `created_at` |
//!
//! Clock discipline (D16, CLAUDE.md rule 3): every event carries
//! `clock: "case"` or `"system"` and the UI must render the label, never
//! bare timestamps. Case-clock events are analysis time
//! (`evidence.occurred_at`, the sighting's own `ts`); system-clock events
//! are infrastructure time (ingest receipt, audit rows). Rows without any
//! timestamp are undateable and excluded by definition — inventing a
//! timestamp for them would corrupt cross-camera reasoning.
//!
//! Entity linkage is reported where the model has it and empty where it
//! does not: evidence events reference their edge's endpoint entities,
//! audit events reference UUID-shaped `object_id`s; file and candidate
//! events carry `entity_refs: []` because neither `source_files` nor
//! lock-on targets link to entities in the current model. An empty refs
//! list means "no linkage", never "linkage withheld".

use std::cmp::Reverse;
use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::audit::{record_action, AssignmentStore, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::graph::{GraphStore, InMemoryGraphStore, VerificationState};
use crate::api::files::FileStore;
use crate::api::reid::{CandidateStore, TargetStore};
use crate::ledger::LedgerClient;

const DEFAULT_LIST_LIMIT: usize = 50;
const MAX_LIST_LIMIT: usize = 100;

const EVENT_FILE_INGESTED: &str = "file_ingested";
const EVENT_EVIDENCE_COMMITTED: &str = "evidence_committed";
const EVENT_CANDIDATE_PROPOSED: &str = "candidate_proposed";
const EVENT_AUDIT_ACTION: &str = "audit_action";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Clock {
    Case,
    System,
}

#[derive(Debug, Serialize)]
pub struct TimelineEvent {
    pub event_type: String,
    pub ts: String,
    pub clock: Clock,
    pub description: String,
    pub actor: Option<String>,
    pub entity_refs: Vec<String>,
    pub detail: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct TimelineResponse {
    pub results: Vec<TimelineEvent>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct TimelineQuery {
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub entity_id: Option<Uuid>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub order: Option<String>,
    pub limit: Option<usize>,
    pub cursor: Option<String>,
}

#[derive(Clone)]
pub struct TimelineDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
    pub assignments: AssignmentStore,
    pub files: FileStore,
    pub targets: TargetStore,
    pub candidates: CandidateStore,
    pub graph: InMemoryGraphStore,
}

#[derive(Clone)]
struct TimelineState {
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
    assignments: AssignmentStore,
    files: FileStore,
    targets: TargetStore,
    candidates: CandidateStore,
    graph: InMemoryGraphStore,
}

pub fn router(deps: TimelineDeps) -> Router {
    let state = TimelineState {
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
        assignments: deps.assignments,
        files: deps.files,
        targets: deps.targets,
        candidates: deps.candidates,
        graph: deps.graph,
    };
    Router::new().route("/cases/:id/timeline", get(case_timeline)).with_state(state)
}

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

fn error(code: &'static str, status: StatusCode, message: impl Into<String>) -> Response {
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
        .into_response()
}

async fn authorize(
    headers: &HeaderMap,
    state: &TimelineState,
    case_id: &Uuid,
) -> Result<AuthContext, Box<Response>> {
    let context = authenticate_request(
        headers,
        &state.auth,
        &[AppRole::Io, AppRole::Analyst, AppRole::Auditor],
    )
    .await?;
    if !state.assignments.is_assigned(case_id, &context.user_id) {
        return Err(Box::new(error(
            "CASE_ACCESS_DENIED",
            StatusCode::FORBIDDEN,
            format!("no assignment for this user on case {case_id}"),
        )));
    }
    Ok(context)
}

fn parse_time(value: &Option<String>) -> Result<Option<OffsetDateTime>, Box<Response>> {
    match value {
        None => Ok(None),
        Some(raw) => OffsetDateTime::parse(raw, &Rfc3339).map(Some).map_err(|_| {
            Box::new(error("VALIDATION_FAILED", StatusCode::BAD_REQUEST, "from/to must be RFC 3339"))
        }),
    }
}

fn format_ts(ts: &OffsetDateTime) -> String {
    ts.format(&Rfc3339).unwrap_or_default()
}

fn tamper_label(state: VerificationState) -> &'static str {
    match state {
        VerificationState::Verified => "verified",
        VerificationState::Pending => "pending",
        VerificationState::Tampered => "tampered",
    }
}

/// GET /cases/{id}/timeline (API_CONTRACTS.md §2.10).
async fn case_timeline(
    State(state): State<TimelineState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Query(query): Query<TimelineQuery>,
) -> Response {
    let context = match authorize(&headers, &state, &case_id).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    if let Some(kind) = &query.event_type {
        if !matches!(
            kind.as_str(),
            EVENT_FILE_INGESTED | EVENT_EVIDENCE_COMMITTED | EVENT_CANDIDATE_PROPOSED | EVENT_AUDIT_ACTION
        ) {
            return error(
                "VALIDATION_FAILED",
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("unknown event type: {kind}"),
            );
        }
    }
    let ascending = match query.order.as_deref() {
        None | Some("desc") => false,
        Some("asc") => true,
        Some(other) => {
            return error(
                "VALIDATION_FAILED",
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("order must be asc or desc, got {other}"),
            )
        }
    };
    let from = match parse_time(&query.from) {
        Ok(value) => value,
        Err(boxed) => return *boxed,
    };
    let to = match parse_time(&query.to) {
        Ok(value) => value,
        Err(boxed) => return *boxed,
    };
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

    let mut events: Vec<(OffsetDateTime, TimelineEvent)> = Vec::new();

    for file in state.files.files_for_case(&case_id) {
        events.push((
            file.ingested_at,
            TimelineEvent {
                event_type: EVENT_FILE_INGESTED.to_string(),
                ts: format_ts(&file.ingested_at),
                clock: Clock::System,
                description: format!("Document ingested: {}", file.name),
                actor: None,
                entity_refs: Vec::new(),
                detail: serde_json::json!({
                    "file_id": file.id,
                    "sha256": file.sha256,
                    "status": file.status,
                    "provenance": file.provenance,
                }),
            },
        ));
    }

    if let Some(snapshot) = state.graph.snapshot(case_id) {
        for edge in &snapshot.edges {
            let refs = vec![edge.src.to_string(), edge.dst.to_string()];
            for row in state.graph.edge_evidence(edge.id) {
                let Some(occurred_at) = row.occurred_at else {
                    continue;
                };
                let tamper = tamper_label(state.graph.file_verification(row.source_file_id));
                events.push((
                    occurred_at,
                    TimelineEvent {
                        event_type: EVENT_EVIDENCE_COMMITTED.to_string(),
                        ts: format_ts(&occurred_at),
                        clock: Clock::Case,
                        description: format!("{} evidence committed", row.kind),
                        actor: None,
                        entity_refs: refs.clone(),
                        detail: serde_json::json!({
                            "evidence_id": row.id,
                            "edge_id": edge.id,
                            "kind": row.kind,
                            "snippet": row.snippet,
                            "source_file_id": row.source_file_id,
                            "provenance": row.provenance,
                            "tamper_state": tamper,
                            "ledger_hash": row.ledger_hash,
                            "computed_hash": row.computed_hash,
                        }),
                    },
                ));
            }
        }
    }

    for target in state.targets.targets_for_case(&case_id) {
        for candidate in state.candidates.candidates_for_target(&target.id) {
            events.push((
                candidate.ts,
                TimelineEvent {
                    event_type: EVENT_CANDIDATE_PROPOSED.to_string(),
                    ts: format_ts(&candidate.ts),
                    clock: Clock::Case,
                    description: format!(
                        "Candidate proposed on camera {} (similarity {:.4})",
                        candidate.camera_id, candidate.similarity
                    ),
                    actor: candidate.decided_by.map(|user| user.to_string()),
                    entity_refs: Vec::new(),
                    detail: serde_json::json!({
                        "candidate_id": candidate.id,
                        "target_id": target.id,
                        "camera_id": candidate.camera_id,
                        "similarity": candidate.similarity,
                        "threshold_used": candidate.threshold_used,
                        "prior_adjustment": candidate.prior_adjustment,
                        "status": candidate.status,
                        "ledger_tx_id": candidate.ledger_tx_id,
                    }),
                },
            ));
        }
    }

    for row in state.audit.rows_for_case(&case_id) {
        let refs = Uuid::parse_str(&row.object_id).map(|id| vec![id.to_string()]).unwrap_or_default();
        events.push((
            row.created_at,
            TimelineEvent {
                event_type: EVENT_AUDIT_ACTION.to_string(),
                ts: format_ts(&row.created_at),
                clock: Clock::System,
                description: format!("Audit: {}", row.action),
                actor: Some(row.user_id.to_string()),
                entity_refs: refs,
                detail: serde_json::json!({
                    "action": row.action,
                    "object_type": row.object_type,
                    "object_id": row.object_id,
                    "ledger_tx_id": row.ledger_tx_id,
                    "ledger_status": row.ledger_status,
                }),
            },
        ));
    }

    if ascending {
        events.sort_by_key(|event| event.0);
    } else {
        events.sort_by_key(|event| Reverse(event.0));
    }
    let wanted_entity = query.entity_id.map(|id| id.to_string());
    let results: Vec<TimelineEvent> = events
        .into_iter()
        .map(|(_, event)| event)
        .filter(|event| match &query.event_type {
            None => true,
            Some(kind) => &event.event_type == kind,
        })
        .filter(|event| match &wanted_entity {
            None => true,
            Some(id) => event.entity_refs.iter().any(|reference| reference == id),
        })
        .filter(|event| {
            let Ok(ts) = OffsetDateTime::parse(&event.ts, &Rfc3339) else {
                return false;
            };
            if let Some(from) = from {
                if ts < from {
                    return false;
                }
            }
            if let Some(to) = to {
                if ts > to {
                    return false;
                }
            }
            true
        })
        .skip(offset)
        .take(limit + 1)
        .collect();
    let next_cursor = if results.len() > limit { Some((offset + limit).to_string()) } else { None };
    let results = results.into_iter().take(limit).collect();
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
            action: "timeline.read".to_string(),
            object_type: "case".to_string(),
            object_id: case_id.to_string(),
            payload_hash: case_id.to_string(),
        },
    )
    .await;
    (StatusCode::OK, Json(TimelineResponse { results, next_cursor })).into_response()
}
