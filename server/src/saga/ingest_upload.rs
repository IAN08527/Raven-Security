//! Ingest background task: saga steps 5-8 (ARCHITECTURE.md §4.3,
//! D33-D36).
//!
//! The HTTP handler (steps 1-4: stream, hash, store blob, insert row)
//! returns first; this task runs detached via [`SagaIngestSpawner`].
//! Step 6 anchors the file hash (D5, continuing on ledger failure);
//! step 7 routes by MIME (D35/D36); step 8 hands extracted text to the
//! existing [`run_steps_7_to_9`](crate::saga::ingest::run_steps_7_to_9).
//! Every stage writes an `ingest_jobs` row with the exact stage strings
//! below, so the UI can render progress and operators can see failures
//! (rule 9). A failure anywhere sets `source_files.status='failed'`
//! with the reason on the job row — never a silent drop, never a panic.

use std::sync::{Arc, Mutex};

use uuid::Uuid;

use crate::api::files::IngestSpawner;
use crate::db::{FileContext, SagaDb};
use crate::ledger::LedgerClient;
use crate::saga::extraction_client::{
    DocsLaneClient, DocsLaneOcrClient, DEFAULT_DOCS_LANE_URL,
};
use crate::saga::ingest::{
    run_steps_7_to_9, ExtractionClient, FileStatus, GraphEdge, GraphError, GraphNode,
    GraphWriter, IngestInput, LedgerAnchor, LedgerError, Provenance, ReviewDisposition,
    StepOutcome,
};
use crate::storage::BlobStore;

/// `ingest_jobs.stage` vocabulary. Exact strings — the UI branches on
/// them and the acceptance suite pins them.
pub const STAGE_LEDGER_ANCHOR: &str = "ledger_anchor";
pub const STAGE_MIME_ROUTING: &str = "mime_routing";
pub const STAGE_TEXT_EXTRACTION: &str = "text_extraction";
pub const STAGE_OCR: &str = "ocr";
pub const STAGE_HANDOFF: &str = "handoff";

/// `ingest_jobs.status` vocabulary (baseline CHECK constraint).
const JOB_OK: &str = "ok";
const JOB_FAILED: &str = "failed";

/// MIME routing decision (D34, D35, D36). Pure function of the
/// upload-detected MIME (D34: magic bytes, with the structured-text
/// extension fallback already applied) — unit-tested below, no I/O.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MimeRoute {
    Pdf,
    Image,
    Structured,
    Unsupported,
}

fn classify_mime(mime_type: &str) -> MimeRoute {
    if mime_type == "application/pdf" {
        MimeRoute::Pdf
    } else if mime_type.starts_with("image/") {
        MimeRoute::Image
    } else if mime_type == "text/csv"
        || mime_type == "application/json"
        || mime_type == "application/vnd.ms-excel"
        || mime_type.starts_with("application/vnd.openxmlformats-officedocument")
    {
        // D34 structured-text fallback (named here, applied at upload):
        // infer has no JSON or CSV matcher — those formats have no magic
        // signature — so the upload handler falls back to the filename
        // extension when infer returns unknown (.csv → text/csv, .json →
        // application/json) and real .csv/.json bytes arrive here already
        // labelled. application/octet-stream still means genuinely
        // unknown: renaming the file defeats the fallback, so a CSV
        // renamed to .pdf misses the structured path (D34 limitation).
        // XLS/XLSX carry real magic bytes and route correctly today.
        MimeRoute::Structured
    } else {
        MimeRoute::Unsupported
    }
}

/// Attempt lopdf text extraction (D35): non-empty-after-trim means a
/// digital PDF whose text is used directly; empty or error means
/// scanned and the caller routes to OCR. `None` is a routing signal,
/// not a failure — the failure rows belong to the caller.
fn extract_pdf_text(bytes: &[u8]) -> Option<String> {
    let document = lopdf::Document::load_mem(bytes).ok()?;
    let pages: Vec<u32> = document.get_pages().keys().copied().collect();
    if pages.is_empty() {
        return None;
    }
    let text = document.extract_text(&pages).ok()?;
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Production `GraphWriter`: records merges in memory.
///
/// Why not the snapshot/graph store: the merge call carries node and
/// edge ids but no `case_id`, so no adapter can place them into the
/// right case snapshot — and guessing a case would corrupt the read
/// path. This adapter is production parity with the tested fake
/// (`FakeGraph` in `server/tests/ingest_saga.rs`): merges are kept,
/// visible in order, and placement awaits either `case_id` on the call
/// or the Neo4j writer (D4/D10 follow-up).
#[derive(Debug, Clone, Default)]
pub struct InMemGraphAdapter {
    merges: Arc<Mutex<Vec<RecordedMerge>>>,
}

/// One recorded graph write, in call order.
#[derive(Debug, Clone)]
pub struct RecordedMerge {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

impl InMemGraphAdapter {
    /// Merges recorded so far, oldest first.
    pub fn merges(&self) -> Vec<RecordedMerge> {
        self.merges.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }
}

#[async_trait::async_trait]
impl GraphWriter for InMemGraphAdapter {
    async fn merge_case_graph(
        &self,
        nodes: &[GraphNode],
        edges: &[GraphEdge],
    ) -> Result<(), GraphError> {
        self.merges
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(RecordedMerge { nodes: nodes.to_vec(), edges: edges.to_vec() });
        Ok(())
    }
}

/// Production `LedgerAnchor` for the extraction hash (D5 step 11, D33):
/// reads case and uploader identity from the database, then anchors
/// via `POST /action` with `actionType='extraction.anchor'`
/// (ARCHITECTURE.md §4.3 step 11 is a ledger *action*). A null
/// `ledger_id` is `PendingRetry` carrying the `skipped_no_identity`
/// reason — the same marker as the decide endpoints, and the saga
/// treats it as parked-for-retry rather than failed.
#[derive(Debug, Clone)]
pub struct SagaLedgerAnchor {
    ledger: LedgerClient,
    db: SagaDb,
}

impl SagaLedgerAnchor {
    pub fn new(ledger: LedgerClient, db: SagaDb) -> Self {
        Self { ledger, db }
    }
}

#[async_trait::async_trait]
impl LedgerAnchor for SagaLedgerAnchor {
    async fn anchor_extraction(
        &self,
        file_id: Uuid,
        result_hash: &str,
    ) -> Result<String, LedgerError> {
        let context: FileContext = self
            .db
            .file_context(&file_id)
            .await
            .map_err(|error| LedgerError::Unavailable(format!("saga db: {error}")))?
            .ok_or_else(|| {
                LedgerError::Unavailable(format!("file {file_id} vanished mid-saga"))
            })?;
        let uploader = context.uploaded_by.ok_or_else(|| {
            LedgerError::Unavailable("skipped_no_identity: file has no uploader".to_string())
        })?;
        let actor = self
            .db
            .ledger_id_for(&uploader)
            .await
            .map_err(|error| LedgerError::Unavailable(format!("saga db: {error}")))?
            .ok_or_else(|| {
                LedgerError::Unavailable(
                    "skipped_no_identity: uploader has no profiles.ledger_id".to_string(),
                )
            })?;
        self.ledger
            .action(
                "extraction.anchor",
                result_hash,
                &file_id.to_string(),
                &context.case_id.to_string(),
                &actor,
            )
            .await
            .map(|receipt| receipt.tx_id)
            .map_err(LedgerError::Unavailable)
    }
}

/// Production spawner: clones its handles and detaches [`run_ingest`].
/// Must be called within a Tokio runtime — handlers always are; a
/// runtime-less call panics inside `tokio::spawn`, so tests use
/// `#[tokio::test]`.
#[derive(Clone)]
pub struct SagaIngestSpawner {
    db: SagaDb,
    blobs: Arc<BlobStore>,
    ledger: LedgerClient,
    graph: Arc<InMemGraphAdapter>,
    extraction: DocsLaneClient,
}

impl SagaIngestSpawner {
    pub fn new(
        db: SagaDb,
        blobs: Arc<BlobStore>,
        ledger: LedgerClient,
        extraction: DocsLaneClient,
    ) -> Self {
        Self { db, blobs, ledger, graph: Arc::new(InMemGraphAdapter::default()), extraction }
    }
}

impl IngestSpawner for SagaIngestSpawner {
    fn spawn_ingest(&self, file_id: Uuid, sha256: String, mime_type: String) {
        let task = run_ingest(
            file_id,
            sha256,
            mime_type,
            Arc::new(self.db.clone()),
            self.blobs.clone(),
            Arc::new(SagaLedgerAnchor::new(self.ledger.clone(), self.db.clone())),
            self.graph.clone(),
            Arc::new(self.extraction.clone()),
        );
        tokio::spawn(task);
    }
}

/// Read `DOCS_LANE_URL` the same way [`DocsLaneClient::from_env`] does,
/// so the OCR client never drifts from the extraction client.
fn ocr_client() -> Result<DocsLaneOcrClient, String> {
    DocsLaneOcrClient::new(
        std::env::var("DOCS_LANE_URL").unwrap_or_else(|_| DEFAULT_DOCS_LANE_URL.into()),
    )
}

/// Background ingest: ledger anchor (step 6), MIME routing (step 7),
/// handoff to [`run_steps_7_to_9`](crate::saga::ingest::run_steps_7_to_9)
/// (step 8). See the module docs for the failure contract.
///
/// Eight parameters because the task fixes this signature (each handle
/// is a separate infrastructure seam for tests); hence the allow.
#[allow(clippy::too_many_arguments)]
pub async fn run_ingest(
    file_id: Uuid,
    sha256: String,
    mime_type: String,
    db: Arc<SagaDb>,
    blob: Arc<BlobStore>,
    ledger: Arc<dyn LedgerAnchor + Send + Sync>,
    graph: Arc<dyn GraphWriter + Send + Sync>,
    extraction: Arc<dyn ExtractionClient + Send + Sync>,
) {
    // Step 5: leave 'received' behind. A DB failure here fails the run:
    // nothing downstream can work without the database either.
    if let Err(error) = db.set_status(&file_id, FileStatus::Stored.as_str()).await {
        fail(&db, &file_id, STAGE_LEDGER_ANCHOR, &format!("saga db: {error}")).await;
        return;
    }
    // Step 6: file-hash anchor (D5). The gateway client is built fresh
    // here rather than threaded through the signature: the `ledger`
    // parameter serves step 11 (extraction anchor), while this step
    // needs the raw gateway client with DB-read identity (D33). The
    // anchored hash is the handler-computed SHA-256 of the stored
    // bytes — the same value addressing the blob below.
    step_ledger_anchor(&db, &file_id, &sha256).await;
    // Step 7: MIME routing (D34 MIME plus the structured-text extension
    // fallback, D35, D36).
    let extracted = match classify_mime(&mime_type) {
        MimeRoute::Pdf => match route_pdf(&db, &blob, &file_id, &sha256).await {
            RouteOutcome::Proceed(text) => Some(text),
            RouteOutcome::Stop => return,
        },
        MimeRoute::Image => match route_image(&db, &blob, &file_id, &sha256, &mime_type).await {
            RouteOutcome::Proceed(text) => Some(text),
            RouteOutcome::Stop => return,
        },
        MimeRoute::Structured => {
            route_structured(&db, &blob, &file_id, &sha256).await;
            return;
        }
        MimeRoute::Unsupported => {
            let message = format!("unsupported MIME type: {mime_type}");
            fail(&db, &file_id, STAGE_MIME_ROUTING, &message).await;
            return;
        }
    };
    // Step 8: handoff with the extracted text.
    let text = extracted.unwrap_or_else(|| unreachable_routed_text(&mime_type));
    step_handoff(&db, &ledger, &graph, &extraction, file_id, text).await;
}

/// Defensive: every route above returns `Proceed` or `Stop`, so this
/// is unreachable — but `unwrap()` is banned outside tests, so the
/// fallback fails loud (rule 9) instead of panicking.
fn unreachable_routed_text(mime_type: &str) -> String {
    format!("ingest routing bug: no text for MIME {mime_type} (see ingest_jobs)")
}

/// Mark a run failed: file status plus the job row carrying the
/// reason. Both writes are best-effort — if the database itself is
/// down there is nothing further to write to, so the error is traced.
async fn fail(db: &SagaDb, file_id: &Uuid, stage: &str, message: &str) {
    if let Err(error) = db.set_status(file_id, FileStatus::Failed.as_str()).await {
        tracing::warn!(%file_id, %error, "saga fail() could not set status");
    }
    if let Err(error) = db.write_job(file_id, stage, JOB_FAILED, Some(message)).await {
        tracing::warn!(%file_id, %error, "saga fail() could not write job row");
    }
}

/// Step 6: anchor the file hash. Ledger trouble never stops ingest
/// (D5): missing identity parks as `skipped_no_identity`, gateway
/// trouble as `pending`, and the run continues in both cases.
async fn step_ledger_anchor(db: &SagaDb, file_id: &Uuid, sha256: &str) {
    let detail = match db.file_context(file_id).await {
        Err(error) => {
            fail(db, file_id, STAGE_LEDGER_ANCHOR, &format!("saga db: {error}")).await;
            return;
        }
        Ok(None) => {
            fail(db, file_id, STAGE_LEDGER_ANCHOR, "file row vanished mid-saga").await;
            return;
        }
        Ok(Some(context)) => {
            let gateway = match LedgerClient::from_env() {
                Ok(client) => client,
                Err(detail) => {
                    // No gateway client at all (config, not network):
                    // same posture as a down gateway — pending, continue.
                    let _ = db.anchor_file_pending(file_id).await;
                    job(
                        db,
                        file_id,
                        STAGE_LEDGER_ANCHOR,
                        &format!("ledger gateway unconfigured ({detail}); parked as pending (D5)"),
                    )
                    .await;
                    return;
                }
            };
            let actor = match context.uploaded_by {
                None => None,
                Some(user_id) => db.ledger_id_for(&user_id).await.unwrap_or(None),
            };
            match actor {
                None => {
                    let _ = db.anchor_file_skipped(file_id).await;
                    "skipped_no_identity: uploader has no profiles.ledger_id (D33)".to_string()
                }
                Some(actor) => {
                    match gateway.anchor(sha256, &context.case_id.to_string(), &actor).await {
                        Ok(receipt) => {
                            let _ = db.anchor_file_success(file_id, &receipt.tx_id).await;
                            format!("anchored as {}", receipt.tx_id)
                        }
                        Err(detail) => {
                            let _ = db.anchor_file_pending(file_id).await;
                            format!("gateway unreachable; parked as pending (D5): {detail}")
                        }
                    }
                }
            }
        }
    };
    job(db, file_id, STAGE_LEDGER_ANCHOR, &detail).await;
}

/// One `ok` job row. Failures of the row write itself are traced —
/// the saga cannot report a reporting failure anywhere else.
async fn job(db: &SagaDb, file_id: &Uuid, stage: &str, detail: &str) {
    if let Err(error) = db.write_job(file_id, stage, JOB_OK, Some(detail)).await {
        tracing::warn!(%file_id, stage, %error, "saga job row write failed");
    }
}

/// Routing result: text to hand off, or a stopped run (whose status
/// and job row are already recorded).
enum RouteOutcome {
    Proceed(String),
    Stop,
}

async fn route_pdf(
    db: &SagaDb,
    blob: &BlobStore,
    file_id: &Uuid,
    sha256: &str,
) -> RouteOutcome {
    let bytes = match blob.read(sha256).await {
        Ok(bytes) => bytes,
        Err(error) => {
            fail(
                db,
                file_id,
                STAGE_TEXT_EXTRACTION,
                &format!("stored blob missing for {sha256}: refusing substitute bytes ({error})"),
            )
            .await;
            return RouteOutcome::Stop;
        }
    };
    // D35: non-empty lopdf text means a digital PDF.
    if let Some(text) = extract_pdf_text(&bytes) {
        if db.set_extracted_text(file_id, &text, FileStatus::Extracting.as_str()).await.is_err() {
            fail(db, file_id, STAGE_TEXT_EXTRACTION, "saga db unavailable").await;
            return RouteOutcome::Stop;
        }
        job(db, file_id, STAGE_TEXT_EXTRACTION, "digital PDF: lopdf text used directly (D35)")
            .await;
        return RouteOutcome::Proceed(text);
    }
    // Scanned PDF: same path as images from here on.
    if db.set_status(file_id, FileStatus::Recognising.as_str()).await.is_err() {
        fail(db, file_id, STAGE_OCR, "saga db unavailable").await;
        return RouteOutcome::Stop;
    }
    job(db, file_id, STAGE_MIME_ROUTING, "scanned PDF: routing to docs-lane OCR (D35)").await;
    ocr_into_handoff(db, blob, file_id, sha256, "application/pdf").await
}

async fn route_image(
    db: &SagaDb,
    blob: &BlobStore,
    file_id: &Uuid,
    sha256: &str,
    mime_type: &str,
) -> RouteOutcome {
    if db.set_status(file_id, FileStatus::Recognising.as_str()).await.is_err() {
        fail(db, file_id, STAGE_OCR, "saga db unavailable").await;
        return RouteOutcome::Stop;
    }
    job(db, file_id, STAGE_MIME_ROUTING, "image: routing to docs-lane OCR").await;
    // The blob read happens inside the OCR step; a missing blob fails
    // there, loudly, rather than here.
    ocr_into_handoff(db, blob, file_id, sha256, mime_type).await
}

/// Run OCR and, on success, stage the text for handoff. Any OCR error
/// — connection-refused (lane not yet serving) or otherwise — stops
/// the run with the message on the job row (rule 9, API_CONTRACTS
/// §4.5): there is no text to hand off.
async fn ocr_into_handoff(
    db: &SagaDb,
    blob: &BlobStore,
    file_id: &Uuid,
    sha256: &str,
    mime: &str,
) -> RouteOutcome {
    let bytes = match blob.read(sha256).await {
        Ok(bytes) => bytes,
        Err(error) => {
            fail(
                db,
                file_id,
                STAGE_OCR,
                &format!("stored blob missing for {sha256}: refusing substitute bytes ({error})"),
            )
            .await;
            return RouteOutcome::Stop;
        }
    };
    let client = match ocr_client() {
        Ok(client) => client,
        Err(detail) => {
            fail(db, file_id, STAGE_OCR, &detail).await;
            return RouteOutcome::Stop;
        }
    };
    match client.ocr(&bytes, mime).await {
        Ok(text) => {
            if db.set_extracted_text(file_id, &text, FileStatus::Extracting.as_str()).await.is_err()
            {
                fail(db, file_id, STAGE_OCR, "saga db unavailable").await;
                return RouteOutcome::Stop;
            }
            job(db, file_id, STAGE_OCR, "docs-lane OCR text staged for handoff").await;
            RouteOutcome::Proceed(text)
        }
        Err(message) => {
            fail(db, file_id, STAGE_OCR, &message).await;
            RouteOutcome::Stop
        }
    }
}

/// Structured files (D36 amendment): no model path, no direct commit.
/// The file is queued for human schema-mapping review and the run ends
/// here — extraction happens only after a person confirms the mapping.
async fn route_structured(db: &SagaDb, blob: &BlobStore, file_id: &Uuid, sha256: &str) {
    let crop_path = blob.path_for(sha256).to_string_lossy().to_string();
    if db.insert_structured_review(file_id, &crop_path).await.is_err() {
        fail(db, file_id, STAGE_MIME_ROUTING, "saga db unavailable").await;
        return;
    }
    if db.set_status(file_id, FileStatus::NeedsReview.as_str()).await.is_err() {
        fail(db, file_id, STAGE_MIME_ROUTING, "saga db unavailable").await;
        return;
    }
    job(
        db,
        file_id,
        STAGE_MIME_ROUTING,
        "structured file queued for schema mapping review (D36)",
    )
    .await;
}

/// Step 8: hand extracted text to steps 7-9. Reviewed-ness is whatever
/// the existing gate decides (currently a documented no-op until the
/// S3 per-script table lands — see `step8_review_gate`): this step
/// passes `Accepted` (machine text proceeding as-is) because the run
/// would otherwise have no reason to exist, and records where the text
/// actually stands on the job row.
async fn step_handoff(
    db: &Arc<SagaDb>,
    ledger: &Arc<dyn LedgerAnchor + Send + Sync>,
    graph: &Arc<dyn GraphWriter + Send + Sync>,
    extraction: &Arc<dyn ExtractionClient + Send + Sync>,
    file_id: Uuid,
    text: String,
) {
    let context = match db.file_context(&file_id).await {
        Ok(Some(context)) => context,
        Ok(None) => {
            fail(db, &file_id, STAGE_HANDOFF, "file row vanished before handoff").await;
            return;
        }
        Err(error) => {
            fail(db, &file_id, STAGE_HANDOFF, &format!("saga db: {error}")).await;
            return;
        }
    };
    let provenance = match context.provenance.as_str() {
        "benchmark" => Provenance::Benchmark,
        "collected" => Provenance::Collected,
        "synthetic" => Provenance::Synthetic,
        other => {
            // The column is a Postgres enum, so this is unreachable in
            // practice — but a corrupt row must fail loud (rule 9),
            // never default to a corpus (rule 7, D19).
            fail(
                db,
                &file_id,
                STAGE_HANDOFF,
                &format!("unknown provenance on source_files: {other}"),
            )
            .await;
            return;
        }
    };
    // Case-clock note (rule 3, D16): file text carries no frame clock,
    // so `source_ts` is None and relationship `occurred_at` stays None
    // until a dated source provides one. No wall-clock is substituted.
    let outcome = run_steps_7_to_9(
        extraction.as_ref(),
        db.as_ref(),
        graph.as_ref(),
        ledger.as_ref(),
        IngestInput {
            file_id,
            case_id: context.case_id,
            confirmed_text: text,
            disposition: ReviewDisposition::Accepted,
            source_ts: None,
            provenance,
        },
    )
    .await;
    match outcome {
        StepOutcome::Committed { .. } => {
            // Status and the extraction-anchor row were written inside
            // steps 7-9 (`record_ledger`); nothing further to record.
        }
        StepOutcome::NeedsReview { reason } => {
            job(db, &file_id, STAGE_HANDOFF, &format!("queued for review: {reason}")).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_routing_covers_the_task_vocabulary() {
        assert_eq!(classify_mime("application/pdf"), MimeRoute::Pdf);
        assert_eq!(classify_mime("image/png"), MimeRoute::Image);
        assert_eq!(classify_mime("image/jpeg"), MimeRoute::Image);
        assert_eq!(classify_mime("text/csv"), MimeRoute::Structured);
        assert_eq!(classify_mime("application/json"), MimeRoute::Structured);
        assert_eq!(classify_mime("application/vnd.ms-excel"), MimeRoute::Structured);
        assert_eq!(
            classify_mime(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
            MimeRoute::Structured
        );
        assert_eq!(classify_mime("application/octet-stream"), MimeRoute::Unsupported);
        assert_eq!(classify_mime("text/plain"), MimeRoute::Unsupported);
        assert_eq!(classify_mime(""), MimeRoute::Unsupported);
    }

    #[test]
    fn pdf_text_probe_rejects_non_pdf_bytes() {
        assert_eq!(extract_pdf_text(b""), None);
        assert_eq!(extract_pdf_text(b"definitely not a pdf"), None);
        assert_eq!(extract_pdf_text(b"%PDF-1.4 truncated"), None);
    }
}
