use raven_core::saga::{run_ingest_saga, Progress};
use raven_core::{AppState, IngestResult, IngestStatus};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn ingest_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    case_id: String,
    source: String,
) -> Result<IngestResult, String> {
    let outcome = run_ingest_saga(state.inner(), &path, &case_id, &source, &mut |p: Progress| {
        let _ = app.emit(
            "ingest_progress",
            serde_json::json!({ "stage": p.stage, "pct": p.pct, "note": p.note }),
        );
    })
    .await?;

    let _ = app.emit(
        "ingest_complete",
        serde_json::json!({
            "file_id": outcome.file_id,
            "entities": outcome.entities,
            "relationships": outcome.relationships,
            "neo4j_synced": outcome.neo4j_synced,
            "ledger_anchored": outcome.ledger_anchored,
        }),
    );

    Ok(IngestResult {
        job_id: outcome.job_id,
        file_id: outcome.file_id,
    })
}

#[tauri::command]
pub async fn get_ingest_status(
    state: State<'_, AppState>,
    job_id: i64,
) -> Result<IngestStatus, String> {
    let (stage, status, error_detail) =
        raven_core::db::postgres::get_ingest_job(&state.pg, job_id).await?;
    Ok(IngestStatus {
        stage,
        status,
        error_detail,
    })
}
