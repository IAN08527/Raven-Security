//! HTTP and WebSocket surface. REST for commands, WS for events.

use std::sync::Arc;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};

use crate::startup::{check_all, HealthConfig, HealthReport};
use crate::audit::{AssignmentStore, AuditStore};
use crate::auth::{JwksCache, ProfilesStore, UsersStore};
use crate::ledger::LedgerClient;
use crate::graph::InMemoryGraphStore;

pub mod admin;
pub mod audit;
pub mod cameras;
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
    pub nodes: nodes::NodeStore,
    pub targets: reid::TargetStore,
    pub candidates: reid::CandidateStore,
    pub reviews: review::ReviewStore,
    pub entities: entities::EntityStore,
    pub merges: entities::MergeStore,
    pub notes: entities::NotesStore,
    pub merge_graph: entities::ConsolidateGraph,
    pub files: files::FileStore,
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
    let v1 = Router::new()
        .merge(health)
        .merge(cameras::router(stores.cameras.clone()))
        .merge(nodes::router(stores.nodes))
        .merge(reid::router(stores.targets, stores.candidates, stores.cameras, reid_deps))
        .merge(review::router(stores.reviews, review_deps))
        .merge(entities::router(stores.entities, stores.merges, entities_deps))
        .merge(files::router(stores.files, files_deps))
        .merge(timeline::router(timeline_deps))
        .merge(admin::router(admin_deps))
        .merge(search::router(search_deps))
        .merge(map::router(map_deps))
        .merge(audit::router(stores.audit, stores.assignments, stores.auth, stores.ledger))
        .merge(crate::graph::router(stores.graph));
    Router::new().nest("/v1", v1)
}

async fn health_handler(State(config): State<Arc<HealthConfig>>) -> Json<HealthReport> {
    Json(check_all(&config).await)
}
