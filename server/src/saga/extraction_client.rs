//! HTTP docs-lane clients (API_CONTRACTS.md §4.5, D33).
//!
//! The docs-lane HTTP service does not exist yet, so until it does every
//! call here fails with connection-refused. That outcome is specified,
//! not exceptional: both clients convert transport failure into a
//! descriptive `Err` (rule 9 — the saga records the message on a job
//! row and stops, never panics, never retries blindly). No third-party
//! traffic is involved: the only host ever dialled is the loopback
//! `DOCS_LANE_URL` (rule 6).

use std::time::Duration;

use time::OffsetDateTime;

use crate::saga::ingest::{ExtractionClient, ExtractionFailure, ExtractionResult};

/// `DOCS_LANE_URL` default (API_CONTRACTS.md §4.5). Shared with the
/// saga task (`ingest_upload.rs`), which builds its OCR client from the
/// same value rather than duplicating the string.
pub const DEFAULT_DOCS_LANE_URL: &str = "http://localhost:8757";

/// How long one docs-lane call may take before it is a failure.
/// Same precedent as the ledger gateway client (5s has proven too short
/// for document work once, so this is generous); the lane is loopback,
/// so a timeout means "not running", not "slow network".
const DOCS_LANE_TIMEOUT: Duration = Duration::from_secs(120);

fn unreachable_message(url: &str) -> String {
    format!("docs-lane unreachable at {url} — is it running? See DEPLOYMENT.md §docs-lane")
}

/// Extraction client: confirmed text in, entities/identifiers out.
#[derive(Debug, Clone)]
pub struct DocsLaneClient {
    base_url: String,
    http: reqwest::Client,
}

/// OCR client: file bytes in, recognised text out.
#[derive(Debug, Clone)]
pub struct DocsLaneOcrClient {
    base_url: String,
    http: reqwest::Client,
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(DOCS_LANE_TIMEOUT)
        .build()
        .map_err(|e| format!("docs-lane: cannot build HTTP client: {e}"))
}

impl DocsLaneClient {
    pub fn new(base_url: String) -> Result<Self, String> {
        Ok(Self { base_url: base_url.trim_end_matches('/').to_string(), http: http_client()? })
    }

    pub fn from_env() -> Result<Self, String> {
        Self::new(
            std::env::var("DOCS_LANE_URL").unwrap_or_else(|_| DEFAULT_DOCS_LANE_URL.into()),
        )
    }

    /// Loopback base URL this client talks to (tests assert loopback).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

impl DocsLaneOcrClient {
    pub fn new(base_url: String) -> Result<Self, String> {
        Ok(Self { base_url: base_url.trim_end_matches('/').to_string(), http: http_client()? })
    }

    pub fn from_env() -> Result<Self, String> {
        Self::new(
            std::env::var("DOCS_LANE_URL").unwrap_or_else(|_| DEFAULT_DOCS_LANE_URL.into()),
        )
    }

    /// Loopback base URL this client talks to (tests assert loopback).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// POST `{base_url}/ocr` with the file bytes as multipart.
    /// `Ok(text)` is recognised text; `Err(message)` is always safe to
    /// store on a job row and show to an operator.
    pub async fn ocr(&self, bytes: &[u8], mime: &str) -> Result<String, String> {
        let url = format!("{}/ocr", self.base_url);
        let form = reqwest::multipart::Form::new().part(
            "file",
            reqwest::multipart::Part::bytes(bytes.to_vec())
                .mime_str(mime)
                .unwrap_or_else(|_| reqwest::multipart::Part::bytes(bytes.to_vec())),
        );
        let response = self.http.post(&url).multipart(form).send().await.map_err(|_| {
            unreachable_message(&self.base_url)
        })?;
        if !response.status().is_success() {
            return Err(format!(
                "docs-lane ocr failed with status {} (see ingest job row)",
                response.status()
            ));
        }
        let body: serde_json::Value =
            response.json().await.map_err(|e| format!("docs-lane ocr bad response: {e}"))?;
        body.get("text")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| "docs-lane ocr response has no text field".to_string())
    }
}

#[async_trait::async_trait]
impl ExtractionClient for DocsLaneClient {
    async fn extract(
        &self,
        confirmed_text: &str,
        _source_ts: Option<OffsetDateTime>,
    ) -> Result<ExtractionResult, ExtractionFailure> {
        // Planned contract (§4.5) is {text, source_node}; the trait
        // carries no source_node, so this sends the faithful subset.
        // source_node joins the body when the trait carries it.
        let url = format!("{}/extract", self.base_url);
        let response = self
            .http
            .post(&url)
            .json(&serde_json::json!({ "text": confirmed_text }))
            .send()
            .await
            .map_err(|_| ExtractionFailure::Quarantined {
                reason: unreachable_message(&self.base_url),
            })?;
        if !response.status().is_success() {
            return Err(ExtractionFailure::Quarantined {
                reason: format!(
                    "docs-lane extract failed with status {} (see ingest job row)",
                    response.status()
                ),
            });
        }
        response.json::<ExtractionResult>().await.map_err(|e| {
            ExtractionFailure::Quarantined { reason: format!("docs-lane bad response: {e}") }
        })
    }
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    /// The exact user-facing message the task specifies: operators see
    /// this on the job row, so the wording is pinned.
    #[tokio::test]
    async fn extract_when_down_returns_exact_message_without_panic() {
        // Nothing listens here: loopback, connection refused, hermetic.
        let client = DocsLaneClient::new("http://127.0.0.1:9".to_string())
            .expect("client builds");
        let Err(ExtractionFailure::Quarantined { reason }) =
            client.extract("some text", None).await
        else {
            panic!("a down docs-lane must fail, not succeed");
        };
        assert_eq!(
            reason,
            "docs-lane unreachable at http://127.0.0.1:9 — is it running? \
             See DEPLOYMENT.md §docs-lane"
        );
    }

    #[tokio::test]
    async fn ocr_when_down_returns_err_without_panic() {
        let client = DocsLaneOcrClient::new("http://127.0.0.1:9".to_string())
            .expect("client builds");
        let err = client.ocr(b"bytes", "application/pdf").await.expect_err("must fail");
        assert_eq!(
            err,
            "docs-lane unreachable at http://127.0.0.1:9 — is it running? \
             See DEPLOYMENT.md §docs-lane"
        );
    }

    #[tokio::test]
    async fn extract_when_up_returns_extraction_result() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/extract"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "entities": [{
                    "typ": "PERSON",
                    "canonical_name": "Ravi Kumar",
                    "char_start": 0,
                    "char_end": 10
                }],
                "identifiers": [],
                "relationships": []
            })))
            .mount(&server)
            .await;
        let client =
            DocsLaneClient::new(server.uri()).expect("client builds");
        let result = client.extract("Ravi Kumar", None).await.expect("extract works");
        assert_eq!(result.entities.len(), 1);
        assert_eq!(result.entities[0].canonical_name, "Ravi Kumar");
    }
}
