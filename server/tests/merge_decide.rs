//! M4 + M5-T3. Merge decision endpoint tests (FR-3.3, D4, D9, D21).
//!
//! - Only `POST /merges/{id}/decide` can apply a merge (rule 1); the
//!   propose endpoint always returns `proposed`, never applied directly.
//! - Confirmed merges consolidate aliases, identifiers and relationships
//!   into the survivor and mark the merged row `merged`.
//! - Rejected merges change status only: both entities intact, no graph call.
//! - Neo4j failure does NOT roll back Postgres (D4): the merge stands and
//!   the row is marked `pending`.
//! - Double-decide returns 409; decide requires the io role.

#[path = "support/mod.rs"]
mod support;

use std::sync::Mutex;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::entities::{
    ConsolidateGraph, EntitiesDeps, Entity, EntityStore, MergeProposal, MergeStatus, MergeStore,
    NotesStore, SyncState,
};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::ProfilesStore;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    entities: EntityStore,
    merges: MergeStore,
    graph: ConsolidateGraph,
    audit: AuditStore,
    profiles: ProfilesStore,
    next_id: Mutex<i64>,
    _gateway: support::StubGateway,
}

impl Harness {
    async fn start() -> Self {
        let entities = EntityStore::default();
        let merges = MergeStore::default();
        let graph = ConsolidateGraph::default();
        let audit = AuditStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = server::api::entities::router(
            entities.clone(),
            merges.clone(),
            EntitiesDeps {
                auth,
                ledger: gateway.client(),
                audit: audit.clone(),
                profiles: profiles.clone(),
                assignments: AssignmentStore::default(),
                notes: NotesStore::default(),
                graph: graph.clone(),
            },
        );
        Self {
            app,
            entities,
            merges,
            graph,
            audit,
            profiles,
            next_id: Mutex::new(1),
            _gateway: gateway,
        }
    }

    fn io_token(&self, user: &Uuid) -> String {
        support::mint_token(user, "io", 3600)
    }

    fn seed_entity(&self, case_id: Uuid, name: &str) -> Uuid {
        let id = Uuid::new_v4();
        self.entities.insert(Entity {
            id,
            case_id,
            entity_type: "PERSON".to_string(),
            canonical_name: name.to_string(),
            aliases: vec![format!("{name} alias")],
            identifiers: vec![format!("id-{name}")],
            relationships: Vec::new(),
            provenance: "collected".to_string(),
            sync_state: SyncState::Synced,
        });
        id
    }

    fn seed_merge(&self, case_id: Uuid, surviving_id: Uuid, merged_id: Uuid) -> i64 {
        let mut next = self.next_id.lock().unwrap_or_else(|p| p.into_inner());
        let id = *next;
        *next += 1;
        self.merges.insert(MergeProposal {
            id,
            case_id,
            surviving_id,
            merged_id,
            reason: "shared identifier plus normalised name".to_string(),
            status: MergeStatus::Proposed,
            sync_state: SyncState::Synced,
            decided_by: None,
            ledger_tx_id: None,
            reversible_snapshot: None,
            reverted_at: None,
        });
        id
    }
}

fn decide_request(id: i64, token: &str, decision: &str) -> Request<Body> {
    let body = serde_json::json!({"decision": decision, "note": "checked against source spans"});
    Request::builder()
        .method("POST")
        .uri(format!("/merges/{id}/decide"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .expect("request builds")
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

#[tokio::test]
async fn confirmed_merge_consolidates_identifiers() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let surviving = harness.seed_entity(case_id, "Ravi Kumar");
    let merged = harness.seed_entity(case_id, "R Kumar");
    let merge_id = harness.seed_merge(case_id, surviving, merged);
    let decider = Uuid::new_v4();
    harness.profiles.set_ledger_id(decider, "officer-ledger-1");
    let token = harness.io_token(&decider);

    let response = harness
        .app
        .oneshot(decide_request(merge_id, &token, "confirmed"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["merge_id"], merge_id);
    assert_eq!(parsed["status"], "confirmed");
    assert!(parsed["ledger_tx_id"].as_str().is_some());

    let survivor = harness.entities.get(&surviving).expect("survivor remains");
    assert!(survivor.identifiers.contains(&"id-Ravi Kumar".to_string()));
    assert!(survivor.identifiers.contains(&"id-R Kumar".to_string()));
    assert!(survivor.aliases.contains(&"R Kumar".to_string()));
    let absorbed = harness.entities.get(&merged).expect("merged row remains");
    assert_eq!(absorbed.sync_state, SyncState::Merged);
    assert_eq!(harness.graph.consolidations(), vec![(surviving, merged)]);
    assert_eq!(harness.audit.rows_for_case(&case_id).len(), 1);
}

#[tokio::test]
async fn rejected_merge_leaves_both_entities_intact() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let surviving = harness.seed_entity(case_id, "Ravi Kumar");
    let merged = harness.seed_entity(case_id, "R Kumar");
    let merge_id = harness.seed_merge(case_id, surviving, merged);
    let decider = Uuid::new_v4();
    let token = harness.io_token(&decider);

    let response = harness
        .app
        .oneshot(decide_request(merge_id, &token, "rejected"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], "rejected");

    let survivor = harness.entities.get(&surviving).expect("survivor intact");
    assert_eq!(survivor.identifiers, vec!["id-Ravi Kumar".to_string()]);
    let other = harness.entities.get(&merged).expect("merged-entity intact");
    assert_eq!(other.sync_state, SyncState::Synced);
    assert!(harness.graph.consolidations().is_empty(), "rejected merge must not touch the graph");
}

#[tokio::test]
async fn neo4j_failure_does_not_roll_back_postgres() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let surviving = harness.seed_entity(case_id, "Ravi Kumar");
    let merged = harness.seed_entity(case_id, "R Kumar");
    let merge_id = harness.seed_merge(case_id, surviving, merged);
    harness.graph.set_fail(true);
    let decider = Uuid::new_v4();
    let token = harness.io_token(&decider);

    let response = harness
        .app
        .oneshot(decide_request(merge_id, &token, "confirmed"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], "confirmed");

    // Postgres stands (D4): the survivor keeps the absorbed identifiers and
    // the merged row stays merged; only the sync state records the lag.
    let survivor = harness.entities.get(&surviving).expect("survivor keeps the merge");
    assert!(survivor.identifiers.contains(&"id-R Kumar".to_string()));
    let absorbed = harness.entities.get(&merged).expect("merged row stands");
    assert_eq!(absorbed.sync_state, SyncState::Merged);
}

#[tokio::test]
async fn double_decide_returns_conflict() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let surviving = harness.seed_entity(case_id, "Ravi Kumar");
    let merged = harness.seed_entity(case_id, "R Kumar");
    let merge_id = harness.seed_merge(case_id, surviving, merged);
    let decider = Uuid::new_v4();
    let token = harness.io_token(&decider);

    let first = harness
        .app
        .clone()
        .oneshot(decide_request(merge_id, &token, "confirmed"))
        .await
        .expect("router responds");
    assert_eq!(first.status(), StatusCode::OK);
    let second = harness
        .app
        .oneshot(decide_request(merge_id, &token, "rejected"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(second).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(parsed["error"]["code"], "CONFLICT");
}

#[tokio::test]
async fn auditor_token_cannot_decide_merge() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let surviving = harness.seed_entity(case_id, "Ravi Kumar");
    let merged = harness.seed_entity(case_id, "R Kumar");
    let merge_id = harness.seed_merge(case_id, surviving, merged);
    let auditor = Uuid::new_v4();
    let token = support::mint_token(&auditor, "auditor", 3600);

    let response = harness
        .app
        .oneshot(decide_request(merge_id, &token, "confirmed"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");
}
