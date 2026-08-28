use crate::AppState;
use serde_json::json;

/// Anchor a file's SHA-256 on the ledger (saga step 4). Returns the tx id.
pub async fn anchor(
    state: &AppState,
    doc_id: &str,
    sha256: &str,
    case_code: &str,
    source_node: &str,
    badge: &str,
) -> Result<String, String> {
    let url = format!("{}/ledger/anchor", state.ledger_base);
    let resp = state
        .http
        .post(&url)
        .json(&json!({
            "docId": doc_id,
            "sha256": sha256,
            "caseCode": case_code,
            "sourceNode": source_node,
            "badge": badge,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body["txId"].as_str().unwrap_or("").to_string())
}

/// Append an officer action to the ledger (saga step 10). Returns the tx id.
pub async fn log_action(
    state: &AppState,
    action_id: &str,
    action: &str,
    object_type: &str,
    object_id: &str,
    payload_hash: &str,
    badge: &str,
) -> Result<String, String> {
    let url = format!("{}/ledger/action", state.ledger_base);
    let resp = state
        .http
        .post(&url)
        .json(&json!({
            "actionId": action_id,
            "action": action,
            "objectType": object_type,
            "objectId": object_id,
            "payloadHash": payload_hash,
            "badge": badge,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body["txId"].as_str().unwrap_or("").to_string())
}
