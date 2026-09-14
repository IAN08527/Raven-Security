//! Entity annotation endpoint tests (API_CONTRACTS.md §2.5, FR-7.4).
//!
//! - An io annotates entities in assigned cases; the note is attributed,
//!   audit-logged (`entity.annotate`) and embedded in detail reads.
//! - The auditor (read-only) and unassigned callers are denied; unknown
//!   entities are 404; empty and oversize text is 422.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use server::api::entities::{
    ConsolidateGraph, EntitiesDeps, Entity, EntityStore, MergeStore, NotesStore, SyncState,
};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore};
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    entities: EntityStore,
    audit: AuditStore,
    assignments: AssignmentStore,
    _gateway: support::StubGateway,
}

impl Harness {
    async fn start() -> Self {
        let entities = EntityStore::default();
        let merges = MergeStore::default();
        let audit = AuditStore::default();
        let assignments = AssignmentStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = server::api::entities::router(
            entities.clone(),
            merges,
            EntitiesDeps {
                auth,
                ledger: gateway.client(),
                audit: audit.clone(),
                profiles,
                assignments: assignments.clone(),
                notes: NotesStore::default(),
                graph: ConsolidateGraph::default(),
            },
        );
        Self { app, entities, audit, assignments, _gateway: gateway }
    }

    fn seed_entity(&self, case_id: Uuid) -> Uuid {
        let id = Uuid::new_v4();
        self.entities.insert(Entity {
            id,
            case_id,
            entity_type: "PERSON".to_string(),
            canonical_name: "Ravi Kumar".to_string(),
            aliases: Vec::new(),
            identifiers: Vec::new(),
            relationships: Vec::new(),
            provenance: "collected".to_string(),
            sync_state: SyncState::Synced,
        });
        id
    }
}

fn post_note(uri: String, token: &str, text: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(json!({ "text": text }).to_string()))
        .expect("request builds")
}

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
async fn io_annotates_and_detail_embeds_the_note() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(post_note(format!("/entities/{entity_id}/notes"), &token, "Known associate of Suresh."))
        .await
        .expect("router responds");
    let (status, created) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["entity_id"], entity_id.to_string());
    assert_eq!(created["text"], "Known associate of Suresh.");
    assert_eq!(created["created_by"], officer.to_string());

    let response = harness
        .app
        .oneshot(get_request(format!("/entities/{entity_id}"), &token))
        .await
        .expect("router responds");
    let (status, detail) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let notes = detail["notes"].as_array().expect("notes array");
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0]["text"], "Known associate of Suresh.");

    let rows = harness.audit.rows_for_case(&case_id);
    assert!(rows.iter().any(|row| row.action == "entity.annotate" && row.user_id == officer));
}

#[tokio::test]
async fn auditor_cannot_annotate() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id);
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, AppRole::Auditor);
    let token = support::mint_token(&auditor, "auditor", 3600);

    let response = harness
        .app
        .oneshot(post_note(format!("/entities/{entity_id}/notes"), &token, "Audit remark."))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");
}

#[tokio::test]
async fn cross_case_annotate_returns_403_and_unknown_entity_404() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id);
    let officer = Uuid::new_v4();
    harness.assignments.assign(Uuid::new_v4(), officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(post_note(format!("/entities/{entity_id}/notes"), &token, "Wrong case."))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "CASE_ACCESS_DENIED");

    let response = harness
        .app
        .oneshot(post_note(format!("/entities/{}/notes", Uuid::new_v4()), &token, "Nowhere."))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(parsed["error"]["code"], "NOT_FOUND");
}

#[tokio::test]
async fn empty_and_oversize_notes_are_rejected() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(post_note(format!("/entities/{entity_id}/notes"), &token, "   "))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");

    let response = harness
        .app
        .oneshot(post_note(format!("/entities/{entity_id}/notes"), &token, &"x".repeat(2001)))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");
}
