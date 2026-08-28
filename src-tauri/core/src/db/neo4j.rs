use crate::AppState;
use neo4rs::query;

/// Merge a `Document` node for an ingested file. Always safe to replay (D4).
pub async fn merge_document(
    state: &AppState,
    case_id: &str,
    doc_id: &str,
    name: &str,
    sha256: &str,
) -> Result<(), String> {
    let neo = state
        .neo
        .as_ref()
        .ok_or_else(|| "neo4j not configured".to_string())?;
    neo.execute(
        query(
            "MERGE (d:Document {doc_id:$id}) \
             SET d.case_id=$case, d.name=$name, d.sha256=$sha, d.updated=datetime()",
        )
        .param("id", doc_id)
        .param("case", case_id)
        .param("name", name)
        .param("sha", sha256),
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Merge an `Entity` node (idempotent).
pub async fn merge_entity(
    state: &AppState,
    case_id: &str,
    entity_id: &str,
    etype: &str,
    name: &str,
) -> Result<(), String> {
    let neo = state
        .neo
        .as_ref()
        .ok_or_else(|| "neo4j not configured".to_string())?;
    neo.execute(
        query(
            "MERGE (e:Entity {entity_id:$id}) \
             ON CREATE SET e.case_id=$case, e.name=$name, e.type=$type \
             ON MATCH SET e.name=$name",
        )
        .param("id", entity_id)
        .param("case", case_id)
        .param("name", name)
        .param("type", etype),
    )
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Merge a typed, weighted `LINKED_TO` relationship between two entities (D4
/// idempotent upsert). Endpoints are `MERGE`d so a rebuild can recreate edges
/// even when the nodes were never explicitly created.
pub async fn merge_relationship(
    state: &AppState,
    case_id: &str,
    rel_id: &str,
    src: &str,
    dst: &str,
    rtype: &str,
    weight: f64,
    evidence_count: i64,
    last_seen: Option<String>,
) -> Result<(), String> {
    let neo = state
        .neo
        .as_ref()
        .ok_or_else(|| "neo4j not configured".to_string())?;

    let base = "MERGE (a:Entity {entity_id:$src}) MERGE (b:Entity {entity_id:$dst}) \
                MERGE (a)-[r:LINKED_TO {rel_id:$rid}]->(b) \
                SET r.weight=$w, r.evidence_count=$ec, r.case_id=$case, r.type=$rtype";
    let q = if last_seen.is_some() {
        query(&format!("{base}, r.last_seen=$ls")).param("ls", last_seen.unwrap())
    } else {
        query(base)
    };
    let q = q
        .param("src", src)
        .param("dst", dst)
        .param("rid", rel_id)
        .param("w", weight)
        .param("ec", evidence_count)
        .param("case", case_id)
        .param("rtype", rtype);
    neo.execute(q)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Regenerate the entire Neo4j graph for a case from Postgres (D4 recovery /
/// `rebuild_graph` command). Returns `(nodes, edges)` merged.
pub async fn rebuild_graph(state: &AppState, case_id: &str) -> Result<(usize, usize), String> {
    let ents: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id::text, type::text, canonical_name FROM entities WHERE case_id=$1::uuid",
    )
    .bind(case_id)
    .persistent(false)
    .fetch_all(&state.pg)
    .await
    .map_err(|e| e.to_string())?;

    let mut nodes = 0;
    for (id, etype, name) in &ents {
        merge_entity(state, case_id, id, etype, name).await?;
        nodes += 1;
    }

    let rels: Vec<(String, String, String, String, f64, i64)> = sqlx::query_as(
        "SELECT id::text, src_entity_id::text, dst_entity_id::text, type::text, weight, evidence_count \
         FROM relationships WHERE case_id=$1::uuid",
    )
    .bind(case_id)
    .persistent(false)
    .fetch_all(&state.pg)
    .await
    .map_err(|e| e.to_string())?;

    let mut edges = 0;
    for (id, src, dst, rtype, w, ec) in &rels {
        merge_relationship(state, case_id, id, src, dst, rtype, *w, *ec, None).await?;
        edges += 1;
    }

    Ok((nodes, edges))
}
