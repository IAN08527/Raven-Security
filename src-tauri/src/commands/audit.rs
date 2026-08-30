use raven_core::{AppState, AuditEntry, EdgeEvidence, ReviewResult, VerifyResult};
use tauri::State;

#[tauri::command]
pub async fn get_edge_evidence(
    state: State<'_, AppState>,
    rel_id: String,
) -> Result<EdgeEvidence, String> {
    // Postgres only — clicking an edge must never re-query the graph (§6.2).
    // Audit `file.read` is best-effort.
    let (relationship, evidence, source_files) =
        raven_core::db::graph::edge_evidence_pg(&state.pg, &rel_id).await?;
    let _ = raven_core::audit::emit(
        state.inner(),
        "file.read",
        "relationship",
        &rel_id,
        &format!("{{\"evidence_rows\":{}}}", evidence.len()),
    )
    .await;
    Ok(EdgeEvidence {
        relationship,
        evidence,
        source_files,
    })
}

#[tauri::command]
pub async fn verify_evidence(
    state: State<'_, AppState>,
    file_id: String,
) -> Result<VerifyResult, String> {
    let local_sha = "0".repeat(64);
    let url = format!("{}/ledger/verify/{}?sha={}", state.ledger_base, file_id, local_sha);
    let resp = state.http.get(&url).send().await.map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(VerifyResult {
        matched: body["match"].as_bool().unwrap_or(false),
        local_sha,
        chain_sha: body["txId"].as_str().unwrap_or("").into(),
        tx_id: body["txId"].as_str().unwrap_or("").into(),
        anchored_at: body["anchoredAt"].as_str().unwrap_or("").into(),
    })
}

#[tauri::command]
pub async fn review_insight(
    _state: State<'_, AppState>,
    object_type: String,
    object_id: String,
    action: String,
    note: Option<String>,
) -> Result<ReviewResult, String> {
    // Backlog #8: write pg + ledger.
    Ok(ReviewResult {
        review_id: 0,
        tx_id: "".into(),
    })
}

#[tauri::command]
pub async fn get_audit_trail(
    _state: State<'_, AppState>,
    object_id: String,
) -> Result<Vec<AuditEntry>, String> {
    // Backlog #8.
    Ok(vec![])
}
