use raven_core::{AppState, EgoGraph, RebuildResult};
use tauri::State;

#[tauri::command]
pub async fn get_ego_graph(
    state: State<'_, AppState>,
    entity_id: String,
    hops: u8,
    min_weight: f64,
) -> Result<EgoGraph, String> {
    // §6.2: Bolt traversal (or recursive-CTE fallback) + ONE batched evidence
    // hydrate from Postgres. Audit `graph.query` is best-effort.
    let g = raven_core::db::graph::get_ego_graph(state.inner(), &entity_id, hops as u32, min_weight)
        .await?;
    let _ = raven_core::audit::emit(
        state.inner(),
        "graph.query",
        "entity",
        &entity_id,
        &format!("{{\"view\":\"ego\",\"hops\":{hops},\"min_weight\":{min_weight}}}"),
    )
    .await;
    Ok(EgoGraph {
        nodes: g.nodes,
        edges: g.edges,
        source: g.source,
        case_id: g.case_id,
    })
}

#[tauri::command]
pub async fn get_macro_graph(
    state: State<'_, AppState>,
    case_id: String,
    min_weight: f64,
    limit: u32,
) -> Result<EgoGraph, String> {
    let g = raven_core::db::graph::get_macro_graph(state.inner(), &case_id, min_weight, limit)
        .await?;
    let _ = raven_core::audit::emit(
        state.inner(),
        "graph.query",
        "case",
        &case_id,
        &format!("{{\"view\":\"macro\",\"min_weight\":{min_weight},\"limit\":{limit}}}"),
    )
    .await;
    Ok(EgoGraph {
        nodes: g.nodes,
        edges: g.edges,
        source: g.source,
        case_id: g.case_id,
    })
}

#[tauri::command]
pub async fn list_entities(
    state: State<'_, AppState>,
    case_id: String,
) -> Result<Vec<raven_core::db::graph::GraphNode>, String> {
    raven_core::db::graph::list_entities_pg(&state.pg, &case_id).await
}

#[tauri::command]
pub async fn get_entity_details(
    state: State<'_, AppState>,
    entity_id: String,
) -> Result<raven_core::EntityDetails, String> {
    let d = raven_core::db::graph::entity_details_pg(&state.pg, &entity_id).await?;
    Ok(raven_core::EntityDetails {
        entity: d.entity,
        identifiers: d.identifiers,
        evidence: d.evidence,
        linked_files: d.linked_files,
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
