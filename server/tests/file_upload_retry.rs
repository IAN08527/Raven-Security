//! Document upload and retry endpoint tests (D34, API_CONTRACTS.md §2.2).
//!
//! Hermetic by convention (Gap-4 decision): the handlers run against an
//! in-memory [`SourceFileRepo`] fake and a recording spawner — no live
//! Postgres, no real saga. What the tests prove: io-only gating, case
//! assignment, the 200MB streaming cap, magic-byte MIME detection,
//! global SHA-256 dedup, and the retry eligibility matrix.

#[path = "support/mod.rs"]
mod support;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::files::{
    FileStore, FilesDeps, IngestDeps, IngestSpawner, NewSourceFile, RepoError, RepoFile,
    SourceFileRepo,
};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore};
use server::storage::BlobStore;
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use uuid::Uuid;

const BOUNDARY: &str = "raven-test-boundary";

fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

#[derive(Debug, Clone)]
struct FakeRow {
    id: Uuid,
    case_id: Uuid,
    sha256: String,
    mime_type: String,
    status: String,
    ledger_tx_id: Option<String>,
}

/// In-memory [`SourceFileRepo`]: mirrors the SQL contract
/// method-for-method (global sha lookup, handler-generated ids, retry
/// reset clearing the anchor). A fake that drifts from `SagaDb` is a
/// test bug — the SQL lives in `server/src/db/mod.rs`.
#[derive(Debug, Default)]
struct FakeRepo {
    rows: Mutex<HashMap<Uuid, FakeRow>>,
    inserts: Mutex<Vec<NewSourceFile>>,
}

impl FakeRepo {
    fn to_repo_file(row: &FakeRow) -> RepoFile {
        RepoFile {
            id: row.id,
            case_id: row.case_id,
            sha256: row.sha256.clone(),
            mime_type: row.mime_type.clone(),
            status: row.status.clone(),
        }
    }

    fn lock<T>(cell: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
        cell.lock().expect("test fake lock")
    }
}

#[async_trait::async_trait]
impl SourceFileRepo for FakeRepo {
    async fn find_by_sha256(&self, sha256: &str) -> Result<Option<RepoFile>, RepoError> {
        Ok(Self::lock(&self.rows).values().find(|row| row.sha256 == sha256).map(Self::to_repo_file))
    }

    async fn insert_file(&self, new: &NewSourceFile) -> Result<Uuid, RepoError> {
        Self::lock(&self.inserts).push(new.clone());
        Self::lock(&self.rows).insert(
            new.id,
            FakeRow {
                id: new.id,
                case_id: new.case_id,
                sha256: new.sha256.clone(),
                mime_type: new.mime_type.clone(),
                status: "received".to_string(),
                ledger_tx_id: None,
            },
        );
        Ok(new.id)
    }

    async fn find_by_id(&self, file_id: &Uuid) -> Result<Option<RepoFile>, RepoError> {
        Ok(Self::lock(&self.rows).get(file_id).map(Self::to_repo_file))
    }

    async fn reset_for_retry(&self, file_id: &Uuid) -> Result<(), RepoError> {
        if let Some(row) = Self::lock(&self.rows).get_mut(file_id) {
            row.status = "received".to_string();
            row.ledger_tx_id = None;
        }
        Ok(())
    }
}

/// Recording spawner: the background saga never runs in handler tests
/// (its stages are covered by the saga suite); the spawn itself is
/// what upload/retry promise.
#[derive(Debug, Default)]
struct FakeSpawner {
    spawns: Mutex<Vec<(Uuid, String, String)>>,
}

impl IngestSpawner for FakeSpawner {
    fn spawn_ingest(&self, file_id: Uuid, sha256: String, mime_type: String) {
        self.spawns.lock().expect("test spawner lock").push((file_id, sha256, mime_type));
    }
}

struct Harness {
    app: axum::Router,
    repo: Arc<FakeRepo>,
    spawner: Arc<FakeSpawner>,
    audit: AuditStore,
    assignments: AssignmentStore,
}

impl Harness {
    async fn start() -> Self {
        let files = FileStore::default();
        let audit = AuditStore::default();
        let assignments = AssignmentStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let repo = Arc::new(FakeRepo::default());
        let spawner = Arc::new(FakeSpawner::default());
        let blobs = Arc::new(BlobStore::new(
            std::env::temp_dir().join(format!("raven-upload-test-{}", Uuid::new_v4())),
        ));
        let app = server::api::files::router_with_ingest(
            files,
            FilesDeps {
                auth,
                ledger: gateway.client(),
                audit: audit.clone(),
                assignments: assignments.clone(),
                profiles,
            },
            IngestDeps { repo: repo.clone(), spawner: spawner.clone(), blobs },
        );
        Self { app, repo, spawner, audit, assignments }
    }

    /// Seed one row directly (retry tests start from a known status).
    fn seed_row(&self, case_id: Uuid, status: &str, anchored: bool) -> Uuid {
        let id = Uuid::new_v4();
        FakeRepo::lock(&self.repo.rows).insert(
            id,
            FakeRow {
                id,
                case_id,
                sha256: sha_hex(b"seeded bytes"),
                mime_type: "application/pdf".to_string(),
                status: status.to_string(),
                ledger_tx_id: anchored.then(|| "stub-tx-0".to_string()),
            },
        );
        id
    }
}

fn pdf_bytes() -> Vec<u8> {
    b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n".to_vec()
}

fn png_bytes() -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    bytes.extend_from_slice(b"fake-png-payload");
    bytes
}

fn upload_body(filename: &str, file_bytes: &[u8], provenance: &str) -> (String, Vec<u8>) {
    upload_body_full(filename, file_bytes, Some(provenance), Some("MANUAL"))
}

fn upload_body_full(
    filename: &str,
    file_bytes: &[u8],
    provenance: Option<&str>,
    source_node: Option<&str>,
) -> (String, Vec<u8>) {
    let mut body = Vec::new();
    if let Some(provenance) = provenance {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"provenance\"\r\n\r\n\
                 {provenance}\r\n"
            )
            .as_bytes(),
        );
    }
    if let Some(source_node) = source_node {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"source_node\"\r\n\r\n\
                 {source_node}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; \
             filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={BOUNDARY}"), body)
}

fn post_request(uri: String, token: &str, content_type: String, body: Vec<u8>) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", content_type)
        .body(Body::from(body))
        .expect("request builds")
}

async fn body_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    (status, serde_json::from_slice(&bytes).expect("valid JSON"))
}

#[tokio::test]
async fn upload_small_pdf_returns_file_id_and_sha() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let bytes = pdf_bytes();
    let (content_type, body) = upload_body("seized-letter.pdf", &bytes, "collected");

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(parsed["sha256"], Value::from(sha_hex(&bytes)));
    assert_eq!(parsed["status"], Value::from("received"));
    assert_eq!(parsed["duplicate"], Value::from(false));
    let file_id: Uuid =
        parsed["file_id"].as_str().expect("file_id").parse().expect("uuid parses");
    // The recorded insert carries the magic-byte MIME, and the saga
    // was asked to run exactly once.
    let inserts = FakeRepo::lock(&harness.repo.inserts);
    assert_eq!(inserts.len(), 1);
    assert_eq!(inserts[0].mime_type, "application/pdf");
    assert_eq!(inserts[0].id, file_id);
    assert_eq!(harness.spawner.spawns.lock().expect("spawner lock").len(), 1);
    // One attributable audit row for the upload.
    let rows = harness.audit.rows_for_case(&case_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, "file.upload");
}

#[tokio::test]
async fn upload_same_bytes_twice_returns_duplicate() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let bytes = pdf_bytes();

    let first = {
        let (content_type, body) = upload_body("first.pdf", &bytes, "collected");
        let response = harness
            .app
            .clone()
            .oneshot(post_request(
                format!("/cases/{case_id}/files"),
                &token,
                content_type,
                body,
            ))
            .await
            .expect("router responds");
        body_json(response).await
    };
    assert_eq!(first.0, StatusCode::CREATED);
    let second = {
        let (content_type, body) = upload_body("second.pdf", &bytes, "benchmark");
        let response = harness
            .app
            .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
            .await
            .expect("router responds");
        body_json(response).await
    };
    assert_eq!(second.0, StatusCode::OK);
    assert_eq!(second.1["duplicate"], Value::from(true));
    assert_eq!(second.1["file_id"], first.1["file_id"], "same bytes, same file");
    // No second row, no second saga spawn: identical bytes never
    // re-ingest (D34).
    assert_eq!(FakeRepo::lock(&harness.repo.inserts).len(), 1);
    assert_eq!(harness.spawner.spawns.lock().expect("spawner lock").len(), 1);
}

#[tokio::test]
async fn upload_without_case_assignment_is_denied() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(Uuid::new_v4(), officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let (content_type, body) = upload_body("seized-letter.pdf", &pdf_bytes(), "collected");

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], Value::from("CASE_ACCESS_DENIED"));
}

#[tokio::test]
async fn upload_by_analyst_and_auditor_is_forbidden() {
    for role in ["analyst", "auditor"] {
        let harness = Harness::start().await;
        let case_id = Uuid::new_v4();
        let user = Uuid::new_v4();
        let app_role = if role == "analyst" { AppRole::Analyst } else { AppRole::Auditor };
        harness.assignments.assign(case_id, user, app_role);
        let token = support::mint_token(&user, role, 3600);
        let (content_type, body) = upload_body("seized-letter.pdf", &pdf_bytes(), "collected");

        let response = harness
            .app
            .oneshot(post_request(
                format!("/cases/{case_id}/files"),
                &token,
                content_type,
                body,
            ))
            .await
            .expect("router responds");
        let (status, parsed) = body_json(response).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} must not ingest");
        assert_eq!(parsed["error"]["code"], Value::from("FORBIDDEN"));
    }
}

#[tokio::test]
async fn mime_comes_from_magic_bytes_not_the_filename() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    // PNG bytes wearing a .pdf name: the detector must see through it.
    let (content_type, body) = upload_body("evil.pdf", &png_bytes(), "collected");

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, _) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(FakeRepo::lock(&harness.repo.inserts)[0].mime_type, "image/png");
}

#[tokio::test]
async fn unknown_bytes_fall_back_to_octet_stream() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let (content_type, body) = upload_body("blob.bin", b"\x00\x01\x02\x03random", "collected");

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, _) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        FakeRepo::lock(&harness.repo.inserts)[0].mime_type,
        "application/octet-stream"
    );
}

#[tokio::test]
async fn csv_bytes_with_csv_name_take_the_structured_fallback() {
    // D34 amendment: CSV has no magic bytes, so infer returns unknown
    // and the .csv extension supplies text/csv.
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let (content_type, body) =
        upload_body("call-records.csv", b"caller,callee,started_at\n", "collected");

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, _) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(FakeRepo::lock(&harness.repo.inserts)[0].mime_type, "text/csv");
}

#[tokio::test]
async fn json_bytes_with_json_name_take_the_structured_fallback() {
    // D34 amendment: same fallback for .json → application/json.
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let (content_type, body) =
        upload_body("transactions.JSON", br#"{"amount": 5000}"#, "collected");

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, _) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        FakeRepo::lock(&harness.repo.inserts)[0].mime_type,
        "application/json"
    );
}

#[tokio::test]
async fn csv_bytes_with_pdf_name_miss_the_structured_path() {
    // D34 limitation: the extension fallback only fires for .csv/.json,
    // so a CSV renamed to .pdf misses the structured path.
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let (content_type, body) =
        upload_body("records.pdf", b"caller,callee,started_at\n", "collected");

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, _) = body_json(response).await;
    assert_eq!(status, StatusCode::CREATED);
    let mime = FakeRepo::lock(&harness.repo.inserts)[0].mime_type.clone();
    assert_ne!(mime, "text/csv", "renamed CSV must not take the structured path");
    assert_eq!(mime, "application/octet-stream");
}

#[tokio::test]
async fn upload_over_200mb_is_rejected_before_full_read() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    // One kilobyte past the D34 cap: the handler must abort while
    // streaming, so no row is ever written for this body.
    let oversized = vec![0x25u8; 200 * 1024 * 1024 + 1024];
    let (content_type, body) = upload_body("huge.pdf", &oversized, "collected");

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], Value::from("VALIDATION_FAILED"));
    assert!(FakeRepo::lock(&harness.repo.inserts).is_empty(), "rejected upload writes no row");
    assert!(harness.spawner.spawns.lock().expect("spawner lock").is_empty(), "no saga spawns");
}

#[tokio::test]
async fn upload_missing_provenance_is_rejected() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let (content_type, body) = upload_body_full("seized-letter.pdf", &pdf_bytes(), None, None);

    let response = harness
        .app
        .oneshot(post_request(format!("/cases/{case_id}/files"), &token, content_type, body))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(parsed["error"]["code"], Value::from("VALIDATION_FAILED"));
}

#[tokio::test]
async fn retry_failed_file_returns_received() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let file_id = harness.seed_row(case_id, "failed", true);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/files/{file_id}/retry"),
            &token,
            "application/json".to_string(),
            b"{}".to_vec(),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], Value::from("received"));
    let row = FakeRepo::lock(&harness.repo.rows);
    let row = row.get(&file_id).expect("row exists");
    assert_eq!(row.status, "received");
    assert_eq!(row.ledger_tx_id, None, "retry clears the anchor for re-anchoring");
    assert_eq!(harness.spawner.spawns.lock().expect("spawner lock").len(), 1);
    let audit_rows = harness.audit.rows_for_case(&case_id);
    assert!(audit_rows.iter().any(|row| row.action == "file.retry"));
}

#[tokio::test]
async fn retry_needs_review_file_returns_received() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let file_id = harness.seed_row(case_id, "needs_review", false);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/files/{file_id}/retry"),
            &token,
            "application/json".to_string(),
            b"{}".to_vec(),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], Value::from("received"));
}

#[tokio::test]
async fn retry_committed_file_conflicts() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);
    let file_id = harness.seed_row(case_id, "committed", true);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/files/{file_id}/retry"),
            &token,
            "application/json".to_string(),
            b"{}".to_vec(),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(parsed["error"]["code"], Value::from("CONFLICT"));
    assert!(harness.spawner.spawns.lock().expect("spawner lock").is_empty(), "no saga spawns");
}

#[tokio::test]
async fn retry_by_auditor_is_forbidden() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, AppRole::Auditor);
    let token = support::mint_token(&auditor, "auditor", 3600);
    let file_id = harness.seed_row(case_id, "failed", false);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/files/{file_id}/retry"),
            &token,
            "application/json".to_string(),
            b"{}".to_vec(),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], Value::from("FORBIDDEN"));
}

#[tokio::test]
async fn retry_missing_file_is_not_found() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(post_request(
            format!("/files/{}/retry", Uuid::new_v4()),
            &token,
            "application/json".to_string(),
            b"{}".to_vec(),
        ))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(parsed["error"]["code"], Value::from("NOT_FOUND"));
}
