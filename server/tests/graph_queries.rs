//! M4-T3. Graph query and endpoint tests (D23, FR-4.1--FR-4.4):
//! person-only default, hops rejection, evidence tamper states.

use std::collections::{HashMap, HashSet};

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::graph::{
    EntityDetail, EntityType, GraphSnapshot, GraphStore, InMemoryGraphStore, StoredEdge,
    StoredEvidence, StoredIdentifier, StoredNode, VerificationState, ego_graph, macro_graph,
};
use tower::ServiceExt;
use uuid::Uuid;

fn seed_store() -> (InMemoryGraphStore, Uuid, Uuid, Uuid, Uuid) {
    let store = InMemoryGraphStore::default();
    let case_id = Uuid::new_v4();
    let center = Uuid::new_v4();
    let friend = Uuid::new_v4();
    let org = Uuid::new_v4();
    let edge_id = Uuid::new_v4();
    let file_id = Uuid::new_v4();
    let mut nodes = HashMap::new();
    nodes.insert(center, StoredNode { typ: EntityType::Person, label: "Ravi Kumar".to_string() });
    nodes.insert(friend, StoredNode { typ: EntityType::Person, label: "Suresh Yadav".to_string() });
    nodes.insert(org, StoredNode { typ: EntityType::Organization, label: "Sharma Traders".to_string() });
    let snapshot = GraphSnapshot::new(
        nodes,
        vec![
            StoredEdge {
                id: edge_id,
                src: center,
                dst: friend,
                typ: "CALLED".to_string(),
                weight: 8.0,
            },
            StoredEdge {
                id: Uuid::new_v4(),
                src: center,
                dst: org,
                typ: "SEEN_WITH".to_string(),
                weight: 3.0,
            },
        ],
    );
    store.seed_case(case_id, snapshot);
    store.seed_detail(
        center,
        EntityDetail {
            node: server::graph::GraphNode { id: center, typ: EntityType::Person, label: "Ravi Kumar".to_string() },
            identifiers: vec![StoredIdentifier { typ: "PHONE".to_string(), value: "9822012345".to_string() }],
            aliases: vec!["Ravi".to_string()],
        },
    );
    store.seed_evidence(
        edge_id,
        vec![StoredEvidence {
            id: 1,
            edge_id,
            kind: "fir_text".to_string(),
            snippet: Some("Ravi called Suresh".to_string()),
            char_start: Some(0),
            char_end: Some(18),
            page_no: Some(1),
            source_file_id: file_id,
            provenance: "benchmark".to_string(),
            occurred_at: None,
            ledger_hash: Some("ledger-abc123".to_string()),
            computed_hash: Some("computed-def456".to_string()),
        }],
    );
    store.seed_verification(file_id, VerificationState::Tampered);
    (store, case_id, center, edge_id, file_id)
}

fn person_only() -> HashSet<EntityType> {
    EntityType::default_set()
}

#[test]
fn ego_hops_3_is_rejected_not_clamped() {
    let (store, case_id, center, _, _) = seed_store();
    let snapshot = store.snapshot(case_id).expect("seeded");
    let err = ego_graph(&snapshot, center, 3, 0.0, &person_only()).expect_err("hops=3 must fail");
    assert_eq!(err.to_string(), "hops must be 1 or 2, got 3");
}

#[test]
fn ego_person_only_returns_no_organisation_nodes() {
    let (store, case_id, center, _, _) = seed_store();
    let snapshot = store.snapshot(case_id).expect("seeded");
    let payload = ego_graph(&snapshot, center, 2, 0.0, &person_only()).expect("query works");
    assert!(payload.nodes.iter().all(|node| node.typ == EntityType::Person));
    assert_eq!(payload.nodes.len(), 2, "center plus the person neighbour");
}

#[test]
fn ego_with_organisation_returns_both_types() {
    let (store, case_id, center, _, _) = seed_store();
    let snapshot = store.snapshot(case_id).expect("seeded");
    let types = HashSet::from([EntityType::Person, EntityType::Organization]);
    let payload = ego_graph(&snapshot, center, 1, 0.0, &types).expect("query works");
    assert_eq!(payload.nodes.len(), 3);
    assert_eq!(payload.edges.len(), 2);
}

#[test]
fn macro_person_only_drops_organisation_edges() {
    let (store, case_id, _, _, _) = seed_store();
    let snapshot = store.snapshot(case_id).expect("seeded");
    let payload = macro_graph(&snapshot, 0.0, &person_only());
    assert!(payload.nodes.iter().all(|node| node.typ == EntityType::Person));
    assert_eq!(payload.edges.len(), 1);
    assert_eq!(payload.edges[0].typ, "CALLED");
}

#[test]
fn weight_floor_filters_edges() {
    let (store, case_id, center, _, _) = seed_store();
    let snapshot = store.snapshot(case_id).expect("seeded");
    let types = HashSet::from([EntityType::Person, EntityType::Organization]);
    let payload = ego_graph(&snapshot, center, 1, 5.0, &types).expect("query works");
    assert_eq!(payload.edges.len(), 1);
    assert_eq!(payload.edges[0].typ, "CALLED");
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

fn authed_get(uri: String) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .header("authorization", "Bearer test-session")
        .body(Body::empty())
        .expect("request builds")
}

#[tokio::test]
async fn ego_endpoint_hops_3_returns_422() {
    let (store, case_id, center, _, _) = seed_store();
    let app = server::graph::router(store);
    let uri = format!("/cases/{case_id}/graph/ego?entity_id={center}&hops=3");
    let response = app.oneshot(authed_get(uri)).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");
}

#[tokio::test]
async fn evidence_endpoint_returns_tamper_state_per_row() {
    let (store, _, _, edge_id, _) = seed_store();
    let app = server::graph::router(store);
    let uri = format!("/edges/{edge_id}/evidence");
    let response = app.oneshot(authed_get(uri)).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let rows = parsed.as_array().expect("array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["tamper_state"], "tampered");
    assert_eq!(rows[0]["provenance"], "benchmark");
    assert_eq!(rows[0]["char_start"], 0);
    // FR-7.2: tampered rows show both hashes, never color alone.
    assert_eq!(rows[0]["ledger_hash"], "ledger-abc123");
    assert_eq!(rows[0]["computed_hash"], "computed-def456");
}
