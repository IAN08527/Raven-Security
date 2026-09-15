//! HTTP client for the ledger gateway (D13, D22).
//!
//! The REST boundary is what makes the mock ledger a one-flag swap: this
//! client speaks the five endpoints in API_CONTRACTS.md §5 and does not
//! know whether Fabric or the mock answers. `endorsements` is the field
//! that makes tamper-evidence meaningful -- every response type carries
//! it through so the UI can render real org signatures differently from
//! mock ones (a mock endorsement dressed as real is a misrepresentation).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

fn default_gateway_url() -> String {
    std::env::var("LEDGER_GATEWAY_URL").unwrap_or_else(|_| "http://127.0.0.1:8801".into())
}

/// One endorsement entry as returned by `GET /verify/{docId}`. `mode` is
/// `"mock"` for the development ledger and absent (or another value) for
/// real Fabric org signatures -- the UI branches on exactly this.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Endorsement {
    pub org: String,
    #[serde(default)]
    pub mode: Option<String>,
}

impl Endorsement {
    pub fn is_mock(&self) -> bool {
        self.mode.as_deref() == Some("mock")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TxReceipt {
    #[serde(rename = "txId")]
    pub tx_id: String,
    #[serde(rename = "blockNo")]
    pub block_no: u64,
    pub ts: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyResponse {
    #[serde(rename = "txId")]
    pub tx_id: String,
    pub hash: String,
    pub ts: String,
    pub endorsements: Vec<Endorsement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    #[serde(rename = "txId")]
    pub tx_id: String,
    #[serde(rename = "blockNo")]
    pub block_no: u64,
    pub ts: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub mode: String,
    #[serde(default)]
    pub orgs: Vec<String>,
    #[serde(default)]
    pub peers: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct LedgerClient {    base_url: String,
    http: reqwest::Client,
}

impl LedgerClient {
    pub fn from_env() -> Result<Self, String> {
        Self::new(default_gateway_url())
    }

    pub fn new(base_url: impl Into<String>) -> Result<Self, String> {
        let http =
            reqwest::Client::builder().timeout(Duration::from_secs(5)).build().map_err(|e| {
                format!("ledger: cannot build HTTP client for gateway: {e}")
            })?;
        Ok(Self { base_url: base_url.into().trim_end_matches('/').to_string(), http })
    }

    async fn post<T: Serialize, R: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<R, String> {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .post(&url)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("ledger: gateway request failed: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("ledger: gateway returned status {status} for {path}"));
        }
        response.json::<R>().await.map_err(|e| format!("ledger: bad gateway response: {e}"))
    }

    async fn get<R: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<R, String> {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("ledger: gateway request failed: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("ledger: gateway returned status {status} for {path}"));
        }
        response.json::<R>().await.map_err(|e| format!("ledger: bad gateway response: {e}"))
    }

    /// POST /anchor {docHash, caseId, actorLedgerId} (D5, FR-7.1).
    pub async fn anchor(
        &self,
        doc_hash: &str,
        case_id: &str,
        actor_ledger_id: &str,
    ) -> Result<TxReceipt, String> {
        self.post(
            "/anchor",
            &serde_json::json!({
                "docHash": doc_hash,
                "caseId": case_id,
                "actorLedgerId": actor_ledger_id,
            }),
        )
        .await
    }

    /// POST /action {actionType, payloadHash, objectId, caseId,
    /// actorLedgerId} (D9, FR-7.4): confirmations, rejections, merges and
    /// evidence access are signed with the actor's ledger identity.
    pub async fn action(
        &self,
        action_type: &str,
        payload_hash: &str,
        object_id: &str,
        case_id: &str,
        actor_ledger_id: &str,
    ) -> Result<TxReceipt, String> {
        self.post(
            "/action",
            &serde_json::json!({
                "actionType": action_type,
                "payloadHash": payload_hash,
                "objectId": object_id,
                "caseId": case_id,
                "actorLedgerId": actor_ledger_id,
            }),
        )
        .await
    }

    /// GET /verify/{docId} (FR-7.2): returns the anchored hash plus the
    /// endorsements that signed it.
    pub async fn verify(&self, doc_id: &str) -> Result<VerifyResponse, String> {
        self.get(&format!("/verify/{doc_id}")).await
    }

    /// GET /history/{objectId}: ordered tx list for one object.
    pub async fn history(&self, object_id: &str) -> Result<Vec<HistoryEntry>, String> {
        self.get(&format!("/history/{object_id}")).await
    }

    /// GET /health: `{mode: fabric|mock, orgs[], peers[]}`.
    pub async fn health(&self) -> Result<HealthResponse, String> {
        self.get("/health").await
    }
}
