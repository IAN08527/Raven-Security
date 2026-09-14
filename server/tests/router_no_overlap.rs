//! Router merge regression test (Session 12 audit finding).
//!
//! `GET /entities/:id` briefly lived in both `graph::router` and
//! `api::entities::router`. Merged under `/v1` (as `api::router` does),
//! axum rejects the same-path+method overlap, so the full server would
//! have panicked on boot while every per-module test stayed green. This
//! test replicates the `api::router` merge order over the two routers:
//! merely building it covers the collision, and the two requests prove
//! both entity routes are served by the entities module.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::entities::{ConsolidateGraph, EntitiesDeps, Entity, EntityStore, MergeStore, NotesStore, SyncState};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore};
use server::graph::InMemoryGraphStore;
use tower::ServiceExt;
use uuid::Uuid;

fn get_request(uri: String, token: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds")
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

#[tokio::test]
async fn entities_and_graph_routers_merge_without_overlap() {
    let entities = EntityStore::default();
    let audit = AuditStore::default();
    let assignments = AssignmentStore::default();
    let profiles = ProfilesStore::default();
    let auth = support::test_auth_cache();
    let gateway = support::StubGateway::start().await;
    // Same merge order as `api::router` in `api/mod.rs`.
    let app = axum::Router::new().nest(
        "/v1",
        server::api::entities::router(
            entities.clone(),
            MergeStore::default(),
            EntitiesDeps {
                auth,
                ledger: gateway.client(),
                audit: audit.clone(),
                profiles,
                assignments: assignments.clone(),
                notes: NotesStore::default(),
                graph: ConsolidateGraph::default(),
            },
        )
        .merge(server::graph::router(InMemoryGraphStore::default())),
    );

    let case_id = Uuid::new_v4();
    let entity_id = Uuid::new_v4();
    entities.insert(Entity {
        id: entity_id,
        case_id,
        entity_type: "PERSON".to_string(),
        canonical_name: "Ravi Kumar".to_string(),
        aliases: Vec::new(),
        identifiers: Vec::new(),
        relationships: Vec::new(),
        provenance: "collected".to_string(),
        sync_state: SyncState::Synced,
    });
    let officer = Uuid::new_v4();
    assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = app
        .clone()
        .oneshot(get_request(format!("/v1/entities/{entity_id}"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["canonical_name"], "Ravi Kumar");

    let response = app
        .oneshot(get_request(format!("/v1/cases/{case_id}/entities"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["results"].as_array().expect("results array").len(), 1);
}
