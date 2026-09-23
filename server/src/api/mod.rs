//! HTTP and WebSocket surface. REST for commands, WS for events.

use std::sync::Arc;

use axum::extract::State;
use axum::http::HeaderValue;
use axum::routing::get;
use axum::{Json, Router};
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

use crate::startup::{check_all, HealthConfig, HealthReport};
use crate::audit::{AssignmentStore, AuditStore};
use crate::auth::{JwksCache, ProfilesStore, UsersStore};
use crate::db::SagaDb;
use crate::ledger::LedgerClient;
use crate::graph::InMemoryGraphStore;
use crate::saga::extraction_client::DocsLaneClient;
use crate::saga::ingest_upload::SagaIngestSpawner;
use crate::storage::BlobStore;

pub mod admin;
pub mod audit;
pub mod cameras;
pub mod cases;
pub mod entities;
pub mod files;
pub mod map;
pub mod nodes;
pub mod reid;
pub mod review;
pub mod search;
pub mod timeline;

/// All client-to-server REST endpoints live under `/v1` (API_CONTRACTS.md
/// §2: "Base https://{server}:8443/v1"). `/health` included: this fixes a
/// gap from when it and `/cameras` were first wired up without the prefix.
/// All stores the router needs. Bundled so the router takes two
/// arguments instead of twelve (`too_many_arguments`); each field is
/// still constructed explicitly at the call site, so nothing is hidden.
pub struct RouterStores {
    pub cameras: cameras::CameraStore,
    pub camera_edges: cameras::CameraEdgeStore,
    pub nodes: nodes::NodeStore,
    pub targets: reid::TargetStore,
    pub candidates: reid::CandidateStore,
    pub reviews: review::ReviewStore,
    pub entities: entities::EntityStore,
    pub merges: entities::MergeStore,
    pub notes: entities::NotesStore,
    pub merge_graph: entities::ConsolidateGraph,
    pub files: files::FileStore,
    pub saga_db: SagaDb,
    pub blobs: Arc<BlobStore>,
    pub docs_lane: DocsLaneClient,
    pub graph: InMemoryGraphStore,
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub assignments: AssignmentStore,
    pub profiles: ProfilesStore,
    pub users: UsersStore,
    pub cases: search::CaseStore,
    pub locations: map::LocationStore,
}

pub fn router(health_config: Arc<HealthConfig>, stores: RouterStores) -> Router {
    let health = Router::new().route("/health", get(health_handler)).with_state(health_config);
    let reid_deps = reid::DecideDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
    };
    let review_deps = review::ReviewDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
    };
    let entities_deps = entities::EntitiesDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
        assignments: stores.assignments.clone(),
        notes: stores.notes.clone(),
        graph: stores.merge_graph,
    };
    let files_deps = files::FilesDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        assignments: stores.assignments.clone(),
        profiles: stores.profiles.clone(),
    };
    // D33-D34: upload/retry persistence (saga role) plus the spawner
    // that detaches run_ingest with the gateway client and docs-lane
    // client behind the saga adapters.
    let ingest_deps = files::IngestDeps {
        repo: Arc::new(stores.saga_db.clone()),
        spawner: Arc::new(SagaIngestSpawner::new(
            stores.saga_db.clone(),
            stores.blobs.clone(),
            stores.ledger.clone(),
            stores.docs_lane.clone(),
        )),
        blobs: stores.blobs.clone(),
    };
    let timeline_deps = timeline::TimelineDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
        assignments: stores.assignments.clone(),
        files: stores.files.clone(),
        targets: stores.targets.clone(),
        candidates: stores.candidates.clone(),
        graph: stores.graph.clone(),
    };
    let admin_deps = admin::AdminDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
        users: stores.users.clone(),
    };
    let search_deps = search::SearchDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
        assignments: stores.assignments.clone(),
        entities: stores.entities.clone(),
        cases: stores.cases.clone(),
        files: stores.files.clone(),
    };
    let map_deps = map::MapDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
        assignments: stores.assignments.clone(),
        entities: stores.entities.clone(),
        locations: stores.locations.clone(),
        cameras: stores.cameras.clone(),
    };
    let cameras_deps = cameras::CameraDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
    };
    // D21: case assignment is an administrative act — admin role only,
    // writing the join row without exposing case content.
    let cases_deps = cases::CasesDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
        users: stores.users.clone(),
        cases: stores.cases.clone(),
        assignments: stores.assignments.clone(),
        case_table: Arc::new(stores.saga_db.clone()),
    };
    let graph_deps = crate::graph::GraphDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
        assignments: stores.assignments.clone(),
    };
    let nodes_deps = nodes::NodeDeps {
        auth: stores.auth.clone(),
        ledger: stores.ledger.clone(),
        audit: stores.audit.clone(),
        profiles: stores.profiles.clone(),
    };
    let v1 = Router::new()
        .merge(health)
        .merge(cameras::router(stores.cameras.clone(), stores.camera_edges.clone(), cameras_deps))
        .merge(cases::router(cases_deps))
        .merge(nodes::router(stores.nodes, nodes_deps))
        .merge(reid::router(stores.targets, stores.candidates, stores.cameras, reid_deps))
        .merge(review::router(stores.reviews, review_deps))
        .merge(entities::router(stores.entities, stores.merges, entities_deps))
        .merge(files::router_with_ingest(stores.files, files_deps, ingest_deps))
        .merge(timeline::router(timeline_deps))
        .merge(admin::router(admin_deps))
        .merge(search::router(search_deps))
        .merge(map::router(map_deps))
        .merge(audit::router(stores.audit, stores.assignments, stores.auth, stores.ledger))
        .merge(crate::graph::router(stores.graph, graph_deps));
    Router::new().nest("/v1", v1).layer(cors_layer())
}

/// The client (Vite dev server, or Tauri's own webview origin in a built
/// app) is always a different origin from this server (D30, API_CONTRACTS.md
/// "Base https://{server}:8443/v1"), so every browser-issued request needs
/// an explicit CORS allow. Bearer tokens carry auth, not cookies, so an
/// origin allowlist without credentials is sufficient -- nothing here widens
/// what an unauthenticated caller can reach (rule 9's three no-auth routes
/// are unchanged). `RAVEN_CORS_ORIGINS` (comma-separated) overrides the
/// default set for a LAN pilot deployment where client machines are known.
fn cors_layer() -> CorsLayer {
    let origins = std::env::var("RAVEN_CORS_ORIGINS").unwrap_or_else(|_| {
        "http://localhost:1420,http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost".into()
    });
    let allowed: Vec<HeaderValue> =
        origins.split(',').filter_map(|origin| HeaderValue::from_str(origin.trim()).ok()).collect();
    CorsLayer::new().allow_origin(AllowOrigin::list(allowed)).allow_methods(Any).allow_headers(Any)
}

async fn health_handler(State(config): State<Arc<HealthConfig>>) -> Json<HealthReport> {
    Json(check_all(&config).await)
}
