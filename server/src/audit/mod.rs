//! Audit emitter (M5-T3, D21, FR-7.4/FR-7.5).
//!
//! Every confirm, reject, merge and evidence-access action lands here AND
//! attempts a ledger anchor through the gateway (API_CONTRACTS.md §5
//! `POST /action`, signed with the actor's ledger identity from
//! [`crate::auth::ProfilesStore`]). The two writes are recorded on one
//! row so the auditor view can show both together:
//!
//! - `ledger_tx_id = Some(..)`, `ledger_status = "anchored"`: anchored.
//! - `ledger_tx_id = None`, `ledger_status = "skipped_no_identity"`:
//!   the acting user has no `profiles.ledger_id` yet (the Fabric org is
//!   not configured for them). The action proceeds; a warning is logged.
//!   The attempt is recorded on the row, never silently skipped.
//! - `ledger_tx_id = None`, `ledger_status = "anchor_failed: .."`:
//!   the gateway was unreachable. The action still proceeds (a down
//!   ledger must not wedge casework) and the row says so, visibly.
//!
//! `created_at` is infrastructure audit time (`OffsetDateTime::now_utc`
//! is correct here per CLAUDE.md rule 3); case data timestamps are never
//! derived from it.

use std::sync::{Arc, Mutex, MutexGuard};

use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use time::OffsetDateTime;
use ts_rs::TS;
use uuid::Uuid;

use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::ledger::LedgerClient;

/// One audit row, mirroring the baseline `audit_log` columns plus the
/// ledger outcome fields the auditor view renders.
#[derive(Debug, Clone, Serialize, TS)]
pub struct AuditRow {
    pub id: Uuid,
    pub case_id: Uuid,
    pub user_id: Uuid,
    pub user_role: AppRole,
    pub action: String,
    pub object_type: String,
    pub object_id: String,
    pub payload_hash: String,
    pub ledger_tx_id: Option<String>,
    pub ledger_status: String,
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Default)]
pub struct AuditStore(Arc<Mutex<Vec<AuditRow>>>);

impl AuditStore {
    fn lock(&self) -> MutexGuard<'_, Vec<AuditRow>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn insert(&self, row: AuditRow) {
        self.lock().push(row);
    }

    pub fn rows_for_case(&self, case_id: &Uuid) -> Vec<AuditRow> {
        self.lock().iter().filter(|row| &row.case_id == case_id).cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.lock().is_empty()
    }
}

/// Case assignments (baseline `case_assignments`): who may see which
/// case, and in what capacity. This is the live, synchronous cache
/// every authorization check reads (`is_assigned` etc.); it now also
/// durably writes through `CaseTable::insert_assignment_row` on every
/// mutation and is rehydrated from Postgres at startup via
/// `CaseTable::all_assignments` (session request: this store must
/// survive a server restart), rather than a per-request live query --
/// that remains the same documented follow-up as every other store in
/// this service.
#[derive(Debug, Clone, Default)]
pub struct AssignmentStore(Arc<Mutex<Vec<Assignment>>>);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    pub case_id: Uuid,
    pub user_id: Uuid,
    pub role: AppRole,
}

impl AssignmentStore {
    fn lock(&self) -> MutexGuard<'_, Vec<Assignment>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn assign(&self, case_id: Uuid, user_id: Uuid, role: AppRole) {
        self.lock().push(Assignment { case_id, user_id, role });
    }

    /// Upsert one assignment (production SQL parity: `INSERT INTO
    /// case_assignments (case_id, user_id, assigned_role, assigned_by)
    /// VALUES (...) ON CONFLICT (case_id, user_id) DO UPDATE SET
    /// assigned_role = EXCLUDED.assigned_role`). Re-assigning changes
    /// the role, never errors. Returns true when the row is new (the
    /// handler answers 201) and false when an existing row was updated
    /// (the handler answers 200).
    pub fn upsert(&self, case_id: Uuid, user_id: Uuid, role: AppRole) -> bool {
        let mut guard = self.lock();
        match guard.iter_mut().find(|a| a.case_id == case_id && a.user_id == user_id) {
            Some(existing) => {
                existing.role = role;
                false
            }
            None => {
                guard.push(Assignment { case_id, user_id, role });
                true
            }
        }
    }

    pub fn is_assigned(&self, case_id: &Uuid, user_id: &Uuid) -> bool {
        self.lock().iter().any(|a| &a.case_id == case_id && &a.user_id == user_id)
    }

    pub fn cases_for_user(&self, user_id: &Uuid) -> Vec<Uuid> {
        let mut cases: Vec<Uuid> =
            self.lock().iter().filter(|a| &a.user_id == user_id).map(|a| a.case_id).collect();
        cases.sort();
        cases.dedup();
        cases
    }

    /// Assignments on one case, ordered by user id for stable responses.
    pub fn for_case(&self, case_id: &Uuid) -> Vec<Assignment> {
        let mut rows: Vec<Assignment> =
            self.lock().iter().filter(|a| &a.case_id == case_id).cloned().collect();
        rows.sort_by_key(|a| a.user_id);
        rows
    }

    /// Startup rehydration: replace the whole in-memory set with what
    /// Postgres has. Only ever called once, before the router starts
    /// serving requests.
    pub fn replace_all(&self, rows: Vec<Assignment>) {
        *self.lock() = rows;
    }
}

#[derive(Debug, Serialize, TS)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Serialize, TS)]
struct ErrorBody {
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

/// Shared case-content read gate (D37): the caller must hold one of
/// `allowed` roles AND, unless they are the administrator, be assigned
/// to `case_id`. The administrator's read grant is unconditional by
/// design (D37 amends D21) -- the assignment check is the only thing
/// this function skips for them; write/confirm routes never call this
/// helper and stay gated exactly as before. Callers pass their own
/// `allowed` list rather than a fixed one because not every case-content
/// route admits the same roles (`api::audit` still excludes the analyst
/// role, unrelated to this change).
pub async fn authenticate_case_reader(
    headers: &HeaderMap,
    cache: &JwksCache,
    assignments: &AssignmentStore,
    case_id: &Uuid,
    allowed: &[AppRole],
) -> Result<AuthContext, Box<Response>> {
    let context = authenticate_request(headers, cache, allowed).await?;
    if context.role != AppRole::Admin && !assignments.is_assigned(case_id, &context.user_id) {
        return Err(Box::new(
            error(
                "CASE_ACCESS_DENIED",
                StatusCode::FORBIDDEN,
                format!("no assignment for this user on case {case_id}"),
            )
            .into_response(),
        ));
    }
    Ok(context)
}

/// Stores [`record_action`] needs. Bundled so the call takes two
/// arguments instead of ten (`too_many_arguments`).
pub struct ActionDeps<'a> {
    pub audit: &'a AuditStore,
    pub ledger: &'a LedgerClient,
    pub profiles: &'a ProfilesStore,
}

/// One attributable action to record (see module docs for the ledger
/// outcome contract).
pub struct ActionRecord {
    pub case_id: Uuid,
    pub user_id: Uuid,
    pub user_role: AppRole,
    pub action: String,
    pub object_type: String,
    pub object_id: String,
    pub payload_hash: String,
}

/// Record one attributable action: write the audit row and attempt the
/// ledger anchor. Returns the row (handlers persist it via the store).
pub async fn record_action(deps: ActionDeps<'_>, record: ActionRecord) -> AuditRow {
    let (ledger_tx_id, ledger_status) = match deps.profiles.ledger_id(&record.user_id) {
        None => {
            tracing::warn!(
                user_id = %record.user_id,
                action = %record.action,
                object_id = %record.object_id,
                "ledger anchor skipped: acting user has no profiles.ledger_id (Fabric org not configured)"
            );
            (None, "skipped_no_identity".to_string())
        }
        Some(actor_ledger_id) => {
            match deps
                .ledger
                .action(
                    &record.action,
                    &record.payload_hash,
                    &record.object_id,
                    &record.case_id.to_string(),
                    &actor_ledger_id,
                )
                .await
            {
                Ok(receipt) => (Some(receipt.tx_id), "anchored".to_string()),
                Err(detail) => {
                    tracing::warn!(
                        user_id = %record.user_id,
                        action = %record.action,
                        object_id = %record.object_id,
                        detail = %detail,
                        "ledger anchor failed: gateway unreachable; action proceeds, row marked"
                    );
                    (None, format!("anchor_failed: {detail}"))
                }
            }
        }
    };
    let row = AuditRow {
        id: Uuid::new_v4(),
        case_id: record.case_id,
        user_id: record.user_id,
        user_role: record.user_role,
        action: record.action,
        object_type: record.object_type,
        object_id: record.object_id,
        payload_hash: record.payload_hash,
        ledger_tx_id,
        ledger_status,
        created_at: OffsetDateTime::now_utc(),
    };
    deps.audit.insert(row.clone());
    row
}
