//! Entity listing and detail endpoint tests (API_CONTRACTS.md §2.5).
//!
//! - `type` filter returns only that type; absent filter returns all types.
//! - `search` matches aliases, not just `canonical_name` (case-insensitive).
//! - Cross-case access returns 403 `CASE_ACCESS_DENIED`, never an empty list.
//! - Detail returns identifiers, aliases, associated cases and provenance.
//! - Every list and detail read writes an audit row (`entities.list`,
//!   `entity.read`); the administrator role reads any case unconditionally
//!   (D37 amends D21), with no assignment required.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::entities::{ConsolidateGraph, EntitiesDeps, Entity, EntityStore, MergeStore, NotesStore, SyncState};
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
        let graph = ConsolidateGraph::default();
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
                graph,
            },
        );
        Self { app, entities, audit, assignments, _gateway: gateway }
    }

    fn seed_entity(
        &self,
        case_id: Uuid,
        entity_type: &str,
        name: &str,
        aliases: &[&str],
        identifiers: &[&str],
    ) -> Uuid {
        let id = Uuid::new_v4();
        self.entities.insert(Entity {
            id,
            case_id,
            entity_type: entity_type.to_string(),
            canonical_name: name.to_string(),
            aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
            identifiers: identifiers.iter().map(|identifier| identifier.to_string()).collect(),
            relationships: Vec::new(),
            provenance: "collected".to_string(),
            sync_state: SyncState::Synced,
        });
        id
    }

    fn token(&self, user: &Uuid, role: &str) -> String {
        let _ = self;
        support::mint_token(user, role, 3600)
    }
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
async fn type_filter_returns_only_that_type() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    harness.seed_entity(case_id, "PERSON", "Ravi Kumar", &[], &[]);
    harness.seed_entity(case_id, "ORGANIZATION", "Shree Traders", &[], &[]);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = harness.token(&officer, "io");

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/entities?type=PERSON"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let results = parsed["results"].as_array().expect("results array");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["type"], "PERSON");
    assert_eq!(results[0]["canonical_name"], "Ravi Kumar");
}

#[tokio::test]
async fn absent_type_filter_returns_all_types() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    harness.seed_entity(case_id, "PERSON", "Ravi Kumar", &[], &[]);
    harness.seed_entity(case_id, "VEHICLE", "MH12AB1234", &[], &[]);
    let analyst = Uuid::new_v4();
    harness.assignments.assign(case_id, analyst, AppRole::Analyst);
    let token = harness.token(&analyst, "analyst");

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/entities"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["results"].as_array().expect("results array").len(), 2);
}

#[tokio::test]
async fn search_matches_aliases_not_just_canonical_name() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    harness.seed_entity(case_id, "PERSON", "Ravi Kumar", &["Chhotu"], &[]);
    harness.seed_entity(case_id, "PERSON", "Suresh Yadav", &[], &[]);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = harness.token(&officer, "io");

    // Alias-only match: "chhot" appears in no canonical name.
    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/entities?search=CHHOT"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let results = parsed["results"].as_array().expect("results array");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["canonical_name"], "Ravi Kumar");
}

#[tokio::test]
async fn unknown_type_filter_fails_loud_not_empty() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    harness.seed_entity(case_id, "PERSON", "Ravi Kumar", &[], &[]);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = harness.token(&officer, "io");

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/entities?type=BOGUS"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");
}

#[tokio::test]
async fn cross_case_list_returns_403_not_empty() {
    let harness = Harness::start().await;
    let case_a = Uuid::new_v4();
    harness.seed_entity(case_a, "PERSON", "Ravi Kumar", &[], &[]);
    let officer = Uuid::new_v4();
    // Assigned elsewhere, not to case A.
    harness.assignments.assign(Uuid::new_v4(), officer, AppRole::Io);
    let token = harness.token(&officer, "io");

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_a}/entities"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "CASE_ACCESS_DENIED");
}

#[tokio::test]
async fn cross_case_detail_returns_403() {
    let harness = Harness::start().await;
    let case_a = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_a, "PERSON", "Ravi Kumar", &[], &[]);
    let auditor = Uuid::new_v4();
    harness.assignments.assign(Uuid::new_v4(), auditor, AppRole::Auditor);
    let token = harness.token(&auditor, "auditor");

    let response = harness
        .app
        .oneshot(get_request(format!("/entities/{entity_id}"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "CASE_ACCESS_DENIED");
}

#[tokio::test]
async fn detail_returns_identifiers_aliases_cases_and_provenance() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(
        case_id,
        "PERSON",
        "Ravi Kumar",
        &["Chhotu"],
        &["9822012345"],
    );
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, AppRole::Auditor);
    let token = harness.token(&auditor, "auditor");

    let response = harness
        .app
        .oneshot(get_request(format!("/entities/{entity_id}"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["canonical_name"], "Ravi Kumar");
    assert_eq!(parsed["aliases"], serde_json::json!(["Chhotu"]));
    assert_eq!(parsed["identifiers"], serde_json::json!(["9822012345"]));
    assert_eq!(parsed["associated_cases"], serde_json::json!([case_id.to_string()]));
    assert_eq!(parsed["case_count"], 1);
    assert_eq!(parsed["provenance"], "collected");
    assert_eq!(parsed["sync_state"], "synced");
}

#[tokio::test]
async fn list_paginates_with_cursor() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    for name in ["Asha", "Bina", "Chetan"] {
        harness.seed_entity(case_id, "PERSON", name, &[], &[]);
    }
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = harness.token(&officer, "io");

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/cases/{case_id}/entities?limit=2"), &token))
        .await
        .expect("router responds");
    let (status, first) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["results"].as_array().expect("results array").len(), 2);
    let cursor = first["next_cursor"].as_str().expect("cursor present").to_string();

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/cases/{case_id}/entities?limit=2&cursor={cursor}"), &token))
        .await
        .expect("router responds");
    let (status, second) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second["results"].as_array().expect("results array").len(), 1);
    assert!(second["next_cursor"].is_null());
}

#[tokio::test]
async fn admin_role_reads_case_content_without_assignment() {
    // D37 amends D21: the administrator's read grant is unconditional,
    // not assignment-based — deliberately no `harness.assignments.assign`
    // call for this admin, to prove the bypass rather than a coincidence
    // of also being assigned.
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    harness.seed_entity(case_id, "PERSON", "Ravi Kumar", &[], &[]);
    let admin = Uuid::new_v4();
    let token = harness.token(&admin, "admin");

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/entities"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let results = parsed["results"].as_array().expect("results array");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["canonical_name"], "Ravi Kumar");
}

#[tokio::test]
async fn every_list_and_detail_read_writes_an_audit_row() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let entity_id = harness.seed_entity(case_id, "PERSON", "Ravi Kumar", &[], &[]);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = harness.token(&officer, "io");

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/cases/{case_id}/entities"), &token))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::OK);
    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/entities/{entity_id}"), &token))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::OK);
    let rows = harness.audit.rows_for_case(&case_id);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].action, "entities.list");
    assert_eq!(rows[1].action, "entity.read");
}
