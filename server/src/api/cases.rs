//! Case assignment endpoint (API_CONTRACTS.md §2.1, D21).
//!
//! `POST /cases/{id}/assignments` assigns a managed user to a case.
//! Case assignment is an administrative act, not a user act (D21): the
//! caller must hold the admin role. The administrator separately has
//! unrestricted read access to every case's content (D37 amends D21),
//! but that grant is read-only — assignment stays the only way anyone
//! gains write/confirm capability on a case. Every assignment writes one
//! `case.assign` audit row before returning (rule 6).
//!
//! Upsert semantics mirror the production query (`INSERT INTO
//! case_assignments (case_id, user_id, assigned_role, assigned_by)
//! VALUES (...) ON CONFLICT (case_id, user_id) DO UPDATE SET
//! assigned_role = EXCLUDED.assigned_role`): re-assigning the same user
//! changes their role and answers 200, it never errors. Case rows are
//! dual-written to Postgres through the saga role (D33) so uploads can
//! reference them; the assignment join itself is still in-memory, so
//! per-case RLS reads remain the same documented follow-up as every
//! other store in this service.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::api::search::{CaseRecord, CaseStore};
use crate::audit::{record_action, Assignment, AssignmentStore, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore, UsersStore};
use crate::ledger::LedgerClient;

/// What `create_case`/`assign_user` need from Postgres: the `cases` row
/// must exist there before any `source_files` row can reference it
/// (`source_files_case_id_fkey`), and both cases and assignments must
/// be durable so the in-memory `CaseStore`/`AssignmentStore` (the live
/// cache every authorization check reads) can be rehydrated after a
/// restart instead of starting empty (session request). Same
/// hermetic-test convention as [`crate::api::files::SourceFileRepo`]:
/// handlers are generic over this trait, tests use an in-memory fake,
/// production passes [`crate::db::SagaDb`].
#[async_trait::async_trait]
pub trait CaseTable: Send + Sync {
    async fn insert_case_row(&self, id: &Uuid, case_code: &str, title: &str) -> Result<(), String>;

    /// Every case row, for rehydrating `CaseStore` at startup.
    async fn all_cases(&self) -> Result<Vec<CaseRecord>, String>;

    /// Durable write for `POST /cases/{id}/assignments`, mirroring
    /// `insert_case_row`'s role for case creation. Upsert semantics
    /// match the in-memory `AssignmentStore::upsert`: re-assigning the
    /// same user changes their role rather than erroring.
    async fn insert_assignment_row(
        &self,
        case_id: &Uuid,
        user_id: &Uuid,
        role: AppRole,
        assigned_by: &Uuid,
    ) -> Result<(), String>;

    /// Every assignment row, for rehydrating `AssignmentStore` at startup.
    async fn all_assignments(&self) -> Result<Vec<Assignment>, String>;
}

#[derive(Clone)]
pub struct CasesDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
    pub users: UsersStore,
    pub cases: CaseStore,
    pub assignments: AssignmentStore,
    pub case_table: std::sync::Arc<dyn CaseTable>,
}

#[derive(Clone)]
struct CasesState {
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
    users: UsersStore,
    cases: CaseStore,
    assignments: AssignmentStore,
    case_table: std::sync::Arc<dyn CaseTable>,
}

pub fn router(deps: CasesDeps) -> Router {
    let state = CasesState {
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
        users: deps.users,
        cases: deps.cases,
        assignments: deps.assignments,
        case_table: deps.case_table,
    };
    Router::new()
        .route("/cases", post(create_case).get(list_cases))
        .route("/cases/:id", get(read_case))
        .route("/cases/:id/assignments", post(assign_user))
        .with_state(state)
}

#[derive(Debug, Serialize, TS)]
pub(crate) struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize, TS)]
pub(crate) struct ErrorBody {
    code: &'static str,
    message: String,
    detail: serde_json::Value,
    retryable: bool,
    trace_id: String,
}

fn error(code: &'static str, status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(ErrorEnvelope {
            error: ErrorBody {
                code,
                message: message.into(),
                detail: serde_json::json!({}),
                retryable: false,
                trace_id: ulid::Ulid::new().to_string(),
            },
        }),
    )
        .into_response()
}

/// Case creation body (API_CONTRACTS.md §2.1). Admin role only: opening
/// a case is a platform act. The administrator has unrestricted read
/// access to the case content created inside it afterwards (D37 amends
/// D21), but not write/confirm capability.
#[derive(Debug, Deserialize, TS)]
pub struct CreateCaseRequest {
    pub case_code: String,
    pub title: String,
}

/// Case detail (API_CONTRACTS.md §2.1): the case plus its assignment
/// list. Assigned callers, plus the administrator unconditionally
/// (D37 amends D21).
#[derive(Debug, Serialize, TS)]
pub struct CaseDetailResponse {
    pub case: CaseRecord,
    pub assignments: Vec<AssignmentEntry>,
}

/// One assignment row as exposed on the case detail route.
#[derive(Debug, Serialize, TS)]
pub struct AssignmentEntry {
    pub user_id: Uuid,
    pub assigned_role: AppRole,
}

/// POST /cases (API_CONTRACTS.md §2.1): admin opens a case. Duplicate
/// `case_code` is 409; blanks are 422.
async fn create_case(
    State(state): State<CasesState>,
    headers: HeaderMap,
    Json(req): Json<CreateCaseRequest>,
) -> Response {
    let context = match authenticate_request(&headers, &state.auth, &[AppRole::Admin]).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let case_code = req.case_code.trim();
    let title = req.title.trim();
    if case_code.is_empty() {
        return error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, "case_code must be non-empty");
    }
    if title.is_empty() {
        return error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, "title must be non-empty");
    }
    if state.cases.find_by_code(case_code).is_some() {
        return error("CONFLICT", StatusCode::CONFLICT, format!("case_code already open: {case_code}"));
    }
    let record =
        CaseRecord { id: Uuid::new_v4(), case_code: case_code.to_string(), title: title.to_string() };
    // Postgres first: the durable row must exist before any source file
    // can reference it. A duplicate down here means the code survived a
    // restart in the database while memory was wiped — still a conflict.
    if let Err(detail) = state.case_table.insert_case_row(&record.id, &record.case_code, &record.title).await
    {
        if detail.contains("duplicate key") {
            return error("CONFLICT", StatusCode::CONFLICT, format!("case_code already open: {case_code}"));
        }
        return error("INTERNAL", StatusCode::INTERNAL_SERVER_ERROR, format!("case store unavailable: {detail}"));
    }
    state.cases.insert(record.clone());
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id: record.id,
            user_id: context.user_id,
            user_role: context.role,
            action: "case.create".to_string(),
            object_type: "case".to_string(),
            object_id: record.id.to_string(),
            payload_hash: record.id.to_string(),
        },
    )
    .await;
    (StatusCode::CREATED, Json(record)).into_response()
}

/// GET /cases (API_CONTRACTS.md §2.1): cases the caller is assigned to,
/// in case-code order. The administrator sees every case unconditionally
/// (D37 amends D21: admin has unrestricted read access to case content).
async fn list_cases(State(state): State<CasesState>, headers: HeaderMap) -> Response {
    let context = match authenticate_request(
        &headers,
        &state.auth,
        &[AppRole::Io, AppRole::Analyst, AppRole::Auditor, AppRole::Admin],
    )
    .await
    {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let mut rows = if context.role == AppRole::Admin {
        state.cases.all()
    } else {
        let mine = state.assignments.cases_for_user(&context.user_id);
        state.cases.visible(&mine.into_iter().collect())
    };
    rows.sort_by(|a, b| a.case_code.cmp(&b.case_code));
    (StatusCode::OK, Json(rows)).into_response()
}

/// GET /cases/{id} (API_CONTRACTS.md §2.1): case detail plus assignment
/// list. Unknown case is 404 before the assignment check ever runs
/// (`server/tests/case_assignments.rs` pins this ordering), so the
/// administrator's bypass below only skips the assignment check, never
/// the existence check.
async fn read_case(
    State(state): State<CasesState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
) -> Response {
    let context = match authorized_case_reader(&headers, &state).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let Some(case) = state.cases.find(&case_id) else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("case {case_id} not found"));
    };
    if context.role != AppRole::Admin && !state.assignments.is_assigned(&case_id, &context.user_id) {
        return error(
            "FORBIDDEN",
            StatusCode::FORBIDDEN,
            format!("no assignment for this user on case {case_id}"),
        );
    }
    let assignments = state
        .assignments
        .for_case(&case_id)
        .into_iter()
        .map(|a| AssignmentEntry { user_id: a.user_id, assigned_role: a.role })
        .collect();
    (StatusCode::OK, Json(CaseDetailResponse { case, assignments })).into_response()
}

/// Any case-content role authenticates, plus the administrator
/// unconditionally (D37 amends D21: admin has unrestricted read access to
/// case content). Assignment itself is checked per case by the caller,
/// which is where the administrator's bypass lives.
async fn authorized_case_reader(
    headers: &HeaderMap,
    state: &CasesState,
) -> Result<AuthContext, Box<Response>> {
    authenticate_request(
        headers,
        &state.auth,
        &[AppRole::Io, AppRole::Analyst, AppRole::Auditor, AppRole::Admin],
    )
    .await
}

/// Assignment body (API_CONTRACTS.md §2.1): who, and in what capacity.
/// `assigned_role` is an [`AppRole`], so an unknown role is a 422
/// deserialization failure, never a defaulted permission grant.
#[derive(Debug, Deserialize, TS)]
pub struct AssignUserRequest {
    pub user_id: Uuid,
    pub assigned_role: AppRole,
}

#[derive(Debug, Serialize, TS)]
pub struct AssignUserResponse {
    pub case_id: Uuid,
    pub user_id: Uuid,
    pub assigned_role: AppRole,
}

/// POST /cases/{id}/assignments (API_CONTRACTS.md §2.1): admin assigns
/// (or re-assigns) a user to a case. Unknown case or unknown user is
/// 404; a non-admin caller is 403 even when assigned to the case.
async fn assign_user(
    State(state): State<CasesState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Json(req): Json<AssignUserRequest>,
) -> Response {
    let context = match authenticate_request(&headers, &state.auth, &[AppRole::Admin]).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    if !state.cases.exists(&case_id) {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("case {case_id} not found"));
    }
    if state.users.get(&req.user_id).is_none() {
        return error(
            "NOT_FOUND",
            StatusCode::NOT_FOUND,
            format!("user {} not found", req.user_id),
        );
    }
    // Postgres first (D4), same as case creation: capture "was this
    // already assigned" before either write, since the durable insert
    // must not silently no-op on conflict and the in-memory store must
    // not move if the durable write fails (rule 9 -- a memory-only
    // assignment would look real until the next restart quietly
    // dropped it).
    let was_assigned = state.assignments.is_assigned(&case_id, &req.user_id);
    if let Err(detail) = state
        .case_table
        .insert_assignment_row(&case_id, &req.user_id, req.assigned_role, &context.user_id)
        .await
    {
        return error(
            "INTERNAL",
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("assignment store unavailable: {detail}"),
        );
    }
    state.assignments.upsert(case_id, req.user_id, req.assigned_role);
    let is_new = !was_assigned;
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id,
            user_id: context.user_id,
            user_role: context.role,
            action: "case.assign".to_string(),
            object_type: "case_assignment".to_string(),
            object_id: req.user_id.to_string(),
            payload_hash: req.user_id.to_string(),
        },
    )
    .await;
    let status = if is_new { StatusCode::CREATED } else { StatusCode::OK };
    (
        status,
        Json(AssignUserResponse { case_id, user_id: req.user_id, assigned_role: req.assigned_role }),
    )
        .into_response()
}
