//! Camera registration (M1-T1, D16). `declared_start_ts` has no default and
//! must be supplied explicitly: a wrong value silently corrupts every
//! cross-camera inference downstream, so this rejects its absence rather
//! than defaulting it.
//!
//! In-memory store, scoped to M1-T1 (validation behaviour and case-clock
//! display). Real persistence through the `cameras` table (M0-T3 baseline)
//! and its RLS `readable` policy (D21) is a follow-up: it needs the server
//! to carry an authenticated user's JWT per request to set `auth.uid()`,
//! which is not wired yet. Noted here rather than built as a side effect of
//! this task.

use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::audit::{record_action, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::ledger::LedgerClient;
use crate::reid::topology::CameraEdge;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
pub struct Camera {
    pub id: Uuid,
    pub code: String,
    pub label: String,
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub declared_start_ts: OffsetDateTime,
    pub fps: f64,
}

#[derive(Debug, Deserialize, TS)]
pub struct RegisterCameraRequest {
    pub code: String,
    pub label: String,
    #[serde(default, with = "time::serde::rfc3339::option")]
    #[ts(type = "string | null")]
    pub declared_start_ts: Option<OffsetDateTime>,
    pub fps: f64,
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

fn validation_failed(message: impl Into<String>) -> impl IntoResponse {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(ErrorEnvelope {
            error: ErrorBody {
                code: "VALIDATION_FAILED",
                message: message.into(),
                detail: serde_json::json!({}),
                retryable: false,
                trace_id: ulid::Ulid::new().to_string(),
            },
        }),
    )
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

#[derive(Clone, Default)]
pub struct CameraStore(Arc<Mutex<Vec<Camera>>>);

impl CameraStore {
    fn lock(&self) -> MutexGuard<'_, Vec<Camera>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Ids of all registered cameras, for cross-module validation (M2-T4:
    /// lock-on and the candidate pipeline reject unregistered cameras).
    pub fn snapshot_ids(&self) -> Vec<Uuid> {
        self.lock().iter().map(|camera| camera.id).collect()
    }

    /// Test and movement-timeline helper: the timeline resolves a
    /// camera-sourced point's `declared_start_ts` through this lookup.
    pub fn insert(&self, camera: Camera) {
        self.lock().push(camera);
    }

    pub fn get(&self, id: &Uuid) -> Option<Camera> {
        self.lock().iter().find(|camera| &camera.id == id).cloned()
    }
}

/// Topology edges (`LEADS_TO` travel statistics, D15) as held by this
/// service. The D15 prior reads these; `POST /camera-edges` is the only
/// path that writes them (D10: the server is the sole graph writer).
#[derive(Debug, Clone, Default)]
pub struct CameraEdgeStore(Arc<Mutex<Vec<CameraEdge>>>);

impl CameraEdgeStore {
    fn lock(&self) -> MutexGuard<'_, Vec<CameraEdge>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn all(&self) -> Vec<CameraEdge> {
        self.lock().clone()
    }

    /// Insert or replace the edge for one ordered camera pair: travel
    /// statistics are re-measured, not accumulated, so a second POST for
    /// the same pair supersedes the first rather than duplicating it
    /// (duplicates would leave dead rows behind `compute_prior`'s
    /// find-first lookup).
    /// Returns true when an existing edge was replaced.
    pub fn upsert(&self, edge: CameraEdge) -> bool {
        let mut guard = self.lock();
        match guard.iter_mut().find(|e| e.from_camera == edge.from_camera && e.to_camera == edge.to_camera) {
            Some(existing) => {
                *existing = edge;
                true
            }
            None => {
                guard.push(edge);
                false
            }
        }
    }
}

/// M5 attribution dependencies shared with `admin.rs` (D21): every
/// camera mutation is an attributable admin action with an audit row.
#[derive(Clone)]
pub struct CameraDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
}

pub fn router(store: CameraStore, edges: CameraEdgeStore, deps: CameraDeps) -> Router {
    let state = CameraState {
        store,
        edges,
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
    };
    Router::new()
        .route("/cameras", get(list_cameras).post(register_camera))
        .route("/camera-edges", post(create_edge))
        .with_state(state)
}

#[derive(Clone)]
struct CameraState {
    store: CameraStore,
    edges: CameraEdgeStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
}

/// Platform scope has no case: audit rows for camera administration
/// carry the nil UUID, like the §2.11 admin routes (API_CONTRACTS.md).
fn platform_case() -> Uuid {
    Uuid::nil()
}

async fn anchor_camera(
    state: &CameraState,
    context: &AuthContext,
    action: &str,
    object_type: &str,
    object_id: &str,
) {
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id: platform_case(),
            user_id: context.user_id,
            user_role: context.role,
            action: action.to_string(),
            object_type: object_type.to_string(),
            object_id: object_id.to_string(),
            payload_hash: object_id.to_string(),
        },
    )
    .await;
}

/// POST /cameras (API_CONTRACTS.md §2.6): administrator only. Camera
/// registration shapes every downstream inference, so an
/// unauthenticated LAN caller must not reach it (D21 admin duties).
/// The D16 declared-start validation runs after the gate: auth
/// failures answer 401/403, bad bodies 422. Success writes one
/// `camera.register` audit row (API_CONTRACTS.md rule 6).
async fn register_camera(
    State(state): State<CameraState>,
    headers: HeaderMap,
    Json(req): Json<RegisterCameraRequest>,
) -> impl IntoResponse {
    let context = match authenticate_request(&headers, &state.auth, &[AppRole::Admin]).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let Some(declared_start_ts) = req.declared_start_ts else {
        return validation_failed(
            "declared_start_ts is required (D16): it has no default because a wrong value \
             silently corrupts every cross-camera inference. Supply the source's actual \
             declared start time explicitly.",
        )
        .into_response();
    };

    let camera =
        Camera { id: Uuid::new_v4(), code: req.code, label: req.label, declared_start_ts, fps: req.fps };
    state.store.lock().push(camera.clone());
    anchor_camera(&state, &context, "camera.register", "camera", &camera.id.to_string()).await;
    (StatusCode::CREATED, Json(camera)).into_response()
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateEdgeRequest {
    pub from: Uuid,
    pub to: Uuid,
    pub mean_travel_s: f64,
    pub stddev_s: f64,
}

/// POST /camera-edges (API_CONTRACTS.md §2.6): administrator only, same
/// gate as registration — topology edges modulate every cross-camera
/// threshold (D15), so they are as privileged as the cameras they
/// connect. Both endpoints must already be registered: an edge to a
/// camera that does not exist is a dangling prior input, rejected as
/// NOT_FOUND rather than stored. Success writes one `camera.edge`
/// audit row (API_CONTRACTS.md rule 6).
async fn create_edge(
    State(state): State<CameraState>,
    headers: HeaderMap,
    Json(req): Json<CreateEdgeRequest>,
) -> impl IntoResponse {
    let context = match authenticate_request(&headers, &state.auth, &[AppRole::Admin]).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    if req.from == req.to {
        return validation_failed("from and to must differ: a self-loop edge carries no travel statistics")
            .into_response();
    }
    if !req.mean_travel_s.is_finite() || req.mean_travel_s <= 0.0 {
        return validation_failed("mean_travel_s must be a positive number of seconds").into_response();
    }
    if !req.stddev_s.is_finite() || req.stddev_s < 0.0 {
        return validation_failed("stddev_s must be a non-negative number of seconds").into_response();
    }
    let known = state.store.snapshot_ids();
    if !known.contains(&req.from) {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("camera {} not registered", req.from))
            .into_response();
    }
    if !known.contains(&req.to) {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("camera {} not registered", req.to))
            .into_response();
    }
    let edge =
        CameraEdge { from_camera: req.from, to_camera: req.to, mean_travel_s: req.mean_travel_s, stddev_s: req.stddev_s };
    let replaced = state.edges.upsert(edge.clone());
    let object_id = format!("{}->{}", req.from, req.to);
    anchor_camera(&state, &context, "camera.edge", "camera_edge", &object_id).await;
    let status = if replaced { StatusCode::OK } else { StatusCode::CREATED };
    (status, Json(edge)).into_response()
}

/// GET /cameras: no authentication (D32). Any caller with premises-LAN
/// access already knows where the cameras are; requiring auth would add
/// friction for investigators checking feeds with no real security
/// benefit. Revisit if the system is ever exposed beyond the LAN.
async fn list_cameras(State(state): State<CameraState>) -> Json<Vec<Camera>> {
    Json(state.store.lock().clone())
}
