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

use axum::extract::{Multipart, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use tower_http::limit::RequestBodyLimitLayer;
use ts_rs::TS;
use uuid::Uuid;

use crate::audit::{record_action, AssignmentStore, AuditStore};
use crate::auth::{authenticate_request, AppRole, AuthContext, JwksCache, ProfilesStore};
use crate::ledger::{Endorsement, LedgerClient};
use crate::saga::ingest::Provenance;
use crate::storage::BlobStore;

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

    /// Best-effort read-mirror update for the upload/retry path: the
    /// saga owns the Postgres row from here on; this only keeps the
    /// in-memory record the GET endpoints serve from going stale.
    /// No-op when the row is absent (reads may legitimately race a
    /// retry on another task).
    pub fn set_status(&self, id: &Uuid, status: &str) {
        let mut guard = self.lock();
        if let Some(file) = guard.files.iter_mut().find(|file| &file.id == id) {
            file.status = status.to_string();
        }
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

/// Baseline `source_node` labels (D34). Exact spellings — the saga
/// casts these into the Postgres enum, so a fork here breaks inserts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceNode {
    Cctns,
    Cfcfrms,
    Icjs,
    Vahan,
    Nafis,
    Telecom,
    PublicDataset,
    Manual,
}

impl SourceNode {
    /// Parse a multipart `source_node` value. Unknown values are
    /// rejected, never defaulted: silently relabelling a source corrupts
    /// provenance (rule 7).
    pub fn parse(input: &str) -> Option<Self> {
        match input {
            "CCTNS" => Some(SourceNode::Cctns),
            "CFCFRMS" => Some(SourceNode::Cfcfrms),
            "ICJS" => Some(SourceNode::Icjs),
            "VAHAN" => Some(SourceNode::Vahan),
            "NAFIS" => Some(SourceNode::Nafis),
            "TELECOM" => Some(SourceNode::Telecom),
            "PUBLIC_DATASET" => Some(SourceNode::PublicDataset),
            "MANUAL" => Some(SourceNode::Manual),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            SourceNode::Cctns => "CCTNS",
            SourceNode::Cfcfrms => "CFCFRMS",
            SourceNode::Icjs => "ICJS",
            SourceNode::Vahan => "VAHAN",
            SourceNode::Nafis => "NAFIS",
            SourceNode::Telecom => "TELECOM",
            SourceNode::PublicDataset => "PUBLIC_DATASET",
            SourceNode::Manual => "MANUAL",
        }
    }
}

/// Parse a multipart `provenance` value. Same no-default discipline as
/// [`SourceNode::parse`] (rule 7 — metrics filter on this column, D19).
pub fn parse_provenance(input: &str) -> Option<Provenance> {
    match input {
        "benchmark" => Some(Provenance::Benchmark),
        "collected" => Some(Provenance::Collected),
        "synthetic" => Some(Provenance::Synthetic),
        _ => None,
    }
}

/// One `source_files` row as the upload/retry path needs it. Field
/// names mirror the baseline columns; `status` arrives as text (the
/// queries cast `status::text`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RepoFile {
    pub id: Uuid,
    pub case_id: Uuid,
    pub sha256: String,
    pub mime_type: String,
    pub status: String,
}

/// A new `source_files` row (handler-validated, pre-insert). The id
/// is handler-generated so the row, the blob mirror, the audit row and
/// the spawned saga all name the same file — a DB-generated id would
/// fork them.
#[derive(Debug, Clone)]
pub struct NewSourceFile {
    pub id: Uuid,
    pub case_id: Uuid,
    pub filename: String,
    pub mime_type: String,
    pub byte_size: i64,
    pub sha256: String,
    pub storage_path: String,
    pub source_node: String,
    pub provenance: String,
    pub uploaded_by: Uuid,
}

/// Persistence failure on the upload/retry path. Rendered as
/// `INTERNAL` — the database being down is never the caller's fault
/// and never retryable blindly from here (the saga owns retries).
#[derive(Debug, thiserror::Error)]
pub enum RepoError {
    #[error("source-file store unavailable: {0}")]
    Db(String),
}

/// What `upload_file` / `retry_file` need from persistence.
///
/// Gap-4 decision (upload session): handlers are generic over this
/// trait so tests run hermetic in-memory fakes; `SagaDb`
/// (`crate::db`) is the Postgres implementation. Method-for-method it
/// mirrors the SQL the task specifies — a fake that drifts from that
/// contract is a test bug, not a design freedom.
#[async_trait::async_trait]
pub trait SourceFileRepo: Send + Sync {
    async fn find_by_sha256(&self, sha256: &str) -> Result<Option<RepoFile>, RepoError>;
    async fn insert_file(&self, new: &NewSourceFile) -> Result<Uuid, RepoError>;
    async fn find_by_id(&self, file_id: &Uuid) -> Result<Option<RepoFile>, RepoError>;
    async fn reset_for_retry(&self, file_id: &Uuid) -> Result<(), RepoError>;
}

/// Spawns the background ingest saga. A trait (not a direct
/// `tokio::spawn` call) for the same hermetic-test reason as
/// [`SourceFileRepo`]: tests record the spawn instead of running a
/// saga against fakes they do not own.
pub trait IngestSpawner: Send + Sync {
    fn spawn_ingest(&self, file_id: Uuid, sha256: String, mime_type: String);
}

#[derive(Debug, Serialize, TS)]
pub struct UploadFileResponse {
    pub file_id: Uuid,
    pub sha256: String,
    pub status: String,
    pub duplicate: bool,
}

#[derive(Debug, Serialize, TS)]
pub struct RetryFileResponse {
    pub file_id: Uuid,
    pub status: String,
}

#[derive(Clone)]
struct FileState {
    files: FileStore,
    auth: Arc<JwksCache>,
    ledger: LedgerClient,
    audit: AuditStore,
    assignments: AssignmentStore,
    profiles: ProfilesStore,
    repo: Arc<dyn SourceFileRepo>,
    spawner: Arc<dyn IngestSpawner>,
    blobs: Arc<BlobStore>,
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

/// Upload/retry dependencies (D33-D34). Kept separate from
/// [`FilesDeps`] so the read/verify router — and its tests — keep
/// compiling unchanged: persistence arrives here, not in every
/// constructor.
#[derive(Clone)]
pub struct IngestDeps {
    pub repo: Arc<dyn SourceFileRepo>,
    pub spawner: Arc<dyn IngestSpawner>,
    pub blobs: Arc<BlobStore>,
}

pub fn router(files: FileStore, deps: FilesDeps) -> Router {
    router_with_ingest(
        files,
        deps,
        IngestDeps {
            repo: Arc::new(NoRepo),
            spawner: Arc::new(NoSpawner),
            blobs: Arc::new(BlobStore::new(default_blob_dir())),
        },
    )
}

/// Null persistence for the read-only router: upload/retry answer
/// `INTERNAL` naming the missing wiring rather than panicking.
/// Production always passes real deps via [`router_with_ingest`].
struct NoRepo;

#[async_trait::async_trait]
impl SourceFileRepo for NoRepo {
    async fn find_by_sha256(&self, _sha256: &str) -> Result<Option<RepoFile>, RepoError> {
        Err(RepoError::Db("upload persistence is not wired on this router".into()))
    }
    async fn insert_file(&self, _new: &NewSourceFile) -> Result<Uuid, RepoError> {
        Err(RepoError::Db("upload persistence is not wired on this router".into()))
    }
    async fn find_by_id(&self, _file_id: &Uuid) -> Result<Option<RepoFile>, RepoError> {
        Err(RepoError::Db("upload persistence is not wired on this router".into()))
    }
    async fn reset_for_retry(&self, _file_id: &Uuid) -> Result<(), RepoError> {
        Err(RepoError::Db("upload persistence is not wired on this router".into()))
    }
}

struct NoSpawner;

impl IngestSpawner for NoSpawner {
    fn spawn_ingest(&self, _file_id: Uuid, _sha256: String, _mime_type: String) {}
}

fn default_blob_dir() -> std::path::PathBuf {
    std::env::var("RAVEN_BLOB_DIR").map(std::path::PathBuf::from).unwrap_or("./blobs".into())
}

/// Full files router: reads, verification, upload and retry
/// (API_CONTRACTS.md §2.2).
pub fn router_with_ingest(files: FileStore, deps: FilesDeps, ingest: IngestDeps) -> Router {
    let state = FileState {
        files,
        auth: deps.auth,
        ledger: deps.ledger,
        audit: deps.audit,
        assignments: deps.assignments,
        profiles: deps.profiles,
        repo: ingest.repo,
        spawner: ingest.spawner,
        blobs: ingest.blobs,
    };
    // axum 0.7 caps every request body at 2MB by default
    // (`DefaultBodyLimit`): the upload route raises it past the D34
    // file cap plus multipart framing slack, so the handler's own
    // streaming check — with its envelope error — is what judges size.
    // All other routes keep the framework default.
    Router::new()
        .route("/files/:id", get(read_file))
        .route("/files/:id/verify", get(verify_file))
        .route(
            "/cases/:id/files",
            post(upload_file).route_layer(RequestBodyLimitLayer::new(
                MAX_UPLOAD_BYTES + 1024 * 1024,
            )),
        )
        .route("/files/:id/retry", post(retry_file))
        .with_state(state)
}

/// Read access for io, analyst, auditor plus the administrator
/// unconditionally (D37 amends D21). Upload/retry stay gated by
/// `authorize_io_case` below, untouched — the administrator's grant
/// here is read-only.
async fn authorize(
    headers: &HeaderMap,
    state: &FileState,
    case_id: &Uuid,
) -> Result<AuthContext, Box<Response>> {
    crate::audit::authenticate_case_reader(
        headers,
        &state.auth,
        &state.assignments,
        case_id,
        &[AppRole::Io, AppRole::Analyst, AppRole::Auditor, AppRole::Admin],
    )
    .await
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

/// D34: operational upload cap. Files above this are rejected with
/// `VALIDATION_FAILED` while streaming — the full body is never held
/// in memory. Sized for scanned FIR batches (typically under 20MB).
const MAX_UPLOAD_BYTES: usize = 200 * 1024 * 1024;

/// io-only gate plus case assignment (D34, API_CONTRACTS.md §2.2).
/// Analysts and auditors read case data; they do not ingest it, so a
/// non-io role is `FORBIDDEN` here even when assigned.
async fn authorize_io_case(
    headers: &HeaderMap,
    state: &FileState,
    case_id: &Uuid,
) -> Result<AuthContext, Box<Response>> {
    let context = authenticate_request(headers, &state.auth, &[AppRole::Io]).await?;
    if !state.assignments.is_assigned(case_id, &context.user_id) {
        return Err(Box::new(error(
            "CASE_ACCESS_DENIED",
            StatusCode::FORBIDDEN,
            format!("no assignment for this user on case {case_id}"),
        )));
    }
    Ok(context)
}

fn repo_unavailable(detail: String) -> Response {
    error("INTERNAL", StatusCode::INTERNAL_SERVER_ERROR, detail)
}

/// One uploaded file's validated fields, before hashing and storage.
struct ValidatedUpload {
    filename: String,
    bytes: Vec<u8>,
    provenance: Provenance,
    source_node: SourceNode,
}

/// Read one multipart upload: `file` (required), `provenance`
/// (required), `source_node` (optional, default `MANUAL`). File bytes
/// stream in chunks with an early abort above [`MAX_UPLOAD_BYTES`] —
/// oversized bodies are rejected before they are fully read, and never
/// fully loaded.
/// 422 envelope shortcut for the upload validator. Boxed: axum
/// `Response` is hundreds of bytes and must not ride in a
/// `Result::Err` by value (`result_large_err` — same precedent as
/// `authenticate_request` in `auth.rs`).
fn invalid(message: impl Into<String>) -> Box<Response> {
    Box::new(error("VALIDATION_FAILED", StatusCode::UNPROCESSABLE_ENTITY, message))
}

async fn read_upload_fields(mut multipart: Multipart) -> Result<ValidatedUpload, Box<Response>> {
    let mut filename: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;
    let mut provenance: Option<String> = None;
    let mut source_node: Option<String> = None;
    while let Some(field) = multipart.next_field().await.map_err(|err| {
        invalid(format!("bad multipart: {err}"))
    })? {
        match field.name().unwrap_or("") {
            "file" => {
                if bytes.is_some() {
                    return Err(invalid("single file expected: repeated file field"));
                }
                filename = field.file_name().map(str::to_string);
                let mut acc = Vec::new();
                let mut field = field;
                // `chunk()` yields `None` at the field's end: the loop
                // below is what enforces the cap while streaming.
                loop {
                    match field.chunk().await {
                        Err(err) => {
                            return Err(invalid(format!("unreadable file field: {err}")));
                        }
                        Ok(None) => break,
                        Ok(Some(chunk)) => {
                            acc.extend_from_slice(&chunk);
                            if acc.len() > MAX_UPLOAD_BYTES {
                                // 422, not 413: codebase convention maps
                                // bad bodies to VALIDATION_FAILED/422
                                // (see camera registration), and the
                                // envelope code is what clients branch on.
                                return Err(invalid(
                                    "file exceeds the 200MB upload cap (D34): \
                                     rejected while streaming, body not stored",
                                ));
                            }
                        }
                    }
                }
                bytes = Some(acc);
            }
            "provenance" => {
                provenance = field
                    .text()
                    .await
                    .map(Some)
                    .map_err(|err| invalid(format!("unreadable provenance field: {err}")))?;
            }
            "source_node" => {
                source_node = field
                    .text()
                    .await
                    .map(Some)
                    .map_err(|err| invalid(format!("unreadable source_node field: {err}")))?;
            }
            _ => {}
        }
    }
    let bytes = bytes.ok_or_else(|| invalid("file field is required"))?;
    let filename = filename
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| invalid("file field must carry a filename"))?;
    let provenance_label = provenance.as_deref().ok_or_else(|| {
        invalid("provenance is required: benchmark | collected | synthetic")
    })?;
    let provenance_value = parse_provenance(provenance_label.trim())
        .ok_or_else(|| invalid(format!("unknown provenance: {provenance_label}")))?;
    let source_label = source_node.as_deref().unwrap_or("MANUAL");
    let source_value = SourceNode::parse(source_label.trim())
        .ok_or_else(|| invalid(format!("unknown source_node: {source_label}")))?;
    Ok(ValidatedUpload { filename, bytes, provenance: provenance_value, source_node: source_value })
}

/// POST /cases/{id}/files (API_CONTRACTS.md §2.2, D34): hash, dedupe,
/// store and acknowledge a file, then ingest in the background. The
/// response returns as soon as the blob is durable — never after the
/// saga finishes.
async fn upload_file(
    State(state): State<FileState>,
    headers: HeaderMap,
    Path(case_id): Path<Uuid>,
    multipart: Multipart,
) -> Response {
    let context = match authorize_io_case(&headers, &state, &case_id).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let upload = match read_upload_fields(multipart).await {
        Ok(upload) => upload,
        Err(boxed) => return *boxed,
    };
    // D34: magic bytes first, never the Content-Type header. Exception
    // (D34 amendment): structured text formats (CSV, JSON, NDJSON) have
    // no magic bytes and infer returns unknown for them, so for these
    // types only the filename extension is consulted when infer returns
    // unknown (.csv → text/csv, .json → application/json). Any other
    // unknown stays application/octet-stream.
    let sniffed = infer::get(&upload.bytes).map(|kind| kind.mime_type().to_string());
    let sniffed = sniffed.as_deref().unwrap_or("application/octet-stream");
    let mime = if sniffed == "application/octet-stream" {
        match upload.filename.rsplit('.').next().unwrap_or("").to_lowercase().as_str() {
            "csv" => "text/csv",
            "json" => "application/json",
            _ => sniffed,
        }
    } else {
        sniffed
    };
    let mut hasher = Sha256::new();
    for chunk in upload.bytes.chunks(HASH_CHUNK_BYTES) {
        hasher.update(chunk);
    }
    let sha256: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    // D34: global SHA-256 dedup — identical bytes are never re-ingested.
    match state.repo.find_by_sha256(&sha256).await {
        Ok(Some(existing)) => {
            return (
                StatusCode::OK,
                Json(UploadFileResponse {
                    file_id: existing.id,
                    sha256,
                    status: existing.status,
                    duplicate: true,
                }),
            )
                .into_response();
        }
        Ok(None) => {}
        Err(RepoError::Db(detail)) => return repo_unavailable(detail),
    }
    let file_id = Uuid::new_v4();
    let storage_path = match state.blobs.path_for(&sha256).to_str() {
        Some(path) => path.to_string(),
        None => {
            return error(
                "INTERNAL",
                StatusCode::INTERNAL_SERVER_ERROR,
                "blob path is not representable: refusing to store an unaddressable file",
            );
        }
    };
    let byte_size = upload.bytes.len() as i64;
    if let Err(RepoError::Db(detail)) = state
        .repo
        .insert_file(&NewSourceFile {
            id: file_id,
            case_id,
            filename: upload.filename.clone(),
            mime_type: mime.to_string(),
            byte_size,
            sha256: sha256.clone(),
            storage_path: storage_path.clone(),
            source_node: upload.source_node.as_str().to_string(),
            provenance: upload.provenance.as_str().to_string(),
            uploaded_by: context.user_id,
        })
        .await
    {
        return repo_unavailable(detail);
    }
    if let Err(err) = state.blobs.write(&sha256, &upload.bytes).await {
        return error(
            "INTERNAL",
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("blob store failed after the row was written: {err}"),
        );
    }
    // Read-mirror for the GET endpoints until they migrate to Postgres:
    // the saga owns the Postgres row from here on; this mirror only
    // ever reflects the receive moment.
    state.files.insert(
        FileRecord {
            id: file_id,
            case_id,
            name: upload.filename,
            mime: mime.to_string(),
            sha256: sha256.clone(),
            status: "received".to_string(),
            provenance: upload.provenance.as_str().to_string(),
            source_node: Some(upload.source_node.as_str().to_string()),
            ledger_tx_id: None,
            ingested_at: OffsetDateTime::now_utc(),
        },
        upload.bytes,
    );
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
            action: "file.upload".to_string(),
            object_type: "source_file".to_string(),
            object_id: file_id.to_string(),
            payload_hash: sha256.clone(),
        },
    )
    .await;
    state.spawner.spawn_ingest(file_id, sha256.clone(), mime.to_string());
    (
        StatusCode::CREATED,
        Json(UploadFileResponse { file_id, sha256, status: "received".to_string(), duplicate: false }),
    )
        .into_response()
}

/// POST /files/{id}/retry (API_CONTRACTS.md §2.2): restart a failed
/// ingest. Only `failed` and `needs_review` files are eligible —
/// anything else is `409 CONFLICT`, never a silent re-run.
async fn retry_file(
    State(state): State<FileState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let context = match authenticate_request(&headers, &state.auth, &[AppRole::Io]).await {
        Ok(context) => context,
        Err(boxed) => return *boxed,
    };
    let row = match state.repo.find_by_id(&id).await {
        Ok(Some(row)) => row,
        Ok(None) => return error("NOT_FOUND", StatusCode::NOT_FOUND, format!("file {id} not found")),
        Err(RepoError::Db(detail)) => return repo_unavailable(detail),
    };
    if !state.assignments.is_assigned(&row.case_id, &context.user_id) {
        return error(
            "CASE_ACCESS_DENIED",
            StatusCode::FORBIDDEN,
            format!("no assignment for this user on case {}", row.case_id),
        );
    }
    if row.status != "failed" && row.status != "needs_review" {
        return error(
            "CONFLICT",
            StatusCode::CONFLICT,
            format!("file {id} has status '{}': only failed and needs_review files retry", row.status),
        );
    }
    if let Err(RepoError::Db(detail)) = state.repo.reset_for_retry(&id).await {
        return repo_unavailable(detail);
    }
    state.files.set_status(&id, "received");
    record_action(
        crate::audit::ActionDeps {
            audit: &state.audit,
            ledger: &state.ledger,
            profiles: &state.profiles,
        },
        crate::audit::ActionRecord {
            case_id: row.case_id,
            user_id: context.user_id,
            user_role: context.role,
            action: "file.retry".to_string(),
            object_type: "source_file".to_string(),
            object_id: id.to_string(),
            payload_hash: row.sha256.clone(),
        },
    )
    .await;
    state.spawner.spawn_ingest(id, row.sha256, row.mime_type);
    (StatusCode::OK, Json(RetryFileResponse { file_id: id, status: "received".to_string() }))
        .into_response()
}
