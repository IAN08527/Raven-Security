//! M3-6. Review queue endpoint tests (FR-2.7, rule 1 transferred
//! from M2): one mutating path, no auto-accept, decided rows stay
//! visible, and auto-commit from a non-gated script is refused with
//! `SCRIPT_NOT_GATED`.
//!
//! Decide requires a verified GoTrue JWT with the io role (M5-T1/T3,
//! same discipline as candidate decide); every decision writes an audit
//! row and anchors through the stub ledger gateway (D21, FR-7.4).

#[path = "support/mod.rs"]
mod support;

use std::collections::HashSet;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::review::{ReviewDeps, ReviewItem, ReviewStatus, ReviewStore, extraction_may_autocommit};
use server::audit::AuditStore;
use server::auth::ProfilesStore;
use tower::ServiceExt;
use uuid::Uuid;

fn pending_item(id: i64, case_id: Uuid) -> ReviewItem {
    ReviewItem {
        id,
        case_id,
        source_file_id: Uuid::new_v4(),
        page_no: Some(1),
        line_no: Some(3),
        field_name: Some("narrative".to_string()),
        script: "Deva".to_string(),
        crop_path: "crops/p1/l3.png".to_string(),
        recognised_text: Some("????".to_string()),
        confidence: Some(0.31),
        corrected_text: None,
        status: ReviewStatus::Pending,
        reviewed_by: None,
        reviewed_at: None,
        ledger_tx_id: None,
    }
}

fn seeded_store() -> (ReviewStore, Uuid, Uuid) {
    let store = ReviewStore::default();
    let case_a = Uuid::new_v4();
    let case_b = Uuid::new_v4();
    store.insert(pending_item(1, case_a));
    store.insert(pending_item(2, case_a));
    store.insert(pending_item(3, case_b));
    (store, case_a, case_b)
}

/// App plus a verified io reviewer's token. The reviewer carries a
/// ledger identity, so decisions anchor through the stub gateway.
async fn app(store: &ReviewStore) -> (axum::Router, String) {
    let profiles = ProfilesStore::default();
    let reviewer = Uuid::new_v4();
    profiles.set_ledger_id(reviewer, "reviewer-ledger-1");
    let token = support::mint_token(&reviewer, "io", 3600);
    let gateway = support::StubGateway::start().await;
    let app = server::api::review::router(
        store.clone(),
        ReviewDeps {
            auth: support::test_auth_cache(),
            ledger: gateway.client(),
            audit: AuditStore::default(),
            profiles,
        },
    );
    (app, token)
}

fn decide_request(id: i64, token: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(format!("/review/{id}"))
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
    let (store, _, _) = seeded_store();
    let (app, _) = app(&store).await;
    let body = serde_json::json!({"corrected_text": "fixed", "status": "corrected"});
    let request = Request::builder()
        .method("POST")
        .uri("/review/1")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(parsed["error"]["code"], "UNAUTHENTICATED");
}

#[tokio::test]
async fn pending_list_is_scoped_to_case_and_status() {
    let (store, case_a, _) = seeded_store();
    let (app, token) = app(&store).await;
    // Decide item 2 first so the pending filter has something to exclude.
    let decide = serde_json::json!({"corrected_text": "fixed", "status": "corrected"});
    let decided = app
        .clone()
        .oneshot(decide_request(2, &token, decide))
        .await
        .expect("router responds");
    assert_eq!(decided.status(), StatusCode::OK);

    let request = Request::builder()
        .method("GET")
        .uri(format!("/cases/{case_a}/review?status=pending"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds");
    let response = app.oneshot(request).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let rows = parsed.as_array().expect("array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["id"], 1);
}

#[tokio::test]
async fn decide_corrected_records_text_and_ledger_tx() {
    let (store, _, _) = seeded_store();
    let (app, token) = app(&store).await;
    let body = serde_json::json!({"corrected_text": "fixed transcription", "status": "corrected"});
    let response =
        app.oneshot(decide_request(1, &token, body)).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], "corrected");
    assert_eq!(parsed["ledger_status"], "anchored");
    assert!(parsed["ledger_tx_id"].as_str().is_some_and(|s| !s.is_empty()));
}

#[tokio::test]
async fn auditor_token_cannot_decide_review() {
    let (store, _, _) = seeded_store();
    let (app, _) = app(&store).await;
    let token = support::mint_token(&Uuid::new_v4(), "auditor", 3600);
    let body = serde_json::json!({"corrected_text": null, "status": "accepted"});
    let response =
        app.oneshot(decide_request(1, &token, body)).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");
}

#[tokio::test]
async fn deciding_twice_is_rejected_with_conflict() {
    let (store, _, _) = seeded_store();
    let (app, token) = app(&store).await;
    let body = serde_json::json!({"corrected_text": null, "status": "accepted"});
    let first = decide_request(1, &token, body.clone());
    let response = app.clone().oneshot(first).await.expect("router responds");
    assert_eq!(response.status(), StatusCode::OK);

    let second = decide_request(1, &token, body);
    let response = app.oneshot(second).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(parsed["error"]["code"], "CONFLICT");
}

#[tokio::test]
async fn decided_rows_remain_visible_in_unfiltered_list() {
    let (store, case_a, _) = seeded_store();
    let (app, token) = app(&store).await;
    for (id, decision) in [(1, "corrected"), (2, "rejected")] {
        let body = serde_json::json!({"corrected_text": "x", "status": decision});
        let response = app
            .clone()
            .oneshot(decide_request(id, &token, body))
            .await
            .expect("router responds");
        assert_eq!(response.status(), StatusCode::OK);
    }
    let request = Request::builder()
        .method("GET")
        .uri(format!("/cases/{case_a}/review"))
        .header("authorization", format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request builds");
    let response = app.oneshot(request).await.expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let rows = parsed.as_array().expect("array");
    assert_eq!(rows.len(), 2, "decided rows must remain visible as audit evidence");
}

#[test]
fn autocommit_from_non_gated_script_returns_script_not_gated() {
    let gated: HashSet<String> = HashSet::new();
    assert_eq!(extraction_may_autocommit("Deva", &gated), Err("SCRIPT_NOT_GATED"));

    let mut gated = HashSet::new();
    gated.insert("Latn".to_string());
    assert_eq!(extraction_may_autocommit("Latn", &gated), Ok(()));
    assert_eq!(extraction_may_autocommit("Deva", &gated), Err("SCRIPT_NOT_GATED"));
}
