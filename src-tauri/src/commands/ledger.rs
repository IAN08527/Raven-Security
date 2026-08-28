use raven_core::db::postgres as pg;
use raven_core::{AppState, HealthStatus};
use neo4rs::query;
use tauri::State;

#[tauri::command]
pub async fn health_check(state: State<'_, AppState>) -> Result<HealthStatus, String> {
    // Supabase (cloud Postgres) — real liveness probe.
    let supabase = if pg::pg_health(&state.pg).await {
        "up"
    } else {
        "down"
    }
    .to_string();

    // Neo4j — best-effort probe (local Docker, not part of the storage baseline).
    let neo4j = match &state.neo {
        Some(neo) => match tokio::time::timeout(
            std::time::Duration::from_secs(2),
            neo.execute(query("RETURN 1 AS ok")),
        )
        .await
        {
            Ok(Ok(_)) => "up",
            _ => "down",
        }
        .to_string(),
        None => "down".to_string(),
    };

    // Ollama — best-effort probe (local LLM, not part of the storage baseline).
    let ollama = match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        state.http.get("http://127.0.0.1:11434/api/tags").send(),
    )
    .await
    {
        Ok(Ok(r)) if r.status().is_success() => "up",
        _ => "down",
    }
    .to_string();

    let python = match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        state.http.get("http://127.0.0.1:8756/health").send(),
    )
    .await
    {
        Ok(Ok(r)) if r.status().is_success() => "up",
        _ => "down",
    }
    .to_string();

    let fabric = match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        state.http.get(format!("{}/health", state.ledger_base)).send(),
    )
    .await
    {
        Ok(Ok(r)) if r.status().is_success() => "up",
        _ => "down",
    }
    .to_string();

    Ok(HealthStatus {
        supabase,
        neo4j,
        ollama,
        fabric,
        python,
        vram_free_mb: 0.0,
    })
}
