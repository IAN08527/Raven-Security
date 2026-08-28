use raven_core::{AppState, AuditEntry, EdgeEvidence, ReviewResult, VerifyResult};
use tauri::State;

#[tauri::command]
pub async fn get_edge_evidence(
    _state: State<'_, AppState>,
    rel_id: String,
) -> Result<EdgeEvidence, String> {
    // Backlog #8: read evidence + source_files for the edge (Postgres only).
    Ok(EdgeEvidence {
        evidence: vec![],
        source_files: vec![],
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
pub async fn list_anomalies(
    _state: State<'_, AppState>,
    case_id: String,
    status: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    // Backlog #5.
    Ok(vec![])
}

#[tauri::command]
pub async fn get_audit_trail(
    _state: State<'_, AppState>,
    object_id: String,
) -> Result<Vec<AuditEntry>, String> {
    // Backlog #8.
    Ok(vec![])
}
