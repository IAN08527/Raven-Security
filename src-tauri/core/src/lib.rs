pub mod audit;
pub mod db;
pub mod ledger;
pub mod model;
pub mod reid;
pub mod saga;

use serde::Serialize;

/// Shared application state. Deliberately free of any Tauri type so the
/// ingest/saga logic can be exercised from a headless CLI (see
/// `tools/raven_saga_cli`) as well as from the Tauri GUI.
pub struct AppState {
    pub pg: sqlx::PgPool,
    /// Neo4j is optional: the saga degrades gracefully (marks relationships
    /// `sync_state='pending'`) when the graph store is not reachable.
    pub neo: Option<neo4rs::Graph>,
    pub http: reqwest::Client,
    /// Supabase Storage client (cloud blob store). `None` when env is absent.
    pub storage: Option<db::storage::SupabaseStorage>,
    pub ledger_base: String,
    /// Officer badge used when anchoring actions on the ledger.
    pub badge: String,
}

#[derive(Serialize)]
pub struct HealthStatus {
    pub supabase: String,
    pub neo4j: String,
    pub ollama: String,
    pub fabric: String,
    pub python: String,
    pub vram_free_mb: f64,
}

#[derive(Serialize)]
pub struct EgoGraph {
    pub nodes: Vec<serde_json::Value>,
    pub edges: Vec<serde_json::Value>,
}

#[derive(Serialize)]
pub struct IngestResult {
    pub job_id: i64,
    pub file_id: String,
}

#[derive(Serialize)]
pub struct IngestStatus {
    pub stage: String,
    pub status: String,
    pub error_detail: Option<String>,
}

#[derive(Serialize)]
pub struct EdgeEvidence {
    pub evidence: Vec<serde_json::Value>,
    pub source_files: Vec<serde_json::Value>,
}

#[derive(Serialize)]
pub struct VerifyResult {
    pub matched: bool,
    pub local_sha: String,
    pub chain_sha: String,
    pub tx_id: String,
    pub anchored_at: String,
}

#[derive(Serialize)]
pub struct ReviewResult {
    pub review_id: i64,
    pub tx_id: String,
}

#[derive(Serialize)]
pub struct RoutineResult {
    pub points: Vec<serde_json::Value>,
    pub hotspots: Vec<serde_json::Value>,
    pub loop_: Vec<serde_json::Value>,
}

#[derive(Serialize)]
pub struct TrackingResult {
    pub session_id: String,
    pub stream_url: String,
    pub ws_url: String,
}

#[derive(Serialize)]
pub struct LockResult {
    pub target_id: String,
    pub tx_id: String,
    pub ledger_status: String,
}

#[derive(Serialize)]
pub struct RebuildResult {
    pub nodes: usize,
    pub edges: usize,
    pub ms: u128,
}

#[derive(Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub action: String,
    pub created_at: String,
}

/// Build the full `AppState` from environment variables.
///
/// All sub-clients are built defensively: the Postgres pool is lazy (never
/// connects here), Neo4j and Supabase Storage are `Option` and only used when
/// actually reachable, so a missing service does not prevent the others from
/// being exercised (this is what lets us headless-test the saga in a sandbox).
pub async fn connect() -> Result<AppState, String> {
    let pg = db::postgres::create_pool().map_err(|e| e.to_string())?;

    let neo = {
        let uri = std::env::var("NEO4J_URI").unwrap_or_else(|_| "127.0.0.1:7687".into());
        let user = std::env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".into());
        let pass = std::env::var("NEO4J_PASS").unwrap_or_else(|_| "raven-demo-pw".into());
        match neo4rs::Graph::new(uri, user, pass).await {
            Ok(g) => Some(g),
            Err(e) => {
                tracing::warn!("Neo4j unavailable at startup: {e} (graph steps will degrade)");
                None
            }
        }
    };

    let storage = db::storage::SupabaseStorage::from_env();
    if storage.is_none() {
        tracing::warn!("Supabase Storage not configured (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
    }

    let ledger_base = std::env::var("LEDGER_BASE").unwrap_or_else(|_| "http://127.0.0.1:8801".into());
    let badge = std::env::var("RAVEN_BADGE").unwrap_or_else(|_| "MH-1188".into());

    Ok(AppState {
        pg,
        neo,
        http: reqwest::Client::new(),
        storage,
        ledger_base,
        badge,
    })
}
