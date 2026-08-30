//! CCTV Re-ID lock-on persistence + ledger anchor (Backlog #5, Phase 2 / D9).
//!
//! A lock-on is an accountable act: the engine builds the 512-d fingerprint,
//! this module writes it as a `reid_targets` row, anchors the act on the ledger,
//! and records it in `audit_log`. Ledger downtime degrades to `pending` (D4) —
//! it never blocks or rolls back the already-committed target row.

use crate::AppState;
use sha2::{Digest, Sha256};

pub struct LockOutcome {
    pub target_id: String,
    pub tx_id: String,
    pub ledger_status: String,
}

/// Persist + anchor a lock-on. `case`/`camera_code` accept a UUID or a code.
/// `feature_literal` is the engine's pgvector text literal ('[..]'); `feature_b64`
/// is the same vector base64-encoded and feeds the anchored payload hash.
#[allow(clippy::too_many_arguments)]
pub async fn lock_on(
    state: &AppState,
    case: &str,
    label: &str,
    camera_code: &str,
    source_ts: &str,
    feature_literal: &str,
    feature_b64: &str,
    thumbnail_path: Option<&str>,
) -> Result<LockOutcome, String> {
    let case_uuid = crate::db::postgres::resolve_case_id(&state.pg, case).await?;
    let camera_uuid = crate::db::postgres::resolve_camera_id(&state.pg, camera_code).await?;

    let target_id = crate::db::postgres::insert_reid_target(
        &state.pg,
        &case_uuid,
        label,
        feature_literal,
        &camera_uuid,
        source_ts,
        thumbnail_path,
    )
    .await?;

    // The payload hash binds the identity of the anchored act (D9).
    let payload = format!("{target_id}|{camera_uuid}|{source_ts}|{feature_b64}");
    let mut hasher = Sha256::new();
    hasher.update(payload.as_bytes());
    let payload_hash = format!("{:x}", hasher.finalize());

    // Ledger anchoring is best-effort (D4): an outage yields `pending`, no crash.
    let tx = crate::ledger::log_action(
        state,
        &uuid::Uuid::new_v4().to_string(),
        "reid.lock",
        "reid_target",
        &target_id,
        &payload_hash,
        &state.badge,
    )
    .await
    .unwrap_or_default();

    let (tx_opt, ledger_status): (Option<&str>, &str) = if tx.is_empty() {
        (None, "pending")
    } else {
        (Some(tx.as_str()), "anchored")
    };

    crate::db::postgres::insert_audit_log(
        &state.pg,
        "reid.lock",
        "reid_target",
        &target_id,
        &payload_hash,
        tx_opt,
        ledger_status,
    )
    .await?;
    let _ = crate::db::postgres::set_reid_target_ledger(&state.pg, &target_id, tx_opt).await;

    Ok(LockOutcome {
        target_id,
        tx_id: tx,
        ledger_status: ledger_status.to_string(),
    })
}
