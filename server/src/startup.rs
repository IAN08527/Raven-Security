//! Dependency health gate (M0-T8). Every dependency is checked once at
//! startup (blocking unless `--force`) and again on every `GET /health`
//! call, so the board reflects live state rather than a frozen snapshot
//! (ARCHITECTURE.md §1.2): "The health gate ... converts 'something is
//! broken and we do not know what' into a named red row."

use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
pub struct DependencyStatus {
    pub name: &'static str,
    pub healthy: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, TS)]
pub struct HealthReport {
    pub dependencies: Vec<DependencyStatus>,
}

impl HealthReport {
    pub fn all_healthy(&self) -> bool {
        self.dependencies.iter().all(|dependency| dependency.healthy)
    }
}

pub struct HealthConfig {
    pub postgres_url: String,
    pub neo4j_uri: String,
    pub neo4j_user: String,
    pub neo4j_password: String,
    pub ledger_health_url: String,
}

impl HealthConfig {
    pub fn from_env() -> Self {
        Self {
            postgres_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/postgres".into()),
            neo4j_uri: std::env::var("NEO4J_URI").unwrap_or_else(|_| "bolt://localhost:7687".into()),
            neo4j_user: std::env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".into()),
            neo4j_password: std::env::var("NEO4J_PASSWORD")
                .unwrap_or_else(|_| "ravenpassword".into()),
            ledger_health_url: std::env::var("LEDGER_HEALTH_URL")
                .unwrap_or_else(|_| "http://localhost:8801/health".into()),
        }
    }
}

const CHECK_TIMEOUT: Duration = Duration::from_secs(3);

/// Bounds a dependency probe end to end. A pool's own `acquire_timeout` or a
/// client's own request timeout only covers part of the round trip (e.g. not
/// a query issued after a connection is acquired); a stopped-but-not-yet-
/// refused peer (a killed container, mid TCP handshake) can otherwise hang
/// the probe far longer than any of the inner timeouts, which would hang
/// `GET /health` itself -- exactly the case M0-T8's kill-neo4j check exists
/// to catch.
async fn with_timeout(
    name: &'static str,
    check: impl std::future::Future<Output = Result<(), String>>,
) -> DependencyStatus {
    match tokio::time::timeout(CHECK_TIMEOUT, check).await {
        Ok(Ok(())) => DependencyStatus { name, healthy: true, detail: "ok".into() },
        Ok(Err(detail)) => DependencyStatus { name, healthy: false, detail },
        Err(_) => DependencyStatus {
            name,
            healthy: false,
            detail: format!("timed out after {CHECK_TIMEOUT:?}"),
        },
    }
}

async fn check_postgres(url: &str) -> DependencyStatus {
    with_timeout("postgres", async {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(CHECK_TIMEOUT)
            .connect(url)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("SELECT 1").execute(&pool).await.map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

async fn check_neo4j(uri: &str, user: &str, password: &str) -> DependencyStatus {
    with_timeout("neo4j", async {
        let config = neo4rs::ConfigBuilder::default()
            .uri(uri)
            .user(user)
            .password(password)
            .build()
            .map_err(|e| e.to_string())?;
        let graph = neo4rs::Graph::connect(config).await.map_err(|e| e.to_string())?;
        let mut stream =
            graph.execute(neo4rs::query("RETURN 1")).await.map_err(|e| e.to_string())?;
        stream.next().await.map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

async fn check_ledger(url: &str) -> DependencyStatus {
    with_timeout("ledger", async {
        let client = reqwest::Client::builder()
            .timeout(CHECK_TIMEOUT)
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("status {}", resp.status()))
        }
    })
    .await
}

pub async fn check_all(config: &HealthConfig) -> HealthReport {
    let (postgres, neo4j, ledger) = tokio::join!(
        check_postgres(&config.postgres_url),
        check_neo4j(&config.neo4j_uri, &config.neo4j_user, &config.neo4j_password),
        check_ledger(&config.ledger_health_url),
    );
    HealthReport { dependencies: vec![postgres, neo4j, ledger] }
}
