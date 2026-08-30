use raven_core::{AppState, ConfirmResult, LockResult, RoutineResult, TrackingResult};
use serde_json::json;
use tauri::State;

#[tauri::command]
pub async fn start_tracking(
    state: State<'_, AppState>,
    camera_code: String,
) -> Result<TrackingResult, String> {
    let url = "http://127.0.0.1:8756/cv/session/start";
    let resp = state
        .http
        .post(url)
        .json(&json!({"camera_code": camera_code, "feed_uri": ""}))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(TrackingResult {
        session_id: body["session_id"].as_str().unwrap_or("").into(),
        stream_url: body["stream_url"].as_str().unwrap_or("").into(),
        ws_url: body["ws_url"].as_str().unwrap_or("").into(),
    })
}

#[tauri::command]
pub async fn lock_on_target(
    state: State<'_, AppState>,
    session_id: String,
    track_id: u32,
    label: String,
    case_id: String,
    entity_id: Option<String>,
) -> Result<LockResult, String> {
    // 1. Engine builds the fingerprint from the officer's live frame.
    let url = format!("http://127.0.0.1:8756/cv/session/{}/lock_on", session_id);
    let resp = state
        .http
        .post(url)
        .json(&json!({"track_id": track_id}))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    if !body["ok"].as_bool().unwrap_or(false) {
        return Err("engine lock_on failed (no frame available)".into());
    }
    let feature_literal = body["feature_literal"].as_str().unwrap_or("");
    let feature_b64 = body["target_vector_b64"].as_str().unwrap_or("");
    let camera_code = body["source_camera_code"].as_str().unwrap_or(&session_id);
    let source_ts = body["source_ts"].as_str().unwrap_or("");
    let thumbnail_path = body["thumbnail_path"].as_str().filter(|s| !s.is_empty());
    if feature_literal.is_empty() || source_ts.is_empty() {
        return Err("engine lock_on returned an incomplete payload".into());
    }

    // 2. Persist the target + anchor the act on the ledger (D9).
    let outcome = raven_core::reid::lock_on(
        state.inner(),
        &case_id,
        &label,
        camera_code,
        source_ts,
        feature_literal,
        feature_b64,
        thumbnail_path,
        entity_id.as_deref().filter(|s| !s.is_empty()),
    )
    .await?;

    // 3. Arm the engine's live match loop with the anchored target (Phase 3).
    //    Best-effort: the durable target + ledger anchor are already committed,
    //    so a registry hiccup must not fail the officer's lock-on.
    let reg = "http://127.0.0.1:8756/cv/targets/register";
    let _ = state
        .http
        .post(reg)
        .json(&json!({
            "target_id": outcome.target_id.as_str(),
            "feature_b64": feature_b64,
            "case_id": case_id.as_str(),
            "source_camera": camera_code,
        }))
        .send()
        .await;

    Ok(LockResult {
        target_id: outcome.target_id,
        tx_id: outcome.tx_id,
        ledger_status: outcome.ledger_status,
    })
}

/// Confirm or reject a downstream Re-ID sighting (Phase 5, FR-2.3). A confirm is
/// an accountable act that mints `cctv_sighting` evidence and thickens the linked
/// entity's graph edges (+10, §5.3); a reject records the review only.
#[tauri::command]
pub async fn confirm_sighting(
    state: State<'_, AppState>,
    sighting_id: i64,
    action: String,
    note: Option<String>,
) -> Result<ConfirmResult, String> {
    if action != "confirm" && action != "reject" {
        return Err(format!("invalid review action: {action}"));
    }
    let outcome =
        raven_core::reid::confirm_sighting(state.inner(), sighting_id, &action, note.as_deref())
            .await?;
    Ok(ConfirmResult {
        review_id: outcome.review_id,
        tx_id: outcome.tx_id,
        ledger_status: outcome.ledger_status,
        edges_bumped: outcome.edges_bumped,
        evidence_written: outcome.evidence_written,
    })
}

#[tauri::command]
pub async fn stop_tracking(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<serde_json::Value, String> {
    let url = format!("http://127.0.0.1:8756/cv/session/{}/stop", session_id);
    let resp = state.http.post(url).send().await.map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body)
}

#[tauri::command]
pub async fn get_routine(
    state: State<'_, AppState>,
    entity_id: String,
    from: String,
    to: String,
) -> Result<RoutineResult, String> {
    let url = "http://127.0.0.1:8756/analytics/routine";
    let resp = state
        .http
        .post(url)
        .json(&json!({"entity_id": entity_id, "from": from, "to": to}))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(RoutineResult {
        points: body["points"].as_array().cloned().unwrap_or_default(),
        hotspots: body["hotspots"].as_array().cloned().unwrap_or_default(),
        loop_: body["loop"].as_array().cloned().unwrap_or_default(),
    })
}
