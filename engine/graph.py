"""Graph query endpoints (dev mirror of the Rust graph engine, Backlog #4).

The Tauri app serves graph queries from Rust (Bolt + Postgres). These FastAPI
endpoints mirror the SAME SQL so the React UI can be exercised in a plain
browser (`npm run dev`) against the live cloud Supabase without building the
Rust shell. Reads only — never mutate graph state.

Routes:
  POST /graph/macro        {case_id, min_weight, limit}
  POST /graph/ego          {entity_id, hops, min_weight}
  POST /graph/edge_evidence {rel_id}
  POST /graph/entity       {entity_id}
  POST /graph/entities     {case_id}
"""
import uuid

from fastapi import APIRouter

import db as db_layer

router = APIRouter(prefix="/graph", tags=["graph"])


def _ns() -> uuid.UUID:
    return uuid.UUID("f0e1d2c3-4567-89ab-cdef-0123456789ab")


async def _resolve_case(conn, case_id: str) -> str:
    try:
        uuid.UUID(case_id)
        return case_id
    except ValueError:
        row = await conn.fetchval("SELECT id::text FROM cases WHERE case_code = $1", case_id)
        if not row:
            raise ValueError(f"case not found: {case_id}")
        return row


async def macro_graph(case_id: str, min_weight: float, limit: int):
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        case_uuid = await _resolve_case(conn, case_id)
        rows = await conn.fetch(
            "SELECT id::text, src_entity_id::text, dst_entity_id::text, type::text, "
            "weight::float8, evidence_count FROM relationships "
            "WHERE case_id = $1::uuid AND weight >= $2::numeric "
            "ORDER BY weight DESC LIMIT $3",
            case_uuid, min_weight, limit,
        )
        edges = [dict(r) for r in rows]
        node_ids = []
        for e in edges:
            node_ids.append(e["src_entity_id"])
            node_ids.append(e["dst_entity_id"])
        nodes = await _nodes(conn, node_ids, edges)
        hydrate = await _hydrate(conn, [e["id"] for e in edges])
        for e in edges:
            h = hydrate.get(e["id"])
            e["dominant_kind"] = h[1] if h else None
        return {"nodes": nodes, "edges": edges, "source": "postgres", "case_id": case_uuid}


async def ego_graph(entity_id: str, hops: int, min_weight: float):
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        case_uuid = await conn.fetchval("SELECT case_id::text FROM entities WHERE id = $1::uuid", entity_id)
        if not case_uuid:
            raise ValueError(f"entity not found: {entity_id}")
        ids = await conn.fetch(
            "WITH RECURSIVE ego AS ("
            "SELECT e.id AS id, 0 AS depth FROM entities e WHERE e.id = $1::uuid "
            "UNION "
            "SELECT (CASE WHEN r.src_entity_id = ego.id THEN r.dst_entity_id "
            "ELSE r.src_entity_id END)::uuid AS id, ego.depth + 1 AS depth "
            "FROM ego JOIN relationships r ON (r.src_entity_id = ego.id OR r.dst_entity_id = ego.id) "
            "WHERE ego.depth < $2 AND r.weight >= $3::numeric) "
            "SELECT DISTINCT id::text FROM ego",
            entity_id, int(hops), min_weight,
        )
        node_ids = [r["id"] for r in ids]
        edges = await conn.fetch(
            "SELECT id::text, src_entity_id::text, dst_entity_id::text, type::text, "
            "weight::float8, evidence_count FROM relationships "
            "WHERE case_id = $1::uuid AND weight >= $2::numeric "
            "AND src_entity_id::text = ANY($3) AND dst_entity_id::text = ANY($3) "
            "ORDER BY weight DESC",
            case_uuid, min_weight, node_ids,
        )
        elist = [dict(r) for r in edges]
        nodes = await _nodes(conn, node_ids, elist)
        hydrate = await _hydrate(conn, [e["id"] for e in elist])
        for e in elist:
            h = hydrate.get(e["id"])
            e["dominant_kind"] = h[1] if h else None
        return {"nodes": nodes, "edges": elist, "source": "postgres", "case_id": case_uuid}


async def _nodes(conn, node_ids, edges):
    if not node_ids:
        return []
    degree = {}
    for e in edges:
        degree[e["src_entity_id"]] = degree.get(e["src_entity_id"], 0) + 1
        degree[e["dst_entity_id"]] = degree.get(e["dst_entity_id"], 0) + 1
    rows = await conn.fetch(
        "SELECT id::text, type::text, canonical_name, risk_score::float8 "
        "FROM entities WHERE id::text = ANY($1)",
        node_ids,
    )
    return [
        {
            "id": r["id"],
            "label": r["canonical_name"],
            "type": r["type"],
            "risk_score": float(r["risk_score"] or 0),
            "degree": degree.get(r["id"], 0),
        }
        for r in rows
    ]


async def _hydrate(conn, edge_ids):
    if not edge_ids:
        return {}
    rows = await conn.fetch(
        "SELECT relationship_id::text AS rid, count(*)::bigint AS n, "
        "(array_agg(kind ORDER BY CASE kind WHEN 'fir_text' THEN 0 "
        "WHEN 'txn_row' THEN 1 WHEN 'cctv_sighting' THEN 2 ELSE 3 END))[1] AS dominant "
        "FROM evidence WHERE relationship_id::text = ANY($1) GROUP BY relationship_id",
        edge_ids,
    )
    return {r["rid"]: (r["n"], r["dominant"]) for r in rows}


async def edge_evidence(rel_id: str):
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        meta = await conn.fetchrow(
            "SELECT r.id::text, r.type::text, r.weight::float8, r.evidence_count, "
            "a.id::text AS src_id, a.canonical_name AS src_name, "
            "b.id::text AS dst_id, b.canonical_name AS dst_name "
            "FROM relationships r JOIN entities a ON a.id = r.src_entity_id "
            "JOIN entities b ON b.id = r.dst_entity_id WHERE r.id = $1::uuid",
            rel_id,
        )
        if not meta:
            raise ValueError(f"relationship not found: {rel_id}")
        evidence = await conn.fetch(
            "SELECT e.id, e.kind, e.snippet, e.char_start, e.char_end, e.page_no, "
            "e.created_at::text, e.source_file_id::text FROM evidence e "
            "WHERE e.relationship_id = $1::uuid ORDER BY e.id",
            rel_id,
        )
        files = await conn.fetch(
            "SELECT DISTINCT sf.id::text, sf.filename, sf.sha256, sf.status::text "
            "FROM source_files sf JOIN evidence e ON e.source_file_id = sf.id "
            "WHERE e.relationship_id = $1::uuid",
            rel_id,
        )
        return {
            "relationship": {
                "id": meta["id"], "type": meta["type"], "weight": float(meta["weight"]),
                "evidence_count": meta["evidence_count"], "src_id": meta["src_id"],
                "src_name": meta["src_name"], "dst_id": meta["dst_id"],
                "dst_name": meta["dst_name"],
            },
            "evidence": [dict(r) for r in evidence],
            "source_files": [dict(r) for r in files],
        }


async def entity_details(entity_id: str):
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id::text, type::text, canonical_name, risk_score::float8 "
            "FROM entities WHERE id = $1::uuid",
            entity_id,
        )
        if not row:
            raise ValueError(f"entity not found: {entity_id}")
        identifiers = await conn.fetch(
            "SELECT type::text AS itype, value FROM identifiers WHERE entity_id = $1::uuid "
            "ORDER BY type, value",
            entity_id,
        )
        evidence = await conn.fetch(
            "SELECT e.id, e.kind, e.snippet, e.char_start, e.char_end, e.page_no, "
            "e.created_at::text, e.source_file_id::text FROM evidence e "
            "WHERE e.entity_id = $1::uuid ORDER BY e.id",
            entity_id,
        )
        files = await conn.fetch(
            "SELECT DISTINCT sf.id::text, sf.filename, sf.sha256, sf.status::text "
            "FROM source_files sf JOIN evidence e ON e.source_file_id = sf.id "
            "WHERE e.entity_id = $1::uuid",
            entity_id,
        )
        return {
            "entity": {
                "id": row["id"], "label": row["canonical_name"], "type": row["type"],
                "risk_score": float(row["risk_score"] or 0), "degree": 0,
            },
            "identifiers": [dict(r) for r in identifiers],
            "evidence": [dict(r) for r in evidence],
            "linked_files": [dict(r) for r in files],
        }


async def list_entities(case_id: str):
    pool = await db_layer.get_pool()
    async with pool.acquire() as conn:
        case_uuid = await _resolve_case(conn, case_id)
        rows = await conn.fetch(
            "SELECT id::text, type::text, canonical_name, risk_score::float8 "
            "FROM entities WHERE case_id = $1::uuid ORDER BY canonical_name",
            case_uuid,
        )
        return [
            {
                "id": r["id"], "label": r["canonical_name"], "type": r["type"],
                "risk_score": float(r["risk_score"] or 0), "degree": 0,
            }
            for r in rows
        ]


@router.post("/macro")
async def post_macro(body: dict):
    return await macro_graph(
        body["case_id"], float(body.get("min_weight", 5.0)), int(body.get("limit", 1000))
    )


@router.post("/ego")
async def post_ego(body: dict):
    return await ego_graph(body["entity_id"], int(body.get("hops", 2)), float(body.get("min_weight", 5.0)))


@router.post("/edge_evidence")
async def post_edge(body: dict):
    return await edge_evidence(body["rel_id"])


@router.post("/entity")
async def post_entity(body: dict):
    return await entity_details(body["entity_id"])


@router.post("/entities")
async def post_entities(body: dict):
    return await list_entities(body.get("case_id", "OP-RAVEN-01"))
