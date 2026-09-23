//! Case assignment endpoint tests (API_CONTRACTS.md §2.1, D21).
//!
//! Hermetic by convention: the handler runs against the in-memory
//! [`CaseStore`], [`UsersStore`] and [`AssignmentStore`] — no live
//! Postgres, [`FakeCaseTable`] standing in for [`crate::db::SagaDb`].
//! What the tests prove: admin-only gating, 201 on first assignment,
//! 200 with an updated role on re-assignment, 404 on unknown case or
//! user, one `case.assign` audit row per call, admin's unconditional
//! read grant (D37), and that cases/assignments survive a restart
//! (`Harness::restart` rehydrates fresh stores from the same durable
//! `case_table`, exactly like `main.rs`).

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::{json, Value};
use server::api::cases::{CaseTable, CasesDeps, router};
use server::api::search::{CaseRecord, CaseStore};
use server::audit::{Assignment, AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore, UserRecord, UsersStore};
use tower::ServiceExt;
use uuid::Uuid;

/// In-memory [`CaseTable`]: records durable writes without a database.
/// Method-for-method it mirrors the Postgres implementation on
/// `SagaDb` — a fake that drifts from that contract is a test bug.
#[derive(Debug, Default)]
struct FakeCaseTable {
    rows: std::sync::Mutex<Vec<(Uuid, String, String)>>,
    assignments: std::sync::Mutex<Vec<Assignment>>,
}

#[async_trait::async_trait]
impl CaseTable for FakeCaseTable {
    async fn insert_case_row(&self, id: &Uuid, case_code: &str, title: &str) -> Result<(), String> {
        self.rows
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push((*id, case_code.to_string(), title.to_string()));
        Ok(())
    }

    async fn all_cases(&self) -> Result<Vec<CaseRecord>, String> {
        Ok(self
            .rows
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .map(|(id, case_code, title)| CaseRecord {
                id: *id,
                case_code: case_code.clone(),
                title: title.clone(),
            })
            .collect())
    }

    async fn insert_assignment_row(
        &self,
        case_id: &Uuid,
        user_id: &Uuid,
        role: AppRole,
        _assigned_by: &Uuid,
    ) -> Result<(), String> {
        let mut guard = self.assignments.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        match guard.iter_mut().find(|a| &a.case_id == case_id && &a.user_id == user_id) {
            Some(existing) => existing.role = role,
            None => guard.push(Assignment { case_id: *case_id, user_id: *user_id, role }),
        }
        Ok(())
    }

    async fn all_assignments(&self) -> Result<Vec<Assignment>, String> {
        Ok(self.assignments.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone())
    }
}

struct Harness {
    app: axum::Router,
    audit: AuditStore,
    assignments: AssignmentStore,
    cases: CaseStore,
    users: UsersStore,
    case_table: std::sync::Arc<FakeCaseTable>,
}

impl Harness {
    async fn start() -> Self {
        let audit = AuditStore::default();
        let profiles = ProfilesStore::default();
        let users = UsersStore::default();
        let cases = CaseStore::default();
        let assignments = AssignmentStore::default();
        let case_table = std::sync::Arc::new(FakeCaseTable::default());
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
            case_table: case_table.clone(),
        });
        Self { app, audit, assignments, cases, users, case_table }
    }

    /// Simulates a server restart: fresh, empty `CaseStore`/
    /// `AssignmentStore`, rehydrated from the *same* durable
    /// `case_table` -- mirrors `main.rs`'s startup path exactly. Only
    /// what was actually written through the durable path survives;
    /// nothing else carries over (a fresh `UsersStore` included, since
    /// `main.rs` never persists that directory either).
    async fn restart(case_table: std::sync::Arc<FakeCaseTable>) -> Self {
        let audit = AuditStore::default();
        let profiles = ProfilesStore::default();
        let users = UsersStore::default();
        let cases = CaseStore::default();
        cases.replace_all(case_table.all_cases().await.expect("rehydrate cases"));
        let assignments = AssignmentStore::default();
        assignments.replace_all(case_table.all_assignments().await.expect("rehydrate assignments"));
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
            case_table: case_table.clone(),
        });
        Self { app, audit, assignments, cases, users, case_table }
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
async fn admin_creates_case_and_duplicate_code_conflicts() {
    let harness = Harness::start().await;
    let admin = Harness::admin_token();

    let response = harness
        .app
        .clone()
        .oneshot(post_request(
            "/cases".to_string(),
            &admin,
            json!({ "case_code": "CR-2026-017", "title": "Mumbai Theft Ring" }),
        ))
        .await
        .expect("router responds");
    let (status, created) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["case_code"], "CR-2026-017");
    // Dual-write: the durable row exists alongside the memory one, so a
    // later upload's foreign key resolves. The guard drops before the
    // next await (clippy `await_holding_lock`).
    let durable_len;
    let durable_code;
    {
        let durable = harness.case_table.rows.lock().expect("fake unlocks");
        durable_len = durable.len();
        durable_code = durable.first().map(|row| row.1.clone());
    }
    assert_eq!(durable_len, 1);
    assert_eq!(durable_code.as_deref(), Some("CR-2026-017"));

    // Duplicate code conflicts; blanks are rejected.
    let response = harness
        .app
        .clone()
        .oneshot(post_request(
            "/cases".to_string(),
            &admin,
            json!({ "case_code": "CR-2026-017", "title": "Anything else" }),
        ))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::CONFLICT);

    let response = harness
        .app
        .clone()
        .oneshot(post_request(
            "/cases".to_string(),
            &admin,
            json!({ "case_code": "  ", "title": "No code" }),
        ))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // Non-admin callers cannot open cases.
    let officer_token = support::mint_token(&Uuid::new_v4(), "io", 3600);
    let response = harness
        .app
        .oneshot(post_request(
            "/cases".to_string(),
            &officer_token,
            json!({ "case_code": "CR-2026-018", "title": "Denied" }),
        ))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn case_listing_and_detail_follow_assignment() {
    let harness = Harness::start().await;
    let admin = Harness::admin_token();
    let officer = harness.seed_user(AppRole::Io);
    let stranger = harness.seed_user(AppRole::Io);
    let officer_token = support::mint_token(&officer, "io", 3600);
    let stranger_token = support::mint_token(&stranger, "io", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(post_request(
            "/cases".to_string(),
            &admin,
            json!({ "case_code": "CR-2026-019", "title": "Listed case" }),
        ))
        .await
        .expect("router responds");
    let (_, created) = body_json(response).await;
    let case_id = created["id"].as_str().expect("case id").to_string();

    // Before assignment the officer sees nothing; the stranger never does.
    let response = harness
        .app
        .clone()
        .oneshot(get_request("/cases".to_string(), &officer_token))
        .await
        .expect("router responds");
    let (status, listed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed.as_array().expect("case array").len(), 0);

    // Admin assigns the officer (201, new row).
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

    // Now the officer lists one case and reads its detail with the roster.
    let response = harness
        .app
        .clone()
        .oneshot(get_request("/cases".to_string(), &officer_token))
        .await
        .expect("router responds");
    let (status, listed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let rows = listed.as_array().expect("case array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["case_code"], "CR-2026-019");

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/cases/{case_id}"), &officer_token))
        .await
        .expect("router responds");
    let (status, detail) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["case"]["title"], "Listed case");
    assert_eq!(detail["assignments"].as_array().expect("roster").len(), 1);

    // Stranger: 200-empty list, 403 detail. Unknown case: 404.
    let response = harness
        .app
        .clone()
        .oneshot(get_request("/cases".to_string(), &stranger_token))
        .await
        .expect("router responds");
    let (status, listed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed.as_array().expect("case array").len(), 0);

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/cases/{case_id}"), &stranger_token))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{}", Uuid::new_v4()), &officer_token))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn admin_reads_any_case_without_assignment() {
    // D37 amends D21: the administrator's read grant is unconditional.
    // `Harness::admin_token` mints a fresh admin identity with zero
    // `case_assignments` rows, so a 200 here proves the bypass rather
    // than a coincidence of also being assigned.
    let harness = Harness::start().await;
    let admin = Harness::admin_token();

    let response = harness
        .app
        .clone()
        .oneshot(post_request(
            "/cases".to_string(),
            &admin,
            json!({ "case_code": "CR-2026-020", "title": "Admin-visible case" }),
        ))
        .await
        .expect("router responds");
    let (_, created) = body_json(response).await;
    let case_id = created["id"].as_str().expect("case id").to_string();

    // Same admin token, never assigned, lists every case and reads detail.
    let response = harness
        .app
        .clone()
        .oneshot(get_request("/cases".to_string(), &admin))
        .await
        .expect("router responds");
    let (status, listed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let rows = listed.as_array().expect("case array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["case_code"], "CR-2026-020");

    let response = harness
        .app
        .clone()
        .oneshot(get_request(format!("/cases/{case_id}"), &admin))
        .await
        .expect("router responds");
    let (status, detail) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["case"]["title"], "Admin-visible case");

    // Existence still wins over the (now-bypassed) assignment check: a
    // nonexistent case is 404 for admin too, not a phantom 200.
    let response = harness
        .app
        .oneshot(get_request(format!("/cases/{}", Uuid::new_v4()), &admin))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
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

#[tokio::test]
async fn cases_and_assignments_survive_a_simulated_restart() {
    // Session request: the in-memory case/assignment state was wiped on
    // every server restart. This proves the fix end-to-end at the
    // hermetic level -- create a case and an assignment, throw away the
    // in-memory stores, rehydrate fresh ones from the same durable
    // case_table (exactly what main.rs does at startup), and confirm
    // the assigned officer still sees the case.
    let harness = Harness::start().await;
    let admin = Harness::admin_token();
    let officer = harness.seed_user(AppRole::Io);
    let officer_token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .clone()
        .oneshot(post_request(
            "/cases".to_string(),
            &admin,
            json!({ "case_code": "CR-2026-021", "title": "Restart-durability case" }),
        ))
        .await
        .expect("router responds");
    let (_, created) = body_json(response).await;
    let case_id = created["id"].as_str().expect("case id").to_string();

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

    let restarted = Harness::restart(harness.case_table.clone()).await;

    let response = restarted
        .app
        .oneshot(get_request("/cases".to_string(), &officer_token))
        .await
        .expect("router responds");
    let (status, listed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    let rows = listed.as_array().expect("case array");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["case_code"], "CR-2026-021");
}
