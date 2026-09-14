//! Engine node registration (M1-T3, D14). `last_seen` is infrastructure
//! metadata, not case data, so `now()` is the correct clock here
//! (CLAUDE.md rule 3 carves out infrastructure logging explicitly).
//!
//! In-memory store, same scope caveat as `cameras.rs`: real persistence
//! through the `engine_nodes` table (M0-T3 baseline) needs the server to
//! carry an authenticated user's JWT per request, which is not wired yet.

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
pub struct Node {
    pub id: Uuid,
    pub name: String,
    pub status: String,
    pub budget_dps: f64,
    pub gpu_name: String,
    pub cameras: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
pub struct RegisterNodeRequest {
    pub name: String,
    #[allow(dead_code)] // not yet used for routing; carried for the future assignment path
    pub address: String,
    pub budget_dps: f64,
    #[allow(dead_code)] // recorded for the health board; not consumed server-side yet
    pub vram_ceiling: i64,
    #[allow(dead_code)]
    pub max_batch: i64,
    pub gpu_name: String,
    pub status: String,
}

#[derive(Clone, Default)]
pub struct NodeStore(Arc<Mutex<Vec<Node>>>);

impl NodeStore {
    fn lock(&self) -> MutexGuard<'_, Vec<Node>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub fn router(store: NodeStore) -> Router {
    Router::new().route("/nodes", get(list_nodes).post(register_node)).with_state(store)
}

async fn register_node(
    State(store): State<NodeStore>,
    Json(req): Json<RegisterNodeRequest>,
) -> impl IntoResponse {
    let mut nodes = store.lock();
    let now = OffsetDateTime::now_utc();

    if let Some(existing) = nodes.iter_mut().find(|n| n.name == req.name) {
        existing.status = req.status;
        existing.budget_dps = req.budget_dps;
        existing.gpu_name = req.gpu_name;
        existing.last_seen = now;
        return (StatusCode::OK, Json(existing.clone())).into_response();
    }

    let node = Node {
        id: Uuid::new_v4(),
        name: req.name,
        status: req.status,
        budget_dps: req.budget_dps,
        gpu_name: req.gpu_name,
        cameras: Vec::new(),
        last_seen: now,
    };
    nodes.push(node.clone());
    (StatusCode::CREATED, Json(node)).into_response()
}

async fn list_nodes(State(store): State<NodeStore>) -> Json<Vec<Node>> {
    Json(store.lock().clone())
}
