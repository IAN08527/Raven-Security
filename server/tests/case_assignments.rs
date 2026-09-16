//! Case assignment endpoint tests (API_CONTRACTS.md §2.1, D21).
//!
//! Hermetic by convention: the handler runs against the in-memory
//! [`CaseStore`], [`UsersStore`] and [`AssignmentStore`] — no live
//! Postgres. What the tests prove: admin-only gating, 201 on first
//! assignment, 200 with an updated role on re-assignment, 404 on
//! unknown case or user, and one `case.assign` audit row per call.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use server::api::cases::{CasesDeps, router};
use server::api::search::{CaseRecord, CaseStore};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore, UserRecord, UsersStore};
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    audit: AuditStore,
    assignments: AssignmentStore,
    cases: CaseStore,
    users: UsersStore,
}

impl Harness {
    async fn start() -> Self {
        let audit = AuditStore::default();
        let profiles = ProfilesStore::default();
        let users = UsersStore::default();
        let cases = CaseStore::default();
        let assignments = AssignmentStore::default();
        let auth = support::test_auth_cache();
        auth.set_user_directory(users.clone());
        let gateway = support::StubGateway::start().await;
        let app = router(CasesDeps {
            auth,
            ledger: gateway.client(),
            audit: audit.clone(),
            profiles,
            users: users.clone(),
            cases: cases.clone(),
            assignments: assignments.clone(),
        });
        Self { app, audit, assignments, cases, users }
    }

    fn seed_case(&self) -> Uuid {
        let id = Uuid::new_v4();
        self.cases.insert(CaseRecord {
            id,
            case_code: format!("CASE-{id}"),
            title: "Seized ledger network".to_string(),
        });
        id
    }

    fn seed_user(&self, role: AppRole) -> Uuid {
        let id = Uuid::new_v4();
        self.users.insert(UserRecord {
            id,
            email: format!("{id}@example.test"),
            badge_no: format!("MH-{id}"),
            full_name: "Test Officer".to_string(),
            role,
            active: true,
        });
        id
    }

    fn admin_token() -> String {
        support::mint_token(&Uuid::new_v4(), "admin", 3600)
    }
}

fn post_request(uri: String, token: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request builds")
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

#[tokio::test]
async fn admin_assigns_io_user_to_case() {
    let harness = Harness::start().await;
    let case_id = harness.seed_case();
    let officer = harness.seed_user(AppRole::Io);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/cases/{case_id}/assignments"),
            &Harness::admin_token(),
            json!({ "user_id": officer, "assigned_role": "io" }),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(parsed["case_id"], Value::from(case_id.to_string()));
    assert_eq!(parsed["user_id"], Value::from(officer.to_string()));
    assert_eq!(parsed["assigned_role"], Value::from("io"));
    assert!(harness.assignments.is_assigned(&case_id, &officer));
}

#[tokio::test]
async fn admin_reassigning_same_user_updates_role() {
    let harness = Harness::start().await;
    let case_id = harness.seed_case();
    let officer = harness.seed_user(AppRole::Io);
    let admin = Harness::admin_token();

    let response = harness
        .app
        .clone()
        .oneshot(post_request(
            format!("/cases/{case_id}/assignments"),
            &admin,
            json!({ "user_id": officer, "assigned_role": "io" }),
        ))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::CREATED);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/cases/{case_id}/assignments"),
            &admin,
            json!({ "user_id": officer, "assigned_role": "analyst" }),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["assigned_role"], Value::from("analyst"));
    // Still one assignment, not a duplicate row.
    assert_eq!(harness.assignments.cases_for_user(&officer), vec![case_id]);
}

#[tokio::test]
async fn non_admin_roles_are_denied() {
    for role in ["io", "analyst", "auditor"] {
        let harness = Harness::start().await;
        let case_id = harness.seed_case();
        let target = harness.seed_user(AppRole::Io);
        let caller = support::mint_token(&Uuid::new_v4(), role, 3600);

        let response = harness
            .app
            .oneshot(post_request(
                format!("/cases/{case_id}/assignments"),
                &caller,
                json!({ "user_id": target, "assigned_role": "io" }),
            ))
            .await
            .expect("router responds");
        let (status, parsed) = body_json(response).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} must not assign");
        assert_eq!(parsed["error"]["code"], Value::from("FORBIDDEN"));
    }
}

#[tokio::test]
async fn unknown_case_is_not_found() {
    let harness = Harness::start().await;
    let officer = harness.seed_user(AppRole::Io);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/cases/{}/assignments", Uuid::new_v4()),
            &Harness::admin_token(),
            json!({ "user_id": officer, "assigned_role": "io" }),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(parsed["error"]["code"], Value::from("NOT_FOUND"));
}

#[tokio::test]
async fn unknown_user_is_not_found() {
    let harness = Harness::start().await;
    let case_id = harness.seed_case();

    let response = harness
        .app
        .oneshot(post_request(
            format!("/cases/{case_id}/assignments"),
            &Harness::admin_token(),
            json!({ "user_id": Uuid::new_v4(), "assigned_role": "io" }),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(parsed["error"]["code"], Value::from("NOT_FOUND"));
}

#[tokio::test]
async fn assignment_writes_audit_row() {
    let harness = Harness::start().await;
    let case_id = harness.seed_case();
    let officer = harness.seed_user(AppRole::Io);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/cases/{case_id}/assignments"),
            &Harness::admin_token(),
            json!({ "user_id": officer, "assigned_role": "io" }),
        ))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::CREATED);

    let rows = harness.audit.rows_for_case(&case_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, "case.assign");
    assert_eq!(rows[0].object_id, officer.to_string());
}
