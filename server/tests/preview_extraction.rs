//! Preview-extraction endpoint tests (D29, API_CONTRACTS.md §2.3).
//!
//! - io role only: auditor gets 403, missing session 401.
//! - Found surfaces return character spans; duplicates resolve to
//!   successive occurrences; missing surfaces return `found: false`
//!   with null spans (200, not an error); empty surfaces return `[]`.
//! - No persistence: the review store is untouched; the ONLY write is
//!   one `preview.extraction` audit row.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use server::api::review::{ReviewDeps, ReviewStore};
use server::audit::AuditStore;
use server::auth::ProfilesStore;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    audit: AuditStore,
    store: ReviewStore,
    case_id: Uuid,
}

impl Harness {
    fn start() -> Self {
        let audit = AuditStore::default();
        let store = ReviewStore::default();
        let case_id = Uuid::new_v4();
        let app = server::api::review::router(
            store.clone(),
            ReviewDeps {
                auth: support::test_auth_cache(),
                // No ledger identity is configured for the test reviewer,
                // so record_action short-circuits to `skipped_no_identity`
                // without any HTTP -- no stub gateway needed.
                ledger: server::ledger::LedgerClient::new("http://127.0.0.1:8801/")
                    .expect("test ledger client builds"),
                audit: audit.clone(),
                profiles: ProfilesStore::default(),
            },
        );
        Self { app, audit, store, case_id }
    }

    fn io_token() -> String {
        support::mint_token(&Uuid::new_v4(), "io", 3600)
    }

    fn auditor_token() -> String {
        support::mint_token(&Uuid::new_v4(), "auditor", 3600)
    }
}

fn preview_request(case_id: &Uuid, token: Option<&str>, body: Value) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(format!("/cases/{case_id}/preview-extraction"))
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    builder.body(Body::from(body.to_string())).expect("request builds")
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

#[tokio::test]
async fn found_surface_returns_correct_span() {
    let harness = Harness::start();
    let token = Harness::io_token();
    let response = harness
        .app
        .oneshot(preview_request(
            &harness.case_id,
            Some(&token),
            json!({
                "text": "Ravi Kumar called Suresh Rao",
                "surfaces": [
                    {"type": "PERSON", "value": "Ravi Kumar"},
                    {"type": "PERSON", "value": "Suresh Rao"},
                ],
            }),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        parsed,
        json!([
            {"type": "PERSON", "value": "Ravi Kumar", "char_start": 0, "char_end": 10, "found": true},
            {"type": "PERSON", "value": "Suresh Rao", "char_start": 18, "char_end": 28, "found": true},
        ])
    );
}

#[tokio::test]
async fn duplicate_surface_resolves_successive_occurrences() {
    let harness = Harness::start();
    let token = Harness::io_token();
    let response = harness
        .app
        .oneshot(preview_request(
            &harness.case_id,
            Some(&token),
            json!({
                "text": "Patil met Patil",
                "surfaces": [
                    {"type": "PERSON", "value": "Patil"},
                    {"type": "PERSON", "value": "Patil"},
                ],
            }),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed[0]["char_start"], 0);
    assert_eq!(parsed[0]["char_end"], 5);
    assert_eq!(parsed[1]["char_start"], 10);
    assert_eq!(parsed[1]["char_end"], 15);
}

#[tokio::test]
async fn non_ascii_spans_are_character_offsets_not_bytes() {
    // "राम और श्याम": राम occupies chars 0-3, श्याम chars 7-12. In
    // UTF-8 every Devanagari code point is 3 bytes, so byte offsets
    // ([0,9) / [21,36)) differ sharply -- this test fails on a byte
    // implementation and passes on a char one.
    let harness = Harness::start();
    let token = Harness::io_token();
    let response = harness
        .app
        .oneshot(preview_request(
            &harness.case_id,
            Some(&token),
            json!({
                "text": "राम और श्याम",
                "surfaces": [
                    {"type": "PERSON", "value": "राम"},
                    {"type": "PERSON", "value": "श्याम"},
                ],
            }),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed[0]["char_start"], 0);
    assert_eq!(parsed[0]["char_end"], 3);
    assert_eq!(parsed[1]["char_start"], 7);
    assert_eq!(parsed[1]["char_end"], 12);
}

#[tokio::test]
async fn missing_surface_returns_found_false_not_an_error() {
    let harness = Harness::start();
    let token = Harness::io_token();
    let response = harness
        .app
        .oneshot(preview_request(
            &harness.case_id,
            Some(&token),
            json!({
                "text": "Ravi Kumar called Suresh Rao",
                "surfaces": [{"type": "PERSON", "value": "Amit Shah"}],
            }),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        parsed,
        json!([{"type": "PERSON", "value": "Amit Shah", "char_start": null, "char_end": null, "found": false}])
    );
}

#[tokio::test]
async fn auditor_role_is_forbidden_and_anonymous_is_unauthenticated() {
    let harness = Harness::start();
    let auditor = Harness::auditor_token();
    let body = json!({"text": "abc", "surfaces": []});
    let response = harness
        .app
        .clone()
        .oneshot(preview_request(&harness.case_id, Some(&auditor), body.clone()))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");

    let response = harness
        .app
        .oneshot(preview_request(&harness.case_id, None, body))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(parsed["error"]["code"], "UNAUTHENTICATED");

    // Rejected calls audit nothing.
    assert!(harness.audit.is_empty());
}

#[tokio::test]
async fn empty_surfaces_returns_empty_array() {
    let harness = Harness::start();
    let token = Harness::io_token();
    let response = harness
        .app
        .oneshot(preview_request(&harness.case_id, Some(&token), json!({"text": "abc", "surfaces": []})))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed, json!([]));
}

#[tokio::test]
async fn preview_writes_audit_row_and_persists_nothing() {
    let harness = Harness::start();
    let token = Harness::io_token();
    let response = harness
        .app
        .oneshot(preview_request(
            &harness.case_id,
            Some(&token),
            json!({
                "text": "Ravi Kumar called Suresh Rao",
                "surfaces": [{"type": "PERSON", "value": "Ravi Kumar"}],
            }),
        ))
        .await
        .expect("router responds");
    assert_eq!(body_json(response).await.0, StatusCode::OK);

    let rows = harness.audit.rows_for_case(&harness.case_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, "preview.extraction");
    assert_eq!(rows[0].object_type, "preview_extraction");
    assert_eq!(rows[0].user_role, server::auth::AppRole::Io);
    // No persistence: the review store the router shares is untouched.
    assert!(harness.store.is_empty());
}
