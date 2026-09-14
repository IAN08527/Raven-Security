//! M4 + M5-T3. File read and verification endpoint tests (FR-7.2).
//!
//! - An auditor can read files on assigned cases; every read carries the
//!   file record, ingest-job history, provenance, status and ledger id.
//! - An io cannot read files from unassigned cases (`CASE_ACCESS_DENIED`).
//! - Every read writes an audit row (`file.read`).
//! - Identical bytes verify; one modified byte tampers with both hashes
//!   shown; a missing anchor reports `pending`.

#[path = "support/mod.rs"]
mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use serde_json::Value;
use server::api::files::{FileRecord, FileStore, FilesDeps, IngestJob};
use server::audit::{AssignmentStore, AuditStore};
use server::auth::{AppRole, ProfilesStore};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use tower::ServiceExt;
use uuid::Uuid;

struct Harness {
    app: axum::Router,
    files: FileStore,
    audit: AuditStore,
    assignments: AssignmentStore,
    gateway: support::StubGateway,
}

fn sha_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

impl Harness {
    async fn start() -> Self {
        let files = FileStore::default();
        let audit = AuditStore::default();
        let assignments = AssignmentStore::default();
        let profiles = ProfilesStore::default();
        let auth = support::test_auth_cache();
        let gateway = support::StubGateway::start().await;
        let app = server::api::files::router(
            files.clone(),
            FilesDeps {
                auth,
                ledger: gateway.client(),
                audit: audit.clone(),
                assignments: assignments.clone(),
                profiles,
            },
        );
        Self { app, files, audit, assignments, gateway }
    }

    fn seed_file(&self, case_id: Uuid, name: &str, bytes: &[u8], anchored: bool) -> Uuid {
        let id = Uuid::new_v4();
        self.files.insert(
            FileRecord {
                id,
                case_id,
                name: name.to_string(),
                mime: "application/pdf".to_string(),
                sha256: sha_hex(bytes),
                status: "completed".to_string(),
                provenance: "collected".to_string(),
                source_node: Some("docs-lane".to_string()),
                ledger_tx_id: if anchored { Some("stub-tx-0".to_string()) } else { None },
                ingested_at: OffsetDateTime::now_utc(),
            },
            bytes.to_vec(),
        );
        self.files.add_job(IngestJob {
            file_id: id,
            stage: "extracting".to_string(),
            status: "done".to_string(),
            reason: None,
        });
        if anchored {
            self.gateway.set_verify(
                &id.to_string(),
                &sha_hex(bytes),
                serde_json::json!([{"org": "cid", "mode": "mock"}]),
            );
        }
        id
    }
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
async fn auditor_can_read_assigned_case_files() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let bytes = b"case file bytes";
    let file_id = harness.seed_file(case_id, "seized-letter.pdf", bytes, true);
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, AppRole::Auditor);
    let token = support::mint_token(&auditor, "auditor", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/files/{file_id}"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["file"]["name"], "seized-letter.pdf");
    assert_eq!(parsed["file"]["provenance"], "collected");
    assert_eq!(parsed["file"]["status"], "completed");
    assert_eq!(parsed["jobs"].as_array().expect("jobs").len(), 1);
}

#[tokio::test]
async fn io_cannot_read_files_from_unassigned_cases() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let file_id = harness.seed_file(case_id, "seized-letter.pdf", b"bytes", true);
    let officer = Uuid::new_v4();
    // No assignment: a different case is assigned instead.
    harness.assignments.assign(Uuid::new_v4(), officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/files/{file_id}"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(parsed["error"]["code"], "CASE_ACCESS_DENIED");
}

#[tokio::test]
async fn every_read_writes_an_audit_row() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let file_id = harness.seed_file(case_id, "seized-letter.pdf", b"bytes", false);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/files/{file_id}"), &token))
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::OK);
    let rows = harness.audit.rows_for_case(&case_id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].action, "file.read");
    assert_eq!(rows[0].user_id, officer);
}

#[tokio::test]
async fn identical_bytes_return_verified() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let bytes = b"exactly these bytes were anchored";
    let file_id = harness.seed_file(case_id, "ledger-copy.pdf", bytes, true);
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, AppRole::Auditor);
    let token = support::mint_token(&auditor, "auditor", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/files/{file_id}/verify"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], "verified");
    assert_eq!(parsed["computed_hash"], parsed["ledger_hash"]);
    assert_eq!(parsed["computed_hash"], sha_hex(bytes));
}

#[tokio::test]
async fn one_modified_byte_returns_tampered_with_both_hashes() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let bytes = b"exactly these bytes were anchored";
    let file_id = harness.seed_file(case_id, "ledger-copy.pdf", bytes, true);
    let mut tampered = bytes.to_vec();
    tampered[0] ^= 0x01;
    harness.files.overwrite_bytes(&file_id, tampered.clone());
    let auditor = Uuid::new_v4();
    harness.assignments.assign(case_id, auditor, AppRole::Auditor);
    let token = support::mint_token(&auditor, "auditor", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/files/{file_id}/verify"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], "tampered");
    assert_eq!(parsed["computed_hash"], sha_hex(&tampered));
    assert_eq!(parsed["ledger_hash"], sha_hex(bytes));
    assert_ne!(parsed["computed_hash"], parsed["ledger_hash"]);
}

#[tokio::test]
async fn pending_ledger_returns_pending_status() {
    let harness = Harness::start().await;
    let case_id = Uuid::new_v4();
    let bytes = b"never anchored";
    let file_id = harness.seed_file(case_id, "draft.pdf", bytes, false);
    let officer = Uuid::new_v4();
    harness.assignments.assign(case_id, officer, AppRole::Io);
    let token = support::mint_token(&officer, "io", 3600);

    let response = harness
        .app
        .oneshot(get_request(format!("/files/{file_id}/verify"), &token))
        .await
        .expect("router responds");
    let (status, parsed) = body_json(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(parsed["status"], "pending");
    assert_eq!(parsed["computed_hash"], sha_hex(bytes));
}
