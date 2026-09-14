//! Raven server binary: thin entry point over the `server` library crate.

use std::sync::Arc;

use anyhow::Result;
use server::{api, startup};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let force = std::env::args().any(|arg| arg == "--force");
    let config = Arc::new(startup::HealthConfig::from_env());

    let report = startup::check_all(&config).await;
    for dependency in &report.dependencies {
        if dependency.healthy {
            tracing::info!(dependency = dependency.name, "health check passed");
        } else {
            tracing::error!(
                dependency = dependency.name,
                detail = %dependency.detail,
                "health check failed"
            );
        }
    }

    if !report.all_healthy() && !force {
        tracing::error!(
            "startup blocked: one or more dependencies are unhealthy; pass --force to start anyway"
        );
        std::process::exit(1);
    }

    // M5-T1: fetch the GoTrue JWKS on startup (loopback). A failure is
    // logged, never fatal: the cache refreshes on first use, so a slow
    // auth service cannot wedge startup (rule 9).
    let jwks = Arc::new(match server::auth::JwksCache::from_env() {
        Ok(cache) => cache,
        Err(detail) => {
            tracing::error!(detail = %detail, "auth JWKS cache unavailable; starting without verification keys");
            std::process::exit(1);
        }
    });
    if let Err(detail) = jwks.refresh().await {
        tracing::warn!(detail = %detail, "initial GoTrue JWKS fetch failed; retrying on first authenticated request");
    }
    let ledger = match server::ledger::LedgerClient::from_env() {
        Ok(client) => client,
        Err(detail) => {
            tracing::error!(detail = %detail, "ledger gateway client unavailable");
            std::process::exit(1);
        }
    };

    // Admin-managed user directory (§2.11): attached to the JWKS cache so
    // deactivation rejects tokens at verification on every endpoint.
    let users = server::auth::UsersStore::default();
    jwks.set_user_directory(users.clone());

    let app = api::router(
        config,
        api::RouterStores {
            cameras: api::cameras::CameraStore::default(),
            nodes: api::nodes::NodeStore::default(),
            targets: api::reid::TargetStore::default(),
            candidates: api::reid::CandidateStore::default(),
            reviews: api::review::ReviewStore::default(),
            entities: api::entities::EntityStore::default(),
            merges: api::entities::MergeStore::default(),
            notes: api::entities::NotesStore::default(),
            merge_graph: api::entities::ConsolidateGraph::default(),
            files: api::files::FileStore::default(),
            graph: server::graph::InMemoryGraphStore::default(),
            auth: jwks,
            ledger,
            audit: server::audit::AuditStore::default(),
            assignments: server::audit::AssignmentStore::default(),
            profiles: server::auth::ProfilesStore::default(),
            users,
        },
    );
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8443").await?;
    tracing::info!("raven-server listening on :8443");
    axum::serve(listener, app).await?;
    Ok(())
}
