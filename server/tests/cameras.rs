//! Camera administration tests (API_CONTRACTS.md §2.6, D32).
//!
//! - GET /cameras requires no authentication (D32): investigators check
//!   feeds without admin rights. This is a recorded decision, not an
//!   oversight — this test pins it.
//! - POST /cameras and POST /camera-edges are admin-only and each writes
//!   exactly one audit row (`camera.register` / `camera.edge`,
//!   platform-scoped nil case_id like the §2.11 admin routes).
//! - Edge validation: self-loops, non-positive travel means and unknown
//!   camera ids are rejected before anything is stored or audited.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use server::api::cameras::{CameraDeps, CameraEdgeStore, CameraStore, router};
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
        let app = router(
            CameraStore::default(),
            CameraEdgeStore::default(),
            CameraDeps {
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

fn authed(method: &str, uri: &str, token: Option<&str>, body: Option<Value>) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    match body {
        None => builder.body(Body::empty()).expect("request builds"),
        Some(value) => builder
            .header("content-type", "application/json")
            .body(Body::from(value.to_string()))
            .expect("request builds"),
    }
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    let parsed: Value =
        if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).expect("valid JSON") };
    (status, parsed)
}

fn register_body(code: &str) -> Value {
    json!({
        "code": code,
        "label": format!("{code} label"),
        "declared_start_ts": "2025-11-02T10:00:00Z",
        "fps": 10.0,
    })
}

async fn register_camera(app: &axum::Router, admin: &str, code: &str) -> String {
    let response = app
        .clone()
        .oneshot(authed("POST", "/cameras", Some(admin), Some(register_body(code))))
        .await
        .expect("router responds");
    let (status, created) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    created["id"].as_str().expect("camera id").to_string()
}

#[tokio::test]
async fn registration_writes_one_audit_row() {
    let harness = Harness::start().await;
    let admin = Harness::admin_token();

    let camera_id = register_camera(&harness.app, &admin, "CAM-1").await;

    let rows = harness.audit.rows_for_case(&Uuid::nil());
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, "camera.register");
    assert_eq!(rows[0].object_type, "camera");
    assert_eq!(rows[0].object_id, camera_id);
    assert_eq!(rows[0].user_role, server::auth::AppRole::Admin);
}

#[tokio::test]
async fn edge_creation_writes_one_audit_row() {
    let harness = Harness::start().await;
    let admin = Harness::admin_token();
    let from = register_camera(&harness.app, &admin, "CAM-1").await;
    let to = register_camera(&harness.app, &admin, "CAM-2").await;

    let response = harness
        .app
        .clone()
        .oneshot(authed(
            "POST",
            "/camera-edges",
            Some(&admin),
            Some(json!({
                "from": from,
                "to": to,
                "mean_travel_s": 600.0,
                "stddev_s": 60.0,
            })),
        ))
        .await
        .expect("router responds");
    let (status, edge) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(edge["from_camera"], from);
    assert_eq!(edge["to_camera"], to);

    let rows = harness.audit.rows_for_case(&Uuid::nil());
    let edges: Vec<_> = rows.iter().filter(|row| row.action == "camera.edge").collect();
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].object_type, "camera_edge");
    assert_eq!(edges[0].object_id, format!("{from}->{to}"));
}

#[tokio::test]
async fn list_cameras_needs_no_authentication() {
    // D32: listing cameras is intentionally unauthenticated on the
    // premises LAN. If this test ever fails, the decision changed —
    // update DECISIONS.md D32, do not just re-gate the route.
    let harness = Harness::start().await;
    let admin = Harness::admin_token();
    register_camera(&harness.app, &admin, "CAM-1").await;

    let response = harness
        .app
        .clone()
        .oneshot(authed("GET", "/cameras", None, None))
        .await
        .expect("router responds");
    let (status, listed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed.as_array().expect("camera array").len(), 1);
}

#[tokio::test]
async fn non_admin_cannot_register_or_link() {
    let harness = Harness::start().await;
    let officer = Harness::io_token();

    let response = harness
        .app
        .clone()
        .oneshot(authed("POST", "/cameras", Some(&officer), Some(register_body("CAM-1"))))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");

    let response = harness
        .app
        .oneshot(authed(
            "POST",
            "/camera-edges",
            Some(&officer),
            Some(json!({
                "from": Uuid::new_v4(),
                "to": Uuid::new_v4(),
                "mean_travel_s": 600.0,
                "stddev_s": 60.0,
            })),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "FORBIDDEN");

    // Rejected mutations audit nothing.
    assert!(harness.audit.is_empty());
}

#[tokio::test]
async fn edge_validation_rejects_bad_topology() {
    let harness = Harness::start().await;
    let admin = Harness::admin_token();
    let from = register_camera(&harness.app, &admin, "CAM-1").await;

    // Self-loop.
    let response = harness
        .app
        .clone()
        .oneshot(authed(
            "POST",
            "/camera-edges",
            Some(&admin),
            Some(json!({
                "from": from,
                "to": from,
                "mean_travel_s": 600.0,
                "stddev_s": 60.0,
            })),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");

    // Non-positive travel mean.
    let response = harness
        .app
        .clone()
        .oneshot(authed(
            "POST",
            "/camera-edges",
            Some(&admin),
            Some(json!({
                "from": from,
                "to": Uuid::new_v4(),
                "mean_travel_s": 0.0,
                "stddev_s": 60.0,
            })),
        ))
        .await
        .expect("router responds");
    assert_eq!(body_json(response).await.0, StatusCode::UNPROCESSABLE_ENTITY);

    // Unknown camera endpoint.
    let response = harness
        .app
        .clone()
        .oneshot(authed(
            "POST",
            "/camera-edges",
            Some(&admin),
            Some(json!({
                "from": from,
                "to": Uuid::new_v4(),
                "mean_travel_s": 600.0,
                "stddev_s": 60.0,
            })),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(parsed["error"]["code"], "NOT_FOUND");

    // Rejected mutations audit nothing beyond the one registration.
    let rows = harness.audit.rows_for_case(&Uuid::nil());
    assert!(rows.iter().all(|row| row.action == "camera.register"));
}
