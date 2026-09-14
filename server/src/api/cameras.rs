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
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct Camera {
    pub id: Uuid,
    pub code: String,
    pub label: String,
    #[serde(with = "time::serde::rfc3339")]
    pub declared_start_ts: OffsetDateTime,
    pub fps: f64,
}

#[derive(Debug, Deserialize)]
pub struct RegisterCameraRequest {
    pub code: String,
    pub label: String,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub declared_start_ts: Option<OffsetDateTime>,
    pub fps: f64,
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

pub fn router(store: CameraStore) -> Router {
    Router::new()
        .route("/cameras", get(list_cameras).post(register_camera))
        .with_state(store)
}

async fn register_camera(
    State(store): State<CameraStore>,
    Json(req): Json<RegisterCameraRequest>,
) -> impl IntoResponse {
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
    store.lock().push(camera.clone());
    (StatusCode::CREATED, Json(camera)).into_response()
}

async fn list_cameras(State(store): State<CameraStore>) -> Json<Vec<Camera>> {
    Json(store.lock().clone())
}
