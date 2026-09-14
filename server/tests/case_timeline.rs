//! Case timeline endpoint tests (API_CONTRACTS.md §2.10).
//!
//! - Merges all four dateable kinds with `clock` labelled case/system.
//! - Newest first by default; `order=asc` reverses.
//! - Filters: type, entity, date range. Undateable rows are excluded.
//! - Cross-case access is 403, never an empty stream.

#[path = "support/mod.rs"]
mod support;

use std::collections::HashMap;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::files::{FileRecord, FileStore};
use server::api::reid::{Candidate, CandidateStore, Target, TargetStore};
use server::api::timeline::{TimelineDeps, router};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore};
use server::graph::{
    GraphSnapshot, InMemoryGraphStore, StoredEdge, StoredEvidence, StoredNode,
};
use server::graph::EntityType;
use server::reid::pipeline::DecisionStatus;
use time::{Duration, OffsetDateTime};
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    files: FileStore,
    targets: TargetStore,
    candidates: CandidateStore,
    graph: InMemoryGraphStore,
    assignments: AssignmentStore,
    _gateway: support::StubGateway,
}

impl Harness {
    async fn start() -> Self {
        let files = FileStore::default();
        let audit = AuditStore::default();
        let assignments = AssignmentStore::default();
        let profiles = ProfilesStore::default();
        let targets = TargetStore::default();
        let candidates = CandidateStore::default();
        let graph = InMemoryGraphStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = router(TimelineDeps {
            auth,
            ledger: gateway.client(),
            audit,
            profiles,
            assignments: assignments.clone(),
            files: files.clone(),
            targets: targets.clone(),
            candidates: candidates.clone(),
            graph: graph.clone(),
        });
        Self { app, files, targets, candidates, graph, assignments, _gateway: gateway }
    }

    fn seed_file(&self, case_id: Uuid, name: &str, at: OffsetDateTime) -> Uuid {
        let id = Uuid::new_v4();
        let mut hasher = sha2::Sha256::new();
        use sha2::Digest;
        hasher.update(name.as_bytes());
        let sha256 = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
        self.files.insert(
            FileRecord {
                id,
                case_id,
                name: name.to_string(),
                mime: "application/pdf".to_string(),
                sha256,
                status: "committed".to_string(),
                provenance: "collected".to_string(),
                source_node: None,
                ledger_tx_id: None,
                ingested_at: at,
            },
            name.as_bytes().to_vec(),
        );
        id
    }

    fn seed_candidate(&self, case_id: Uuid, at: OffsetDateTime) -> Uuid {
        let target_id = Uuid::new_v4();
        let camera_id = Uuid::new_v4();
        self.targets.insert(Target {
            id: target_id,
            case_id,
            camera_id,
            track_id: 7,
            label: "target".to_string(),
            ledger_tx_id: "stub-tx-0".to_string(),
            ledger_status: "anchored".to_string(),
            active: true,
        });
        self.candidates.insert(Candidate {
            id: 1,
            target_id,
            camera_id,
            ts: at,
            similarity: 0.68,
            threshold_used: 0.65,
            prior_adjustment: -0.03,
            expected_from: None,
            crop_path: None,
            status: DecisionStatus::Proposed,
            decided_by: None,
            decided_at: None,
            ledger_tx_id: None,
        });
        target_id
    }

    fn seed_evidence(&self, case_id: Uuid, at: Option<OffsetDateTime>) -> (Uuid, Uuid) {
        let src = Uuid::new_v4();
        let dst = Uuid::new_v4();
        let edge_id = Uuid::new_v4();
        let mut nodes = HashMap::new();
        nodes.insert(src, StoredNode { typ: EntityType::Person, label: "A".to_string() });
        nodes.insert(dst, StoredNode { typ: EntityType::Person, label: "B".to_string() });
        self.graph.seed_case(
            case_id,
            GraphSnapshot::new(
                nodes,
                vec![StoredEdge {
                    id: edge_id,
                    src,
                    dst,
                    typ: "CALLED".to_string(),
                    weight: 8.0,
                }],
            ),
        );
        self.graph.seed_evidence(
            edge_id,
            vec![StoredEvidence {
                id: 1,
                edge_id,
                kind: "fir_text".to_string(),
                snippet: Some("A called B".to_string()),
                char_start: Some(0),
                char_end: Some(10),
                page_no: Some(1),
                source_file_id: Uuid::new_v4(),
                provenance: "collected".to_string(),
                occurred_at: at,
                ledger_hash: None,
                computed_hash: None,
            }],
        );
        (src, edge_id)
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

fn event_kinds(results: &Value) -> Vec<String> {
    results
        .as_array()
        .expect("results array")
        .iter()
        .map(|event| event["event_type"].as_str().expect("event type").to_string())
        .collect()
}

#[tokio::test]
async fn merges_all_four_kinds_with_clock_labels() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    harness.seed_file(case_id, "seized-letter.pdf", now);
    harness.seed_evidence(case_id, Some(now - Duration::hours(2)));
    harness.seed_candidate(case_id, now - Duration::hours(1));
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/cases/{case_id}/timeline"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    // Three seeded events. The timeline.read audit row lands after the
    // response snapshot, so it appears from the second call on.
    assert_eq!(parsed["results"].as_array().expect("results array").len(), 3);
    let mut kinds = event_kinds(&parsed["results"]);
    kinds.sort();
    assert_eq!(kinds, vec!["candidate_proposed", "evidence_committed", "file_ingested"]);
    for event in parsed["results"].as_array().expect("results array") {
        let clock = event["clock"].as_str().expect("clock label");
        assert!(clock == "case" || clock == "system", "every event carries a clock label");
        match event["event_type"].as_str().expect("event type") {
            "file_ingested" | "audit_action" => assert_eq!(clock, "system"),
            "evidence_committed" | "candidate_proposed" => assert_eq!(clock, "case"),
            other => panic!("unexpected event type {other}"),
        }
    }

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/timeline?type=audit_action"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let mut kinds = event_kinds(&parsed["results"]);
    kinds.sort();
    assert_eq!(kinds, vec!["audit_action"]);
}

#[tokio::test]
async fn default_order_is_newest_first_and_asc_reverses() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    harness.seed_file(case_id, "older.pdf", now - Duration::hours(5));
    harness.seed_file(case_id, "newer.pdf", now);
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, AppRole::Auditor);
    let token = support::mint_token(&auditor, "auditor", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/cases/{case_id}/timeline?type=file_ingested"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let results = parsed["results"].as_array().expect("results array");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["description"], "Document ingested: newer.pdf");
    assert_eq!(results[1]["description"], "Document ingested: older.pdf");

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/timeline?type=file_ingested&order=asc"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let results = parsed["results"].as_array().expect("results array");
    assert_eq!(results[0]["description"], "Document ingested: older.pdf");
}

#[tokio::test]
async fn entity_filter_matches_evidence_edge_ends() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let (src, _) = harness.seed_evidence(case_id, Some(now));
    harness.seed_file(case_id, "unrelated.pdf", now);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/timeline?entity_id={src}"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let results = parsed["results"].as_array().expect("results array");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["event_type"], "evidence_committed");
    assert!(results[0]["entity_refs"].as_array().expect("refs").iter().any(|r| r == &src.to_string()));
}

#[tokio::test]
async fn undateable_evidence_is_excluded_not_defaulted() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    harness.seed_evidence(case_id, None);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_id}/timeline?type=evidence_committed"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["results"].as_array().expect("results array").len(), 0);
}

#[tokio::test]
async fn cross_case_timeline_returns_403() {
    let harness = Harness::start().await;
    let case_a = Uuid::new_v4();
    harness.seed_file(case_a, "seized-letter.pdf", OffsetDateTime::now_utc());
    let officer = Uuid::new_v4();
    harness.assignments.assign(Uuid::new_v4(), officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{case_a}/timeline"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "CASE_ACCESS_DENIED");
}
