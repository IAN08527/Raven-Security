//! User administration endpoints (API_CONTRACTS.md §2.11, D21, FR-8).
//!
//! Admin role only on every route: the administrator manages accounts
//! without read access to case content, so these routes are
//! platform-scoped (no case id, no assignment check) and their audit
//! rows carry the nil UUID as `case_id` rather than inventing a case.
//!
//! There is deliberately no DELETE: deactivation flips `active` and the
//! row — with every audit row referencing the user — survives. A bearer
//! token for a deactivated user is rejected at verification
//! (`JwksCache` directory overlay), so deactivation locks the account on
//! every endpoint with no per-handler check to forget.
//!
//! Production creates the matching `auth.users` entry through the GoTrue
//! admin API; the in-memory directory records the admin's intent until
//! that wiring lands (same documented follow-up as every store here).

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::audit::{record_action, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore, UserRecord, UsersStore};
use crate::ledger::LedgerClient;

#[derive(Clone)]
pub struct AdminDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
    pub users: UsersStore,
}

#[derive(Clone)]
struct AdminState {
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
    users: UsersStore,
}

pub fn router(deps: AdminDeps) -> Router {
    let state = AdminState {
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
        users: deps.users,
    };
    Router::new()
        .route("/admin/users", get(list_users).post(create_user))
        .route("/admin/users/:id", patch(deactivate_user))
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

/// Platform scope has no case: audit rows for admin actions carry the
/// nil UUID, stated here once rather than hidden per call site.
fn platform_case() -> Uuid {
    Uuid::nil()
}

async fn authorize_admin(
    headers: &HeaderMap,
    state: &AdminState,
) -> Result<AuthContext, Box<Response>> {
    authenticate_request(headers, &state.auth, &[AppRole::Admin]).await
}

async fn anchor_admin(
    state: &AdminState,
    context: &AuthContext,
    action: &str,
    user_id: &Uuid,
) {
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id: platform_case(),
            user_id: context.user_id,
            user_role: context.role,
            action: action.to_string(),
            object_type: "managed_user".to_string(),
            object_id: user_id.to_string(),
            payload_hash: user_id.to_string(),
        },
    )
    .await;
}

/// GET /admin/users: every managed user with role and active status.
async fn list_users(State(state): State<AdminState>, headers: HeaderMap) -> Response {
    let context = match authorize_admin(&headers, &state).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    anchor_admin(&state, &context, "users.list", &context.user_id).await;
    (StatusCode::OK, Json(state.users.list())).into_response()
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateUserRequest {
    pub email: String,
    pub badge_no: String,
    pub full_name: String,
    pub role: String,
}

/// POST /admin/users: create a managed user. Production additionally
/// creates the `auth.users` entry through the GoTrue admin API; here the
/// directory row is the record of that intent.
async fn create_user(
    State(state): State<AdminState>,
    headers: HeaderMap,
    Json(req): Json<CreateUserRequest>,
) -> Response {
    let context = match authorize_admin(&headers, &state).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let email = req.email.trim();
    if email.is_empty() || !email.contains('@') {
        return error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, "email must be a non-empty address");
    }
    if req.badge_no.trim().is_empty() {
        return error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, "badge_no must be non-empty");
    }
    if req.full_name.trim().is_empty() {
        return error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, "full_name must be non-empty");
    }
    let Some(role) = AppRole::parse(&req.role) else {
        return error(
            "VALIDATION_FAILED",
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("unknown role: {}", req.role),
        );
    };
    if state.users.email_taken(email) {
        return error("CONFLICT", StatusCode::CONFLICT, format!("email already managed: {email}"));
    }
    let record = UserRecord {
        id: Uuid::new_v4(),
        email: email.to_string(),
        badge_no: req.badge_no.trim().to_string(),
        full_name: req.full_name.trim().to_string(),
        role,
        active: true,
    };
    state.users.insert(record.clone());
    anchor_admin(&state, &context, "users.create", &record.id).await;
    (StatusCode::CREATED, Json(record)).into_response()
}

#[derive(Debug, Deserialize, TS)]
pub struct DeactivateUserRequest {
    pub active: bool,
}

/// PATCH /admin/users/{id}: flip `active`. Deactivation, never deletion:
/// the row and its audit trail survive, and the directory overlay at
/// verification rejects the user's tokens from this call on.
async fn deactivate_user(
    State(state): State<AdminState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<DeactivateUserRequest>,
) -> Response {
    let context = match authorize_admin(&headers, &state).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    if !state.users.set_active(&id, req.active) {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("managed user {id} not found"));
    }
    anchor_admin(&state, &context, "users.deactivate", &id).await;
    let Some(record) = state.users.get(&id) else {
        return error("INTERNAL", StatusCode::INTERNAL_SERVER_ERROR, "user vanished after update");
    };
    (StatusCode::OK, Json(record)).into_response()
}
