//! Forensic auditor view endpoints (M5-T3, D21, FR-7.5).
//!
//! Read-only for the auditor role over assigned cases: row listing with
//! filters, CSV export of the filtered rows, and per-row ledger
//! verification showing both hashes plus `endorsements[]` (FR-7.2).
//! Tamper is shown as color AND label (design §34), and mock
//! endorsements render differently from real ones (D22).
//!
//! Access rule: the caller must be assigned to the case
//! (`CASE_ACCESS_DENIED` otherwise), and hold the auditor role or the
//! investigating-officer role. An io sees only cases they are assigned
//! to -- reading another officer's case audit log is denied and tested.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::audit::{AssignmentStore, AuditRow, AuditStore};
use crate::auth::{AppRole, AuthContext, JwksCache};
use crate::ledger::{Endorsement, LedgerClient};

#[derive(Clone)]
struct AuditState {
    audit: AuditStore,
    assignments: AssignmentStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
}

pub fn router(
    audit: AuditStore,
    assignments: AssignmentStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
) -> Router {
    let state = AuditState { audit, assignments, auth, ledger };
    Router::new()
        .route("/cases/:case_id/audit", get(list_audit))
        .route("/cases/:case_id/audit/export", get(export_audit))
        .route("/cases/:case_id/audit/:row_id/verify", get(verify_row))
        .with_state(state)
}

#[derive(Debug, Deserialize, Default)]
struct AuditFilter {
    from: Option<String>,
    to: Option<String>,
    user: Option<Uuid>,
    action: Option<String>,
    /// verified | tampered | pending. verified/tampered compare the live
    /// ledger hash against the row's payload hash; pending matches rows
    /// with no ledger anchor yet.
    tamper: Option<String>,
}

fn error(code: &'static str, status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(serde_json::json!({
            "error": {
                "code": code,
                "message": message.into(),
                "detail": {},
                "retryable": false,
                "trace_id": ulid::Ulid::new().to_string(),
            }
        })),
    )
        .into_response()
}

async fn authorize(
    headers: &HeaderMap,
    state: &AuditState,
    case_id: &Uuid,
) -> Result<AuthContext, Box<Response>> {
    let context = crate::auth::authenticate_request(
        headers,
        &state.auth,
        &[AppRole::Auditor, AppRole::Io],
    )
    .await?;
    if !state.assignments.is_assigned(case_id, &context.user_id) {
        return Err(Box::new(error(
            "CASE_ACCESS_DENIED",
            StatusCode::FORBIDDEN,
            format!("no assignment for this user on case {case_id}"),
        )));
    }
    Ok(context)
}

fn parse_time(value: &Option<String>) -> Result<Option<OffsetDateTime>, Box<Response>> {
    match value {
        None => Ok(None),
        Some(raw) => OffsetDateTime::parse(raw, &Rfc3339)
            .map(Some)
            .map_err(|_| Box::new(error("VALIDATION_FAILED", StatusCode::BAD_REQUEST, "from/to must be RFC 3339"))),
    }
}

fn static_filter(row: &AuditRow, filter: &AuditFilter, from: Option<OffsetDateTime>, to: Option<OffsetDateTime>) -> bool {
    if let Some(from) = from {
        if row.created_at < from {
            return false;
        }
    }
    if let Some(to) = to {
        if row.created_at > to {
            return false;
        }
    }
    if let Some(user) = filter.user {
        if row.user_id != user {
            return false;
        }
    }
    if let Some(action) = &filter.action {
        if &row.action != action {
            return false;
        }
    }
    true
}

/// GET /cases/{id}/audit (FR-7.5): filtered audit rows for one case.
async fn list_audit(
    State(state): State<AuditState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Query(filter): Query<AuditFilter>,
) -> Response {
    if let Err(response) = authorize(&headers, &state, &case_id).await {
        return *response;
    }
    let from = match parse_time(&filter.from) {
        Ok(value) => value,
        Err(boxed) => return *boxed,
    };
    let to = match parse_time(&filter.to) {
        Ok(value) => value,
        Err(boxed) => return *boxed,
    };
    let mut rows: Vec<AuditRow> = state
        .audit
        .rows_for_case(&case_id)
        .into_iter()
        .filter(|row| static_filter(row, &filter, from, to))
        .collect();
    if let Some(tamper) = filter.tamper.as_deref() {
        rows = apply_tamper_filter(&state.ledger, rows, tamper).await;
    }
    (StatusCode::OK, Json(rows)).into_response()
}

async fn apply_tamper_filter(
    ledger: &LedgerClient,
    rows: Vec<AuditRow>,
    tamper: &str,
) -> Vec<AuditRow> {
    let mut kept = Vec::new();
    for row in rows {
        let state = row_tamper_state(ledger, &row).await;
        let matches = match tamper {
            "pending" => state == "pending",
            "verified" => state == "verified",
            "tampered" => state == "tampered",
            _ => true,
        };
        if matches {
            kept.push(row);
        }
    }
    kept
}

async fn row_tamper_state(ledger: &LedgerClient, row: &AuditRow) -> &'static str {
    if row.ledger_tx_id.is_none() {
        return "pending";
    }
    match ledger.verify(&row.object_id).await {
        Ok(entry) if entry.hash == row.payload_hash => "verified",
        _ => "tampered",
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains([',', '"', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn rows_to_csv(rows: &[AuditRow]) -> String {
    let mut out = String::from(
        "timestamp,user_id,user_role,action,object_type,object_id,ledger_tx_id,ledger_status\n",
    );
    for row in rows {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{}\n",
            row.created_at.format(&Rfc3339).unwrap_or_default(),
            row.user_id,
            row.user_role.as_str(),
            csv_escape(&row.action),
            csv_escape(&row.object_type),
            csv_escape(&row.object_id),
            row.ledger_tx_id.as_deref().unwrap_or(""),
            csv_escape(&row.ledger_status),
        ));
    }
    out
}

/// GET /cases/{id}/audit/export: CSV of the filtered rows.
async fn export_audit(
    State(state): State<AuditState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Query(filter): Query<AuditFilter>,
) -> Response {
    if let Err(response) = authorize(&headers, &state, &case_id).await {
        return *response;
    }
    let from = match parse_time(&filter.from) {
        Ok(value) => value,
        Err(boxed) => return *boxed,
    };
    let to = match parse_time(&filter.to) {
        Ok(value) => value,
        Err(boxed) => return *boxed,
    };
    let mut rows: Vec<AuditRow> = state
        .audit
        .rows_for_case(&case_id)
        .into_iter()
        .filter(|row| static_filter(row, &filter, from, to))
        .collect();
    if let Some(tamper) = filter.tamper.as_deref() {
        rows = apply_tamper_filter(&state.ledger, rows, tamper).await;
    }
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/csv")],
        rows_to_csv(&rows),
    )
        .into_response()
}

#[derive(Debug, Serialize)]
struct VerifyRowResponse {
    row_id: Uuid,
    object_id: String,
    stored_hash: String,
    ledger_hash: Option<String>,
    tampered: bool,
    endorsements: Vec<Endorsement>,
    ledger_tx_id: Option<String>,
}

/// GET /cases/{id}/audit/{row_id}/verify (FR-7.2): recompute the
/// comparison the auditor view's Verify button shows -- both hashes and
/// the endorsements that signed the ledger entry.
async fn verify_row(
    State(state): State<AuditState>,
    headers: HeaderMap,
    Path((case_id, row_id)): Path<(Uuid, Uuid)>,
) -> Response {
    if let Err(response) = authorize(&headers, &state, &case_id).await {
        return *response;
    }
    let Some(row) = state
        .audit
        .rows_for_case(&case_id)
        .into_iter()
        .find(|row| row.id == row_id)
    else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("audit row {row_id} not found"));
    };
    if row.ledger_tx_id.is_none() {
        return (
            StatusCode::OK,
            Json(VerifyRowResponse {
                row_id,
                object_id: row.object_id,
                stored_hash: row.payload_hash,
                ledger_hash: None,
                tampered: false,
                endorsements: Vec::new(),
                ledger_tx_id: None,
            }),
        )
            .into_response();
    }
    match state.ledger.verify(&row.object_id).await {
        Ok(entry) => (
            StatusCode::OK,
            Json(VerifyRowResponse {
                row_id,
                object_id: row.object_id,
                stored_hash: row.payload_hash.clone(),
                tampered: entry.hash != row.payload_hash,
                ledger_hash: Some(entry.hash),
                endorsements: entry.endorsements,
                ledger_tx_id: Some(entry.tx_id),
            }),
        )
            .into_response(),
        Err(detail) => error("LEDGER_UNAVAILABLE", StatusCode::BAD_GATEWAY, detail),
    }
}
