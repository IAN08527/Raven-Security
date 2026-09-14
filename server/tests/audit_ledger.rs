//! M5-T3. Attributable actions and auditor view tests (D21, FR-7.4/FR-7.5).
//!
//! - A confirmed candidate whose actor has a ledger identity anchors:
//!   the audit row carries the gateway `ledger_tx_id`.
//! - A confirmed candidate whose actor has no ledger identity still
//!   proceeds, recorded as `ledger_status='skipped_no_identity'` (warn,
//!   never silent).
//! - An auditor reads audit rows for assigned cases; an io cannot read
//!   another officer's case audit log (`CASE_ACCESS_DENIED`).
//! - CSV export returns the filtered rows; per-row verify shows both
//!   hashes plus endorsements, flagging tamper.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::reid::{Candidate, CandidateStore, DecideDeps, Target, TargetStore};
use server::api::cameras::CameraStore;
use server::audit::{AssignmentStore, AuditStore};
use server::auth::ProfilesStore;
use server::reid::pipeline::DecisionStatus;
use time::macros::datetime;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    audit: AuditStore,
    assignments: AssignmentStore,
    profiles: ProfilesStore,
    gateway: support::StubGateway,
    auth: std::sync::Arc<server::auth::JwksCache>,
}

impl Harness {
    async fn start() -> Self {
        Self {
            audit: AuditStore::default(),
            assignments: AssignmentStore::default(),
            profiles: ProfilesStore::default(),
            gateway: support::StubGateway::start().await,
            auth: support::test_auth_cache(),
        }
    }

    fn reid_router(&self, targets: TargetStore, candidates: CandidateStore) -> axum::Router {
        server::api::reid::router(
            targets,
            candidates,
            CameraStore::default(),
            DecideDeps {
                auth: self.auth.clone(),
                ledger: self.gateway.client(),
                audit: self.audit.clone(),
                profiles: self.profiles.clone(),
            },
        )
    }

    fn audit_router(&self) -> axum::Router {
        server::api::audit::router(
            self.audit.clone(),
            self.assignments.clone(),
            self.auth.clone(),
            self.gateway.client(),
        )
    }

    fn token(user: &Uuid, role: &str) -> String {
        support::mint_token(user, role, 3600)
    }

    /// Seed target + proposed candidate; returns nothing (ids are
    /// fixed literals per test for readability).
    fn seed_candidate(
        &self,
        targets: &TargetStore,
        candidates: &CandidateStore,
        id: i64,
        case_id: Uuid,
    ) {
        let target = Target {
            id: Uuid::new_v4(),
            case_id,
            camera_id: Uuid::new_v4(),
            track_id: 7,
            label: "t".to_string(),
            ledger_tx_id: "seed".to_string(),
            ledger_status: "seed".to_string(),
            active: true,
        };
        let target_id = target.id;
        targets.insert(target);
        candidates.insert(Candidate {
            id,
            target_id,
            camera_id: Uuid::new_v4(),
            ts: datetime!(2025-11-02 14:31:22 UTC),
            similarity: 0.8,
            threshold_used: 0.6,
            prior_adjustment: 0.0,
            expected_from: None,
            crop_path: None,
            status: DecisionStatus::Proposed,
            decided_by: None,
            decided_at: None,
            ledger_tx_id: None,
        });
    }
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

async fn body_text(response: axum::response::Response) -> (StatusCode, String) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, String::from_utf8(bytes.to_vec()).expect("utf8"))
}

#[tokio::test]
async fn anchored_decision_appears_in_case_audit_with_tx() {
    let harness = Harness::start().await;
    let targets = TargetStore::default();
    let candidates = CandidateStore::default();
    let reid = harness.reid_router(targets.clone(), candidates.clone());
    let audit_api = harness.audit_router();
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.profiles.set_ledger_id(officer, "officer-ledger-9");
    harness.assignments.assign(case_id, officer, server::auth::AppRole::Io);
    harness.seed_candidate(&targets, &candidates, 1, case_id);
    let token = Harness::token(&officer, "io");

    let decide = Request::builder()
        .method("POST")
        .uri("/candidates/1/decide")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(serde_json::json!({"decision": "confirmed"}).to_string()))
        .expect("request builds");
    let (status, parsed) = body_json(reid.oneshot(decide).await.expect("responds")).await;
    assert_eq!(status, StatusCode::OK);
    let tx = parsed["ledger_tx_id"].as_str().expect("tx").to_string();

    let list = Request::builder()
        .method("GET")
        .uri(format!("/cases/{case_id}/audit"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds");
    let (status, parsed) =
        body_json(audit_api.oneshot(list).await.expect("responds")).await;
    assert_eq!(status, StatusCode::OK);
    let rows = parsed.as_array().expect("array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["ledger_tx_id"], tx);
    assert_eq!(rows[0]["ledger_status"], "anchored");
    assert_eq!(rows[0]["action"], "candidate.confirm");
}

#[tokio::test]
async fn decision_without_ledger_identity_is_marked_skipped() {
    let harness = Harness::start().await;
    let targets = TargetStore::default();
    let candidates = CandidateStore::default();
    let reid = harness.reid_router(targets.clone(), candidates.clone());
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    // No profiles.ledger_id set: the Fabric org is not configured yet.
    harness.assignments.assign(case_id, officer, server::auth::AppRole::Io);
    harness.seed_candidate(&targets, &candidates, 2, case_id);
    let token = Harness::token(&officer, "io");

    let decide = Request::builder()
        .method("POST")
        .uri("/candidates/2/decide")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(serde_json::json!({"decision": "rejected"}).to_string()))
        .expect("request builds");
    let (status, parsed) = body_json(reid.oneshot(decide).await.expect("responds")).await;
    assert_eq!(status, StatusCode::OK, "action proceeds without ledger identity");
    assert_eq!(parsed["ledger_status"], "skipped_no_identity");
    assert!(parsed["ledger_tx_id"].is_null());

    let rows = harness.audit.rows_for_case(&case_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].ledger_status, "skipped_no_identity");
    // ... and the gateway was never called: no silent attempt, no phantom tx.
    assert!(harness.gateway.posts().is_empty());
}

#[tokio::test]
async fn auditor_reads_assigned_case_but_io_cannot_read_others_case() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    let auditor = Uuid::new_v4();
    let stranger = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, server::auth::AppRole::Io);
    harness.assignments.assign(case_id, auditor, server::auth::AppRole::Auditor);

    let auditor_token = Harness::token(&auditor, "auditor");
    let list = Request::builder()
        .method("GET")
        .uri(format!("/cases/{case_id}/audit"))
        .header("authorization", format!("Bearer {auditor_token}"))
        .body(Body::empty())
        .expect("request builds");
    let (status, _) =
        body_json(harness.audit_router().oneshot(list).await.expect("responds")).await;
    assert_eq!(status, StatusCode::OK, "auditor reads assigned case");

    let stranger_token = Harness::token(&stranger, "io");
    let list = Request::builder()
        .method("GET")
        .uri(format!("/cases/{case_id}/audit"))
        .header("authorization", format!("Bearer {stranger_token}"))
        .body(Body::empty())
        .expect("request builds");
    let (status, parsed) =
        body_json(harness.audit_router().oneshot(list).await.expect("responds")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "CASE_ACCESS_DENIED");
}

#[tokio::test]
async fn export_returns_csv_of_filtered_rows() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, server::auth::AppRole::Io);
    harness.profiles.set_ledger_id(officer, "officer-ledger-9");
    let token = Harness::token(&officer, "io");
    // Seed two audit rows directly (one anchored, one skipped).
    harness.audit.insert(server::audit::AuditRow {
        id: Uuid::new_v4(),
        case_id,
        user_id: officer,
        user_role: server::auth::AppRole::Io,
        action: "candidate.confirm".to_string(),
        object_type: "reid_candidate".to_string(),
        object_id: "1".to_string(),
        payload_hash: "aa".to_string(),
        ledger_tx_id: Some("stub-tx-1".to_string()),
        ledger_status: "anchored".to_string(),
        created_at: time::macros::datetime!(2025-11-02 14:00:00 UTC),
    });
    harness.audit.insert(server::audit::AuditRow {
        id: Uuid::new_v4(),
        case_id,
        user_id: officer,
        user_role: server::auth::AppRole::Io,
        action: "review.accept".to_string(),
        object_type: "review_item".to_string(),
        object_id: "7".to_string(),
        payload_hash: "bb".to_string(),
        ledger_tx_id: None,
        ledger_status: "skipped_no_identity".to_string(),
        created_at: time::macros::datetime!(2025-11-02 15:00:00 UTC),
    });

    let export = Request::builder()
        .method("GET")
        .uri(format!("/cases/{case_id}/audit/export?action=candidate.confirm"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds");
    let (status, body) =
        body_text(harness.audit_router().oneshot(export).await.expect("responds")).await;
    assert_eq!(status, StatusCode::OK);
    let lines: Vec<&str> = body.lines().collect();
    assert_eq!(lines.len(), 2, "header plus the one filtered row, got: {body}");
    assert!(lines[0].starts_with("timestamp,user_id,"), "csv header: {}", lines[0]);
    assert!(lines[1].contains("candidate.confirm"), "filtered row: {}", lines[1]);
}

#[tokio::test]
async fn verify_row_shows_both_hashes_and_endorsements() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, server::auth::AppRole::Auditor);
    let token = Harness::token(&auditor, "auditor");
    let row_id = Uuid::new_v4();
    harness.audit.insert(server::audit::AuditRow {
        id: row_id,
        case_id,
        user_id: Uuid::new_v4(),
        user_role: server::auth::AppRole::Io,
        action: "candidate.confirm".to_string(),
        object_type: "reid_candidate".to_string(),
        object_id: "obj-1".to_string(),
        payload_hash: "real-hash".to_string(),
        ledger_tx_id: Some("stub-tx-1".to_string()),
        ledger_status: "anchored".to_string(),
        created_at: time::macros::datetime!(2025-11-02 14:00:00 UTC),
    });
    // Ledger agrees: verified, two real org endorsements.
    harness.gateway.set_verify(
        "obj-1",
        "real-hash",
        serde_json::json!([{"org": "district-cid"}, {"org": "cyber-cell"}]),
    );
    let verify = Request::builder()
        .method("GET")
        .uri(format!("/cases/{case_id}/audit/{row_id}/verify"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds");
    let (status, parsed) =
        body_json(harness.audit_router().oneshot(verify).await.expect("responds")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["tampered"], false);
    assert_eq!(parsed["stored_hash"], "real-hash");
    assert_eq!(parsed["ledger_hash"], "real-hash");
    assert_eq!(parsed["endorsements"].as_array().expect("array").len(), 2);

    // Ledger disagrees: tampered, both hashes shown.
    harness.gateway.set_verify(
        "obj-1",
        "different-hash",
        serde_json::json!([{"org": "mock", "mode": "mock"}]),
    );
    let verify = Request::builder()
        .method("GET")
        .uri(format!("/cases/{case_id}/audit/{row_id}/verify"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds");
    let (status, parsed) =
        body_json(harness.audit_router().oneshot(verify).await.expect("responds")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["tampered"], true);
    assert_eq!(parsed["stored_hash"], "real-hash");
    assert_eq!(parsed["ledger_hash"], "different-hash");
}
