//! Engine node registration (M1-T3, D14). `last_seen` is infrastructure
//! metadata, not case data, so `now()` is the correct clock here
//! (CLAUDE.md rule 3 carves out infrastructure logging explicitly).
//!
//! `POST /nodes` is admin-only with a platform-scoped audit row, mirroring
//! the `POST /cameras` fix (e951ad6): node registration shapes camera
//! assignment and the health board, so an unauthenticated LAN caller must
//! not reach it (D21 admin duties). `GET /nodes` stays unauthenticated —
//! the health board is operator-visible state, like the D32 camera list.
//!
//! In-memory store, same scope caveat as `cameras.rs`: real persistence
//! through the `engine_nodes` table (M0-T3 baseline) needs the server to
//! carry an authenticated user's JWT per request, which is not wired yet.

use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use ts_rs::TS;
use uuid::Uuid;

use crate::audit::{record_action, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::ledger::LedgerClient;

#[derive(Debug, Clone, Serialize, TS)]
pub struct Node {
    pub id: Uuid,
    pub name: String,
    pub status: String,
    pub budget_dps: f64,
    pub gpu_name: String,
    pub cameras: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub last_seen: OffsetDateTime,
}

#[derive(Debug, Deserialize, TS)]
pub struct RegisterNodeRequest {
    pub name: String,
    #[allow(dead_code)] // not yet used for routing; carried for the future assignment path
    pub address: String,
    pub budget_dps: f64,
    #[allow(dead_code)] // recorded for the health board; not consumed server-side yet
    // Wire integers are JSON numbers (see entities.rs MergeProposal).
    #[ts(type = "number")]
    pub vram_ceiling: i64,
    #[allow(dead_code)]
    #[ts(type = "number")]
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

/// M5 attribution dependencies shared with `cameras.rs` (D21): every
/// node registration is an attributable admin action with an audit row.
#[derive(Clone)]
pub struct NodeDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
}

pub fn router(store: NodeStore, deps: NodeDeps) -> Router {
    let state = NodeState {
        store,
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
    };
    Router::new().route("/nodes", get(list_nodes).post(register_node)).with_state(state)
}

#[derive(Clone)]
struct NodeState {
    store: NodeStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
}

// Temporary diagnostic removed.

/// Platform scope has no case: audit rows for node registration carry the
/// nil UUID, like the §2.11 admin routes (API_CONTRACTS.md).
fn platform_case() -> Uuid {
    Uuid::nil()
}

async fn anchor_registration(state: &NodeState, context: &AuthContext, node_id: &Uuid) {
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
            action: "node.register".to_string(),
            object_type: "node".to_string(),
            object_id: node_id.to_string(),
            payload_hash: node_id.to_string(),
        },
    )
    .await;
}

/// POST /nodes (API_CONTRACTS.md §2.8): administrator only. The auth gate
/// runs before any body processing: missing credentials answer 401, a
/// verified non-admin identity answers 403. Success writes one
/// `node.register` audit row (API_CONTRACTS.md rule 6).
async fn register_node(
    State(state): State<NodeState>,
    headers: HeaderMap,
    Json(req): Json<RegisterNodeRequest>,
) -> impl IntoResponse {
    let context = match authenticate_request(&headers, &state.auth, &[AppRole::Admin]).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let now = OffsetDateTime::now_utc();
    let (node, created) = {
        let mut nodes = state.store.lock();
        if let Some(existing) = nodes.iter_mut().find(|n| n.name == req.name) {
            existing.status = req.status;
            existing.budget_dps = req.budget_dps;
            existing.gpu_name = req.gpu_name;
            existing.last_seen = now;
            (existing.clone(), false)
        } else {
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
            (node, true)
        }
    };
    anchor_registration(&state, &context, &node.id).await;
    let status = if created { StatusCode::CREATED } else { StatusCode::OK };
    (status, Json(node)).into_response()
}

async fn list_nodes(State(state): State<NodeState>) -> Json<Vec<Node>> {
    Json(state.store.lock().clone())
}
