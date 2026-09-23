//! Review queue endpoints (M3-6, FR-2.7, D9 transferred from M2).
//!
//! Rule 1 applies to recognised text exactly as it does to Re-ID
//! candidates: a transcription is a candidate until a person resolves it
//! through `POST /review/{id}` -- the ONLY path that changes a review
//! status. There is no auto-accept path, no bulk-approve, no timeout that
//! flips pending rows on its own. Corrected, accepted and rejected rows
//! all remain visible as audit evidence; nothing is hidden.
//!
//! Auth is real GoTrue JWT verification plus the io-only role gate
//! (M5-T1/T3, D21 -- same discipline as `reid.rs decide_candidate`),
//! and stores are in-memory -- with the same documented follow-up
//! (real persistence through the baseline `review_items` table with
//! per-case RLS). The stub carries `case_id` on the item so the
//! case-scoped listing works; real persistence joins through
//! `source_files` instead (the baseline table has no `case_id` column).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use ts_rs::TS;
use uuid::Uuid;

use crate::audit::{record_action, AuditStore};
use crate::auth::{authenticate_io, authenticate_request, AppRole, JwksCache, ProfilesStore};
use crate::ledger::LedgerClient;

/// Baseline `review_status`: pending → corrected | accepted | rejected.
/// `Pending` is the only status any path other than `decide_review`
/// constructs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum ReviewStatus {
    Pending,
    Corrected,
    Accepted,
    Rejected,
}

/// One queue row, mirroring the baseline `review_items` columns plus the
/// stub-only `case_id` (see module docs).
#[derive(Debug, Clone, Serialize, TS)]
pub struct ReviewItem {
    // Wire integers are JSON numbers (see entities.rs MergeProposal).
    #[ts(type = "number")]
    pub id: i64,
    pub case_id: Uuid,
    pub source_file_id: Uuid,
    pub page_no: Option<i32>,
    pub line_no: Option<i32>,
    pub field_name: Option<String>,
    pub script: String,
    pub crop_path: String,
    pub recognised_text: Option<String>,
    pub confidence: Option<f32>,
    pub corrected_text: Option<String>,
    pub status: ReviewStatus,
    pub reviewed_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    #[ts(type = "string | null")]
    pub reviewed_at: Option<OffsetDateTime>,
    pub ledger_tx_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ReviewStore(Arc<Mutex<Vec<ReviewItem>>>);

impl ReviewStore {
    fn lock(&self) -> MutexGuard<'_, Vec<ReviewItem>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Inserts a pipeline queue entry. The caller supplies the
    /// fully-populated row including its stated reason upstream (the
    /// reason travels in the docs-lane `ReviewItem`, not this stub);
    /// this does not default anything except `status`, which must
    /// already be `Pending`.
    pub fn insert(&self, item: ReviewItem) {
        debug_assert_eq!(item.status, ReviewStatus::Pending);
        self.lock().push(item);
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.lock().is_empty()
    }
}

#[derive(Debug, Deserialize, TS)]
pub struct DecideReviewRequest {
    pub corrected_text: Option<String>,
    pub status: TerminalStatus,
}

/// Only terminal statuses are reachable through the decide endpoint: there
/// is no transition back to `pending`, so `Pending` has no variant here
/// and sending `"pending"` fails deserialization (422).
#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq, TS)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Corrected,
    Accepted,
    Rejected,
}

#[derive(Debug, Serialize, TS)]
pub struct DecideReviewResponse {
    #[ts(type = "number")]
    pub id: i64,
    pub status: ReviewStatus,
    pub ledger_tx_id: Option<String>,
    pub ledger_status: String,
}

/// Preview-extraction DTOs (D29, API_CONTRACTS.md §2.3). `type` is a
/// Rust keyword, so the field is `surface_type` renamed on the wire
/// (same pattern as the graph module's `typ`).
#[derive(Debug, Deserialize, TS)]
pub struct PreviewSurface {
    #[serde(rename = "type")]
    pub surface_type: String,
    pub value: String,
}

#[derive(Debug, Deserialize, TS)]
pub struct PreviewExtractionRequest {
    pub text: String,
    pub surfaces: Vec<PreviewSurface>,
}

#[derive(Debug, Serialize, TS)]
pub struct PreviewSpan {
    #[serde(rename = "type")]
    pub surface_type: String,
    pub value: String,
    // Wire integers are JSON numbers (see entities.rs MergeProposal).
    #[ts(type = "number | null")]
    pub char_start: Option<i64>,
    #[ts(type = "number | null")]
    pub char_end: Option<i64>,
    pub found: bool,
}

/// Deterministic surface-then-resolve (D11-A), ported from the docs-lane
/// reference implementation (`docs-lane/schemas.py`
/// `SpanResolver.resolve`): the caller identifies surfaces, this finds
/// offsets via substring search with occurrence-index disambiguation, so
/// duplicate values resolve to successive occurrences in surface order.
/// Unfound (or empty) surfaces return `found: false` with null spans --
/// never an error (rule 9).
///
/// Offsets are CHARACTER indices, not bytes: `str::find` yields byte
/// positions, converted here, because byte offsets into non-ASCII
/// review text (Hindi, Marathi) would point at wrong spans.
///
/// NOTE (mechanism): D29 pictures the server calling the document
/// lane's SpanResolver over HTTP, but the lane serves no HTTP yet (its
/// service is a documented follow-up; the saga still stubs its client
/// trait). This port keeps the endpoint's contract -- request, response,
/// audit row -- identical for that future move; only the call target
/// changes.
fn resolve_spans(text: &str, surfaces: &[PreviewSurface]) -> Vec<PreviewSpan> {
    // Next byte offset to search from, per distinct surface value:
    // each duplicate advances past the previously claimed occurrence.
    let mut next_offset: HashMap<&str, usize> = HashMap::new();
    surfaces
        .iter()
        .map(|surface| {
            let value = surface.value.as_str();
            let start_from = next_offset.get(value).copied().unwrap_or(0);
            let found = if value.is_empty() {
                None
            } else {
                text.get(start_from..)
                    .and_then(|tail| tail.find(value))
                    .map(|rel| start_from + rel)
            };
            match found {
                Some(byte_start) => {
                    let char_start = text[..byte_start].chars().count();
                    let char_end = char_start + value.chars().count();
                    next_offset.insert(value, byte_start + value.len());
                    PreviewSpan {
                        surface_type: surface.surface_type.clone(),
                        value: surface.value.clone(),
                        char_start: Some(char_start as i64),
                        char_end: Some(char_end as i64),
                        found: true,
                    }
                }
                None => PreviewSpan {
                    surface_type: surface.surface_type.clone(),
                    value: surface.value.clone(),
                    char_start: None,
                    char_end: None,
                    found: false,
                },
            }
        })
        .collect()
}

#[derive(Debug, Deserialize)]
struct ListReviewQuery {
    status: Option<ReviewStatus>,
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

fn error(code: &'static str, status: StatusCode, message: impl Into<String>) -> impl IntoResponse {
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
}

/// Whether extraction may auto-commit text from `script` without human
/// review (API_CONTRACTS.md §2.3, FR-2.6). `Err("SCRIPT_NOT_GATED")` until
/// S3 publishes the per-script status table and the script is on it.
///
/// M4 hook: the extraction-commit path (ingest saga step 9) calls this
/// before creating entities from machine text. Nothing calls it yet --
/// human review through `decide_review` below is always legitimate and
/// goes through no gate -- so it is `dead_code` until M4 wires its
/// caller. It exists, tested, so M4 uses this code instead of
/// reinventing it.
#[allow(dead_code)]
pub fn extraction_may_autocommit(
    script: &str,
    gated_scripts: &HashSet<String>,
) -> Result<(), &'static str> {
    if gated_scripts.contains(script) {
        Ok(())
    } else {
        Err("SCRIPT_NOT_GATED")
    }
}

#[derive(Clone)]
struct ReviewState {
    reviews: ReviewStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    profiles: ProfilesStore,
}

/// M5 attribution dependencies shared with `reid.rs` (D21).
#[derive(Clone)]
pub struct ReviewDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub profiles: ProfilesStore,
}

pub fn router(reviews: ReviewStore, deps: ReviewDeps) -> Router {
    let state = ReviewState {
        reviews,
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        profiles: deps.profiles,
    };
    Router::new()
        .route("/cases/:case_id/review", get(list_reviews))
        .route("/review/:id", post(decide_review))
        .route("/cases/:case_id/preview-extraction", post(preview_extraction))
        .with_state(state)
}

/// GET /cases/{id}/review?status= (API_CONTRACTS.md §2.3, FR-2.7): the
/// reviewer's worklist. Every status stays listed -- filtering a decided
/// row out of existence would hide the decision record.
async fn list_reviews(
    State(state): State<ReviewState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Query(query): Query<ListReviewQuery>,
) -> impl IntoResponse {
    // Verified identity (any case role may read the queue; assignment
    // enforcement lives on the audit endpoints and, with real
    // persistence, in RLS). Admin included unconditionally (D37 amends
    // D21); decide_review below stays io-only, untouched.
    if let Err(boxed) = authenticate_request(
        &headers,
        &state.auth,
        &[AppRole::Io, AppRole::Analyst, AppRole::Auditor, AppRole::Admin],
    )
    .await
    {
        return *boxed;
    }
    let reviews = state.reviews.lock();
    let filtered: Vec<ReviewItem> = reviews
        .iter()
        .filter(|item| item.case_id == case_id)
        .filter(|item| match query.status {
            None => true,
            Some(status) => item.status == status,
        })
        .cloned()
        .collect();
    (StatusCode::OK, Json(filtered)).into_response()
}

/// POST /review/{id} (API_CONTRACTS.md §2.3): the ONLY path that changes
/// (rule 1). Accepts `corrected` (with the human's transcription),
/// `accepted` (machine text confirmed as-is), or `rejected`, records who
/// decided and when (`reviewed_at` is infrastructure audit time; the
/// sighting's own data is untouched), and anchors via the ledger gateway
/// (mock path until per-request identity wiring lands -- see `reid.rs`).
async fn decide_review(
    State(state): State<ReviewState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<DecideReviewRequest>,
) -> impl IntoResponse {
    // M5-T1/T3: verified GoTrue identity, io role only (rule 1 --
    // transcription is a candidate until a person resolves it).
    let reviewer = match authenticate_io(&headers, &state.auth).await {
        Ok(user_id) => user_id,
        Err(boxed) => return *boxed,
    };
    // Single terminal-status construction site (rule 1): grep for
    // `ReviewStatus::Corrected` etc. must return exactly this match plus
    // the enum definition and tests.
    let status = match req.status {
        TerminalStatus::Corrected => ReviewStatus::Corrected,
        TerminalStatus::Accepted => ReviewStatus::Accepted,
        TerminalStatus::Rejected => ReviewStatus::Rejected,
    };
    let corrected_text =
        if req.status == TerminalStatus::Corrected { req.corrected_text } else { None };
    let case_id = {
        let mut reviews = state.reviews.lock();
        let Some(item) = reviews.iter_mut().find(|item| item.id == id) else {
            return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("review {id} not found"))
                .into_response();
        };
        if item.status != ReviewStatus::Pending {
            return error(
                "CONFLICT",
                StatusCode::CONFLICT,
                format!("review {id} already decided"),
            )
            .into_response();
        }
        item.status = status;
        item.corrected_text = corrected_text;
        item.reviewed_by = Some(reviewer);
        // Infrastructure audit time, not case data (rule 3).
        item.reviewed_at = Some(OffsetDateTime::now_utc());
        item.case_id
    };
    // Attributable anchor (D21, FR-7.4), mirroring `decide_candidate`.
    let review_digest = {
        let mut hasher = Sha256::new();
        hasher.update(id.to_be_bytes());
        hasher.update(format!("{status:?}").as_bytes());
        hasher.update(reviewer.as_bytes());
        hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect::<String>()
    };
    let row = record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id,
            user_id: reviewer,
            user_role: AppRole::Io,
            action: match status {
                ReviewStatus::Corrected => "review.correct".to_string(),
                ReviewStatus::Accepted => "review.accept".to_string(),
                ReviewStatus::Rejected => "review.reject".to_string(),
                ReviewStatus::Pending => "review.decide".to_string(),
            },
            object_type: "review_item".to_string(),
            object_id: id.to_string(),
            payload_hash: review_digest,
        },
    )
    .await;
    {
        let mut reviews = state.reviews.lock();
        if let Some(item) = reviews.iter_mut().find(|item| item.id == id) {
            item.ledger_tx_id = row.ledger_tx_id.clone();
        }
    }
    let response = DecideReviewResponse {
        id,
        status,
        ledger_tx_id: row.ledger_tx_id,
        ledger_status: row.ledger_status,
    };
    (StatusCode::OK, Json(response)).into_response()
}

/// POST /cases/{id}/preview-extraction (D29, API_CONTRACTS.md §2.3):
/// io role only (the auditor is read-only, the analyst views). Resolves
/// caller-supplied surfaces against the supplied text and returns spans.
/// No model call, no persistence -- nothing is read from or written to
/// any table. The ONLY write is the `preview.extraction` audit row
/// (API_CONTRACTS.md rule 6), so the preview itself is attributable.
async fn preview_extraction(
    State(state): State<ReviewState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    Json(req): Json<PreviewExtractionRequest>,
) -> impl IntoResponse {
    let reviewer = match authenticate_io(&headers, &state.auth).await {
        Ok(user_id) => user_id,
        Err(boxed) => return *boxed,
    };
    let spans = resolve_spans(&req.text, &req.surfaces);
    let mut hasher = Sha256::new();
    hasher.update(req.text.as_bytes());
    for surface in &req.surfaces {
        hasher.update(surface.surface_type.as_bytes());
        hasher.update(surface.value.as_bytes());
    }
    let digest: String =
        hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id,
            user_id: reviewer,
            user_role: AppRole::Io,
            action: "preview.extraction".to_string(),
            object_type: "preview_extraction".to_string(),
            object_id: digest.clone(),
            payload_hash: digest,
        },
    )
    .await;
    (StatusCode::OK, Json(spans)).into_response()
}
