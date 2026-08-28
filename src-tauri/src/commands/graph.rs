use raven_core::{AppState, EgoGraph, RebuildResult};
use tauri::State;

#[tauri::command]
pub async fn get_ego_graph(
    _state: State<'_, AppState>,
    entity_id: String,
    hops: u8,
    min_weight: f64,
) -> Result<EgoGraph, String> {
    // Backlog #4: Bolt query + batched evidence hydrate.
    Ok(EgoGraph {
        nodes: vec![],
        edges: vec![],
    })
}

#[tauri::command]
pub async fn get_macro_graph(
    _state: State<'_, AppState>,
    case_id: String,
    min_weight: f64,
    limit: u32,
) -> Result<EgoGraph, String> {
    // Backlog #4: top-N by weight.
    Ok(EgoGraph {
        nodes: vec![],
        edges: vec![],
    })
}

#[tauri::command]
pub async fn rebuild_graph(
    state: State<'_, AppState>,
    case_id: String,
) -> Result<RebuildResult, String> {
    // D4 recovery path: regenerate Neo4j from Postgres.
    let start = std::time::Instant::now();
    let (nodes, edges) = raven_core::db::neo4j::rebuild_graph(state.inner(), &case_id).await?;
    Ok(RebuildResult {
        nodes,
        edges,
        ms: start.elapsed().as_millis(),
    })
}
