use crate::AppState;
use neo4rs::query;

/// An edge row returned by a Bolt traversal (Backlog #4). Node details and
/// per-edge evidence are hydrated from Postgres by `db::graph` afterwards.
#[derive(Debug, Clone)]
pub struct BoltEdge {
    pub id: String,
    pub src: String,
    pub dst: String,
    pub rtype: String,
    pub weight: f64,
    pub evidence_count: i64,
}

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

// ------------------------------------------------- Bolt graph queries ----
// (Backlog #4, architecture §6.2.) The traversal runs in Neo4j; `db::graph`
// then hydrates node details + per-edge evidence from Postgres in ONE batch.

async fn rows_to_edges(neo: &neo4rs::Graph, q: neo4rs::Query) -> Result<Vec<BoltEdge>, String> {
    let mut stream = neo.execute(q).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    loop {
        match stream.next().await {
            Ok(Some(row)) => out.push(BoltEdge {
                src: row.get::<String>("src").map_err(|e| e.to_string())?,
                dst: row.get::<String>("dst").map_err(|e| e.to_string())?,
                id: row.get::<String>("rid").map_err(|e| e.to_string())?,
                rtype: row
                    .get::<Option<String>>("rtype")
                    .map_err(|e| e.to_string())?
                    .unwrap_or_else(|| "LINKED_TO".into()),
                weight: row.get::<f64>("w").map_err(|e| e.to_string())?,
                evidence_count: row.get::<i64>("ec").map_err(|e| e.to_string())?,
            }),
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(out)
}

async fn collect_ids(neo: &neo4rs::Graph, q: neo4rs::Query) -> Result<Vec<String>, String> {
    let mut stream = neo.execute(q).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    loop {
        match stream.next().await {
            Ok(Some(row)) => out.push(row.get::<String>("id").map_err(|e| e.to_string())?),
            Ok(None) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(out)
}

/// Ego subgraph via Bolt: all `LINKED_TO` edges within `hops` of the entity
/// whose weight clears the floor. Returns `(node_ids, edges)`.
pub async fn ego_subgraph(
    neo: &neo4rs::Graph,
    entity_id: &str,
    hops: u32,
    min_weight: f64,
) -> Result<(Vec<String>, Vec<BoltEdge>), String> {
    let hops = hops.clamp(1, 5);

    let edges = rows_to_edges(
        neo,
        query(&format!(
            "MATCH (e:Entity {{entity_id:$id}})-[rs:LINKED_TO*1..{hops}]-(n:Entity) \
             WHERE all(r IN rs WHERE r.weight >= $minw) \
             UNWIND rs AS r \
             WITH DISTINCT r, startNode(r) AS a, endNode(r) AS b \
             RETURN a.entity_id AS src, b.entity_id AS dst, r.rel_id AS rid, \
                    r.type AS rtype, r.weight AS w, r.evidence_count AS ec"
        ))
        .param("id", entity_id)
        .param("minw", min_weight),
    )
    .await?;

    let ids = collect_ids(
        neo,
        query(&format!(
            "MATCH (e:Entity {{entity_id:$id}})-[rs:LINKED_TO*1..{hops}]-(n) \
             WHERE all(r IN rs WHERE r.weight >= $minw) \
             WITH e, collect(n) AS ns \
             UNWIND ([e] + ns) AS x \
             RETURN DISTINCT x.entity_id AS id"
        ))
        .param("id", entity_id)
        .param("minw", min_weight),
    )
    .await?;

    Ok((ids, edges))
}

/// Macro subgraph via Bolt: top-N heaviest `LINKED_TO` edges of a case.
/// Returns `(node_ids, edges)`.
pub async fn macro_edges(
    neo: &neo4rs::Graph,
    case_id: &str,
    min_weight: f64,
    limit: u32,
) -> Result<(Vec<String>, Vec<BoltEdge>), String> {
    let edges = rows_to_edges(
        neo,
        query(
            "MATCH (a:Entity {case_id:$case})-[r:LINKED_TO]->(b:Entity) \
             WHERE r.weight >= $minw \
             WITH a, b, r ORDER BY r.weight DESC LIMIT $lim \
             RETURN a.entity_id AS src, b.entity_id AS dst, r.rel_id AS rid, \
                    r.type AS rtype, r.weight AS w, r.evidence_count AS ec",
        )
        .param("case", case_id)
        .param("minw", min_weight)
        .param("lim", limit as i64),
    )
    .await?;

    let ids = collect_ids(
        neo,
        query(
            "MATCH (a:Entity {case_id:$case})-[r:LINKED_TO]->(b:Entity) \
             WHERE r.weight >= $minw \
             WITH r ORDER BY r.weight DESC LIMIT $lim \
             UNWIND [startNode(r), endNode(r)] AS x \
             RETURN DISTINCT x.entity_id AS id",
        )
        .param("case", case_id)
        .param("minw", min_weight)
        .param("lim", limit as i64),
    )
    .await?;

    Ok((ids, edges))
}
