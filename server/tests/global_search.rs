//! Global search endpoint tests (API_CONTRACTS.md §2.12, design §13).
//!
//! - Results come only from assigned cases (RLS at the endpoint).
//! - Identifier search finds entities by phone substring.
//! - Empty query returns empty groups, not an error.
//! - Unknown types are 422; per-group caps hold at 10.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::entities::{Entity, EntityStore, SyncState};
use server::api::files::{FileRecord, FileStore};
use server::api::search::{CaseRecord, CaseStore, SearchDeps, router};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    entities: EntityStore,
    cases: CaseStore,
    files: FileStore,
    assignments: AssignmentStore,
    _gateway: support::StubGateway,
}

fn sha_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

impl Harness {
    async fn start() -> Self {
        let entities = EntityStore::default();
        let cases = CaseStore::default();
        let files = FileStore::default();
        let audit = AuditStore::default();
        let assignments = AssignmentStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = router(SearchDeps {
            auth,
            ledger: gateway.client(),
            audit,
            profiles,
            assignments: assignments.clone(),
            entities: entities.clone(),
            cases: cases.clone(),
            files: files.clone(),
        });
        Self { app, entities, cases, files, assignments, _gateway: gateway }
    }

    fn seed_case(&self, code: &str, title: &str) -> Uuid {
        let id = Uuid::new_v4();
        self.cases.insert(CaseRecord { id, case_code: code.to_string(), title: title.to_string() });
        id
    }

    fn seed_entity(&self, case_id: Uuid, name: &str, aliases: &[&str], identifiers: &[&str]) -> Uuid {
        let id = Uuid::new_v4();
        self.entities.insert(Entity {
            id,
            case_id,
            entity_type: "PERSON".to_string(),
            canonical_name: name.to_string(),
            aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
            identifiers: identifiers.iter().map(|identifier| identifier.to_string()).collect(),
            relationships: Vec::new(),
            provenance: "collected".to_string(),
            sync_state: SyncState::Synced,
        });
        id
    }

    fn seed_file(&self, case_id: Uuid, name: &str) -> Uuid {
        let id = Uuid::new_v4();
        self.files.insert(
            FileRecord {
                id,
                case_id,
                name: name.to_string(),
                mime: "application/pdf".to_string(),
                sha256: sha_hex(name.as_bytes()),
                status: "committed".to_string(),
                provenance: "collected".to_string(),
                source_node: None,
                ledger_tx_id: None,
                ingested_at: OffsetDateTime::now_utc(),
            },
            name.as_bytes().to_vec(),
        );
        id
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
async fn results_come_only_from_assigned_cases() {
    let harness = Harness::start().await;
    let case_a = harness.seed_case("CA-001", "Alpha case");
    let case_b = harness.seed_case("CB-002", "Beta case");
    harness.seed_entity(case_a, "Ravi Kumar", &["Chhotu"], &["9822012345"]);
    harness.seed_entity(case_b, "Beta Person", &[], &[]);
    harness.seed_file(case_a, "seized-letter.pdf");
    harness.seed_file(case_b, "beta-file.pdf");
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_a, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request("/search?q=a".to_string(), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    for group in ["entities", "files", "identifiers"] {
        for hit in parsed[group].as_array().expect("group array") {
            let case = hit["case_id"].as_str().expect("case id");
            assert_eq!(case, &case_a.to_string(), "no cross-case leakage in {group}");
        }
    }
    assert!(!parsed["entities"].as_array().expect("array").is_empty());
    let case_ids: Vec<&str> = parsed["cases"]
        .as_array()
        .expect("array")
        .iter()
        .map(|hit| hit["id"].as_str().expect("case id"))
        .collect();
    assert!(case_ids.contains(&case_a.to_string().as_str()));
    assert!(!case_ids.contains(&case_b.to_string().as_str()));
}

#[tokio::test]
async fn identifier_search_finds_entity_by_phone() {
    let harness = Harness::start().await;
    let case_id = harness.seed_case("CA-001", "Alpha case");
    let entity_id = harness.seed_entity(case_id, "Ravi Kumar", &[], &["9822012345"]);
    let analyst = Uuid::new_v4();
    harness.assignments.assign(case_id, analyst, AppRole::Analyst);
    let token = support::mint_token(&analyst, "analyst", 3600);

    let response = harness
        .app
        .oneshot(get_request("/search?q=9822".to_string(), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let hits = parsed["identifiers"].as_array().expect("identifiers array");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0]["entity_id"], entity_id.to_string());
    assert_eq!(hits[0]["value"], "9822012345");
    assert!(parsed["entities"].as_array().expect("array").is_empty());
}

#[tokio::test]
async fn empty_query_returns_empty_groups_not_an_error() {
    let harness = Harness::start().await;
    let case_id = harness.seed_case("CA-001", "Alpha case");
    harness.seed_entity(case_id, "Ravi Kumar", &[], &[]);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    for uri in ["/search".to_string(), "/search?q=".to_string()] {
        let response = harness
            .app
            .clone()
            .oneshot(get_request(uri, &token))
            .await
            .expect("router responds");
        let (status, parsed) = body_json(response).await;
        assert_eq!(status, StatusCode::OK);
        for group in ["entities", "cases", "files", "identifiers"] {
            assert!(parsed[group].as_array().expect("group array").is_empty());
        }
    }
}

#[tokio::test]
async fn case_narrowing_requires_assignment() {
    let harness = Harness::start().await;
    let case_a = harness.seed_case("CA-001", "Alpha case");
    harness.seed_entity(case_a, "Ravi Kumar", &[], &[]);
    let officer = Uuid::new_v4();
    harness.assignments.assign(Uuid::new_v4(), officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/search?q=ravi&case_id={case_a}"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "CASE_ACCESS_DENIED");
}

#[tokio::test]
async fn unknown_types_are_rejected_and_groups_cap_at_ten() {
    let harness = Harness::start().await;
    let case_id = harness.seed_case("CA-001", "Alpha case");
    for index in 0..12 {
        harness.seed_entity(case_id, &format!("Testperson {index}"), &[], &[]);
    }
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(get_request("/search?q=test&types=bogus".to_string(), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");

    let response = harness
        .app
        .oneshot(get_request("/search?q=testperson".to_string(), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["entities"].as_array().expect("array").len(), 10);
}
