//! Graph engine (Backlog #4, architecture §6.2 / §9.2).
//!
//! Two serving paths with identical output shape:
//!   * **Bolt** (`db::neo4j::ego_edge_rows` / `macro_edge_rows`) when Neo4j is
//!     reachable — the graph traversal runs in Neo4j, then node details and
//!     per-edge evidence are hydrated from Postgres in ONE batched query
//!     (never N+1 per edge).
//!   * **Postgres** (this module) — the canonical fallback (D4 graceful
//!     degradation): the ego walk is a recursive CTE over `relationships`,
//!     macro is a top-N by weight. Same batched evidence hydrate.
//!
//! Every query result also reports which path served it (`source`), so the
//! headless CLI and the UI can show whether the graph store or the relational
//! store answered.

use crate::AppState;
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashMap;

// ---------------------------------------------------------------- types ----

#[derive(Debug, Clone, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub etype: String,
    pub risk_score: f64,
    /// Degree within the returned subgraph (drives node size in the UI).
    pub degree: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub rtype: String,
    pub weight: f64,
    pub evidence_count: i32,
    /// Highest-value evidence kind backing this edge (drives edge colour).
    pub dominant_kind: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GraphResult {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// "neo4j" (Bolt traversal) or "postgres" (relational fallback).
    pub source: String,
    pub case_id: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct EvidenceRow {
    pub id: i64,
    pub kind: String,
    pub snippet: Option<String>,
    pub char_start: Option<i64>,
    pub char_end: Option<i64>,
    pub page_no: Option<i16>,
    pub created_at: String,
    pub source_file_id: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SourceFileRow {
    pub id: String,
    pub filename: String,
    pub sha256: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RelationshipMeta {
    pub id: String,
    #[serde(rename = "type")]
    pub rtype: String,
    pub weight: f64,
    pub evidence_count: i32,
    pub src_id: String,
    pub src_name: String,
    pub dst_id: String,
    pub dst_name: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct IdentifierRow {
    pub itype: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct EntityDetails {
    pub entity: GraphNode,
    pub identifiers: Vec<IdentifierRow>,
    pub evidence: Vec<EvidenceRow>,
    pub linked_files: Vec<SourceFileRow>,
}

// ------------------------------------------------------------- helpers -----

/// One batched evidence hydrate for ALL edges of a subgraph (§6.2: never N+1).
/// Returns `(evidence_count, dominant_kind)` per relationship id.
async fn hydrate_evidence(
    pool: &PgPool,
    edge_ids: &[String],
) -> Result<HashMap<String, (i64, Option<String>)>, String> {
    if edge_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(String, i64, Option<String>)> = sqlx::query_as(
        "SELECT relationship_id::text, count(*)::bigint, \
         (array_agg(kind ORDER BY CASE kind \
            WHEN 'fir_text' THEN 0 WHEN 'txn_row' THEN 1 \
            WHEN 'cctv_sighting' THEN 2 ELSE 3 END))[1] \
         FROM evidence WHERE relationship_id::text = ANY($1) \
         GROUP BY relationship_id",
    )
    .bind(edge_ids)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(rid, n, dom)| (rid, (n, dom)))
        .collect())
}

/// Fetch node details for a set of entity ids and attach degrees computed
/// from the edge list.
async fn fetch_nodes(pool: &PgPool, ids: &[String], edges: &[GraphEdge]) -> Result<Vec<GraphNode>, String> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let rows: Vec<(String, String, String, f64)> = sqlx::query_as(
        "SELECT id::text, type::text, canonical_name, risk_score::float8 \
         FROM entities WHERE id::text = ANY($1)",
    )
    .bind(ids)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut degree: HashMap<&str, usize> = HashMap::new();
    for e in edges {
        *degree.entry(e.source.as_str()).or_default() += 1;
        *degree.entry(e.target.as_str()).or_default() += 1;
    }

    Ok(rows
        .into_iter()
        .map(|(id, etype, name, risk)| GraphNode {
            degree: degree.get(id.as_str()).copied().unwrap_or(0),
            id,
            label: name,
            etype,
            risk_score: risk,
        })
        .collect())
}

/// Attach the batched evidence hydrate to a list of edges (in place).
async fn hydrate_edges(pool: &PgPool, edges: &mut [GraphEdge]) -> Result<(), String> {
    let ids: Vec<String> = edges.iter().map(|e| e.id.clone()).collect();
    let ev = hydrate_evidence(pool, &ids).await?;
    for e in edges.iter_mut() {
        if let Some((n, dom)) = ev.get(&e.id) {
            e.evidence_count = *n as i32;
            e.dominant_kind = dom.clone();
        }
    }
    Ok(())
}

// ------------------------------------------------- postgres graph paths ----

/// Ego graph via a recursive CTE walk over `relationships` (canonical path).
pub async fn ego_graph_pg(
    pool: &PgPool,
    entity_id: &str,
    hops: u32,
    min_weight: f64,
) -> Result<GraphResult, String> {
    // Resolve the entity (must exist) and its case.
    let case_id: Option<String> = sqlx::query_scalar(
        "SELECT case_id::text FROM entities WHERE id = $1::uuid",
    )
    .bind(entity_id)
    .persistent(false)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some(case_id) = case_id else {
        return Err(format!("entity not found: {entity_id}"));
    };

    // The walk: UNION (not UNION ALL) dedups each iteration, so cycles in the
    // relationship graph terminate the recursion naturally.
    let ids: Vec<String> = sqlx::query_scalar(
        "WITH RECURSIVE ego AS ( \
           SELECT e.id AS id, 0 AS depth FROM entities e WHERE e.id = $1::uuid \
           UNION \
           SELECT (CASE WHEN r.src_entity_id = ego.id THEN r.dst_entity_id \
                        ELSE r.src_entity_id END)::uuid AS id, ego.depth + 1 AS depth \
           FROM ego \
           JOIN relationships r ON (r.src_entity_id = ego.id OR r.dst_entity_id = ego.id) \
           WHERE ego.depth < $2 AND r.weight >= $3::numeric \
         ) SELECT DISTINCT id::text FROM ego",
    )
    .bind(entity_id)
    .bind(hops as i32)
    .bind(min_weight)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    finish_subgraph(pool, &case_id, ids, min_weight, None).await
}

/// Macro graph: top-N heaviest relationships of a case (canonical path).
/// `case_id` may be a UUID or a `case_code` (the UI passes the code).
pub async fn macro_graph_pg(
    pool: &PgPool,
    case_id: &str,
    min_weight: f64,
    limit: u32,
) -> Result<GraphResult, String> {
    let case_uuid = super::postgres::resolve_case_id(pool, case_id).await?;
    let rows: Vec<(String, String, String, String, f64, i32)> = sqlx::query_as(
        "SELECT id::text, src_entity_id::text, dst_entity_id::text, type::text, \
                weight::float8, evidence_count \
         FROM relationships \
         WHERE case_id = $1::uuid AND weight >= $2::numeric \
         ORDER BY weight DESC LIMIT $3",
    )
    .bind(&case_uuid)
    .bind(min_weight)
    .bind(limit as i64)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut edges: Vec<GraphEdge> = rows
        .into_iter()
        .map(|(id, src, dst, rtype, weight, ec)| GraphEdge {
            id,
            source: src,
            target: dst,
            rtype,
            weight,
            evidence_count: ec,
            dominant_kind: None,
        })
        .collect();
    hydrate_edges(pool, &mut edges).await?;

    let node_ids: Vec<String> = edges
        .iter()
        .flat_map(|e| [e.source.clone(), e.target.clone()])
        .collect();
    let nodes = fetch_nodes(pool, &node_ids, &edges).await?;

    Ok(GraphResult {
        nodes,
        edges,
        source: "postgres".into(),
        case_id: case_uuid,
    })
}

/// Shared tail for both paths: restrict edges to the subgraph's node set,
async fn finish_subgraph(
    pool: &PgPool,
    case_id: &str,
    node_ids: Vec<String>,
    min_weight: f64,
    limit: Option<u32>,
) -> Result<GraphResult, String> {
    let mut edges: Vec<GraphEdge> = if node_ids.is_empty() {
        vec![]
    } else {
        let base = "SELECT id::text, src_entity_id::text, dst_entity_id::text, type::text, \
                    weight::float8, evidence_count \
                    FROM relationships \
                    WHERE case_id = $1::uuid AND weight >= $2::numeric \
                    AND src_entity_id::text = ANY($3) AND dst_entity_id::text = ANY($3)";
        let q = match limit {
            Some(l) => format!("{base} ORDER BY weight DESC LIMIT {l}"),
            None => format!("{base} ORDER BY weight DESC"),
        };
        sqlx::query_as::<_, (String, String, String, String, f64, i32)>(&q)
            .bind(case_id)
            .bind(min_weight)
            .bind(&node_ids)
            .persistent(false)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|(id, src, dst, rtype, weight, ec)| GraphEdge {
                id,
                source: src,
                target: dst,
                rtype,
                weight,
                evidence_count: ec,
                dominant_kind: None,
            })
            .collect()
    };

    hydrate_edges(pool, &mut edges).await?;
    let nodes = fetch_nodes(pool, &node_ids, &edges).await?;

    Ok(GraphResult {
        nodes,
        edges,
        source: "postgres".into(),
        case_id: case_id.to_string(),
    })
}

// --------------------------------------------------- evidence + details ----

/// Edge evidence for the side panel (Postgres only — clicking an edge must
/// NEVER re-query the graph, §6.2).
pub async fn edge_evidence_pg(pool: &PgPool, rel_id: &str) -> Result<(Option<RelationshipMeta>, Vec<EvidenceRow>, Vec<SourceFileRow>), String> {
    let meta: Option<(String, String, f64, i32, String, String, String, String)> = sqlx::query_as(
        "SELECT r.id::text, r.type::text, r.weight::float8, r.evidence_count, \
                a.id::text, a.canonical_name, b.id::text, b.canonical_name \
         FROM relationships r \
         JOIN entities a ON a.id = r.src_entity_id \
         JOIN entities b ON b.id = r.dst_entity_id \
         WHERE r.id = $1::uuid",
    )
    .bind(rel_id)
    .persistent(false)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some((id, rtype, weight, ec, src_id, src_name, dst_id, dst_name)) = meta else {
        return Err(format!("relationship not found: {rel_id}"));
    };

    let evidence: Vec<EvidenceRow> = sqlx::query_as(
        "SELECT e.id, e.kind, e.snippet, e.char_start, e.char_end, e.page_no, \
                e.created_at::text, e.source_file_id::text \
         FROM evidence e WHERE e.relationship_id = $1::uuid ORDER BY e.id",
    )
    .bind(rel_id)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let files: Vec<SourceFileRow> = sqlx::query_as(
        "SELECT DISTINCT sf.id::text, sf.filename, sf.sha256, sf.status::text \
         FROM source_files sf \
         JOIN evidence e ON e.source_file_id = sf.id \
         WHERE e.relationship_id = $1::uuid",
    )
    .bind(rel_id)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok((
        Some(RelationshipMeta {
            id,
            rtype,
            weight,
            evidence_count: ec,
            src_id,
            src_name,
            dst_id,
            dst_name,
        }),
        evidence,
        files,
    ))
}

/// Node details for the side panel (node mode).
pub async fn entity_details_pg(pool: &PgPool, entity_id: &str) -> Result<EntityDetails, String> {
    let row: Option<(String, String, String, f64)> = sqlx::query_as(
        "SELECT id::text, type::text, canonical_name, risk_score::float8 \
         FROM entities WHERE id = $1::uuid",
    )
    .bind(entity_id)
    .persistent(false)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some((id, etype, name, risk)) = row else {
        return Err(format!("entity not found: {entity_id}"));
    };

    let identifiers: Vec<IdentifierRow> = sqlx::query_as(
        "SELECT type::text AS itype, value FROM identifiers WHERE entity_id = $1::uuid ORDER BY type, value",
    )
    .bind(entity_id)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let evidence: Vec<EvidenceRow> = sqlx::query_as(
        "SELECT e.id, e.kind, e.snippet, e.char_start, e.char_end, e.page_no, \
                e.created_at::text, e.source_file_id::text \
         FROM evidence e WHERE e.entity_id = $1::uuid ORDER BY e.id",
    )
    .bind(entity_id)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let files: Vec<SourceFileRow> = sqlx::query_as(
        "SELECT DISTINCT sf.id::text, sf.filename, sf.sha256, sf.status::text \
         FROM source_files sf \
         JOIN evidence e ON e.source_file_id = sf.id \
         WHERE e.entity_id = $1::uuid",
    )
    .bind(entity_id)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(EntityDetails {
        entity: GraphNode {
            id,
            label: name,
            etype,
            risk_score: risk,
            degree: 0,
        },
        identifiers,
        evidence,
        linked_files: files,
    })
}

/// Entity picker for the search box / micro-view entry points.
/// `case_id` may be a UUID or a `case_code`.
pub async fn list_entities_pg(pool: &PgPool, case_id: &str) -> Result<Vec<GraphNode>, String> {
    let case_uuid = super::postgres::resolve_case_id(pool, case_id).await?;
    let rows: Vec<(String, String, String, f64)> = sqlx::query_as(
        "SELECT id::text, type::text, canonical_name, risk_score::float8 \
         FROM entities WHERE case_id = $1::uuid ORDER BY canonical_name",
    )
    .bind(&case_uuid)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(id, etype, name, risk)| GraphNode {
            id,
            label: name,
            etype,
            risk_score: risk,
            degree: 0,
        })
        .collect())
}

// ------------------------------------------------------- dispatch layer ----

/// Serve the ego graph: Bolt traversal when Neo4j is up (with the batched
/// Postgres evidence hydrate), recursive-CTE fallback otherwise.
pub async fn get_ego_graph(
    state: &AppState,
    entity_id: &str,
    hops: u32,
    min_weight: f64,
) -> Result<GraphResult, String> {
    if let Some(neo) = &state.neo {
        match super::neo4j::ego_subgraph(neo, entity_id, hops, min_weight).await {
            Ok((node_ids, bolt_edges)) => {
                // Resolve the case from Postgres (entity ids are global).
                let case_id: String = sqlx::query_scalar(
                    "SELECT case_id::text FROM entities WHERE id = $1::uuid",
                )
                .bind(entity_id)
                .persistent(false)
                .fetch_one(&state.pg)
                .await
                .map_err(|e| e.to_string())?;

                let mut edges: Vec<GraphEdge> = bolt_edges
                    .into_iter()
                    .map(|b| GraphEdge {
                        id: b.id,
                        source: b.src,
                        target: b.dst,
                        rtype: b.rtype,
                        weight: b.weight,
                        evidence_count: b.evidence_count as i32,
                        dominant_kind: None,
                    })
                    .collect();
                hydrate_edges(&state.pg, &mut edges).await?;
                let nodes = fetch_nodes(&state.pg, &node_ids, &edges).await?;
                return Ok(GraphResult {
                    nodes,
                    edges,
                    source: "neo4j".into(),
                    case_id,
                });
            }
            Err(e) => {
                tracing::warn!("Bolt ego query failed ({e}); falling back to Postgres");
            }
        }
    }
    ego_graph_pg(&state.pg, entity_id, hops, min_weight).await
}

/// Serve the macro graph: Bolt top-N when Neo4j is up, Postgres top-N else.
pub async fn get_macro_graph(
    state: &AppState,
    case_id: &str,
    min_weight: f64,
    limit: u32,
) -> Result<GraphResult, String> {
    if let Some(neo) = &state.neo {
        match super::neo4j::macro_edges(neo, case_id, min_weight, limit).await {
            Ok((node_ids, bolt_edges)) => {
                let mut edges: Vec<GraphEdge> = bolt_edges
                    .into_iter()
                    .map(|b| GraphEdge {
                        id: b.id,
                        source: b.src,
                        target: b.dst,
                        rtype: b.rtype,
                        weight: b.weight,
                        evidence_count: b.evidence_count as i32,
                        dominant_kind: None,
                    })
                    .collect();
                hydrate_edges(&state.pg, &mut edges).await?;
                let nodes = fetch_nodes(&state.pg, &node_ids, &edges).await?;
                return Ok(GraphResult {
                    nodes,
                    edges,
                    source: "neo4j".into(),
                    case_id: case_id.to_string(),
                });
            }
            Err(e) => {
                tracing::warn!("Bolt macro query failed ({e}); falling back to Postgres");
            }
        }
    }
    macro_graph_pg(&state.pg, case_id, min_weight, limit).await
}


