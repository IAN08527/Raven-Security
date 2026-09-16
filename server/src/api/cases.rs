//! Case assignment endpoint (API_CONTRACTS.md §2.1, D21).
//!
//! `POST /cases/{id}/assignments` assigns a managed user to a case.
//! Case assignment is an administrative act, not a user act (D21): the
//! caller must hold the admin role, and the administrator still has no
//! read access to case content — this route writes the join row, it
//! does not expose the case. Every assignment writes one `case.assign`
//! audit row before returning (rule 6).
//!
//! Upsert semantics mirror the production query (`INSERT INTO
//! case_assignments (case_id, user_id, assigned_role, assigned_by)
//! VALUES (...) ON CONFLICT (case_id, user_id) DO UPDATE SET
//! assigned_role = EXCLUDED.assigned_role`): re-assigning the same user
//! changes their role and answers 200, it never errors. Real
//! persistence through `cases`/`case_assignments` with per-case RLS is
//! the same documented follow-up as every other store in this service.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::api::search::CaseStore;
use crate::audit::{record_action, AssignmentStore, AuditStore};
use crate::auth::{authenticate_request, AppRole, JwksCache, ProfilesStore, UsersStore};
use crate::ledger::LedgerClient;

#[derive(Clone)]
pub struct CasesDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
    pub users: UsersStore,
    pub cases: CaseStore,
    pub assignments: AssignmentStore,
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
    };
    Router::new().route("/cases/:id/assignments", post(assign_user)).with_state(state)
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
    let is_new = state.assignments.upsert(case_id, req.user_id, req.assigned_role);
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
