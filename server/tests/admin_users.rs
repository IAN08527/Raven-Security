//! User administration endpoint tests (API_CONTRACTS.md §2.11, D21).
//!
//! - Admin lists, creates and deactivates; deactivation is not deletion.
//! - Non-admin roles get 403 on every admin route.
//! - A deactivated user's bearer token is rejected at verification (401)
//!   on every endpoint — deactivation locks the account, not labels it.
//! - Duplicate email is 409; unknown role is 422; unknown id is 404.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use server::api::admin::{AdminDeps, router};
use server::audit::AuditStore;
use server::auth::{ProfilesStore, UsersStore};
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    _gateway: support::StubGateway,
}

impl Harness {
    async fn start() -> Self {
        let audit = AuditStore::default();
        let profiles = ProfilesStore::default();
        let users = UsersStore::default();
        let auth = support::test_auth_cache();
        auth.set_user_directory(users.clone());
        let gateway = support::StubGateway::start().await;
        let app = router(AdminDeps {
            auth,
            ledger: gateway.client(),
            audit,
            profiles,
            users,
        });
        Self { app, _gateway: gateway }
    }

    fn admin_token(&self) -> String {
        support::mint_token(&Uuid::new_v4(), "admin", 3600)
    }
}

fn authed(method: &str, uri: String, token: &str, body: Option<Value>) -> Request<Body> {
    let builder =
        Request::builder().method(method).uri(uri).header("authorization", format!("Bearer {token}"));
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
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

fn create_body(email: &str) -> Value {
    json!({
        // The directory id is the GoTrue sub: assignment checks and the
        // deactivation overlay look users up by the JWT subject, so a
        // row with any other id would match nothing.
        "id": Uuid::new_v4(),
        "email": email,
        "badge_no": "MH-0421",
        "full_name": "Test Officer",
        "role": "io",
    })
}

#[tokio::test]
async fn admin_can_list_create_and_deactivate_without_deleting() {
    let harness = Harness::start().await;
    let admin = harness.admin_token();

    let response = harness
        .app
        .clone()
        .oneshot(authed("POST", "/admin/users".to_string(), &admin, Some(create_body("io@example.test"))))
        .await
        .expect("router responds");
    let (status, created) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["active"], true);
    let user_id = created["id"].as_str().expect("user id").to_string();

    let response = harness
        .app
        .clone()
        .oneshot(authed("GET", "/admin/users".to_string(), &admin, None))
        .await
        .expect("router responds");
    let (status, listed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed.as_array().expect("user array").len(), 1);

    let response = harness
        .app
        .clone()
        .oneshot(authed(
            "PATCH",
            format!("/admin/users/{user_id}"),
            &admin,
            Some(json!({ "active": false })),
        ))
        .await
        .expect("router responds");
    let (status, patched) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(patched["active"], false);

    // Deactivation is not deletion: the row survives with active=false.
    let response = harness
        .app
        .oneshot(authed("GET", "/admin/users".to_string(), &admin, None))
        .await
        .expect("router responds");
    let (status, listed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let rows = listed.as_array().expect("user array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["active"], false);
}

#[tokio::test]
async fn non_admin_roles_are_denied_every_admin_route() {
    let harness = Harness::start().await;
    let officer = support::mint_token(&Uuid::new_v4(), "io", 3600);

    for (method, uri, body) in [
        ("GET", "/admin/users".to_string(), None),
        ("POST", "/admin/users".to_string(), Some(create_body("x@example.test"))),
        ("PATCH", format!("/admin/users/{}", Uuid::new_v4()), Some(json!({ "active": false }))),
    ] {
        let response = harness
            .app
            .clone()
            .oneshot(authed(method, uri, &officer, body))
            .await
            .expect("router responds");
        let (status, parsed) = body_json(response).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "non-admin denied on {method}");
        assert_eq!(parsed["error"]["code"], "FORBIDDEN");
    }
}

#[tokio::test]
async fn deactivated_user_token_is_rejected_at_verification() {
    let harness = Harness::start().await;
    let admin = harness.admin_token();

    let response = harness
        .app
        .clone()
        .oneshot(authed("POST", "/admin/users".to_string(), &admin, Some(create_body("gone@example.test"))))
        .await
        .expect("router responds");
    let (_, created) = body_json(response).await;
    let user_id = Uuid::parse_str(created["id"].as_str().expect("user id")).expect("uuid");

    let response = harness
        .app
        .clone()
        .oneshot(authed(
            "PATCH",
            format!("/admin/users/{user_id}"),
            &admin,
            Some(json!({ "active": false })),
        ))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::OK);

    // The deactivated user's own token no longer authenticates anywhere.
    let dead_token = support::mint_token(&user_id, "io", 3600);
    let response = harness
        .app
        .oneshot(authed("GET", "/admin/users".to_string(), &dead_token, None))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(parsed["error"]["code"], "UNAUTHENTICATED");
}

#[tokio::test]
async fn duplicate_email_unknown_role_and_unknown_id_are_rejected() {
    let harness = Harness::start().await;
    let admin = harness.admin_token();

    let response = harness
        .app
        .clone()
        .oneshot(authed("POST", "/admin/users".to_string(), &admin, Some(create_body("dup@example.test"))))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::CREATED);

    let response = harness
        .app
        .clone()
        .oneshot(authed("POST", "/admin/users".to_string(), &admin, Some(create_body("dup@example.test"))))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(parsed["error"]["code"], "CONFLICT");

    // Nil and already-managed ids are rejected, never defaulted.
    let mut nil_id = create_body("nil@example.test");
    nil_id["id"] = json!(Uuid::nil());
    let response = harness
        .app
        .clone()
        .oneshot(authed("POST", "/admin/users".to_string(), &admin, Some(nil_id)))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");

    let mut bad_role = create_body("new@example.test");
    bad_role["role"] = json!("superuser");
    let response = harness
        .app
        .clone()
        .oneshot(authed("POST", "/admin/users".to_string(), &admin, Some(bad_role)))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], "VALIDATION_FAILED");

    let response = harness
        .app
        .oneshot(authed(
            "PATCH",
            format!("/admin/users/{}", Uuid::new_v4()),
            &admin,
            Some(json!({ "active": false })),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(parsed["error"]["code"], "NOT_FOUND");
}
