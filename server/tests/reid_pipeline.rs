//! M2-T4. Lock-on endpoint and candidate pipeline tests (D9, D15,
//! FR-5.8, CLAUDE.md rule 1).
//!
//! All timestamps are fixed literals (2025-11-02, not today): no test
//! calls `now()` or uses the current date. Threshold values below (0.6 /
//! 0.9) are test-only comparison points, not the operating threshold --
//! S2 is unmeasured (CLAUDE.md rule 10).

#[path = "support/mod.rs"]
mod support;

use std::collections::HashSet;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::{cameras::{Camera, CameraStore}, reid::{CandidateStore, DecideDeps, TargetStore}};
use server::audit::AuditStore;
use server::auth::ProfilesStore;
use server::reid::pipeline::{
    ActiveTarget, DecisionStatus, PipelineConfig, PipelineOutcome, TrackletInput,
    build_reid_candidate_event, build_reid_lost_event, handle_tracklet,
};
use time::macros::datetime;
use tower::ServiceExt;
use uuid::Uuid;

const EMBEDDING_DIM: usize = 512;

fn unit_vector(seed: u64) -> Vec<f32> {
    let mut values = Vec::with_capacity(EMBEDDING_DIM);
    let mut state = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    for _ in 0..EMBEDDING_DIM {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let uniform = ((state >> 11) as f32) / (u64::MAX >> 11) as f32 - 0.5;
        values.push(uniform);
    }
    let norm: f32 = values.iter().map(|v| v * v).sum::<f32>().sqrt();
    values.iter().map(|v| v / norm).collect()
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    let parsed: Value = serde_json::from_slice(&bytes).expect("body is valid JSON");
    (status, parsed)
}

fn authed(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    // Verified io identity (M5-T1): any fresh user id verifies against
    // the shared test key; lock-on admits the io role.
    let token = support::mint_token(&Uuid::new_v4(), "io", 3600);
    Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Body::from(body.to_string()))
        .expect("request builds")
}

/// M5 attribution dependencies for the lock-on tests: verified test
/// identity, stub ledger gateway, fresh audit/profile stores.
async fn decide_deps() -> DecideDeps {
    let gateway = support::StubGateway::start().await;
    DecideDeps {
        auth: support::test_auth_cache(),
        ledger: gateway.client(),
        audit: AuditStore::default(),
        profiles: ProfilesStore::default(),
    }
}

async fn register_camera(store: &CameraStore) -> Uuid {
    // Direct seed, not an HTTP registration: these tests exercise
    // lock-on against a known camera, while POST /cameras auth lives in
    // case_clock.rs (admin gate) and needs no re-proving here.
    let id = Uuid::new_v4();
    store.insert(Camera {
        id,
        code: "CAM-1".to_string(),
        label: "Terrace north".to_string(),
        declared_start_ts: datetime!(2025-11-02 10:00:00 UTC),
        fps: 10.0,
    });
    id
}

#[tokio::test]
async fn post_targets_without_valid_session_returns_401() {
    let cameras = CameraStore::default();
    let app = server::api::reid::router(TargetStore::default(), CandidateStore::default(), cameras, decide_deps().await);
    let case_id = Uuid::new_v4();
    let body = serde_json::json!({
        "camera_id": Uuid::new_v4(),
        "track_id": 7,
        "label": "target A",
    });
    let request = Request::builder()
        .method("POST")
        .uri(format!("/cases/{case_id}/targets"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(parsed["error"]["code"], "UNAUTHENTICATED");
}

#[tokio::test]
async fn post_targets_with_unregistered_camera_is_rejected() {
    let cameras = CameraStore::default();
    let app = server::api::reid::router(TargetStore::default(), CandidateStore::default(), cameras, decide_deps().await);
    let case_id = Uuid::new_v4();
    let body = serde_json::json!({
        "camera_id": Uuid::new_v4(),
        "track_id": 7,
        "label": "target A",
    });
    let response = app.oneshot(authed("POST", &format!("/cases/{case_id}/targets"), body)).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(parsed["error"]["code"], "NOT_FOUND");
}

#[tokio::test]
async fn post_targets_with_registered_camera_returns_target_and_ledger_tx() {
    let cameras = CameraStore::default();
    let camera_id = register_camera(&cameras).await;
    let app = server::api::reid::router(TargetStore::default(), CandidateStore::default(), cameras, decide_deps().await);
    let case_id = Uuid::new_v4();
    let body = serde_json::json!({
        "camera_id": camera_id,
        "track_id": 7,
        "label": "target A",
    });
    let response = app.oneshot(authed("POST", &format!("/cases/{case_id}/targets"), body)).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(parsed["target_id"].as_str().is_some_and(|s| !s.is_empty()));
    assert!(parsed["ledger_tx_id"].as_str().is_some_and(|s| !s.is_empty()));
}

fn tracklet_for(camera_id: Uuid, case_id: Uuid, embedding: Vec<f32>) -> TrackletInput {
    TrackletInput {
        case_id,
        track_id: 3,
        camera_id,
        ts: datetime!(2025-11-02 14:31:22 UTC),
        embedding,
        bbox: [201, 188, 74, 176],
        crop_path: Some("crops/cam03/t3.jpg".to_string()),
    }
}

fn target_for(case_id: Uuid, camera_id: Uuid, embedding: Vec<f32>) -> ActiveTarget {
    ActiveTarget {
        target_id: Uuid::new_v4(),
        case_id,
        embedding,
        source_camera: camera_id,
        source_ts: datetime!(2025-11-02 14:23:07 UTC),
    }
}

#[test]
fn tracklet_from_unregistered_camera_is_rejected() {
    let config = PipelineConfig { base_threshold: 0.6 };
    let case_id = Uuid::new_v4();
    let camera_id = Uuid::new_v4();
    let tracklet = tracklet_for(camera_id, case_id, unit_vector(5));
    let outcome = handle_tracklet(&config, &tracklet, &HashSet::new(), &[], &[]);
    let PipelineOutcome::RejectedUnknownCamera { reason } = outcome else {
        panic!("expected rejection, got {outcome:?}");
    };
    assert!(reason.contains(&camera_id.to_string()));
}

#[test]
fn reid_lost_is_emitted_when_no_candidate_clears_threshold() {
    let config = PipelineConfig { base_threshold: 0.9 };
    let case_id = Uuid::new_v4();
    let camera_id = Uuid::new_v4();
    let mut registered = HashSet::new();
    registered.insert(camera_id);
    // Deliberately dissimilar embeddings: similarity concentrates near 0,
    // far below the 0.9 test bar.
    let tracklet = tracklet_for(camera_id, case_id, unit_vector(11));
    let targets = vec![target_for(case_id, Uuid::new_v4(), unit_vector(77))];
    let outcome = handle_tracklet(&config, &tracklet, &registered, &targets, &[]);
    let PipelineOutcome::Lost(lost) = outcome else {
        panic!("expected Lost, got {outcome:?}");
    };
    assert_eq!(lost.case_id, case_id);
    let event = build_reid_lost_event(&lost, datetime!(2025-11-02 14:31:22 UTC));
    assert_eq!(event["type"], "reid.lost");
}

#[test]
fn proposed_candidate_has_status_proposed_not_confirmed() {
    let config = PipelineConfig { base_threshold: 0.6 };
    let case_id = Uuid::new_v4();
    let camera_id = Uuid::new_v4();
    let mut registered = HashSet::new();
    registered.insert(camera_id);
    let embedding = unit_vector(21);
    let tracklet = tracklet_for(camera_id, case_id, embedding.clone());
    let targets = vec![target_for(case_id, Uuid::new_v4(), embedding)];
    let outcome = handle_tracklet(&config, &tracklet, &registered, &targets, &[]);
    let PipelineOutcome::Candidates(proposals) = outcome else {
        panic!("expected Candidates, got {outcome:?}");
    };
    assert_eq!(proposals.len(), 1);
    let proposal = &proposals[0];
    assert_eq!(proposal.status, DecisionStatus::Proposed);
    assert_ne!(proposal.status, DecisionStatus::Confirmed);
    // Every row carries its explanation (API_CONTRACTS.md §4).
    assert!((proposal.threshold_used - 0.6).abs() < 1e-6);
    assert_eq!(proposal.prior_adjustment, 0.0);
    assert!(proposal.similarity > proposal.threshold_used);
    assert_eq!(proposal.crop_path.as_deref(), Some("crops/cam03/t3.jpg"));

    let event = build_reid_candidate_event(proposal, datetime!(2025-11-02 14:31:22 UTC));
    assert_eq!(event["type"], "reid.candidate");
    assert_eq!(event["payload"]["status"], "proposed");
    let threshold_used = event["payload"]["threshold_used"].as_f64().expect("threshold number");
    assert!((threshold_used - 0.6).abs() < 1e-6);
}
