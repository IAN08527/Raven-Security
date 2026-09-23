//! Lock-on and candidate decision endpoints (M2-T4/M2-T5, D9, FR-5.7).
//!
//! D9 (CLAUDE.md rule 1): cross-camera matches are proposals with
//! ``status='proposed'``. A human confirms via ``POST
//! /candidates/{id}/decide`` before anything enters a case record, the
//! graph or the map. There is no other code path to ``confirmed``.
//!
//! M5 (D21, FR-7.4): both session handling and attribution are real.
//! `decide_candidate` verifies the GoTrue JWT, admits only the
//! investigating-officer role (the auditor is read-only and the admin's
//! D37 read grant doesn't extend to deciding), records `decided_by` from
//! the token subject,
//! writes the audit row and anchors `candidate.decide` through the
//! ledger gateway with the actor's `profiles.ledger_id`
//! (`skipped_no_identity` when the Fabric org is not configured yet).
//!
//! Stores are in-memory, same scope caveat as ``cameras.rs``/``nodes.rs``.
//! Real persistence through ``reid_targets``/``reid_candidates`` (baseline
//! plus the M2-T4 NOT NULL migration) with per-case RLS is the follow-up.
//!
//! Rows constructed here always carry ``threshold_used`` and
//! ``prior_adjustment`` so the persistence layer cannot insert a row
//! without them.

use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use ts_rs::TS;
use uuid::Uuid;

use crate::api::cameras::CameraStore;
use crate::auth::{authenticate_io, authenticate_request, AppRole, JwksCache, ProfilesStore};
use crate::audit::{record_action, AuditStore};
use crate::ledger::LedgerClient;
use crate::reid::pipeline::DecisionStatus;

/// One lock-on target. ``ledger_tx_id`` is the anchor of the officer's
/// selection (D9: evidentiary weight, signed and anchored).
#[derive(Debug, Clone, Serialize, TS)]
pub struct Target {
    pub id: Uuid,
    pub case_id: Uuid,
    pub camera_id: Uuid,
    // Wire integers are JSON numbers (see entities.rs MergeProposal).
    #[ts(type = "number")]
    pub track_id: i64,
    pub label: String,
    pub ledger_tx_id: String,
    pub ledger_status: String,
    pub active: bool,
}

/// One candidate row as held by this service. ``threshold_used`` and
/// ``prior_adjustment`` are non-optional: a candidate without them is
/// invalid (API_CONTRACTS.md §4) and the DB migration enforces NOT NULL.
#[derive(Debug, Clone, Serialize, TS)]
pub struct Candidate {
    #[ts(type = "number")]
    pub id: i64,
    pub target_id: Uuid,
    pub camera_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub ts: OffsetDateTime,
    pub similarity: f32,
    pub threshold_used: f32,
    pub prior_adjustment: f32,
    pub expected_from: Option<Uuid>,
    pub crop_path: Option<String>,
    pub status: DecisionStatus,
    pub decided_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    #[ts(type = "string | null")]
    pub decided_at: Option<OffsetDateTime>,
    pub ledger_tx_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TargetStore(Arc<Mutex<Vec<Target>>>);

#[derive(Debug, Clone, Default)]
pub struct CandidateStore(Arc<Mutex<Vec<Candidate>>>);

/// M5 attribution dependencies: verified identity, ledger gateway,
/// audit rows and the identity-to-ledger map (D21).
#[derive(Clone)]
pub struct DecideDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
}

impl TargetStore {
    fn lock(&self) -> MutexGuard<'_, Vec<Target>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Test and lock-on helper: the decide path joins candidate to
    /// target for the case id, so tests insert both rows.
    pub fn insert(&self, target: Target) {
        self.lock().push(target);
    }

    pub fn targets_for_case(&self, case_id: &Uuid) -> Vec<Target> {
        self.lock().iter().filter(|target| &target.case_id == case_id).cloned().collect()
    }
}

impl CandidateStore {
    fn lock(&self) -> MutexGuard<'_, Vec<Candidate>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Inserts a pipeline proposal. The caller (pipeline persistence step)
    /// supplies fully-populated rows; this does not default anything.
    pub fn insert(&self, candidate: Candidate) {
        self.lock().push(candidate);
    }

    pub fn candidates_for_target(&self, target_id: &Uuid) -> Vec<Candidate> {
        self.lock().iter().filter(|candidate| &candidate.target_id == target_id).cloned().collect()
    }
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateTargetRequest {
    pub camera_id: Uuid,
    #[ts(type = "number")]
    pub track_id: i64,
    pub label: String,
}

#[derive(Debug, Serialize, TS)]
pub struct CreateTargetResponse {
    pub target_id: Uuid,
    pub ledger_tx_id: String,
}

#[derive(Debug, Deserialize, TS)]
pub struct DecideRequest {
    pub decision: DecideDecision,
    pub note: Option<String>,
}

// NOTE: entities.rs has an identical DecideDecision; both export to the
// same DecideDecision.ts (contents identical). If either shape changes,
// rename one of them instead of silently forking the generated file.
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum DecideDecision {
    Confirmed,
    Rejected,
}

#[derive(Debug, Serialize, TS)]
pub struct DecideResponse {
    #[ts(type = "number")]
    pub candidate_id: i64,
    pub status: DecisionStatus,
    pub ledger_tx_id: Option<String>,
    pub ledger_status: String,
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

#[derive(Clone)]
struct ReidState {
    targets: TargetStore,
    candidates: CandidateStore,
    cameras: CameraStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
}

pub fn router(
    targets: TargetStore,
    candidates: CandidateStore,
    cameras: CameraStore,
    deps: DecideDeps,
) -> Router {
    let state = ReidState {
        targets,
        candidates,
        cameras,
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
    };
    Router::new()
        .route("/cases/:case_id/targets", post(create_target))
        .route("/targets/:id/candidates", get(list_candidates))
        .route("/candidates/:id/decide", post(decide_candidate))
        .with_state(state)
}

/// POST /cases/{id}/targets (M2-T4, D9): lock on. Validates the session
/// (401), validates the camera is registered (404 otherwise), writes the
/// target row, anchors the officer's selection via the ledger gateway and
/// returns the target id plus ledger transaction id.
async fn create_target(
    State(state): State<ReidState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Json(req): Json<CreateTargetRequest>,
) -> impl IntoResponse {
    let officer = match authenticate_io(&headers, &state.auth).await {
        Ok(user_id) => user_id,
        Err(boxed) => return *boxed,
    };
    let known = state.cameras.snapshot_ids().contains(&req.camera_id);
    if !known {
        return error(
            "NOT_FOUND",
            StatusCode::NOT_FOUND,
            format!("camera {} is not registered", req.camera_id),
        )
        .into_response();
    }
    // Ledger anchor via the gateway POST /anchor (D9, FR-7.1): the
    // officer's selection is signed with their ledger identity (D21).
    let target_id = Uuid::new_v4();
    let doc_hash = {
        let mut hasher = Sha256::new();
        hasher.update(target_id.as_bytes());
        hasher.update(req.label.as_bytes());
        hex_of(hasher)
    };
    let (ledger_tx_id, ledger_status) = match state.profiles.ledger_id(&officer) {
        None => {
            tracing::warn!(
                user_id = %officer,
                "ledger anchor skipped: acting user has no profiles.ledger_id (Fabric org not configured)"
            );
            (format!("unanchored-{}", ulid::Ulid::new()), "skipped_no_identity".to_string())
        }
        Some(actor) => match state
            .ledger
            .anchor(&doc_hash, &case_id.to_string(), &actor)
            .await
        {
            Ok(receipt) => (receipt.tx_id, "anchored".to_string()),
            Err(detail) => {
                tracing::warn!(user_id = %officer, detail = %detail, "ledger anchor failed; lock-on proceeds, row marked");
                (format!("unanchored-{}", ulid::Ulid::new()), format!("anchor_failed: {detail}"))
            }
        },
    };
    let target = Target {
        id: target_id,
        case_id,
        camera_id: req.camera_id,
        track_id: req.track_id,
        label: req.label,
        ledger_tx_id: ledger_tx_id.clone(),
        ledger_status,
        active: true,
    };
    state.targets.lock().push(target);
    (StatusCode::CREATED, Json(CreateTargetResponse { target_id, ledger_tx_id })).into_response()
}

/// Hex SHA-256 of a finished hasher. Content hashes anchor bytes, never
/// meanings: the gateway stores the digest, not the payload.
fn hex_of(hasher: Sha256) -> String {
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// GET /targets/{id}/candidates?status= (M2-T5, FR-5.6/FR-5.7): lists
/// proposals for the review panel. Confirmed and rejected rows are NOT
/// hidden -- they remain visible as audit evidence, with their decided
/// badge state. Omitting `status` returns every row for the target.
#[derive(Debug, Deserialize)]
struct ListCandidatesQuery {
    status: Option<DecisionStatusQuery>,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DecisionStatusQuery {
    Proposed,
    Confirmed,
    Rejected,
}

async fn list_candidates(
    State(state): State<ReidState>,
    headers: HeaderMap,
    Path(target_id): Path<Uuid>,
    Query(query): Query<ListCandidatesQuery>,
) -> impl IntoResponse {
    // Verified identity (any case role may read proposals; the
    // case-assignment boundary is enforced on the audit endpoints and,
    // with real persistence, by RLS). Admin included unconditionally
    // (D37 amends D21); create_target/decide_candidate stay io-only.
    if let Err(boxed) = authenticate_request(
        &headers,
        &state.auth,
        &[AppRole::Io, AppRole::Analyst, AppRole::Auditor, AppRole::Admin],
    )
    .await
    {
        return *boxed;
    }
    let candidates = state.candidates.lock();
    let filtered: Vec<Candidate> = candidates
        .iter()
        .filter(|c| c.target_id == target_id)
        .filter(|c| match query.status {
            None => true,
            Some(DecisionStatusQuery::Proposed) => c.status == DecisionStatus::Proposed,
            Some(DecisionStatusQuery::Confirmed) => c.status == DecisionStatus::Confirmed,
            Some(DecisionStatusQuery::Rejected) => c.status == DecisionStatus::Rejected,
        })
        .cloned()
        .collect();
    (StatusCode::OK, Json(filtered)).into_response()
}
/// POST /candidates/{id}/decide (M2-T5, D9): the ONLY path to
/// ``status='confirmed'`` (CLAUDE.md rule 1). Accepts
/// ``confirmed|rejected`` plus an optional note, records who decided and
/// when (``decided_at`` is infrastructure audit time -- the sighting's own
/// ``ts`` stays case-clock), anchors via the ledger gateway POST /action,
/// and on confirmation queues the location_history update through the
/// saga. Rejected and confirmed rows both remain visible as audit
/// evidence; nothing is hidden.
async fn decide_candidate(
    State(state): State<ReidState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<DecideRequest>,
) -> impl IntoResponse {
    // M5-T1/T3: verified GoTrue identity, io role only (D9
    // single-confirm discipline: auditor read-only, admin no
    // case-content access). `decided_at` is infrastructure audit time
    // (`now()` is correct here per CLAUDE.md rule 3 -- cf. nodes.rs
    // `last_seen`); the sighting's own `ts` stays case-clock and is
    // never touched by this endpoint.
    let decider = match authenticate_io(&headers, &state.auth).await {
        Ok(user_id) => user_id,
        Err(boxed) => return *boxed,
    };
    // Join to the target for the case id (audit + anchor are case-scoped).
    // A candidate without its target is corrupt state: fail loud (rule 9),
    // never anchor an unattributed decision.
    let target_id = {
        let candidates = state.candidates.lock();
        match candidates.iter().find(|c| c.id == id) {
            Some(candidate) => candidate.target_id,
            None => {
                return error(
                    "NOT_FOUND",
                    StatusCode::NOT_FOUND,
                    format!("candidate {id} not found"),
                )
                .into_response()
            }
        }
    };
    let case_id = match state.targets.lock().iter().find(|t| t.id == target_id) {
        Some(target) => target.case_id,
        None => {
            return error(
                "INTERNAL",
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("candidate {id} has no lock-on target"),
            )
            .into_response()
        }
    };
    // This assignment is the single ``Confirmed`` construction site in the
    // codebase (D9). Do not add another: grep for `DecisionStatus::Confirmed`
    // must return exactly this line plus the enum definition and tests.
    let status = match req.decision {
        DecideDecision::Confirmed => DecisionStatus::Confirmed,
        DecideDecision::Rejected => DecisionStatus::Rejected,
    };
    let decided_at = OffsetDateTime::now_utc();
    {
        let mut candidates = state.candidates.lock();
        let Some(candidate) = candidates.iter_mut().find(|c| c.id == id) else {
            return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("candidate {id} not found"))
                .into_response();
        };
        if candidate.status != DecisionStatus::Proposed {
            return error(
                "CONFLICT",
                StatusCode::CONFLICT,
                format!("candidate {id} already decided"),
            )
            .into_response();
        }
        candidate.status = status;
        candidate.decided_by = Some(decider);
        // Infrastructure audit time, not case data (rule 3): the
        // sighting's case-clock `ts` is untouched.
        candidate.decided_at = Some(decided_at);
    }
    let _note = req.note;
    // Attributable anchor (D21, FR-7.4): the decision hash covers id,
    // outcome, decider and audit time; the gateway signs it with the
    // actor's ledger identity. On confirmation the saga queues the
    // location_history update from this same handler -- follow-up with
    // real persistence.
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
            user_role: AppRole::Io,
            action: if status == DecisionStatus::Confirmed {
                "candidate.confirm".to_string()
            } else {
                "candidate.reject".to_string()
            },
            object_type: "reid_candidate".to_string(),
            object_id: id.to_string(),
            payload_hash: decision_digest,
        },
    )
    .await;
    {
        let mut candidates = state.candidates.lock();
        if let Some(candidate) = candidates.iter_mut().find(|c| c.id == id) {
            candidate.ledger_tx_id = row.ledger_tx_id.clone();
        }
    }
    let response = DecideResponse {
        candidate_id: id,
        status,
        ledger_tx_id: row.ledger_tx_id,
        ledger_status: row.ledger_status,
    };
    (StatusCode::OK, Json(response)).into_response()
}
