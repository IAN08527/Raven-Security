use raven_core::{AppState, LockResult, RoutineResult, TrackingResult};
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
) -> Result<LockResult, String> {
    let url = format!("http://127.0.0.1:8756/cv/session/{}/lock_on", session_id);
    let resp = state
        .http
        .post(url)
        .json(&json!({"track_id": track_id}))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(LockResult {
        target_id: body["target_vector_b64"].as_str().unwrap_or("").into(),
        tx_id: "".into(),
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
