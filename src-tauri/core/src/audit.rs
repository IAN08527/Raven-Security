use crate::AppState;
use sha2::{Digest, Sha256};

/// Emit an audit entry: hash the payload, write `audit_log`, and anchor the
/// action on the ledger (best-effort — ledger downtime must not block ingest).
pub async fn emit(
    state: &AppState,
    action: &str,
    object_type: &str,
    object_id: &str,
    payload: &str,
) -> Result<(), String> {
    let mut hasher = Sha256::new();
    hasher.update(payload.as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    let _ = sqlx::query(
        "INSERT INTO audit_log (action, object_type, object_id, payload_hash) VALUES ($1,$2,$3,$4)",
    )
    .bind(action)
    .bind(object_type)
    .bind(object_id)
    .bind(&hash)
    .execute(&state.pg)
    .await;

    // Ledger anchoring of the audit action is best-effort: a ledger outage
    // must never block (or roll back) an already-committed ingest.
    let _ = crate::ledger::log_action(
        state,
        &uuid::Uuid::new_v4().to_string(),
        action,
        object_type,
        object_id,
        &hash,
        &state.badge,
    )
    .await;
    Ok(())
}
