//! Engine node registration tests (M1-T3, D14, D21).
//!
//! - POST /nodes is admin-only: missing credentials answer 401, a
//!   verified non-admin identity answers 403. Same fix class as
//!   POST /cameras (e951ad6).
//! - Successful registration (new or re-register) writes exactly one
//!   `node.register` audit row, platform-scoped nil case_id like the
//!   §2.11 admin routes.
//! - Upsert-by-name and degraded status behaviour (M1-T3) is preserved.
//! - GET /nodes stays unauthenticated: the health board is
//!   operator-visible state.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use server::api::nodes::{NodeDeps, NodeStore};
use server::audit::AuditStore;
use server::auth::ProfilesStore;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    audit: AuditStore,
    _gateway: support::StubGateway,
}

impl Harness {
    async fn start() -> Self {
        let audit = AuditStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = server::api::nodes::router(
            NodeStore::default(),
            NodeDeps {
                auth,
                ledger: gateway.client(),
                audit: audit.clone(),
                profiles,
            },
        );
        Self { app, audit, _gateway: gateway }
    }

    fn admin_token() -> String {
        support::mint_token(&Uuid::new_v4(), "admin", 3600)
    }

    fn io_token() -> String {
        support::mint_token(&Uuid::new_v4(), "io", 3600)
    }
}

fn register_request(name: &str, budget_dps: f64, status: &str, token: Option<&str>) -> Request<Body> {
    let body = json!({
        "name": name,
        "address": "https://engine-1:8756",
        "budget_dps": budget_dps,
        "vram_ceiling": 1_000_000_000i64,
        "max_batch": 8,
        "gpu_name": "mock-gpu",
        "status": status,
    });
    let mut builder = Request::builder()
        .method("POST")
        .uri("/nodes")
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    builder.body(Body::from(body.to_string())).expect("request builds")
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    let parsed: Value =
        if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).expect("valid JSON") };
    (status, parsed)
}

#[tokio::test]
async fn registering_a_degraded_node_records_its_status() {
    let harness = Harness::start().await;
    let admin = Harness::admin_token();
    let response = harness
        .app
        .oneshot(register_request("engine-1", 5.0, "degraded", Some(&admin)))
        .await
        .expect("router responds");

    let (status, body) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["status"], "degraded");
    assert_eq!(body["budget_dps"], 5.0);
}

#[tokio::test]
async fn reregistering_the_same_node_updates_rather_than_duplicates() {
    let harness = Harness::start().await;
    let admin = Harness::admin_token();

    let first = harness
        .app
        .clone()
        .oneshot(register_request("engine-1", 5.0, "degraded", Some(&admin)))
        .await
        .expect("router responds");
    assert_eq!(first.status(), StatusCode::CREATED);

    let second = harness
        .app
        .clone()
        .oneshot(register_request("engine-1", 120.0, "ready", Some(&admin)))
        .await
        .expect("router responds");
    let (status, second_body) = body_json(second).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(second_body["status"], "ready");
    assert_eq!(second_body["budget_dps"], 120.0);

    let list_request = Request::builder()
        .method("GET")
        .uri("/nodes")
        .body(Body::empty())
        .expect("request builds");
    let list_response = harness.app.oneshot(list_request).await.expect("router responds");
    let (_, nodes) = body_json(list_response).await;
    let nodes_array = nodes.as_array().expect("nodes is a JSON array");
    assert_eq!(nodes_array.len(), 1, "re-registering must upsert, not duplicate");
    assert_eq!(nodes_array[0]["status"], "ready");
}

#[tokio::test]
async fn registration_without_token_is_unauthenticated() {
    let harness = Harness::start().await;
    let response = harness
        .app
        .oneshot(register_request("engine-1", 5.0, "degraded", None))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(parsed["error"]["code"], "UNAUTHENTICATED");

    // Rejected registrations audit nothing.
    assert!(harness.audit.is_empty());
}

#[tokio::test]
async fn non_admin_cannot_register_node() {
    let harness = Harness::start().await;
    let officer = Harness::io_token();
    let response = harness
        .app
        .oneshot(register_request("engine-1", 5.0, "degraded", Some(&officer)))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");

    // Rejected registrations audit nothing.
    assert!(harness.audit.is_empty());
}

#[tokio::test]
async fn successful_registration_writes_one_audit_row() {
    let harness = Harness::start().await;
    let admin = Harness::admin_token();
    let response = harness
        .app
        .clone()
        .oneshot(register_request("engine-1", 5.0, "degraded", Some(&admin)))
        .await
        .expect("router responds");
    let (status, created) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let node_id = created["id"].as_str().expect("node id").to_string();

    let rows = harness.audit.rows_for_case(&Uuid::nil());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, "node.register");
    assert_eq!(rows[0].object_type, "node");
    assert_eq!(rows[0].object_id, node_id);
    assert_eq!(rows[0].user_role, server::auth::AppRole::Admin);
}
