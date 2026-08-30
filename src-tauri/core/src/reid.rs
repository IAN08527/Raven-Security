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
/// `entity_id` (optional) links the target to a case entity so a later confirmed
/// sighting can bump that entity's graph edges (Phase 5, recommendation B).
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
    entity_id: Option<&str>,
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

    // Optional identity link — a confirmed sighting scores this entity's edges.
    let _ = crate::db::postgres::set_reid_target_entity(&state.pg, &target_id, entity_id).await;

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

pub struct ConfirmOutcome {
    pub review_id: i64,
    pub tx_id: String,
    pub ledger_status: String,
    /// Graph edges whose weight was recomputed (0 for reject or unlinked target).
    pub edges_bumped: usize,
    /// `cctv_sighting` evidence rows written.
    pub evidence_written: usize,
}

/// Confirm or reject a downstream sighting (Phase 5, FR-2.3). Both are accountable,
/// ledger-anchored acts: they stamp `insight_reviews` + `audit_log`. A **confirm**
/// additionally sets `reid_sightings.confirmed_by` and — when the target is linked
/// to an entity — mints one `cctv_sighting` evidence row per graph edge touching
/// that entity, then recomputes each edge's weight (+10 base, §5.3/§7.1). A
/// **reject** records the review only; no evidence, no weight change. Ledger
/// downtime degrades to `pending` (D4) and never blocks the committed rows.
pub async fn confirm_sighting(
    state: &AppState,
    sighting_id: i64,
    action: &str, // "confirm" | "reject"
    note: Option<&str>,
) -> Result<ConfirmOutcome, String> {
    let confirm = action == "confirm";
    let officer_id = crate::db::postgres::resolve_officer_id(&state.pg, &state.badge).await?;
    let sighting = crate::db::postgres::get_sighting(&state.pg, sighting_id).await?;

    // Idempotency: a confirmed sighting already minted its evidence + edge bump.
    // Re-confirming (double-click, retry) must not double-count — there is no
    // enclosing transaction, so guard here.
    if confirm && sighting.already_confirmed {
        return Err(format!("sighting {sighting_id} already confirmed"));
    }

    // The payload hash binds the identity of the anchored review act (FR-2.3).
    let payload = format!(
        "{sighting_id}|{action}|{}|{:.4}",
        sighting.target_id, sighting.similarity
    );
    let mut hasher = Sha256::new();
    hasher.update(payload.as_bytes());
    let payload_hash = format!("{:x}", hasher.finalize());

    // Ledger anchoring is best-effort (D4): an outage yields `pending`, no crash.
    let ledger_action = if confirm { "reid.confirm" } else { "reid.reject" };
    let tx = crate::ledger::log_action(
        state,
        &uuid::Uuid::new_v4().to_string(),
        ledger_action,
        "sighting",
        &sighting_id.to_string(),
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

    // The human-review record (FR-2.3) + the anchored-act audit row (mirrors lock).
    let review_id = crate::db::postgres::insert_insight_review(
        &state.pg,
        "sighting",
        &sighting_id.to_string(),
        action,
        note,
        &officer_id,
        tx_opt,
    )
    .await?;
    crate::db::postgres::insert_audit_log(
        &state.pg,
        ledger_action,
        "sighting",
        &sighting.target_id, // object_id is uuid-typed; anchor to the parent target
        &payload_hash,
        tx_opt,
        ledger_status,
    )
    .await?;

    let mut edges_bumped = 0usize;
    let mut evidence_written = 0usize;
    if confirm {
        crate::db::postgres::set_sighting_confirmed(&state.pg, sighting_id, &officer_id).await?;

        // Feed the graph: a confirmed sighting corroborates every edge touching
        // the target's linked entity (recommendation B). Unlinked target → the
        // confirm still stands as an act, but there is no edge to score yet.
        if let Some(entity_id) = sighting.entity_id.as_deref() {
            let rels = crate::db::postgres::relationships_for_entity(
                &state.pg,
                &sighting.case_id,
                entity_id,
            )
            .await?;
            let snippet = format!(
                "CCTV Re-ID sighting (sim {:.2}) confirmed by {}",
                sighting.similarity, state.badge
            );
            for rel in &rels {
                crate::db::postgres::insert_cctv_evidence(
                    &state.pg,
                    rel,
                    entity_id,
                    &snippet,
                    sighting.similarity,
                )
                .await?;
                evidence_written += 1;
                // recompute is best-effort: a bump failure must not undo the
                // committed evidence/review (D4).
                if crate::db::postgres::call_recompute_weight(&state.pg, rel)
                    .await
                    .is_ok()
                {
                    edges_bumped += 1;
                }
            }
        }
    }

    Ok(ConfirmOutcome {
        review_id,
        tx_id: tx,
        ledger_status: ledger_status.to_string(),
        edges_bumped,
        evidence_written,
    })
}
