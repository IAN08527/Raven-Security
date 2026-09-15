//! File record and verification endpoints (FR-7.2, API_CONTRACTS.md §2.2).
//!
//! Auth→audit→anchor (M5-T3, D21), mirroring `audit.rs` for the access
//! rule: any assigned role (io, analyst, auditor) may read, but the caller
//! must be assigned to the file's case (`CASE_ACCESS_DENIED` otherwise —
//! an io reading another case's files is denied and tested). Every read
//! writes an audit row (`file.read` / `file.verify`) and attempts a ledger
//! `POST /action` anchor with the actor's ledger identity.
//!
//! Verification (FR-7.2, NFR-7): the stored blob is re-hashed with SHA-256
//! streaming in fixed 64KiB chunks — the whole file is never loaded into
//! memory at once — and compared against the ledger via `GET
//! /verify/{docId}`. Equal hashes verify; differing hashes tamper (both
//! hashes returned); a missing anchor or an unreachable gateway reports
//! `pending`, never a silent pass. Stores are in-memory with the same
//! documented follow-up as `reid.rs` (real persistence through
//! `source_files`/`ingest_jobs` with per-case RLS; production streams the
//! blob from the content-addressed store instead of a byte vec).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use ts_rs::TS;
use uuid::Uuid;

use crate::audit::{record_action, AssignmentStore, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::ledger::{Endorsement, LedgerClient};

/// Fixed streaming chunk: verification hashes chunk by chunk (FR-1.2).
const HASH_CHUNK_BYTES: usize = 65536;

/// One file row as held by this service, mirroring the baseline
/// `source_files` columns the contract exposes. `ingested_at` mirrors
/// `created_at`: the infrastructure receive moment (SYSTEM TIME, never
/// case data — D16, CLAUDE.md rule 3).
#[derive(Debug, Clone, Serialize, TS)]
pub struct FileRecord {
    pub id: Uuid,
    pub case_id: Uuid,
    pub name: String,
    pub mime: String,
    pub sha256: String,
    pub status: String,
    pub provenance: String,
    pub source_node: Option<String>,
    pub ledger_tx_id: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub ingested_at: OffsetDateTime,
}

/// One ingest-job row as held by this service (saga step history).
#[derive(Debug, Clone, Serialize, TS)]
pub struct IngestJob {
    pub file_id: Uuid,
    pub stage: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct FileStore(Arc<Mutex<FileStoreInner>>);

#[derive(Debug, Default)]
struct FileStoreInner {
    files: Vec<FileRecord>,
    blobs: HashMap<Uuid, Vec<u8>>,
    jobs: Vec<IngestJob>,
}

impl FileStore {
    fn lock(&self) -> MutexGuard<'_, FileStoreInner> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Ingest-seed helper: stores the record with its bytes. Production
    /// writes once through the ingest saga; bytes are never replaced
    /// outside tests (see `overwrite_bytes`).
    pub fn insert(&self, file: FileRecord, bytes: Vec<u8>) {
        let mut guard = self.lock();
        guard.blobs.insert(file.id, bytes);
        guard.files.push(file);
    }

    pub fn add_job(&self, job: IngestJob) {
        self.lock().jobs.push(job);
    }

    pub fn get(&self, id: &Uuid) -> Option<FileRecord> {
        self.lock().files.iter().find(|file| &file.id == id).cloned()
    }

    pub fn files_for_case(&self, case_id: &Uuid) -> Vec<FileRecord> {
        self.lock().files.iter().filter(|file| &file.case_id == case_id).cloned().collect()
    }

    pub fn jobs_for(&self, id: &Uuid) -> Vec<IngestJob> {
        self.lock().jobs.iter().filter(|job| &job.file_id == id).cloned().collect()
    }

    /// TEST-ONLY corruption path: replaces the stored bytes so the
    /// single-byte-tamper test can prove detection. Production has no
    /// code path that mutates a stored blob (FR-1.2 content-addressing).
    pub fn overwrite_bytes(&self, id: &Uuid, bytes: Vec<u8>) {
        self.lock().blobs.insert(*id, bytes);
    }

    /// SHA-256 over the stored blob in fixed chunks. `None` when the file
    /// row or its blob is missing (corrupt state: fail loud at the call
    /// site, never hash the wrong bytes).
    fn chunked_hash(&self, id: &Uuid) -> Option<String> {
        let guard = self.lock();
        let bytes = guard.blobs.get(id)?;
        let mut hasher = Sha256::new();
        for chunk in bytes.chunks(HASH_CHUNK_BYTES) {
            hasher.update(chunk);
        }
        Some(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
    }
}

#[derive(Debug, Serialize, TS)]
pub struct FileDetailResponse {
    pub file: FileRecord,
    pub jobs: Vec<IngestJob>,
    pub ledger_tx_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum VerifyStatus {
    Verified,
    Tampered,
    Pending,
}

#[derive(Debug, Serialize, TS)]
pub struct VerifyFileResponse {
    pub status: VerifyStatus,
    pub computed_hash: String,
    pub ledger_hash: Option<String>,
    pub tx_id: Option<String>,
    pub endorsements: Vec<Endorsement>,
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

#[derive(Clone)]
struct FileState {
    files: FileStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    assignments: AssignmentStore,
    profiles: ProfilesStore,
}

/// M5 attribution dependencies shared with `audit.rs` (D21), plus the
/// case-assignment boundary files enforce in-process until RLS wiring.
#[derive(Clone)]
pub struct FilesDeps {
    pub auth: Arc<JwksCache>,
    pub ledger: LedgerClient,
    pub audit: AuditStore,
    pub assignments: AssignmentStore,
    pub profiles: ProfilesStore,
}

pub fn router(files: FileStore, deps: FilesDeps) -> Router {
    let state = FileState {
        files,
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        assignments: deps.assignments,
        profiles: deps.profiles,
    };
    Router::new()
        .route("/files/:id", get(read_file))
        .route("/files/:id/verify", get(verify_file))
        .with_state(state)
}

async fn authorize(
    headers: &HeaderMap,
    state: &FileState,
    case_id: &Uuid,
) -> Result<AuthContext, Box<Response>> {
    let context =
        authenticate_request(headers, &state.auth, &[AppRole::Io, AppRole::Analyst, AppRole::Auditor])
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

async fn anchor_read(
    state: &FileState,
    context: &AuthContext,
    case_id: Uuid,
    file_id: Uuid,
    action: &str,
    payload_hash: &str,
) {
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
            action: action.to_string(),
            object_type: "source_file".to_string(),
            object_id: file_id.to_string(),
            payload_hash: payload_hash.to_string(),
        },
    )
    .await;
}

/// GET /files/{id} (API_CONTRACTS.md §2.2): file record plus ingest-job
/// history. Every read writes an audit row (`file.read`) and attempts a
/// ledger anchor — evidence access is attributable (D21, FR-7.4).
async fn read_file(
    State(state): State<FileState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let Some(file) = state.files.get(&id) else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("file {id} not found"));
    };
    let context = match authorize(&headers, &state, &file.case_id).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    anchor_read(&state, &context, file.case_id, file.id, "file.read", &file.sha256).await;
    let response = FileDetailResponse {
        ledger_tx_id: file.ledger_tx_id.clone(),
        file,
        jobs: state.files.jobs_for(&id),
    };
    (StatusCode::OK, Json(response)).into_response()
}

/// GET /files/{id}/verify (API_CONTRACTS.md §2.2, FR-7.2): recompute
/// SHA-256 from the stored blob (streaming, fixed chunks) and compare
/// against the ledger. Mismatch is `tampered` with both hashes shown;
/// a missing anchor or unreachable gateway is `pending`.
async fn verify_file(
    State(state): State<FileState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let Some(file) = state.files.get(&id) else {
        return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("file {id} not found"));
    };
    let context = match authorize(&headers, &state, &file.case_id).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let Some(computed_hash) = state.files.chunked_hash(&id) else {
        return error(
            "INTERNAL",
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("file {id} has no stored blob: refusing to verify the wrong bytes"),
        );
    };
    let response = if file.ledger_tx_id.is_none() {
        VerifyFileResponse {
            status: VerifyStatus::Pending,
            computed_hash,
            ledger_hash: None,
            tx_id: None,
            endorsements: Vec::new(),
        }
    } else {
        match state.ledger.verify(&id.to_string()).await {
            Ok(entry) => VerifyFileResponse {
                status: if entry.hash == computed_hash {
                    VerifyStatus::Verified
                } else {
                    VerifyStatus::Tampered
                },
                computed_hash,
                ledger_hash: Some(entry.hash),
                tx_id: Some(entry.tx_id),
                endorsements: entry.endorsements,
            },
            Err(_) => VerifyFileResponse {
                status: VerifyStatus::Pending,
                computed_hash,
                ledger_hash: None,
                tx_id: None,
                endorsements: Vec::new(),
            },
        }
    };
    anchor_read(&state, &context, file.case_id, file.id, "file.verify", &response.computed_hash)
        .await;
    (StatusCode::OK, Json(response)).into_response()
}
