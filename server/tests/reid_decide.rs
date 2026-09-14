//! M2-T5 + M5-T3. Confirmation endpoint tests (D9, FR-5.7, CLAUDE.md rule 1).
//!
//! - Only `POST /candidates/{id}/decide` can produce `confirmed`.
//! - Confirmed AND rejected rows both remain visible via
//!   `GET /targets/{id}/candidates` (audit evidence, never hidden).
//! - Decide requires a verified GoTrue JWT with the io role (M5-T1):
//!   auditor tokens are FORBIDDEN (D9 single-confirm discipline).
//! - Every decision writes an audit row and anchors through the ledger
//!   gateway with the actor's `profiles.ledger_id` (M5-T3, D21, FR-7.4).
//! - Timestamps fixed literals; `decided_at` is server-set audit time.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::reid::{
    Candidate, CandidateStore, DecideDeps, Target, TargetStore,
};
use server::api::cameras::CameraStore;
use server::audit::AuditStore;
use server::auth::ProfilesStore;
use server::reid::pipeline::DecisionStatus;
use time::macros::datetime;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    targets: TargetStore,
    candidates: CandidateStore,
    audit: AuditStore,
    profiles: ProfilesStore,
    gateway: support::StubGateway,
}

impl Harness {
    async fn start() -> Self {
        let targets = TargetStore::default();
        let candidates = CandidateStore::default();
        let audit = AuditStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = server::api::reid::router(
            targets.clone(),
            candidates.clone(),
            CameraStore::default(),
            DecideDeps {
                auth: auth.clone(),
                ledger: gateway.client(),
                audit: audit.clone(),
                profiles: profiles.clone(),
            },
        );
        Self { app, targets, candidates, audit, profiles, gateway }
    }

    fn io_token(&self, user: &Uuid) -> String {
        support::mint_token(user, "io", 3600)
    }

    /// One lock-on target in a case.
    fn new_target(&self, case_id: Uuid) -> Uuid {
        let target = Target {
            id: Uuid::new_v4(),
            case_id,
            camera_id: Uuid::new_v4(),
            track_id: 7,
            label: "target A".to_string(),
            ledger_tx_id: "seed".to_string(),
            ledger_status: "seed".to_string(),
            active: true,
        };
        let target_id = target.id;
        self.targets.insert(target);
        target_id
    }

    /// One proposed candidate on a fresh lock-on target in a case.
    fn seed(&self, id: i64, case_id: Uuid) -> Uuid {
        let target_id = self.new_target(case_id);
        self.seed_on(target_id, id);
        target_id
    }

    /// One proposed candidate joined to an existing lock-on target.
    fn seed_on(&self, target_id: Uuid, id: i64) {
        self.candidates.insert(Candidate {
            id,
            target_id,
            camera_id: Uuid::new_v4(),
            ts: datetime!(2025-11-02 14:31:22 UTC),
            similarity: 0.81,
            threshold_used: 0.65,
            prior_adjustment: -0.05,
            expected_from: None,
            crop_path: Some("crops/cam03/t3.jpg".to_string()),
            status: DecisionStatus::Proposed,
            decided_by: None,
            decided_at: None,
            ledger_tx_id: None,
        });
    }
}

fn decide_request(id: i64, token: &str, decision: &str) -> Request<Body> {
    let body = serde_json::json!({"decision": decision, "note": "reviewed against source crop"});
    Request::builder()
        .method("POST")
        .uri(format!("/candidates/{id}/decide"))
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
async fn decide_without_session_returns_401() {
    let harness = Harness::start().await;
    harness.seed(1, Uuid::new_v4());
    let body = serde_json::json!({"decision": "confirmed"});
    let request = Request::builder()
        .method("POST")
        .uri("/candidates/1/decide")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request builds");
    let response = harness.app.oneshot(request).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(parsed["error"]["code"], "UNAUTHENTICATED");
}

#[tokio::test]
async fn confirm_transitions_to_confirmed_with_ledger_tx() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    harness.seed(11, case_id);
    let decider = Uuid::new_v4();
    harness.profiles.set_ledger_id(decider, "officer-ledger-1");
    let token = harness.io_token(&decider);
    let response = harness
        .app
        .oneshot(decide_request(11, &token, "confirmed"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], "confirmed");
    assert_eq!(parsed["ledger_status"], "anchored");
    let tx = parsed["ledger_tx_id"].as_str().expect("ledger tx id");
    assert!(!tx.is_empty());
    // The gateway saw the signed action with the actor's ledger identity.
    let posts = harness.gateway.posts();
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0]["actorLedgerId"], "officer-ledger-1");
    assert_eq!(posts[0]["actionType"], "candidate.confirm");
    // The audit row landed with the same tx.
    let rows = harness.audit.rows_for_case(&case_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].ledger_tx_id.as_deref(), Some(tx));
    assert_eq!(rows[0].user_id, decider);
}

#[tokio::test]
async fn auditor_token_cannot_decide() {
    let harness = Harness::start().await;
    harness.seed(12, Uuid::new_v4());
    let auditor = Uuid::new_v4();
    let token = support::mint_token(&auditor, "auditor", 3600);
    let response = harness
        .app
        .oneshot(decide_request(12, &token, "confirmed"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");
}

#[tokio::test]
async fn reject_transitions_to_rejected_and_stays_visible() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let target_id = harness.new_target(case_id);
    harness.seed_on(target_id, 21);
    harness.seed_on(target_id, 22);
    let decider = Uuid::new_v4();
    let token = harness.io_token(&decider);

    let response = harness
        .app
        .clone()
        .oneshot(decide_request(21, &token, "confirmed"))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::OK);

    let response = harness
        .app
        .clone()
        .oneshot(decide_request(22, &token, "rejected"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], "rejected");

    // Both rows remain visible: unfiltered list returns confirmed + rejected.
    let request = Request::builder()
        .method("GET")
        .uri(format!("/targets/{target_id}/candidates"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds");
    let response = harness.app.oneshot(request).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let rows = parsed.as_array().expect("array");
    assert_eq!(rows.len(), 2, "confirmed and rejected must both remain visible");
    let statuses: Vec<&str> = rows.iter().map(|row| row["status"].as_str().unwrap_or("")).collect();
    assert!(statuses.contains(&"confirmed"), "confirmed badge row visible: {statuses:?}");
    assert!(statuses.contains(&"rejected"), "rejected badge row visible, not hidden: {statuses:?}");
}

#[tokio::test]
async fn deciding_twice_is_rejected_with_conflict() {
    let harness = Harness::start().await;
    harness.seed(31, Uuid::new_v4());
    let decider = Uuid::new_v4();
    let token = harness.io_token(&decider);
    let first = harness
        .app
        .clone()
        .oneshot(decide_request(31, &token, "confirmed"))
        .await
        .expect("router responds");
    assert_eq!(first.status(), StatusCode::OK);
    let second = harness
        .app
        .oneshot(decide_request(31, &token, "rejected"))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(second).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(parsed["error"]["code"], "CONFLICT");
}

#[test]
fn pipeline_never_constructs_confirmed() {
    // Guard for CLAUDE.md rule 1: the only `DecisionStatus::Confirmed`
    // construction in non-test code must be the decide handler in
    // api/reid.rs. (The enum definition itself lives in pipeline.rs, so
    // this matches the qualified construction expression, not the bare
    // variant name.)
    let source = include_str!("../src/reid/pipeline.rs");
    assert!(
        !source.contains("DecisionStatus::Confirmed"),
        "pipeline.rs must never construct DecisionStatus::Confirmed (D9)"
    );
}
